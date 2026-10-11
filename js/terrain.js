/* Barnocraft WEB — procedural terrain: surface relief, rivers, deserts, caves, ores, trees,
 * the volcanic Hell Forest and paired portal ruins. Voxel data lives in 80×80 regions. */
(function () {
'use strict';
const BC = globalThis.BC;
const B = BC.B, noise = BC.noise, HEIGHT = BC.HEIGHT;

let cachedSeed = null, cachedSalts = null;
/** Per-seed noise channels (the Java edition XORs the long seed with ASCII constants). */
function salts(seed) {
  if (cachedSeed === seed) return cachedSalts;
  const m = i => BC.mix(seed, i);
  cachedSeed = seed;
  cachedSalts = {
    broad: m(1), slopes: m(2), detail: m(3), mountain: m(4), ridge: m(5), bank: m(6), bend: m(7), canyon: m(8),
    canyonFloor: m(9), rockA: m(10), rockB: m(11), biome: m(12), patch: m(13), hell: m(14), hellDetail: m(15),
    hellRoof: m(16), caves: m(17), ores: m(18), gold: m(19), trees: m(20), hellTrees: m(21), portals: m(22), sheep: m(23)
  };
  return cachedSalts;
}
BC.salts = salts;

const Terrain = BC.Terrain = {
  desert(seed, x, z) {
    const s = salts(seed);
    return noise(s.biome, x / 290, z / 290) > .02 && noise(s.patch, x / 92, z / 92) > -.38;
  },
  river(seed, x, z) {
    const s = salts(seed);
    const bank = Math.abs(noise(s.bank, x / 82, z / 82));
    const bend = noise(s.bend, x / 210, z / 210);
    return bank < .075 && Math.abs(bend) > .08;
  },
  height(seed, x, z) {
    const s = salts(seed);
    const broad = noise(s.broad, x / 105, z / 105) * 10;
    const slopes = noise(s.slopes, x / 39, z / 39) * 5;
    const detail = noise(s.detail, x / 13, z / 13) * 2;
    const field = Math.max(0, noise(s.mountain, x / 185, z / 185) - .12);
    const mountain = Math.pow(field, 1.35) * 112 + (field > 0 ? (1 - Math.abs(noise(s.ridge, x / 31, z / 31))) * 8 : 0);
    let surface = Math.round(14 + broad + slopes + detail + mountain);
    // A meandering lowland is the river bed; the spawn area stays dry.
    if (Terrain.river(seed, x, z) && (Math.abs(x - BC.WIDTH / 2) > 18 || Math.abs(z - BC.DEPTH / 2) > 18))
      surface = Math.min(surface, BC.WATER_LEVEL - 1);
    const canyon = Math.abs(noise(s.canyon, x / 112, z / 112));
    if (canyon < .105) surface = Math.min(surface, 9 + Math.round(Math.abs(noise(s.canyonFloor, x / 27, z / 27)) * 5));
    return Math.max(4, Math.min(HEIGHT - 8, surface));
  },
  rock(seed, x, y, z, depth) {
    if (y === 0 || depth < 3) return B.STONE;
    const s = salts(seed);
    const patch = noise(s.rockA, x / 6, z / 6) * .65 + noise(s.rockB, x / 10 + y / 4, z / 10 - y / 4) * .35;
    return patch > .4 - Math.min(depth, 10) * .035 ? B.DEEPSTONE : B.STONE;
  }
};

const HellTerrain = BC.HellTerrain = {
  height(seed, x, z) {
    const s = salts(seed);
    let surface = 29 + Math.round(noise(s.hell, x / 64, z / 64) * 12 + noise(s.hellDetail, x / 19, z / 19) * 3);
    const distance = Math.hypot(x - (BC.WIDTH / 2 + 48), z - (BC.DEPTH / 2 + 24));
    // The first arrival is a dry grove, never a low platform at the bottom of a lava lake.
    if (distance < 48) surface = Math.max(surface, BC.LAVA_LEVEL + 7 - Math.trunc(Math.max(0, (distance - 28) * .55)));
    return surface;
  },
  generate(region, seed, ox, oz) {
    const s = salts(seed), R = BC.REGION;
    for (let x = 0; x < R; x++) for (let z = 0; z < R; z++) {
      const wx = ox + x, wz = oz + z, floor = HellTerrain.height(seed, wx, wz);
      const roof = 83 + Math.trunc(noise(s.hellRoof, wx / 35, wz / 35) * 9);
      for (let y = 0; y <= floor; y++) region.set(x, y, z, y === floor ? B.HELL_SOIL : y < 5 ? B.HELL_BASALT : B.HELL_STONE);
      for (let y = floor + 1; y <= BC.LAVA_LEVEL; y++) region.set(x, y, z, B.HELL_LAVA);
      for (let y = roof; y < roof + 5; y++) region.set(x, y, z, B.HELL_BASALT);
      if (BC.floorMod(wx * 31 + wz * 47 + (seed | 0), 151) === 0) region.set(x, roof - 1, z, B.EMBER_CRYSTAL);
    }
    const random = new BC.Rng(BC.mix(s.hellTrees, ox, oz));
    for (let x = 5; x < R - 5; x += 10) for (let z = 5; z < R - 5; z += 10) {
      const tx = x + random.nextInt(3) - 1, tz = z + random.nextInt(3) - 1, ground = HellTerrain.height(seed, ox + tx, oz + tz);
      if (ground <= BC.LAVA_LEVEL || random.nextFloat() < .2) continue;
      const top = ground + 6 + random.nextInt(5);
      for (let y = ground + 1; y <= top; y++) region.set(tx, y, tz, B.HELL_LOG);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        if (dx * dx + dz * dz + dy * dy > 13 || (dx === 0 && dz === 0 && dy <= 0)) continue;
        region.set(tx + dx, top + dy, tz + dz, random.nextInt(23) === 0 ? B.EMBER_CRYSTAL : B.HELL_LEAVES);
      }
    }
  }
};

// ---------------------------------------------------------------- caves and ores
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const Underground = BC.Underground = {
  COAL_CHANCE: .020, IRON_CHANCE: .016, GOLD_CHANCE: .008,
  COAL_MIN_DEPTH: 2, IRON_MIN_DEPTH: 4, GOLD_MIN_DEPTH: 8,
  generate(world, seed) {
    const caves = new BC.Rng(BC.mix(seed, 0x43415645));
    for (let system = 0; system < 9; system++) {
      let sx = 0, sz = 0, found = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        sx = 10 + caves.nextInt(world.width - 20); sz = 10 + caves.nextInt(world.depth - 20);
        if (!world.protectedSpawn(sx, sz, 5) && world.groundHeight(sx, sz) >= 8) { found = true; break; }
      }
      if (!found) continue;
      let x = sx + .5, z = sz + .5, y = world.groundHeight(sx, sz) - 3.5;
      const startY = y; let heading = caves.nextDouble() * Math.PI * 2;
      const entranceHeading = heading + Math.PI;
      for (let step = 0; step < 110; step++) {
        carve(world, x, y, z, 1.7 + caves.nextDouble() * .6, false);
        if (step % 24 === 12) carve(world, x, y, z, 3, false);
        heading += (caves.nextDouble() - .5) * .45;
        x = Math.max(4, Math.min(world.width - 5, x + Math.cos(heading) * .85));
        z = Math.max(4, Math.min(world.depth - 5, z + Math.sin(heading) * .85));
        y += (caves.nextDouble() - .5) * .4 - (step < 65 ? .18 : 0);
        y = Math.max(3, Math.min(world.groundHeight(Math.trunc(x), Math.trunc(z)) - 3, y));
      }
      // A gently rising passage opens the system onto the surface.
      const ex = sx + .5 + Math.cos(entranceHeading) * 10, ez = sz + .5 + Math.sin(entranceHeading) * 10;
      const ey = world.groundHeight(Math.trunc(ex), Math.trunc(ez)) + 2;
      for (let step = 0; step <= 24; step++) {
        const t = step / 24;
        carve(world, sx + .5 + (ex - sx - .5) * t, startY + (ey - startY) * t, sz + .5 + (ez - sz - .5) * t, 1.8, true);
      }
    }
    generateOres(world, new BC.Rng(BC.mix(seed, 0x4f524553)));
    // A separate stream keeps coal and iron deposits stable.
    const gold = new BC.Rng(BC.mix(seed, 0x474f4c44));
    for (let x = 1; x < world.width - 1; x++) for (let z = 1; z < world.depth - 1; z++)
      for (let y = 1; y <= world.groundHeight(x, z) - Underground.GOLD_MIN_DEPTH; y++)
        if (BC.Block.rock(world.get(x, y, z)) && caveWall(world, x, y, z) && gold.nextDouble() < Underground.GOLD_CHANCE)
          vein(world, gold, x, y, z, B.GOLD_ORE, Underground.GOLD_MIN_DEPTH, 3 + gold.nextInt(4));
  },
  caveWall
};
function carve(world, cx, cy, cz, radius, entrance) {
  for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
    for (let z = Math.floor(cz - radius); z <= Math.ceil(cz + radius); z++) {
      if (x < 2 || z < 2 || x >= world.width - 2 || z >= world.depth - 2 || world.protectedSpawn(x, z, 5)) continue;
      for (let y = Math.max(1, Math.floor(cy - 2)); y <= Math.min(HEIGHT - 1, Math.ceil(cy + 2)); y++) {
        const dx = (x + .5 - cx) / radius, dy = (y + .5 - cy) / 2, dz = (z + .5 - cz) / radius;
        if (dx * dx + dy * dy + dz * dz > 1) continue;
        if (!entrance && y > world.groundHeight(x, z) - 2) continue;
        const block = world.get(x, y, z);
        if (BC.Block.rock(block) || block === B.GRASS || block === B.SAND) world.set(x, y, z, B.AIR);
      }
    }
}
function caveWall(world, x, y, z) {
  for (const side of SIDES) {
    const nx = x + side[0], ny = y + side[1], nz = z + side[2];
    if (world.inside(nx, ny, nz) && ny >= 1 && ny <= world.groundHeight(nx, nz) && world.get(nx, ny, nz) === B.AIR) return true;
  }
  return false;
}
function generateOres(world, random) {
  const U = Underground;
  for (let x = 1; x < world.width - 1; x++) for (let z = 1; z < world.depth - 1; z++)
    for (let y = 1; y < world.groundHeight(x, z); y++) {
      if (!BC.Block.rock(world.get(x, y, z)) || !caveWall(world, x, y, z)) continue;
      const roll = random.nextDouble();
      if (roll < U.COAL_CHANCE) vein(world, random, x, y, z, B.COAL_ORE, U.COAL_MIN_DEPTH, 3 + random.nextInt(4));
      else if (roll < U.COAL_CHANCE + U.IRON_CHANCE) vein(world, random, x, y, z, B.IRON_ORE, U.IRON_MIN_DEPTH, 3 + random.nextInt(4));
    }
}
function vein(world, random, x, y, z, ore, minDepth, size) {
  const frontier = [[x, y, z]];
  let placed = 0;
  while (frontier.length && placed < size) {
    const i = random.nextInt(frontier.length);
    const cell = frontier[i]; frontier[i] = frontier[frontier.length - 1]; frontier.pop();
    const [cx, cy, cz] = cell;
    if (!world.inside(cx, cy, cz) || cy < 1 || !BC.Block.rock(world.get(cx, cy, cz)) || world.groundHeight(cx, cz) - cy < minDepth) continue;
    world.set(cx, cy, cz, ore); placed++;
    for (const s of SIDES) frontier.push([cx + s[0], cy + s[1], cz + s[2]]);
  }
}

// ---------------------------------------------------------------- portals
const Portal = BC.Portal = {
  sites(seed, width, depth) {
    if (width < 160 || depth < 160) return [];
    const sites = [{ x: width / 2 + 48, z: depth / 2 + 24 }];
    const random = new BC.Rng(salts(seed).portals);
    for (let x = 96; x < width - 64; x += 192) for (let z = 96; z < depth - 64; z += 192) {
      const site = { x: x + random.nextInt(41) - 20, z: z + random.nextInt(41) - 20 };
      if (sites.every(p => Math.abs(p.x - site.x) >= 64 || Math.abs(p.z - site.z) >= 64)) sites.push(site);
    }
    return sites;
  },
  floor(site, seed, dimension) {
    return dimension === 'SURFACE' ? Terrain.height(seed, site.x, site.z)
      : Math.max(BC.LAVA_LEVEL + 3, HellTerrain.height(seed, site.x, site.z));
  },
  exit(site, world) { return { x: site.x + .5, y: Portal.floor(site, world.seed, world.dimension) + 1.01, z: site.z + 2.5 }; },
  touching(world, feet) {
    if (world.get(Math.floor(feet.x), Math.floor(feet.y + .6), Math.floor(feet.z)) !== B.FOREST_PORTAL) return null;
    return world.portals.find(p => Math.abs(feet.x - p.x) <= 2.5 && Math.abs(feet.z - p.z - .5) < 1) || null;
  },
  generate(region, seed, dimension, ox, oz, width, depth) {
    for (const site of Portal.sites(seed, width, depth)) {
      if (site.x + 4 < ox || site.x - 4 >= ox + BC.REGION || site.z + 6 < oz || site.z - 4 >= oz + BC.REGION) continue;
      const floor = Portal.floor(site, seed, dimension);
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 6; dz++) {
        for (let y = floor + 1; y <= floor + 7; y++) region.set(site.x + dx - ox, y, site.z + dz - oz, B.AIR);
        for (let y = floor - 3; y <= floor; y++) region.set(site.x + dx - ox, y, site.z + dz - oz, B.HELL_BASALT);
      }
      for (let dx = -2; dx <= 2; dx++) for (let dy = 0; dy <= 5; dy++)
        region.set(site.x + dx - ox, floor + dy, site.z - oz,
          Math.abs(dx) === 2 || dy === 0 || dy === 5 ? B.PORTAL_FRAME : B.FOREST_PORTAL);
      for (const dx of [-3, 3]) region.set(site.x + dx - ox, floor + 1, site.z + 2 - oz, B.EMBER_CRYSTAL);
    }
  },
  /** Returning stays possible even if someone built on the arrival pad. */
  safeExit(world, portal) {
    const exit = Portal.exit(portal, world);
    const x = Math.trunc(exit.x), y = Math.trunc(exit.y), z = Math.trunc(exit.z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      world.set(x + dx, y - 1, z + dz, B.HELL_BASALT);
      for (let dy = 0; dy < 3; dy++) world.set(x + dx, y + dy, z + dz, B.AIR);
    }
    return exit;
  }
};

// ---------------------------------------------------------------- regions
const R = BC.REGION;
class Region {
  constructor(seed, ox, oz, worldWidth, worldDepth, features, dimension) {
    this.ox = ox; this.oz = oz; this.worldWidth = worldWidth; this.worldDepth = worldDepth;
    this.width = R; this.depth = R;
    this.blocks = new Uint8Array(R * HEIGHT * R);
    this.ground = new Int16Array(R * R);
    if (dimension === 'HELL_FOREST') {
      HellTerrain.generate(this, seed, ox, oz);
      for (let x = 0; x < R; x++) for (let z = 0; z < R; z++) this.ground[x * R + z] = HellTerrain.height(seed, ox + x, oz + z);
      Portal.generate(this, seed, dimension, ox, oz, worldWidth, worldDepth);
      return;
    }
    for (let x = 0; x < R; x++) for (let z = 0; z < R; z++) {
      const wx = x + ox, wz = z + oz;
      const surface = features ? Terrain.height(seed, wx, wz) : 5;
      this.ground[x * R + z] = surface;
      const desert = features && Terrain.desert(seed, wx, wz);
      for (let y = 0; y <= surface; y++)
        this.set(x, y, z, y === surface ? (desert ? B.SAND : B.GRASS) : features ? Terrain.rock(seed, wx, y, wz, surface - y) : B.STONE);
      if (features && Terrain.river(seed, wx, wz)
          && (Math.abs(wx - worldWidth / 2) > 18 || Math.abs(wz - worldDepth / 2) > 18))
        for (let y = surface + 1; y <= BC.WATER_LEVEL; y++) this.set(x, y, z, B.WATER);
    }
    if (features) {
      Underground.generate(this, BC.mix(seed, ox, oz, 1));
      this.generateTrees(new BC.Rng(BC.mix(salts(seed).trees, ox, oz)), seed);
      Portal.generate(this, seed, dimension, ox, oz, worldWidth, worldDepth);
    }
  }
  generateTrees(random, seed) {
    // Jittered, randomly occupied cells give trees space without a regular grid of trunks.
    for (let cellX = 3; cellX < R - 2; cellX += 8) for (let cellZ = 3; cellZ < R - 2; cellZ += 8) {
      const x = cellX + random.nextInt(Math.min(4, R - 2 - cellX)), z = cellZ + random.nextInt(Math.min(4, R - 2 - cellZ));
      const desert = Terrain.desert(seed, x + this.ox, z + this.oz);
      if (Terrain.river(seed, x + this.ox, z + this.oz)) continue;
      if (random.nextFloat() > (desert ? .025 : .7)) continue;
      if (this.protectedSpawn(x, z, 7)) continue;
      const height = 4 + random.nextInt(3);
      if (this.get(x, this.groundHeight(x, z), z) === B.GRASS && this.crownClear(x, z, height)) this.growTree(x, z, height);
    }
  }
  crownClear(x, z, treeHeight) {
    const base = this.groundHeight(x, z) + 1, top = base + treeHeight - 1;
    for (let y = top - 1; y <= top + 2; y++) {
      const radius = y <= top ? 2 : 1;
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if ((radius === 2 || y === top + 2) && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
        if (this.groundHeight(x + dx, z + dz) >= y) return false;
      }
    }
    return true;
  }
  growTree(x, z, height) {
    const base = this.groundHeight(x, z) + 1, top = base + height - 1;
    for (let y = base; y <= top; y++) this.set(x, y, z, B.LOG);
    for (let y = top - 1; y <= top + 2; y++) {
      const radius = y <= top ? 2 : 1;
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if ((radius === 2 || y === top + 2) && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
        if (this.get(x + dx, y, z + dz) === B.AIR) this.set(x + dx, y, z + dz, B.LEAVES);
      }
    }
  }
  /** Original terrain surface, before trees and player edits. */
  groundHeight(x, z) { return x >= 0 && z >= 0 && x < R && z < R ? this.ground[x * R + z] : 0; }
  inside(x, y, z) { return x >= 0 && x < R && y >= 0 && y < HEIGHT && z >= 0 && z < R; }
  get(x, y, z) { return this.inside(x, y, z) ? this.blocks[(y * R + x) * R + z] : B.AIR; }
  set(x, y, z, block) {
    if (!this.inside(x, y, z)) return false;
    const i = (y * R + x) * R + z;
    if (this.blocks[i] === block) return false;
    this.blocks[i] = block; return true;
  }
  protectedSpawn(x, z, radius) {
    return Math.abs(x + this.ox - this.worldWidth / 2) <= radius && Math.abs(z + this.oz - this.worldDepth / 2) <= radius;
  }
}
BC.Region = Region;
})();
