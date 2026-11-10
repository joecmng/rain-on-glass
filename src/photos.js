// Night-city photo slideshow: red tail lights, red neon, wet streets.
// All from Wikimedia Commons under open licences (CC0 / CC BY / CC BY-SA), loaded as
// 1920px thumbnails from thumb.wikimedia.org, which sends CORS headers so WebGL can read
// them and the drops refract them. Every one verified to load and be readable.
// The credit for the current photo is shown in the panel (required by CC BY / BY-SA).

const T = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/';
const P = 'https://commons.wikimedia.org/wiki/File:';
const photo = (path, file, title, author, license, pageFile = file) => ({
  title, author, license,
  url: `${T}${path}/${file}/1920px-${file}`,
  page: P + pageFile,
});

export const NIGHT_PHOTOS = [
  photo('9/92', 'Kabukicho_red_gate_and_colorful_neon_street_signs_at_night%2C_Shinjuku%2C_Tokyo%2C_Japan.jpg', 'Kabukichō red gate, Shinjuku, Tokyo', 'Basile Morin', 'CC BY-SA 4.0'),
  photo('c/c1', 'Red_Lights_on_Houston_%2850304685756%29.jpg', 'Red lights on Houston Street, New York', 'Eden, Janine and Jim', 'CC BY 2.0', 'Red_Lights_on_Houston_(50304685756).jpg'),
  photo('8/8d', 'City_lights_-_Flickr_-_%5Esean.jpg', 'City light trails', '^sean (in transition)', 'CC BY 2.0'),
  photo('7/7b', 'Hong_Kong_night_street.jpg', 'Hong Kong night street', 'Wilfredor', 'CC0'),
  photo('d/d0', 'Chinatown%2C_London_-_Wardour_Street_-_big_Chinese_lanterns_-_at_night_%286437981483%29.jpg', 'Chinatown lanterns, London', 'Elliott Brown', 'CC BY 2.0', 'Chinatown%2C_London_-_Wardour_Street_-_big_Chinese_lanterns_-_at_night_(6437981483).jpg'),
  photo('3/32', 'Kabukicho_red_gate_and_colorful_neon_street_signs_at_night_01.jpg', 'Kabukichō gate at night, Tokyo', 'ノボホショコロトソ', 'CC BY 4.0'),
  photo('a/a8', 'Red_Lights_on_Avenue_A_%2851309025225%29.jpg', 'Red lights on Avenue A, New York', 'Eden, Janine and Jim', 'CC BY 2.0', 'Red_Lights_on_Avenue_A_(51309025225).jpg'),
  photo('d/dc', 'Colorful_neon_street_signs_in_Kabukich%C5%8D%2C_Shinjuku%2C_Tokyo.jpg', 'Neon signs in Kabukichō, Tokyo', 'Basile Morin', 'CC BY-SA 4.0'),
  photo('2/27', '%E5%BB%9F%E8%A1%97%E6%B0%B8%E9%B4%BB%E9%BA%BB%E9%9B%80%E9%A4%A8%2C_Hong_Kong_~_Kowloon_Neon_~_Near_Temple_Street_Night_Market.jpg', 'Kowloon neon near Temple Street, Hong Kong', 'VasenkaPhotography', 'CC BY 2.0'),
  photo('a/ab', 'Broadway_Red_Lights_%2853151030962%29.jpg', 'Broadway red lights, New York', 'Eden, Janine and Jim', 'CC BY 2.0', 'Broadway_Red_Lights_(53151030962).jpg'),
  photo('3/34', 'Neon_Nights_in_Kowloon%2C_Hong_Kong_%28April_2012%29_-_7547589944.png', 'Neon nights in Kowloon, Hong Kong', 'Mark Pegrum', 'CC BY 2.0', 'Neon_Nights_in_Kowloon%2C_Hong_Kong_(April_2012)_-_7547589944.png'),
  photo('4/45', 'Yasukuni-dori_Avenue_at_night_with_vehicles_and_colorful_neon_street_signs%2C_Shinjuku%2C_Tokyo%2C_Japan.jpg', 'Yasukuni-dōri at night, Shinjuku', 'Basile Morin', 'CC BY-SA 4.0'),
  photo('0/01', 'Hong_Kong_night_street_2.jpg', 'Hong Kong night street II', 'Wilfredor', 'CC0'),
  photo('d/dd', 'Night_in_Shinjuku_2.JPG', 'Night in Shinjuku', 'Martin Falbisoner', 'CC BY-SA 3.0'),
  photo('1/12', 'DFC_6255_Neon-lit_street_food_cart_and_scooters_outside_a_lively_bar_in_Pattaya_Thailand_-_a_rainy_night_scene_of_city_nightlife.jpg', 'Rainy neon night, Pattaya', 'PattayaPatrol', 'CC BY-SA 4.0'),
  photo('a/a9', 'Hong_Kong_Neon_%E5%A3%AB%E4%B8%B9%E5%88%A9%E8%A1%97_Stanley_Street_%E5%93%81%E8%B6%8A%E8%B6%8A%E5%BC%8F%E6%96%99%E7%90%86_La%27taste_Vietnamese_Cuisine_%E9%9C%93%E8%99%B9%E7%87%88%E6%8B%9B%E7%89%8C.jpg', 'Stanley Street neon, Hong Kong', 'VasenkaPhotography', 'CC BY 2.0', "Hong_Kong_Neon_%E5%A3%AB%E4%B8%B9%E5%88%A9%E8%A1%97_Stanley_Street_%E5%93%81%E8%B6%8A%E8%B6%8A%E5%BC%8F%E6%96%99%E7%90%86_La'taste_Vietnamese_Cuisine_%E9%9C%93%E8%99%B9%E7%87%88%E6%8B%9B%E7%89%8C.jpg"),
  photo('5/5c', 'Traffic_in_Nihonbashi_at_Night.jpg', 'Traffic in Nihonbashi at night, Tokyo', 'Insightwm', 'CC BY-SA 4.0'),
  photo('8/8b', 'Bade_Road_Sec_3%2C_Songshan_District%2C_Taipei_20120326_night_amk.jpg', 'Bade Road at night, Taipei', 'AngMoKio', 'CC BY-SA 3.0'),
  photo('c/c6', 'City_Traffic_Illuminated_City_Life_Night_City_Street_Night_Photography_Nightlife_Motion_%2832861900291%29.jpg', 'City traffic at night, Tokyo', 'OiMax', 'CC BY 2.0', 'City_Traffic_Illuminated_City_Life_Night_City_Street_Night_Photography_Nightlife_Motion_(32861900291).jpg'),
  photo('9/9f', 'Piccadilly_Circus_at_Night_-_geograph.org.uk_-_2191700.jpg', 'Piccadilly Circus at night, London', 'Colin Smith', 'CC BY-SA 2.0'),
];

// Click-through slideshow. Loads the photo, hands it to the renderer, and quietly
// preloads the next one so "Next" feels instant.
export class PhotoSlideshow {
  constructor({ onPhoto, onError } = {}) {
    this.onPhoto = onPhoto; this.onError = onError;
    this.index = 0; this.cache = new Map(); this.token = 0;
  }
  load(i) {
    const n = NIGHT_PHOTOS.length;
    i = ((i % n) + n) % n;
    if (this.cache.has(i)) return this.cache.get(i);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';           // needed so WebGL may read the pixels
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => { this.cache.delete(i); reject(new Error('Could not load ' + NIGHT_PHOTOS[i].title)); };
      img.src = NIGHT_PHOTOS[i].url;
    });
    this.cache.set(i, p);
    return p;
  }
  async show(i) {
    const n = NIGHT_PHOTOS.length;
    this.index = ((i % n) + n) % n;
    const token = ++this.token;
    try {
      const img = await this.load(this.index);
      if (token !== this.token) return;          // a newer click won
      this.onPhoto?.(img, NIGHT_PHOTOS[this.index], this.index, n);
      this.load(this.index + 1).catch(() => {}); // preload the next one
    } catch (e) { if (token === this.token) this.onError?.(e); }
  }
  start() { return this.show(this.index); }
  next() { return this.show(this.index + 1); }
  prev() { return this.show(this.index - 1); }
}
