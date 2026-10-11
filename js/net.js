/* Barnocraft WEB — LAN multiplayer. The host's browser is authoritative; server.js only relays
 * WebSocket messages (a browser cannot listen on a TCP port). Message flow mirrors the Java
 * protocol: HELLO, WELCOME, STATE, POSES, ACTION, RESULT, ERROR, TRANSFER, DAMAGE. */
(function () {
'use strict';
const BC = globalThis.BC;
const B = BC.B;
const PROTOCOL = 'barnocraft-web/1', MAX_PLAYERS = 8;

BC.parsePort = function (text) {
  if (!/^[0-9]{1,5}$/.test(text || '')) throw new Error('Порт: число от 1 до 65535');
  const port = +text; if (port < 1 || port > 65535) throw new Error('Порт: число от 1 до 65535');
  return port;
};

/** Connects to the relay and resolves once it accepted the role. */
function openRelay(address, port, role, room) {
  return new Promise((resolve, reject) => {
    let socket;
    const secure = typeof location !== 'undefined' && location.protocol === 'https:';
    try { socket = new WebSocket((secure ? 'wss://' : 'ws://') + address + ':' + port + '/ws'); }
    catch (e) { reject(new Error('Некорректный адрес сервера: ' + address)); return; }
    const timer = setTimeout(() => { socket.close(); reject(new Error('Нет ответа от ' + address + ':' + port + '. Проверьте, что сервер Barnocraft WEB запущен, а адрес и порт верны.')); }, 15000);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'relay-hello', role, room: room || 'lan', proto: PROTOCOL }));
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Сервер ' + address + ':' + port + ' недоступен. Сайт без сервера (например, GitHub Pages) поддерживает только одиночную игру.')); };
    socket.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'relay-ok') { clearTimeout(timer); socket.onmessage = null; socket.onerror = null; resolve({ socket, info: m }); }
      else if (m.type === 'relay-error') { clearTimeout(timer); socket.close(); reject(new Error(m.reason)); }
    };
  });
}

class Multiplayer {
  /** listener: joined(state), transferred(state, inventory), changed(), result(inventory, reply), disconnected(reason), damage(n) */
  constructor(socket, hosting, skin, listener, info) {
    this.socket = socket; this.hosting = hosting; this.skin = skin; this.listener = listener; this.info = info || {};
    this.players = new Map(); this.creativePlayers = new Map(); this.lastAction = new Map();
    this.localId = hosting ? 0 : -1; this.welcomed = hosting; this.pending = 0; this.nextRequest = 0;
    this.poseClock = 0; this.stateClock = 0; this.collectClock = 0; this.connectedAt = performance.now();
    this.inbox = []; this.closed = false; this.worldProvider = null;
    socket.onmessage = e => { try { this.inbox.push(JSON.parse(e.data)); } catch (err) { /* ignore */ } };
    socket.onclose = () => { if (!this.closed) this.inbox.push({ type: 'relay-closed', reason: 'Соединение прервано' }); };
    if (!hosting) this.send({ type: 'HELLO', skin });
  }
  static async host(address, port, skin, listener, room) {
    const { socket, info } = await openRelay(address, port, 'host', room);
    return new Multiplayer(socket, true, skin, listener, info);
  }
  static async connect(address, port, skin, listener, room) {
    const { socket, info } = await openRelay(address, port, 'guest', room);
    return new Multiplayer(socket, false, skin, listener, info);
  }
  busy() { return this.pending !== 0; }
  send(message, to) {
    if (this.closed || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(this.hosting ? { to, msg: message } : message));
  }
  close() { if (this.closed) return; this.closed = true; try { this.socket.close(); } catch (e) { /* closed */ } this.players.clear(); }
  worldFor(dimension, fallback) {
    if (fallback.dimension === dimension) return fallback;
    const found = this.worldProvider && this.worldProvider(dimension);
    if (!found) throw new Error('Измерение недоступно');
    return found;
  }
  request(command, pose, inventory, selected, creative) {
    if (this.hosting || !this.welcomed || this.busy()) return;
    const id = ++this.nextRequest; this.pending = id;
    this.send({ type: 'ACTION', id, pose, selected, creative, inventory: inventory.snapshot(), command });
  }
  tick(dt, world, hostPose, name, local, inventory, active) {
    for (let n = 0; n < 64 && this.inbox.length; n++) {
      const event = this.inbox.shift();
      try {
        if (event.type === 'relay-closed' || event.type === 'relay-error') {
          this.listener.disconnected(event.reason || 'Соединение закрыто'); this.close(); return;
        }
        if (this.hosting) {
          if (event.type === 'peer-leave') { this.players.delete(event.peer); this.lastAction.delete(event.peer); continue; }
          if (event.type === 'peer-join') continue;
          this.handleHost(event.from, event.msg, world, hostPose, name);
        } else if (this.handleClient(event, world) === 'stop') return;
      } catch (e) {
        if (this.hosting) { this.send({ type: 'ERROR', reason: e.message }, event.from); this.players.delete(event.from); }
        else { this.listener.disconnected('Ошибка сети: ' + e.message); this.close(); return; }
      }
    }
    if (!this.welcomed) {
      if (performance.now() - this.connectedAt > 90000) { this.listener.disconnected('Соединение установлено, но хозяин не передал мир за 90 секунд'); this.close(); }
      return;
    }
    if (!world) return;
    this.poseClock += dt; this.stateClock += dt; this.collectClock += dt;
    if (this.poseClock >= .05) {
      this.poseClock = 0;
      if (this.hosting) {
        this.players.set(0, local);
        if (this.players.size > 1) this.send({ type: 'POSES', players: Array.from(this.players.values()) }, 'all');
      } else this.send({ type: 'POSES', players: [local] });
    }
    if (this.hosting && this.stateClock >= .3) { this.stateClock = 0; this.broadcastState(world, hostPose, name); }
    else if (!this.hosting && active && this.collectClock >= .5 && !this.busy()) {
      this.collectClock = 0;
      this.request({ kind: 'collect' }, local, inventory, hostPose.selected, hostPose.creative);
    }
  }
  validPose(p, peer) {
    if (!p || ![p.x, p.y, p.z, p.yaw, p.pitch].every(Number.isFinite) || p.x < 0 || p.x >= BC.WIDTH || p.z < 0 || p.z >= BC.DEPTH
        || p.y < -100 || p.y > BC.HEIGHT + 100 || Math.abs(p.pitch) > Math.PI / 2 || (p.skin !== 0 && p.skin !== 1) || !BC.DIMENSIONS[p.dimension])
      throw new Error('Некорректная позиция игрока');
    return { id: peer, skin: p.skin, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, moving: !!p.moving, airborne: !!p.airborne, swinging: !!p.swinging, dimension: p.dimension };
  }
  handleHost(peer, m, world, pose, name) {
    if (!world || !m) throw new Error('Мир закрыт');
    const active = world;
    if (this.players.has(peer)) world = this.worldFor(this.players.get(peer).dimension, active);
    switch (m.type) {
      case 'HELLO': {
        if (this.players.has(peer)) throw new Error('Повторное подключение');
        if (m.skin !== 0 && m.skin !== 1) throw new Error('Неизвестный персонаж');
        if (this.players.size >= MAX_PLAYERS) throw new Error('Сервер заполнен');
        this.players.set(peer, { id: peer, skin: m.skin, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, moving: false, airborne: false, swinging: false, dimension: world.dimension });
        this.send({ type: 'WELCOME', id: peer, state: this.state(world, pose, name) }, peer);
        return;
      }
      case 'POSES': {
        if (!this.players.has(peer)) throw new Error('Сначала подключитесь');
        const updated = this.validPose(m.players && m.players[0], peer);
        if (updated.dimension === this.players.get(peer).dimension) this.players.set(peer, updated);
        return;
      }
      case 'ACTION': {
        if (!this.players.has(peer)) throw new Error('Сначала подключитесь');
        if (!(m.id > (this.lastAction.get(peer) || 0))) throw new Error('Повтор команды');
        const actor = this.validPose(m.pose, peer);
        if (!Number.isInteger(m.selected) || m.selected < 0 || m.selected >= BC.HOTBAR_SIZE) throw new Error('Некорректный слот');
        const inventory = new BC.Inventory(); inventory.restore(m.inventory);
        if (actor.dimension !== this.players.get(peer).dimension) throw new Error('Измерение игрока изменилось');
        this.players.set(peer, actor); this.lastAction.set(peer, m.id); this.creativePlayers.set(peer, !!m.creative);
        const command = m.command || {};
        if (command.kind === 'portal') {
          const portal = BC.Portal.touching(world, actor);
          if (portal) {
            const destination = this.worldFor(BC.otherDimension(world.dimension), active), exit = BC.Portal.safeExit(destination, portal);
            this.players.set(peer, { ...actor, x: exit.x, y: exit.y, z: exit.z, moving: false, airborne: false, swinging: false, dimension: destination.dimension });
            const arrival = { x: exit.x, y: exit.y, z: exit.z, yaw: actor.yaw, pitch: actor.pitch, selected: m.selected, health: 20, hunger: 20, respawnX: -1, respawnY: -1, respawnZ: -1, creative: false };
            this.send({ type: 'TRANSFER', inventory: inventory.snapshot(), state: this.state(destination, arrival, name) }, peer);
            return;
          }
        }
        const reply = BC.NetworkGameplay.execute(world, actor, inventory, m.selected, !!m.creative, command);
        // The authoritative state precedes the inventory reply on the same ordered stream.
        this.broadcastState(active, pose, name);
        this.send({ type: 'RESULT', id: m.id, inventory: inventory.snapshot(), reply }, peer);
        return;
      }
      default: throw new Error('Неизвестный тип пакета');
    }
  }
  handleClient(m, world) {
    switch (m.type) {
      case 'DAMAGE': if (!(m.amount >= 0 && m.amount <= 20)) throw new Error('Некорректный урон'); this.listener.damage(m.amount); return;
      case 'TRANSFER': this.pending = 0; this.listener.transferred(this.readState(m.state, null), m.inventory); return 'stop';
      case 'ERROR': throw new Error('Сервер: ' + m.reason);
      case 'WELCOME': {
        if (this.welcomed) throw new Error('Повтор приветствия');
        this.localId = m.id; const decoded = this.readState(m.state, null); this.welcomed = true; this.listener.joined(decoded); return;
      }
      case 'STATE': {
        if (!this.welcomed || !world) return;
        if (m.state.save.world.dimension !== world.dimension) return;
        world.load(m.state.save.world, false);
        this.applyEntities(world, m.state);
        this.listener.changed();
        return;
      }
      case 'POSES': {
        if (!Array.isArray(m.players) || m.players.length < 1 || m.players.length > MAX_PLAYERS) throw new Error('Некорректное число игроков');
        this.players = new Map(m.players.map(p => [p.id, this.validPose(p, p.id)]));
        return;
      }
      case 'RESULT':
        if (m.id !== this.pending || this.pending === 0) throw new Error('Неожиданный ответ');
        this.pending = 0; this.listener.result(m.inventory, m.reply); return;
      default: throw new Error('Неизвестный тип пакета');
    }
  }
  state(world, pose, name) {
    return { save: BC.SaveStore.encodeState(world.snapshot(), pose, name), drops: world.drops, fish: world.fish };
  }
  applyEntities(world, state) {
    world.drops = (state.drops || []).filter(d => BC.Items.has(d.item) || /:/.test(d.item)).slice(0, 100000);
    world.fish = (state.fish || []).slice(0, 1000);
  }
  readState(state, world) {
    const decoded = BC.SaveStore.decodeState(state.save);
    this.applyEntities(decoded.world, state);
    if (world) this.applyEntities(world, state);
    return decoded;
  }
  broadcastState(world, pose, name) {
    if (![...this.players.keys()].some(id => id !== 0)) return;
    const states = new Map();
    for (const [peer, p] of this.players) {
      if (peer === 0) continue;
      let state = states.get(p.dimension);
      if (!state) { state = this.state(this.worldFor(p.dimension, world), pose, name); states.set(p.dimension, state); }
      this.send({ type: 'STATE', state }, peer);
    }
  }
  /** Host: simulate dimensions where guests stand; creatures may attack guests too. */
  simulateDimensions(dt, localWorld, localPlayer) {
    const dimensions = new Set([localWorld.dimension]);
    for (const p of this.players.values()) dimensions.add(p.dimension);
    for (const dimension of dimensions) {
      const simulated = this.worldFor(dimension, localWorld), targets = [], guests = new Map();
      if (dimension === localWorld.dimension) targets.push(localPlayer);
      for (const pose of this.players.values()) if (pose.id !== 0 && pose.dimension === dimension) {
        const player = new BC.Player(); player.position = { x: pose.x, y: pose.y, z: pose.z };
        player.setCreative(this.creativePlayers.get(pose.id) || false);
        targets.push(player); guests.set(pose.id, player);
      }
      if (simulated !== localWorld) {
        simulated.advanceTime(dt); simulated.updateFurnaces(dt); simulated.updateWater(dt); simulated.updateCrops(dt);
        simulated.updateSheep(dt); simulated.updateFish(dt);
      }
      simulated.updateHellMobs(dt, targets);
      simulated.updateZombies(dt, targets.length ? targets[0] : localPlayer, targets.slice(1));
      for (const [peer, player] of guests) if (player.health < BC.Player.MAX_HEALTH)
        this.send({ type: 'DAMAGE', amount: BC.Player.MAX_HEALTH - player.health }, peer);
    }
  }
}
BC.Multiplayer = Multiplayer;

/** Guest world interactions run serially on the host, including shared container transfers. */
BC.NetworkGameplay = {
  execute(world, pose, inv, selected, creative, command) {
    const none = { screen: '', x: 0, y: 0, z: 0, notice: '' };
    const player = new BC.Player(); player.position = { x: pose.x, y: pose.y, z: pose.z }; player.setCreative(creative); inv.setCreative(creative);
    const origin = { x: pose.x, y: pose.y + BC.Player.EYE, z: pose.z };
    const direction = { x: -Math.sin(pose.yaw) * Math.cos(pose.pitch), y: Math.sin(pose.pitch), z: -Math.cos(pose.yaw) * Math.cos(pose.pitch) };
    const kind = String(command.kind || '');
    if (kind === 'collect') { world.collectIntoInventory(player.position, 1.25, inv); return none; }
    if (kind === 'attack') {
      if (world.attackHellMob(origin, direction, BC.Player.REACH, inv) || world.attackSheep(origin, direction, BC.Player.REACH, inv)
          || world.attackZombie(origin, direction, BC.Player.REACH)) inv.damageToolAt(selected);
      return none;
    }
    if (kind.startsWith('container')) return container(world, player, inv, command, none);
    const held = inv.hotbarItemAt(selected), placed = BC.toBlock(held);
    if (kind === 'use' && (held === 'BUCKET' || held === 'WATER_BUCKET')) { world.useBucket(inv, selected, origin, direction); return none; }
    const hit = world.raycast(origin, direction, BC.Player.REACH);
    if (!hit) return none;
    let { x, y, z } = hit; const block = world.get(x, y, z);
    if (kind === 'mine') {
      if (BC.Block.immutable(block)) return none;
      if (!BC.SOLID[block] && !BC.Block.crop(block) && block !== B.LANTERN && block !== B.TORCH) return none;
      if (BC.Block.crop(block) && !creative) world.harvestCrop(x, y, z, inv);
      else if (world.set(x, y, z, B.AIR) && !creative) { inv.addBlock(block); inv.damageToolAt(selected); }
      return none;
    }
    if (kind !== 'use') return none;
    if (placed === B.ROTATOR) { if (world.rotate(x, y, z, player)) inv.damageToolAt(selected); return none; }
    if (block === B.CHEST || block === B.FURNACE || block === B.STONECUTTER) {
      if (block === B.CHEST && !world.openChest(x, y, z)) return { ...none, notice: 'Этот сундук уже открывали' };
      return { screen: BC.BLOCK_NAMES[block], x, y, z, notice: '' };
    }
    if (BC.Block.bed(block)) return { screen: 'BED', x, y, z, notice: world.sleepAt(x, y, z) };
    if (held === 'STONE_HOE' && block === B.GRASS) { if (world.till(x, y, z)) inv.damageToolAt(selected); return none; }
    if (held === 'WHEAT_SEEDS' && block === B.FARMLAND) { if (world.plantCrop(x, y, z)) inv.consumeAt(selected, held); return none; }
    if (world.doorAt(x, y, z)) { world.toggleDoor(x, y, z, player); return none; }
    x += hit.nx; y += hit.ny; z += hit.nz;
    if (placed === null || placed === B.TORCH || !held) return none;
    const yawTurn = s => BC.floorMod(Math.round(s * pose.yaw / (Math.PI / 2)), 4);
    let success;
    if (placed === B.DOOR) success = world.placeDoor(x, y, z, yawTurn(1), player);
    else if (placed === B.BED) success = world.placeBed(x, y, z, yawTurn(-1), player);
    else if (placed === B.STAIRS) success = world.placeStairs(x, y, z, yawTurn(-1), player);
    else success = !player.intersects(x, y, z) && world.get(x, y, z) === B.AIR && (placed !== B.LANTERN || BC.SOLID[world.get(x, y - 1, z)]) && world.set(x, y, z, placed);
    if (success) {
      if (placed === B.FURNACE) for (let i = 0; i < yawTurn(-1); i++) world.rotate(x, y, z, player);
      inv.consumeAt(selected, held);
    }
    return none;
  }
};
function container(world, player, inv, c, none) {
  const { x, y, z } = c;
  if (!world.inside(x, y, z) || BC.vec.dist2(player.position, { x: x + .5, y: y + .5, z: z + .5 }) > 49) return none;
  const block = world.get(x, y, z), slot = c.a | 0, index = c.b | 0;
  if (index < 0 || index >= BC.Inventory.SLOT_COUNT) return none;
  switch (c.kind) {
    case 'container-close': if (block === B.CHEST) world.closeChest(x, y, z); break;
    case 'container-chest-take': case 'container-chest-put':
      if (block === B.CHEST && slot >= 0 && slot < 27) world.moveChestItem(x, y, z, slot, inv, index, c.kind.endsWith('take'), !!c.one); break;
    case 'container-recipe': if (block === B.STONECUTTER) world.selectStonecutterRecipe(x, y, z, c.value); break;
    case 'container-craft': if (block === B.STONECUTTER) world.craftStonecutterHead(x, y, z); break;
    case 'container-take': case 'container-put': {
      if (slot < 0 || slot > 2) return none;
      const take = c.kind.endsWith('take');
      for (let i = 0; i < (c.one ? 1 : BC.MAX_STACK); i++) {
        const moved = block === B.FURNACE ? (take ? world.takeFurnaceItem(x, y, z, slot, inv, index) : world.putFurnaceItem(x, y, z, slot, inv, index))
          : block === B.STONECUTTER && (take ? world.takeStonecutterItem(x, y, z, slot, inv, index) : world.putStonecutterItem(x, y, z, slot, inv, index));
        if (!moved) break;
      }
      break;
    }
    default: break;
  }
  return none;
}
})();
