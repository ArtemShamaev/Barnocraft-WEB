/* Barnocraft WEB — five world slots in IndexedDB (one atomic transaction per save, covering both
 * dimensions), settings in localStorage, export/import of a slot as a .bcw file. */
(function () {
'use strict';
const BC = globalThis.BC;
const FORMAT = 'barnocraft-web', VERSION = 1, DB_NAME = 'barnocraft-web', STORE = 'saves';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB недоступен')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Не удалось открыть хранилище'));
  });
}
/** Memory fallback (private windows, blocked storage, Node tests). */
class MemoryBackend {
  constructor() { this.map = new Map(); }
  async get(key) { const v = this.map.get(key); return v === undefined ? undefined : JSON.parse(v); }
  async putAll(entries) { for (const [k, v] of entries) this.map.set(k, JSON.stringify(v)); }
  async deleteAll(keys) { for (const k of keys) this.map.delete(k); }
  async keys() { return Array.from(this.map.keys()); }
}
class IdbBackend {
  constructor(db) { this.db = db; }
  tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(STORE, mode), store = t.objectStore(STORE);
      let result; const r = fn(store); if (r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = t.onabort = () => reject(t.error || new Error('Ошибка записи сохранения'));
    });
  }
  get(key) { return this.tx('readonly', s => s.get(key)); }
  putAll(entries) { return this.tx('readwrite', s => { for (const [k, v] of entries) s.put(v, k); }); }
  deleteAll(keys) { return this.tx('readwrite', s => { for (const k of keys) s.delete(k); }); }
  keys() { return this.tx('readonly', s => s.getAllKeys()); }
}

const slotKey = slot => { if (!(slot >= 1 && slot <= 5)) throw new Error('Слот мира должен быть 1–5'); return 'world-' + slot; };
const dimensionKey = (slot, dimension) => slotKey(slot) + '-' + dimension.toLowerCase();

function validatePose(p) {
  const finite = [p.x, p.y, p.z, p.yaw, p.pitch].every(Number.isFinite);
  if (!finite || p.x < 0 || p.x >= BC.WIDTH || p.z < 0 || p.z >= BC.DEPTH || p.y < -100 || p.y > BC.HEIGHT + 100
      || Math.abs(p.pitch) > Math.PI / 2 || !Number.isInteger(p.selected) || p.selected < 0 || p.selected >= BC.HOTBAR_SIZE
      || !(p.health >= 0 && p.health <= 20) || !(p.hunger >= 0 && p.hunger <= 20)) throw new Error('Некорректная позиция игрока');
  return {
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, selected: p.selected, health: p.health | 0, hunger: p.hunger | 0,
    respawnX: Number.isFinite(p.respawnX) ? p.respawnX : -1, respawnY: Number.isFinite(p.respawnY) ? p.respawnY : -1,
    respawnZ: Number.isFinite(p.respawnZ) ? p.respawnZ : -1, creative: !!p.creative
  };
}
function record(world, pose, inventory, name) {
  const safe = String(name || '').trim();
  if (!safe || safe.length > 32) throw new Error('Имя мира должно быть от 1 до 32 символов');
  return { format: FORMAT, version: VERSION, name: safe, savedAt: Date.now(), pose, inventory, world };
}
function decode(data, slot) {
  if (!data || data.format !== FORMAT) throw new Error('Неизвестный формат мира');
  if (data.version > VERSION) throw new Error('Сохранение из более новой версии игры');
  const world = BC.World.restore(data.world);
  const inventory = data.inventory || BC.Inventory.emptySnapshot();
  new BC.Inventory().restore(inventory); // validate
  return { world, pose: validatePose(data.pose), inventory, name: data.name || 'Мир ' + slot };
}

class SaveStore {
  constructor(backend) { this.backend = backend; this.persistent = !(backend instanceof MemoryBackend); }
  static async open() {
    try { return new SaveStore(new IdbBackend(await openDb())); }
    catch (e) { console.warn('[saves]', e); return new SaveStore(new MemoryBackend()); }
  }
  static memory() { return new SaveStore(new MemoryBackend()); }
  async list() {
    const result = {};
    for (let slot = 1; slot <= 5; slot++) {
      const data = await this.backend.get(slotKey(slot));
      if (data) result[slot] = { name: data && data.name ? data.name : 'Мир ' + slot, savedAt: data.savedAt };
    }
    return result;
  }
  async exists(slot) { return !!(await this.backend.get(slotKey(slot))); }
  async load(slot) { return decode(await this.backend.get(slotKey(slot)), slot); }
  async hasDimension(slot, dimension) { return !!(await this.backend.get(dimensionKey(slot, dimension))); }
  async loadDimension(slot, dimension) { return decode(await this.backend.get(dimensionKey(slot, dimension)), slot); }
  /** Main file holds the host's current position; dimension files hold both worlds. One transaction. */
  async saveUniverse(slot, dimensions, current, pose, inventory, name) {
    const entries = dimensions.map(d => [dimensionKey(slot, d.dimension), record(d, pose, inventory, name)]);
    entries.push([slotKey(slot), record(current, pose, inventory, name)]);
    await this.backend.putAll(entries);
  }
  async save(slot, world, pose, inventory, name) { await this.backend.putAll([[slotKey(slot), record(world, pose, inventory, name)]]); }
  async delete(slot) {
    const existed = await this.exists(slot);
    await this.backend.deleteAll([slotKey(slot), dimensionKey(slot, 'SURFACE'), dimensionKey(slot, 'HELL_FOREST')]);
    return existed;
  }
  async exportSlot(slot) {
    const files = {};
    for (const [name, key] of [['main', slotKey(slot)], ['surface', dimensionKey(slot, 'SURFACE')], ['hell_forest', dimensionKey(slot, 'HELL_FOREST')]]) {
      const data = await this.backend.get(key); if (data) files[name] = data;
    }
    if (!files.main) throw new Error('Слот пуст');
    const text = JSON.stringify({ format: FORMAT + '-export', version: VERSION, files });
    if (typeof CompressionStream !== 'undefined') {
      const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
      return { blob: await new Response(stream).blob(), name: files.main.name };
    }
    return { blob: new Blob([text], { type: 'application/json' }), name: files.main.name };
  }
  async importFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Браузер не умеет распаковывать gzip');
      text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else text = new TextDecoder().decode(bytes);
    const data = JSON.parse(text);
    if (!data || data.format !== FORMAT + '-export' || !data.files || !data.files.main) throw new Error('Это не файл мира Barnocraft WEB');
    decode(data.files.main, 0); // validate before writing
    for (let slot = 1; slot <= 5; slot++) if (!(await this.exists(slot))) {
      const entries = [[slotKey(slot), data.files.main]];
      if (data.files.surface) entries.push([dimensionKey(slot, 'SURFACE'), data.files.surface]);
      if (data.files.hell_forest) entries.push([dimensionKey(slot, 'HELL_FOREST'), data.files.hell_forest]);
      await this.backend.putAll(entries);
      return slot;
    }
    throw new Error('Все слоты миров заняты; сначала освободите слот');
  }
}
SaveStore.encodeState = (world, pose, name) => record(world, pose, BC.Inventory.emptySnapshot(), name);
SaveStore.decodeState = data => decode(data, 0);
SaveStore.validatePose = validatePose;
BC.SaveStore = SaveStore;

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'barnocraft-web.settings';
class GameOptions {
  constructor() { this.distance = 3; this.fov = 75; this.sensitivity = 1; this.texturePack = 0; }
  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY); this.saved = raw !== null;
      const p = JSON.parse(raw || '{}');
      if (Number.isFinite(p.distance)) this.distance = BC.clamp(Math.round(p.distance), 2, 6);
      if (Number.isFinite(p.fov)) this.fov = BC.clamp(Math.round(p.fov), 60, 100);
      if (Number.isFinite(p.sensitivity)) this.sensitivity = BC.clamp(p.sensitivity, .5, 2);
      if (p.texturePack === 0 || p.texturePack === 1) this.texturePack = p.texturePack;
    } catch (e) { /* defaults */ }
  }
  save() {
    const { distance, fov, sensitivity, texturePack } = this;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ distance, fov, sensitivity, texturePack })); return true; } catch (e) { return false; }
  }
}
BC.GameOptions = GameOptions;
})();
