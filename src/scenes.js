// Scenic video backgrounds.
//
// 1) SCENE_CLIPS — openly licensed clips from Wikimedia Commons. upload.wikimedia.org sends
//    CORS headers, so the frames can be read straight into WebGL and the drops refract them.
//    All verified to load at the listed URL. Attribution is shown in the panel while a clip
//    plays (required by the CC licences).
// 2) YOUTUBE_SCENES — scenic "no talking" drives. A YouTube player can't be read by WebGL
//    (cross-origin), so the app opens one in a popup and you share that window; the captured
//    picture becomes the background. All verified embeddable via YouTube oEmbed.

const C = 'https://upload.wikimedia.org/wikipedia/commons/';
const t720 = (h, f) => `${C}transcoded/${h}/${f}/${f}.720p.vp9.webm`;
const page = (f) => `https://commons.wikimedia.org/wiki/File:${f}`;

export const SCENE_CLIPS = [
  { title: 'Cars driving at night', url: t720('8/82', 'Cars_driving_at_night.webm'), page: page('Cars_driving_at_night.webm'), author: 'Editor (YouTube)', license: 'CC BY 3.0' },
  { title: 'Traffic at dusk (time lapse)', url: t720('2/28', 'Traffic_at_dusk_(time_lapse).webm'), page: page('Traffic_at_dusk_(time_lapse).webm'), author: 'Editor (YouTube)', license: 'CC BY 3.0' },
  { title: 'Cars passing by at night, Cologne', url: t720('f/fa', 'Cars_Passing_by_at_Night.webm'), page: page('Cars_Passing_by_at_Night.webm'), author: 'Maximilian Schönherr', license: 'CC BY-SA 4.0' },
  { title: 'Night traffic time lapse', url: t720('0/08', 'Beachfront_B-Roll-_Night_Traffic_Time_Lapse_(Free_to_Use_HD_Stock_Video_Footage).webm'), page: page('Beachfront_B-Roll-_Night_Traffic_Time_Lapse_(Free_to_Use_HD_Stock_Video_Footage).webm'), author: 'Beachfront B-Roll', license: 'CC BY 3.0' },
  { title: 'City driving, Kraków', url: t720('9/98', 'City_Driving_4K-_Krak%C3%B3w_Poland_2024.webm'), page: page('City_Driving_4K-_Krak%C3%B3w_Poland_2024.webm'), author: 'Relaxing Roads 4K', license: 'CC BY 3.0' },
  { title: 'City skyline (time lapse)', url: t720('d/d5', 'City_skyline_(time_lapse).webm'), page: page('City_skyline_(time_lapse).webm'), author: 'Editor (YouTube)', license: 'CC BY 3.0' },
  { title: 'Driving in the rain, Doha', url: `${C}8/82/Driving_under_rain_-_Doha,_Qatar.webm`, page: page('Driving_under_rain_-_Doha,_Qatar.webm'), author: 'Muhammad Basheer', license: 'CC BY 3.0' },
  { title: 'Car driving through a snowy forest', url: t720('e/ea', 'Aerial_views_of_a_car_driving_in_snow_through_a_forest.webm'), page: page('Aerial_views_of_a_car_driving_in_snow_through_a_forest.webm'), author: 'Vladislav Sanikovich', license: 'CC BY 3.0' },
];

export const YOUTUBE_SCENES = [
  { id: 'tHm67QnNc1o', title: 'Night drive through Okinawa, Japan' },
  { id: 'GPuWzZPPewc', title: 'Cozy night drive around the city' },
  { id: 'cdJfwXPMnxE', title: 'Atlanta night drive' },
  { id: '2NaYolju6cE', title: 'Soothing night drive' },
  { id: 'WBj-KpJn3GA', title: 'Night drive in North York, Toronto' },
  { id: 'DNg3BT9BmY0', title: 'Moscow night drive, city lights' },
  { id: 'HXtloVSO7EE', title: 'Across Moscow after dark' },
  { id: '4H12fjbtdUA', title: 'Night drive in Mumbai' },
  { id: 'akA7vCa5CTo', title: 'Village roads, greenery & rain' },
  { id: 'GW8kHgxmdFI', title: 'Soothing rain drive, Illinois' },
  { id: 'u3H5ySYRPZI', title: 'Drive in the rain, passenger view' },
  { id: 'iQDs16W2DR0', title: 'Rainy day drive' },
  { id: 'EhWzJZX_Rss', title: 'Rainy rural Swiss villages' },
  { id: 'MJYssy3E8NU', title: 'Swiss countryside' },
  { id: 'J3ZXN_RbQSc', title: 'Rural roads in Sweden' },
  { id: 'BKHn9LHn-UY', title: 'Rural road, village landscape' },
];

const pick = (list, avoid) => {
  if (list.length < 2) return 0;
  let i;
  do { i = Math.floor(Math.random() * list.length); } while (i === avoid);
  return i;
};

// Plays SCENE_CLIPS at random into one <video> element that the renderer samples every frame.
//
// Phones are strict about video, so:
//  - the element is placed ON the page (tiny, invisible): Chrome on Android pauses muted
//    autoplay videos that aren't on screen, and a detached element never counts as visible;
//  - muted / playsinline / autoplay are set as attributes too (iOS Safari needs them);
//  - if playback hasn't started after a few seconds (battery/data saver blocking autoplay)
//    onStall fires so the app can ask for a tap, and kick() retries play() from that tap;
//  - if the device can't play WebM at all (older iPhones) or every clip fails, onFail fires
//    so the app can fall back to the photo slideshow.
export class ScenePlayer {
  constructor({ rotateSeconds = 75, onClip, onStall, onFail } = {}) {
    this.rotate = rotateSeconds;
    this.onClip = onClip; this.onStall = onStall; this.onFail = onFail;
    this.last = -1; this.timer = 0; this.watch = 0; this.fails = 0; this.active = false;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';               // needed so WebGL may read the frames
    v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto'; v.autoplay = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('autoplay', '');
    v.setAttribute('aria-hidden', 'true');
    Object.assign(v.style, {
      position: 'fixed', left: '0', bottom: '0', width: '2px', height: '2px',
      opacity: '0.01', pointerEvents: 'none', zIndex: '-1',
    });
    document.body.appendChild(v);
    v.addEventListener('loadedmetadata', () => {
      // long drives: start somewhere random instead of always at the beginning
      if (v.duration > 180) v.currentTime = 20 + Math.random() * (v.duration - 120);
    });
    v.addEventListener('playing', () => { this.fails = 0; });
    v.addEventListener('error', () => {
      if (!this.active) return;
      if (++this.fails < SCENE_CLIPS.length) this.next();
      else { this.stop(); this.onFail?.('none of the video clips would load'); }
    });
    this.video = v;
  }
  supported() {
    const v = this.video;
    return !!(v.canPlayType('video/webm; codecs="vp9"') || v.canPlayType('video/webm'));
  }
  start() {
    this.active = true; this.fails = 0;
    if (!this.supported()) {
      this.active = false;
      setTimeout(() => this.onFail?.("this browser can't play the WebM video format"), 0);
      return this.video;
    }
    this.next();
    return this.video;
  }
  next() {
    const i = pick(SCENE_CLIPS, this.last);
    this.last = i;
    const clip = SCENE_CLIPS[i];
    this.video.src = clip.url;
    this.kick();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.next(), this.rotate * 1000);
    // autoplay blocked (battery / data saver)? ask for a tap
    clearTimeout(this.watch);
    this.watch = setTimeout(() => {
      if (this.active && (this.video.paused || this.video.readyState < 2)) this.onStall?.();
    }, 6000);
    this.onClip?.(clip);
    return clip;
  }
  kick() { if (this.active) this.video.play().catch(() => {}); }
  playing() { return this.active && !this.video.paused && this.video.readyState >= 2; }
  stop() {
    this.active = false;
    clearTimeout(this.timer); clearTimeout(this.watch);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
  }
}

// Opens (or re-points) a popup that shows only a YouTube player, sized like a video.
export class YouTubeScene {
  constructor() { this.win = null; this.last = -1; }
  open() {
    const i = pick(YOUTUBE_SCENES, this.last);
    this.last = i;
    const s = YOUTUBE_SCENES[i];
    const start = 30 + Math.floor(Math.random() * 300);   // skip intros, vary the view
    // our own page hosts the player (a bare embed URL as a top-level page is rejected)
    // relative to this page, so it also works when the site lives in a sub-folder
    const url = new URL(`scene.html?v=${s.id}&start=${start}&title=${encodeURIComponent(s.title)}`, document.baseURI).href;
    if (this.win && !this.win.closed) this.win.location.href = url;
    else this.win = window.open(url, 'rainScene', 'popup,width=960,height=540');
    return { ...s, blocked: !this.win };
  }
  close() { if (this.win && !this.win.closed) this.win.close(); this.win = null; }
}
