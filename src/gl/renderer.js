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
    };
    this.emptyVao = gl.createVertexArray();
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.dropBuf = gl.createBuffer();
    this.wetBuf = gl.createBuffer();
    this.dropVao = this._instVao(this.dropBuf);
    this.wetVao = this._instVao(this.wetBuf);
    this.dropBufSize = 0; this.wetBufSize = 0;

    this.bgMode = 'city';
    this.bgTex = gl.createTexture();
    this.bgTexAspect = 1; this.bgSource = null; this.bgMirror = false; this.bgReady = false;
    this.scroll = 0;
    this.T = {};
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
    this.T = {
      water: createTarget(gl, ww, wh),
      wet: createTarget(gl, ww, wh),
      clear: createTarget(gl, ww * 0.5, wh * 0.5),
      wetS: createTarget(gl, ww, wh),      // smoothed copy of the streak field (for shading only)
      wetTmp: createTarget(gl, ww, wh),
      waterS: createTarget(gl, ww, wh),    // smoothed copy of the drop field (for shading only)
      sharp: createTarget(gl, bw, bh),
      blurA: createTarget(gl, bw * 0.5, bh * 0.5),
      blurB: createTarget(gl, bw * 0.5, bh * 0.5),
    };
  }

  // source: HTMLImageElement | HTMLVideoElement | null (city)
  setBackground(mode, source = null, mirror = false) {
    this.bgMode = mode; this.bgSource = source; this.bgMirror = mirror; this.bgReady = false;
    if (source instanceof HTMLImageElement) this._upload(source);
  }

  _upload(src) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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

  _background(time) {
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
      for (let i = 0; i < CONFIG.background.imageBlurPasses; i++) this._blur(T.blurA, T.blurB, 1 + i * 1.5);
      return;
    }
    const useImage = this.bgMode !== 'city' && this.bgSource;
    if (useImage && this.bgSource instanceof HTMLVideoElement && this.bgSource.readyState >= 2) this._upload(this.bgSource);
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
      for (let i = 0; i < CONFIG.background.imageBlurPasses; i++) this._blur(T.blurA, T.blurB, 1 + i * 1.5);
    } else {
      const P = this.P.city;
      gl.useProgram(P.p);
      gl.uniform1f(P.u.uTime, time);
      gl.uniform1f(P.u.uAspect, this.aspect);
      gl.uniform1f(P.u.uScroll, this.scroll);
      gl.uniform1f(P.u.uFocus, 0); this._target(T.sharp); this._fullscreen();
      gl.uniform1f(P.u.uFocus, 1); this._target(T.blurA); this._fullscreen();
      this._blur(T.blurA, T.blurB, 1.2);
    }
  }

  render(sim, dt, time, F, settings) {
    const gl = this.gl, T = this.T;
    // background scroll follows car speed & wind direction (scene passes rearward)
    // scenery passes rearward at the car's speed: the horizontal part of the airflow direction
    this.scroll += dt * settings.speed * Math.sin(settings.windAngle * Math.PI / 180) * CONFIG.background.scrollSpeed;
    this._background(time);

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
    gl.uniform1f(u.uEdgeDark, R.edgeDark);
    gl.uniform1f(u.uFresnel, R.fresnel);
    gl.uniform1f(u.uSpec, R.spec);
    gl.uniform1f(u.uShininess, R.shininess);
    gl.uniform1f(u.uShimmer, F.shimmer ?? 0);
    gl.uniform1f(u.uExposure, R.exposure);
    gl.uniform1f(u.uVignette, R.vignette);
    gl.uniform1f(u.uGrain, R.grain);
    gl.uniform1f(u.uFog, R.fog);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uAspect, this.aspect);
    gl.uniform1f(u.uBreakup, style.breakup);
    gl.uniform1f(u.uBreakupScale, style.breakupScale);
    gl.uniform3fv(u.uGlassTint, R.glassTint);
    gl.uniform2f(u.uClearTexel, 1.5 / T.clear.w, 1.5 / T.clear.h);
    gl.uniform1f(u.uFogDensity, settings.fog ?? CONFIG.defaults.fog);
    gl.uniform1f(u.uFogSpread, CONFIG.fog.spread);
    gl.uniform1f(u.uFogLift, CONFIG.fog.lift);
    gl.uniform1f(u.uFogEdge, CONFIG.fog.edge);
    this._fullscreen();
  }
}
