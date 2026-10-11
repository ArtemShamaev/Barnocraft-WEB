/* Barnocraft WEB — shared constants, blocks, item registry, seeded randomness and noise.
 * Classic script: attaches everything to globalThis.BC so it runs from file:// and in Node tests. */
(function () {
'use strict';
const BC = globalThis.BC = globalThis.BC || {};

// ---------------------------------------------------------------- world size
BC.CHUNK = 16; BC.CHUNKS_X = 60; BC.CHUNKS_Z = 40;
BC.WIDTH = BC.CHUNK * BC.CHUNKS_X; BC.DEPTH = BC.CHUNK * BC.CHUNKS_Z; BC.HEIGHT = 128;
BC.WATER_LEVEL = 10; BC.LAVA_LEVEL = 23;
BC.REGION = 80;
// The Java edition kept 8 regions, which thrashes at render distance 5–6 (a 13×13 chunk view needs up to 16).
BC.REGION_CACHE_LIMIT = 16;

// ---------------------------------------------------------------- blocks (same order as the Java enum)
const BLOCK_DEFS = [
  ['AIR', null], ['GRASS', 'grass_2.png'], ['STONE', 'stone.png'], ['SAND', 'pesok.png'],
  ['PLANKS', 'tree_planks.png'], ['GLASS', 'glass.png'], ['LOG', 'tree.png'], ['LEAVES', 'listia.png'],
  ['COAL_ORE', 'coal.png'], ['IRON_ORE', 'iron.png'], ['DEEPSTONE', 'deeprock.png'], ['DOOR', 'door.png'],
  ['DOOR_TOP', 'door.png'], ['STAIRS', 'stairs.png'], ['ROTATOR', 'rotator.png'], ['STONECUTTER', 'stonecutter.png'],
  ['FURNACE', 'furnace.png'], ['TORCH', 'torch.png'], ['WATER', 'water.png'], ['CASTING_TABLE', 'casting_table.png'],
  ['WELDER', 'welder.png'], ['LANTERN', 'lantern.png'], ['BED', 'bed.png'], ['BED_HEAD', 'bed.png'],
  ['GOLD_ORE', 'gold.png'], ['FARMLAND', 'farmland.png'], ['CROP_0', 'listia.png'], ['CROP_1', 'listia.png'],
  ['CROP_2', 'listia.png'], ['CROP_3', 'listia.png'], ['CHEST', 'chest.png'],
  ['HELL_SOIL', 'hell_soil.png'], ['HELL_STONE', 'hell_stone.png'], ['HELL_BASALT', 'hell_basalt.png'],
  ['HELL_LOG', 'hell_log.png'], ['HELL_LEAVES', 'hell_leaves.png'], ['EMBER_CRYSTAL', 'ember_crystal.png'],
  ['HELL_LAVA', 'hell_lava.png'], ['PORTAL_FRAME', 'portal_frame.png'], ['FOREST_PORTAL', 'forest_portal.png']
];
const B = BC.B = {};
BC.BLOCK_NAMES = BLOCK_DEFS.map(d => d[0]);
BC.BLOCK_TEXTURES = BLOCK_DEFS.map(d => d[1]);
BLOCK_DEFS.forEach((d, i) => { B[d[0]] = i; });
BC.BLOCK_COUNT = BLOCK_DEFS.length;
BC.HOTBAR_SIZE = 10;

const isCrop = b => b >= B.CROP_0 && b <= B.CROP_3;
const table = fn => { const t = new Uint8Array(BC.BLOCK_COUNT); for (let b = 0; b < t.length; b++) t[b] = fn(b) ? 1 : 0; return t; };
const SOLID = table(b => b !== B.FOREST_PORTAL && b !== B.HELL_LAVA && b !== B.AIR && b !== B.WATER && b !== B.ROTATOR
  && b !== B.TORCH && b !== B.LANTERN && !isCrop(b));
const IMMUTABLE = table(b => b === B.PORTAL_FRAME || b === B.FOREST_PORTAL);
const DOOR = table(b => b === B.DOOR || b === B.DOOR_TOP);
const BED = table(b => b === B.BED || b === B.BED_HEAD);
// Partial models admit light through the empty space in their voxel.
const BLOCKS_LIGHT = table(b => SOLID[b] && !DOOR[b] && !BED[b] && b !== B.STAIRS && b !== B.STONECUTTER
  && b !== B.GLASS && b !== B.LEAVES && b !== B.HELL_LEAVES);
const WOOD = table(b => [B.HELL_LOG, B.HELL_LEAVES, B.LOG, B.PLANKS, B.DOOR, B.DOOR_TOP, B.STAIRS, B.LEAVES, B.BED, B.BED_HEAD, B.CHEST].includes(b));
const STONE_MAT = table(b => [B.HELL_STONE, B.HELL_BASALT, B.EMBER_CRYSTAL, B.STONE, B.DEEPSTONE, B.COAL_ORE, B.IRON_ORE,
  B.GOLD_ORE, B.STONECUTTER, B.FURNACE, B.CASTING_TABLE, B.WELDER].includes(b));
const EARTH = table(b => b === B.HELL_SOIL || b === B.GRASS || b === B.SAND);
BC.SOLID = SOLID; BC.BLOCKS_LIGHT = BLOCKS_LIGHT;

BC.Block = {
  solid: b => SOLID[b] === 1,
  immutable: b => IMMUTABLE[b] === 1,
  door: b => DOOR[b] === 1,
  bed: b => BED[b] === 1,
  rock: b => b === B.STONE || b === B.DEEPSTONE,
  crop: isCrop,
  cropStage: b => isCrop(b) ? b - B.CROP_0 : -1,
  blocksLight: b => BLOCKS_LIGHT[b] === 1,
  name: b => BC.BLOCK_NAMES[b],
  valueOf(name) {
    const id = B[String(name).toUpperCase()];
    if (id === undefined) throw new Error('Неизвестный блок: ' + name);
    return id;
  },
  baseBreakTime(b) {
    if (IMMUTABLE[b]) return Infinity;
    switch (b) {
      case B.AIR: return 0; case B.GRASS: return .60; case B.STONE: return .80; case B.SAND: return .45;
      case B.PLANKS: return .55; case B.GLASS: return 1.10; case B.LOG: return .75; case B.LEAVES: return .45;
      case B.CROP_0: case B.CROP_1: case B.CROP_2: case B.CROP_3: return .2;
      case B.COAL_ORE: return .90; case B.IRON_ORE: case B.GOLD_ORE: return 1.0; case B.DEEPSTONE: return 1.2;
      case B.DOOR: case B.DOOR_TOP: return 1.5; case B.STAIRS: return .70; case B.ROTATOR: return 0;
      default: return .75;
    }
  },
  breakTime(b, tool) {
    const base = BC.Block.baseBreakTime(b);
    if (isCrop(b) && tool === 'STONE_HOE') return base * .5;
    if ((b === B.STONE || b === B.DEEPSTONE) && tool === 'SHARP_STICK') return base * .5;
    if (WOOD[b] && tool === 'STONE_AXE') return base * .35;
    if (WOOD[b] && (tool === 'IRON_AXE' || tool === 'GOLD_AXE')) return base * .18;
    if (STONE_MAT[b] && tool === 'STONE_PICKAXE') return base * .35;
    if (STONE_MAT[b] && (tool === 'IRON_PICKAXE' || tool === 'GOLD_PICKAXE')) return base * .18;
    if (EARTH[b] && tool === 'STONE_SHOVEL') return base * .30;
    if (EARTH[b] && (tool === 'IRON_SHOVEL' || tool === 'GOLD_SHOVEL')) return base * .16;
    return base;
  }
};

BC.DIMENSIONS = { SURFACE: 'Обычный мир', HELL_FOREST: 'Адский лес' };
BC.otherDimension = d => d === 'SURFACE' ? 'HELL_FOREST' : 'SURFACE';

// ---------------------------------------------------------------- items
const MAX_STACK = BC.MAX_STACK = 64;
const REGISTRY = new Map();
const CRAFT_RECIPES = new Map();
class ItemType {
  constructor(id, title, texture) {
    this.id = id; this.title = title; this.texture = texture;
    this.definition = null; this.customDurability = 0;
    REGISTRY.set(id, this);
  }
  get name() { return this.id; }
  retired() { return this.id === 'CASTING_TABLE' || this.id === 'WELDER' || this.mold(); }
  mold() { return this.id === 'BUCKET_MOLD' || this.id === 'AXE_MOLD' || this.id === 'PICKAXE_MOLD' || this.id === 'SHOVEL_MOLD'; }
  def(key, fallback) { return this.definition && this.definition[key] !== undefined ? this.definition[key] : fallback; }
  foodValue() {
    if (this.definition && 'food' in this.definition) return intIn(this.definition.food, 0, 20);
    return this.id === 'MUTTON' ? 3 : this.id === 'COOKED_MUTTON' ? 6 : this.id === 'BREAD' ? 2 : 0;
  }
  nutrition() {
    if (this.definition && 'hunger' in this.definition) return intIn(this.definition.hunger, 0, 20);
    return this.id === 'MUTTON' ? 5 : this.id === 'COOKED_MUTTON' ? 8 : this.id === 'ROTTEN_FLESH' ? 2 : this.id === 'BREAD' ? 7 : 0;
  }
  cookingResult() {
    if (this.id === 'MUTTON') return 'COOKED_MUTTON';
    return this.definition && typeof this.definition.cooking_result === 'string' ? this.definition.cooking_result : '';
  }
  cookingProduct() {
    if (['IRON_INGOT', 'GOLD_INGOT', 'GLASS', 'COOKED_MUTTON'].includes(this.id) || (this.definition && this.definition.cooked === true)) return true;
    for (const item of REGISTRY.values()) if (item.cookingResult() === this.id) return true;
    return false;
  }
  tool() {
    if (this.id.includes(':')) return this.customDurability > 0;
    return TOOLS.has(this.id);
  }
  stackLimit() { return this.tool() || this.mold() || this.id === 'BUCKET' || this.id === 'WATER_BUCKET' ? 1 : MAX_STACK; }
  maxDurability() {
    if (this.id.includes(':')) return this.customDurability;
    if (this.mold()) return 32;
    if (this.id === 'SHARP_STICK') return 20;
    if (['STONE_AXE', 'STONE_PICKAXE', 'STONE_SHOVEL', 'STONE_HOE'].includes(this.id)) return 80;
    if (TOOLS.has(this.id)) return 250;
    return 0;
  }
}
const TOOLS = new Set(['SHARP_STICK', 'STONE_AXE', 'STONE_PICKAXE', 'STONE_SHOVEL', 'STONE_HOE', 'IRON_AXE', 'IRON_PICKAXE',
  'IRON_SHOVEL', 'GOLD_AXE', 'GOLD_PICKAXE', 'GOLD_SHOVEL', 'ROTATOR']);
function intIn(v, min, max) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error('Значение вне диапазона');
  return v;
}
[
  ['PEBBLE', 'Камушек', 'pebble.png'], ['COAL', 'Уголь', 'coal.png'], ['IRON', 'Железо', 'iron.png'],
  ['IRON_INGOT', 'Железный слиток', 'iron_ingot.png'], ['MUTTON', 'Баранина', 'mutton.png'],
  ['COOKED_MUTTON', 'Жареная баранина', 'cooked_mutton.png'], ['WOOL', 'Шерсть', 'wool.png'], ['TORCH', 'Факел', 'torch.png'],
  ['ROTTEN_FLESH', 'Гнилая плоть', 'mutton.png'], ['WHEAT_SEEDS', 'Семена пшеницы', 'wheat_seeds.png'], ['WHEAT', 'Пшеница', 'wheat.png'],
  ['BREAD', 'Хлеб', 'bread.png'], ['STICK', 'Палка', 'stick.png'], ['PLANK', 'Доска', 'tree_planks.png'], ['WOOD', 'Дерево', 'tree.png'],
  ['DIRT', 'Земля', 'grass_2.png'], ['SAND', 'Песок', 'pesok.png'], ['STONE', 'Камень', 'stone.png'], ['DEEPSTONE', 'Глубокий камень', 'deeprock.png'],
  ['GLASS', 'Стекло', 'glass.png'], ['DOOR', 'Дверь', 'door.png'], ['STAIRS', 'Ступеньки', 'stairs.png'],
  ['STONE_BLADE', 'Лезвие камнереза', 'stone_blade.png'], ['SHARP_STICK', 'Острая палка', 'sharp_stick.png'],
  ['STONECUTTER', 'Камнерез', 'stonecutter.png'], ['FURNACE', 'Печь', 'furnace.png'], ['CHEST', 'Сундук', 'chest.png'],
  ['AXE_HEAD', 'Навершие каменного топора', 'stone_axe_head.png'], ['PICKAXE_HEAD', 'Навершие каменной кирки', 'stone_pickaxe_head.png'],
  ['SHOVEL_HEAD', 'Навершие каменной лопаты', 'stone_shovel_head.png'], ['IRON_AXE_HEAD', 'Навершие железного топора', 'iron_axe_head.png'],
  ['IRON_PICKAXE_HEAD', 'Навершие железной кирки', 'iron_pickaxe_head.png'], ['IRON_SHOVEL_HEAD', 'Навершие железной лопаты', 'iron_shovel_head.png'],
  ['STONE_AXE', 'Каменный топор', 'stone_axe.png'], ['STONE_PICKAXE', 'Каменная кирка', 'stone_pickaxe.png'],
  ['STONE_SHOVEL', 'Каменная лопата', 'stone_shovel.png'], ['STONE_HOE', 'Каменная мотыга', 'stone_hoe.png'],
  ['IRON_AXE', 'Железный топор', 'iron_axe.png'], ['IRON_PICKAXE', 'Железная кирка', 'iron_pickaxe.png'],
  ['IRON_SHOVEL', 'Железная лопата', 'iron_shovel.png'], ['AXE', 'Топор', 'stone_axe.png'], ['PICKAXE', 'Кирка', 'stone_pickaxe.png'],
  ['WATER', 'Вода', 'water.png'], ['CASTING_TABLE', 'Стол для выплавки', 'casting_table.png'], ['WELDER', 'Сварочный аппарат', 'welder.png'],
  ['BUCKET_MOLD', 'Литейная форма ведра', 'bucket_mold.png'], ['AXE_MOLD', 'Литейная форма топора', 'axe_mold.png'],
  ['PICKAXE_MOLD', 'Литейная форма кирки', 'pickaxe_mold.png'], ['SHOVEL_MOLD', 'Литейная форма лопаты', 'shovel_mold.png'],
  ['BUCKET', 'Ведро', 'bucket.png'], ['WATER_BUCKET', 'Ведро воды', 'water_bucket.png'], ['LANTERN', 'Фонарь', 'lantern.png'],
  ['BED', 'Кровать', 'bed.png'], ['GOLD', 'Золото', 'gold.png'], ['GOLD_INGOT', 'Золотой слиток', 'gold_ingot.png'],
  ['GOLD_AXE_HEAD', 'Навершие золотого топора', 'gold_axe_head.png'], ['GOLD_PICKAXE_HEAD', 'Навершие золотой кирки', 'gold_pickaxe_head.png'],
  ['GOLD_SHOVEL_HEAD', 'Навершие золотой лопаты', 'gold_shovel_head.png'], ['GOLD_AXE', 'Золотой топор', 'gold_axe.png'],
  ['GOLD_PICKAXE', 'Золотая кирка', 'gold_pickaxe.png'], ['GOLD_SHOVEL', 'Золотая лопата', 'gold_shovel.png'],
  ['ROTATOR', 'Поворачиватель', 'rotator.png'], ['HELL_SOIL', 'Пепельная почва', 'hell_soil.png'],
  ['HELL_STONE', 'Адский камень', 'hell_stone.png'], ['HELL_BASALT', 'Базальт', 'hell_basalt.png'],
  ['HELL_LOG', 'Багровый ствол', 'hell_log.png'], ['HELL_LEAVES', 'Багровая листва', 'hell_leaves.png'],
  ['EMBER_CRYSTAL', 'Жар-кристалл', 'ember_crystal.png']
].forEach(([id, title, texture]) => new ItemType(id, title, texture));

const MOD_ID = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;
BC.Items = {
  MAX_STACK,
  has: id => REGISTRY.has(id),
  /** Look up an item; unknown namespaced ids become placeholders so old saves keep mod items. */
  get(id) {
    let item = REGISTRY.get(id);
    if (!item && typeof id === 'string' && MOD_ID.test(id)) { item = new ItemType(id, id, 'mod/' + id); item.customDurability = 1000000; }
    if (!item) throw new Error('Неизвестный предмет: ' + id);
    return item;
  },
  find: id => REGISTRY.get(id) || null,
  values: () => Array.from(REGISTRY.values()),
  register(id, definition) {
    if (!id.includes(':')) throw new Error('Mod items need a namespace');
    const item = BC.Items.get(id);
    item.title = typeof definition.title === 'string' ? definition.title : id;
    item.texture = 'mod/' + id;
    item.customDurability = definition.durability === undefined ? 0 : intIn(definition.durability, 0, 10000);
    item.definition = JSON.parse(JSON.stringify(definition));
    return item;
  },
  registerRecipe(namespace, definition) {
    const resultId = BC.owned(namespace, typeof definition.result === 'string' ? definition.result : '');
    const result = BC.Items.get(resultId);
    if (!result.definition) throw new Error('Unregistered recipe result: ' + resultId);
    const ingredients = new Map();
    const raw = definition.ingredients;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Recipe ingredients');
    for (const [key, value] of Object.entries(raw)) {
      const ingredient = BC.Items.get(key);
      if (key.includes(':') && !ingredient.definition) throw new Error('Unregistered recipe ingredient: ' + key);
      ingredients.set(key, intIn(value, 1, 64));
    }
    if (!ingredients.size) throw new Error('Recipe needs ingredients');
    const count = definition.count === undefined ? 1 : intIn(definition.count, 1, 64);
    CRAFT_RECIPES.set(resultId, { ingredients, result: resultId, count });
  },
  craftRecipes: () => Array.from(CRAFT_RECIPES.values())
};
BC.owned = function (namespace, id) {
  if (typeof id !== 'string' || !new RegExp('^' + namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':[a-z][a-z0-9_]*$').test(id))
    throw new Error('Foreign/invalid namespace: ' + id);
  return id;
};
BC.item = id => BC.Items.get(id);

/** Item ↔ placeable block, matching Inventory.toBlock in the Java edition. */
const ITEM_TO_BLOCK = {
  HELL_SOIL: B.HELL_SOIL, HELL_STONE: B.HELL_STONE, HELL_BASALT: B.HELL_BASALT, HELL_LOG: B.HELL_LOG, HELL_LEAVES: B.HELL_LEAVES,
  EMBER_CRYSTAL: B.EMBER_CRYSTAL, DIRT: B.GRASS, STONE: B.STONE, SAND: B.SAND, PLANK: B.PLANKS, GLASS: B.GLASS, WOOD: B.LOG,
  COAL: B.COAL_ORE, IRON: B.IRON_ORE, GOLD: B.GOLD_ORE, ROTATOR: B.ROTATOR, DEEPSTONE: B.DEEPSTONE, DOOR: B.DOOR, STAIRS: B.STAIRS,
  STONECUTTER: B.STONECUTTER, FURNACE: B.FURNACE, CHEST: B.CHEST, LANTERN: B.LANTERN, BED: B.BED, WATER: B.WATER
};
BC.toBlock = item => item && ITEM_TO_BLOCK[item] !== undefined ? ITEM_TO_BLOCK[item] : null;
const BLOCK_TO_ITEM = {};
[['HELL_SOIL', 'HELL_SOIL'], ['HELL_STONE', 'HELL_STONE'], ['HELL_BASALT', 'HELL_BASALT'], ['HELL_LOG', 'HELL_LOG'],
 ['HELL_LEAVES', 'HELL_LEAVES'], ['EMBER_CRYSTAL', 'EMBER_CRYSTAL'], ['GRASS', 'DIRT'], ['STONE', 'STONE'], ['SAND', 'SAND'],
 ['PLANKS', 'PLANK'], ['GLASS', 'GLASS'], ['LOG', 'WOOD'], ['COAL_ORE', 'COAL'], ['IRON_ORE', 'IRON'], ['GOLD_ORE', 'GOLD'],
 ['DEEPSTONE', 'DEEPSTONE'], ['DOOR', 'DOOR'], ['DOOR_TOP', 'DOOR'], ['STAIRS', 'STAIRS'], ['STONECUTTER', 'STONECUTTER'],
 ['FURNACE', 'FURNACE'], ['TORCH', 'TORCH'], ['LANTERN', 'LANTERN'], ['BED', 'BED'], ['BED_HEAD', 'BED'], ['CHEST', 'CHEST']
].forEach(([b, i]) => { BLOCK_TO_ITEM[B[b]] = i; });
BC.blockItem = b => BLOCK_TO_ITEM[b] || null;

// ---------------------------------------------------------------- deterministic randomness
function fmix32(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
BC.fmix32 = fmix32;
/** Combine a seed with any number of integer salts. */
BC.mix = function (seed, ...salts) {
  let h = fmix32((seed >>> 0) ^ 0x5bd1e995);
  for (const s of salts) h = fmix32((h ^ Math.imul((s | 0) + 0x27d4eb2f, 0x9E3779B1)) >>> 0);
  return h;
};
BC.stringSalt = function (text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};
class Rng {
  constructor(seed) { this.a = fmix32((seed >>> 0) ^ 0x6d2b79f5) || 1; }
  next() {
    let t = (this.a = (this.a + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  nextDouble() { return this.next(); }
  nextFloat() { return this.next(); }
  nextInt(n) { return Math.floor(this.next() * n); }
  nextBoolean() { return this.next() < .5; }
}
BC.Rng = Rng;
BC.randomSeed = () => (Math.random() * 4294967296) >>> 0;

/** Seeded smooth value noise in world coordinates, continuous across chunk and region seams. */
function value(seed, x, z) {
  let h = fmix32((seed ^ Math.imul(x | 0, 0x9E3779B1)) >>> 0);
  h = fmix32((h ^ Math.imul(z | 0, 0x85EBCA77)) >>> 0);
  return h / 4294967295 * 2 - 1;
}
const smooth = t => t * t * (3 - 2 * t);
BC.noise = function (seed, x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = value(seed, ix, iz), b = value(seed, ix + 1, iz), c = value(seed, ix, iz + 1), d = value(seed, ix + 1, iz + 1);
  const top = a + (b - a) * fx, bottom = c + (d - c) * fx;
  return top + (bottom - top) * fz;
};

BC.uuid = function () {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
};
BC.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
BC.floorMod = (a, n) => ((a % n) + n) % n;
})();
