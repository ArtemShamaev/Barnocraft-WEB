/* Barnocraft WEB — engine primitives for mods: declarative entities, projectiles, overlays, storage.
 * Entity AI and spawning rules belong to the Python packages (see mods.js). */
(function () {
'use strict';
const BC = globalThis.BC;
const B = BC.B, SOLID = BC.SOLID;

function num(m, k, fallback) {
  const v = m[k]; if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(k + ': expected finite number');
  return v;
}
function integer(m, k, fallback, min, max) {
  const n = num(m, k, fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(k + ': out of range');
  return n;
}
function bounded(m, k, fallback, min, max) {
  const v = num(m, k, fallback); if (v < min || v > max) throw new Error(k + ': out of bounds'); return v;
}
function str(m, k, fallback) {
  const v = m[k]; if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') throw new Error(k + ': expected string'); return v;
}
function validatePixels(rows, limit) {
  if (!Array.isArray(rows) || !rows.length || rows.length > limit) throw new Error('Pixel dimensions');
  const width = Array.isArray(rows[0]) ? rows[0].length : 0;
  if (width < 1 || width > limit) throw new Error('Pixel width');
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== width) throw new Error('Ragged pixels');
    for (const c of r) if (typeof c !== 'string' || !/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(c)) throw new Error('Pixel color');
  }
}
BC.Json = { num, integer, bounded, str, validatePixels };

class ModWorld {
  constructor(world) {
    this.world = world;
    this.definitions = new Map(); this.entities = new Map(); this.projectiles = [];
    this.storage = {}; this.events = []; this.overlays = new Map();
    this.notice = ''; this.shotCooldown = 0; this.serial = 0;
  }
  event(name, data) {
    if (name === 'notice') this.notice = typeof data.text === 'string' ? data.text : '';
    if (this.events.length >= 256) this.events.shift();
    this.events.push({ event: name, data });
  }
  drainEvents() { const e = this.events; this.events = []; return e; }
  register(namespace, manifest) {
    for (const d of manifest.items || []) {
      const id = BC.owned(namespace, str(d, 'id', ''));
      if (d.icon !== undefined) validatePixels(d.icon, 32);
      if ('food' in d) integer(d, 'food', 0, 0, 20);
      if ('cooking_result' in d) BC.owned(namespace, str(d, 'cooking_result', ''));
      if (d.projectile) {
        const s = d.projectile; BC.owned(namespace, str(s, 'ammo', ''));
        bounded(s, 'speed', 20, 5, 30); bounded(s, 'cooldown', .6, .2, 5); integer(s, 'damage', 4, 1, 10);
      }
      BC.Items.register(id, d);
    }
    for (const d of manifest.entities || []) {
      const id = BC.owned(namespace, str(d, 'id', ''));
      integer(d, 'health', 8, 1, 100); bounded(d, 'speed', 2, 0, 6); bounded(d, 'height', 1.7, .2, 3); bounded(d, 'radius', .3, .1, 1); integer(d, 'damage', 2, 1, 10);
      const parts = d.model || []; if (parts.length > 48) throw new Error('Model part limit');
      for (const m of parts) {
        for (const k of ['x', 'y', 'z']) bounded(m, k, 0, -3, 3);
        for (const k of ['sx', 'sy', 'sz']) bounded(m, k, .2, .005, 3);
        if (!/^[0-9a-fA-F]{6}$/.test(str(m, 'color', 'dddddd'))) throw new Error('Model color');
      }
      for (const loot of d.loot || []) {
        const item = str(loot, 'item', ''); const it = BC.Items.get(item);
        if (item.includes(':') && !it.definition) throw new Error('Unregistered loot item');
        integer(loot, 'count', 1, 1, 16);
      }
      this.definitions.set(id, JSON.parse(JSON.stringify(d)));
    }
    for (const r of manifest.recipes || []) BC.Items.registerRecipe(namespace, r);
  }
  def(e) { return this.definitions.get(e.type) || {}; }
  height(e) { return num(this.def(e), 'height', 1.7); }
  data(e) { return { id: e.id, type: e.type, x: e.x, y: e.y, z: e.z, health: e.health, owner: e.owner, heading: e.heading }; }
  surface(x, z) {
    for (let y = BC.HEIGHT - 2; y >= 0; y--) { const b = this.world.get(x, y, z); if (SOLID[b] || b === B.WATER) return y; }
    return 0;
  }
  spawn(type, x, z) {
    const d = this.definitions.get(type); if (!d) throw new Error('Unknown entity type');
    if (this.entities.size >= 64 || !this.world.inside(x | 0, 6, z | 0)) throw new Error('Entity cap or world boundary');
    const y = this.surface(x | 0, z | 0) + 1;
    const e = { id: 'mod:' + (++this.serial), type, x, y, z, vy: 0, heading: 0, cooldown: 0, goalTime: 0, hurtTime: 0,
      health: integer(d, 'health', 8, 1, 100), owner: '', goalX: x, goalZ: z, stop: 0 };
    if (this.world.get(x | 0, y | 0, z | 0) === B.WATER || !this.fits(e, x, y, z)) throw new Error('Blocked spawn');
    this.entities.set(e.id, e); this.event('entity_spawn', this.data(e));
    return e;
  }
  controlled(namespace, id) {
    const e = this.entities.get(id);
    if (!e || !e.type.startsWith(namespace + ':')) throw new Error('Entity is not owned by this mod');
    return e;
  }
  position(id, player) {
    if (id === 'player') return { x: player.position.x, y: player.position.y + .8, z: player.position.z };
    const e = this.entities.get(id); if (e) return { x: e.x, y: e.y + this.height(e) * .5, z: e.z };
    for (const z of this.world.zombies) if (z.id === id) return { x: z.x, y: z.y + .9, z: z.z };
    for (const s of this.world.sheep) if (s.id === id) return { x: s.x, y: s.y + .6, z: s.z };
    return null;
  }
  fits(e, x, y, z) {
    const r = num(this.def(e), 'radius', .3), w = this.world;
    if (x < r || z < r || x >= w.width - r || z >= w.depth - r || y < 0) return false;
    for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++) for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++)
      for (let by = Math.floor(y + .001); by <= Math.floor(y + this.height(e) - .01); by++) if (SOLID[w.get(bx, by, bz)]) return false;
    return true;
  }
  tick(tpf, player) {
    const dt = Math.min(.1, Math.max(0, tpf));
    this.shotCooldown = Math.max(0, this.shotCooldown - dt);
    for (const e of this.entities.values()) {
      e.cooldown = Math.max(0, e.cooldown - dt); e.goalTime = Math.max(0, e.goalTime - dt); e.hurtTime = Math.max(0, e.hurtTime - dt);
      let remaining = dt;
      while (remaining > 0) {
        const step = Math.min(remaining, 1 / 60); remaining -= step;
        const dx = e.goalX - e.x, dz = e.goalZ - e.z, dist = Math.sqrt(dx * dx + dz * dz);
        const ground = !this.fits(e, e.x, e.y - .04, e.z);
        if (e.goalTime > 0 && dist > e.stop) {
          e.heading = Math.atan2(dx, dz);
          const speed = num(this.def(e), 'speed', 2), mx = dx / dist * speed * step, mz = dz / dist * speed * step;
          if (ground && !this.fits(e, e.x + mx, e.y, e.z + mz) && this.fits(e, e.x + mx, e.y + 1.1, e.z + mz)) e.vy = 8;
          if (this.fits(e, e.x + mx, e.y, e.z)) e.x += mx;
          if (this.fits(e, e.x, e.y, e.z + mz)) e.z += mz;
        }
        e.vy -= 22 * step;
        const next = e.y + e.vy * step;
        if (this.fits(e, e.x, next, e.z)) e.y = next;
        else {
          let lo = 0, hi = 1;
          for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (this.fits(e, e.x, e.y + (next - e.y) * mid, e.z)) lo = mid; else hi = mid; }
          e.y += (next - e.y) * lo; e.vy = 0;
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => {
      p.life -= dt; let hit = false;
      const speed = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z);
      const steps = Math.max(1, Math.ceil(speed * dt / .15)), h = dt / steps;
      for (let i = 0; i < steps && !hit; i++) {
        const delta = { x: p.velocity.x * h, y: p.velocity.y * h, z: p.velocity.z * h };
        const length = Math.hypot(delta.x, delta.y, delta.z);
        if (this.world.raycast(p.position, delta, length)) { hit = true; break; }
        p.position.x += delta.x; p.position.y += delta.y; p.position.z += delta.z; p.velocity.y -= 8 * h;
        const targets = ['player', ...this.entities.keys(), ...this.world.zombies.map(z => z.id), ...this.world.sheep.map(s => s.id)];
        for (const id of targets) {
          if (id === p.source) continue;
          const shooter = this.entities.get(p.source); if (shooter && id === shooter.owner) continue;
          const pos = this.position(id, player);
          const radius = id === 'player' ? .6 : this.entities.has(id) ? Math.max(.4, this.height(this.entities.get(id)) * .45) : .65;
          if (pos && BC.vec.dist2(p.position, pos) < radius * radius) { this.damage(id, p.damage, p.source, player); hit = true; break; }
        }
      }
      return !hit && p.life > 0;
    });
  }
  damage(id, amount, source, player) {
    if (id === 'player') {
      const result = player.damage(amount);
      if (result) this.event('damage', { source, target: id, amount });
      return result;
    }
    const e = this.entities.get(id);
    if (!e) return this.world.damageZombie(id, amount, source) || this.world.damageSheep(id, amount, source);
    e.health -= amount; e.hurtTime = .28; this.event('damage', { source, target: id, amount });
    if (e.health <= 0) {
      this.entities.delete(id);
      for (const d of this.def(e).loot || []) this.world.drop(str(d, 'item', ''), integer(d, 'count', 1, 1, 16), e.x, e.y, e.z);
      this.event('entity_death', this.data(e));
    }
    return true;
  }
  attack(e, target, ranged, player) {
    const from = this.position(e.id, player), to = this.position(target, player);
    if (!to || target === e.owner || e.cooldown > 0) return false;
    const range = ranged ? 18 : 1.65, d = Math.sqrt(BC.vec.dist2(from, to));
    if (d > range || this.world.raycast(from, BC.vec.sub(to, from), d)) return false;
    const damage = integer(this.def(e), 'damage', 2, 1, 10);
    e.heading = Math.atan2(to.x - from.x, to.z - from.z); e.cooldown = ranged ? 1.8 : 1;
    if (ranged) this.launch(e.id, from, BC.vec.sub(to, from), 16, damage); else this.damage(target, damage, e.id, player);
    return true;
  }
  launch(source, from, direction, speed, damage) {
    if (this.projectiles.length >= 128) return;
    const n = BC.vec.norm(direction);
    this.projectiles.push({ source, position: { ...from }, velocity: { x: n.x * speed, y: n.y * speed, z: n.z * speed }, damage, life: 6 });
    this.event('projectile_spawn', { source });
  }
  rayEntity(origin, direction, reach) {
    const d = BC.vec.norm(direction); let found = null, closest = reach;
    const block = this.world.raycast(origin, d, reach);
    if (block) { const c = new BC.Bounds(block.x, block.y, block.z, block.x + 1, block.y + 1, block.z + 1).ray(origin, d, reach); if (c) closest = c.distance; }
    for (const e of this.entities.values()) {
      const r = num(this.def(e), 'radius', .3);
      const c = new BC.Bounds(e.x - r, e.y, e.z - r, e.x + r, e.y + this.height(e), e.z + r).ray(origin, d, reach);
      if (c && c.distance < closest) { closest = c.distance; found = e; }
    }
    return found;
  }
  playerAction(use, eye, direction, player, inventory, selected) {
    const held = inventory.hotbarItemAt(selected), item = held ? BC.item(held) : null;
    if (use && item && item.definition && item.definition.projectile) {
      if (this.shotCooldown > 0) return true;
      const d = item.definition.projectile;
      if (inventory.take(str(d, 'ammo', ''), 1)) {
        const n = BC.vec.norm(direction);
        this.launch('player', { x: eye.x + n.x * .4, y: eye.y + n.y * .4, z: eye.z + n.z * .4 }, direction,
          bounded(d, 'speed', 20, 5, 30), integer(d, 'damage', 4, 1, 10));
        inventory.damageToolAt(selected); this.shotCooldown = bounded(d, 'cooldown', .6, .2, 5);
      } else this.event('notice', { text: 'Нужны стрелы' });
      return true;
    }
    const e = this.rayEntity(eye, direction, BC.Player.REACH); if (!e) return false;
    if (!use) { this.damage(e.id, 1, 'player', player); inventory.damageToolAt(selected); return true; }
    const tame = str(this.def(e), 'tame_item', '');
    if (!e.owner && held && held === tame && inventory.consumeAt(selected, held)) {
      e.owner = 'player'; e.health = integer(this.def(e), 'health', 8, 1, 100);
      this.event('entity_tamed', this.data(e)); this.event('notice', { text: 'Волк приручён' });
    } else this.event('entity_use', { entity: e.id, item: held || '' });
    return true;
  }
  snapshot(player, inventory, selected, yaw) {
    const list = [];
    for (const e of this.entities.values()) list.push(this.data(e));
    for (const z of this.world.zombies) list.push({ id: z.id, type: 'core:zombie', x: z.x, y: z.y, z: z.z, health: z.health, owner: '' });
    for (const s of this.world.sheep) list.push({ id: s.id, type: 'core:sheep', x: s.x, y: s.y, z: s.z, health: s.health, owner: '' });
    const held = inventory.hotbarItemAt(selected);
    return {
      player: { id: 'player', x: player.position.x, y: player.position.y, z: player.position.z, health: player.health, yaw, item: held || '' },
      time: this.world.dayTime, entities: list
    };
  }
  save() {
    return {
      items: BC.Items.values().filter(i => i.definition).map(i => i.definition),
      definitions: Object.fromEntries(this.definitions),
      entities: Array.from(this.entities.values()).map(e => this.data(e)),
      storage: this.storage, serial: this.serial
    };
  }
  restore(m) {
    for (const d of m.items || []) if (d && typeof d.id === 'string') BC.Items.register(d.id, d);
    for (const [k, v] of Object.entries(m.definitions || {})) this.definitions.set(k, v);
    this.serial = Number.isInteger(m.serial) ? m.serial : 0;
    for (const d of m.entities || []) {
      if (!this.definitions.has(d.type) || this.entities.size >= 64) continue;
      this.entities.set(d.id, { id: d.id, type: d.type, x: +d.x, y: +d.y, z: +d.z, vy: 0, heading: +d.heading || 0, cooldown: 0, goalTime: 0,
        hurtTime: 0, health: Math.max(1, d.health | 0), owner: d.owner || '', goalX: +d.x, goalZ: +d.z, stop: 0 });
    }
    Object.assign(this.storage, m.storage || {});
  }
}
BC.ModWorld = ModWorld;

// ---------------------------------------------------------------- console commands
BC.Cheats = {
  execute(line, inventory, world, player) {
    let command = line.trim();
    if (command.startsWith('/')) command = command.substring(1);
    const args = command.split(/\s+/);
    if (args[0].toLowerCase() === 'gamemode') {
      if (args.length !== 2 || !(args[1] === '0' || args[1] === '1')) return 'Формат: gamemode 0|1';
      const creative = args[1] === '1'; player.setCreative(creative); inventory.setCreative(creative);
      return creative ? 'Креатив: E — предметы, Пробел / Shift — полёт' : 'Режим выживания';
    }
    if (!args[0]) return 'Введите команду';
    const p = player.position;
    switch (args[0].toLowerCase()) {
      case 'give': return give(args, inventory);
      case 'spawn': return spawn(args, world, p);
      case 'kill':
        if (args.length > 1 && !['sheep', 'овца'].includes(args[1].toLowerCase())) return 'Сейчас доступно: kill sheep';
        return 'Убито овец: ' + world.killSheep(inventory);
      case 'keepinventory':
        if (args.length !== 2 || !['true', 'false'].includes(args[1].toLowerCase())) return 'Формат: keepInventory true|false';
        world.keepInventory = args[1].toLowerCase() === 'true'; return 'keepInventory = ' + world.keepInventory;
      case 'time':
        if (args.length !== 3 || args[1].toLowerCase() !== 'set') return 'Формат: time set day|night';
        if (args[2].toLowerCase() === 'day') world.setDayTime(.35);
        else if (args[2].toLowerCase() === 'night') world.setDayTime(.80);
        else return 'Формат: time set day|night';
        return 'Время установлено: ' + args[2].toLowerCase();
      case 'setblock': {
        if (args.length !== 5) return 'Формат: setblock x y z block';
        const [x, y, z] = args.slice(1, 4).map(Number);
        if (![x, y, z].every(Number.isInteger)) return 'Неизвестный блок или координаты';
        try { return world.set(x, y, z, BC.Block.valueOf(args[4])) ? 'Блок установлен' : 'Не удалось установить блок'; }
        catch (e) { return 'Неизвестный блок или координаты'; }
      }
      case 'tp': {
        const result = teleport(args, world, p);
        if (result.startsWith('Телепортировано')) { player.velocityY = 0; player.grounded = false; }
        return result;
      }
      default: return 'Команды: gamemode 0|1, give, spawn sheep, kill, keepInventory, time, setblock, tp river|portal';
    }
  }
};
function give(args, inventory) {
  if (args.length < 2) return 'Формат: give <предмет> [количество]';
  const normalized = args[1].toLowerCase().replace(/[_-]/g, '');
  const type = BC.Items.values().find(t => !t.retired() && (
    t.id.substring(t.id.indexOf(':') + 1).toLowerCase().replace(/_/g, '') === normalized
    || t.id.toLowerCase().replace(/_/g, '') === normalized || t.title.toLowerCase().replace(/ /g, '') === normalized));
  if (!type) return 'Неизвестный предмет: ' + args[1];
  const amount = args.length > 2 ? Number(args[2]) : 1;
  if (!Number.isInteger(amount)) return 'Количество должно быть числом';
  if (amount < 1 || amount > 9999) return 'Количество должно быть от 1 до 9999';
  const leftover = inventory.add(type.id, amount);
  return 'Выдано ' + (amount - leftover) + ' × ' + type.title + (leftover > 0 ? '; инвентарь заполнен' : '');
}
function spawn(args, world, p) {
  if (args.length < 2) return 'Формат: spawn <тип> [количество]';
  const count = args.length > 2 ? Number(args[2]) : 1;
  if (!Number.isInteger(count)) return 'Количество должно быть числом';
  if (!['sheep', 'овца'].includes(args[1].toLowerCase())) {
    const type = Array.from(world.mods.definitions.keys()).find(k => k === args[1] || k.endsWith(':' + args[1]));
    if (!type) return 'Неизвестный тип существа';
    if (count < 1 || count > 8) return 'Количество должно быть от 1 до 8';
    let made = 0;
    for (let i = 0; i < count; i++) try { world.mods.spawn(type, p.x + 3 + i, p.z + 2); made++; } catch (e) { /* blocked */ }
    return 'Создано: ' + made;
  }
  if (count < 1 || count > 100) return 'Количество овец должно быть от 1 до 100';
  world.spawnSheepNear(p, count);
  return 'Создано овец: ' + count;
}
function teleport(args, world, p) {
  if (args.length !== 2) return 'Формат: tp river|portal';
  if (args[1].toLowerCase() === 'portal') {
    let nearest = null, best = Infinity;
    for (const s of world.portals) { const d = (s.x + .5 - p.x) ** 2 + (s.z + .5 - p.z) ** 2; if (d < best) { best = d; nearest = s; } }
    if (!nearest) return 'Портал не найден';
    Object.assign(p, BC.Portal.safeExit(world, nearest));
    return 'Телепортировано к порталу';
  }
  if (args[1].toLowerCase() !== 'river') return 'Формат: tp river|portal';
  // Rivers are found from the terrain function, so no distant region has to be generated.
  const px = Math.round(p.x), pz = Math.round(p.z);
  if (world.dimension === 'SURFACE' && world.features) for (let radius = 1; radius < Math.max(world.width, world.depth); radius++)
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const x = px + dx, z = pz + dz;
      if (!world.inside(x, 0, z) || !BC.Terrain.river(world.seed, x, z) || BC.Terrain.height(world.seed, x, z) >= BC.WATER_LEVEL) continue;
      if (Math.abs(x - world.width / 2) <= 18 && Math.abs(z - world.depth / 2) <= 18) continue;
      if (world.get(x, BC.WATER_LEVEL, z) !== B.WATER) continue;
      Object.assign(p, { x: x + .5, y: BC.WATER_LEVEL + .35, z: z + .5 });
      return 'Телепортировано к реке';
    }
  return 'Река не найдена';
}
})();
