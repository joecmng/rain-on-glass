// GLSL ES 3.00 sources.
// Coordinate convention: uv (0,0) = bottom-left. Sim world y points DOWN (0 = top).

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// ── Procedural night city, seen from a moving car ───────────────────────────
// uFocus = 0 → what the drops "see": small, motion-streaked point lights
// uFocus = 1 → what the camera sees past the glass: large defocused bokeh discs
export const CITY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform float uTime, uFocus, uAspect, uScroll;

vec2 h22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }

vec3 palette(float k) {
  if (k < 0.36) return vec3(1.0, 0.52, 0.16);   // sodium street lights
  if (k < 0.60) return vec3(1.0, 0.86, 0.68);   // warm white windows / headlights
  if (k < 0.77) return vec3(1.0, 0.09, 0.05);   // tail lights
  if (k < 0.88) return vec3(0.42, 0.62, 1.0);   // cool LED
  if (k < 0.94) return vec3(0.25, 1.0, 0.55);   // traffic green
  return vec3(1.0, 0.25, 0.75);                 // neon sign
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  // sky: deep blue-black, warm sodium haze near the horizon
  vec3 col = mix(vec3(0.030, 0.022, 0.020), vec3(0.004, 0.006, 0.018), smoothstep(0.1, 1.0, vUv.y));
  col += vec3(0.075, 0.035, 0.012) * exp(-pow((vUv.y - 0.36) * 3.2, 2.0));
  col += vec3(0.012, 0.010, 0.012) * (1.0 - smoothstep(0.0, 0.3, vUv.y)); // road

  for (int L = 0; L < 4; L++) {
    float fl = float(L);
    float scale = 3.2 + fl * 2.6;                 // cells per screen height
    float par = 1.0 / (1.0 + fl * 0.65);          // parallax: far layers move slower
    vec2 q = p * scale + vec2(fl * 17.31, fl * 3.17);
    q.x -= uScroll * par * scale;
    vec2 cell = floor(q);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        float cy = (c.y + 0.5 - fl * 3.17) / scale;          // approx screen y of the cell
        float density = 0.46 * exp(-pow((cy - 0.36) / 0.2, 2.0)) + 0.06;
        if (h21(c * 1.31 + fl * 7.0) > density) continue;
        vec2 rnd = h22(c + fl * 31.7);
        vec2 pos = c + 0.5 + (rnd - 0.5) * 0.9;
        vec3 lc = palette(h21(c + 7.7 + fl * 3.0));
        float sharpR = mix(0.035, 0.09, rnd.x);
        float bokehR = mix(0.32, 0.58, rnd.y) * (1.0 - fl * 0.08);
        float rad = mix(sharpR, bokehR, uFocus);
        vec2 d = q - pos;
        d.x *= mix(0.32, 1.0, uFocus);                       // motion streak when sharp
        float dist = length(d);
        float soft = mix(0.025, 0.06, uFocus);
        float disc = 1.0 - smoothstep(rad - soft, rad, dist);
        float rim = smoothstep(rad * 0.55, rad, dist) * disc * 0.45 * uFocus;
        float bright = mix(2.6, 0.22, uFocus) * mix(0.35, 1.0, rnd.y) * (1.0 - fl * 0.14);
        float flick = 0.88 + 0.12 * sin(uTime * (1.5 + rnd.x * 4.0) + rnd.y * 40.0);
        float glow = (1.0 - uFocus) * 0.004 / (dist * dist + 0.004);
        col += lc * ((disc + rim) * bright + glow * 0.35 * bright) * flick;
      }
    }
  }
  o = vec4(col, 1.0);
}`;

// ── Procedural overcast day, roadside scenery passing ───────────────────────
export const DAY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform float uTime, uAspect, uScroll;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec2 uv = vUv;
  float x = uv.x * uAspect;
  // overcast sky with soft cloud banks
  vec3 col = mix(vec3(0.72, 0.76, 0.80), vec3(0.30, 0.35, 0.42), smoothstep(0.45, 1.0, uv.y));
  col *= 0.8 + 0.35 * fbm(vec2(x * 1.3 - uScroll * 0.04, uv.y * 3.0));
  // distant tree line / roofs (slow parallax)
  float fx = x - uScroll * 0.35;
  float far = 0.42 + 0.11 * fbm(vec2(fx * 2.2, 1.7)) + 0.06 * step(0.62, vnoise(vec2(floor(fx * 5.0), 3.0)));
  if (uv.y < far) col = mix(vec3(0.08, 0.11, 0.09), vec3(0.20, 0.23, 0.24), fbm(vec2(x * 7.0 - uScroll * 2.5, uv.y * 7.0)));
  // roadside buildings / signs with some colour
  float bx = (x - uScroll * 0.7) * 2.2, bid = floor(bx), bf = fract(bx);
  float bh = 0.30 + 0.12 * hash(vec2(bid, 4.0));
  if (hash(vec2(bid, 5.0)) > 0.45 && bf > 0.12 && bf < 0.88 && uv.y > 0.27 && uv.y < bh) {
    vec3 c = vec3(0.12 + 0.55 * hash(vec2(bid, 1.0)), 0.15 + 0.35 * hash(vec2(bid, 2.0)), 0.2 + 0.55 * hash(vec2(bid, 3.0)));
    col = c * (0.7 + 0.3 * step(0.5, fract(uv.y * 30.0)));
  }
  // wet road reflecting the sky, lane marking
  if (uv.y < 0.27) col = mix(vec3(0.14, 0.15, 0.16), vec3(0.38, 0.41, 0.45), smoothstep(0.12, 0.27, uv.y) * 0.6);
  if (uv.y > 0.19 && uv.y < 0.205) col = mix(col, vec3(0.75), 0.55);
  // foreground verge (fast)
  if (uv.y < 0.11) col = mix(vec3(0.34, 0.15, 0.06), vec3(0.20, 0.09, 0.04), fbm(vec2(x * 9.0 - uScroll * 5.0, uv.y * 12.0)));
  // poles flicking past
  float pc = (x - uScroll * 1.4) * 0.7, pid = floor(pc);
  if (hash(vec2(pid, 9.0)) > 0.45 && abs(fract(pc) - 0.5) < 0.008 && uv.y > 0.11) col = vec3(0.07);
  o = vec4(col, 1.0);
}`;

// ── Image / webcam background (linearised, cover-fit) ───────────────────────
export const IMAGE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform float uAspect, uTexAspect, uMirror, uGain;
void main() {
  vec2 uv = vUv;
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  vec2 s = uTexAspect > uAspect ? vec2(uAspect / uTexAspect, 1.0) : vec2(1.0, uTexAspect / uAspect);
  uv = (uv - 0.5) * s + 0.5;
  vec3 c = texture(uTex, uv).rgb;
  o = vec4(pow(c, vec3(2.2)) * uGain, 1.0);
}`;

// ── Separable gaussian (9 taps via 5 linear fetches) ────────────────────────
export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec4 c = texture(uTex, vUv) * 0.2270270;
  c += (texture(uTex, vUv + uDir * 1.3846154) + texture(uTex, vUv - uDir * 1.3846154)) * 0.3162162;
  c += (texture(uTex, vUv + uDir * 3.2307692) + texture(uTex, vUv - uDir * 3.2307692)) * 0.0702703;
  o = c;
}`;

// ── Water field (metaballs) ─────────────────────────────────────────────────
// Every drop and streak adds a smooth kernel  k = (1 - x²)³  to ONE shared field.
// Water exists where the field exceeds the threshold. Because kernels add, two
// bodies that touch fuse into a single outline with a meniscus neck between them:
// they merge instead of overlapping. Channel G carries kernel × size so the
// composite knows how thick the water is locally.
// KD0 is chosen so a lone drop's outline (k = 0.3) sits exactly at its radius.
const KERNEL_GLSL = `
const float KD0 = 0.575;       // sqrt(1 - 0.3^(1/3))
const float KEXT = 1.78;       // kernel extent in outline units (about 1 / KD0, padded)
`;

export const DROP_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aA;   // x, y, r, angle
layout(location = 2) in vec4 aB;   // stretch, taper, seed, wobble
uniform vec2 uWorld;
uniform float uMinR;               // min radius in world units (sub-pixel guard)
${KERNEL_GLSL}
out vec2 vLocal;
flat out vec4 vB;
flat out float vR;
flat out vec2 vDown;               // world "down" in the drop's local frame (for gravity sag)
void main() {
  float r = max(aA.z, uMinR);
  vDown = vec2(sin(aA.w), cos(aA.w));
  float stretch = aB.x;
  float u = mix(-(1.0 + stretch) * KEXT, KEXT, aCorner.x * 0.5 + 0.5);
  float v = aCorner.y * KEXT;
  vLocal = vec2(u, v);
  float c = cos(aA.w), s = sin(aA.w);
  vec2 world = aA.xy + vec2(c * u - s * v, s * u + c * v) * r;
  vB = aB;
  vR = aA.z * (aA.z / r);          // tiny drops: keep footprint, reduce thickness
  gl_Position = vec4(world.x / uWorld.x * 2.0 - 1.0, 1.0 - world.y / uWorld.y * 2.0, 0.0, 1.0);
}`;

export const DROP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
flat in vec4 vB;
flat in float vR;
flat in vec2 vDown;
uniform float uTime, uMoveFlatten;
${KERNEL_GLSL}
out vec4 o;
void main() {
  float stretch = vB.x, taper = vB.y, seed = vB.z, wob = vB.w;
  // a sliding drop spreads and flattens into the head of its rivulet (it isn't a
  // round bead riding on a string); resting drops keep their full dome
  float thick = vR * (1.0 - uMoveFlatten * smoothstep(0.0, 0.6, wob));
  float u = vLocal.x;
  if (u < 0.0) u /= (1.0 + stretch);                    // tail stretched behind the head
  // tail narrows along a curve (rounded shoulders, slimmer tip), never a straight cone
  float tt = clamp(-u, 0.0, 1.0);
  float tw = 1.0 - taper * 0.45 * tt * tt;
  vec2 q = vec2(u, vLocal.y / max(tw, 0.2));            // |q| = 1 at the drop outline
  float a = atan(q.y, q.x);
  // gentle, low-frequency irregularity (contact line pinned on tiny defects): smooth
  // blobs rather than lobes or corners; slightly bigger for big drops
  float big = clamp(vR / 10.0, 0.4, 1.2);
  float irr = 1.0 + big * (0.035 * sin(2.0 * a + seed * 37.0) + 0.02 * sin(3.0 * a + seed * 91.0) + 0.008 * sin(5.0 * a + seed * 13.0))
            + wob * 0.05 * sin(3.0 * a + uTime * (9.0 + seed * 7.0) + seed * 13.0);
  // gravity sag: drops on a vertical window bulge a little on their lower side
  float qd = dot(q, vDown) / max(length(q), 1e-4);
  irr *= 1.0 - 0.07 * big * qd * (1.0 - taper);
  float x2 = dot(q, q) * irr * irr * KD0 * KD0;
  if (x2 >= 1.0) discard;
  float k = 1.0 - x2; k = k * k * k;
  // RGB add (field, field × thickness); A is MAX-blended: the thickest drop covering
  // this pixel, so a small drop overlapping a big one never thins it (no dents)
  o = vec4(k, k * thick, 0.0, thick * smoothstep(0.08, 0.3, k));
}`;

// ── Streak channels: same kernel, persistent, fading ────────────────────────
export const WET_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aA;   // x, y, head half-width (u), angle
layout(location = 2) in vec4 aB;   // length (head widths), thickness/width, tail/head width
uniform vec2 uWorld;
uniform float uScale;              // 1 for water channels; > 1 to wipe a wider path in the fog
${KERNEL_GLSL}
out vec2 vLocal;
flat out vec4 vP;
void main() {
  float len = aB.x / uScale, k = max(aB.z, 0.05), m = max(k, 1.0) * KEXT;
  float u = mix(-(len + m), KEXT, aCorner.x * 0.5 + 0.5);
  float v = aCorner.y * m;
  vLocal = vec2(u, v);
  vP = vec4(len, aB.y, k, aA.z);
  float c = cos(aA.w), s = sin(aA.w);
  vec2 world = aA.xy + vec2(c * u - s * v, s * u + c * v) * aA.z * uScale;
  gl_Position = vec4(world.x / uWorld.x * 2.0 - 1.0, 1.0 - world.y / uWorld.y * 2.0, 0.0, 1.0);
}`;

export const WET_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
flat in vec4 vP;          // x = length (head widths), y = thickness/width, z = tail/head width, w = head width (u)
${KERNEL_GLSL}
out vec4 o;
void main() {
  // tapered capsule: radius goes from k (tail, last frame) to 1 (head, now), so no steps
  float L = vP.x, k = vP.z;
  float t = L > 1e-4 ? clamp((vLocal.x + L) / L, 0.0, 1.0) : 1.0;
  float rad = mix(k, 1.0, t);
  float d = length(vec2(vLocal.x - (t - 1.0) * L, vLocal.y)) / rad;   // 1 = channel outline
  float x2 = d * d * KD0 * KD0;
  if (x2 >= 1.0) discard;
  float kk = 1.0 - x2; kk = kk * kk * kk;
  // MAX-blended: R = kernel (fades over time), G = local thickness scale (u)
  // G is thickness pre-multiplied by the kernel, so where streaks overlap it stays
  // continuous (a constant thickness here made hard steps where two streams crossed)
  o = vec4(kk, kk * rad * vP.w * vP.y, 0.0, 1.0);
}`;

// ── Fog clear map ───────────────────────────────────────────────────────────
// R = how wiped-clean the glass is (1 = clear). Sliding drops sweep a path through
// the condensation; resting drops keep a small dry ring (they absorb the mist next
// to them). The map fades back toward 0 as the glass mists over again.
export const CLEAR_SEG_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
flat in vec4 vP;
out vec4 o;
void main() {
  float L = vP.x, k = vP.z;
  float t = L > 1e-4 ? clamp((vLocal.x + L) / L, 0.0, 1.0) : 1.0;
  float rad = mix(k, 1.0, t);
  float d = length(vec2(vLocal.x - (t - 1.0) * L, vLocal.y)) / rad;
  float a = 1.0 - smoothstep(0.25, 1.35, d);
  if (a <= 0.0) discard;
  o = vec4(a, 0.0, 0.0, 1.0);
}`;

export const CLEAR_DROP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;            // outline units: |q| = 1 at the drop edge
flat in vec4 vB;
flat in float vR;
flat in vec2 vDown;
uniform float uHalo;
out vec4 o;
void main() {
  float d = length(vLocal);
  float a = (1.0 - smoothstep(0.7, 1.75, d)) * uHalo;
  if (a <= 0.0) discard;
  o = vec4(a, 0.0, 0.0, 1.0);
}`;

export const FADE_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
uniform vec4 uFade4;
void main() { o = uFade4; }`;

// ── Final composite: one water surface, shaded as one body ──────────────────
export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uWater, uWet, uSharp, uBlur, uClear;
uniform vec2 uTexel, uWorldInv, uClearTexel;
uniform float uFogDensity, uFogSpread, uFogLift, uFogEdge;
uniform float uTexelWorld, uThresh, uDropHeight, uNormalStrength;
uniform float uDropSharp;
uniform float uLensZoom, uTrailLens, uTrailSharp, uEdgeDark, uFresnel, uSpec, uShininess, uShimmer;
uniform float uExposure, uVignette, uGrain, uFog, uTime, uAspect, uBreakup, uBreakupScale;
uniform vec3 uGlassTint;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// x = total field, y = local water thickness, z = the drops' share of the field.
// Thickness is the MAX of the bodies present (thickest drop, or the streak), not an
// average: averaging made a thin drop overlapping a thick rivulet sink the surface
// (a dent) even though water was being added. With max, adding water only raises it.
vec3 field(vec2 uv) {
  vec4 d = texture(uWater, uv);
  vec2 t = texture(uWet, uv).rg;
  float n = vnoise(uv * vec2(uAspect, 1.0) * uBreakupScale);
  float bk = mix(1.0, 0.25 + 1.1 * n, uBreakup);             // thinning streaks pinch into beads
  float tr = t.r * bk;
  float St = t.g / max(t.r, 1e-4);                           // streak thickness
  float Sb = St * smoothstep(0.02, 0.1, tr);
  float kS = 0.45 * max(d.a, Sb) + 1e-3;                     // blend width ∝ thickness
  float hS = clamp(1.0 - abs(d.a - Sb) / kS, 0.0, 1.0);
  float S = max(d.a, Sb) + hS * hS * kS * 0.25;              // smooth max: no crease where head meets stream
  return vec3(d.r + tr, S, d.r);
}
// Water surface height (u). The kernel k = (1 - ρ²·KD0²)³ is inverted to recover ρ,
// the distance from the centre in outline units, and the surface is a spherical cap
// √(1 - ρ²): curved across the whole width like real water, so every part of a
// drop or rivulet bends light. Where bodies overlap the field exceeds 1; instead of
// clipping that (which flattened big drops into plateaus) the dome keeps rising
// smoothly, so merged water stays one rounded body with a curved top.
float height(vec3 f) {
  float S = f.y;
  float rho2 = (1.0 - pow(max(f.x, 0.0), 1.0 / 3.0)) / (0.575 * 0.575);
  rho2 = max(rho2, -1.2);                                   // soft limit on stacked water
  return S * uDropHeight * sqrt(max(1.0 - rho2, 0.0));
}

void main() {
  vec3 fc = field(vUv);
  float hL = height(field(vUv - vec2(uTexel.x, 0.0)));
  float hR = height(field(vUv + vec2(uTexel.x, 0.0)));
  float hD = height(field(vUv - vec2(0.0, uTexel.y)));
  float hU = height(field(vUv + vec2(0.0, uTexel.y)));
  vec2 grad = vec2(hR - hL, hU - hD) / (2.0 * uTexelWorld);
  vec3 n = normalize(vec3(-grad * uNormalStrength, 1.0));
  // anti-aliased outline: the transition is ~1.5 screen pixels wide whatever the
  // water-map resolution, so edges (and the dark contact line) never stair-step
  float fw = max(fwidth(fc.x), 1e-4);
  float mask = smoothstep(uThresh - fw * 0.75, uThresh + fw * 0.75, fc.x);

  vec3 blur = texture(uBlur, vUv).rgb;
  vec3 glass = blur * uGlassTint;
  glass += vec3(0.6, 0.65, 0.7) * uFog * (0.6 + 0.4 * hash(floor(vUv * 900.0)));   // faint haze

  // condensation fog: micro-droplets scatter light, so the view is softer, flatter,
  // lighter and speckled. Sliding drops wipe it away; the edges of each wipe hold
  // slightly denser fog where the condensation was pushed aside.
  float clr = clamp(texture(uClear, vUv).r, 0.0, 1.0);
  float fogA = uFogDensity * (1.0 - clr);
  vec2 fsp = vec2(uFogSpread / uAspect, uFogSpread);
  vec3 b2 = (texture(uBlur, vUv + vec2(fsp.x, 0.0)).rgb + texture(uBlur, vUv - vec2(fsp.x, 0.0)).rgb
           + texture(uBlur, vUv + vec2(0.0, fsp.y)).rgb + texture(uBlur, vUv - vec2(0.0, fsp.y)).rgb) * 0.25;
  float lum = dot(b2, vec3(0.299, 0.587, 0.114));
  vec3 fogged = mix(b2, vec3(lum), 0.35) * 0.82 + lum * 0.22 + uFogLift;
  float speck = hash(floor(vUv * vec2(uAspect, 1.0) * 720.0));
  fogged *= 0.92 + 0.14 * speck;
  glass = mix(glass, fogged, fogA);
  vec2 cg = vec2(texture(uClear, vUv + vec2(uClearTexel.x, 0.0)).r - texture(uClear, vUv - vec2(uClearTexel.x, 0.0)).r,
                 texture(uClear, vUv + vec2(0.0, uClearTexel.y)).r - texture(uClear, vUv - vec2(0.0, uClearTexel.y)).r);
  glass += vec3(lum * 0.6 + 0.02) * clamp(length(cg) * uFogEdge, 0.0, 1.0) * uFogDensity * (1.0 - clr * 0.5);

  // Every body of water is a lens: n.xy is roughly the offset from its centre / its
  // size, so sampling against normal × size gives an inverted, minified view.
  // Merged bodies share one surface, so they show one image, not two.
  float S = fc.y;
  float wD = clamp(fc.z / max(fc.x, 1e-4), 0.0, 1.0);
  float zoom = mix(uTrailLens, uLensZoom, wD);
  // fisheye: the offset grows with the tangent of the surface slope, so the image
  // bends strongly toward the rim and straight lines (the horizon) curve with the
  // dome, as through a real ball lens, instead of cutting across like a level line
  float sl2 = dot(n.xy, n.xy);
  vec2 bend = n.xy * (1.0 + 2.5 * sl2) / max(n.z, 0.35);
  vec2 suv = vUv - bend * S * uWorldInv * zoom * 0.5;
  float edge = clamp(1.0 - n.z, 0.0, 1.0);
  float sharpness = mix(uTrailSharp, uDropSharp, wD);        // a tiny lens is never perfectly sharp
  vec3 water = mix(texture(uBlur, suv).rgb, texture(uSharp, suv).rgb, sharpness * (1.0 - 0.3 * edge));
  // clear water keeps the image punchy: a little extra contrast vs. the hazy glass
  float wl = dot(water, vec3(0.299, 0.587, 0.114));
  water = max(mix(vec3(wl), water, 1.08) + (water - vec3(wl * 0.9)) * 0.06, 0.0);

  // steep rim: total internal reflection makes a dark band, strongest on the lower side
  float down = clamp(0.45 - n.y * 1.6, 0.0, 1.0);
  water *= 1.0 - uEdgeDark * smoothstep(0.1, 0.55, edge) * mix(0.25, 1.35, down);

  // GLOSS. Wet water looks glossy (not satin) because its reflections are mirror-sharp:
  // 1) Fresnel mirror reflection (Schlick, water F0 ≈ 0.02) of the environment — the
  //    bright sky above, the dark car interior below — strengthening toward the rim;
  // 2) a crisp, hard-edged glint of the brightest light (a window/sky patch), not a
  //    soft Blinn lobe (broad soft lobes are exactly what reads as matte).
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 Rf = reflect(-V, n);
  float F = 0.02 + 0.98 * pow(1.0 - clamp(n.z, 0.0, 1.0), 5.0);
  vec3 skyCol = texture(uBlur, vec2(0.5, 0.92)).rgb * 1.6 + 0.04;   // what's above, from the scene
  vec3 env = mix(vec3(0.015, 0.016, 0.02), skyCol, smoothstep(-0.15, 0.45, Rf.y));
  water = mix(water, env, F * uFresnel);
  vec3 Lk = normalize(vec3(-0.35, 0.6, 0.72));
  float cosR = dot(Rf, Lk);
  float glint = smoothstep(0.962, 0.972, cosR);               // sharp-edged highlight
  float halo = pow(max(cosR, 0.0), uShininess) * 0.25;        // tiny bloom around it
  vec3 H2 = normalize(normalize(vec3(0.3, -0.7, 0.65)) + V);
  float sp2 = smoothstep(0.985, 0.992, dot(n, H2)) * 0.18;    // small warm kick from below
  // treble shimmer: glints flicker smoothly (a blocky per-pixel hash broke them into squares)
  float sparkle = 1.0 + uShimmer * (vnoise(vUv * vec2(uAspect, 1.0) * 90.0 + uTime * 9.0) - 0.4) * 1.6;
  water += vec3(1.0, 0.98, 0.94) * (glint * 1.6 + halo) * uSpec * sparkle + vec3(1.0, 0.65, 0.35) * sp2;

  vec3 col = mix(glass, water, mask);
  float rim = mask * (1.0 - mask) * 4.0;                     // thin contact line
  col *= 1.0 - 0.35 * rim;

  col = 1.0 - exp(-col * uExposure);                          // filmic-ish tone map
  vec2 vc = vUv - 0.5;
  col *= 1.0 - uVignette * dot(vc, vc) * 1.6;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (hash(vUv * 1013.0 + fract(uTime * 7.31) * 91.0) - 0.5) * uGrain;
  o = vec4(col, 1.0);
}`;
