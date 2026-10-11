/* Barnocraft WEB — texture sources: bundled PNGs, texture packs, procedural pixel art
 * (ports of WorldView/EquipmentTextures) and the Barnocraft 5×7 cube font. */
(function () {
'use strict';
const BC = globalThis.BC;

function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
BC.canvas = canvas;

/** A tiny ARGB raster mirroring java.awt.image.BufferedImage + Graphics2D (no antialiasing). */
class Raster {
  constructor(w, h) { this.w = w; this.h = h; this.data = new Uint32Array(w * h); this.tx = 0; this.ty = 0; }
  set(x, y, argb) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = argb >>> 0; }
  fillRect(x, y, w, h, rgb) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i + this.tx, y + j + this.ty, 0xff000000 | rgb); }
  polygon(rgb, ...xy) {
    const xs = [], ys = [];
    for (let i = 0; i < xy.length; i += 2) { xs.push(xy[i] + this.tx); ys.push(xy[i + 1] + this.ty); }
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const px = x + .5, py = y + .5; let inside = false;
      for (let i = 0, j = xs.length - 1; i < xs.length; j = i++)
        if ((ys[i] > py) !== (ys[j] > py) && px < (xs[j] - xs[i]) * (py - ys[i]) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
      if (inside) this.set(x, y, 0xff000000 | rgb);
    }
  }
  line(rgb, x0, y0, x1, y1) {
    x0 += this.tx; x1 += this.tx; y0 += this.ty; y1 += this.ty;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, 0xff000000 | rgb);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  toCanvas() {
    const c = canvas(this.w, this.h), g = c.getContext('2d'), img = g.createImageData(this.w, this.h);
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i];
      img.data[i * 4] = (v >>> 16) & 255; img.data[i * 4 + 1] = (v >>> 8) & 255; img.data[i * 4 + 2] = v & 255; img.data[i * 4 + 3] = v >>> 24;
    }
    g.putImageData(img, 0, 0); return c;
  }
}
const pixels = (w, h, fn) => { const r = new Raster(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y); if (c !== null) r.set(x, y, c); } return r; };

// ---------------------------------------------------------------- procedural block and item textures
const GEN = {
  'stonecutter.png': () => pixels(16, 16, (x, y) => {
    const stone = [0xff777d7c, 0xff858b89, 0xff686f6e, 0xff929895];
    const seam = y % 8 === 0 || (x + (y < 8 ? 0 : 4)) % 8 === 0;
    let c = seam ? 0xff4e5555 : stone[(x * 3 + y * 5) % 4];
    const dx = x - 7.5, dy = y - 7.5, r = Math.sqrt(dx * dx + dy * dy);
    if (r < 6 && (r < 5 || (x + y) % 2 === 0)) c = 0xffbecbd0;
    if (r < 4.1) c = 0xff87989f;
    if (Math.abs(dx + dy) < 1.2 && r < 4.5) c = 0xffe1eaeb;
    if (r < 1.4) c = 0xff343e42;
    return c;
  }),
  'furnace.png': () => pixels(16, 16, (x, y) => {
    const seam = y % 4 === 0 || (x + (((y / 4) | 0) % 2) * 4) % 8 === 0;
    let c = seam ? 0xff393b3d : ((x * 7 + y * 3) % 5 === 0 ? 0xff858788 : 0xff6c7174);
    if (x >= 3 && x <= 12 && y >= 5 && y <= 12) c = 0xff202426;
    if (x >= 4 && x <= 11 && y >= 9 && y <= 11) c = (x + y) % 3 === 0 ? 0xffffc557 : 0xffd46a29;
    if (y === 8 && x >= 3 && x <= 12) c = 0xff42494d;
    if ((x === 2 || x === 13) && (y === 4 || y === 13)) c = 0xffaeb4b5;
    return c;
  }),
  'farmland.png': () => pixels(16, 16, (x, y) => y === 0 ? 0xff8b6947 : (y === 2 || y === 8 || y === 14) ? 0xffa77b4b : ((x + y * 3) % 7 === 0 ? 0xff795438 : 0xff68472f)),
  'wheat.png': () => {
    const r = new Raster(16, 16);
    for (let y = 3; y < 14; y++) {
      const x = 7 + (y % 3 === 0 ? 1 : 0); r.set(x, y, 0xffa77a35); r.set(x + 1, y, 0xffd2a64c);
      if (y < 9 && y % 2 === 0) { r.set(x - 2, y, 0xffb7b84a); r.set(x - 1, y - 1, 0xffd7cb62); r.set(x + 2, y - 2, 0xffc8bd55); }
    }
    for (let x = 6; x <= 9; x++) r.set(x, 14, 0xff8b6335);
    return r;
  },
  'wheat_seeds.png': () => {
    const r = new Raster(16, 16);
    for (const [x, y] of [[4, 5], [8, 4], [11, 7], [5, 10], [9, 12], [12, 11]]) { r.set(x, y, 0xff87602f); r.set(x + 1, y, 0xffd5b45d); }
    return r;
  },
  'bread.png': () => {
    const r = new Raster(16, 16);
    for (let y = 5; y <= 11; y++) for (let x = 3; x <= 12; x++) r.set(x, y, (x === 3 || x === 12 || y === 10 || y === 11) ? 0xff9a5d2b : 0xffe2b968);
    r.set(5, 6, 0xffffd989); r.set(9, 7, 0xffffd989); r.set(7, 9, 0xffc98a3e);
    return r;
  },
  'chest.png': () => pixels(16, 16, (x, y) => {
    const frame = x < 2 || x > 13 || y < 2 || y > 13, seam = y === 5 || y === 6, grain = (x * 13 + y * 7) % 9;
    let c = frame ? 0xff503321 : seam ? 0xff352318 : ((y % 4 === 0) ? 0xff80502b : (grain < 3 ? 0xffad783e : 0xff996332));
    if ((x === 2 || x === 13) && !frame) c = 0xffc6944b;
    if ((x === 1 || x === 14) && (y === 2 || y === 13)) c = 0xffd8bd77;
    if (x >= 7 && x <= 8 && y >= 5 && y <= 9) c = y === 8 ? 0xff4c4435 : 0xffe2c36d;
    return c;
  }),
  'lantern.png': () => pixels(16, 16, (x, y) => {
    const frame = x < 3 || x > 12 || y < 3 || y > 12;
    let c = frame ? 0xff394650 : ((x + y) % 4 === 0 ? 0xffffe6a4 : 0xffffbd4c);
    if (!frame && x === 4) c = 0xfffff2cf;
    return c;
  }),
  'bed.png': () => pixels(16, 16, (x, y) => (x === 1 || x === 14) ? 0xffd5876d : (x + y) % 6 === 0 ? 0xffac3e3c : 0xff90302f),
  'pillow.png': () => pixels(16, 16, (x, y) => x === 0 || y === 0 || x === 15 || y === 15 ? 0xffbdbbb0 : ((x + y) % 7 === 0 ? 0xffddd9cd : 0xffeee9dd)),
  'furnace_side.png': () => pixels(16, 16, (x, y) => {
    const seam = y % 4 === 0 || (x + (((y / 4) | 0) % 2) * 4) % 8 === 0;
    return seam ? 0xff393b3d : ((x * 7 + y * 3) % 5 === 0 ? 0xff858788 : 0xff6c7174);
  }),
  'water.png': () => pixels(16, 16, (x, y) => ((x + y * 3) % 7 < 2) ? 0xff5db8d0 : 0xff287aa5),
  'mutton.png': () => pixels(16, 16, (x, y) => {
    if (y < 4 || y > 11 || x < 3 || x > 12) return null;
    let c = (x === 3 || x === 12 || y === 4 || y === 11) ? 0xff74402e : 0xffb85e55;
    if ((x + y) % 4 === 0) c = 0xffd6a08a; return c;
  }),
  'cooked_mutton.png': () => pixels(16, 16, (x, y) => {
    if (y < 4 || y > 11 || x < 3 || x > 12) return null;
    let c = (x === 3 || x === 12 || y === 4 || y === 11) ? 0xff633522 : 0xffb87438;
    if ((x + y) % 4 === 0) c = 0xffe0b66c; return c;
  }),
  'wool.png': () => pixels(16, 16, (x, y) => {
    if (y < 3 || y > 12 || x < 3 || x > 12) return null;
    if (x === 3 || x === 12 || y === 3 || y === 12) return 0xff77786f;
    return ((x + y) % 4 === 0) ? 0xffb9b8aa : 0xffe8e5d4;
  }),
  'torch.png': () => {
    const r = new Raster(16, 16);
    for (let y = 5; y < 15; y++) { const x = 7 + (y % 2 === 0 ? 0 : 1); r.set(x, y, 0xff754623); r.set(x + 1, y, 0xffaa7138); }
    r.set(7, 4, 0xffffd34e); r.set(8, 4, 0xffff8e32); r.set(7, 3, 0xffff8e32); r.set(8, 3, 0xffffe66b);
    r.set(6, 5, 0xffffa632); r.set(9, 5, 0xffffa632);
    return r;
  },
  'stone_hoe.png': () => equipment('stone_shovel.png')
};
function workshop(name) {
  const r = new Raster(16, 16);
  const base = name.endsWith('welder.png') ? 0x49636a : name.endsWith('casting_table.png') ? 0x6b5544 : 0x777d7c;
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    const shade = ((x + y) % 4 === 0) ? 18 : 0;
    r.set(x, y, 0xff000000 | Math.min(255, ((base >> 16) & 255) + shade) << 16 | Math.min(255, ((base >> 8) & 255) + shade) << 8 | Math.min(255, (base & 255) + shade));
  }
  if (name.endsWith('bucket.png')) {
    for (let y = 5; y < 13; y++) for (let x = 4; x < 12; x++) r.set(x, y, name.endsWith('water_bucket.png') ? 0xff3b86b0 : 0xffa9b4b5);
    for (let x = 5; x < 11; x++) { r.set(x, 4, 0xff596366); r.set(x, 13, 0xff596366); }
  } else if (name.includes('mold')) {
    for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) if (x === 3 || x === 12 || y === 4 || y === 11) r.set(x, y, 0xffc28b54);
    r.set(7, 7, 0xffe0b878); r.set(8, 7, 0xffe0b878);
  } else {
    for (let x = 3; x < 13; x++) { r.set(x, 3, 0xffc3a16b); r.set(x, 12, 0xff302b28); }
    for (let y = 4; y < 12; y++) { r.set(3, y, 0xff302b28); r.set(12, y, 0xff302b28); }
  }
  return r;
}
['casting_table.png', 'welder.png', 'bucket_mold.png', 'axe_mold.png', 'pickaxe_mold.png', 'shovel_mold.png', 'bucket.png', 'water_bucket.png']
  .forEach(n => { GEN[n] = () => workshop(n); });

const EQUIPMENT = /^(stone|iron|gold)_(axe|pickaxe|shovel)(_head)?\.png$/;
const equipmentSupports = f => EQUIPMENT.test(f) || ['gold.png', 'gold_ingot.png', 'iron_ingot.png', 'rotator.png', 'sharp_stick.png', 'stone_blade.png'].includes(f);
function handle(g) {
  g.polygon(0x35271f, 3, 25, 19, 9, 23, 13, 7, 29, 3, 29);
  g.polygon(0x926137, 5, 25, 20, 10, 22, 13, 7, 27, 5, 27);
  g.line(0xc99551, 6, 25, 20, 11);
  g.line(0x493224, 6, 23, 9, 26); g.line(0x493224, 9, 20, 12, 23);
}
/** Pixel-art equipment: shared silhouettes, separate material palettes and head-only icons. */
function equipment(file) {
  const g = new Raster(32, 32);
  const gold = file.startsWith('gold'), iron = file.startsWith('iron');
  const dark = gold ? 0x765019 : iron ? 0x354552 : 0x343c42, mid = gold ? 0xdba52c : iron ? 0x96abb9 : 0x78848a, light = gold ? 0xffe58a : iron ? 0xe4f0f1 : 0xb6c0bb;
  if (file === 'gold.png') {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const v = 91 + BC.floorMod(x * 71 + y * 43 + x * y * 3, 32);
      g.set(x, y, 0xff000000 | v << 16 | (v + 4) << 8 | (v + 7));
    }
    for (const [nx, ny] of [[5, 5], [20, 4], [12, 14], [24, 23], [4, 25]]) {
      g.fillRect(nx - 1, ny - 1, 7, 6, dark); g.fillRect(nx, ny, 5, 4, mid); g.fillRect(nx, ny, 3, 1, light); g.fillRect(nx, ny + 1, 1, 2, light);
    }
  } else if (file.endsWith('ingot.png')) {
    g.polygon(dark, 3, 16, 10, 8, 25, 8, 29, 15, 26, 23, 6, 23);
    g.polygon(mid, 5, 16, 10, 10, 24, 10, 26, 16, 24, 21, 7, 21);
    g.polygon(light, 7, 15, 11, 10, 23, 10, 25, 15);
    g.line(0xfff7cf, 11, 11, 21, 11); g.line(dark, 7, 17, 24, 17);
  } else if (file === 'rotator.png') {
    handle(g);
    g.polygon(0x674917, 10, 4, 20, 2, 28, 9, 28, 18, 23, 23, 15, 23, 10, 18, 10, 12, 15, 12, 15, 17, 18, 19, 22, 18, 24, 15, 23, 11, 20, 8, 15, 9);
    g.polygon(0xe5b63d, 12, 5, 20, 4, 26, 10, 26, 17, 22, 21, 16, 21, 12, 17, 12, 14, 14, 14, 14, 18, 18, 21, 23, 19, 26, 15, 24, 10, 20, 6, 14, 8);
    g.polygon(0xffe99c, 10, 3, 10, 11, 18, 10);
  } else if (file === 'sharp_stick.png') {
    handle(g);
    g.polygon(0x483523, 17, 13, 27, 3, 24, 16, 20, 19);
    g.polygon(0xdac193, 20, 13, 26, 5, 23, 15);
  } else if (file === 'stone_blade.png') {
    g.polygon(dark, 4, 13, 8, 6, 18, 3, 27, 10, 29, 20, 21, 28, 10, 27, 3, 21);
    g.polygon(mid, 6, 14, 10, 8, 18, 5, 25, 11, 27, 19, 20, 26, 11, 25, 5, 20);
    g.polygon(light, 7, 13, 11, 9, 18, 6, 24, 11, 16, 11);
    g.fillRect(14, 14, 5, 5, dark);
  } else {
    const head = file.includes('_head');
    if (!head) handle(g); else { g.tx = -3; g.ty = 5; }
    if (file.includes('pickaxe')) {
      g.polygon(dark, 7, 10, 12, 5, 21, 3, 26, 6, 29, 12, 30, 18, 27, 17, 24, 12, 20, 9, 14, 10, 8, 13);
      g.polygon(mid, 9, 10, 13, 7, 21, 5, 25, 8, 27, 12, 28, 15, 24, 10, 20, 7, 14, 8);
      g.line(light, 13, 6, 21, 4); g.line(light, 22, 5, 25, 8);
    } else if (file.includes('shovel')) {
      g.polygon(dark, 16, 7, 23, 3, 29, 9, 25, 17, 21, 20, 14, 13);
      g.polygon(mid, 17, 8, 23, 5, 27, 9, 24, 15, 21, 17, 16, 12);
      g.polygon(light, 23, 6, 26, 9, 23, 13, 20, 15, 18, 12);
    } else {
      g.polygon(dark, 14, 5, 22, 3, 29, 6, 30, 13, 26, 19, 21, 17, 21, 12, 16, 14, 12, 10);
      g.polygon(mid, 15, 6, 22, 5, 27, 7, 28, 12, 25, 16, 23, 15, 23, 9, 17, 12, 14, 9);
      g.polygon(light, 26, 7, 28, 8, 29, 12, 26, 17, 24, 16, 26, 12);
    }
    if (!head) { g.fillRect(17, 12, 5, 2, 0x553c27); g.fillRect(18, 12, 3, 1, 0xc3a16a); }
  }
  return g;
}

const HELL_FILES = new Set(['ember_crystal.png', 'portal_frame.png', 'forest_portal.png']);
const sources = new Map(), icons = new Map();
BC.Textures = {
  pack: 0,
  images: {},
  /** Decode the bundled PNG data URIs once. */
  load() {
    const data = BC.TEXTURE_DATA || {};
    return Promise.all(Object.entries(data).map(([name, uri]) => new Promise(resolve => {
      const img = new Image();
      img.onload = () => { this.images[name] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = uri;
    })));
  },
  setPack(pack) { if (pack !== this.pack) { this.pack = pack; icons.clear(); } },
  packTitle: pack => pack === 1 ? 'Мягкий пиксель' : 'Оригинальные',
  path(file) {
    if (this.pack !== 1 || file.startsWith('hell_') || HELL_FILES.has(file) || file.startsWith('mod/')) return file;
    return this.images['soft/' + file] ? 'soft/' + file : file;
  },
  /** An image/canvas for a texture name; procedural textures win, like in the Java edition. */
  source(name) {
    if (sources.has(name)) return sources.get(name);
    let result = null;
    const file = name.substring(name.lastIndexOf('/') + 1);
    if (name.startsWith('mod/')) {
      const item = BC.Items.find(name.substring(4));
      const rows = item && item.definition && item.definition.icon;
      result = BC.Textures.pixelCanvas(rows || [['b67ac4', '51465c'], ['51465c', 'b67ac4']]);
      sources.set(name, result); return result; // mod icons may change after registration; cached per name
    }
    if (equipmentSupports(file)) result = equipment(file).toCanvas();
    else if (GEN[file]) result = GEN[file]().toCanvas();
    else result = this.images[name] || this.images[file] || null;
    if (!result) { result = pixels(2, 2, (x, y) => (x + y) % 2 ? 0xff51465c : 0xffb67ac4).toCanvas(); }
    sources.set(name, result);
    return result;
  },
  invalidateMods() { for (const k of Array.from(sources.keys())) if (k.startsWith('mod/')) sources.delete(k); icons.clear(); },
  pixelCanvas(rows) {
    const h = rows.length, w = rows[0].length, r = new Raster(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = String(rows[y][x]); const v = parseInt(c.substring(0, 6), 16);
      const a = c.length === 8 ? parseInt(c.substring(6), 16) : 255;
      r.set(x, y, ((a << 24) | v) >>> 0);
    }
    return r.toCanvas();
  },
  /** Item icon for the GUI at a given pixel size (cached). */
  icon(texture, size) {
    const name = this.path(texture), key = name + '@' + size;
    let c = icons.get(key); if (c) return c;
    const src = this.source(name);
    c = canvas(size, size); const g = c.getContext('2d');
    const big = (src.width || 0) > size * 2;
    g.imageSmoothingEnabled = big; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, size, size);
    icons.set(key, c); return c;
  },
  /** Square 128 px layer, vertically flipped for WebGL's bottom-up texture coordinates. */
  layerPixels(name, size) {
    const src = this.source(this.path(name)), c = canvas(size, size), g = c.getContext('2d');
    g.imageSmoothingEnabled = (src.width || 0) > size; g.imageSmoothingQuality = 'high';
    g.translate(0, size); g.scale(1, -1); g.drawImage(src, 0, 0, size, size);
    return g.getImageData(0, 0, size, size).data;
  }
};

// ---------------------------------------------------------------- cube font
const GLYPHS = new Map();
const glyph = (c, data) => GLYPHS.set(c, data.split(' ').map(v => parseInt(v, 16)));
[['A', '0E 11 11 1F 11 11 11'], ['B', '1E 11 11 1E 11 11 1E'], ['C', '0F 10 10 10 10 10 0F'], ['D', '1E 11 11 11 11 11 1E'],
 ['E', '1F 10 10 1E 10 10 1F'], ['F', '1F 10 10 1E 10 10 10'], ['G', '0F 10 10 17 11 11 0F'], ['H', '11 11 11 1F 11 11 11'],
 ['I', '1F 04 04 04 04 04 1F'], ['J', '07 02 02 02 12 12 0C'], ['K', '11 12 14 18 14 12 11'], ['L', '10 10 10 10 10 10 1F'],
 ['M', '11 1B 15 15 11 11 11'], ['N', '11 19 19 15 13 13 11'], ['O', '0E 11 11 11 11 11 0E'], ['P', '1E 11 11 1E 10 10 10'],
 ['Q', '0E 11 11 11 15 12 0D'], ['R', '1E 11 11 1E 14 12 11'], ['S', '0F 10 10 0E 01 01 1E'], ['T', '1F 04 04 04 04 04 04'],
 ['U', '11 11 11 11 11 11 0E'], ['V', '11 11 11 11 11 0A 04'], ['W', '11 11 11 15 15 1B 11'], ['X', '11 11 0A 04 0A 11 11'],
 ['Y', '11 11 0A 04 04 04 04'], ['Z', '1F 01 02 04 08 10 1F'], ['0', '0E 11 13 15 19 11 0E'], ['1', '04 0C 04 04 04 04 0E'],
 ['2', '0E 11 01 02 04 08 1F'], ['3', '1E 01 01 0E 01 01 1E'], ['4', '02 06 0A 12 1F 02 02'], ['5', '1F 10 10 1E 01 01 1E'],
 ['6', '0E 10 10 1E 11 11 0E'], ['7', '1F 01 02 04 08 08 08'], ['8', '0E 11 11 0E 11 11 0E'], ['9', '0E 11 11 0F 01 01 0E']
].forEach(([c, d]) => glyph(c, d));
'АВСЕНКМОРТХ'.split('').forEach((c, i) => GLYPHS.set(c, GLYPHS.get('ABCEHKMOPTX'[i])));
[['Б', '1F 10 10 1E 11 11 1E'], ['Г', '1F 10 10 10 10 10 10'], ['Д', '06 0A 0A 0A 0A 1F 11'], ['Ё', '0A 00 1F 10 1E 10 1F'],
 ['Ж', '15 15 0E 04 0E 15 15'], ['З', '1E 01 01 0E 01 01 1E'], ['И', '11 11 13 15 19 11 11'], ['Й', '0A 04 11 13 15 19 11'],
 ['Л', '07 09 09 09 09 09 11'], ['П', '1F 11 11 11 11 11 11'], ['У', '11 11 11 0F 01 01 1E'], ['Ф', '04 0E 15 15 15 0E 04'],
 ['Ц', '12 12 12 12 12 1F 01'], ['Ч', '11 11 11 0F 01 01 01'], ['Ш', '15 15 15 15 15 15 1F'], ['Щ', '15 15 15 15 15 1F 01'],
 ['Ъ', '18 08 08 0E 09 09 0E'], ['Ы', '11 11 11 19 15 15 19'], ['Ь', '10 10 10 1E 11 11 1E'], ['Э', '1E 01 01 0F 01 01 1E'],
 ['Ю', '12 15 15 1D 15 15 12'], ['Я', '0F 11 11 0F 05 09 11'], [' ', '00 00 00 00 00 00 00'], ['?', '0E 11 01 02 04 00 04'],
 ['!', '04 04 04 04 04 00 04'], ['.', '00 00 00 00 00 00 04'], [',', '00 00 00 00 00 04 08'], [':', '00 04 00 00 04 00 00'],
 [';', '00 04 00 00 04 04 08'], ['-', '00 00 00 1F 00 00 00'], ['_', '00 00 00 00 00 00 1F'], ['+', '00 04 04 1F 04 04 00'],
 ['=', '00 00 1F 00 1F 00 00'], ['/', '01 01 02 04 08 10 10'], ['\\', '10 10 08 04 02 01 01'], ['|', '04 04 04 04 04 04 04'],
 ['(', '02 04 08 08 08 04 02'], [')', '08 04 02 02 02 04 08'], ['[', '0E 08 08 08 08 08 0E'], [']', '0E 02 02 02 02 02 0E'],
 ['<', '01 02 04 08 04 02 01'], ['>', '10 08 04 02 04 08 10'], ['"', '0A 0A 0A 00 00 00 00'], ["'", '04 04 08 00 00 00 00'],
 ['%', '19 19 02 04 08 13 13'], ['#', '0A 0A 1F 0A 1F 0A 0A'], ['*', '00 15 0E 1F 0E 15 00'], ['@', '0E 11 17 15 17 10 0F'],
 ['&', '0C 12 14 08 15 12 0D'], ['$', '04 0F 14 0E 05 1E 04'], ['^', '04 0A 11 00 00 00 00'], ['~', '00 00 09 16 00 00 00'],
 ['`', '08 04 00 00 00 00 00'], ['{', '02 04 04 08 04 04 02'], ['}', '08 04 04 02 04 04 08'], ['♥', '00 0A 1F 1F 0E 04 00'],
 ['→', '00 04 02 1F 02 04 00'], ['←', '00 04 08 1F 08 04 00'], ['×', '00 11 0A 04 0A 11 00'], ['·', '00 00 00 04 00 00 00'],
 ['…', '00 00 00 00 00 00 15'], ['№', '11 19 15 13 11 00 1F'], ['°', '0C 12 0C 00 00 00 00'], ['↑', '04 0E 15 04 04 04 04']
].forEach(([c, d]) => glyph(c, d));
for (const c of '—–') GLYPHS.set(c, GLYPHS.get('-'));
GLYPHS.set('•', GLYPHS.get('·')); GLYPHS.set('«', GLYPHS.get('<')); GLYPHS.set('»', GLYPHS.get('>'));
for (const c of '“”„') GLYPHS.set(c, GLYPHS.get('"'));

const fontCache = new Map();
BC.CubeFont = {
  supports: c => GLYPHS.has(c.toUpperCase()),
  scale: size => Math.max(1, Math.round(size / 10)),
  width: (text, size) => Math.max(1, text.length * 6 * BC.CubeFont.scale(size) + 4),
  height: size => 8 * BC.CubeFont.scale(size) + 4,
  /** Render text with a drop shadow; the shadow is tinted like the Java material colour. */
  render(text, size, color = '#ffffff') {
    const key = text + '\u0000' + size + '\u0000' + color;
    let c = fontCache.get(key); if (c) return c;
    if (fontCache.size > 600) fontCache.clear();
    const scale = BC.CubeFont.scale(size), w = BC.CubeFont.width(text, size), h = BC.CubeFont.height(size);
    c = canvas(w, h); const g = c.getContext('2d');
    const rgb = parseInt(color.slice(1), 16), shadow = '#' + [16, 8, 0].map(s => {
      const channel = Math.round(((0x17202a >> s) & 255) * ((rgb >> s) & 255) / 255); return channel.toString(16).padStart(2, '0');
    }).join('');
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = pass === 0 ? shadow : color;
      const offset = pass === 0 ? scale : 0;
      for (let i = 0; i < text.length; i++) {
        const rows = GLYPHS.get(text[i].toUpperCase()) || GLYPHS.get('?');
        for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (rows[y] & (1 << (4 - x)))
          g.fillRect(2 + i * 6 * scale + x * scale + offset, 2 + y * scale + offset, scale, scale);
      }
    }
    fontCache.set(key, c); return c;
  }
};
})();
