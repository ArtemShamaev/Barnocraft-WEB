/* Barnocraft WEB — screens, input, lifecycle, autosave and the game loop (port of Barnocraft.java). */
(function () {
'use strict';
const BC = globalThis.BC;
const THREE = globalThis.THREE;
const B = BC.B, Player = BC.Player, Inventory = BC.Inventory, World = BC.World;
const HALF_PI = Math.PI / 2;
const DRAG_SCREENS = new Set(['INVENTORY', 'STONECUTTER', 'FURNACE', 'CHEST']);
const CONTAINERS = new Set(['STONECUTTER', 'FURNACE', 'CHEST']);

class Game {
  constructor() {
    this.screen = 'MAIN'; this.settingsBack = 'MAIN'; this.message = '';
    this.world = null; this.dimensionWorlds = new Map(); this.dimensionBeds = new Map(); this.dimensionLoads = new Map();
    this.portalCooldown = 0; this.lavaClock = 0;
    this.multiplayer = null; this.connecting = false; this.characterSkin = 0; this.serverAddresses = '';
    const served = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
    this.networkAddress = served ? location.hostname : 'localhost';
    // On a hosted https site the relay is the site itself; the second field is then a room code.
    this.online = served && location.protocol === 'https:';
    this.networkPort = this.online ? String(1000 + Math.floor(Math.random() * 9000)) : served && location.port ? location.port : '25565';
    this.addressFocused = true; this.remoteModels = new Map();
    this.player = new Player(); this.movement = [false, false, false, false];
    this.inventory = new Inventory(); this.options = new BC.GameOptions();
    this.active = false; this.jump = false; this.mapInteraction = false; this.flyUp = false; this.flyDown = false;
    this.creativePage = 0; this.selected = 1; this.slot = 0; this.deletingSlot = 0; this.worldName = '';
    this.inventoryDrag = null; this.inventoryDragOne = false; this.dragDownId = null;
    this.commandOpen = false; this.commandBuffer = ''; this.creatingWorldName = false; this.worldNameBuffer = '';
    this.container = { x: 0, y: 0, z: 0 };
    this.breakHeld = false; this.breakX = this.breakY = this.breakZ = null; this.breakProgress = 0;
    this.yaw = 0; this.pitch = 0; this.autosave = 0; this.lastPlayerHealth = Player.MAX_HEALTH;
    this.loading = null; this.loadingSlot = 0; this.saveChain = Promise.resolve(true); this.worldSlots = {};
    this.pythonMods = null; this.lastUnlock = 0; this.cursor = { x: 0, y: 0 };
  }

  // ------------------------------------------------------------ setup
  async init() {
    this.options.load();
    BC.Textures.setPack(this.options.texturePack);
    await BC.Textures.load();
    this.saves = await BC.SaveStore.open();
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    if (!this.renderer.capabilities.isWebGL2) throw new Error('Нужен браузер с поддержкой WebGL 2');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(new THREE.Color(135 / 255, 206 / 255, 235 / 255));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.options.fov, 1, .05, 500);
    this.camera.rotation.order = 'YXZ';
    this.atmosphere = new BC.Atmosphere(); this.scene.add(this.atmosphere.mesh);
    this.highlight = BC.Render.wireBox(0x0f0f0f); this.stepHighlight = BC.Render.wireBox(0x0f0f0f); this.breakOverlay = BC.Render.wireBox(0xf22e14);
    this.scene.add(this.highlight, this.stepHighlight, this.breakOverlay);
    this.ui = document.getElementById('ui'); this.g = this.ui.getContext('2d');
    this.hud = new BC.Hud(); this.menu = new BC.Menu();
    this.panorama = new BC.LoadingPanorama(); this.scene.add(this.panorama.view.group);
    this.bindInput(); this.resize(); window.addEventListener('resize', () => this.resize());
    if (!this.saves.persistent) this.message = 'Хранилище браузера недоступно: миры не сохранятся после закрытия вкладки';
    await this.show('MAIN');
    this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
    this.startBackgroundClock();
  }
  /** Hidden tabs get no animation frames; a hosting player must keep simulating for the guests. */
  startBackgroundClock() {
    try {
      const worker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),50)'], { type: 'application/javascript' })));
      worker.onmessage = () => {
        const now = performance.now();
        if (!document.hidden || !this.multiplayer || !this.multiplayer.hosting || now - this.last < 45) return;
        const tpf = Math.min(.25, (now - this.last) / 1000); this.last = now;
        try { this.update(tpf); } catch (e) { console.error(e); }
      };
    } catch (e) { /* no workers: the host simply pauses while hidden */ }
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setSize(w, h, false);
    this.ui.width = Math.round(w * dpr); this.ui.height = Math.round(h * dpr);
    this.ui.style.width = w + 'px'; this.ui.style.height = h + 'px'; this.dpr = dpr;
    this.camera.aspect = w / Math.max(1, h); this.camera.fov = this.options.fov; this.camera.updateProjectionMatrix();
    this.hud.resize(w, h); this.menu.resize(w, h);
  }

  // ------------------------------------------------------------ input
  bindInput() {
    const canvas = this.ui;
    window.addEventListener('keydown', e => this.keyDown(e));
    window.addEventListener('keyup', e => this.keyUp(e));
    canvas.addEventListener('mousedown', e => { e.preventDefault(); this.mouse(e.button, true, e); });
    window.addEventListener('mouseup', e => this.mouse(e.button, false, e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.wheel(e.deltaY); }, { passive: false });
    window.addEventListener('mousemove', e => {
      this.cursor = { x: e.clientX, y: e.clientY };
      if (this.active && !this.mapInteraction && document.pointerLockElement === this.ui) {
        const k = 2 / 1024 * this.options.sensitivity;
        this.yaw -= e.movementX * k; this.pitch -= e.movementY * k;
        this.pitch = BC.clamp(this.pitch, -HALF_PI + .01, HALF_PI - .01);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) return;
      this.lastUnlock = performance.now();
      // Esc while playing releases the pointer: that is the pause key.
      if (this.screen === 'GAME' && !this.mapInteraction && this.wantedLock) this.back();
      this.wantedLock = false;
    });
    window.addEventListener('blur', () => { if (this.active) this.back(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.world) this.saveNow(); });
    window.addEventListener('beforeunload', () => { if (this.world && !this.isGuest()) this.saveNow(); });
    this.folderInput = document.getElementById('mod-folder'); this.fileInput = document.getElementById('mod-file');
    this.importInput = document.getElementById('world-import');
    const addMods = async files => {
      try { this.message = 'Добавлено: ' + await BC.ModCatalog.add(files); } catch (err) { this.message = 'Не удалось добавить мод: ' + err.message; }
      this.show('MODS');
    };
    this.folderInput.addEventListener('change', () => { if (this.folderInput.files.length) addMods(this.folderInput.files); this.folderInput.value = ''; });
    this.fileInput.addEventListener('change', () => { if (this.fileInput.files.length) addMods(this.fileInput.files); this.fileInput.value = ''; });
    this.importInput.addEventListener('change', async () => {
      const file = this.importInput.files[0]; this.importInput.value = ''; if (!file) return;
      try { const slot = await this.saves.importFile(file); this.message = 'Мир импортирован в слот ' + slot; }
      catch (err) { this.message = 'Не удалось импортировать: ' + err.message; }
      this.show('WORLDS');
    });
  }
  lockPointer() {
    if (document.pointerLockElement === this.ui) return;
    this.wantedLock = true;
    try { const r = this.ui.requestPointerLock(); if (r && r.catch) r.catch(() => { this.wantedLock = false; }); } catch (e) { this.wantedLock = false; }
  }
  unlockPointer() { this.wantedLock = false; if (document.pointerLockElement) document.exitPointerLock(); }
  keyDown(e) {
    const code = e.code;
    if (['F3', 'F10', 'Tab', 'Space', 'Backspace', 'Slash', 'Quote'].includes(code) || (this.active && code.startsWith('Arrow'))) e.preventDefault();
    if (this.screen === 'MULTIPLAYER' || this.screen === 'OPEN_NETWORK') { this.networkKey(e); return; }
    if (this.creatingWorldName) { this.nameKey(e); return; }
    if (this.commandOpen) { this.commandKey(e); return; }
    if (e.repeat && !code.startsWith('Key') && code !== 'Space') return;
    if (code === 'F3') {
      if (this.active && this.screen === 'GAME') {
        this.commandOpen = true; this.releaseMovement(); this.commandBuffer = ''; this.resetBreakProgress(); this.hud.command = '> _';
      }
      return;
    }
    if (code === 'KeyM' && this.active) {
      this.mapInteraction = !this.mapInteraction; this.releaseMovement();
      if (this.mapInteraction) this.unlockPointer(); else this.lockPointer();
      this.hud.notify(this.mapInteraction ? 'Метки карты: ЛКМ поставить · ПКМ убрать · M закрыть' : 'Режим меток закрыт');
      return;
    }
    if (code === 'KeyE') {
      if (this.screen === 'GAME') this.show('INVENTORY');
      else if (DRAG_SCREENS.has(this.screen)) { this.inventoryDrag = null; this.inventoryDragOne = false; this.back(); }
      return;
    }
    if (code === 'Escape') {
      if (this.screen === 'GAME' && document.pointerLockElement) return; // the browser unlocks; pointerlockchange pauses
      if (performance.now() - this.lastUnlock < 300) return;
      this.back(); return;
    }
    if (code === 'F10') { this.quit(); return; }
    if (!this.active) return;
    if (code === 'Space') { this.flyUp = true; this.jump = true; }
    else if (code === 'ShiftLeft' || code === 'ShiftRight') this.flyDown = true;
    else if (code === 'KeyW') this.movement[0] = !this.mapInteraction;
    else if (code === 'KeyS') this.movement[1] = !this.mapInteraction;
    else if (code === 'KeyA') this.movement[2] = !this.mapInteraction;
    else if (code === 'KeyD') this.movement[3] = !this.mapInteraction;
    else if (/^Digit[0-9]$/.test(code)) { const d = +code[5]; this.select(d === 0 ? 9 : d - 1); }
  }
  keyUp(e) {
    const code = e.code;
    if (code === 'Space') this.flyUp = false;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') this.flyDown = false;
    else if (code === 'KeyW') this.movement[0] = false;
    else if (code === 'KeyS') this.movement[1] = false;
    else if (code === 'KeyA') this.movement[2] = false;
    else if (code === 'KeyD') this.movement[3] = false;
  }
  releaseMovement() { this.movement.fill(false); this.flyUp = this.flyDown = this.jump = false; }
  printable(e) { return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey ? e.key : null; }
  commandKey(e) {
    e.preventDefault();
    if (e.code === 'Escape' || e.code === 'F3') { this.commandOpen = false; this.commandBuffer = ''; this.hud.command = ''; return; }
    if (e.code === 'Backspace') this.commandBuffer = this.commandBuffer.slice(0, -1);
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const entered = this.commandBuffer.trim();
      const result = this.isGuest() && !(entered.startsWith('give ') || entered.startsWith('gamemode '))
        ? 'Команды мира доступны хозяину сервера' : BC.Cheats.execute(entered, this.inventory, this.world, this.player);
      this.commandOpen = false; this.commandBuffer = ''; this.hud.command = entered + '  |  ' + result;
      clearTimeout(this.commandTimer); this.commandTimer = setTimeout(() => { if (!this.commandOpen) this.hud.command = ''; }, 8000);
      return;
    } else { const c = this.printable(e); if (c && this.commandBuffer.length < 120) this.commandBuffer += c; }
    this.hud.command = '> ' + this.commandBuffer + '_';
  }
  nameKey(e) {
    e.preventDefault();
    if (e.code === 'Escape') { this.creatingWorldName = false; this.worldNameBuffer = ''; this.message = ''; this.show('WORLDS'); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { this.createNamedWorld(); return; }
    if (e.code === 'Backspace') this.worldNameBuffer = this.worldNameBuffer.slice(0, -1);
    else {
      // Fixed: any character of the cube font can be typed (the Java edition only accepted a–z, 0–9 and _).
      const c = this.printable(e); if (c && BC.CubeFont.supports(c) && this.worldNameBuffer.length < 32) this.worldNameBuffer += c;
    }
    this.show('CREATE_WORLD');
  }
  networkKey(e) {
    if (e.code === 'Escape') { this.back(); return; }
    e.preventDefault();
    if (this.connecting || this.isGuest()) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { this.startNetwork(); return; }
    if (e.code === 'Tab') { this.addressFocused = this.screen === 'MULTIPLAYER' && !this.addressFocused; this.show(this.screen); return; }
    const field = this.addressFocused ? 'networkAddress' : 'networkPort';
    if (e.code === 'Backspace') this[field] = this[field].slice(0, -1);
    else if (e.code === 'Delete') this[field] = '';
    else {
      const c = this.printable(e);
      if (c && this[field].length < (this.addressFocused ? 64 : 5) && (this.addressFocused ? c > ' ' && c < '\u007f' : /[0-9]/.test(c))) this[field] += c;
    }
    this.message = ''; this.show(this.screen);
  }
  wheel(deltaY) {
    if (!this.active || deltaY === 0) return;
    this.select(BC.floorMod(this.selected + (deltaY > 0 ? 1 : -1), BC.HOTBAR_SIZE));
  }
  mouse(button, pressed, e) {
    if (button !== 0 && button !== 2) return;
    const name = button === 0 ? 'break' : 'place';
    const x = e.clientX, y = e.clientY;
    if (!this.active) {
      if (!pressed && name === 'break' && this.sliderDrag) { this.sliderDrag = null; return; }
      if (DRAG_SCREENS.has(this.screen)) {
        const id = this.menu.click(x, y);
        if (pressed) {
          if (this.inventoryDrag === null) { this.inventoryDragOne = name === 'place'; this.dragDownId = id; this.menuAction(id); }
          else { this.dragDownId = null; this.menuAction(id); }
        } else if (this.inventoryDrag !== null && id !== this.dragDownId) { this.dragDownId = null; this.menuAction(id); }
        else this.dragDownId = null; // released on the same slot: keep holding (click, then click the target)
      } else if (pressed && name === 'break') {
        const fraction = this.menu.sliderFraction(x, y);
        this.menuAction(this.menu.click(x, y), fraction);
      }
      return;
    }
    if (name === 'break') { this.breakHeld = pressed; if (!pressed) { this.resetBreakProgress(); return; } }
    if (!pressed) return;
    if (this.mapInteraction) {
      const cell = this.hud.overlayCell(x, y);
      if (cell) { this.world.mods.event('ui.click', { ...cell, button: name === 'break' ? 'left' : 'right' }); this.resetBreakProgress(); this.breakHeld = false; }
      return;
    }
    if (document.pointerLockElement !== this.ui) { this.lockPointer(); this.breakHeld = false; return; }
    this.action(name);
  }

  // ------------------------------------------------------------ gameplay actions
  eye() { return { x: this.player.position.x, y: this.player.position.y + Player.EYE, z: this.player.position.z }; }
  direction() {
    return { x: -Math.sin(this.yaw) * Math.cos(this.pitch), y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * Math.cos(this.pitch) };
  }
  action(name) {
    if (this.isGuest() && this.multiplayer.busy()) return;
    const held = this.inventory.hotbarItemAt(this.selected), food = held && BC.item(held).foodValue() > 0;
    if (this.isGuest() && name === 'place' && !food) { this.requestNetwork({ kind: 'use' }); return; }
    if (this.isGuest() && name === 'break') { this.requestNetwork({ kind: 'attack' }); return; }
    if (name === 'place' && (held === 'BUCKET' || held === 'WATER_BUCKET')) { this.world.useBucket(this.inventory, this.selected, this.eye(), this.direction()); return; }
    if (name === 'place' && food) {
      if (this.player.eatFood(this.inventory, this.selected)) this.hud.notify('Здоровье восстановлено');
      else this.hud.notify(this.player.health >= Player.MAX_HEALTH ? 'Вы сыты' : 'Это нельзя съесть');
      return;
    }
    if (this.world.mods.playerAction(name === 'place', this.eye(), this.direction(), this.player, this.inventory, this.selected)) { this.resetBreakProgress(); return; }
    if (name === 'break') {
      if (this.world.attackHellMob(this.eye(), this.direction(), Player.REACH, this.inventory)
          || this.world.attackSheep(this.eye(), this.direction(), Player.REACH, this.inventory)
          || this.world.attackZombie(this.eye(), this.direction(), Player.REACH)) {
        this.inventory.damageToolAt(this.selected); this.breakHeld = false; this.resetBreakProgress();
      }
      return;
    }
    this.edit();
  }
  target() { return this.world.raycast(this.eye(), this.direction(), Player.REACH); }
  edit() {
    const world = this.world, inv = this.inventory, hit = this.target();
    if (!hit) return;
    const block = world.get(hit.x, hit.y, hit.z), held = inv.hotbarItemAt(this.selected), toPlace = BC.toBlock(held);
    if (toPlace === B.ROTATOR) { if (world.rotate(hit.x, hit.y, hit.z, this.player)) inv.damageToolAt(this.selected); return; }
    if (CONTAINERS.has(BC.BLOCK_NAMES[block])) {
      this.container = { x: hit.x, y: hit.y, z: hit.z };
      if (block === B.CHEST && !world.openChest(hit.x, hit.y, hit.z)) { this.hud.notify('Этот сундук уже открывали'); return; }
      this.show(BC.BLOCK_NAMES[block]); return;
    }
    if (BC.Block.bed(block)) { this.player.setRespawnPoint(world.bedSpawn(hit.x, hit.y, hit.z)); this.hud.notify(world.sleepAt(hit.x, hit.y, hit.z)); return; }
    if (held === 'STONE_HOE' && block === B.GRASS) { if (world.till(hit.x, hit.y, hit.z)) inv.damageToolAt(this.selected); return; }
    if (held === 'WHEAT_SEEDS' && block === B.FARMLAND) { if (world.plantCrop(hit.x, hit.y, hit.z)) inv.consumeAt(this.selected, held); return; }
    if (world.doorAt(hit.x, hit.y, hit.z)) { world.toggleDoor(hit.x, hit.y, hit.z, this.player); return; }
    if (held === 'TORCH') { this.hud.notify('Факел светит в руке. Для установки нужен фонарь'); return; }
    const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    const turn = s => BC.floorMod(Math.round(s * this.yaw / HALF_PI), 4);
    if (toPlace === B.DOOR) { if (world.placeDoor(x, y, z, turn(1), this.player)) inv.consumeAt(this.selected, held); return; }
    if (toPlace === B.BED) {
      if (world.placeBed(x, y, z, turn(-1), this.player)) inv.consumeAt(this.selected, held);
      else this.hud.notify('Кровати нужны два свободных блока на твёрдой опоре');
      return;
    }
    if (toPlace === B.STAIRS) { if (world.placeStairs(x, y, z, turn(-1), this.player)) inv.consumeAt(this.selected, held); return; }
    if (this.player.intersects(x, y, z) || world.get(x, y, z) !== B.AIR) return;
    if (toPlace !== null && held && (toPlace !== B.LANTERN || BC.SOLID[world.get(x, y - 1, z)]) && world.set(x, y, z, toPlace)) {
      if (toPlace === B.FURNACE) for (let t = 0; t < turn(-1); t++) world.rotate(x, y, z, this.player);
      inv.consumeAt(this.selected, held);
    }
  }
  resetBreakProgress() { this.breakProgress = 0; this.breakX = this.breakY = this.breakZ = null; }
  updateBreakProgress(tpf) {
    if (!this.active || !this.world) { if (this.breakHeld) { this.breakHeld = false; this.resetBreakProgress(); } return; }
    if (!this.breakHeld || document.pointerLockElement !== this.ui) { if (this.breakProgress > 0) this.resetBreakProgress(); return; }
    const hit = this.target(); if (!hit) { this.resetBreakProgress(); return; }
    const { x, y, z } = hit, world = this.world, block = world.get(x, y, z);
    if (BC.Block.immutable(block) || block === B.AIR || (!BC.SOLID[block] && block !== B.TORCH && block !== B.LANTERN && !BC.Block.crop(block))) { this.resetBreakProgress(); return; }
    if (this.breakX !== x || this.breakY !== y || this.breakZ !== z) { this.breakX = x; this.breakY = y; this.breakZ = z; this.breakProgress = 0; }
    const tool = this.inventory.hotbarItemAt(this.selected), need = BC.Block.breakTime(block, tool);
    if (this.isGuest()) {
      if (this.multiplayer.busy()) return;
      this.breakProgress += tpf;
      if (this.player.creative || this.breakProgress >= Math.max(0, need)) { this.requestNetwork({ kind: 'mine' }); this.resetBreakProgress(); }
      return;
    }
    if (this.player.creative) { world.set(x, y, z, B.AIR); this.resetBreakProgress(); return; }
    this.breakProgress += tpf;
    if (need <= 0 || this.breakProgress >= need) {
      if (BC.Block.crop(block)) world.harvestCrop(x, y, z, this.inventory);
      else if (world.set(x, y, z, B.AIR)) {
        const left = this.inventory.addBlock(block);
        const item = BC.blockItem(block);
        if (left > 0 && item) world.drop(item, left, x, y, z); // fixed: a full inventory drops the block instead of deleting it
        this.inventory.damageToolAt(this.selected);
      }
      this.resetBreakProgress();
    }
  }
  select(index) { this.selected = index; this.hud.selected = index; }

  // ------------------------------------------------------------ screens
  async show(next) {
    this.screen = next; this.active = next === 'GAME';
    this.releaseMovement();
    if (!this.active) { this.mapInteraction = false; this.unlockPointer(); }
    else if (!this.mapInteraction) this.lockPointer();
    this.hud.active = this.active;
    const m = this.menu;
    if (this.active) { m.hide(); return; }
    switch (next) {
      case 'MAIN':
        m.show('Barnocraft', 'WEB Edition', [{ id: 'worlds', label: 'Миры' }, { id: 'multiplayer', label: 'Мультиплеер' }, { id: 'mods', label: 'Моды' },
          { id: 'settings', label: 'Настройки' }, { id: 'quit', label: 'Выход' }], this.message);
        m.backdrop = .55; return;
      case 'MULTIPLAYER': case 'OPEN_NETWORK': {
        const hosting = next === 'OPEN_NETWORK';
        const hint = this.online ? (hosting ? 'Назовите друзьям код комнаты' : 'Введите код комнаты, который назвал хозяин')
          : hosting ? 'Сервер-ретранслятор: ' + this.relayAddress() + ' · запуск: node server.js'
          : 'Адрес и порт компьютера, где запущен node server.js';
        m.showNetwork(hosting, this.networkAddress, this.networkPort, this.addressFocused, this.characterSkin, this.connecting || (this.isGuest() && !this.world), this.message, hint, this.online ? 'Комната' : 'Порт');
        return;
      }
      case 'WORLDS': this.worldSlots = await this.saves.list(); if (this.screen === 'WORLDS') m.showWorlds(this.worldSlots, this.message); return;
      case 'MODS': m.showMods(BC.ModCatalog.entries(), this.message); return;
      case 'CREATE_WORLD': m.showCreateWorld(this.worldNameBuffer, this.message); return;
      case 'DELETE_WORLD': m.showDeleteWorld((this.worldSlots[this.deletingSlot] || {}).name || 'Мир ' + this.deletingSlot, this.message); return;
      case 'SETTINGS': {
        const o = this.options;
        m.showSliders('Настройки', 'Нажмите на ползунок, чтобы изменить значение', [
          { id: 'distance', label: 'Прорисовка', value: o.distance + ' чанка', fraction: (o.distance - 2) / 4 },
          { id: 'sensitivity', label: 'Чувствительность', value: o.sensitivity.toFixed(2), fraction: (o.sensitivity - .5) / 1.5 },
          { id: 'fov', label: 'Угол обзора', value: o.fov + '°', fraction: (o.fov - 65) / 30 },
          { id: 'textures', label: 'Текстуры', value: BC.Textures.packTitle(o.texturePack), fraction: o.texturePack }
        ], [{ id: 'back', label: 'Назад' }], this.message);
        return;
      }
      case 'PAUSE': {
        const hell = this.world && this.world.dimension === 'HELL_FOREST';
        const title = hell ? 'Адский лес' : this.isGuest() ? 'Сетевая игра' : this.worldName || 'Мир ' + this.slot;
        const subtitle = !this.multiplayer ? 'Пауза • изменения сохраняются' : this.isGuest() ? 'Мир хранится у хозяина' : this.serverAddresses;
        const buttons = [{ id: 'resume', label: 'Продолжить' }, { id: 'settings', label: 'Настройки' }];
        if (!this.isGuest()) {
          buttons.push(this.multiplayer ? { id: 'close_network', label: 'Закрыть сеть' } : { id: 'open_network', label: 'Открыть для сети' });
          buttons.push({ id: 'save', label: 'Сохранить' });
        }
        buttons.push({ id: 'main', label: 'В главное меню' });
        buttons.push({ id: 'quit', label: this.isGuest() ? 'Отключиться и выйти' : 'Сохранить и выйти' });
        m.show(title, subtitle, buttons, this.message); return;
      }
      case 'INVENTORY':
        if (this.player.creative) m.showCreative(this.inventory, this.creativePage, this.selected); else m.showInventory(this.inventory, this.message);
        return;
      case 'STONECUTTER': { const s = this.world.stonecutterAt(this.container.x, this.container.y, this.container.z); if (!s) { this.show('GAME'); return; } m.showStonecutter(this.inventory, s, this.message); return; }
      case 'FURNACE': {
        const c = this.container, f = this.world.furnaceAt(c.x, c.y, c.z); if (!f) { this.show('GAME'); return; }
        this.shownFurnace = JSON.stringify(f) + JSON.stringify(this.inventory.slots);
        m.showFurnace(this.inventory, f, this.world.furnaceProgressAt(c.x, c.y, c.z), this.message); return;
      }
      case 'CHEST': { const c = this.container, chest = this.world.chestAt(c.x, c.y, c.z); if (!chest) { this.show('GAME'); return; } m.showChest(this.inventory, chest); return; }
      case 'LOADING': m.showLoading(this.loadingSlot === 0 ? (this.world ? this.world.dimension === 'HELL_FOREST' ? 'Переход в Адский лес' : 'Переход в обычный мир' : 'Загрузка сетевого мира') : 'Загрузка мира ' + this.loadingSlot); return;
      default: return;
    }
  }
  refresh() { if (!this.active) this.show(this.screen); }
  relayAddress() { return this.networkAddress + ':' + this.networkPort; }
  async menuAction(id, fraction) {
    if (!id || this.screen === 'LOADING') return;
    this.message = '';
    if (id === 'network_address') { this.addressFocused = true; this.show(this.screen); return; }
    if (id === 'network_port') { this.addressFocused = false; this.show(this.screen); return; }
    if (id.startsWith('network_skin_')) { if (!this.connecting && !this.isGuest()) this.characterSkin = id.endsWith('0') ? 0 : 1; this.show(this.screen); return; }
    if (id === 'network_start') { this.startNetwork(); return; }
    if (this.isGuest() && this.multiplayer.busy()) return;
    if (this.isGuest() && this.networkContainerAction(id)) return;
    if (this.screen === 'INVENTORY' && this.player.creative) {
      if (id === 'creative_prev' || id === 'creative_next') {
        const pages = Math.max(1, Math.ceil(BC.Menu.creativeItems().length / 40));
        this.creativePage = BC.floorMod(this.creativePage + (id === 'creative_next' ? 1 : -1), pages); this.show('INVENTORY'); return;
      }
      if (id.startsWith('creative:')) { this.inventory.creativePick(this.selected, id.substring(9)); this.inventoryDrag = null; this.show('INVENTORY'); return; }
      if (id.startsWith('slot:')) { const i = +id.substring(5); if (i < BC.HOTBAR_SIZE) this.select(i); this.inventoryDrag = null; this.show('INVENTORY'); return; }
    }
    let m;
    if ((m = /^world([1-5])$/.exec(id))) { this.startWorld(+m[1], null); return; }
    if (id === 'create_world') { this.creatingWorldName = true; this.worldNameBuffer = ''; this.show('CREATE_WORLD'); return; }
    if (id === 'cancel_world_name') { this.creatingWorldName = false; this.worldNameBuffer = ''; this.show('WORLDS'); return; }
    if (id === 'confirm_world_name') { this.createNamedWorld(); return; }
    if ((m = /^delete_world_([1-5])$/.exec(id))) { this.deletingSlot = +m[1]; this.show('DELETE_WORLD'); return; }
    if ((m = /^export_world_([1-5])$/.exec(id))) {
      try {
        const { blob, name } = await this.saves.exportSlot(+m[1]);
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]/g, '_') + '.bcw';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        this.message = 'Мир сохранён в файл';
      } catch (e) { this.message = 'Не удалось экспортировать: ' + e.message; }
      this.show('WORLDS'); return;
    }
    if (id === 'import_world') { this.importInput.click(); return; }
    if (id === 'cancel_delete_world') { this.deletingSlot = 0; this.show('WORLDS'); return; }
    if (id === 'confirm_delete_world') {
      try { this.message = (await this.saves.delete(this.deletingSlot)) ? 'Мир удалён' : 'Сохранение уже отсутствует'; }
      catch (e) { this.message = 'Не удалось удалить мир: ' + e.message; }
      this.deletingSlot = 0; this.show('WORLDS'); return;
    }
    if (id.startsWith('mod_toggle:')) { BC.ModCatalog.toggle(id.substring(11)); this.message = 'Изменения применятся при входе в мир'; this.show('MODS'); return; }
    if (id.startsWith('mod_remove:')) { BC.ModCatalog.remove(id.substring(11)); this.show('MODS'); return; }
    if (id === 'mod_add_folder') { this.folderInput.click(); return; }
    if (id === 'mod_add_file') { this.fileInput.click(); return; }
    if (id.startsWith('hotbar:')) id = 'slot:' + id.substring(7);
    const c = this.container, world = this.world, inv = this.inventory;
    if (id.startsWith('chest:')) {
      if (this.inventoryDrag && this.inventoryDrag.startsWith('slot:')) {
        world.moveChestItem(c.x, c.y, c.z, +id.substring(6), inv, +this.inventoryDrag.substring(5), false, this.inventoryDragOne);
        this.endDrag('CHEST');
      } else if (this.inventoryDrag === null) this.inventoryDrag = world.chestAt(c.x, c.y, c.z).slots[+id.substring(6)].item ? id : null;
      else this.endDrag('CHEST');
      return;
    }
    if (id.startsWith('slot:') && this.inventoryDrag && this.inventoryDrag.startsWith('chest:')) {
      world.moveChestItem(c.x, c.y, c.z, +this.inventoryDrag.substring(6), inv, +id.substring(5), true, this.inventoryDragOne);
      this.endDrag('CHEST'); return;
    }
    if (id === 'craft_result') {
      const result = inv.craftPreview();
      this.message = !result ? 'Рецепт не найден' : inv.craftFromGrid() ? 'Создано: ' + BC.item(result).title : 'Нет места в инвентаре';
      this.inventoryDrag = null; this.show('INVENTORY'); return;
    }
    if (id.startsWith('recipe:')) {
      const recipe = id.substring(7);
      this.message = world.selectStonecutterRecipe(c.x, c.y, c.z, recipe) ? 'Выбрано: ' + BC.item(recipe).title : 'Не удалось выбрать рецепт';
      this.show('STONECUTTER'); return;
    }
    const cutterMessage = slots => 'Нужны 1 уголь и ' + World.stonecutterMaterialCount(slots.recipe) + ' ' + BC.item(World.stonecutterMaterial(slots.recipe)).title;
    if (id === 'machine_craft') {
      const slots = world.stonecutterAt(c.x, c.y, c.z); if (!slots) { this.show('GAME'); return; }
      this.message = world.craftStonecutterHead(c.x, c.y, c.z) ? 'Изготовлено: ' + BC.item(slots.recipe).title : cutterMessage(slots);
      this.show('STONECUTTER'); return;
    }
    if (id.startsWith('machine:')) {
      const machineSlot = +id.substring(8), slots = world.stonecutterAt(c.x, c.y, c.z);
      if (!slots) { this.show('GAME'); return; }
      if (machineSlot === 2 && this.inventoryDrag === null) {
        if (slots.output.count > 0) this.message = world.takeStonecutterOutput(c.x, c.y, c.z, inv) ? 'Предмет забран' : 'Нет места в инвентаре';
        else this.message = world.craftStonecutterHead(c.x, c.y, c.z) ? 'Изготовлено: ' + BC.item(slots.recipe).title : cutterMessage(slots);
        this.show('STONECUTTER'); return;
      }
      if (this.inventoryDrag === null) { if (slots[['coal', 'stone', 'output'][machineSlot]].item) this.inventoryDrag = id; }
      else if (this.inventoryDrag.startsWith('slot:')) {
        const inventorySlot = +this.inventoryDrag.substring(5), required = machineSlot === 0 ? 'COAL' : World.stonecutterMaterial(slots.recipe);
        let moved = world.putStonecutterItem(c.x, c.y, c.z, machineSlot, inv, inventorySlot), any = moved;
        if (!this.inventoryDragOne) while (moved && inv.countAt(inventorySlot) > 0) { moved = world.putStonecutterItem(c.x, c.y, c.z, machineSlot, inv, inventorySlot); any = any || moved; }
        this.message = any ? 'Предмет помещён' : 'Этот слот принимает только ' + BC.item(required).title;
        this.endDrag('STONECUTTER');
      } else this.endDrag('STONECUTTER');
      return;
    }
    if (id.startsWith('furnace:')) {
      const machineSlot = +id.substring(8), state = world.furnaceAt(c.x, c.y, c.z);
      if (!state) { this.show('GAME'); return; }
      if (machineSlot === 2 && this.inventoryDrag === null) {
        this.message = state.output.count > 0 ? (world.takeFurnaceOutput(c.x, c.y, c.z, inv) ? 'Продукт забран' : 'Нет места в инвентаре') : 'Готового продукта пока нет';
        this.show('FURNACE'); return;
      }
      if (this.inventoryDrag === null) { if (state[['coal', 'input', 'output'][machineSlot]].item) this.inventoryDrag = id; }
      else if (this.inventoryDrag.startsWith('slot:')) {
        const inventorySlot = +this.inventoryDrag.substring(5), source = inv.itemAt(inventorySlot);
        let moved = world.putFurnaceItem(c.x, c.y, c.z, machineSlot, inv, inventorySlot), any = moved;
        if (!this.inventoryDragOne) while (moved && inv.countAt(inventorySlot) > 0) { moved = world.putFurnaceItem(c.x, c.y, c.z, machineSlot, inv, inventorySlot); any = any || moved; }
        this.message = any ? 'Предмет помещён' : 'Слот принимает ' + (machineSlot === 0 ? 'уголь' : 'предметы для плавки или готовки') + (source ? '; выбрано: ' + BC.item(source).title : '');
        this.endDrag('FURNACE');
      } else this.endDrag('FURNACE');
      return;
    }
    if (id.startsWith('slot:') && this.inventoryDrag && this.inventoryDrag.startsWith('furnace:')) {
      const machineSlot = +this.inventoryDrag.substring(8), inventorySlot = +id.substring(5);
      let moved = world.takeFurnaceItem(c.x, c.y, c.z, machineSlot, inv, inventorySlot), any = moved;
      if (!this.inventoryDragOne) while (moved) { moved = world.takeFurnaceItem(c.x, c.y, c.z, machineSlot, inv, inventorySlot); any = any || moved; }
      this.message = any ? 'Предмет забран' : 'Не удалось забрать предмет';
      this.endDrag('FURNACE'); return;
    }
    if (id.startsWith('slot:') && this.inventoryDrag && this.inventoryDrag.startsWith('machine:')) {
      const machineSlot = +this.inventoryDrag.substring(8), inventorySlot = +id.substring(5);
      let moved = world.takeStonecutterItem(c.x, c.y, c.z, machineSlot, inv, inventorySlot);
      if (!this.inventoryDragOne) while (moved) moved = world.takeStonecutterItem(c.x, c.y, c.z, machineSlot, inv, inventorySlot);
      this.endDrag('STONECUTTER'); return;
    }
    if (id.startsWith('slot:') || id.startsWith('craft:')) {
      if (this.inventoryDrag === null) { if (inv.hasItemRef(id)) this.inventoryDrag = id; return; }
      if (this.inventoryDrag !== id) inv.moveRef(this.inventoryDrag, id, this.inventoryDragOne);
      this.endDrag(this.screen); return;
    }
    switch (id) {
      case 'worlds': this.show('WORLDS'); return;
      case 'multiplayer': this.addressFocused = true; this.show('MULTIPLAYER'); return;
      case 'open_network': this.addressFocused = false; this.show('OPEN_NETWORK'); return;
      case 'close_network': this.closeNetwork(); this.message = 'Сервер закрыт'; this.show('PAUSE'); return;
      case 'mods': this.show('MODS'); return;
      case 'settings': this.settingsBack = this.screen; this.show('SETTINGS'); return;
      case 'resume': this.show('GAME'); return;
      case 'back': this.back(); return;
      case 'main': if (await this.saveNow()) { this.unload(); this.show('MAIN'); } return;
      case 'save': if (await this.saveNow()) { this.message = 'Мир сохранён'; this.show('PAUSE'); } return;
      case 'quit': this.quit(); return;
      case 'distance': case 'sensitivity': case 'fov': case 'textures': this.setOption(id, fraction); return;
      default: this.inventoryDrag = null;
    }
  }
  endDrag(screen) { this.inventoryDrag = null; this.inventoryDragOne = false; this.dragDownId = null; this.show(screen); }
  setOption(id, f) {
    const o = this.options, has = typeof f === 'number';
    if (id === 'distance') o.distance = has ? Math.round(2 + f * 4) : o.distance === 6 ? 2 : o.distance + 1;
    if (id === 'sensitivity') o.sensitivity = has ? Math.round((.5 + f * 1.5) / .25) * .25 : o.sensitivity >= 2 ? .5 : o.sensitivity + .25;
    if (id === 'fov') o.fov = has ? 65 + Math.round(f * 3) * 10 : o.fov >= 95 ? 65 : o.fov + 10;
    if (id === 'textures') { o.texturePack = o.texturePack === 0 ? 1 : 0; BC.Textures.setPack(o.texturePack); BC.Render.rebuildAtlas(); }
    if (!o.save()) this.message = 'Не удалось сохранить настройки';
    this.resize(); this.show('SETTINGS');
  }
  back() {
    this.message = '';
    switch (this.screen) {
      case 'GAME': this.show('PAUSE'); this.saveNow(); return;
      case 'PAUSE': this.show('GAME'); return;
      case 'MULTIPLAYER': this.cancelConnection(); this.show('MAIN'); return;
      case 'OPEN_NETWORK': this.show('PAUSE'); return;
      case 'WORLDS': case 'MODS': case 'CREATE_WORLD': this.creatingWorldName = false; this.show('MAIN'); return;
      case 'DELETE_WORLD': this.deletingSlot = 0; this.show('WORLDS'); return;
      case 'SETTINGS': this.show(this.settingsBack); return;
      case 'CHEST': {
        const c = this.container;
        if (this.isGuest()) this.requestNetwork({ kind: 'container-close', x: c.x, y: c.y, z: c.z, a: 0, b: 0, one: false, value: '' });
        else this.world.closeChest(c.x, c.y, c.z);
        this.inventoryDrag = null; this.show('GAME'); return;
      }
      case 'INVENTORY': case 'STONECUTTER': case 'FURNACE': this.inventoryDrag = null; this.show('GAME'); return;
      default: return;
    }
  }

  // ------------------------------------------------------------ worlds and saving
  createNamedWorld() {
    const name = this.worldNameBuffer.trim();
    if (!name) { this.message = 'Имя не должно быть пустым'; this.show('CREATE_WORLD'); return; }
    for (let candidate = 1; candidate <= 5; candidate++) if (!this.worldSlots[candidate]) {
      this.creatingWorldName = false; this.worldNameBuffer = ''; this.message = '';
      this.startWorld(candidate, name); return;
    }
    this.message = 'Все слоты миров заняты; сначала освободите слот'; this.show('CREATE_WORLD');
  }
  async startWorld(target, requestedName) {
    if (!(await this.saveNow())) return;
    this.unload(); this.loadingSlot = target; this.show('LOADING');
    const ticket = this.loadingTicket = {};
    try {
      let saved;
      if (await this.saves.exists(target)) saved = await this.saves.load(target);
      else {
        const world = new World(); const spawn = new Player(); spawn.respawn(world);
        const pose = { x: spawn.position.x, y: spawn.position.y, z: spawn.position.z, yaw: 0, pitch: 0, selected: 1, health: 20, hunger: 20, respawnX: -1, respawnY: -1, respawnZ: -1, creative: false };
        const name = requestedName || 'Мир ' + target;
        await this.saves.save(target, world.snapshot(), pose, Inventory.emptySnapshot(), name);
        saved = { world, pose, inventory: Inventory.emptySnapshot(), name };
      }
      if (ticket !== this.loadingTicket) return;
      this.enterWorld(saved, target);
    } catch (e) {
      console.error(e);
      this.message = 'Не удалось открыть мир: ' + e.message; this.unload(); this.show('WORLDS');
    }
  }
  enterWorld(saved, slot) {
    this.world = saved.world; this.dimensionWorlds.set(this.world.dimension, this.world); this.slot = slot; this.worldName = saved.name;
    this.inventory.restore(saved.inventory);
    const p = saved.pose, player = this.player;
    Object.assign(player.position, { x: p.x, y: p.y, z: p.z }); player.velocityY = 0; player.grounded = false;
    player.setCreative(p.creative); this.inventory.setCreative(p.creative);
    player.restoreHealth(p.health); player.restoreHunger(p.hunger); player.restoreRespawnPoint(p.respawnX, p.respawnY, p.respawnZ);
    this.lastPlayerHealth = player.health;
    this.world.ensureSheepNear(player.position);
    this.yaw = p.yaw; this.pitch = p.pitch; this.select(p.selected);
    if (player.collides(this.world)) player.respawn(this.world);
    this.attachView();
    this.pythonMods = new BC.PythonModApi(this.world, player, this.inventory);
    this.prefetchDimension(BC.otherDimension(this.world.dimension));
  }
  attachView() {
    this.worldView = new BC.WorldView(this.world);
    this.scene.add(this.worldView.group);
    BC.Render.setAmbientFloor(this.world.dimension === 'HELL_FOREST' ? .28 : .012);
  }
  /** Load the other dimension in the background so portals and guests never wait on storage. */
  prefetchDimension(dimension) {
    if (this.dimensionWorlds.has(dimension) || this.dimensionLoads.has(dimension) || !this.world) return;
    const seed = this.world.seed, slot = this.slot;
    const load = (async () => {
      let world;
      if (slot > 0 && await this.saves.hasDimension(slot, dimension)) {
        world = (await this.saves.loadDimension(slot, dimension)).world;
        if (world.dimension !== dimension || world.seed !== seed) throw new Error('Измерение не соответствует миру');
      } else world = new World(seed, dimension);
      if (this.world && this.world.seed === seed && !this.dimensionWorlds.has(dimension)) this.dimensionWorlds.set(dimension, world);
      return world;
    })();
    this.dimensionLoads.set(dimension, load);
    load.catch(e => this.hud.notify('Не удалось открыть измерение: ' + e.message)).finally(() => this.dimensionLoads.delete(dimension));
  }
  async dimensionWorld(dimension) {
    if (this.dimensionWorlds.has(dimension)) return this.dimensionWorlds.get(dimension);
    this.prefetchDimension(dimension);
    await this.dimensionLoads.get(dimension);
    return this.dimensionWorlds.get(dimension);
  }
  pose() {
    const p = this.player;
    return { x: p.position.x, y: p.position.y, z: p.position.z, yaw: this.yaw, pitch: this.pitch, selected: this.selected,
      health: Math.max(1, p.health), hunger: p.hunger, respawnX: p.respawnX, respawnY: p.respawnY, respawnZ: p.respawnZ, creative: p.creative };
  }
  /** Snapshot now, write in order; resolves false (with a message) if storage failed. */
  saveNow() {
    if (!this.world || this.isGuest() || !this.slot) return Promise.resolve(true);
    const slot = this.slot, name = this.worldName, pose = this.pose(), inventory = this.inventory.snapshot();
    const current = this.world.snapshot(), dimensions = Array.from(this.dimensionWorlds.values()).map(w => w.snapshot());
    this.autosave = 0;
    this.saveChain = this.saveChain.then(() => this.saves.saveUniverse(slot, dimensions, current, pose, inventory, name).then(() => true))
      .catch(e => {
        this.message = 'Не удалось сохранить мир: ' + e.message; console.error(e);
        if (this.screen === 'GAME') this.show('PAUSE'); else this.refresh();
        return false;
      });
    return this.saveChain;
  }
  unload() {
    this.cancelConnection(); this.closeNetwork();
    this.loadingTicket = null;
    this.dimensionWorlds.clear(); this.dimensionBeds.clear(); this.dimensionLoads.clear(); this.portalCooldown = 0; this.lavaClock = 0;
    if (this.pythonMods) { this.pythonMods.close(); this.pythonMods = null; }
    this.hud.overlays = new Map();
    if (this.worldView) this.worldView.close(); this.worldView = null; this.world = null; this.slot = 0; this.worldName = '';
  }
  /** Browsers only let scripts close tabs they opened, so "exit" saves and returns to the main menu. */
  async quit() {
    if (this.screen === 'CHEST' && this.world && !this.isGuest()) this.world.closeChest(this.container.x, this.container.y, this.container.z);
    const playing = !!this.world;
    if (!(await this.saveNow())) return;
    this.unload();
    try { window.close(); } catch (e) { /* not allowed */ }
    this.message = playing ? 'Мир сохранён. Вкладку браузера можно закрыть' : 'Вкладку браузера можно закрыть';
    this.show('MAIN');
  }

  // ------------------------------------------------------------ dimensions
  async updatePortal(dt) {
    this.portalCooldown = Math.max(0, this.portalCooldown - dt);
    if (!this.active || !this.world || this.portalCooldown > 0 || this.portalBusy) return;
    const portal = BC.Portal.touching(this.world, this.player.position); if (!portal) return;
    if (this.isGuest()) { if (!this.multiplayer.busy()) { this.requestNetwork({ kind: 'portal' }); this.portalCooldown = 1; } return; }
    this.portalBusy = true;
    try {
      const destination = await this.dimensionWorld(BC.otherDimension(this.world.dimension));
      if (!destination || !this.world) throw new Error('Измерение недоступно');
      if (!(await this.saveNow())) { this.portalCooldown = 3; return; }
      this.switchDimension(destination, BC.Portal.safeExit(destination, portal));
      this.saveNow();
    } catch (e) { this.portalCooldown = 3; this.hud.notify(e.message); }
    finally { this.portalBusy = false; }
  }
  switchDimension(destination, arrival) {
    const p = this.player;
    this.dimensionBeds.set(this.world.dimension, { x: p.respawnX, y: p.respawnY, z: p.respawnZ });
    if (this.pythonMods) { this.pythonMods.close(); this.pythonMods = null; }
    if (this.worldView) this.worldView.close();
    this.world = destination; this.dimensionWorlds.set(destination.dimension, destination);
    Object.assign(p.position, { x: arrival.x, y: arrival.y, z: arrival.z }); p.velocityY = 0; p.grounded = false;
    const bed = this.dimensionBeds.get(destination.dimension) || { x: -1, y: -1, z: -1 }; p.restoreRespawnPoint(bed.x, bed.y, bed.z);
    this.portalCooldown = 3; this.resetBreakProgress(); this.inventoryDrag = null; this.commandOpen = false; this.hud.command = '';
    this.attachView();
    if (!this.isGuest()) this.pythonMods = new BC.PythonModApi(this.world, p, this.inventory);
    this.loadingSlot = 0; this.show('LOADING'); this.hud.notify(BC.DIMENSIONS[destination.dimension]);
  }

  // ------------------------------------------------------------ multiplayer
  isGuest() { return !!(this.multiplayer && !this.multiplayer.hosting); }
  networkPose() {
    const p = this.player.position, moving = this.active && this.movement.some(Boolean);
    return { id: this.multiplayer ? this.multiplayer.localId : 0, skin: this.characterSkin, x: p.x, y: p.y, z: p.z, yaw: this.yaw, pitch: this.pitch,
      moving, airborne: !this.player.grounded, swinging: this.active && this.breakHeld, dimension: this.world ? this.world.dimension : 'SURFACE' };
  }
  requestNetwork(command) {
    if (this.isGuest()) this.multiplayer.request({ x: 0, y: 0, z: 0, a: 0, b: 0, one: false, value: '', ...command }, this.networkPose(), this.inventory, this.selected, this.player.creative);
  }
  async startNetwork() {
    if (this.connecting || this.isGuest()) return;
    try {
      const port = this.online ? (+location.port || 443) : BC.parsePort(this.networkPort);
      const room = this.online ? this.networkPort : 'lan';
      if (this.online && !/^[0-9]{1,5}$/.test(room)) throw new Error('Код комнаты: от 1 до 5 цифр');
      if (this.screen === 'OPEN_NETWORK') {
        if (!this.world || this.multiplayer) return;
        this.connecting = true; this.show(this.screen);
        const host = this.networkAddress.trim() || 'localhost';
        await Promise.all(Array.from(this.dimensionLoads.values()));
        const mp = await BC.Multiplayer.host(host, port, this.characterSkin, this.networkListener(), room);
        this.connecting = false;
        if (!this.world) { mp.close(); return; }
        this.multiplayer = mp;
        mp.worldProvider = d => this.dimensionWorlds.get(d) || null;
        this.serverAddresses = this.online ? 'Комната ' + room + ' · ' + location.host
          : (mp.info.addresses && mp.info.addresses.length ? mp.info.addresses.join(', ') : host) + ':' + port;
        this.message = 'Адрес для друзей: ' + this.serverAddresses; this.show('PAUSE');
      } else if (this.screen === 'MULTIPLAYER') {
        const address = this.networkAddress.trim();
        if (!address) throw new Error('Введите адрес сервера');
        this.connecting = true; this.show(this.screen);
        const ticket = this.connectTicket = {};
        const mp = await BC.Multiplayer.connect(address, port, this.characterSkin, this.networkListener(), room);
        if (ticket !== this.connectTicket) { mp.close(); return; }
        this.connecting = false; this.multiplayer = mp;
        this.message = 'Загрузка мира сервера...'; this.show('MULTIPLAYER');
      }
    } catch (e) {
      this.connecting = false; this.message = e.message; console.error('[LAN]', e.message); this.show(this.screen);
    }
  }
  cancelConnection() {
    this.connectTicket = null; this.connecting = false;
    if (this.isGuest() && !this.world) this.closeNetwork();
  }
  closeNetwork() {
    if (this.multiplayer) { this.multiplayer.close(); this.multiplayer = null; }
    for (const m of this.remoteModels.values()) this.scene.remove(m.group);
    this.remoteModels.clear();
  }
  networkListener() {
    return {
      joined: state => {
        this.world = state.world; this.dimensionWorlds.set(this.world.dimension, this.world); this.worldName = state.name; this.slot = 0; this.loadingSlot = 0;
        this.inventory.restore(Inventory.emptySnapshot());
        const p = this.player; Object.assign(p.position, { x: state.pose.x, y: state.pose.y, z: state.pose.z });
        p.setCreative(false); this.inventory.setCreative(false); p.restoreHealth(20); p.restoreHunger(20); p.restoreRespawnPoint(-1, -1, -1);
        this.lastPlayerHealth = p.health; this.yaw = state.pose.yaw; this.pitch = state.pose.pitch; this.select(1);
        if (p.collides(this.world)) p.respawn(this.world);
        this.attachView(); this.show('LOADING');
      },
      transferred: (state, items) => {
        this.inventory.restore(items); this.inventory.setCreative(this.player.creative);
        this.switchDimension(state.world, { x: state.pose.x, y: state.pose.y, z: state.pose.z });
      },
      damage: amount => this.player.damage(amount),
      changed: () => {
        if (CONTAINERS.has(this.screen)) {
          const c = this.container, exists = this.screen === 'CHEST' ? this.world.chestAt(c.x, c.y, c.z) : this.screen === 'FURNACE' ? this.world.furnaceAt(c.x, c.y, c.z) : this.world.stonecutterAt(c.x, c.y, c.z);
          if (exists) this.show(this.screen); else { this.inventoryDrag = null; this.show('GAME'); }
        }
      },
      result: (items, reply) => {
        this.inventory.restore(items); this.inventory.setCreative(this.player.creative);
        if (reply.notice) this.hud.notify(reply.notice);
        // A delayed reply must not reopen a screen after the player pressed Escape.
        if (this.active) {
          if (CONTAINERS.has(reply.screen)) { this.container = { x: reply.x, y: reply.y, z: reply.z }; this.show(reply.screen); }
          else if (reply.screen === 'BED') this.player.setRespawnPoint(this.world.bedSpawn(reply.x, reply.y, reply.z));
        }
        if (DRAG_SCREENS.has(this.screen)) this.show(this.screen);
      },
      disconnected: reason => {
        if (this.isGuest()) { this.unload(); this.message = 'Отключено: ' + reason; this.show('MULTIPLAYER'); }
        else { this.closeNetwork(); this.hud.notify(reason); this.refresh(); }
      }
    };
  }
  networkContainerAction(id) {
    if (!CONTAINERS.has(this.screen)) return false;
    const c = this.container, prefix = this.screen === 'CHEST' ? 'chest:' : this.screen === 'FURNACE' ? 'furnace:' : 'machine:';
    const base = { x: c.x, y: c.y, z: c.z, a: 0, b: 0, one: false, value: '' };
    if (id.startsWith('recipe:') || id === 'machine_craft') {
      this.requestNetwork({ ...base, kind: id.startsWith('recipe:') ? 'container-recipe' : 'container-craft', value: id.startsWith('recipe:') ? id.substring(7) : '' });
      return true;
    }
    let kind = null, a = 0, b = 0;
    if (id.startsWith(prefix)) {
      a = +id.substring(prefix.length);
      if (this.inventoryDrag && this.inventoryDrag.startsWith('slot:')) { b = +this.inventoryDrag.substring(5); kind = this.screen === 'CHEST' ? 'container-chest-put' : 'container-put'; }
      else { this.inventoryDrag = id; return true; }
    } else if (id.startsWith('slot:') && this.inventoryDrag && this.inventoryDrag.startsWith(prefix)) {
      a = +this.inventoryDrag.substring(prefix.length); b = +id.substring(5);
      kind = this.screen === 'CHEST' ? 'container-chest-take' : 'container-take';
    }
    if (kind) { this.requestNetwork({ ...base, kind, a, b, one: this.inventoryDragOne }); this.inventoryDrag = null; this.inventoryDragOne = false; return true; }
    return false;
  }
  updateRemotePlayers(dt) {
    if (!this.multiplayer) return;
    for (const [id, model] of this.remoteModels) if (!this.multiplayer.players.has(id)) { this.scene.remove(model.group); this.remoteModels.delete(id); }
    for (const remote of this.multiplayer.players.values()) {
      if (remote.id === this.multiplayer.localId) continue;
      let model = this.remoteModels.get(remote.id);
      if (!model || model.skin !== remote.skin) {
        if (model) this.scene.remove(model.group);
        model = new BC.PlayerModel(remote.skin, true); this.remoteModels.set(remote.id, model); this.scene.add(model.group);
      }
      model.group.visible = !!this.world && remote.dimension === this.world.dimension && this.screen !== 'LOADING' && this.screen !== 'MAIN';
      model.update(remote, dt);
    }
  }

  // ------------------------------------------------------------ frame
  frame(now) {
    requestAnimationFrame(t => this.frame(t));
    const tpf = Math.min(.25, Math.max(0, (now - this.last) / 1000)); this.last = now;
    try { this.update(tpf); } catch (e) { console.error(e); this.hud.notify('Ошибка: ' + e.message); }
    this.renderer.render(this.scene, this.camera);
    this.drawUi();
  }
  update(tpf) {
    const world = this.world, player = this.player, guest = this.isGuest();
    if (this.multiplayer) this.multiplayer.tick(tpf, this.world, this.pose(), this.worldName, this.networkPose(), this.inventory, this.active);
    this.updateRemotePlayers(tpf);
    const menuScene = this.screen === 'LOADING' || this.screen === 'MAIN';
    this.panorama.update(this.camera, tpf, menuScene);
    this.menu.update(tpf);
    if (this.worldView) this.worldView.group.visible = !menuScene;
    if (this.world && !guest && (this.active || this.multiplayer)) this.world.advanceTime(tpf);
    this.updateLighting(tpf, menuScene);
    this.updateBreakProgress(tpf);
    if (this.world && !guest) this.world.updateFurnaces(tpf);
    if (this.world && this.screen === 'FURNACE') {
      const c = this.container, f = this.world.furnaceAt(c.x, c.y, c.z);
      if (f) {
        const signature = JSON.stringify(f) + JSON.stringify(this.inventory.slots);
        if (signature !== this.shownFurnace && this.inventoryDrag === null) this.show('FURNACE');
        else if (this.menu.furnaceProgress) this.menu.furnaceProgress.value = this.world.furnaceProgressAt(c.x, c.y, c.z);
      }
    }
    if (this.active && this.world) player.tickHunger(tpf);
    if (!guest && (this.active || this.multiplayer) && this.world) {
      const w = this.world;
      w.updateWater(tpf); w.updateCrops(tpf);
      w.mods.tick(tpf, player);
      w.updateSheep(tpf);
      if (!(this.multiplayer && this.multiplayer.hosting)) w.updateZombies(tpf, player);
      w.updateFish(tpf);
      if (this.multiplayer && this.multiplayer.hosting) this.multiplayer.simulateDimensions(tpf, w, player);
      else w.updateHellMobs(tpf, [player]);
      w.ensureSheepNear(player.position); w.ensureFishNear(player.position);
      if (this.active) w.collectIntoInventory(player.position, 1.25, this.inventory);
    }
    if (this.active && this.world) {
      this.lavaClock -= tpf;
      const p = player.position;
      if (this.world.get(Math.floor(p.x), Math.floor(p.y + .2), Math.floor(p.z)) === B.HELL_LAVA && this.lavaClock <= 0) { player.damage(4); this.lavaClock = .75; }
    }
    if (player.health < this.lastPlayerHealth) this.hud.damageFlash();
    this.lastPlayerHealth = player.health;
    if (player.dead() && this.world) {
      if (!this.world.keepInventory && !guest) this.world.createDeathChest(this.inventory, player.position);
      player.respawn(this.world); player.restoreHunger(Player.MAX_HUNGER);
      // Fixed: the death message is shown in game (the Java edition only stored it for menus).
      this.hud.notify(this.world.keepInventory ? 'Вы погибли. Инвентарь сохранён' : 'Вы погибли. Вещи остались в сундуке на месте гибели');
      if (!this.active && this.screen !== 'LOADING') this.show('GAME');
    }
    if (this.world && this.world.mods.notice) { this.hud.notify(this.world.mods.notice); this.world.mods.notice = ''; }
    this.hud.update(tpf);
    this.hud.vitals = { health: player.health, hunger: player.hunger, creative: player.creative };
    if (this.world) this.hud.overlays = this.world.mods.overlays;
    if (this.worldView) {
      const p = player.position;
      this.worldView.update(p.x, p.z, this.options.distance);
      this.worldView.updateEntities(tpf, p.x, p.z);
      BC.Render.setHeldTorch(this.inventory.hotbarItemAt(this.selected) === 'TORCH' ? { x: p.x, y: p.y + Player.EYE - .15, z: p.z } : null);
    }
    if (this.screen === 'LOADING' && this.worldView && this.worldView.ready(player.position.x, player.position.z)) { this.autosave = 0; this.show('GAME'); }
    if (this.pythonMods && this.world && this.active) this.pythonMods.tick(tpf, this.selected, this.yaw);
    if (this.active && this.worldView && this.worldView.ready(player.position.x, player.position.z)) {
      const forward = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }, right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
      const m = this.movement; let mx = 0, mz = 0;
      if (m[0]) { mx += forward.x; mz += forward.z; } if (m[1]) { mx -= forward.x; mz -= forward.z; }
      if (m[2]) { mx -= right.x; mz -= right.z; } if (m[3]) { mx += right.x; mz += right.z; }
      const l = Math.hypot(mx, mz); if (l > 0) { mx /= l; mz /= l; }
      const move = { x: mx, y: player.creative ? (this.flyUp ? 1 : 0) - (this.flyDown ? 1 : 0) : 0, z: mz };
      player.update(this.world, Math.min(tpf, .05), move, this.jump || (player.inWater(this.world) && this.flyUp));
      this.jump = false;
      if (!guest) { this.autosave += tpf; if (this.autosave >= 30) this.saveNow(); }
    }
    this.updatePortal(tpf);
    if (!menuScene) this.updateCamera();
    this.updateHighlight();
    this.hud.hint = this.active && !this.mapInteraction && document.pointerLockElement !== this.ui ? 'Нажмите, чтобы продолжить' : '';
    if (!this.active) this.menu.hover(this.cursor.x, this.cursor.y);
  }
  updateCamera() {
    const p = this.player.position;
    this.camera.position.set(p.x, p.y + Player.EYE, p.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
  updateLighting(dt, menuScene) {
    const R = BC.Render, hell = this.world && this.world.dimension === 'HELL_FOREST' && !menuScene;
    this.atmosphere.mesh.visible = !hell;
    R.setAmbientFloor(hell ? .28 : menuScene ? .012 : this.world && this.world.dimension === 'HELL_FOREST' ? .28 : .012);
    if (hell) {
      const fog = new THREE.Color(.30, .055, .08);
      this.renderer.setClearColor(fog); R.setDaylight(.4);
      R.setAtmosphere(new THREE.Vector3(.2, .8, .2), new THREE.Color(1, .5, .3), fog);
    } else {
      const time = !this.world || menuScene ? .5 : this.world.dayTime;
      const day = this.atmosphere.update(this.camera, time, dt);
      this.renderer.setClearColor(this.atmosphere.horizon);
      R.setDaylight(day); R.setAtmosphere(this.atmosphere.sun, this.atmosphere.tint, this.atmosphere.horizon);
    }
    // Fixed: underwater fog (the Java shader had it but the flag was never set).
    let under = false;
    if (this.world && !menuScene) {
      const e = this.camera.position, x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z);
      under = this.world.get(x, y, z) === B.WATER && e.y < y + this.world.waterHeight(x, y, z);
    }
    R.setUnderwater(under);
  }
  updateHighlight() {
    const hit = this.active && this.world ? this.target() : null;
    const box = (o, minX, minY, minZ, maxX, maxY, maxZ, pad = .003) => {
      o.visible = true; o.scale.set(maxX - minX + pad, maxY - minY + pad, maxZ - minZ + pad);
      o.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    };
    this.highlight.visible = this.stepHighlight.visible = this.breakOverlay.visible = false;
    if (!hit) return;
    const door = this.world.doorAt(hit.x, hit.y, hit.z), block = this.world.get(hit.x, hit.y, hit.z);
    if (door) { const b = BC.Door.bounds(door); box(this.highlight, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ); }
    else if (block === B.STAIRS) {
      const [lo, up] = BC.Stairs.bounds(hit.x, hit.y, hit.z, this.world.rotation(hit.x, hit.y, hit.z));
      box(this.highlight, lo.minX, lo.minY, lo.minZ, lo.maxX, lo.maxY, lo.maxZ); box(this.stepHighlight, up.minX, up.minY, up.minZ, up.maxX, up.maxY, up.maxZ);
    } else box(this.highlight, hit.x, hit.y, hit.z, hit.x + 1, hit.y + 1, hit.z + 1);
    if (this.breakHeld && this.breakX === hit.x && this.breakY === hit.y && this.breakZ === hit.z && this.breakProgress > 0) {
      const progress = BC.clamp(this.breakProgress / Math.max(.01, BC.Block.breakTime(block, this.inventory.hotbarItemAt(this.selected))), 0, 1);
      const pulse = 1.015 + .035 * Math.sin(this.breakProgress * 28);
      this.breakOverlay.visible = true; this.breakOverlay.scale.setScalar(1.03 * pulse);
      this.breakOverlay.position.set(hit.x + .5, hit.y + .5, hit.z + .5);
      this.breakOverlay.material.color.setRGB(.95, .12 + .55 * progress, .04);
    }
  }
  drawUi() {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.ui.width, this.ui.height);
    g.imageSmoothingEnabled = false;
    if (this.active || (this.world && DRAG_SCREENS.has(this.screen))) this.hud.draw(g, this.inventory);
    if (!this.active) {
      let drag = null;
      if (this.inventoryDrag) {
        const [kind, index] = this.inventoryDrag.split(':'), c = this.container;
        const slot = kind === 'slot' ? this.inventory.slotAtIndex(+index) : kind === 'craft' ? this.inventory.craftSlotAt(+index)
          : kind === 'chest' ? (this.world.chestAt(c.x, c.y, c.z) || { slots: [] }).slots[+index]
          : kind === 'furnace' ? (this.world.furnaceAt(c.x, c.y, c.z) || {})[['coal', 'input', 'output'][+index]]
          : kind === 'machine' ? (this.world.stonecutterAt(c.x, c.y, c.z) || {})[['coal', 'stone', 'output'][+index]] : null;
        if (slot && slot.item) drag = BC.item(slot.item).texture;
      }
      this.menu.draw(g, drag);
    }
  }
}
BC.Game = Game;

window.addEventListener('load', async () => {
  const status = document.getElementById('status');
  try {
    if (!globalThis.THREE) throw new Error('Не загрузился js/lib/three.min.js');
    const game = new Game(); BC.game = game;
    await game.init();
    status.remove();
  } catch (e) {
    console.error(e);
    status.textContent = 'Barnocraft WEB не запустился: ' + e.message;
  }
});
})();
