import { CONFIG } from './config.js';
import { follow } from './audio/features.js';
import { simplex3 } from './sim/noise.js';

const M = CONFIG.mapping;
const lerp = (a, b, t) => a + (b - a) * t;

// Audio features → physical forces & spawn rates.
// Music never moves drops directly: it only changes airflow, turbulence,
// pinning and how much water arrives. All outputs are smoothed again here.
export class Mapper {
  constructor() {
    this.t = 0;
    this.wind = M.idleWind; this.turb = M.idleTurb; this.mist = M.idleMist; this.shimmer = 0.15;
    this.spawnMul = 1; this.pulse = 0; this.burstAcc = 0;
    this.out = { wind: 0, windAngle: 0, gravity: 1, turbulence: 0, pinScale: 1, spawnRate: 0, burst: 0, mistRate: 0, releaseEvent: 0, shimmer: 0 };
  }

  update(dt, f, s) {
    this.t += dt;
    let windT, turbT, mistT, shimT, spawnT, release = 0, burst = 0;

    if (!f) {
      // no audio: cruising, slow procedural gusts so it never looks frozen
      const gust = 0.5 + 0.5 * simplex3(this.t * M.idleGustSpeed, 3.1, 0);
      windT = M.idleWind + M.idleGust * gust;
      turbT = M.idleTurb; mistT = M.idleMist; shimT = 0.15; spawnT = 1;
    } else {
      const sens = s.sensitivity;
      const quiet = f.silence;
      // bass + loudness → airflow gusts
      const drive = Math.min(1.5, (f.bass * M.bassToWind + f.loudness * M.loudToWind) * sens);
      windT = lerp(M.minWind + (M.maxWind - M.minWind) * Math.pow(drive, M.windCurve), M.silenceWind, quiet);
      // mids → turbulence (weave, wobble)
      turbT = (M.baseTurb + f.mid * sens * M.midToTurb) * (1 - 0.7 * quiet);
      // treble → mist density + highlight shimmer
      mistT = M.baseMist + f.treble * sens * M.trebleToMist;
      shimT = Math.min(1.5, f.treble * sens);
      spawnT = lerp(1, M.silenceSpawn, quiet);
      // beats / onsets → stuck drops let go + bursts of new drops
      if (f.beat) {
        burst = M.beatBurst * s.rain * (0.5 + f.onsetStrength) * Math.min(1.5, sens);
        release = M.beatRelease * Math.min(1.5, sens);
        this.pulse = 1;
      } else if (f.onset) {
        burst = M.onsetBurst * s.rain * Math.min(1.5, sens);
        release = M.onsetRelease * Math.min(1.5, sens);
        this.pulse = Math.max(this.pulse, 0.5);
      }
    }

    this.pulse *= Math.exp(-dt / M.pulseDecay);
    this.wind = follow(this.wind, windT, dt, M.windAttack, M.windRelease);
    this.turb = follow(this.turb, turbT, dt, M.turbAttack, M.turbRelease);
    this.mist = follow(this.mist, mistT, dt, M.mistAttack, M.mistRelease);
    this.shimmer = follow(this.shimmer, shimT, dt, M.shimmerAttack, M.shimmerRelease);
    this.spawnMul = follow(this.spawnMul, spawnT, dt, 0.4, 1.5);
    this.burstAcc += burst;

    const o = this.out;
    // air drag grows with the square of car speed, so slow = gravity wins, fast = airflow wins
    o.wind = this.wind * s.speed * s.speed;
    // dial angle is measured from straight down toward the rear → sim angle (0 = +x, +y down)
    o.windAngle = (90 - s.windAngle) * Math.PI / 180;
    o.gravity = 1;
    o.turbulence = this.turb;
    o.pinScale = 1 - M.pulsePinDrop * this.pulse;
    o.spawnRate = CONFIG.sim.spawnRate * s.rain * this.spawnMul;
    o.burst = Math.floor(this.burstAcc); this.burstAcc -= o.burst;
    o.mistRate = CONFIG.sim.mistRate * this.mist * (0.3 + 0.7 * Math.min(1.5, s.rain));
    o.releaseEvent = release;
    o.shimmer = this.shimmer;
    return o;
  }
}
