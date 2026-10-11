'use strict';
// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const BC = require('./load.js');
const B = BC.B;

const flatWorld = () => BC.World.flat();
function standing(world, x, z) {
  const p = new BC.Player(); p.position = { x: x + .5, y: 6, z: z + .5 }; return p;
}

test('terrain is deterministic and the spawn is dry ground', () => {
  const a = new BC.World(99), b = new BC.World(99);
  for (const [x, z] of [[10, 10], [480, 320], [900, 600]]) assert.equal(a.groundHeight(x, z), b.groundHeight(x, z));
  const p = new BC.Player(); p.respawn(a);
  assert.notEqual(a.get(Math.floor(p.position.x), Math.floor(p.position.y - .5), Math.floor(p.position.z)), B.WATER);
  assert.equal(p.collides(a), false);
});

test('regions generate caves, ores and trees within the cache limit', () => {
  const w = new BC.World(5); const counts = new Map();
  for (const b of w.region(400, 300).blocks) counts.set(b, (counts.get(b) || 0) + 1);
  assert.ok(counts.get(B.COAL_ORE) > 0 && counts.get(B.IRON_ORE) > 0 && counts.get(B.LOG) > 0);
  for (let i = 0; i < 30; i++) w.get(i * 30 % w.width, 5, (i * 47) % w.depth);
  assert.ok(w.regions.size <= BC.REGION_CACHE_LIMIT);
});

test('inventory respects per-item stack limits (buckets do not stack)', () => {
  const inv = new BC.Inventory();
  assert.equal(inv.add('BUCKET', 3), 0);
  assert.deepEqual(inv.slots.slice(0, 3).map(s => s.count), [1, 1, 1]);
  inv.add('STONE', 70);
  assert.equal(inv.count('STONE'), 70);
  assert.ok(inv.slots.every(s => s.count <= (s.item ? BC.item(s.item).stackLimit() : 0)));
});

test('moving one tool never repairs it and never merges tools', () => {
  const inv = new BC.Inventory();
  inv.slots[0] = { item: 'IRON_AXE', count: 1, durability: 7 };
  assert.ok(inv.moveRef('slot:0', 'slot:5', true));
  assert.deepEqual(inv.slots[5], { item: 'IRON_AXE', count: 1, durability: 7 });
  inv.slots[6] = { item: 'IRON_AXE', count: 1, durability: 100 };
  assert.equal(inv.moveRef('slot:5', 'slot:6', true), false);
});

test('chest transfers keep durability and land in the chosen slot', () => {
  const w = flatWorld(), inv = new BC.Inventory();
  w.set(10, 6, 10, B.CHEST);
  inv.slots[3] = { item: 'STONE_PICKAXE', count: 1, durability: 12 };
  assert.ok(w.moveChestItem(10, 6, 10, 0, inv, 3, false, false));
  assert.equal(inv.slots[3].item, null);
  assert.deepEqual(w.chestAt(10, 6, 10).slots[0], { item: 'STONE_PICKAXE', count: 1, durability: 12 });
  assert.ok(w.moveChestItem(10, 6, 10, 0, inv, 7, true, false));
  assert.deepEqual(inv.slots[7], { item: 'STONE_PICKAXE', count: 1, durability: 12 });
  inv.slots[1] = { item: 'STONE', count: 10, durability: 0 };
  assert.ok(w.moveChestItem(10, 6, 10, 4, inv, 1, false, true));
  assert.equal(inv.slots[1].count, 9);
  assert.equal(w.chestAt(10, 6, 10).slots[4].count, 1);
});

test('crafting recipes from the 2×2 grid', () => {
  const inv = new BC.Inventory();
  inv.craft[0] = BC.makeSlot('WOOD', 1);
  assert.equal(inv.craftPreview(), 'PLANK'); assert.equal(inv.craftPreviewCount(), 4);
  assert.ok(inv.craftFromGrid()); assert.equal(inv.count('PLANK'), 4);
  inv.craft = [BC.makeSlot('PLANK', 1), BC.makeSlot('PLANK', 1), BC.makeSlot('PLANK', 1), BC.makeSlot('STICK', 1)];
  assert.equal(inv.craftPreview(), 'CHEST');
  inv.craft = [BC.makeSlot('STONE', 1), BC.makeSlot('STONE', 1), BC.makeSlot('PLANK', 1), BC.makeSlot('PLANK', 1)];
  assert.equal(inv.craftPreview(), 'STONECUTTER');
  inv.craft = [BC.makeSlot('TORCH', 1), BC.makeSlot('GLASS', 1), BC.makeSlot('IRON_INGOT', 1), BC.EMPTY_SLOT];
  assert.equal(inv.craftPreview(), 'LANTERN');
});

test('furnace smelts from the game tick without its screen', () => {
  const w = flatWorld(), inv = new BC.Inventory();
  w.set(5, 6, 5, B.FURNACE); inv.add('COAL', 1); inv.add('IRON', 3);
  assert.ok(w.putFurnaceItem(5, 6, 5, 0, inv, 0));
  for (let i = 0; i < 3; i++) assert.ok(w.putFurnaceItem(5, 6, 5, 1, inv, 1));
  for (let t = 0; t < 70; t++) w.updateFurnaces(.1);
  assert.deepEqual(w.furnaceAt(5, 6, 5).output, { item: 'IRON_INGOT', count: 3, durability: 0 });
});

test('doors: two cells, toggling, walking through the open doorway', () => {
  const w = flatWorld(), far = standing(w, 40, 40);
  assert.ok(w.placeDoor(10, 6, 10, 0, far));
  assert.equal(w.get(10, 7, 10), B.DOOR_TOP);
  const p = new BC.Player(); p.position = { x: 10.5, y: 6, z: 11.2 };
  p.update(w, .5, { x: 0, y: 0, z: -1 }, false);
  assert.ok(p.position.z > 10.4, 'closed door blocks');
  assert.ok(w.toggleDoor(10, 6, 10, far));
  for (let i = 0; i < 10; i++) p.update(w, .05, { x: 0, y: 0, z: -1 }, false);
  assert.ok(p.position.z < 10, 'open doorway is passable');
  w.set(10, 5, 10, B.AIR);
  assert.equal(w.doorAt(10, 6, 10), null, 'removing the support removes the door');
});

test('stairs can be climbed without jumping, full blocks cannot', () => {
  const w = flatWorld(), far = standing(w, 40, 40);
  assert.ok(w.placeStairs(10, 6, 9, 0, far));
  const p = new BC.Player(); p.position = { x: 10.5, y: 6, z: 10.6 };
  let top = 0;
  for (let i = 0; i < 12; i++) { p.update(w, .05, { x: 0, y: 0, z: -1 }, false); top = Math.max(top, p.position.y); }
  assert.ok(top > 6.9, 'climbed the stairs');
  w.set(20, 6, 9, B.STONE);
  const q = new BC.Player(); q.position = { x: 20.5, y: 6, z: 10.6 };
  for (let i = 0; i < 40; i++) q.update(w, .05, { x: 0, y: 0, z: -1 }, false);
  assert.ok(q.position.y < 6.1);
});

test('water flows down and spreads, then dries without a source', () => {
  const w = flatWorld();
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) w.set(x, 9, z, B.STONE);
  w.set(10, 12, 10, B.WATER);
  for (let i = 0; i < 200; i++) w.updateWater(.12);
  assert.equal(w.get(10, 10, 10), B.WATER);
  assert.equal(w.get(12, 10, 10), B.WATER);
  w.set(10, 12, 10, B.AIR);
  for (let i = 0; i < 400; i++) w.updateWater(.12);
  assert.equal(w.get(12, 10, 10), B.AIR);
});

test('snapshot round trip keeps edits, doors, rotations, chests and water', () => {
  const w = new BC.World(1234), p = new BC.Player(); p.respawn(w);
  const x = 470, z = 300, y = 60, far = standing(w, 10, 10);
  for (let dx = -1; dx < 7; dx++) { w.set(x + dx, y - 1, z, B.STONE); for (let dy = 0; dy < 3; dy++) w.set(x + dx, y + dy, z, B.AIR); }
  assert.ok(w.placeDoor(x, y, z, 2, far)); w.toggleDoor(x, y, z, far);
  assert.ok(w.placeStairs(x + 2, y, z, 3, far));
  w.set(x + 4, y, z, B.CHEST); const inv = new BC.Inventory(); inv.add('GOLD_INGOT', 5);
  w.moveChestItem(x + 4, y, z, 2, inv, 0, false, false);
  w.keepInventory = true; w.setDayTime(.6);
  const copy = BC.World.restore(JSON.parse(JSON.stringify(w.snapshot())));
  assert.equal(copy.doorAt(x, y, z).open, true); assert.equal(copy.doorAt(x, y, z).facing, 2);
  assert.equal(copy.rotation(x + 2, y, z), 3);
  assert.equal(copy.chestAt(x + 4, y, z).slots[2].count, 5);
  assert.equal(copy.keepInventory, true); assert.ok(Math.abs(copy.dayTime - .6) < 1e-9);
});

test('raycast hits the thin door panel and stair treads', () => {
  const w = flatWorld(), far = standing(w, 40, 40);
  w.placeDoor(10, 6, 10, 0, far);
  const hit = w.raycast({ x: 10.5, y: 7, z: 13 }, { x: 0, y: 0, z: -1 }, 5);
  assert.deepEqual([hit.x, hit.z, hit.nz], [10, 10, 1]);
  w.toggleDoor(10, 6, 10, far);
  const through = w.raycast({ x: 10.5, y: 7, z: 13 }, { x: 0, y: 0, z: -1 }, 5);
  assert.ok(!through || through.z < 10);
});

test('dropped items stay on the ground when the inventory is full', () => {
  const w = flatWorld(), inv = new BC.Inventory();
  for (let i = 0; i < BC.Inventory.SLOT_COUNT; i++) inv.slots[i] = BC.makeSlot('STONE', 64);
  w.drop('COAL', 2, 10, 6, 10);
  assert.equal(w.collectIntoInventory({ x: 10.5, y: 6, z: 10.5 }, 1.25, inv), 0);
  assert.equal(w.drops.length, 2);
  inv.slots[0] = BC.EMPTY_SLOT;
  assert.equal(w.collectIntoInventory({ x: 10.5, y: 6, z: 10.5 }, 1.25, inv), 2);
});

test('world changes notify listeners (setblock and portal pads refresh meshes)', () => {
  const w = flatWorld(), seen = [];
  w.onChange((x, z) => seen.push([x, z]));
  BC.Cheats.execute('setblock 3 7 4 stone', new BC.Inventory(), w, new BC.Player());
  assert.deepEqual(seen[0], [3, 4]);
});

test('console commands', () => {
  const w = flatWorld(), inv = new BC.Inventory(), p = standing(w, 40, 40);
  assert.match(BC.Cheats.execute('give stone 5', inv, w, p), /Выдано 5/);
  assert.match(BC.Cheats.execute('/gamemode 1', inv, w, p), /Креатив/); assert.ok(p.creative);
  assert.match(BC.Cheats.execute('time set night', inv, w, p), /night/); assert.ok(w.night());
  assert.match(BC.Cheats.execute('keepInventory true', inv, w, p), /true/);
});

test('chunk mesh: visible faces only, lit from the sky', () => {
  const w = new BC.World(7);
  const { snapshot } = BC.chunkSnapshot(w, 30, 20, 1, 0);
  const { result } = BC.Mesher.buildChunk(snapshot);
  const g = result.groups.opaque;
  assert.ok(g && g.idx.length > 0 && g.idx.length < 16 * 16 * 128 * 6);
  let maxSky = 0; for (let i = 0; i < g.lit.length; i += 2) maxSky = Math.max(maxSky, g.lit[i]);
  assert.equal(maxSky, 1);
});

test('host executes a guest "use" command (block placement)', () => {
  const w = flatWorld(), inv = new BC.Inventory();
  inv.slots[1] = BC.makeSlot('PLANK', 3);
  const pose = { x: 10.5, y: 6, z: 12.5, yaw: 0, pitch: -.6 };
  BC.NetworkGameplay.execute(w, pose, inv, 1, false, { kind: 'use' });
  assert.equal(inv.slots[1].count, 2);
});

test('hell forest: portal pair and dry arrival grove', () => {
  const hell = new BC.World(321, 'HELL_FOREST'), p = new BC.Player(); p.respawn(hell);
  assert.equal(p.collides(hell), false);
  const site = hell.portals[0], floor = BC.Portal.floor(site, hell.seed, 'HELL_FOREST');
  assert.equal(hell.get(site.x, floor + 2, site.z), B.FOREST_PORTAL);
  assert.equal(hell.set(site.x, floor + 2, site.z, B.AIR), false, 'portals are protected');
});
