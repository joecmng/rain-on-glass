// Builds surface maps off the main thread (see fieldcore.js). One message in, one out:
//   in  { id, px (ArrayBuffer RGBA), mw, mh, lw, lh, sx, opts }
//   out { id, core } or { id, error }
import { buildCore, coreBuffers } from './fieldcore.js';

self.onmessage = (e) => {
  const { id, px, ...rest } = e.data;
  try {
    const core = buildCore({ px: new Uint8ClampedArray(px), ...rest });
    self.postMessage({ id, core }, coreBuffers(core));
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
