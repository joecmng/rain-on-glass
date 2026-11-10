# Rain on Glass: notes for Claude

Real-time WebGL2 visualiser of rain on a car's side window at speed. Vanilla JS (ES
modules), built with Vite, no framework. A logo can be uploaded (or drawn with a pen) and
the rain interacts with it. Live build: GitHub Pages (see README).

## Run, build, test

- `npm install`, then `npm run dev` → http://localhost:5173 (Chrome or Edge; needs WebGL2
  with float render targets).
- `npm run build` → `dist/` (relative asset paths, so it works in a sub-folder).
- Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`.
- There are no unit tests. Verify changes in the browser. Useful console hooks:
  - `__app` exposes `{ config, sim, logo, logoModes, renderer, settings, audio, mapper }`.
    Use `__app.config`, not a fresh `import`: a dynamic import can load a second copy of
    the module, so changes to it have no effect.
  - `window.__paused = true` freezes the frame loop; `__advance(seconds, step)` then steps
    sim + render synchronously (handy for screenshots and measurements).
  - Press **D** for the debug panel (FPS, drop counts, audio meters).

## Where things are

```
index.html            all UI markup: the dock (bottom) and its cards
src/config.js         every tunable constant, commented: start here when tuning
src/main.js           wiring + frame loop: audio → mapping → sim.step → renderer.render
src/sim/drops.js      CPU drop simulation (struct-of-arrays, spatial hash, stick/slip,
                      merging, trails, mist). Optional hook: sim.surfaceMode
src/sim/noise.js      simplex/curl noise, surface pinning field
src/gl/renderer.js    passes: background → water map → wet film → fog clear map → composite
src/gl/shaders.js     all GLSL (COMPOSITE_FS does the water shading)
src/mapping.js        audio features → forces (audio is behind features.audio = false)
src/scenes.js, src/photos.js   background clips / photo collections (Wikimedia Commons, credited)
src/ui/ui.js          sliders, wind dial, background, keys, idle-hide
src/ui/dock.js        dock icons ↔ cards, draggable cards (shared position)
src/logo/
  loader.js           logo files: PNG/JPG/WebP/GIF, SVG, PDF/AI (pdf.js, lazy), EPS message
  mask.js             LogoField: per-cell coverage, signed distance, normals; query(x, y)
  fieldcore.js        the heavy maths (distance transform, pieces); runs in field.worker.js
  logo.js             LogoController: placement, drag/scale, overlay, combines logo + drawing
  modes.js            interaction modes: Water (default), Invisible, Raised, Repellent
  draw.js             pen/finger drawing (pressure, eraser, undo); strokes become logo shape
  panel.js            the Logo card + drawing strip wiring, saved settings (localStorage)
```

## Key ideas (read before changing the look or physics)

- **World units:** the sim world is `1000 * aspect` wide and `1000` tall, y pointing down,
  mapped linearly onto the canvas.
- **Water = one metaball field.** Drops are instanced quads that add a kernel
  `(1 - ρ²·KD0²)³` into a half-float map (RGB add, alpha MAX = thickness). Water exists
  above threshold 0.3, so touching bodies fuse instead of overlapping. The composite
  rebuilds a spherical-cap height from that field, takes normals, and shades a lens
  (refracted sharp background), dark rim, Fresnel reflection and glints.
- **Physics:** pinning ∝ r, airflow ∝ speed² (wind dial sets direction), gravity ∝ r³:
  small drops cling, big ones slide. Hysteresis between static and kinetic pinning gives
  stick/slip.
- **Logo modes plug in through one hook.** `sim.surfaceMode` gets `begin`, `spawn`,
  `spawnMist`, `drop(x, y, r, i, sim)` (returns pin/drag/evap multipliers, extra
  acceleration, or a wall) and `mistEvap`. With no logo the engine runs unchanged.
- **Water mode** draws the logo itself into the water map from its distance field
  (`LOGO_WATER_FS`), so it is shaded exactly like drops. Each separate piece holds a
  volume of water: it swells and sags as rain is absorbed, and drips from its lowest
  edge points (gravity + airflow) when over capacity.
- **Drawing** strokes are vector point lists, combined with the logo into one full-window
  mask. The field is rebuilt in a Web Worker; strokes not yet rebuilt are shown instantly
  as droplets (`DrawingLayer.ink`).

## Conventions

- Keep the engine general: features attach through hooks or config, not special cases in
  the core loops.
- Every tunable goes in `src/config.js` with a comment saying what it does.
- Comment the *why* (physics/rendering reasoning), not the obvious.
- Watch frame time: the sim runs a few thousand drops per step on the CPU. Avoid
  per-frame allocations in hot loops and keep heavy rebuilds in the worker.
- Background media must be openly licensed and credited in the UI.
