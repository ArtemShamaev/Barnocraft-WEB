/* Barnocraft WEB — collision shapes (door, stairs) and axis-separated AABB player physics. */
(function () {
'use strict';
const BC = globalThis.BC;
const B = BC.B;

/** Axis-aligned box with a slab ray test; also used for doors, stairs, beds and mobs. */
class Bounds {
  constructor(minX, minY, minZ, maxX, maxY, maxZ) {
    this.minX = minX; this.minY = minY; this.minZ = minZ; this.maxX = maxX; this.maxY = maxY; this.maxZ = maxZ;
  }
  intersects(x0, y0, z0, x1, y1, z1) {
    return x0 < this.maxX && x1 > this.minX && y0 < this.maxY && y1 > this.minY && z0 < this.maxZ && z1 > this.minZ;
  }
  ray(o, d, reach) {
    let enter = 0, exit = reach, nx = 0, ny = 0, nz = 0;
    const low = [this.minX, this.minY, this.minZ], high = [this.maxX, this.maxY, this.maxZ];
    const dir = [d.x, d.y, d.z], org = [o.x, o.y, o.z];
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(dir[axis]) < 1e-8) {
        if (org[axis] < low[axis] || org[axis] > high[axis]) return null;
        continue;
      }
      const a = (low[axis] - org[axis]) / dir[axis], b = (high[axis] - org[axis]) / dir[axis];
      const near = Math.min(a, b), far = Math.max(a, b);
      if (near > enter) {
        enter = near;
        const sign = dir[axis] > 0 ? -1 : 1;
        nx = axis === 0 ? sign : 0; ny = axis === 1 ? sign : 0; nz = axis === 2 ? sign : 0;
      }
      exit = Math.min(exit, far);
      if (enter > exit) return null;
    }
    return { distance: enter, nx, ny, nz };
  }
}
BC.Bounds = Bounds;

/** A two-block door with a thin collision panel kept inside its two cells. */
BC.Door = {
  bounds(door) {
    const { x, y, z } = door;
    switch ((door.facing + (door.open ? 1 : 0)) & 3) {
      case 0: return new Bounds(x, y, z, x + 1, y + 2, z + .125);
      case 1: return new Bounds(x, y, z, x + .125, y + 2, z + 1);
      case 2: return new Bounds(x, y, z + .875, x + 1, y + 2, z + 1);
      default: return new Bounds(x + .875, y, z, x + 1, y + 2, z + 1);
    }
  }
};
/** Two half-height treads; facing 0 rises toward -Z, then turns clockwise. */
BC.Stairs = {
  bounds(x, y, z, facing) {
    const lower = new Bounds(x, y, z, x + 1, y + .5, z + 1);
    let upper;
    switch (facing & 3) {
      case 0: upper = new Bounds(x, y + .5, z, x + 1, y + 1, z + .5); break;
      case 1: upper = new Bounds(x + .5, y + .5, z, x + 1, y + 1, z + 1); break;
      case 2: upper = new Bounds(x, y + .5, z + .5, x + 1, y + 1, z + 1); break;
      default: upper = new Bounds(x, y + .5, z, x + .5, y + 1, z + 1);
    }
    return [lower, upper];
  },
  filled: (x, y, z) => x >= 0 && x < 2 && y >= 0 && y < 2 && z >= 0 && z < 2 && (y === 0 || z === 0)
};

const HALF_WIDTH = .3, HEIGHT = 1.8, EYE = 1.62, EPSILON = .00001;
class Player {
  constructor() {
    this.position = { x: 40, y: 6.001, z: 40 };
    this.velocityY = 0; this.grounded = true;
    this.health = Player.MAX_HEALTH; this.hunger = Player.MAX_HUNGER;
    this.hungerClock = 0; this.starvationClock = 0;
    this.respawnX = -1; this.respawnY = -1; this.respawnZ = -1;
    this.creative = false;
  }
  setCreative(value) {
    this.creative = value; this.velocityY = 0; this.grounded = false; this.hungerClock = 0; this.starvationClock = 0;
    if (value) { this.health = Player.MAX_HEALTH; this.hunger = Player.MAX_HUNGER; }
  }
  setRespawnPoint(p) { if (!p) return; this.respawnX = p.x; this.respawnY = p.y; this.respawnZ = p.z; }
  restoreRespawnPoint(x, y, z) { this.respawnX = x; this.respawnY = y; this.respawnZ = z; }
  restoreHunger(v) { this.hunger = Math.max(0, Math.min(Player.MAX_HUNGER, v | 0)); }
  restoreHealth(v) { this.health = Math.max(0, Math.min(Player.MAX_HEALTH, v | 0)); }
  dead() { return this.health <= 0; }
  tickHunger(dt) {
    if (this.creative || this.health <= 0 || dt <= 0) return false;
    this.hungerClock += dt;
    while (this.hungerClock >= 35 && this.hunger > 0) { this.hungerClock -= 35; this.hunger--; }
    if (this.hunger > 0) { this.starvationClock = 0; return false; }
    this.starvationClock += dt;
    if (this.starvationClock >= 5) { this.starvationClock -= 5; return this.damage(1); }
    return false;
  }
  eatFood(inventory, slot) {
    const id = inventory.itemAt(slot); const food = id ? BC.item(id) : null;
    const healing = food ? food.foodValue() : 0, nutrition = food ? food.nutrition() : 0;
    if ((this.health >= Player.MAX_HEALTH && this.hunger >= Player.MAX_HUNGER) || (healing <= 0 && nutrition <= 0)
        || !inventory.consumeAt(slot, id)) return false;
    this.restoreHealth(this.health + healing); this.restoreHunger(this.hunger + nutrition); return true;
  }
  damage(amount) {
    if (this.creative || amount <= 0 || this.health <= 0) return false;
    this.health = Math.max(0, this.health - amount); return true;
  }
  inWater(world) {
    const p = this.position, x = Math.floor(p.x), y = Math.floor(p.y + .1), z = Math.floor(p.z);
    return world.get(x, y, z) === B.WATER && p.y + .1 < y + world.waterHeight(x, y, z);
  }
  update(world, dt, movement, jump) {
    const p = this.position;
    if (this.creative) {
      this.velocityY = 0; this.grounded = false;
      const steps = Math.max(1, Math.ceil(dt / .005));
      for (let i = 0; i < steps; i++) {
        this.move(world, 'x', movement.x * 10 * dt / steps);
        this.move(world, 'y', movement.y * 10 * dt / steps);
        this.move(world, 'z', movement.z * 10 * dt / steps);
        p.x = Math.max(HALF_WIDTH, Math.min(world.width - HALF_WIDTH, p.x));
        p.z = Math.max(HALF_WIDTH, Math.min(world.depth - HALF_WIDTH, p.z));
        p.y = Math.max(0, Math.min(BC.HEIGHT + 80, p.y));
      }
      return;
    }
    const swimming = this.inWater(world);
    if (swimming && jump) this.velocityY = 2.8;
    if (!swimming && jump && this.grounded) { this.velocityY = 8; this.grounded = false; }
    const steps = Math.max(1, Math.ceil(dt / .005)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velocityY -= (swimming ? 3 : 25) * h;
      if (swimming) this.velocityY = Math.max(-1.2, this.velocityY);
      const dy = this.velocityY * h;
      this.grounded = false;
      if (!this.move(world, 'y', dy)) { this.grounded = dy < 0; this.velocityY = 0; }
      this.moveHorizontal(world, 'x', movement.x * (swimming ? 2 : 4) * h);
      this.moveHorizontal(world, 'z', movement.z * (swimming ? 2 : 4) * h);
      p.x = Math.max(HALF_WIDTH, Math.min(world.width - HALF_WIDTH, p.x));
      p.z = Math.max(HALF_WIDTH, Math.min(world.depth - HALF_WIDTH, p.z));
    }
    if (p.y < -20) this.respawn(world);
  }
  moveHorizontal(world, axis, amount) {
    if (amount === 0) return;
    const p = this.position, start = { ...p };
    if (this.move(world, axis, amount) || !this.grounded) return;
    const blocked = { ...p };
    // Step over a half-block riser, never a full block or a low ceiling.
    Object.assign(p, start); p.y += .5001;
    if (this.collides(world)) { Object.assign(p, blocked); return; }
    p[axis] += amount;
    if (this.collides(world)) { Object.assign(p, blocked); return; }
    this.move(world, 'y', -.5002);
  }
  move(world, axis, amount) {
    const p = this.position, start = p[axis];
    p[axis] = start + amount;
    if (!this.collides(world)) return true;
    let low = 0, high = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (low + high) * .5;
      p[axis] = start + amount * mid;
      if (this.collides(world)) high = mid; else low = mid;
    }
    p[axis] = start + amount * low;
    return false;
  }
  collides(world) {
    const p = this.position;
    for (let x = Math.floor(p.x - HALF_WIDTH + EPSILON); x <= Math.floor(p.x + HALF_WIDTH - EPSILON); x++)
      for (let y = Math.floor(p.y + EPSILON); y <= Math.floor(p.y + HEIGHT - EPSILON); y++)
        for (let z = Math.floor(p.z - HALF_WIDTH + EPSILON); z <= Math.floor(p.z + HALF_WIDTH - EPSILON); z++) {
          const b = world.get(x, y, z);
          if (BC.Block.door(b)) {
            const door = world.doorAt(x, y, z);
            if (door && this.intersectsBounds(BC.Door.bounds(door))) return true;
          } else if (b === B.STAIRS) {
            for (const box of BC.Stairs.bounds(x, y, z, world.rotation(x, y, z))) if (this.intersectsBounds(box)) return true;
          } else if (BC.Block.bed(b)) {
            if (this.intersectsBounds(new Bounds(x, y, z, x + 1, y + .6, z + 1))) return true;
          } else if (BC.SOLID[b]) return true;
        }
    return false;
  }
  intersectsBounds(b) {
    const p = this.position;
    return b.intersects(p.x - HALF_WIDTH + EPSILON, p.y + EPSILON, p.z - HALF_WIDTH + EPSILON,
      p.x + HALF_WIDTH - EPSILON, p.y + HEIGHT - EPSILON, p.z + HALF_WIDTH - EPSILON);
  }
  /** Contact is not overlap: the movement solver keeps a small tolerance. */
  intersects(x, y, z) {
    const p = this.position, m = EPSILON * 4;
    return p.x - HALF_WIDTH + m < x + 1 && p.x + HALF_WIDTH - m > x && p.y + m < y + 1 && p.y + HEIGHT - m > y
      && p.z - HALF_WIDTH + m < z + 1 && p.z + HALF_WIDTH - m > z;
  }
  respawn(world) {
    const p = this.position;
    this.velocityY = 0; this.grounded = false; this.health = Player.MAX_HEALTH;
    if (this.respawnX >= 0 && world.validBedSpawn(this.respawnX, this.respawnY, this.respawnZ)) {
      p.x = this.respawnX; p.y = this.respawnY; p.z = this.respawnZ; return;
    }
    if (world.dimension === 'HELL_FOREST') { Object.assign(p, BC.Portal.safeExit(world, world.portals[0])); return; }
    p.x = world.width / 2 + .5; p.y = BC.HEIGHT + 1; p.z = world.depth / 2 + .5;
    for (let y = BC.HEIGHT - 1; y >= 0; y--)
      if (BC.SOLID[world.get(Math.floor(p.x), y, Math.floor(p.z))]) { p.y = y + 1.001; break; }
  }
}
Player.HALF_WIDTH = HALF_WIDTH; Player.HEIGHT = HEIGHT; Player.EYE = EYE; Player.REACH = 5;
Player.MAX_HEALTH = 20; Player.MAX_HUNGER = 20;
BC.Player = Player;
})();
