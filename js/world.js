/* Barnocraft WEB — lazily generated regions plus sparse persistent edits; machines, water,
 * crops, creatures, drops and the voxel raycast. Mirrors World.java of the Java edition. */
(function () {
'use strict';
const BC = globalThis.BC;
const B = BC.B, HEIGHT = BC.HEIGHT, R = BC.REGION, Block = BC.Block, SOLID = BC.SOLID;
const EMPTY = BC.EMPTY_SLOT;
const SIDES4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = a => Math.sqrt(dot(a, a));
const norm = a => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const dist2 = (a, b) => { const d = sub(a, b); return dot(d, d); };
BC.vec = { sub, dot, len, norm, dist2 };

/** Local fixed-step source/flow automaton. Rivers sleep until a nearby block changes. */
class WaterSimulation {
  constructor(world) { this.world = world; this.levels = new Map(); this.pending = new Set(); this.clock = 0; }
  level(x, y, z) { return this.levels.get(this.world.key(x, y, z)) || 0; }
  changed(x, y, z) { this.levels.delete(this.world.key(x, y, z)); this.wake(x, y, z); }
  queue(x, y, z) { if (this.world.inside(x, y, z)) this.pending.add(this.world.key(x, y, z)); }
  wake(x, y, z) {
    this.queue(x, y, z); this.queue(x, y - 1, z); this.queue(x, y + 1, z);
    for (const s of SIDES4) this.queue(x + s[0], y, z + s[1]);
  }
  supported(x, y, z) {
    const below = this.world.get(x, y - 1, z);
    return y === 0 || SOLID[below] === 1 || (below === B.WATER && this.level(x, y - 1, z) === 0);
  }
  update(dt) {
    const changed = [], w = this.world;
    this.clock += Math.max(0, Math.min(.25, dt));
    if (this.clock < .12) return changed;
    this.clock -= .12;
    // Snapshot prevents newly queued cells from recursively flooding in one frame.
    const work = [];
    for (const key of this.pending) { work.push(key); if (work.length >= 512) break; }
    for (const key of work) this.pending.delete(key);
    for (const key of work) {
      const [x, y, z] = w.unkey(key);
      const block = w.get(x, y, z);
      if (block !== B.AIR && block !== B.WATER) continue;
      if (block === B.WATER && !this.levels.has(key)) continue; // persistent source
      let wanted = 8;
      if (w.get(x, y + 1, z) === B.WATER) wanted = 1;
      else for (const s of SIDES4) {
        const nx = x + s[0], nz = z + s[1];
        if (w.get(nx, y, nz) === B.WATER && this.supported(nx, y, nz)) wanted = Math.min(wanted, this.level(nx, y, nz) + 1);
      }
      if (wanted > 7) {
        if (block !== B.WATER) continue;
        w.flowingWater(x, y, z, -1);
      } else {
        if (block === B.WATER && this.level(x, y, z) === wanted) continue;
        w.flowingWater(x, y, z, wanted);
      }
      changed.push([x, y, z]); this.wake(x, y, z);
    }
    return changed;
  }
}

const emptyChest = () => ({ slots: new Array(27).fill(EMPTY), deathCache: false, opened: false });
const emptyFurnace = () => ({ coal: EMPTY, input: EMPTY, output: EMPTY });
const emptyCutter = () => ({ coal: EMPTY, stone: EMPTY, output: EMPTY, recipe: 'AXE_HEAD' });
const decrement = (slot, n = 1) => slot.count <= n ? EMPTY : { ...slot, count: slot.count - n };
const increment = (slot, item) => BC.makeSlot(item, slot.count + 1);
const STONECUTTER_RECIPES = ['AXE_HEAD', 'PICKAXE_HEAD', 'SHOVEL_HEAD', 'IRON_AXE_HEAD', 'IRON_PICKAXE_HEAD', 'IRON_SHOVEL_HEAD',
  'GOLD_AXE_HEAD', 'GOLD_PICKAXE_HEAD', 'GOLD_SHOVEL_HEAD'];

class World {
  constructor(seed = BC.randomSeed(), dimension = 'SURFACE', options = {}) {
    this.seed = seed >>> 0; this.dimension = dimension;
    this.width = options.width || BC.WIDTH; this.depth = options.depth || BC.DEPTH;
    this.features = options.features !== false;
    this.portals = this.features ? BC.Portal.sites(this.seed, this.width, this.depth) : [];
    this.edits = new Map(); this.chunkEdits = new Map();
    this.rotations = new Map(); this.doors = new Map();
    this.stonecutters = new Map(); this.furnaces = new Map(); this.chests = new Map();
    this.furnaceFuel = new Map(); this.furnaceProgress = new Map();
    this.regions = new Map(); this.lastRegionKey = -1; this.lastRegion = null;
    this.drops = []; this.sheep = []; this.zombies = []; this.fish = []; this.hellMobs = [];
    this.hurtUntil = new Map();
    this.sheepClock = 0; this.zombieSpawnClock = 0; this.fishSpawnClock = 5; this.hellSpawnClock = 25;
    this.dayTime = .28; this.gameClock = 0; this.cropGrowthClock = 0;
    this.keepInventory = false; this.blockRevision = 0;
    this.listeners = [];
    this.water = new WaterSimulation(this);
    this.mods = new BC.ModWorld(this);
    if (this.features && dimension === 'SURFACE') {
      this.spawnSheepNear({ x: this.width / 2, y: 0, z: this.depth / 2 }, 24, new BC.Rng(BC.salts(this.seed).sheep), 12, 56);
    }
  }
  static flat() { return new World(0, 'SURFACE', { width: 80, depth: 80, features: false }); }

  // ------------------------------------------------------------ change notification
  onChange(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(f => f !== fn); }; }
  notify(x, z) { for (const fn of this.listeners) fn(x, z); }

  // ------------------------------------------------------------ coordinates and data
  get chunksX() { return this.width / BC.CHUNK; }
  get chunksZ() { return this.depth / BC.CHUNK; }
  inside(x, y, z) { return x >= 0 && x < this.width && y >= 0 && y < HEIGHT && z >= 0 && z < this.depth; }
  key(x, y, z) { return (y * this.width + x) * this.depth + z; }
  unkey(key) {
    const z = key % this.depth, v = (key - z) / this.depth, x = v % this.width;
    return [x, (v - x) / this.width, z];
  }
  groundHeight(x, z) {
    return this.dimension === 'HELL_FOREST' ? BC.HellTerrain.height(this.seed, x, z) : this.features ? BC.Terrain.height(this.seed, x, z) : 5;
  }
  desert(x, z) { return this.dimension === 'SURFACE' && this.features && BC.Terrain.desert(this.seed, x, z); }
  protectedSpawn(x, z, radius) { return Math.abs(x - this.width / 2) <= radius && Math.abs(z - this.depth / 2) <= radius; }
  region(x, z) {
    const rx = (x / R) | 0, rz = (z / R) | 0, key = rx * 100 + rz;
    if (key === this.lastRegionKey) return this.lastRegion;
    let result = this.regions.get(key);
    if (result) { this.regions.delete(key); this.regions.set(key, result); }
    else {
      result = new BC.Region(this.seed, rx * R, rz * R, this.width, this.depth, this.features, this.dimension);
      this.regions.set(key, result);
      if (this.regions.size > BC.REGION_CACHE_LIMIT) {
        const oldest = this.regions.keys().next().value; this.regions.delete(oldest);
      }
    }
    this.lastRegionKey = key; this.lastRegion = result;
    return result;
  }
  hasRegion(x, z) { return this.regions.has(((x / R) | 0) * 100 + ((z / R) | 0)); }
  natural(x, y, z) { return this.region(x, z).blocks[(y * R + x % R) * R + z % R]; }
  get(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.width || y >= HEIGHT || z >= this.depth) return B.AIR;
    const e = this.edits.get((y * this.width + x) * this.depth + z);
    if (e !== undefined) return e;
    return this.region(x, z).blocks[(y * R + x % R) * R + z % R];
  }
  chunkIndex(x, z) { return ((x / BC.CHUNK) | 0) * this.chunksZ + ((z / BC.CHUNK) | 0); }
  putEdit(key, x, z, block) {
    if (!this.edits.has(key)) {
      const c = this.chunkIndex(x, z);
      let set = this.chunkEdits.get(c); if (!set) this.chunkEdits.set(c, set = new Set());
      set.add(key);
    }
    this.edits.set(key, block);
  }
  write(x, y, z, block) {
    this.putEdit(this.key(x, y, z), x, z, block); this.water.changed(x, y, z); this.notify(x, z);
  }
  set(x, y, z, block) {
    if (!this.inside(x, y, z) || Block.immutable(block) || Block.immutable(this.get(x, y, z)) || Block.door(block)
        || block === B.ROTATOR || this.get(x, y, z) === block) return false;
    const old = this.get(x, y, z), k = this.key(x, y, z);
    if (old === B.STONECUTTER) this.stonecutters.delete(k);
    if (old === B.FURNACE) { this.furnaces.delete(k); this.furnaceFuel.delete(k); this.furnaceProgress.delete(k); }
    if (old === B.CHEST) {
      const chest = this.chests.get(k); this.chests.delete(k);
      if (chest) for (const s of chest.slots) if (s.item) this.dropStack(s, x, y, z);
    }
    if (Block.bed(old)) {
      const off = bedOffset(this.rotation(x, y, z)), sign = old === B.BED ? 1 : -1;
      const bx = x + sign * off[0], bz = z + sign * off[1];
      if (Block.bed(this.get(bx, y, bz))) { this.write(bx, y, bz, B.AIR); this.rotations.delete(this.key(bx, y, bz)); }
    }
    const door = this.doorAt(x, y, z);
    if (door) this.removeDoor(door);
    this.write(x, y, z, block);
    if (block === B.CHEST && !this.chests.has(k)) this.chests.set(k, emptyChest());
    this.blockRevision++;
    this.rotations.delete(k);
    if (!SOLID[block]) {
      if (Block.bed(this.get(x, y + 1, z))) { this.set(x, y + 1, z, B.AIR); this.drop('BED', 1, x, y + 1, z); }
      if (this.get(x, y + 1, z) === B.LANTERN) { this.set(x, y + 1, z, B.AIR); this.drop('LANTERN', 1, x, y + 1, z); }
      const supported = this.doorAt(x, y + 1, z);
      if (supported && supported.y === y + 1) this.removeDoor(supported);
    }
    return true;
  }

  // ------------------------------------------------------------ water
  updateWater(dt) { return this.water.update(dt); }
  waterHeight(x, y, z) {
    if (this.get(x, y, z) !== B.WATER) return 0;
    return this.get(x, y + 1, z) === B.WATER ? 1 : .9 - .1 * this.water.level(x, y, z);
  }
  flowingWater(x, y, z, level) {
    const k = this.key(x, y, z);
    this.putEdit(k, x, z, level < 0 ? B.AIR : B.WATER);
    if (level < 0) this.water.levels.delete(k); else this.water.levels.set(k, level);
    this.blockRevision++; this.notify(x, z);
  }
  useBucket(inventory, slot, origin, direction) {
    const item = inventory.itemAt(slot); if (item !== 'BUCKET' && item !== 'WATER_BUCKET') return null;
    const hit = this.raycast(origin, direction, BC.Player.REACH, item === 'BUCKET'); if (!hit) return null;
    if (item === 'BUCKET' && this.get(hit.x, hit.y, hit.z) === B.WATER) {
      if (!this.set(hit.x, hit.y, hit.z, B.AIR)) return null;
      if (!inventory.creative) inventory.replaceAt(slot, item, 'WATER_BUCKET');
      return hit;
    }
    if (item === 'WATER_BUCKET') {
      const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
      if (this.get(x, y, z) !== B.AIR || !this.set(x, y, z, B.WATER)) return null;
      if (!inventory.creative) inventory.replaceAt(slot, item, 'BUCKET');
      return { x, y, z, nx: 0, ny: 0, nz: 0 };
    }
    return null;
  }

  // ------------------------------------------------------------ time
  advanceTime(tpf) {
    const dt = Math.max(0, tpf); this.gameClock += dt; this.dayTime = (this.dayTime + dt / 600) % 1;
    for (const [id, until] of this.hurtUntil) if (until <= this.gameClock) this.hurtUntil.delete(id);
  }
  flashHurt(id) { this.hurtUntil.set(id, this.gameClock + .28); }
  hurtFlash(id) { return (this.hurtUntil.get(id) || 0) > this.gameClock; }
  setDayTime(time) { this.dayTime = time - Math.floor(time); }
  daylight() { return Math.max(0, Math.min(1, (Math.sin((this.dayTime - .25) * Math.PI * 2) + .08) / .78)); }
  night() { return this.dayTime >= .72 || this.dayTime < .22; }

  // ------------------------------------------------------------ farming
  till(x, y, z) {
    if (this.get(x, y, z) !== B.GRASS || this.get(x, y + 1, z) !== B.AIR) return false;
    return this.set(x, y, z, B.FARMLAND);
  }
  plantCrop(x, y, z) {
    if (this.get(x, y, z) !== B.FARMLAND || this.get(x, y + 1, z) !== B.AIR) return false;
    return this.set(x, y + 1, z, B.CROP_0);
  }
  harvestCrop(x, y, z, inventory) {
    const crop = this.get(x, y, z); if (!Block.crop(crop)) return false;
    const give = (item, n) => { const left = inventory.add(item, n); if (left > 0) this.drop(item, left, x, y, z); };
    if (crop === B.CROP_3) { give('WHEAT', 1); give('WHEAT_SEEDS', 1 + Math.floor(Math.random() * 3)); }
    else if (Math.random() < .35) give('WHEAT_SEEDS', 1);
    return this.set(x, y, z, B.AIR);
  }
  updateCrops(tpf) {
    this.cropGrowthClock += Math.max(0, tpf); const grown = [];
    while (this.cropGrowthClock >= 30) {
      this.cropGrowthClock -= 30;
      for (const [key, block] of this.edits) {
        if (!Block.crop(block) || block === B.CROP_3) continue;
        this.edits.set(key, block + 1); this.blockRevision++;
        const [x, y, z] = this.unkey(key); grown.push([x, y, z]); this.notify(x, z);
      }
    }
    return grown;
  }

  // ------------------------------------------------------------ rotations, doors, beds, stairs
  rotation(x, y, z) { return this.rotations.get(this.key(x, y, z)) || 0; }
  orientation(x, y, z, facing) {
    const turn = BC.floorMod(facing, 4), k = this.key(x, y, z);
    if (turn === 0) this.rotations.delete(k); else this.rotations.set(k, turn);
    this.notify(x, z);
  }
  removeDoor(door) {
    this.doors.delete(this.key(door.x, door.y, door.z));
    this.write(door.x, door.y, door.z, B.AIR); this.write(door.x, door.y + 1, door.z, B.AIR);
  }
  doorAt(x, y, z) {
    if (!this.inside(x, y, z)) return null;
    return this.doors.get(this.key(x, y, z)) || (y > 0 ? this.doors.get(this.key(x, y - 1, z)) : null) || null;
  }
  placeDoor(x, y, z, facing, player) {
    if (!this.inside(x, y + 1, z) || y < 1 || this.get(x, y, z) !== B.AIR || this.get(x, y + 1, z) !== B.AIR
        || !SOLID[this.get(x, y - 1, z)] || Block.door(this.get(x, y - 1, z)) || this.get(x, y - 1, z) === B.STAIRS
        || player.intersects(x, y, z) || player.intersects(x, y + 1, z)) return false;
    this.doors.set(this.key(x, y, z), { x, y, z, facing: BC.floorMod(facing, 4), open: false });
    this.write(x, y, z, B.DOOR); this.write(x, y + 1, z, B.DOOR_TOP);
    this.blockRevision++;
    return true;
  }
  toggleDoor(x, y, z, player) {
    const door = this.doorAt(x, y, z); if (!door) return false;
    const next = { ...door, open: !door.open };
    if (player.intersectsBounds(BC.Door.bounds(next))) return false;
    this.doors.set(this.key(door.x, door.y, door.z), next);
    this.blockRevision++; this.notify(x, z);
    return true;
  }
  placeBed(x, y, z, facing, player) {
    const d = bedOffset(facing), hx = x + d[0], hz = z + d[1];
    if (!this.inside(x, y, z) || !this.inside(hx, y, hz) || this.get(x, y, z) !== B.AIR || this.get(hx, y, hz) !== B.AIR
        || !SOLID[this.get(x, y - 1, z)] || !SOLID[this.get(hx, y - 1, hz)]
        || player.intersects(x, y, z) || player.intersects(hx, y, hz)) return false;
    this.write(x, y, z, B.BED); this.write(hx, y, hz, B.BED_HEAD);
    this.orientation(x, y, z, facing); this.orientation(hx, y, hz, facing); this.blockRevision++;
    return true;
  }
  bedSpawn(x, y, z) {
    if (!Block.bed(this.get(x, y, z))) return null;
    let bx = x, bz = z;
    if (this.get(x, y, z) === B.BED_HEAD) { const o = bedOffset(this.rotation(x, y, z)); bx -= o[0]; bz -= o[1]; }
    return { x: bx + .5, y: y + .61, z: bz + .5 };
  }
  validBedSpawn(x, y, z) { return this.inside(x | 0, y | 0, z | 0) && Block.bed(this.get(x | 0, y | 0, z | 0)); }
  sleepAt(x, y, z) {
    if (!Block.bed(this.get(x, y, z))) return 'Здесь нет кровати';
    if (this.dayTime >= .22 && this.dayTime < .72) return 'Спать можно только ночью';
    for (const m of this.zombies) if (Math.abs(m.x - x) < 8 && Math.abs(m.z - z) < 8 && Math.abs(m.y - y) < 4)
      return 'Рядом зомби — спать небезопасно';
    this.dayTime = .28; this.zombieSpawnClock = 0; this.zombies = [];
    return 'Доброе утро!';
  }
  placeStairs(x, y, z, facing, player) {
    if (!this.inside(x, y, z) || this.get(x, y, z) !== B.AIR
        || BC.Stairs.bounds(x, y, z, facing).some(b => player.intersectsBounds(b))) return false;
    this.write(x, y, z, B.STAIRS); this.orientation(x, y, z, facing); this.blockRevision++;
    return true;
  }
  rotate(x, y, z, player) {
    const block = this.get(x, y, z);
    if (Block.immutable(block)) return false;
    if (Block.bed(block)) {
      const oldFacing = this.rotation(x, y, z), old = bedOffset(oldFacing);
      if (block === B.BED_HEAD) { x -= old[0]; z -= old[1]; }
      const nextFacing = (oldFacing + 1) & 3, next = bedOffset(nextFacing), hx = x + next[0], hz = z + next[1];
      if (!this.inside(hx, y, hz) || this.get(hx, y, hz) !== B.AIR || !SOLID[this.get(hx, y - 1, hz)]
          || player.intersects(x, y, z) || player.intersects(hx, y, hz)) return false;
      this.write(x + old[0], y, z + old[1], B.AIR); this.rotations.delete(this.key(x + old[0], y, z + old[1]));
      this.write(hx, y, hz, B.BED_HEAD); this.orientation(x, y, z, nextFacing); this.orientation(hx, y, hz, nextFacing);
      this.blockRevision++; return true;
    }
    if (!SOLID[block]) return false;
    const door = this.doorAt(x, y, z);
    if (door) {
      const next = { ...door, facing: (door.facing + 1) & 3 };
      if (player.intersectsBounds(BC.Door.bounds(next))) return false;
      this.doors.set(this.key(door.x, door.y, door.z), next); this.blockRevision++; this.notify(x, z); return true;
    }
    const facing = (this.rotation(x, y, z) + 1) & 3;
    if (block === B.STAIRS && BC.Stairs.bounds(x, y, z, facing).some(b => player.intersectsBounds(b))) return false;
    // Natural blocks become persistent edits: rotation is a player change.
    this.putEdit(this.key(x, y, z), x, z, block); this.orientation(x, y, z, facing); this.blockRevision++;
    return true;
  }

  // ------------------------------------------------------------ chests
  chestAt(x, y, z) {
    if (this.get(x, y, z) !== B.CHEST) return null;
    return this.chests.get(this.key(x, y, z)) || emptyChest();
  }
  openChest(x, y, z) {
    const chest = this.chestAt(x, y, z);
    if (!chest || (chest.deathCache && chest.opened)) return false;
    if (chest.deathCache) this.chests.set(this.key(x, y, z), { ...chest, opened: true });
    return true;
  }
  /** Fixed: tools keep their durability, items land in the slot they were dropped on. */
  moveChestItem(x, y, z, chestSlot, inventory, inventorySlot, chestToInventory, one) {
    const chest = this.chestAt(x, y, z); if (!chest || chestSlot < 0 || chestSlot >= 27) return false;
    const slots = chest.slots.slice(), source = slots[chestSlot];
    if (chestToInventory) {
      if (!source.item) return false;
      const amount = one ? 1 : source.count;
      let moved = inventory.insertAt(inventorySlot, source.item, amount, source.durability);
      if (moved === 0) moved = amount - inventory.addStack(source.item, amount, source.durability);
      if (moved <= 0) return false;
      slots[chestSlot] = decrement(source, moved);
    } else {
      const target = inventory.slotAtIndex(inventorySlot);
      if (!target || !target.item) return false;
      const it = BC.item(target.item), lim = it.stackLimit();
      const amount = one ? 1 : target.count;
      let moved;
      if (!source.item) { moved = Math.min(amount, lim); slots[chestSlot] = BC.makeSlot(target.item, moved, it.tool() ? target.durability : 0); }
      else {
        if (source.item !== target.item || it.tool()) return false;
        moved = Math.min(amount, lim - source.count); if (moved <= 0) return false;
        slots[chestSlot] = { ...source, count: source.count + moved };
      }
      if (!inventory.creative) inventory.removeAt(inventorySlot, moved);
    }
    this.chests.set(this.key(x, y, z), { ...chest, slots });
    return true;
  }
  closeChest(x, y, z) {
    const chest = this.chestAt(x, y, z); if (!chest || !chest.deathCache) return;
    this.chests.delete(this.key(x, y, z)); this.write(x, y, z, B.AIR); this.blockRevision++;
    for (const s of chest.slots) if (s.item) this.dropStack(s, x, y, z);
  }
  createDeathChest(inventory, position) {
    let cx = Math.max(1, Math.min(this.width - 2, Math.floor(position.x)));
    let cz = Math.max(1, Math.min(this.depth - 2, Math.floor(position.z)));
    const cy = this.groundHeight(cx, cz) + 1; let found = false;
    for (let radius = 0; radius < 8 && !found; radius++) for (let dx = -radius; dx <= radius && !found; dx++) for (let dz = -radius; dz <= radius && !found; dz++) {
      const x = cx + dx, z = cz + dz;
      if (!this.inside(x, cy, z) || this.get(x, cy, z) !== B.AIR || !SOLID[this.get(x, cy - 1, z)]) continue;
      cx = x; cz = z; found = true;
    }
    // Fixed: without a free spot the items drop instead of silently staying in the inventory.
    if (!found) { this.dropInventory(inventory, position); return; }
    const contents = [];
    for (let i = 0; i < 27; i++) {
      if (i < BC.Inventory.SLOT_COUNT) contents.push(inventory.slotAtIndex(i));
      else if (i < BC.Inventory.SLOT_COUNT + BC.Inventory.CRAFT_SIZE) contents.push(inventory.craftSlotAt(i - BC.Inventory.SLOT_COUNT));
      else contents.push(EMPTY);
    }
    inventory.clear(); this.write(cx, cy, cz, B.CHEST);
    this.chests.set(this.key(cx, cy, cz), { slots: contents, deathCache: true, opened: false }); this.blockRevision++;
  }

  // ------------------------------------------------------------ furnace
  furnaceAt(x, y, z) {
    if (this.get(x, y, z) !== B.FURNACE) return null;
    return this.furnaces.get(this.key(x, y, z)) || emptyFurnace();
  }
  static smeltingResult(input) {
    if (!input) return null;
    const custom = BC.item(input).cookingResult(); if (custom) return custom;
    return input === 'IRON' ? 'IRON_INGOT' : input === 'GOLD' ? 'GOLD_INGOT' : input === 'SAND' ? 'GLASS' : null;
  }
  putFurnaceItem(x, y, z, machineSlot, inventory, inventorySlot) {
    const state = this.furnaceAt(x, y, z); if (!state || (machineSlot !== 0 && machineSlot !== 1)) return false;
    const source = inventory.slotAtIndex(inventorySlot), current = machineSlot === 0 ? state.coal : state.input;
    const type = source ? source.item : null, required = machineSlot === 0 ? 'COAL' : type;
    if (machineSlot === 1 && !World.smeltingResult(type)) return false;
    if (!source || source.item !== required || (current.item && current.item !== required)
        || current.count >= BC.MAX_STACK || !inventory.consumeAt(inventorySlot, required)) return false;
    const updated = BC.makeSlot(required, current.count + 1);
    this.furnaces.set(this.key(x, y, z), machineSlot === 0 ? { ...state, coal: updated } : { ...state, input: updated });
    return true;
  }
  /** Fixed: furnaces process from the game tick even while their screen is closed. */
  updateFurnaces(tpf) {
    for (const location of Array.from(this.furnaces.keys())) {
      const [x, y, z] = this.unkey(location);
      const state = this.furnaceAt(x, y, z); if (!state) { this.furnaces.delete(location); continue; }
      const result = World.smeltingResult(state.input.item);
      const hasFuel = (this.furnaceFuel.get(location) || 0) > 0 || state.coal.count > 0;
      const canCook = state.input.count > 0 && result && (!state.output.item || state.output.item === result) && state.output.count < BC.MAX_STACK;
      if (!hasFuel || !canCook) { this.furnaceProgress.delete(location); continue; }
      let progress = (this.furnaceProgress.get(location) || 0) + Math.max(0, tpf);
      if (progress >= 2) { if (this.smelt(x, y, z)) progress -= 2; else progress = 0; }
      this.furnaceProgress.set(location, Math.min(progress, 2));
    }
  }
  furnaceProgressAt(x, y, z) { return (this.furnaceProgress.get(this.key(x, y, z)) || 0) / 2; }
  smelt(x, y, z) {
    const state = this.furnaceAt(x, y, z), result = state ? World.smeltingResult(state.input.item) : null;
    const k = this.key(x, y, z); let fuel = this.furnaceFuel.get(k) || 0;
    if (!state || (fuel <= 0 && state.coal.count < 1) || state.input.count < 1 || !result
        || (state.output.item && state.output.item !== result) || state.output.count >= BC.MAX_STACK) return false;
    let coal = state.coal;
    if (fuel <= 0) { coal = decrement(coal); fuel = 8; }
    this.furnaces.set(k, { coal, input: decrement(state.input), output: increment(state.output, result) });
    this.furnaceFuel.set(k, fuel - 1);
    return true;
  }
  takeFurnaceItem(x, y, z, machineSlot, inventory, inventorySlot) {
    const state = this.furnaceAt(x, y, z); if (!state || machineSlot < 0 || machineSlot > 2) return false;
    const field = ['coal', 'input', 'output'][machineSlot], source = state[field];
    if (source.count < 1 || !inventory.acceptAt(inventorySlot, source.item)) return false;
    this.furnaces.set(this.key(x, y, z), { ...state, [field]: decrement(source) });
    return true;
  }
  takeFurnaceOutput(x, y, z, inventory) {
    const state = this.furnaceAt(x, y, z);
    if (!state || state.output.count < 1 || inventory.add(state.output.item, 1) !== 0) return false;
    this.furnaces.set(this.key(x, y, z), { ...state, output: decrement(state.output) });
    return true;
  }

  // ------------------------------------------------------------ stonecutter
  static stonecutterRecipe(recipe) { return STONECUTTER_RECIPES.includes(recipe); }
  static stonecutterMaterial(recipe) {
    if (recipe && recipe.startsWith('GOLD_')) return 'GOLD_INGOT';
    if (recipe && recipe.startsWith('IRON_')) return 'IRON_INGOT';
    return 'STONE';
  }
  static stonecutterMaterialCount(recipe) { return World.stonecutterMaterial(recipe) === 'STONE' ? 1 : 5; }
  stonecutterAt(x, y, z) {
    if (this.get(x, y, z) !== B.STONECUTTER) return null;
    return this.stonecutters.get(this.key(x, y, z)) || emptyCutter();
  }
  putStonecutterItem(x, y, z, machineSlot, inventory, inventorySlot) {
    const state = this.stonecutterAt(x, y, z); if (!state || (machineSlot !== 0 && machineSlot !== 1)) return false;
    const source = inventory.slotAtIndex(inventorySlot);
    const required = machineSlot === 0 ? 'COAL' : World.stonecutterMaterial(state.recipe);
    const field = machineSlot === 0 ? 'coal' : 'stone', current = state[field];
    if (!source || source.item !== required || source.count < 1 || (current.item && current.item !== required)
        || current.count >= BC.MAX_STACK) return false;
    if (!inventory.consumeAt(inventorySlot, required)) return false;
    this.stonecutters.set(this.key(x, y, z), { ...state, [field]: BC.makeSlot(required, current.count + 1) });
    return true;
  }
  selectStonecutterRecipe(x, y, z, recipe) {
    const state = this.stonecutterAt(x, y, z); if (!state || !World.stonecutterRecipe(recipe)) return false;
    this.stonecutters.set(this.key(x, y, z), { ...state, recipe });
    return true;
  }
  craftStonecutterHead(x, y, z) {
    const state = this.stonecutterAt(x, y, z); if (!state) return false;
    const material = World.stonecutterMaterial(state.recipe), count = World.stonecutterMaterialCount(state.recipe);
    if (state.coal.count < 1 || state.stone.item !== material || state.stone.count < count
        || (state.output.item && state.output.item !== state.recipe) || state.output.count >= BC.MAX_STACK) return false;
    this.stonecutters.set(this.key(x, y, z), { ...state, coal: decrement(state.coal), stone: decrement(state.stone, count),
      output: increment(state.output, state.recipe) });
    return true;
  }
  takeStonecutterOutput(x, y, z, inventory) {
    const state = this.stonecutterAt(x, y, z);
    if (!state || state.output.count < 1 || inventory.add(state.output.item, 1) !== 0) return false;
    this.stonecutters.set(this.key(x, y, z), { ...state, output: decrement(state.output) });
    return true;
  }
  takeStonecutterItem(x, y, z, machineSlot, inventory, inventorySlot) {
    const state = this.stonecutterAt(x, y, z); if (!state || machineSlot < 0 || machineSlot > 2) return false;
    const field = ['coal', 'stone', 'output'][machineSlot], source = state[field];
    if (source.count < 1 || !inventory.acceptAt(inventorySlot, source.item)) return false;
    this.stonecutters.set(this.key(x, y, z), { ...state, [field]: decrement(source) });
    return true;
  }

  // ------------------------------------------------------------ drops
  drop(item, count, x, y, z, durability) {
    const d = durability === undefined ? BC.item(item).maxDurability() : durability;
    for (let i = 0; i < count; i++) this.drops.push({ item, x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z), durability: d });
  }
  dropStack(slot, x, y, z) { this.drop(slot.item, slot.count, x, y, z, BC.item(slot.item).tool() ? slot.durability : undefined); }
  dropInventory(inventory, position) {
    for (let i = 0; i < BC.Inventory.SLOT_COUNT; i++) { const s = inventory.slotAtIndex(i); if (s && s.item) this.dropStack(s, position.x, position.y, position.z); }
    for (let i = 0; i < BC.Inventory.CRAFT_SIZE; i++) { const s = inventory.craftSlotAt(i); if (s && s.item) this.dropStack(s, position.x, position.y, position.z); }
    inventory.clear();
  }
  /** Picks up items around a point; anything that does not fit stays on the ground. */
  collectIntoInventory(position, radius, inventory) {
    let collected = 0;
    this.drops = this.drops.filter(item => {
      const dx = position.x - (item.x + .5), dy = position.y - (item.y + .25), dz = position.z - (item.z + .5);
      if (dx * dx + dy * dy + dz * dz > radius * radius) return true;
      const it = BC.item(item.item);
      const slot = BC.makeSlot(item.item, 1, it.tool() ? Math.min(item.durability, it.maxDurability()) : 0);
      for (let i = 0; i < BC.Inventory.SLOT_COUNT; i++) if (inventory.slotAtIndex(i).item === item.item && inventory.acceptSlotAt(i, slot)) { collected++; return false; }
      for (let i = 0; i < BC.Inventory.SLOT_COUNT; i++) if (inventory.acceptSlotAt(i, slot)) { collected++; return false; }
      return true;
    });
    return collected;
  }
  collectNearest(position, radius, inventory) {
    let found = -1, best = radius * radius;
    this.drops.forEach((item, i) => {
      const dx = position.x - (item.x + .5), dy = position.y - (item.y + .25), dz = position.z - (item.z + .5);
      const d = dx * dx + dy * dy + dz * dz; if (d <= best) { best = d; found = i; }
    });
    if (found < 0) return null;
    const item = this.drops[found];
    if (inventory.addStack(item.item, 1, item.durability) > 0) return null;
    this.drops.splice(found, 1); return item.item;
  }
  torchesNear(x, z, radius, limit) {
    const r2 = radius * radius, torches = [];
    for (const [key, block] of this.edits) {
      if (block !== B.TORCH && block !== B.LANTERN) continue;
      const [tx, ty, tz] = this.unkey(key), dx = tx + .5 - x, dz = tz + .5 - z;
      if (dx * dx + dz * dz <= r2) torches.push({ x: tx + .5, y: ty + .7, z: tz + .5, d: dx * dx + dz * dz });
    }
    torches.sort((a, b) => a.d - b.d);
    return torches.slice(0, limit);
  }

  // ------------------------------------------------------------ sheep and fish
  spawnSheepNear(position, amount, random = new BC.Rng(BC.randomSeed()), minRadius = 3, maxRadius = 10) {
    for (let i = 0; i < amount && this.sheep.length < 400; i++) {
      const angle = random.nextDouble() * Math.PI * 2, radius = minRadius + random.nextFloat() * (maxRadius - minRadius);
      const x = Math.max(1, Math.min(this.width - 2, Math.trunc(position.x + Math.cos(angle) * radius)));
      const z = Math.max(1, Math.min(this.depth - 2, Math.trunc(position.z + Math.sin(angle) * radius)));
      this.sheep.push({ x: x + .5, y: this.groundHeight(x, z) + 1, z: z + .5, health: 3, dx: Math.cos(angle), dz: Math.sin(angle), flee: 0, id: 'sheep:' + BC.uuid() });
    }
  }
  ensureSheepNear(position) {
    if (this.dimension !== 'SURFACE' || !this.features) return;
    let local = 0;
    for (const a of this.sheep) { const dx = a.x - position.x, dz = a.z - position.z; if (dx * dx + dz * dz < 72 * 72) local++; }
    if (local < 16) this.spawnSheepNear(position, 16 - local, new BC.Rng(BC.randomSeed()), 12, 64);
  }
  ensureFishNear(position) {
    if (this.dimension !== 'SURFACE') return;
    this.fish = this.fish.filter(f => Math.abs(f.x - position.x) <= 96 && Math.abs(f.z - position.z) <= 96);
    if (this.fishSpawnClock < 5) return;
    this.fishSpawnClock = 0;
    let local = 0; for (const f of this.fish) if (Math.abs(f.x - position.x) < 64 && Math.abs(f.z - position.z) < 64) local++;
    if (local < 3 && this.fish.length < 12) this.spawnFishNear(position, Math.min(3 - local, 12 - this.fish.length), new BC.Rng(BC.randomSeed()), 12, 48);
  }
  spawnFishNear(position, amount, random, minRadius, maxRadius) {
    for (let n = 0, tries = 0; n < amount && tries < amount * 40; tries++) {
      const angle = random.nextDouble() * Math.PI * 2, radius = minRadius + random.nextDouble() * (maxRadius - minRadius);
      const x = Math.max(1, Math.min(this.width - 2, Math.trunc(position.x + Math.cos(angle) * radius)));
      const z = Math.max(1, Math.min(this.depth - 2, Math.trunc(position.z + Math.sin(angle) * radius)));
      if (!this.hasRegion(x, z) || this.get(x, BC.WATER_LEVEL, z) !== B.WATER) continue;
      if (this.fish.some(f => (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z) < 64)) continue;
      const a = random.nextDouble() * Math.PI * 2;
      this.fish.push({ x: x + .5, y: BC.WATER_LEVEL + .35, z: z + .5, dx: Math.cos(a), dz: Math.sin(a) }); n++;
    }
  }
  updateFish(tpf) {
    if (tpf <= 0) return;
    this.fishSpawnClock += tpf;
    for (const f of this.fish) {
      const speed = Math.min(.06, tpf) * 1.8, nx = f.x + f.dx * speed, nz = f.z + f.dz * speed;
      if (this.get(Math.trunc(nx), BC.WATER_LEVEL, Math.trunc(nz)) !== B.WATER) { f.dx = -f.dx; f.dz = -f.dz; }
      else { f.x = nx; f.z = nz; f.y = BC.WATER_LEVEL + .35; }
    }
  }
  killSheep(inventory) {
    const killed = this.sheep.length;
    for (const a of this.sheep) this.dropSheep(a, inventory);
    this.sheep = []; return killed;
  }
  dropSheep(a, inventory) {
    const x = Math.floor(a.x), y = Math.floor(a.y), z = Math.floor(a.z);
    for (const item of ['MUTTON', 'WOOL']) if (!inventory || inventory.add(item, 1) > 0) this.drop(item, 1, x, y, z);
  }
  updateSheep(tpf) {
    this.sheepClock += Math.max(0, tpf);
    this.sheep.forEach((a, i) => {
      const flee = Math.max(0, a.flee - tpf);
      let dx = a.dx, dz = a.dz;
      if (flee === 0) {
        const phase = this.sheepClock * .23 + i * 2.17;
        dx = dx * .94 + Math.sin(phase) * .06; dz = dz * .94 + Math.cos(phase * .81) * .06;
      }
      let length = Math.sqrt(dx * dx + dz * dz);
      if (length < .001) { dx = 1; dz = 0; length = 1; }
      dx /= length; dz /= length;
      const step = (flee > 0 ? 3.2 : .55) * Math.min(Math.max(tpf, 0), .1);
      const nextX = a.x + dx * step, nextZ = a.z + dz * step;
      a.dx = dx; a.dz = dz; a.flee = flee;
      if (!this.hasRegion(a.x | 0, a.z | 0)) return; // never generate terrain for a distant sheep
      if (this.sheepCanOccupy(a, nextX, nextZ)) { a.x = nextX; a.z = nextZ; }
      else if (this.sheepCanOccupy(a, nextX, a.z)) a.x = nextX;
      else if (this.sheepCanOccupy(a, a.x, nextZ)) a.z = nextZ;
      else return;
      a.y = this.groundHeight(a.x | 0, a.z | 0) + 1;
    });
  }
  sheepCanOccupy(a, x, z) {
    if (x < 1 || x >= this.width - 1 || z < 1 || z >= this.depth - 1) return false;
    const oldGround = this.groundHeight(a.x | 0, a.z | 0), newGround = this.groundHeight(x | 0, z | 0);
    if (Math.abs(newGround - oldGround) > 1) return false;
    const feet = newGround + 1.001;
    for (let bx = Math.floor(x - .32); bx <= Math.floor(x + .32); bx++) for (let bz = Math.floor(z - .32); bz <= Math.floor(z + .32); bz++)
      for (let by = Math.floor(feet + .02); by <= Math.floor(feet + 1.15); by++) if (SOLID[this.get(bx, by, bz)]) return false;
    return true;
  }
  blockDistance(origin, ray, reach) {
    const hit = this.raycast(origin, ray, reach);
    if (!hit) return Infinity;
    return Math.max(0, dot(sub({ x: hit.x + .5, y: hit.y + .5, z: hit.z + .5 }, origin), ray) - .9);
  }
  sphereHit(origin, ray, center, radius, reach) {
    const along = dot(sub(center, origin), ray);
    if (along < 0 || along > reach + radius) return null;
    const closest = { x: origin.x + ray.x * along, y: origin.y + ray.y * along, z: origin.z + ray.z * along };
    const perp = dist2(closest, center);
    if (perp > radius * radius) return null;
    return along - Math.sqrt(radius * radius - perp);
  }
  attackSheep(origin, direction, reach, inventory) {
    if (dot(direction, direction) < 1e-8) return false;
    const ray = norm(direction), blockDistance = this.blockDistance(origin, ray, reach);
    let hitIndex = -1, nearest = reach;
    this.sheep.forEach((a, i) => {
      const c = this.sphereHit(origin, ray, { x: a.x, y: a.y + .55, z: a.z }, .72, reach);
      if (c !== null && c <= nearest && c <= blockDistance) { nearest = c; hitIndex = i; }
    });
    if (hitIndex < 0) return false;
    const a = this.sheep[hitIndex];
    this.mods.event('damage', { source: 'player', target: a.id, amount: 1 });
    this.flashHurt(a.id);
    this.hurtSheep(a, a.x - origin.x, a.z - origin.z);
    if (a.health <= 0) { this.sheep.splice(hitIndex, 1); this.dropSheep(a, inventory); }
    return true;
  }
  hurtSheep(a, awayX, awayZ) {
    let length = Math.sqrt(awayX * awayX + awayZ * awayZ);
    if (length < .001) { awayX = -a.dx; awayZ = -a.dz; length = Math.sqrt(awayX * awayX + awayZ * awayZ) || 1; }
    a.health--; a.dx = awayX / length; a.dz = awayZ / length; a.flee = 4;
  }
  damageSheep(id, amount, source) {
    const i = this.sheep.findIndex(s => s.id === id); if (i < 0) return false;
    const s = this.sheep[i];
    for (let n = 0; n < amount; n++) this.hurtSheep(s, -s.dx, -s.dz);
    this.mods.event('damage', { source, target: id, amount }); this.flashHurt(id);
    if (s.health <= 0) { this.sheep.splice(i, 1); this.dropSheep(s, null); }
    return true;
  }

  // ------------------------------------------------------------ zombies
  /** Zombies chase the nearest player; `others` are guests simulated by the host. */
  updateZombies(tpf, player, others = []) {
    if (this.dimension !== 'SURFACE' || tpf <= 0) return;
    const players = [player, ...others], p = player.position;
    const d2 = (m, q) => (m.x - q.position.x) ** 2 + (m.z - q.position.z) ** 2;
    const nearest = m => { let best = players[0], d = Infinity; for (const q of players) { const v = d2(m, q); if (v < d) { d = v; best = q; } } return best; };
    this.zombies = this.zombies.filter(m => players.some(q => d2(m, q) <= 80 * 80));
    if (this.zombies.length > 3) { this.zombies.sort((a, b) => d2(a, nearest(a)) - d2(b, nearest(b))); this.zombies.length = 3; }
    this.zombieSpawnClock += tpf;
    if (this.night() && this.zombieSpawnClock >= 60 && this.zombies.length < 3) {
      this.zombieSpawnClock = 0;
      const angle = Math.random() * Math.PI * 2, radius = 24 + Math.random() * 16;
      const x = Math.max(1, Math.min(this.width - 2, Math.trunc(p.x + Math.cos(angle) * radius)));
      const z = Math.max(1, Math.min(this.depth - 2, Math.trunc(p.z + Math.sin(angle) * radius)));
      const y = this.groundHeight(x, z) + 1;
      if (this.mobFits(x + .5, y, z + .5) && this.get(x, y, z) === B.AIR && this.torchesNear(x, z, 12, 1).length === 0)
        this.zombies.push({ x: x + .5, y, z: z + .5, health: 8, cooldown: 0, vy: 0, heading: 0, id: 'zombie:' + BC.uuid() });
    }
    for (const mob of this.zombies) {
      const target = nearest(mob), t = target.position;
      let remaining = Math.min(tpf, .25);
      while (remaining > 0) {
        const dt = Math.min(remaining, 1 / 60); remaining -= dt;
        const dx = t.x - mob.x, dz = t.z - mob.z, distance = Math.sqrt(dx * dx + dz * dz);
        mob.cooldown = Math.max(0, mob.cooldown - dt);
        if (distance > .01) mob.heading = Math.atan2(dx, dz);
        const grounded = !this.mobFits(mob.x, mob.y - .04, mob.z);
        if (distance < 1.15 && Math.abs(t.y - mob.y) < 1.8) {
          if (mob.cooldown === 0) {
            if (target.damage(1) && target === player) this.mods.event('damage', { source: mob.id, target: 'player', amount: 1 });
            mob.cooldown = 1.5;
          }
        } else if (distance < 48 && distance > .01) {
          const mx = dx / distance * dt * 2.2, mz = dz / distance * dt * 2.2;
          const blocked = !this.mobFits(mob.x + mx, mob.y, mob.z + mz);
          if (blocked && grounded && this.mobFits(mob.x, mob.y + 1.1, mob.z) && this.mobFits(mob.x + mx, mob.y + 1.1, mob.z + mz)) mob.vy = 8;
          if (this.mobFits(mob.x + mx, mob.y, mob.z)) mob.x += mx;
          if (this.mobFits(mob.x, mob.y, mob.z + mz)) mob.z += mz;
        }
        mob.vy -= 22 * dt;
        const nextY = mob.y + mob.vy * dt;
        if (this.mobFits(mob.x, nextY, mob.z)) mob.y = nextY;
        else {
          let lo = 0, hi = 1;
          for (let n = 0; n < 12; n++) { const mid = (lo + hi) / 2; if (this.mobFits(mob.x, mob.y + (nextY - mob.y) * mid, mob.z)) lo = mid; else hi = mid; }
          mob.y += (nextY - mob.y) * lo; mob.vy = 0;
        }
      }
    }
  }
  mobFits(x, y, z) {
    if (x < .32 || x >= this.width - .32 || z < .32 || z >= this.depth - .32 || y < 0) return false;
    for (let bx = Math.floor(x - .31); bx <= Math.floor(x + .31); bx++) for (let bz = Math.floor(z - .31); bz <= Math.floor(z + .31); bz++)
      for (let by = Math.floor(y + .001); by <= Math.floor(y + 1.74); by++) if (SOLID[this.get(bx, by, bz)]) return false;
    return true;
  }
  attackZombie(origin, direction, reach) {
    if (dot(direction, direction) < 1e-8) return false;
    const ray = norm(direction), blockDistance = this.blockDistance(origin, ray, reach);
    let found = -1, nearest = reach;
    this.zombies.forEach((z, i) => {
      const c = this.sphereHit(origin, ray, { x: z.x, y: z.y + .9, z: z.z }, .55, reach);
      if (c !== null && c <= nearest && c <= blockDistance) { found = i; nearest = c; }
    });
    if (found < 0) return false;
    return this.damageZombie(this.zombies[found].id, 1, 'player');
  }
  damageZombie(id, amount, source) {
    const i = this.zombies.findIndex(z => z.id === id); if (i < 0) return false;
    const z = this.zombies[i];
    z.health -= amount; this.mods.event('damage', { source, target: id, amount }); this.flashHurt(id);
    if (z.health <= 0) { this.zombies.splice(i, 1); this.drop('ROTTEN_FLESH', 1, z.x, z.y, z.z); }
    return true;
  }

  // ------------------------------------------------------------ hell forest creatures
  updateHellMobs(dt, players) {
    if (this.dimension !== 'HELL_FOREST' || !players.length) return;
    const far = m => players.every(p => (m.x - p.position.x) ** 2 + (m.z - p.position.z) ** 2 > 80 * 80);
    this.hellMobs = this.hellMobs.filter(m => !far(m)).slice(0, 4);
    this.hellSpawnClock -= Math.max(0, dt);
    if (this.hellSpawnClock <= 0) {
      this.hellSpawnClock = 25;
      if (this.hellMobs.length < 4) {
        const player = players[Math.floor(Math.random() * players.length)];
        for (let attempt = 0; attempt < 8; attempt++) {
          const angle = Math.random() * Math.PI * 2, radius = 24 + Math.floor(Math.random() * 13);
          const x = Math.trunc(player.position.x + Math.cos(angle) * radius), z = Math.trunc(player.position.z + Math.sin(angle) * radius);
          if (this.portals.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < 20 * 20)) continue;
          if (players.some(p => (p.position.x - x) ** 2 + (p.position.z - z) ** 2 < 24 * 24)) continue;
          const y = this.groundHeight(x, z) + 1;
          if (this.inside(x, y + 2, z) && this.get(x, y, z) === B.AIR && this.get(x, y + 1, z) === B.AIR && this.get(x, y + 2, z) === B.AIR
              && SOLID[this.get(x, y - 1, z)] && y > BC.LAVA_LEVEL) {
            const kind = Math.random() < .5 ? 'IMP' : 'BOAR';
            this.hellMobs.push(BC.HellMob.spawn(kind, x + .5, y + (kind === 'IMP' ? 1.2 : 0), z + .5));
            break;
          }
        }
      }
    }
    for (const mob of this.hellMobs) {
      let nearest = players[0], best = Infinity;
      for (const p of players) { const d = dist2(p.position, mob); if (d < best) { best = d; nearest = p; } }
      BC.HellMob.tick(mob, this, Math.min(dt, .1), nearest);
    }
  }
  attackHellMob(origin, direction, reach, inventory) {
    const d = norm(direction), wall = this.raycast(origin, d, reach);
    const limit = wall ? len(sub({ x: wall.x + .5, y: wall.y + .5, z: wall.z + .5 }, origin)) : reach;
    let found = -1, best = limit;
    this.hellMobs.forEach((mob, i) => {
      const r = mob.kind === 'IMP' ? .35 : .55;
      const hit = new BC.Bounds(mob.x - r, mob.y, mob.z - r, mob.x + r, mob.y + 1.2, mob.z + r).ray(origin, d, reach);
      if (hit && hit.distance < best) { best = hit.distance; found = i; }
    });
    if (found < 0) return false;
    const mob = this.hellMobs[found];
    mob.health -= 2; this.flashHurt(mob.id);
    if (mob.health <= 0) {
      this.hellMobs.splice(found, 1);
      const loot = mob.kind === 'IMP' ? 'EMBER_CRYSTAL' : 'COAL';
      // Fixed: loot that does not fit drops instead of vanishing.
      const left = inventory ? inventory.add(loot, 2) : 2;
      if (left > 0) this.drop(loot, left, mob.x, mob.y, mob.z);
    }
    return true;
  }

  // ------------------------------------------------------------ raycast (Amanatides–Woo)
  raycast(origin, direction, reach, includeWater = false) {
    if (dot(direction, direction) < 1e-12 || reach < 0) return null;
    const d = norm(direction);
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const sx = d.x >= 0 ? 1 : -1, sy = d.y >= 0 ? 1 : -1, sz = d.z >= 0 ? 1 : -1;
    const delta = v => v === 0 ? Infinity : Math.abs(1 / v);
    const boundary = (o, cell, v) => v === 0 ? Infinity : (v > 0 ? cell + 1 - o : o - cell) / Math.abs(v);
    const dx = delta(d.x), dy = delta(d.y), dz = delta(d.z);
    let tx = boundary(origin.x, x, d.x), ty = boundary(origin.y, y, d.y), tz = boundary(origin.z, z, d.z);
    let distance = 0, nx = 0, ny = 0, nz = 0;
    const accept = (contact) => contact && contact.distance + .0001 >= distance && contact.distance <= Math.min(tx, ty, tz) + .0001;
    while (distance <= reach) {
      const block = this.get(x, y, z);
      if (Block.door(block)) {
        const door = this.doorAt(x, y, z), contact = door ? BC.Door.bounds(door).ray(origin, d, reach) : null;
        if (accept(contact)) return { x, y, z, nx: contact.nx, ny: contact.ny, nz: contact.nz };
      } else if (block === B.STAIRS) {
        let nearest = null;
        for (const bounds of BC.Stairs.bounds(x, y, z, this.rotation(x, y, z))) {
          const c = bounds.ray(origin, d, reach);
          if (accept(c) && (!nearest || c.distance < nearest.distance)) nearest = c;
        }
        if (nearest) return { x, y, z, nx: nearest.nx, ny: nearest.ny, nz: nearest.nz };
      } else if (Block.bed(block) || block === B.LANTERN) {
        const bounds = Block.bed(block) ? new BC.Bounds(x, y, z, x + 1, y + .6, z + 1) : new BC.Bounds(x + .28, y, z + .28, x + .72, y + .83, z + .72);
        const c = bounds.ray(origin, d, reach);
        if (accept(c)) return { x, y, z, nx: c.nx, ny: c.ny, nz: c.nz };
      } else if (Block.crop(block)) {
        const h = .18 + Block.cropStage(block) * .18;
        const c = new BC.Bounds(x + .28, y, z + .28, x + .72, y + h + .12, z + .72).ray(origin, d, reach);
        if (accept(c)) return { x, y, z, nx: c.nx, ny: c.ny, nz: c.nz };
      } else if (SOLID[block] || block === B.TORCH || (includeWater && block === B.WATER)) return { x, y, z, nx, ny, nz };
      if (tx < ty && tx < tz) { x += sx; distance = tx; tx += dx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; distance = ty; ty += dy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; distance = tz; tz += dz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  // ------------------------------------------------------------ persistence
  snapshot() {
    const editsByBlock = {};
    for (const [k, b] of this.edits) (editsByBlock[BC.BLOCK_NAMES[b]] = editsByBlock[BC.BLOCK_NAMES[b]] || []).push(k);
    const slotsOut = s => s.item ? { item: s.item, count: s.count, durability: s.durability || 0 } : null;
    return {
      seed: this.seed, dimension: this.dimension, dayTime: this.dayTime, keepInventory: this.keepInventory,
      edits: editsByBlock,
      rotations: Array.from(this.rotations),
      doors: Array.from(this.doors.values()).map(d => ({ ...d })),
      stonecutters: Array.from(this.stonecutters, ([k, s]) => [k, { coal: slotsOut(s.coal), stone: slotsOut(s.stone), output: slotsOut(s.output), recipe: s.recipe }]),
      furnaces: Array.from(this.furnaces, ([k, s]) => [k, { coal: slotsOut(s.coal), input: slotsOut(s.input), output: slotsOut(s.output), fuel: this.furnaceFuel.get(k) || 0 }]),
      chests: Array.from(this.chests, ([k, c]) => [k, { slots: c.slots.map(slotsOut), deathCache: c.deathCache, opened: c.opened }]),
      water: Array.from(this.water.levels),
      sheep: this.sheep.map(s => ({ ...s })), zombies: this.zombies.map(z => ({ ...z })), hellMobs: this.hellMobs.map(m => ({ ...m })),
      mods: this.mods.save()
    };
  }
  static restore(saved) {
    const world = new World(saved.seed, saved.dimension || 'SURFACE');
    world.load(saved, true);
    return world;
  }
  /** Load (or replace with) a snapshot; returns the set of changed cell keys. */
  load(saved, fresh) {
    if (!saved || typeof saved !== 'object') throw new Error('Повреждённое сохранение');
    const max = this.width * this.depth * HEIGHT;
    const keyOk = k => Number.isInteger(k) && k >= 0 && k < max;
    const slotIn = s => s ? BC.restoreSlot(s) : EMPTY;
    const edits = new Map();
    for (const [name, keys] of Object.entries(saved.edits || {})) {
      let block = BC.Block.valueOf(name);
      if (block === B.ROTATOR) throw new Error('Некорректный блок');
      if (block === B.TORCH) block = B.LANTERN;
      if (block === B.CASTING_TABLE || block === B.WELDER) block = B.AIR;
      for (const k of keys) { if (!keyOk(k)) throw new Error('Некорректный блок'); edits.set(k, block); }
    }
    const changed = new Set();
    if (!fresh) {
      const prevDoors = new Map(this.doors), prevRot = new Map(this.rotations), prevWater = new Map(this.water.levels);
      const keys = new Set([...this.edits.keys(), ...edits.keys()]);
      const nextRot = new Map(saved.rotations || []), nextWater = new Map(saved.water || []);
      for (const k of keys) if (this.edits.get(k) !== edits.get(k) || prevRot.get(k) !== nextRot.get(k) || prevWater.get(k) !== nextWater.get(k)) changed.add(k);
      const nextDoors = new Map((saved.doors || []).map(d => [this.key(d.x, d.y, d.z), d]));
      for (const k of new Set([...prevDoors.keys(), ...nextDoors.keys()])) {
        const a = prevDoors.get(k), b = nextDoors.get(k);
        if (!a || !b || a.open !== b.open || a.facing !== b.facing) changed.add(k);
      }
    }
    this.edits = new Map(); this.chunkEdits = new Map();
    for (const [k, b] of edits) { const [x, , z] = this.unkey(k); this.putEdit(k, x, z, b); }
    this.rotations = new Map();
    for (const [k, r] of saved.rotations || []) {
      const b = edits.get(k);
      if (!keyOk(k) || b === undefined || b === B.AIR) continue;
      if (!Number.isInteger(r) || r < 1 || r > 3) throw new Error('Некорректная ориентация блока');
      this.rotations.set(k, r);
    }
    this.doors = new Map();
    for (const d of saved.doors || []) {
      if (!d || !Number.isInteger(d.x) || !Number.isInteger(d.y) || !Number.isInteger(d.z) || d.y < 1 || !this.inside(d.x, d.y + 1, d.z)
          || !Number.isInteger(d.facing) || d.facing < 0 || d.facing > 3) throw new Error('Некорректная дверь');
      const k = this.key(d.x, d.y, d.z);
      if (edits.get(k) !== B.DOOR || edits.get(this.key(d.x, d.y + 1, d.z)) !== B.DOOR_TOP) throw new Error('Повреждённая дверь');
      this.doors.set(k, { x: d.x, y: d.y, z: d.z, facing: d.facing, open: !!d.open });
    }
    this.stonecutters = new Map();
    for (const [k, s] of saved.stonecutters || []) {
      if (edits.get(k) !== B.STONECUTTER || !World.stonecutterRecipe(s.recipe)) throw new Error('Повреждённый камнерез');
      this.stonecutters.set(k, { coal: slotIn(s.coal), stone: slotIn(s.stone), output: slotIn(s.output), recipe: s.recipe });
    }
    this.furnaces = new Map(); this.furnaceFuel = new Map();
    for (const [k, s] of saved.furnaces || []) {
      if (edits.get(k) !== B.FURNACE) throw new Error('Повреждённая печь');
      this.furnaces.set(k, { coal: slotIn(s.coal), input: slotIn(s.input), output: slotIn(s.output) });
      if (s.fuel > 0) this.furnaceFuel.set(k, Math.min(8, s.fuel | 0));
    }
    this.chests = new Map();
    for (const [k, c] of saved.chests || []) {
      if (edits.get(k) !== B.CHEST || !Array.isArray(c.slots) || c.slots.length !== 27) throw new Error('Повреждённый сундук');
      this.chests.set(k, { slots: c.slots.map(slotIn), deathCache: !!c.deathCache, opened: !!c.opened });
    }
    this.water.levels = new Map();
    for (const [k, l] of saved.water || []) if (edits.get(k) === B.WATER && l >= 1 && l <= 7) this.water.levels.set(k, l);
    const finite = (...v) => v.every(Number.isFinite);
    this.sheep = (saved.sheep || []).filter(s => finite(s.x, s.y, s.z, s.dx, s.dz) && s.health >= 1)
      .map(s => ({ x: s.x, y: s.y, z: s.z, health: Math.min(3, s.health), dx: s.dx, dz: s.dz, flee: Math.min(4, s.flee || 0), id: s.id || 'sheep:' + BC.uuid() }));
    this.zombies = (saved.zombies || []).filter(z => finite(z.x, z.y, z.z) && z.health >= 1)
      .map(z => ({ x: z.x, y: z.y, z: z.z, health: Math.min(8, z.health), cooldown: z.cooldown || 0, vy: z.vy || 0, heading: z.heading || 0, id: z.id || 'zombie:' + BC.uuid() }));
    this.hellMobs = (saved.hellMobs || []).filter(m => finite(m.x, m.y, m.z) && (m.kind === 'IMP' || m.kind === 'BOAR') && m.health >= 1)
      .map(m => ({ ...m }));
    if (typeof saved.dayTime === 'number' && saved.dayTime >= 0 && saved.dayTime < 1) this.dayTime = saved.dayTime;
    this.keepInventory = !!saved.keepInventory;
    this.blockRevision += 1 + changed.size;
    if (fresh) {
      for (const k of this.edits.keys()) if (this.edits.get(k) === B.WATER || this.edits.get(k) === B.AIR) { const [x, y, z] = this.unkey(k); this.water.wake(x, y, z); }
      if (saved.mods) this.mods.restore(saved.mods);
    } else for (const k of changed) { const [x, , z] = this.unkey(k); this.notify(x, z); }
    return changed;
  }
}
function bedOffset(facing) {
  switch (BC.floorMod(facing, 4)) { case 0: return [0, 1]; case 1: return [-1, 0]; case 2: return [0, -1]; default: return [1, 0]; }
}
World.bedOffset = bedOffset;
BC.World = World;

/** A hovering forest imp and a heavy ash boar that charges nearby players. */
BC.HellMob = {
  maxHealth: kind => kind === 'IMP' ? 6 : 12,
  spawn: (kind, x, y, z) => ({ id: BC.uuid(), kind, x, y, z, health: kind === 'IMP' ? 6 : 12, heading: 0, cooldown: 0 }),
  fits(mob, world, x, y, z) {
    if (x < 1 || z < 1 || x >= world.width - 1 || z >= world.depth - 1 || y < 1 || y > HEIGHT - 3) return false;
    const r = mob.kind === 'IMP' ? .22 : .48;
    for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++) for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++)
      for (let by = Math.floor(y + .02); by <= Math.floor(y + .95); by++) {
        const b = world.get(bx, by, bz); if (SOLID[b] || b === B.HELL_LAVA) return false;
      }
    return true;
  },
  tick(mob, world, dt, target) {
    const t = target.position, dx = t.x - mob.x, dz = t.z - mob.z, distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > .01) mob.heading = Math.atan2(dx, dz);
    mob.cooldown = Math.max(0, mob.cooldown - dt);
    const imp = mob.kind === 'IMP', notice = imp ? 22 : 12, speed = imp ? 2.1 : 3.2;
    const fits = (x, y, z) => BC.HellMob.fits(mob, world, x, y, z);
    let nx = mob.x, nz = mob.z, ny = mob.y;
    if (distance < notice && distance > 1.1) {
      const mx = dx / distance * speed * dt, mz = dz / distance * speed * dt;
      if (fits(mob.x + mx, mob.y, mob.z)) nx += mx;
      if (fits(nx, mob.y, mob.z + mz)) nz += mz;
      if (nx === mob.x && nz === mob.z && fits(mob.x + mx, mob.y + 1, mob.z + mz)) { nx += mx; nz += mz; ny += Math.min(1, dt * 6); }
    }
    if (imp) {
      const desired = Math.min(HEIGHT - 3, Math.max(world.groundHeight(nx | 0, nz | 0) + 2.1, t.y + 1));
      const dy = Math.max(-dt, Math.min(dt, desired - ny)); if (fits(nx, ny + dy, nz)) ny += dy;
    } else if (fits(nx, ny - dt * 6, nz)) ny -= dt * 6;
    if (distance < (imp ? 1.7 : 1.5) && Math.abs(t.y - ny) < 2.5 && mob.cooldown === 0) {
      const from = { x: mob.x, y: mob.y + .6, z: mob.z };
      if (!world.raycast(from, sub({ x: t.x, y: t.y + .6, z: t.z }, from), distance)) target.damage(imp ? 2 : 3);
      mob.cooldown = 1.4;
    }
    mob.x = nx; mob.y = ny; mob.z = nz;
  }
};
})();
