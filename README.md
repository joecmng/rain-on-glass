# Rain on Glass

A music-reactive visualiser of rain on the side window of a fast-moving car.
It uses WebGL2 and vanilla JS, built with Vite.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome or Edge. Screen and tab audio capture needs a
Chromium browser. Localhost counts as a secure context, so capture works there.

For a static build, run `npm run build` and serve `dist/` over https or localhost.

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

| Control | Effect |
|---|---|
| Sensitivity | Gain on all audio features |
| Speed | Car speed. Airflow grows with speed² (air drag): at low speed gravity wins and drops run down; at high speed they streak back |
| Wind (dial) | Drag the arrow to set where the air pushes the drops. The small "g" mark shows gravity (down). Starts at 90° = horizontal toward the rear; double-click to reset, arrow keys to nudge |
| Rain | Spawn rate |
| Background | Night-city bokeh, your own image (or drag an image onto the page), or webcam |
| Quality | Low, Medium, High or Ultra. It steps down automatically if the focused page stays under 50 fps, unless you've picked a level yourself |
| **D** | Debug panel: audio meters, onset/beat lamps, force outputs, FPS, drop counts |
| **H** / **F** | Hide UI / fullscreen |

The panel hides itself after 3 s without mouse movement.

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
  ui/ui.js, ui/debug.js
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
