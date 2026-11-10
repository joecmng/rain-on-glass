// ─────────────────────────────────────────────────────────────────────────────
// All tunable constants live here.
//
// Units used by the simulation:
//   u   = simulation unit. The screen is always 1000u tall; width = 1000u × aspect.
//         (so at 1080p, 1u ≈ 1.08 px)
//   s   = seconds.  Accelerations are u/s², speeds u/s.
//
// Physics model (per drop of radius r, volume ∝ r³):
//   wind force ∝ r²  → wind accel ∝ 1/r      (bigger drops are pushed less per mass…)
//   pinning   ∝ r    → pin accel  ∝ 1/r²     (…but pinned far less, so big drops move first)
//   gravity   ∝ r³   → constant accel
// A drop starts sliding when |drive accel| > pin threshold (static friction),
// and keeps sliding until drive drops below a lower kinetic threshold (hysteresis
// → stick/slip). All "…Accel" values below are specified for a drop of radius rRef.
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  // ── Quality presets ──────────────────────────────────────────────────────
  // renderScale: canvas resolution relative to CSS px × devicePixelRatio
  // waterScale:  water-map resolution relative to the canvas
  // bgScale:     sharp background resolution relative to the canvas (blur is half of this)
  quality: {
    low:    { renderScale: 0.6,  waterScale: 0.5,  bgScale: 0.3,  maxDrops: 600,  maxMist: 1000 },
    medium: { renderScale: 0.8,  waterScale: 0.6,  bgScale: 0.4,  maxDrops: 1000, maxMist: 2000 },
    high:   { renderScale: 1.0,  waterScale: 0.75, bgScale: 0.5,  maxDrops: 1500, maxMist: 3000 },
    ultra:  { renderScale: 1.0,  waterScale: 1.0,  bgScale: 0.6,  maxDrops: 2000, maxMist: 4500 },
  },
  defaultQuality: 'high',
  maxDevicePixelRatio: 2,     // cap DPR so 4K/retina doesn't melt laptops
  maxDt: 1 / 20,              // clamp frame dt (tab switches etc.)
  substepDt: 1 / 50,          // sim substep size: frames longer than this are split

  // ── User-facing defaults (UI sliders) ────────────────────────────────────
  defaults: {
    sensitivity: 1.0,   // 0..3  audio feature gain
    speed: 1.0,         // 0..2  "car speed": airflow grows with speed² (air drag), plus background scroll
    windAngle: 90,      // deg, wind dial: 0 = down (with gravity), 90 = horizontal toward the rear, 180 = up
    rain: 0.7,          // 0..2  rain intensity (spawn rate multiplier)
    background: 'city',
    streakStyle: 'jagged',
    fog: 0.6,           // 0..1 condensation density (UI slider)
  },

  // ── Simulation ───────────────────────────────────────────────────────────
  sim: {
    worldHeight: 1000,

    // Spawning (rain impacts)
    spawnRate: 110,         // drops/s at rain = 1
    spawnRMin: 1.6,         // u
    spawnRMax: 14,          // u
    spawnBias: 1.9,         // >1 → mostly small drops, occasional big ones
    prefillDrops: 1000,     // drops placed at startup so the glass isn't dry
    prefillMist: 1800,

    rRef: 8,                // reference radius for the …Accel constants
    rMax: 28,               // drops above this shed volume as trail droplets
    minR: 0.55,             // drops smaller than this are removed

    // Forces
    // Gravity engine. Weight ∝ r³ but the surface-tension grip (pinning) ∝ r, so a resting
    // drop clings until it reaches a critical size, then runs down on its own:
    //   r_crit ≈ rRef · √(pinAccel / gravity) ≈ 8 · √(4200 / 1500) ≈ 13u  (11–17u with pin variation)
    // Small drops grow by merging and sweeping up mist until they pass it. Airflow (∝ speed²)
    // adds a sideways push that overrides gravity as the car goes faster.
    gravity: 1500,          // u/s²
    windAccel: 2600,        // wind accel at rRef and wind strength 1 (× speed²)
    pinAccel: 4200,         // static pinning threshold at rRef
    pinMin: 0.65,           // per-drop random pin multiplier range
    pinMax: 1.55,
    surfaceAmp: 0.45,       // spatial pinning variation (dirty/clean glass patches) ±
    surfaceCell: 9,         // u per texel of the surface field (patch size)
    kineticRatio: 0.55,     // sliding friction = pin × this  (< 1 → hysteresis)
    drag: 4.5,              // 1/s viscous damping: gravity-only slides crawl (~200 u/s), not shoot
    stopSpeed: 9,           // u/s below which a drop may re-pin

    // Turbulence (curl noise) + wobble
    turbAccel: 160,         // u/s² at rRef and turbulence 1
    curlScale: 0.0032,      // spatial frequency of airflow eddies (1/u)
    curlSpeed: 0.32,        // how fast eddies evolve
    wobbleFreq: 6.5,        // Hz, lateral weave of sliding drops
    wobbleAmp: 0.0,         // fraction of speed

    // Kinks: snags turn a sliding drop abruptly (references show straight runs + sharp corners)
    kinkRate: 1.6,          // snags/s while sliding (× 0.5..2 with turbulence)
    kinkAngle: 0.38,        // rad, typical turn
    kinkMax: 0.75,          // rad, max deviation from the airflow
    kinkSlow: 0.55,         // speed kept after a snag

    // Stick/slip
    holdMin: 0.06,          // s, minimum time a drop stays pinned after stopping
    holdMax: 0.6,
    stallRate: 0.55,        // chance/s that a sliding drop hits a pinning defect
    stallBoost: 1.9,        // extra pin factor on a stall (decays)
    stallDecay: 1.3,        // 1/s
    mergeKick: 0.45,        // coalescence temporarily lowers pinning by this fraction
    releaseProb: 0.22,      // per beat, chance a stuck rRef-sized drop lets go
    releaseKick: 0.6,       // pin reduction applied to released drops

    // Merging
    mergeDist: 1.06,        // merge on contact: distance < (r1 + r2) × this (≥ 1, so drops never overlap)
    mergeTime: 0.1,         // s, coalescence time constant: smaller drop shrinks and flows in over ~0.25 s
    mergePull: 1.2,         // ghost moves in this much slower than its water drains (keeps the lobe visible)
    gridCell: 60,           // u, spatial hash cell (must be ≥ 2·rMax·mergeDist)

    // Trails
    trailMinSpeed: 45,      // u/s
    trailMinR: 2.4,         // u
    // (trail spacing / droplet size / stretch live in streakStyles below)
    trailEvap: 0.95,        // u/s radius shrink of trail droplets
    evap: 0.012,            // u/s radius shrink of normal drops

    // Shape
    stretchResponse: 7,     // 1/s smoothing of shape changes

    // Mist (tiny droplets)
    mistRate: 230,          // droplets/s at mist = 1
    mistRMin: 0.7,
    mistRMax: 2.6,
    mistEvap: 0.075,        // u/s
    mistAbsorbMinR: 2.0,    // only drops bigger than this sweep up mist

    // Wet-track capture: drops that run into another drop's track get drawn into it
    capture: true,
    trackCell: 10,          // u, resolution of the CPU track map
    captureMin: 0.3,        // how wet a track must still be to capture (0..1, fades with the streak)
    captureMaxCos: 0.26,    // only capture when crossing at < ~75° to the track
    captureSteer: 11,       // 1/s, how quickly a captured drop turns to follow the track
    capturePull: 9,         // 1/s, how quickly it slides onto the track's centre line
    captureBoost: 0.5,      // extra speed per second on a wet track (less pinning)
    wetMinSpeed: 25,        // u/s, slower drops leave no streak
  },

  // ── Streak styles (UI: "Streaks") ────────────────────────────────────────
  // Streaks are real water: sliding drops paint a channel of HEIGHT into a fading
  // trail map, which the composite refracts and lights exactly like the drops.
  // As a channel fades its edges sink below the water threshold, so it narrows
  // and (with breakup) pinches off into beads before vanishing.
  //   width         channel width × drop radius
  //   height        channel thickness relative to its width (lens power, dark edges)
  //   fade          s, e-folding time of the channel
  //   breakup       0..1 how strongly it pinches into beads as it thins
  //   breakupScale  bead frequency (per screen height)
  //   lens          lens zoom through the channel (× its width), like render.lensZoom for drops
  //   sharp         0..1 how much of the in-focus scene the channel shows
  //   sheen         specular multiplier on the channel
  //   trailSpacing  × r of travel between left-behind droplets
  //   trailFracMin/Max  droplet radius as a fraction of the parent
  //   stretchK / maxStretch  elongation of the sliding drop itself
  //   lumps         0..1 width variation along the channel (blobby rivulets)
  //   thinning      1/s extra rate the channel's thickness drains vs its footprint
  //                 (fullest right behind the head, tapering toward the tail)
  streakStyles: {
    jagged:  { label: 'Jagged rivulet', width: 0.62, height: 0.95, fade: 1.9, breakup: 0.12, breakupScale: 40, lens: 6.5, sharp: 0.6,  sheen: 1.0, trailSpacing: 6.0, trailFracMin: 0.10, trailFracMax: 0.20, stretchK: 6, maxStretch: 3.2, lumps: 0.3, thinning: 0.8 },
    rivulet: { label: 'Rivulet',      width: 0.5,  height: 0.55, fade: 1.3,  breakup: 0.25, breakupScale: 60,  lens: 5, sharp: 0.4,  sheen: 1.0, trailSpacing: 4.0, trailFracMin: 0.10, trailFracMax: 0.18, stretchK: 11, maxStretch: 2.6, lumps: 0 },
    beaded:  { label: 'Beaded chain', width: 0.58, height: 0.7,  fade: 1.1,  breakup: 0.95, breakupScale: 110, lens: 5.5, sharp: 0.6,  sheen: 1.1, trailSpacing: 1.6, trailFracMin: 0.16, trailFracMax: 0.30, stretchK: 12, maxStretch: 2.2, lumps: 0 },
    smear:   { label: 'Wet smear',    width: 0.95, height: 0.2,  fade: 0.9,  breakup: 0.35, breakupScale: 25,  lens: 2.5, sharp: 0.15, sheen: 1.6, trailSpacing: 5.0, trailFracMin: 0.08, trailFracMax: 0.14, stretchK: 13, maxStretch: 2.0, lumps: 0 },
    comet:   { label: 'Comet tail',   width: 0.75, height: 0.6,  fade: 0.45, breakup: 0.1,  breakupScale: 60,  lens: 5, sharp: 0.4,  sheen: 1.0, trailSpacing: 3.0, trailFracMin: 0.10, trailFracMax: 0.20, stretchK: 5,  maxStretch: 6.5, lumps: 0 },
  },
  defaultStreakStyle: 'jagged',

  // ── Audio analysis ───────────────────────────────────────────────────────
  audio: {
    fftSize: 2048,
    bands: {                 // Hz
      bass:   [25, 150],
      mid:    [150, 2000],
      treble: [2000, 11000],
    },
    fluxMaxHz: 11000,
    agcRangeDb: 30,          // dynamic range mapped to 0..1
    agcDecayDb: 2.5,         // dB/s the reference level falls (slow auto-gain)
    agcMinRefDb: -58,        // reference never below this (quiet stays quiet)
    loudMinRefDb: -30,
    fluxAgcTau: 5,           // s
    fluxMinRef: 0.02,
    silenceDb: -58,          // RMS below this = silence
    // envelope followers: [attack, release] seconds
    env: {
      bass:     [0.03, 0.35],
      mid:      [0.04, 0.45],
      treble:   [0.02, 0.30],
      loudness: [0.05, 0.60],
      flux:     [0.01, 0.15],
      silence:  [0.6, 0.08],  // becomes "silent" slowly, recovers fast
      pulse:    [0.0, 0.22],
    },
    onsetWindow: 45,         // frames of flux history for adaptive threshold
    onsetK: 1.5,             // threshold = mean + K·std + min
    onsetMin: 0.004,
    onsetRefractory: 0.11,   // s
    beatRefractory: 0.27,    // s
    beatMinBass: 0.25,
  },

  // ── Audio → force mapping (all smoothed, nothing touches positions) ───────
  mapping: {
    // no audio source: gentle "cruising" with slow procedural gusts
    idleWind: 0.72,
    idleGust: 0.45,
    idleGustSpeed: 0.13,
    idleTurb: 0.5,
    idleMist: 0.7,

    bassToWind: 0.75,
    loudToWind: 0.45,
    windCurve: 1.25,
    minWind: 0.32,           // wind with audio playing but quiet
    maxWind: 1.5,            // full-bass gust
    silenceWind: 0.05,       // true silence: drops cling, gravity wins
    windAttack: 0.22,        // s — gusts build quickly…
    windRelease: 1.3,        // …and die away slowly

    baseTurb: 0.25,
    midToTurb: 0.85,
    turbAttack: 0.2,
    turbRelease: 0.8,

    baseMist: 0.35,
    trebleToMist: 1.3,
    mistAttack: 0.3,
    mistRelease: 1.0,
    shimmerAttack: 0.03,
    shimmerRelease: 0.3,

    silenceSpawn: 0.3,       // rain rate multiplier in silence
    beatBurst: 5,            // extra drops spawned per beat (× rain)
    onsetBurst: 2,
    beatRelease: 1.0,        // release strength per beat
    onsetRelease: 0.35,
    pulseDecay: 0.25,        // s
    pulsePinDrop: 0.35,      // beat pulse lowers global pinning by this fraction
  },

  // ── Rendering / look ─────────────────────────────────────────────────────
  render: {
    minSplatPx: 1.3,         // smallest rendered drop radius in water-map px
    thresh: 0.3,             // water-field level that forms the water's outline (kernel sum)
    dropHeight: 0.9,         // surface height / size: lens power and steepness of the dark rim
    normalStrength: 0.95,
    streakSmooth: 2.0,       // texels: rounds joins where streams cross/meet and irons out tiny
                             // per-frame ripples that the rivulet's lens would magnify (0 = off)
    moveFlatten: 0.45,       // how much a sliding drop flattens into its rivulet (0 = stays a tall bead)
    dropSmooth: 0.5,         // texels: light smoothing of the drop field (0 = off)
    dropSharp: 0.8,          // 0..1 how crisp the scene looks through a drop (lower = softer, more natural)
    lensZoom: 7.5,           // inverted + minified view through drops (higher = wider)
    edgeDark: 0.8,           // dark rim from total internal reflection
    fresnel: 1.0,            // strength of the mirror (Fresnel) reflection of sky / cabin
    spec: 1.0, 
    shininess: 150,
    exposure: 1.35,
    vignette: 0.55,
    grain: 0.022,
    glassTint: [0.93, 0.96, 1.0],
    fog: 0.012,              // faint condensation haze on the glass
  },

  // ── Condensation fog ─────────────────────────────────────────────────────
  // A misted layer over the glass. Sliding drops wipe clear paths that slowly fog
  // over again; resting drops keep a small dry ring around themselves.
  fog: {
    regrow: 5,          // s, e-folding time for a wiped path to mist over again
    wipeWidth: 1.05,    // wiped path half-width × drop radius
    halo: 0.28,         // how clear the ring around a resting drop is (0..1)
    spread: 0.012,      // extra blur through fog (screen heights)
    lift: 0.015,        // light scattered by the fog (brightens dark scenes a little)
    edge: 0.7,           // brightness of the denser fog at the edge of a wipe
  },

  background: {
    scrollSpeed: 0.33,       // screen heights/s of the nearest bokeh layer at speed 1
    imageBlurPasses: 3,
  },

  ui: {
    hideAfterMs: 3000,
  },
};
