import { CONFIG } from '../config.js';
import * as SH from './shaders.js';
import { createProgram, createTarget, deleteTarget } from './glutil.js';
import { FLOATS_PER_INSTANCE } from '../sim/drops.js';

const R = CONFIG.render;

// Passes per frame:
//  1. background  → sharp (what drops see) + blurred (what the glass shows)
//  2. water map   → instanced drop splats, additive (height + lens offset)
//  3. wet film    → fade, then MAX-blend thin trail splats
//  4. composite   → refraction, edge darkening, specular, tone map
export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not supported (needed for the water map).');
    this.gl = gl;
    this.canvas = canvas;
    this.P = {
      city: createProgram(gl, SH.FULLSCREEN_VS, SH.CITY_FS, 'city'),
      day: createProgram(gl, SH.FULLSCREEN_VS, SH.DAY_FS, 'day'),
      image: createProgram(gl, SH.FULLSCREEN_VS, SH.IMAGE_FS, 'image'),
      blur: createProgram(gl, SH.FULLSCREEN_VS, SH.BLUR_FS, 'blur'),
      drops: createProgram(gl, SH.DROP_VS, SH.DROP_FS, 'drops'),
      wet: createProgram(gl, SH.WET_VS, SH.WET_FS, 'wet'),
      fade: createProgram(gl, SH.FULLSCREEN_VS, SH.FADE_FS, 'fade'),
      clearSeg: createProgram(gl, SH.WET_VS, SH.CLEAR_SEG_FS, 'clearSeg'),
      clearDrop: createProgram(gl, SH.DROP_VS, SH.CLEAR_DROP_FS, 'clearDrop'),
      comp: createProgram(gl, SH.FULLSCREEN_VS, SH.COMPOSITE_FS, 'composite'),
      logoWater: createProgram(gl, SH.FULLSCREEN_VS, SH.LOGO_WATER_FS, 'logoWater'),
      logoClear: createProgram(gl, SH.FULLSCREEN_VS, SH.LOGO_CLEAR_FS, 'logoClear'),
    };
    this.emptyVao = gl.createVertexArray();
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.dropBuf = gl.createBuffer();
    this.inkBuf = gl.createBuffer(); this.inkBufSize = 0;
    this.ink = null;                 // { data, count }: strokes being drawn, as droplets
    this.wetBuf = gl.createBuffer();
    this.dropVao = this._instVao(this.dropBuf);
    this.wetVao = this._instVao(this.wetBuf);
    this.inkVao = this._instVao(this.inkBuf);
    this.dropBufSize = 0; this.wetBufSize = 0;

    this.bgMode = 'city';
    this.bgTex = gl.createTexture();
    this.bgTexAspect = 1; this.bgSource = null; this.bgMirror = false; this.bgReady = false;
    this.scroll = 0;
    this.T = {};
    // Optional logo layer, filled in by the app each frame:
    //   canvas  mask (alpha = logo), version  bump to re-upload,
    //   rect    [x, y, w, h] screen fractions from the top-left,  frost  0..1
    //   sdf     { data: Float32Array (RGBA per cell: distance, piece, height in piece), w, h, version,
    //             map: [sx, sy, ox, oy] }
    //   dry, raise, bevel, gloss, depth   mode amounts (see COMPOSITE_FS)
    //   water   { amount, profile, thick, weight, cell, swell, bulge, fills } logo made of water
    this.logoLayer = { canvas: null, version: 0, rect: [0, 0, 1, 1], frost: 0, dry: 0, raise: 0, bevel: 7, gloss: 1, depth: 1, sdf: null, water: null };
    this.logoTex = gl.createTexture(); this.logoTexVersion = -1;
    this.logoSdfTex = gl.createTexture(); this.logoSdfVersion = -1;
    // a 1x1 placeholder so the sampler is always valid
    gl.bindTexture(gl.TEXTURE_2D, this.logoSdfTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([1e3, -1, 0, 0]));
  }

  _instVao(buf) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const stride = FLOATS_PER_INSTANCE * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  resize(cssW, cssH, quality) {
    const gl = this.gl, q = CONFIG.quality[quality];
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDevicePixelRatio);
    const w = Math.max(16, Math.round(cssW * dpr * q.renderScale));
    const h = Math.max(16, Math.round(cssH * dpr * q.renderScale));
    this.canvas.width = w; this.canvas.height = h;
    this.width = w; this.height = h; this.aspect = w / h;
    for (const k in this.T) deleteTarget(gl, this.T[k]);
    const ww = w * q.waterScale, wh = h * q.waterScale;
    const bw = w * q.bgScale, bh = h * q.bgScale;
    const sw = w * (q.sharpScale ?? q.bgScale), sh = h * (q.sharpScale ?? q.bgScale);
    this.T = {
      water: createTarget(gl, ww, wh),
      wet: createTarget(gl, ww, wh),
      clear: createTarget(gl, ww * 0.5, wh * 0.5),
      wetS: createTarget(gl, ww, wh),      // smoothed copy of the streak field (for shading only)
      wetTmp: createTarget(gl, ww, wh),
      waterS: createTarget(gl, ww, wh),    // smoothed copy of the drop field (for shading only)
      sharp: createTarget(gl, sw, sh),     // in-focus background, up to full resolution
      blurA: createTarget(gl, bw * 0.5, bh * 0.5),
      blurB: createTarget(gl, bw * 0.5, bh * 0.5),
    };
  }

  _logoWaterOn() { const L = this.logoLayer; return !!(L.sdf && L.water && L.water.amount > 0.001); }

  // Fullscreen pass that turns the logo's distance map into water (or fog clearing).
  _logoPass(P, water) {
    const gl = this.gl, L = this.logoLayer, W = L.water;
    this._uploadLogoSdf();
    gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.logoSdfTex); gl.uniform1i(P.u.uLogoSdf, 0);
    gl.uniform4f(P.u.uLogoRect, L.rect[0], L.rect[1], L.rect[2], L.rect[3]);
    gl.uniform4f(P.u.uLogoSdfMap, L.sdf.map[0], L.sdf.map[1], L.sdf.map[2], L.sdf.map[3]);
    gl.uniform1f(P.u.uCellWorld, W.cell);
    gl.uniform1f(P.u.uWeight, W.weight);
    gl.uniform1f(P.u.uAmount, water ? W.amount : W.amount * W.clearFog);
    if (water) {
      gl.uniform1f(P.u.uProfile, W.profile); gl.uniform1f(P.u.uThick, W.thick);
      gl.uniform1f(P.u.uSwell, W.swell); gl.uniform1f(P.u.uBulge, W.bulge);
      gl.uniform1fv(P.u.uFill, W.fills);
    }
    this._fullscreen();
  }

  _uploadLogoSdf() {
    const gl = this.gl, LL = this.logoLayer;
    if (!LL.sdf || LL.sdf.version === this.logoSdfVersion) return;
    gl.bindTexture(gl.TEXTURE_2D, this.logoSdfTex);
    // per mask-grid cell, as 16-bit floats (filterable): signed distance, piece, height in
    // piece, rounded distance (for the water's surface)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, LL.sdf.w, LL.sdf.h, 0, gl.RGBA, gl.FLOAT, LL.sdf.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.logoSdfVersion = LL.sdf.version;
  }

  // source: HTMLImageElement | HTMLVideoElement | null (city)
  setBackground(mode, source = null, mirror = false) {
    this.bgMode = mode; this.bgSource = source; this.bgMirror = mirror; this.bgReady = false;
    if (source instanceof HTMLImageElement) this._upload(source, true);
  }

  // Photos get mipmaps: a big (e.g. 3840 px) photo shown smaller then stays smooth instead
  // of shimmering. Video frames change every frame, so they don't.
  _upload(src, mipmaps = false) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    this.bgTexAspect = w / Math.max(1, h);
    this.bgReady = true;
  }

  _target(t) {
    const gl = this.gl;
    if (t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, t.w, t.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.width, this.height); }
  }

  _fullscreen() { this.gl.bindVertexArray(this.emptyVao); this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }

  // non-destructive separable blur: src → tmp → dst
  _blurTo(src, tmp, dst, radius) {
    const gl = this.gl, P = this.P.blur;
    gl.useProgram(P.p);
    gl.uniform1i(P.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    this._target(tmp); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(P.u.uDir, radius / src.w, 0); this._fullscreen();
    this._target(dst); gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
    gl.uniform2f(P.u.uDir, 0, radius / tmp.h); this._fullscreen();
  }

  _blur(src, tmp, radius) {
    const gl = this.gl, P = this.P.blur;
    gl.useProgram(P.p);
    gl.uniform1i(P.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    this._target(tmp); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(P.u.uDir, radius / src.w, 0); this._fullscreen();
    this._target(src); gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
    gl.uniform2f(P.u.uDir, 0, radius / tmp.h); this._fullscreen();
  }

  _background(time, bokeh = 1) {
    const gl = this.gl, T = this.T;
    gl.disable(gl.BLEND);
    if (this.bgMode === 'day') {
      const P = this.P.day;
      gl.useProgram(P.p);
      gl.uniform1f(P.u.uTime, time);
      gl.uniform1f(P.u.uAspect, this.aspect);
      gl.uniform1f(P.u.uScroll, this.scroll);
      this._target(T.sharp); this._fullscreen();
      this._target(T.blurA); this._fullscreen();
      for (let i = 0; i < CONFIG.background.imageBlurPasses; i++) { if (bokeh > 0.02) this._blur(T.blurA, T.blurB, (1 + i * 1.5) * bokeh); }
      return;
    }
    const useImage = this.bgMode !== 'city' && this.bgSource;
    if (useImage && this.bgSource instanceof HTMLVideoElement && this.bgSource.readyState >= 2) this._upload(this.bgSource);
    if (useImage && !this.bgReady) {
      // still loading: plain dark glass rather than the generated city
      for (const t of [T.sharp, T.blurA]) { this._target(t); gl.clearColor(0.012, 0.013, 0.016, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      return;
    }
    if (useImage && this.bgReady) {
      const P = this.P.image;
      gl.useProgram(P.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      gl.uniform1i(P.u.uTex, 0);
      gl.uniform1f(P.u.uAspect, this.aspect);
      gl.uniform1f(P.u.uTexAspect, this.bgTexAspect);
      gl.uniform1f(P.u.uMirror, this.bgMirror ? 1 : 0);
      gl.uniform1f(P.u.uGain, 1.0);
      this._target(T.sharp); this._fullscreen();
      this._target(T.blurA); this._fullscreen();
      for (let i = 0; i < CONFIG.background.imageBlurPasses; i++) { if (bokeh > 0.02) this._blur(T.blurA, T.blurB, (1 + i * 1.5) * bokeh); }
    } else {
      const P = this.P.city;
      gl.useProgram(P.p);
      gl.uniform1f(P.u.uTime, time);
      gl.uniform1f(P.u.uAspect, this.aspect);
      gl.uniform1f(P.u.uScroll, this.scroll);
      gl.uniform1f(P.u.uFocus, 0); this._target(T.sharp); this._fullscreen();
      // Bokeh slider: how defocused the street is (0 = crisp lights, 1 = default, 1.5 = dreamy)
      gl.uniform1f(P.u.uFocus, Math.max(0.04, bokeh)); this._target(T.blurA); this._fullscreen();
      this._blur(T.blurA, T.blurB, 0.4 + 0.8 * bokeh);
    }
  }

  render(sim, dt, time, F, settings) {
    const gl = this.gl, T = this.T;
    // background scroll follows car speed & wind direction (scene passes rearward)
    // scenery passes rearward at the car's speed: the horizontal part of the airflow direction
    this.scroll += dt * settings.speed * Math.sin(settings.windAngle * Math.PI / 180) * CONFIG.background.scrollSpeed;
    this._background(time, settings.bokeh ?? CONFIG.defaults.bokeh);

    // upload instances
    const n = sim.instanceCount, wn = sim.wetCount;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dropBuf);
    if (this.dropBufSize < sim.instances.byteLength) { gl.bufferData(gl.ARRAY_BUFFER, sim.instances.byteLength, gl.DYNAMIC_DRAW); this.dropBufSize = sim.instances.byteLength; }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.instances, 0, n * FLOATS_PER_INSTANCE);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.wetBuf);
    if (this.wetBufSize < sim.wet.byteLength) { gl.bufferData(gl.ARRAY_BUFFER, sim.wet.byteLength, gl.DYNAMIC_DRAW); this.wetBufSize = sim.wet.byteLength; }
    if (wn) gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.wet, 0, wn * FLOATS_PER_INSTANCE);

    // water map
    this._target(T.water);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendEquationSeparate(gl.FUNC_ADD, gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    let P = this.P.drops;
    gl.useProgram(P.p);
    gl.uniform2f(P.u.uWorld, sim.W, sim.H);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1f(P.u.uMinR, R.minSplatPx * sim.H / T.water.h);
    gl.uniform1f(P.u.uMoveFlatten, R.moveFlatten);
    gl.bindVertexArray(this.dropVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    if (this.ink && this.ink.count) {
      // a stroke still being drawn: shown at once as overlapping droplets (same program)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.inkBuf);
      const bytes = this.ink.count * FLOATS_PER_INSTANCE * 4;
      if (this.inkBufSize < bytes) { gl.bufferData(gl.ARRAY_BUFFER, this.ink.data.byteLength, gl.DYNAMIC_DRAW); this.inkBufSize = this.ink.data.byteLength; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.ink.data, 0, this.ink.count * FLOATS_PER_INSTANCE);
      gl.bindVertexArray(this.inkVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.ink.count);
    }
    if (this._logoWaterOn()) this._logoPass(this.P.logoWater, true);   // same blending as the drops
    gl.blendEquation(gl.FUNC_ADD);

    // wet film: fade then paint
    this._target(T.wet);
    P = this.P.fade;
    gl.useProgram(P.p);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    const style = CONFIG.streakStyles[settings.streakStyle] || CONFIG.streakStyles[CONFIG.defaultStreakStyle];
    // footprint (R) fades with style.fade; thickness (G) also thins with age, so a
    // stream is fullest right behind its head and tapers back toward the tail
    const fR = Math.exp(-dt / style.fade), fG = fR * Math.exp(-dt * (style.thinning ?? 0));
    gl.uniform4f(P.u.uFade4, fR, fG, fR, fR);
    this._fullscreen();
    if (wn) {
      P = this.P.wet;
      gl.useProgram(P.p);
      gl.blendEquation(gl.MAX);
      gl.uniform2f(P.u.uWorld, sim.W, sim.H);
      gl.uniform1f(P.u.uScale, 1);
      gl.bindVertexArray(this.wetVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, wn);
      gl.blendEquation(gl.FUNC_ADD);
    }

    // fog clear map: mist creeps back, sliding drops wipe paths, resting drops keep dry rings
    const FOG = CONFIG.fog;
    this._target(T.clear);
    P = this.P.fade;
    gl.useProgram(P.p);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
    { const f = Math.exp(-dt / FOG.regrow); gl.uniform4f(P.u.uFade4, f, f, f, f); }
    this._fullscreen();
    gl.blendEquation(gl.MAX);
    if (wn) {
      P = this.P.clearSeg;
      gl.useProgram(P.p);
      gl.uniform2f(P.u.uWorld, sim.W, sim.H);
      gl.uniform1f(P.u.uScale, FOG.wipeWidth / style.width);
      gl.bindVertexArray(this.wetVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, wn);
    }
    P = this.P.clearDrop;
    gl.useProgram(P.p);
    gl.uniform2f(P.u.uWorld, sim.W, sim.H);
    gl.uniform1f(P.u.uTime, time);
    gl.uniform1f(P.u.uMinR, 0);
    gl.uniform1f(P.u.uHalo, FOG.halo);
    gl.bindVertexArray(this.dropVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sim.n);   // drops only, not mist
    if (this._logoWaterOn()) this._logoPass(this.P.logoClear, false);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);

    // Streaks are stored as a MAX-union (so a stream doesn't pile up on itself), which
    // leaves a sharp crease wherever two streams cross. Shading reads a lightly blurred
    // copy: creases round into smooth fillets and crossing streams join seamlessly.
    this._blurTo(T.wet, T.wetTmp, T.wetS, CONFIG.render.streakSmooth);
    // a touch of smoothing on the drop field too, so where a drop's thick body meets its
    // thinner streak the surface blends instead of forming a ridge the lens magnifies
    if (CONFIG.render.dropSmooth > 0) this._blurTo(T.water, T.wetTmp, T.waterS, CONFIG.render.dropSmooth);

    // composite
    this._target(null);
    P = this.P.comp;
    gl.useProgram(P.p);
    const bind = (unit, t, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(P.u[name], unit); };
    bind(0, CONFIG.render.dropSmooth > 0 ? T.waterS : T.water, 'uWater'); bind(1, T.wetS, 'uWet'); bind(2, T.sharp, 'uSharp'); bind(3, T.blurA, 'uBlur'); bind(4, T.clear, 'uClear');
    const u = P.u;
    // logo layer (mask uploaded only when it changes)
    const LL = this.logoLayer, frost = LL.canvas ? LL.frost : 0;
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.logoTex); gl.uniform1i(u.uLogo, 5);
    if (LL.canvas && LL.version !== this.logoTexVersion) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, LL.canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.logoTexVersion = LL.version;
    }
    gl.uniform4f(u.uLogoRect, LL.rect[0], LL.rect[1], LL.rect[2], LL.rect[3]);
    gl.uniform1f(u.uLogoFrost, frost);
    gl.uniform1f(u.uLogoDry, LL.canvas ? LL.dry : 0);
    gl.uniform1f(u.uLogoRaise, LL.canvas && LL.sdf ? LL.raise : 0);
    gl.uniform1f(u.uLogoBevel, LL.bevel); gl.uniform1f(u.uLogoGloss, LL.gloss); gl.uniform1f(u.uLogoDepth, LL.depth);
    gl.activeTexture(gl.TEXTURE6);
    this._uploadLogoSdf();
    gl.bindTexture(gl.TEXTURE_2D, this.logoSdfTex); gl.uniform1i(u.uLogoSdf, 6);
    if (LL.sdf) gl.uniform4f(u.uLogoSdfMap, LL.sdf.map[0], LL.sdf.map[1], LL.sdf.map[2], LL.sdf.map[3]);
    gl.uniform2f(u.uTexel, 1 / T.water.w, 1 / T.water.h);
    gl.uniform2f(u.uWorldInv, 1 / sim.W, 1 / sim.H);
    gl.uniform1f(u.uTexelWorld, sim.H / T.water.h);
    gl.uniform1f(u.uThresh, R.thresh);
    gl.uniform1f(u.uDropHeight, R.dropHeight);
    gl.uniform1f(u.uNormalStrength, R.normalStrength);
    gl.uniform1f(u.uLensZoom, R.lensZoom);
    gl.uniform1f(u.uTrailLens, style.lens);
    gl.uniform1f(u.uTrailSharp, style.sharp);
    gl.uniform1f(u.uDropSharp, R.dropSharp);
    gl.uniform1f(u.uTinyMin, R.tinyMin);
    gl.uniform1f(u.uTinyMax, R.tinyMax);
    gl.uniform1f(u.uTinyContrast, R.tinyContrast);
    gl.uniform1f(u.uEdgeDark, R.edgeDark);
    gl.uniform1f(u.uFresnel, R.fresnel);
    gl.uniform1f(u.uSpec, R.spec);
    gl.uniform1f(u.uShininess, R.shininess);
    gl.uniform1f(u.uShimmer, F.shimmer ?? 0);
    gl.uniform1f(u.uExposure, R.exposure);
    gl.uniform1f(u.uVignette, R.vignette);
    gl.uniform1f(u.uGrain, R.grain * (settings.grain ?? CONFIG.defaults.grain));
    gl.uniform1f(u.uFog, R.fog);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uAspect, this.aspect);
    gl.uniform1f(u.uBreakup, style.breakup);
    gl.uniform1f(u.uBreakupScale, style.breakupScale);
    gl.uniform3fv(u.uGlassTint, R.glassTint);
    gl.uniform2f(u.uClearTexel, 1.5 / T.clear.w, 1.5 / T.clear.h);
    gl.uniform1f(u.uFogDensity, settings.fog ?? CONFIG.defaults.fog);
    // how out of focus the view through the glass is: Bokeh 0 = the full-resolution picture,
    // rising to fully blurred by Bokeh ~0.8
    { const b = settings.bokeh ?? CONFIG.defaults.bokeh, t = Math.min(1, Math.max(0, b / 0.8));
      gl.uniform1f(u.uDefocus, t * t * (3 - 2 * t)); }
    gl.uniform1f(u.uFogSpread, CONFIG.fog.spread);
    gl.uniform1f(u.uFogLift, CONFIG.fog.lift);
    gl.uniform1f(u.uFogEdge, CONFIG.fog.edge);
    this._fullscreen();
  }
}
