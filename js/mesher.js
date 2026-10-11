/* Barnocraft WEB — chunk meshes with two-channel voxel lighting (sky + block light).
 * mesherFactory is self-contained: it is stringified into a Web Worker (works from file://)
 * and also used directly by tests. Hidden faces never reach the GPU. */
(function () {
'use strict';
const BC = globalThis.BC;

function mesherFactory() {
  const NAMES = ['AIR', 'GRASS', 'STONE', 'SAND', 'PLANKS', 'GLASS', 'LOG', 'LEAVES', 'COAL_ORE', 'IRON_ORE', 'DEEPSTONE', 'DOOR',
    'DOOR_TOP', 'STAIRS', 'ROTATOR', 'STONECUTTER', 'FURNACE', 'TORCH', 'WATER', 'CASTING_TABLE', 'WELDER', 'LANTERN', 'BED',
    'BED_HEAD', 'GOLD_ORE', 'FARMLAND', 'CROP_0', 'CROP_1', 'CROP_2', 'CROP_3', 'CHEST', 'HELL_SOIL', 'HELL_STONE', 'HELL_BASALT',
    'HELL_LOG', 'HELL_LEAVES', 'EMBER_CRYSTAL', 'HELL_LAVA', 'PORTAL_FRAME', 'FOREST_PORTAL'];
  const B = {}; NAMES.forEach((n, i) => { B[n] = i; });
  const crop = b => b >= B.CROP_0 && b <= B.CROP_3;
  const door = b => b === B.DOOR || b === B.DOOR_TOP;
  const bed = b => b === B.BED || b === B.BED_HEAD;
  const solid = b => b !== B.FOREST_PORTAL && b !== B.HELL_LAVA && b !== B.AIR && b !== B.WATER && b !== B.ROTATOR
    && b !== B.TORCH && b !== B.LANTERN && !crop(b);
  const blocksLight = b => solid(b) && !door(b) && !bed(b) && b !== B.STAIRS && b !== B.STONECUTTER && b !== B.GLASS
    && b !== B.LEAVES && b !== B.HELL_LEAVES;
  const SOLID = new Uint8Array(NAMES.length), OPAQUE = new Uint8Array(NAMES.length), OCCLUDER = new Uint8Array(NAMES.length);
  for (let b = 0; b < NAMES.length; b++) {
    SOLID[b] = solid(b) ? 1 : 0; OPAQUE[b] = blocksLight(b) ? 1 : 0;
    OCCLUDER[b] = solid(b) && b !== B.LEAVES && b !== B.CHEST && !door(b) && b !== B.STAIRS && b !== B.STONECUTTER && !bed(b) && b !== B.LANTERN ? 1 : 0;
  }
  const TEXTURES = ['grass.png', 'grass_2.png', 'stone.png', 'pesok.png', 'tree_planks.png', 'glass.png', 'tree.png', 'listia.png',
    'coal.png', 'iron.png', 'deeprock.png', 'door.png', 'stairs.png', 'stonecutter.png', 'furnace.png', 'torch.png', 'water.png',
    'casting_table.png', 'welder.png', 'lantern.png', 'bed.png', 'furnace_side.png', 'pillow.png', 'gold.png', 'farmland.png',
    'chest.png', 'hell_soil.png', 'hell_stone.png', 'hell_basalt.png', 'hell_log.png', 'hell_leaves.png', 'ember_crystal.png',
    'hell_lava.png', 'portal_frame.png', 'forest_portal.png'];
  const TRANSPARENT = new Set([5, 16, 34]), CUTOUT = new Set([7, 11, 15]);
  const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const U = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0]];
  const V = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]];
  const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const HEIGHT = 128, HALO = 15, CHUNK = 16, S = CHUNK + 2 * HALO, LAYER = S * S;

  function rotate(n, rotation) {
    let x = n[0], z = n[2];
    for (let t = 0; t < rotation; t++) { const old = x; x = -z; z = old; }
    return [x, n[1], z];
  }

  /** Propagate light through open voxels in descending buckets; each cell is queued at most once per level. */
  function computeLight(blocks) {
    const total = LAYER * HEIGHT;
    const sky = new Uint8Array(total), light = new Uint8Array(total), open = new Uint8Array(total);
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      let exposed = true;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const i = y * LAYER + z * S + x, b = blocks[i];
        open[i] = OPAQUE[b] ? 0 : 1;
        if (!open[i]) exposed = false;
        if (exposed) sky[i] = 15;
        if (b === B.TORCH || b === B.LANTERN) light[i] = 14;
        else if (b === B.EMBER_CRYSTAL || b === B.HELL_LAVA || b === B.FOREST_PORTAL) light[i] = 15;
      }
    }
    spread(sky, open); spread(light, open);
    return { sky, light };
  }
  function spread(levels, open) {
    const buckets = [];
    for (let l = 0; l <= 15; l++) buckets.push([]);
    for (let i = 0; i < levels.length; i++) if (levels[i] > 1) {
      // Sky cells with all-bright neighbours cannot raise anything; skip them cheaply.
      buckets[levels[i]].push(i);
    }
    for (let level = 15; level > 1; level--) {
      const list = buckets[level], next = level - 1, out = buckets[next];
      for (let n = 0; n < list.length; n++) {
        const i = list[n];
        if (levels[i] !== level) continue;
        const x = i % S, z = ((i % LAYER) / S) | 0, y = (i / LAYER) | 0;
        if (x > 0 && open[i - 1] && levels[i - 1] < next) { levels[i - 1] = next; out.push(i - 1); }
        if (x < S - 1 && open[i + 1] && levels[i + 1] < next) { levels[i + 1] = next; out.push(i + 1); }
        if (z > 0 && open[i - S] && levels[i - S] < next) { levels[i - S] = next; out.push(i - S); }
        if (z < S - 1 && open[i + S] && levels[i + S] < next) { levels[i + S] = next; out.push(i + S); }
        if (y > 0 && open[i - LAYER] && levels[i - LAYER] < next) { levels[i - LAYER] = next; out.push(i - LAYER); }
        if (y < HEIGHT - 1 && open[i + LAYER] && levels[i + LAYER] < next) { levels[i + LAYER] = next; out.push(i + LAYER); }
      }
      buckets[level] = null;
    }
  }

  class Builder {
    constructor(layer, lighting) {
      this.layer = layer; this.lighting = lighting;
      this.pos = []; this.nrm = []; this.uv = []; this.light = []; this.idx = [];
    }
    get vertices() { return this.pos.length / 3; }
    face(x, y, z, f, rotation, cx, cy, cz, size) {
      const base = this.vertices, normal = rotate(NORMALS[f], rotation), N = NORMALS[f], Uf = U[f], Vf = V[f];
      for (const t of UVS) {
        const p = [cx, cy, cz];
        for (let a = 0; a < 3; a++) p[a] += N[a] * size * .5 + Uf[a] * (t[0] - .5) * size + Vf[a] * (t[1] - .5) * size;
        let u = .5, v = .5;
        for (let a = 0; a < 3; a++) { u += (p[a] - .5) * Uf[a]; v += (p[a] - .5) * Vf[a]; }
        for (let r = 0; r < rotation; r++) { const px = p[0]; p[0] = 1 - p[2]; p[2] = px; }
        this.pos.push(x + p[0], y + p[1], z + p[2]);
        this.nrm.push(normal[0], normal[1], normal[2]);
        this.uv.push(u, v); this.light.push(0, 0);
      }
      this.lightFace(base);
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    cuboid(x, y, z, cx, cy, cz, sx, sy, sz, rotation) {
      const start = this.pos.length;
      for (let f = 0; f < 6; f++) this.face(x, y, z, f, 0, .5, .5, .5, 1);
      for (let i = start; i < this.pos.length; i += 3) {
        let px = cx + (this.pos[i] - x - .5) * sx, py = cy + (this.pos[i + 1] - y - .5) * sy, pz = cz + (this.pos[i + 2] - z - .5) * sz;
        for (let r = 0; r < rotation; r++) { const old = px; px = 1 - pz; pz = old; }
        this.pos[i] = x + px; this.pos[i + 1] = y + py; this.pos[i + 2] = z + pz;
        const n = rotate([this.nrm[i], this.nrm[i + 1], this.nrm[i + 2]], rotation);
        this.nrm[i] = n[0]; this.nrm[i + 1] = n[1]; this.nrm[i + 2] = n[2];
      }
      for (let v = start / 3; v < this.vertices; v += 4) this.lightFace(v);
    }
    waterFace(x, y, z, face, bottom, top) {
      const start = this.pos.length;
      this.face(x, y, z, face, 0, .5, .5, .5, 1);
      for (let i = start + 1; i < this.pos.length; i += 3) this.pos[i] = y + bottom + (this.pos[i] - y) * (top - bottom);
      this.lightFace(start / 3);
    }
    torch(x, y, z) {
      for (let f = 0; f < 6; f++) this.face(x, y, z, f, 0, .5, .34, .5, .14);
      for (const f of [2, 3, 4, 5]) this.face(x, y, z, f, 0, .5, .76, .5, .28);
    }
    stairs(x, y, z, rotation, filled) {
      for (let hx = 0; hx < 2; hx++) for (let hy = 0; hy < 2; hy++) for (let hz = 0; hz < 2; hz++) {
        if (!filled(hx, hy, hz)) continue;
        for (let f = 0; f < 6; f++) {
          const n = NORMALS[f];
          if (!filled(hx + n[0], hy + n[1], hz + n[2])) this.face(x, y, z, f, rotation, hx * .5 + .25, hy * .5 + .25, hz * .5 + .25, .5);
        }
      }
    }
    lightFace(vertex) {
      const c = [0, 0, 0];
      for (let v = 0; v < 4; v++) for (let a = 0; a < 3; a++) c[a] += this.pos[(vertex + v) * 3 + a] * .25;
      const cell = [0, 1, 2].map(a => Math.floor(c[a] + this.nrm[vertex * 3 + a] * .002));
      const sky = this.lighting.sky(cell[0], cell[1], cell[2]) / 15, block = this.lighting.block(cell[0], cell[1], cell[2]) / 15;
      for (let v = 0; v < 4; v++) { this.light[(vertex + v) * 2] = sky; this.light[(vertex + v) * 2 + 1] = block; }
    }
  }
  const stairsFilled = (x, y, z) => x >= 0 && x < 2 && y >= 0 && y < 2 && z >= 0 && z < 2 && (y === 0 || z === 0);

  /** snapshot: {cx, cz, blocks (S×S×128, index y*S*S+z*S+x), rotations (16×16×128), water (S×S×128), doors[]} */
  function buildChunk(snap) {
    const ox = snap.cx * CHUNK - HALO, oz = snap.cz * CHUNK - HALO, blocks = snap.blocks;
    const inS = (x, y, z) => x >= 0 && x < S && z >= 0 && z < S && y >= 0 && y < HEIGHT;
    const get = (x, y, z) => { x -= ox; z -= oz; return inS(x, y, z) ? blocks[y * LAYER + z * S + x] : 0; };
    const level = (x, y, z) => { x -= ox; z -= oz; return inS(x, y, z) ? snap.water[y * LAYER + z * S + x] : 0; };
    const rotation = (x, y, z) => snap.rotations[(y * CHUNK + (z - snap.cz * CHUNK)) * CHUNK + (x - snap.cx * CHUNK)];
    const waterHeight = (x, y, z) => get(x, y, z) !== B.WATER ? 0 : get(x, y + 1, z) === B.WATER ? 1 : .9 - .1 * level(x, y, z);
    const { sky, light } = computeLight(blocks);
    const sample = (data, x, y, z) => { x -= ox; z -= oz; return inS(x, y, z) ? data[y * LAYER + z * S + x] : 0; };
    const lighting = { sky: (x, y, z) => sample(sky, x, y, z), block: (x, y, z) => sample(light, x, y, z) };
    const doors = new Map((snap.doors || []).map(d => [d.x + ',' + d.y + ',' + d.z, d]));
    const builders = TEXTURES.map((t, i) => new Builder(i, lighting));
    const x0 = snap.cx * CHUNK, z0 = snap.cz * CHUNK;
    for (let x = x0; x < x0 + CHUNK; x++) for (let z = z0; z < z0 + CHUNK; z++) for (let y = 0; y < HEIGHT; y++) {
      const block = get(x, y, z);
      if (block === B.AIR) continue;
      if (block === B.FOREST_PORTAL) { builders[34].face(x, y, z, 4, 0, .5, .5, 0, 1); continue; }
      if (block === B.HELL_LAVA) {
        for (let f = 0; f < 6; f++) if (get(x + NORMALS[f][0], y + NORMALS[f][1], z + NORMALS[f][2]) !== B.HELL_LAVA)
          builders[32].face(x, y, z, f, 0, .5, .45, .5, 1);
        continue;
      }
      if (block === B.WATER) {
        const height = waterHeight(x, y, z);
        if (get(x, y + 1, z) === B.AIR) builders[16].waterFace(x, y, z, 2, 0, height);
        for (const f of [0, 1, 4, 5]) {
          const nx = x + NORMALS[f][0], nz = z + NORMALS[f][2], neighbor = get(nx, y, nz);
          const lower = neighbor === B.WATER ? waterHeight(nx, y, nz) : 0;
          if ((neighbor === B.AIR || neighbor === B.WATER) && lower < height) builders[16].waterFace(x, y, z, f, lower, height);
        }
        if (get(x, y - 1, z) === B.AIR) builders[16].waterFace(x, y, z, 3, 0, height);
        continue;
      }
      if (block === B.DOOR) {
        const d = doors.get(x + ',' + y + ',' + z);
        if (d) {
          const b = doorBounds(d);
          builders[11].cuboid(x, y, z, (b[0] + b[3]) / 2 - x, 1, (b[2] + b[5]) / 2 - z, b[3] - b[0], 2, b[5] - b[2], 0);
        }
        continue;
      }
      if (block === B.LANTERN) {
        builders[19].cuboid(x, y, z, .5, .10, .5, .44, .16, .44, 0);
        builders[19].cuboid(x, y, z, .5, .38, .5, .32, .42, .32, 0);
        builders[19].cuboid(x, y, z, .5, .63, .5, .44, .10, .44, 0);
        builders[21].cuboid(x, y, z, .5, .75, .5, .16, .16, .08, 0);
        continue;
      }
      if (bed(block)) {
        const r = rotation(x, y, z);
        builders[4].cuboid(x, y, z, .5, .27, .5, 1, .16, 1, r);
        builders[20].cuboid(x, y, z, .5, .46, .5, .94, .22, 1, r);
        for (const bx of [.12, .88]) builders[4].cuboid(x, y, z, bx, .12, block === B.BED ? .12 : .88, .15, .24, .15, r);
        if (block === B.BED_HEAD) builders[22].cuboid(x, y, z, .5, .58, .74, .78, .04, .38, r);
        continue;
      }
      if (block === B.TORCH) { builders[15].torch(x, y, z); continue; }
      if (crop(block)) {
        const h = .18 + (block - B.CROP_0) * .18;
        builders[7].cuboid(x, y, z, .5, h / 2, .5, .16, h, .16, 0);
        if (block - B.CROP_0 >= 2) builders[7].cuboid(x, y, z, .5, h, .5, .42, .16, .42, 0);
        continue;
      }
      if (block === B.FARMLAND) {
        builders[24].face(x, y, z, 2, 0, .5, .5, .5, 1);
        for (const f of [0, 1, 3, 4, 5]) builders[3].face(x, y, z, f, 0, .5, .5, .5, 1);
        continue;
      }
      if (block === B.CHEST) {
        const chest = builders[25], first = chest.vertices;
        chest.cuboid(x, y, z, .5, .45, .5, .88, .78, .78, 0);
        chest.cuboid(x, y, z, .5, .77, .5, .92, .18, .82, 0);
        chest.cuboid(x, y, z, .5, .45, .105, .12, .16, .025, 0);
        // Opaque inset models sample light outside their light-blocking voxel.
        for (let v = first; v < chest.vertices; v++) {
          const lx = x + chest.nrm[v * 3], ly = y + chest.nrm[v * 3 + 1], lz = z + chest.nrm[v * 3 + 2];
          chest.light[v * 2] = lighting.sky(lx, ly, lz) / 15; chest.light[v * 2 + 1] = lighting.block(lx, ly, lz) / 15;
        }
        continue;
      }
      if (!SOLID[block] || door(block)) continue;
      const rot = rotation(x, y, z);
      if (block === B.STONECUTTER) {
        builders[2].cuboid(x, y, z, .5, .30, .5, 1, .60, 1, rot);
        builders[13].cuboid(x, y, z, .5, .70, .5, .10, .58, .70, rot);
        for (let tooth = 0; tooth < 5; tooth++) builders[13].cuboid(x, y, z, .5, .98, .22 + tooth * .14, .14, .04, .07, rot);
        continue;
      }
      if (block === B.STAIRS) { builders[12].stairs(x, y, z, rot, stairsFilled); continue; }
      for (let f = 0; f < 6; f++) {
        const n = rotate(NORMALS[f], rot), neighbor = get(x + n[0], y + n[1], z + n[2]);
        if (OCCLUDER[neighbor] && (neighbor !== B.GLASS || block === B.GLASS)) continue;
        let texture;
        switch (block) {
          case B.GRASS: texture = f === 2 ? 1 : 0; break;
          case B.HELL_SOIL: texture = 26; break; case B.HELL_STONE: texture = 27; break; case B.HELL_BASALT: texture = 28; break;
          case B.HELL_LOG: texture = 29; break; case B.HELL_LEAVES: texture = 30; break; case B.EMBER_CRYSTAL: texture = 31; break;
          case B.PORTAL_FRAME: texture = 33; break; case B.STONE: texture = 2; break; case B.SAND: texture = 3; break;
          case B.PLANKS: texture = 4; break; case B.GLASS: texture = 5; break; case B.LOG: texture = 6; break;
          case B.LEAVES: texture = 7; break; case B.COAL_ORE: texture = 8; break; case B.IRON_ORE: texture = 9; break;
          case B.GOLD_ORE: texture = 23; break; case B.DEEPSTONE: texture = 10; break;
          case B.FURNACE: texture = f === 4 ? 14 : 21; break;
          case B.CASTING_TABLE: texture = f === 2 ? 17 : 4; break; case B.WELDER: texture = f === 2 || f === 4 ? 18 : 2; break;
          default: texture = 2;
        }
        builders[texture].face(x, y, z, f, rot, .5, .5, .5, 1);
      }
    }
    // Three draw groups: opaque, double-sided cutout and blended transparent.
    const groups = { opaque: [], cutout: [], transparent: [] };
    for (const b of builders) if (b.idx.length) groups[TRANSPARENT.has(b.layer) ? 'transparent' : CUTOUT.has(b.layer) ? 'cutout' : 'opaque'].push(b);
    const result = { key: snap.key, version: snap.version, groups: {} }, transfer = [];
    for (const [name, list] of Object.entries(groups)) {
      if (!list.length) continue;
      let vertices = 0, indices = 0;
      for (const b of list) { vertices += b.vertices; indices += b.idx.length; }
      const pos = new Float32Array(vertices * 3), nrm = new Int8Array(vertices * 3), uv = new Float32Array(vertices * 2),
        lit = new Float32Array(vertices * 2), lay = new Float32Array(vertices), idx = new Uint32Array(indices);
      let v = 0, n = 0;
      for (const b of list) {
        pos.set(b.pos, v * 3); nrm.set(b.nrm, v * 3); uv.set(b.uv, v * 2); lit.set(b.light, v * 2); lay.fill(b.layer, v, v + b.vertices);
        for (let i = 0; i < b.idx.length; i++) idx[n + i] = b.idx[i] + v;
        v += b.vertices; n += b.idx.length;
      }
      result.groups[name] = { pos, nrm, uv, lit, lay, idx };
      transfer.push(pos.buffer, nrm.buffer, uv.buffer, lit.buffer, lay.buffer, idx.buffer);
    }
    return { result, transfer };
  }
  function doorBounds(d) {
    const { x, y, z } = d;
    switch ((d.facing + (d.open ? 1 : 0)) & 3) {
      case 0: return [x, y, z, x + 1, y + 2, z + .125];
      case 1: return [x, y, z, x + .125, y + 2, z + 1];
      case 2: return [x, y, z + .875, x + 1, y + 2, z + 1];
      default: return [x + .875, y, z, x + 1, y + 2, z + 1];
    }
  }
  return { buildChunk, computeLight, TEXTURES, HALO, SIZE: S };
}

BC.mesherFactory = mesherFactory;
BC.Mesher = mesherFactory();
BC.TEXTURES = BC.Mesher.TEXTURES;

/** Copy everything a chunk mesh needs (with a 15-block light halo) into transferable arrays. */
BC.chunkSnapshot = function (world, cx, cz, key, version) {
  const { HALO, SIZE: S } = BC.Mesher, H = BC.HEIGHT, R = BC.REGION, LAYER = S * S, CH = BC.CHUNK;
  const ox = cx * CH - HALO, oz = cz * CH - HALO;
  const blocks = new Uint8Array(LAYER * H), water = new Uint8Array(LAYER * H), rotations = new Uint8Array(CH * CH * H);
  for (let z = 0; z < S; z++) {
    const wz = oz + z; if (wz < 0 || wz >= world.depth) continue;
    for (let x = 0; x < S; x++) {
      const wx = ox + x; if (wx < 0 || wx >= world.width) continue;
      const region = world.region(wx, wz), src = region.blocks, base = (wx % R) * R + (wz % R), off = z * S + x;
      for (let y = 0; y < H; y++) blocks[y * LAYER + off] = src[y * R * R + base];
    }
  }
  const doors = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const ccx = cx + dx, ccz = cz + dz;
    if (ccx < 0 || ccz < 0 || ccx >= world.chunksX || ccz >= world.chunksZ) continue;
    const keys = world.chunkEdits.get(ccx * world.chunksZ + ccz); if (!keys) continue;
    for (const k of keys) {
      const [x, y, z] = world.unkey(k), lx = x - ox, lz = z - oz;
      if (lx < 0 || lz < 0 || lx >= S || lz >= S) continue;
      const i = y * LAYER + lz * S + lx;
      blocks[i] = world.edits.get(k);
      const level = world.water.levels.get(k); if (level) water[i] = level;
      if (dx === 0 && dz === 0) {
        const r = world.rotations.get(k); if (r) rotations[(y * CH + (z - cz * CH)) * CH + (x - cx * CH)] = r;
        const d = world.doors.get(k); if (d) doors.push({ ...d });
      }
    }
  }
  return { snapshot: { key, version, cx, cz, blocks, water, rotations, doors }, transfer: [blocks.buffer, water.buffer, rotations.buffer] };
};

/** A worker created from a Blob, so it also works when index.html is opened from disk. */
BC.createMesherWorker = function () {
  const source = 'const M=(' + mesherFactory.toString() + ')();\n'
    + 'self.onmessage=function(e){try{const o=M.buildChunk(e.data);self.postMessage(o.result,o.transfer);}'
    + 'catch(err){self.postMessage({key:e.data.key,version:e.data.version,error:String(err&&err.stack||err)});}};';
  return new Worker(URL.createObjectURL(new Blob([source], { type: 'application/javascript' })));
};
})();
