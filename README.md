# Rain on Glass

A visualiser of rain on the side window of a fast-moving car. Upload a logo (or draw
with a pen or finger) and it becomes water on the glass: it fills with the rain, swells
and drips. It uses WebGL2 and vanilla JS, built with Vite.

**Live:** https://joecmng.github.io/rain-on-glass/ (rebuilt automatically on every push to `main`).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome or Edge. Screen and tab audio capture needs a
Chromium browser. Localhost counts as a secure context, so capture works there.

For a static build, run `npm run build` and serve `dist/` over https or localhost.
Notes for working on the code (with or without Claude Code) are in `CLAUDE.md`.

> **Audio is switched off for now.** The audio controls (source picker, sensitivity) and the
> music reaction are hidden. All the code is still there. To bring them back, set
> `features.audio` to `true` in `src/config.js`.

## Make it react to YouTube (Chrome / Edge)

A YouTube iframe can't be read directly, so the app captures the tab's audio instead:

1. Open the YouTube video in its **own tab** and start playing it.
2. In the visualiser, set **Audio → Tab / system audio**.
3. In Chrome's share picker, open the **Chrome Tab** tab and select the YouTube tab.
4. Make sure **"Also share tab audio"** is switched **on** (bottom-left of the picker),
   then click **Share**.
5. Switch back to the visualiser tab. You still hear the music from the YouTube tab,
   and the rain reacts to it.

Notes:
- If you forget the audio switch, the app tells you so. Pick the source again and
  turn on the switch.
- To capture *all* system audio (for example Spotify), choose **Entire screen** and
  switch on **"Also share system audio"**. This works on Windows only.
- Clicking **Stop sharing** in Chrome's bar ends the capture. The app goes back to
  "cruising" mode.
- Other sources:
  - **Microphone**
  - **Audio file…**, or drag an audio file onto the page
  - **Test beat**, a synthesised groove with a silent breakdown every 16 bars. It's
    useful for checking the mapping.

## Controls

Everything sits in a small dock at the bottom of the window. Each icon opens a card;
tap the same icon again, tap the glass or press Esc to close it. Drag a card by its
title to move it (all cards then open there); double-click the title to put it back.

| Icon | What's in it |
|---|---|
| Weather | Rain, Speed (car speed: airflow grows with speed²), Fog, Wind dial (where the air pushes the drops; "g" marks gravity) |
| Scene | Background (scenic clips, photos in themed collections, your own image, webcam), Bokeh (0 = pin-sharp background, higher = soft out-of-focus), Streak style |
| Logo | Upload / replace / remove, size, interaction mode (Water, Invisible, Raised, Repellent) with its sliders, Fix mask |
| Draw | Turns the dock into a drawing strip: Brush / Eraser, Size, Pressure, Undo, Clear, Done |
| Settings | Quality, fullscreen, debug, keyboard shortcuts |

Logos: PNG, JPG, WebP, GIF, SVG, PDF or AI (drop a file on the page or use Upload). Drag the
logo to move it; scroll or pinch to resize.

Keys: **B** draw · **E** eraser · **Ctrl+Z** undo · **M** show mask · **D** debug · **H** hide · **F** fullscreen.
Quality steps down automatically if the page stays under 50 fps, unless you've picked a level.

## How it works

```
src/
  config.js          every tunable constant, with comments
  main.js            frame loop: audio → mapping → sim → render
  gl/renderer.js     background → water map → wet film → composite
  gl/shaders.js      all GLSL
  gl/glutil.js       program and render-target helpers
  sim/drops.js       CPU drop simulation (struct-of-arrays + spatial hash)
  sim/noise.js       simplex/curl noise, surface pinning field
  audio/audio.js     tab/system, mic, file and test-beat sources → AnalyserNode
  audio/features.js  bands, loudness, spectral flux, onset/beat, auto-gain, envelopes
  mapping.js         features → forces and spawn rates (never positions)
  ui/ui.js, ui/dock.js, ui/debug.js
  logo/              logo loading, surface map (+ worker), interaction modes, drawing
```

**Rendering.** Each drop is drawn as an instanced quad into a half-float "water map":
- R holds the height (a spherical-cap profile, elongated and tapered along the motion).
- GB hold the height-weighted offset from the drop's centre.

Overlapping drops sum like metaballs. The composite pass works out the normals from the
height gradient. Inside the water it samples a **sharp** background at
`centre − offset × lensZoom`, which gives the inverted, minified "tiny lens" look. The
glass shows a **blurred** background.

The procedural city is rendered twice: small motion-streaked lights for the view through
the drops, and big bokeh discs for the defocused view. A separate fading "wet film"
texture leaves the thin trails behind sliding drops.

**Physics.** Wind force scales with r², pinning with r, and gravity with r³. A resting drop clings until it reaches a critical size (about 13 units, 11–17 with surface variation), then gravity pulls it down; airflow (∝ speed²) pushes it sideways:
- Big drops break loose first and small ones cling.
- A sliding drop keeps moving until the driving force falls below a lower kinetic
  threshold. That gap gives the stick/slip behaviour.
- Random pinning defects make drops stall. While stalled they gather mist and trail
  droplets, then break away.
- Merging conserves volume and momentum.

**Audio → forces.** All mappings are smoothed with envelope followers:

| Feature | What it drives |
|---|---|
| Bass + loudness | Airflow strength (gusts) |
| Mids | Curl-noise turbulence and wobble |
| Treble | Mist rate and specular shimmer |
| Beats/onsets | Bursts of new drops, plus a pulse that briefly lowers pinning so stuck drops let go |
| Silence | Wind falls to almost nothing; drops cling and creep down under gravity |

## Dev hooks

In the console:
- `__advance(seconds)` steps the sim synchronously.
- `__app` exposes the sim, the audio engine, the current features and forces.

## Scenic video backgrounds

**Photos** is a click-through slideshow of still scenes you'd see from a car, in collections (city at night, night roads and light trails, country, mountain and coastal roads, rain and fog, snow, desert, city streets, or everything shuffled), all from Wikimedia Commons (CC0 / CC BY / CC BY-SA / public domain). Big screens load 3840 px versions, others 1920 px. Pick a collection in the Scene card; step through with the ◀ / ▶ buttons or the left/right arrow keys; the current photo's credit is shown in the panel. The lists are in `src/photos.js`.

**Scenic clips** plays random clips from Wikimedia Commons straight into the renderer, so the
drops refract them. It switches clip every 75 s (`background.sceneRotateSeconds`). The list
and credits are in `src/scenes.js`. All are CC BY 3.0 except the Cologne clip (CC BY-SA 4.0),
and the current clip's credit is shown in the panel.

**YouTube scene** is hidden for now (set `features.youtube` to `true` in `src/config.js` to bring it back). It can't read YouTube's player directly (browsers block that), so it:

1. Opens a random scenic drive in a small window (allow pop-ups for the page if asked).
2. You click **Capture scene window**, choose the **Chrome Tab** tab, and pick the scene.
   Turn on **Also share tab audio** to use its sound for the music reaction too
   (click the scene window and press **M** to unmute it).
3. Its picture becomes the background. **Next scene** loads another drive in the same window.

Keep the scene window open (it can sit behind other windows). The list is in `src/scenes.js`.
