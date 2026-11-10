// Logo file loading.
//
// Every format becomes a "source" with the same small interface:
//   { name, kind, vector, aspect, pages, page, render(longSidePx) → <canvas>, setPage(n) }
// render() draws the logo onto a transparent canvas whose longer side is longSidePx.
// Vector sources (SVG, PDF, AI) genuinely re-render at the requested size, so the logo
// stays crisp when it's scaled up; raster sources are simply resampled.
//
// Formats:
//   PNG / JPG / WebP / GIF   decoded by the browser (GIF: its first frame)
//   SVG                      drawn by the browser at the requested size
//   PDF                      page rendered by pdf.js (lazy-loaded only when needed)
//   AI                       Illustrator files saved with "PDF compatibility" are PDFs
//                            inside, so they go through pdf.js too
//   EPS                      not converted (would need Ghostscript: ~15–20 MB and AGPL);
//                            a clear message suggests exporting as SVG or PDF instead

export class LogoError extends Error {}

const MAX_PX = 4096;   // never rasterise beyond this (memory)

const extOf = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
const sizeFor = (aspect, longSide) => {
  const L = Math.min(MAX_PX, Math.max(16, Math.round(longSide)));
  return aspect >= 1 ? [L, L / aspect] : [L * aspect, L];
};

// Load an <img> from a URL. Uses load/error events rather than img.decode(), which some
// browsers leave pending for images that aren't on the page (seen in background tabs).
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
}

async function startsWith(file, text) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const s = String.fromCharCode(...head);
  return s.includes(text);
}

// ── raster ─────────────────────────────────────────────────────────────────
async function loadRaster(file) {
  const url = URL.createObjectURL(file);
  let img;
  try { img = await loadImage(url); }
  catch { URL.revokeObjectURL(url); throw new LogoError(`Couldn't read “${file.name}” as an image.`); }
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) throw new LogoError(`“${file.name}” has no size.`);
  return {
    name: file.name, kind: extOf(file.name) || 'image', vector: false,
    aspect: w / h, pages: 1, page: 1, nativeLong: Math.max(w, h),
    render(longSide) {
      const [cw, ch] = sizeFor(w / h, longSide);
      const c = makeCanvas(cw, ch);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);   // GIFs: draws the first frame
      return c;
    },
    setPage() {},
    dispose() { URL.revokeObjectURL(url); },
  };
}

// ── SVG ────────────────────────────────────────────────────────────────────
async function loadSVG(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new LogoError(`“${file.name}” isn't a valid SVG file.`);
  }
  // Work out an intrinsic size: width/height attributes, else the viewBox.
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  let w = num(svg.getAttribute('width')), h = num(svg.getAttribute('height'));
  if ((!w || !h) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; }
  if (!w || !h) { w = 512; h = 512; }
  const aspect = w / h;
  // Rewrite width/height for each render so the browser rasterises at that size (crisp).
  const serial = new XMLSerializer();
  const imgAt = async (cw, ch) => {
    svg.setAttribute('width', String(cw)); svg.setAttribute('height', String(ch));
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const blob = new Blob([serial.serializeToString(svg)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
  };
  // check it actually renders
  try { await imgAt(64, 64 / aspect); }
  catch { throw new LogoError(`“${file.name}” couldn't be drawn. It may use features browsers don't support.`); }
  return {
    name: file.name, kind: 'svg', vector: true, aspect, pages: 1, page: 1,
    async render(longSide) {
      const [cw, ch] = sizeFor(aspect, longSide);
      const img = await imgAt(Math.round(cw), Math.round(ch));
      const c = makeCanvas(cw, ch);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c;
    },
    setPage() {},
    dispose() {},
  };
}

// ── PDF / AI (pdf.js, loaded on demand) ────────────────────────────────────
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

async function loadPDF(file, kind) {
  if (!(await startsWith(file, '%PDF'))) {
    if (kind === 'ai') {
      throw new LogoError(`“${file.name}” was saved without PDF compatibility, so it can't be opened here. `
        + 'In Illustrator, re-save it with “Create PDF Compatible File” ticked, or export it as SVG or PDF.');
    }
    throw new LogoError(`“${file.name}” isn't a valid PDF.`);
  }
  let pdfjs;
  try { pdfjs = await loadPdfjs(); }
  catch { throw new LogoError('The PDF reader failed to load. Check your connection and try again.'); }
  let doc;
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
  catch (e) {
    if (e?.name === 'PasswordException') throw new LogoError(`“${file.name}” is password-protected.`);
    throw new LogoError(`“${file.name}” couldn't be read as a PDF.`);
  }
  const src = {
    name: file.name, kind, vector: true, pages: doc.numPages, page: 1, aspect: 1, _page: null,
    async setPage(n) {
      this.page = Math.min(doc.numPages, Math.max(1, n | 0));
      this._page = await doc.getPage(this.page);
      const vp = this._page.getViewport({ scale: 1 });
      this.aspect = vp.width / vp.height;
    },
    async render(longSide) {
      const vp1 = this._page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_PX, longSide) / Math.max(vp1.width, vp1.height);
      const vp = this._page.getViewport({ scale });
      const c = makeCanvas(vp.width, vp.height);
      // transparent background: pages without an explicit white fill keep their alpha.
      // intent 'print' renders in one go instead of pacing itself with animation frames,
      // which never fire in a background tab (the upload would hang there).
      await this._page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)', intent: 'print' }).promise;
      return c;
    },
    dispose() { doc.destroy(); },
  };
  await src.setPage(1);
  return src;
}

// ── entry point ────────────────────────────────────────────────────────────
export async function loadLogoFile(file) {
  const ext = extOf(file.name);
  const type = (file.type || '').toLowerCase();
  if (ext === 'eps' || ext === 'epsf' || type === 'application/postscript' && ext !== 'ai') {
    throw new LogoError('EPS files can’t be opened in the browser. Please export the logo as SVG or PDF and upload that instead.');
  }
  if (ext === 'svg' || type === 'image/svg+xml') return loadSVG(file);
  if (ext === 'ai') return loadPDF(file, 'ai');
  if (ext === 'pdf' || type === 'application/pdf') return loadPDF(file, 'pdf');
  if (/^(png|jpe?g|webp|gif)$/.test(ext) || /^image\/(png|jpeg|webp|gif)$/.test(type)) return loadRaster(file);
  // Unknown extension: sniff the content
  if (await startsWith(file, '%PDF')) return loadPDF(file, 'pdf');
  if (await startsWith(file, '<svg') || await startsWith(file, '<?xml')) return loadSVG(file);
  throw new LogoError(`“${file.name}” isn't a supported file. Use PNG, JPG, WebP, GIF, SVG, PDF or AI.`);
}

export const LOGO_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf,.ai,.eps,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf';
