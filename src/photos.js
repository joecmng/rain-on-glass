// Photo backgrounds: still scenes you might see from a car window, in themed collections.
// All from Wikimedia Commons under open licences (CC0 / CC BY / CC BY-SA / public domain),
// loaded from thumb.wikimedia.org, which sends CORS headers so WebGL can read them and the
// drops refract them. Every one verified to load. The credit for the current photo is shown
// in the panel (required by CC BY / BY-SA).
//
// Resolution: big screens get 3840 px versions, others 1920 px (Wikimedia only serves
// certain thumbnail widths; 2560 isn't one of them).

const T = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/';
const P = 'https://commons.wikimedia.org/wiki/File:';
export const PHOTO_WIDTH = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1) > 2200 ? 3840 : 1920;
// path: the "a/ab" hash folder; file: the URL-encoded file name (as in its upload URL)
const photo = (path, file, title, author, license, pageFile = file) => ({
  title, author, license,
  url: `${T}${path}/${file}/${PHOTO_WIDTH}px-${file}`,
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

// ── collections (the picker in the Scene card lists these, plus "Everything, shuffled")
export const COLLECTIONS = [
  { id: 'night-red', name: 'City at night (red)', photos: NIGHT_PHOTOS },
  { id: 'night-roads', name: 'Night roads & light trails', photos: [
    photo('c/ca', 'Chandmari_Flyover.jpg', 'Chandmari Flyover at night, Guwahati', 'Parthadeep Dutta Bhuyan', 'CC BY-SA 4.0', 'Chandmari_Flyover.jpg'),
    photo('b/b6', 'Lomonossow_university_by_night.jpg', 'Light trails by Moscow State University', 'okruz', 'CC BY-SA 4.0', 'Lomonossow_university_by_night.jpg'),
    photo('a/ad', 'Lorch_and_Niederheimbach_at_night.jpg', 'Rhine valley road at night, Lorch', 'Bertram Nudelbach', 'CC BY-SA 2.0', 'Lorch_and_Niederheimbach_at_night.jpg'),
    photo('6/62', 'Night_road_in_long_exposure_%28Unsplash%29.jpg', 'Night road, long exposure', 'Osman Rana', 'CC0', 'Night_road_in_long_exposure_(Unsplash).jpg'),
    photo('5/53', 'Light_Trails_%2816217364628%29.jpg', 'City light trails', 'Aleem Yousaf', 'CC BY-SA 2.0', 'Light_Trails_(16217364628).jpg'),
  ] },
  { id: 'country', name: 'Country roads', photos: [
    photo('f/f5', 'Middle_of_Rural_road_with_trees.jpg', 'Rural road through the trees', 'Candeadly', 'CC BY 4.0', 'Middle_of_Rural_road_with_trees.jpg'),
    photo('3/3c', 'Rural_road_with_trees.jpg', 'Bend in a rural road', 'Candeadly', 'CC BY 4.0', 'Rural_road_with_trees.jpg'),
    photo('1/1b', 'SC_1184_camino_a_Dos_Naciones_proximo_a_escuela_34_Jose_Belmonte.jpg', 'Country road towards Dos Naciones, Argentina', 'Ruta40ar', 'CC BY-SA 4.0', 'SC_1184_camino_a_Dos_Naciones_proximo_a_escuela_34_Jose_Belmonte.jpg'),
    photo('a/a8', 'Errepide_bat.jpg', 'Road through the woods', 'Marcu Ioachim', 'CC0', 'Errepide_bat.jpg'),
    photo('9/9b', 'Ontario_Rural_Summer_Rainstorm.jpg', 'Summer rainstorm, rural Ontario', 'Paul Harrison', 'CC BY-SA 4.0', 'Ontario_Rural_Summer_Rainstorm.jpg'),
    photo('d/db', 'Thomas_Lefebvre_2014-10-12_%28Unsplash%29.jpg', 'Autumn road', 'Thomas Lefebvre', 'CC0', 'Thomas_Lefebvre_2014-10-12_(Unsplash).jpg'),
    photo('4/42', 'Paisaje_la_tina%2C_suyo.jpg', 'Road through the hills, Honduras', 'Lic Moisés Amaya', 'CC BY-SA 4.0', 'Paisaje_la_tina,_suyo.jpg'),
    photo('e/ea', 'Cote_-_panoramio_%281%29.jpg', 'Autumn hill road, Quebec', 'Mario Hains', 'CC BY-SA 3.0', 'Cote_-_panoramio_(1).jpg'),
  ] },
  { id: 'mountain', name: 'Mountain roads', photos: [
    photo('8/89', 'Bergtocht_van_Tschiertschen_%281350_meter%29_via_Runcaspinas_naar_Alp_Farur_%281940_meter%29_023.jpg', 'Mountain road near Tschiertschen, Switzerland', 'Agnes Monkelbaan', 'CC BY-SA 4.0', 'Bergtocht_van_Tschiertschen_(1350_meter)_via_Runcaspinas_naar_Alp_Farur_(1940_meter)_023.jpg'),
    photo('9/98', 'RO_B_Transfagarasan_view_towards_the_north_from_Balea_Lake_2.jpg', 'Transfăgărășan hairpins, Romania', 'Andrei Stroe', 'CC BY-SA 3.0', 'RO_B_Transfagarasan_view_towards_the_north_from_Balea_Lake_2.jpg'),
    photo('e/e0', 'RO_SB_Transfagarasan.jpg', 'Transfăgărășan road, Romania', 'Andrei Stroe', 'CC BY 3.0', 'RO_SB_Transfagarasan.jpg'),
    photo('e/e2', 'Above_the_clouds_on_the_way_to_Borgarfjorour_Eystsa%2C_Iceland_%2836233223976%29.jpg', 'Above the clouds, east Iceland', 'Barry Marsh', 'Public domain', 'Above_the_clouds_on_the_way_to_Borgarfjorour_Eystsa,_Iceland_(36233223976).jpg'),
    photo('0/0b', 'Al-Hada_mountain_road%2C_al-Taif_region%2C_Saudi_Arabia_%284%29.jpg', 'Al-Hada mountain road, Saudi Arabia', 'Richard Mortel', 'CC BY 2.0', 'Al-Hada_mountain_road,_al-Taif_region,_Saudi_Arabia_(4).jpg'),
    photo('8/8d', 'Rishikesh_Road_Trip.jpg', 'Hill road near Rishikesh, India', 'Raghavanand98', 'CC BY-SA 4.0', 'Rishikesh_Road_Trip.jpg'),
    photo('a/ab', 'Winding_road_at_Zuluk_village.jpg', 'Winding road at Zuluk, Sikkim', 'Laluttam', 'CC BY-SA 4.0', 'Winding_road_at_Zuluk_village.jpg'),
    photo('0/0f', 'Road_in_Romania_%2815234759642%29.jpg', 'Transfăgărășan from above, Romania', 'Rob Stoeltje', 'CC BY 2.0', 'Road_in_Romania_(15234759642).jpg'),
    photo('f/f1', 'Sibiu_County_%2815212126266%29.jpg', 'Valley road, Sibiu County, Romania', 'Rob Stoeltje', 'CC BY 2.0', 'Sibiu_County_(15212126266).jpg'),
  ] },
  { id: 'coast', name: 'Coastal roads', photos: [
    photo('2/23', 'Chapman%27s_Peak%2C_South_Africa.jpg', 'Chapman\'s Peak Drive, South Africa', 'Mike Peel', 'CC BY-SA 4.0', 'Chapman%27s_Peak,_South_Africa.jpg'),
    photo('3/3a', 'Big_Creek_Bridge_%288178255034%29.jpg', 'Big Creek Bridge, Big Sur, California', 'Alan Stark', 'CC BY-SA 2.0', 'Big_Creek_Bridge_(8178255034).jpg'),
    photo('3/3b', 'Great_Ocean_Road_%28_Ank_Kumar_Infosys%29_01.jpg', 'Great Ocean Road, Australia', 'Ank kumar', 'CC BY-SA 4.0', 'Great_Ocean_Road_(_Ank_Kumar_Infosys)_01.jpg'),
    photo('6/6d', 'Great_Ocean_Road_%28_Ank_Kumar_Infosys%29_04.jpg', 'Great Ocean Road surf, Australia', 'Ank kumar', 'CC BY-SA 4.0', 'Great_Ocean_Road_(_Ank_Kumar_Infosys)_04.jpg'),
    photo('d/db', 'Great_Ocean_Road_%28_Ank_Kumar_Infosys%29_10.jpg', 'Great Ocean Road from the roadside', 'Ank kumar', 'CC BY-SA 4.0', 'Great_Ocean_Road_(_Ank_Kumar_Infosys)_10.jpg'),
    photo('c/c2', 'Great_Ocean_Road_%28_Ank_Kumar_Infosys%29_13.jpg', 'Great Ocean Road beach, Australia', 'Ank kumar', 'CC BY-SA 4.0', 'Great_Ocean_Road_(_Ank_Kumar_Infosys)_13.jpg'),
    photo('a/aa', 'Great_Ocean_Road_%28_Ank_Kumar_Infosys%29_15.jpg', 'Great Ocean Road headland', 'Ank kumar', 'CC BY-SA 4.0', 'Great_Ocean_Road_(_Ank_Kumar_Infosys)_15.jpg'),
    photo('2/2c', 'Great_Ocean_Road_%28_Ank_Kumar_Infosys%29_17.jpg', 'Great Ocean Road bay', 'Ank kumar', 'CC BY-SA 4.0', 'Great_Ocean_Road_(_Ank_Kumar_Infosys)_17.jpg'),
  ] },
  { id: 'rain-fog', name: 'Rain & fog', photos: [
    photo('3/36', 'District-Kota-Marudu_Sabah_Jalan-Marak-Parak-01.jpg', 'Wet road, Kota Marudu, Sabah', 'Uwe Aranas', 'CC BY-SA 3.0', 'District-Kota-Marudu_Sabah_Jalan-Marak-Parak-01.jpg'),
    photo('a/ac', 'Woodlands_Road_09-08-2025.jpg', 'Woodlands Road after rain, Singapore', 'LN9267', 'CC BY-SA 4.0', 'Woodlands_Road_09-08-2025.jpg'),
    photo('0/0c', 'Kuopio_traffic_lights.jpg', 'Wet night junction, Kuopio, Finland', 'kallerna', 'CC BY-SA 4.0', 'Kuopio_traffic_lights.jpg'),
    photo('a/af', '%D0%9C%D0%9A%D0%90%D0%94_-_panoramio_%281%29.jpg', 'Moscow ring road after rain', 'AndrewBaskakov', 'CC BY-SA 3.0', '%D0%9C%D0%9A%D0%90%D0%94_-_panoramio_(1).jpg'),
    photo('7/7d', 'Wet_forest_road_%28Unsplash_86T4OpohLTI%29.jpg', 'Wet forest road', 'Joe Gardner', 'CC0', 'Wet_forest_road_(Unsplash_86T4OpohLTI).jpg'),
    photo('f/f6', 'Road_in_Rain.JPG', 'Road in the rain, Kerala', 'S Rahul Bose', 'CC BY-SA 4.0', 'Road_in_Rain.JPG'),
    photo('2/29', 'Nottingham_Express_Transit_-_Market_Street%2C_Nottingham_-_tram_212_-_William_Booth_%2815705981068%29.jpg', 'Tram on a wet street, Nottingham', 'Elliott Brown', 'CC BY-SA 2.0', 'Nottingham_Express_Transit_-_Market_Street,_Nottingham_-_tram_212_-_William_Booth_(15705981068).jpg'),
    photo('5/52', '%D0%A8%D0%B2%D0%B5%D1%86%D0%B8%D1%8F_%28Sweden%29_-_panoramio_%286%29.jpg', 'Wet road through the hills, Sweden', 'Андрей Бобровский', 'CC BY 3.0', '%D0%A8%D0%B2%D0%B5%D1%86%D0%B8%D1%8F_(Sweden)_-_panoramio_(6).jpg'),
  ] },
  { id: 'snow', name: 'Snow', photos: [
    photo('a/af', 'Chemin_Turcotte_et_central_maine_-_panoramio.jpg', 'Snowy road through a windscreen, Quebec', 'Mario Hains', 'CC BY-SA 3.0', 'Chemin_Turcotte_et_central_maine_-_panoramio.jpg'),
    photo('7/76', 'Ghostly_-_Flickr_-_mripp.jpg', 'Snowy road into the mist', 'Matthias Ripp', 'CC BY 2.0', 'Ghostly_-_Flickr_-_mripp.jpg'),
    photo('9/90', 'High_Trestle_Trail_in_Winter_-_Night_Headlamp_-_Madrid%2C_Iowa_%2824196836569%29.jpg', 'Snowy trail at night, Iowa', 'Tony Webster', 'CC BY-SA 2.0', 'High_Trestle_Trail_in_Winter_-_Night_Headlamp_-_Madrid,_Iowa_(24196836569).jpg'),
    photo('c/c2', 'It_feels_cold.jpg', 'Snowy boulevard', 'Paywand yassin', 'CC BY-SA 4.0', 'It_feels_cold.jpg'),
    photo('f/fd', 'Snowy_road_in_Tieringen%2C_Baden-W%C3%BCrttemberg.jpg', 'Snowy village road, Tieringen, Germany', 'Olga Ernst', 'CC BY-SA 4.0', 'Snowy_road_in_Tieringen,_Baden-W%C3%BCrttemberg.jpg'),
    photo('0/0a', 'Wintery_Road_Wonderland_-_Flickr_-_Lenny_K_Photography.jpg', 'Road through snowy forest', 'Lenny K Photography', 'CC BY 2.0', 'Wintery_Road_Wonderland_-_Flickr_-_Lenny_K_Photography.jpg'),
    photo('b/be', 'Pixella15838_%2823698565124%29.jpg', 'Car in a snowstorm', 'Pixel.la', 'CC0', 'Pixella15838_(23698565124).jpg'),
    photo('c/ca', '20180118_Tributaries_of_the_Uono_River_37.255270%2C_138.863270.jpg', 'Winter road, Niigata, Japan', 'Tyutyanya', 'CC0', '20180118_Tributaries_of_the_Uono_River_37.255270,_138.863270.jpg'),
    photo('b/bf', '20180122_Joetsu_Shinkansen-Uonogawa_Bridge.jpg', 'Wet winter road, Niigata, Japan', 'Tyutyanya', 'CC BY-SA 4.0', '20180122_Joetsu_Shinkansen-Uonogawa_Bridge.jpg'),
  ] },
  { id: 'desert', name: 'Desert & open road', photos: [
    photo('a/a6', 'Monument_Valley_Arizona_october_2012_sunrise_view.jpg', 'Monument Valley at sunrise', 'Wolfgang Moroder', 'CC BY-SA 3.0', 'Monument_Valley_Arizona_october_2012_sunrise_view.jpg'),
    photo('f/f7', 'Fog_Valley_%2819489500310%29.jpg', 'Dusty dawn, Monument Valley', 'Romain Guy', 'CC0', 'Fog_Valley_(19489500310).jpg'),
    photo('7/7b', 'Monument_Valley%2C_AZ_%2848566079876%29.jpg', 'The road into Monument Valley', 'David Zhang', 'CC BY-SA 2.0', 'Monument_Valley,_AZ_(48566079876).jpg'),
    photo('8/87', 'Monument_Valley_at_sunrise_%2812164880075%29.jpg', 'Monument Valley at dawn', 'cloud.shepherd', 'CC BY 2.0', 'Monument_Valley_at_sunrise_(12164880075).jpg'),
    photo('b/b6', 'Monument_Valley_Aussichtspunkt.JPG', 'Monument Valley viewpoint', 'Sören Plenge', 'CC BY-SA 4.0', 'Monument_Valley_Aussichtspunkt.JPG'),
    photo('f/f4', 'Monument_Valley_-_Sacred_Lands_%2850639134162%29.jpg', 'Monument Valley sunset', 'G. Lamar', 'CC BY 2.0', 'Monument_Valley_-_Sacred_Lands_(50639134162).jpg'),
  ] },
  { id: 'city-day', name: 'City streets', photos: [
    photo('4/41', 'East_of_JR_Kamata_Station_in_Tokyo.jpg', 'Street by Kamata Station, Tokyo', 'Doricono', 'CC BY-SA 4.0', 'East_of_JR_Kamata_Station_in_Tokyo.jpg'),
    photo('0/08', 'Arakawa_line_trams_2024_1.jpg', 'Tram crossing, Arakawa, Tokyo', 'Smiley.toerist', 'CC BY-SA 4.0', 'Arakawa_line_trams_2024_1.jpg'),
    photo('e/e8', 'Arakawa_line_trams_2024_2.jpg', 'Junction in Arakawa, Tokyo', 'Smiley.toerist', 'CC BY-SA 4.0', 'Arakawa_line_trams_2024_2.jpg'),
    photo('6/6a', '2024-10-20_A_street_in_Tokyo_02.jpg', 'Street with the Skytree, Tokyo', 'Alexkom000', 'CC BY 4.0', '2024-10-20_A_street_in_Tokyo_02.jpg'),
    photo('2/24', 'GB_London_sklepy_01.jpg', 'Street in central London', 'Wladyslaw Golinski', 'CC BY-SA 4.0', 'GB_London_sklepy_01.jpg'),
    photo('1/18', 'GB_London_sklepy_02.jpg', 'Busy street, central London', 'Wladyslaw Golinski', 'CC BY-SA 4.0', 'GB_London_sklepy_02.jpg'),
    photo('8/82', 'GB_London_sklepy_07.jpg', 'Mansion-block street, London', 'Wladyslaw Golinski', 'CC BY-SA 4.0', 'GB_London_sklepy_07.jpg'),
    photo('c/c9', 'GB_London_Street_View_%28suburb%29_04.jpg', 'Suburban road, London', 'Wladyslaw Golinski', 'CC BY-SA 4.0', 'GB_London_Street_View_(suburb)_04.jpg'),
  ] },
];

// Click-through slideshow over one collection (or all of them). Loads the photo, hands
// it to the renderer, and quietly preloads the next one so "Next" feels instant.
export class PhotoSlideshow {
  constructor({ onPhoto, onError } = {}) {
    this.onPhoto = onPhoto; this.onError = onError;
    this.cache = new Map(); this.token = 0;
    this.setCollection('night-red', false);
  }
  // id: a COLLECTIONS id, or 'all' (every photo, shuffled)
  setCollection(id, show = true) {
    const c = COLLECTIONS.find((k) => k.id === id);
    if (c) this.list = c.photos;
    else {
      id = 'all';
      this.list = COLLECTIONS.flatMap((k) => k.photos).sort(() => Math.random() - 0.5);
    }
    this.collection = id; this.index = 0;
    if (show) return this.show(0);
  }
  load(i) {
    const n = this.list.length;
    const ph = this.list[((i % n) + n) % n];
    if (this.cache.has(ph.url)) return this.cache.get(ph.url);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';           // needed so WebGL may read the pixels
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => { this.cache.delete(ph.url); reject(new Error('Could not load ' + ph.title)); };
      img.src = ph.url;
    });
    this.cache.set(ph.url, p);
    if (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value);   // big images: keep a few
    return p;
  }
  async show(i) {
    const n = this.list.length;
    this.index = ((i % n) + n) % n;
    const token = ++this.token;
    try {
      const img = await this.load(this.index);
      if (token !== this.token) return;          // a newer click won
      this.onPhoto?.(img, this.list[this.index], this.index, n);
      this.load(this.index + 1).catch(() => {}); // preload the next one
    } catch (e) { if (token === this.token) this.onError?.(e); }
  }
  start() { return this.show(this.index); }
  next() { return this.show(this.index + 1); }
  prev() { return this.show(this.index - 1); }
}
