/* Barnocraft WEB — touch controls for phones and tablets: a movement stick, look by dragging,
 * action buttons, hotbar taps, tap-to-move inventory (long press moves one item) and the
 * on-screen keyboard for text fields. Mouse and keyboard keep working alongside. */
(function () {
'use strict';
const BC = globalThis.BC;
const DRAG_SCREENS = new Set(['INVENTORY', 'STONECUTTER', 'FURNACE', 'CHEST']);
const LONG_PRESS = 450;

class TouchControls {
  constructor(game) {
    this.game = game;
    this.enabled = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints || 0) > 0 && !matchMedia('(pointer: fine)').matches;
    this.pointers = new Map(); // pointerId → { kind, ... }
    this.stick = { x: 0, y: 0, active: false, cx: 0, cy: 0 };
    this.pressed = new Set();
    this.input = document.getElementById('text-input');
    this.bind();
  }
  bind() {
    const ui = this.game.ui;
    // Touch events are cancelled so the browser neither scrolls, zooms nor emits emulated mouse clicks.
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) ui.addEventListener(type, e => e.preventDefault(), { passive: false });
    ui.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') this.down(e); });
    window.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') this.move(e); });
    window.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') this.up(e); });
    window.addEventListener('pointercancel', e => { if (e.pointerType !== 'mouse') this.up(e, true); });
    ui.addEventListener('mousedown', () => { this.enabled = false; });
    this.input.addEventListener('input', () => this.typed());
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.game.keyDown({ code: 'Enter', key: 'Enter', preventDefault() {} }); this.syncInput(); }
    });
  }

  // ------------------------------------------------------------ layout (CSS pixels)
  layout() {
    const W = this.game.hud.width, H = this.game.hud.height, s = this.game.hud.barGeometry().scale;
    const b = Math.max(46, Math.min(68, Math.min(W, H) * .13)), base = H - 16 - 70 * s - 18;
    const r = Math.max(48, Math.min(72, Math.min(W, H) * .14));
    const buttons = [
      { id: 'jump', label: '↑', x: W - 22 - b / 2, y: base - b / 2, r: b / 2 },
      { id: 'use', label: 'ИСП', x: W - 22 - b / 2, y: base - b * 1.75, r: b / 2 },
      { id: 'break', label: 'УДАР', x: W - 22 - b * 1.7, y: base - b * 1.05, r: b / 2 }
    ];
    if (this.game.player.creative) buttons.push({ id: 'down', label: '↓', x: W - 22 - b * 2.85, y: base - b / 2, r: b / 2 });
    const small = b * .72, top = [{ id: 'pause', label: 'II' }, { id: 'inventory', label: 'E' }, { id: 'console', label: '/' }];
    if (this.game.hud.overlays.size) top.push({ id: 'map', label: 'M' });
    top.forEach((t, i) => Object.assign(t, { x: W / 2 + (i - (top.length - 1) / 2) * (small + 10), y: 14 + small / 2, r: small / 2, small: true }));
    return { stick: { x: 24 + r, y: base - r, r }, buttons: buttons.concat(top) };
  }
  buttonAt(x, y) {
    for (const b of this.layout().buttons) if ((x - b.x) ** 2 + (y - b.y) ** 2 <= (b.r + 8) ** 2) return b;
    return null;
  }

  // ------------------------------------------------------------ pointer handling
  down(e) {
    this.enabled = true;
    const g = this.game, x = e.clientX, y = e.clientY;
    g.cursor = { x, y };
    if (!g.active) { this.pointers.set(e.pointerId, { kind: 'menu', time: performance.now() }); g.menu.hover(x, y); return; }
    const button = this.buttonAt(x, y);
    if (button) { this.pointers.set(e.pointerId, { kind: 'button', id: button.id }); this.press(button.id, true); return; }
    const hotbar = g.hud.hotbarIndexAt(x, y);
    if (hotbar >= 0) { g.select(hotbar); this.pointers.set(e.pointerId, { kind: 'none' }); return; }
    const L = this.layout();
    if (!this.stick.active && x < g.hud.width * .45 && y > g.hud.height * .35) {
      this.stick = { active: true, id: e.pointerId, cx: x, cy: y, x: 0, y: 0, r: L.stick.r };
      this.pointers.set(e.pointerId, { kind: 'stick' }); this.applyStick(); return;
    }
    this.pointers.set(e.pointerId, { kind: 'look', x, y, sx: x, sy: y, time: performance.now() });
  }
  move(e) {
    const p = this.pointers.get(e.pointerId); if (!p) return;
    const g = this.game;
    if (p.kind === 'menu') { g.cursor = { x: e.clientX, y: e.clientY }; g.menu.hover(e.clientX, e.clientY); return; }
    if (p.kind === 'stick') {
      const dx = e.clientX - this.stick.cx, dy = e.clientY - this.stick.cy, d = Math.hypot(dx, dy), r = this.stick.r;
      const k = d > r ? r / d : 1;
      this.stick.x = dx * k / r; this.stick.y = dy * k / r; this.applyStick(); return;
    }
    if (p.kind === 'look' && g.active && !g.mapInteraction) {
      const k = .0062 * g.options.sensitivity;
      g.yaw -= (e.clientX - p.x) * k; g.pitch -= (e.clientY - p.y) * k;
      g.pitch = BC.clamp(g.pitch, -Math.PI / 2 + .01, Math.PI / 2 - .01);
      p.x = e.clientX; p.y = e.clientY;
    }
  }
  up(e, cancelled) {
    const p = this.pointers.get(e.pointerId); if (!p) return;
    this.pointers.delete(e.pointerId);
    const g = this.game, x = e.clientX, y = e.clientY;
    if (p.kind === 'button') { this.press(p.id, false); return; }
    if (p.kind === 'stick') { this.stick.active = false; this.stick.x = this.stick.y = 0; this.applyStick(); return; }
    if (cancelled) return;
    if (p.kind === 'look' && g.mapInteraction && Math.hypot(x - p.sx, y - p.sy) < 12) {
      const cell = g.hud.overlayCell(x, y);
      if (cell) g.world.mods.event('ui.click', { ...cell, button: performance.now() - p.time > LONG_PRESS ? 'right' : 'left' });
      return;
    }
    if (p.kind !== 'menu' || g.active) return;
    // Menus: a tap acts on release; in inventories tap the item, then the target (long press = one item).
    const id = g.menu.click(x, y);
    this.fullscreen(id);
    if (DRAG_SCREENS.has(g.screen)) {
      if (g.inventoryDrag === null) g.inventoryDragOne = performance.now() - p.time > LONG_PRESS;
      g.dragDownId = null; g.menuAction(id);
    } else {
      const fraction = g.menu.sliderFraction(x, y);
      g.menuAction(id, fraction);
      if (id === 'network_address' || id === 'network_port') this.focusInput();
    }
    g.menu.hover(-1, -1);
  }
  press(id, pressed) {
    const g = this.game;
    if (pressed) this.pressed.add(id); else this.pressed.delete(id);
    switch (id) {
      case 'jump': g.flyUp = pressed; if (pressed) g.jump = true; break;
      case 'down': g.flyDown = pressed; break;
      case 'break':
        g.breakHeld = pressed;
        if (pressed) g.action('break'); else g.resetBreakProgress();
        break;
      case 'use': if (pressed) g.action('place'); break;
      case 'pause': if (pressed) g.back(); break;
      case 'inventory': if (pressed) g.keyDown({ code: 'KeyE', key: 'e', preventDefault() {} }); break;
      case 'map': if (pressed) g.keyDown({ code: 'KeyM', key: 'm', preventDefault() {} }); break;
      case 'console':
        if (!pressed) break;
        if (g.commandOpen) g.keyDown({ code: 'Escape', key: 'Escape', preventDefault() {} });
        else { g.keyDown({ code: 'F3', key: 'F3', preventDefault() {} }); this.focusInput(); }
        break;
      default: break;
    }
  }
  applyStick() {
    const g = this.game, s = this.stick, dead = .25;
    g.movement[0] = s.y < -dead; g.movement[1] = s.y > dead; g.movement[2] = s.x < -dead; g.movement[3] = s.x > dead;
    g.analogMove = s.active ? { x: s.x, y: s.y } : null;
  }
  reset() {
    for (const id of Array.from(this.pressed)) this.press(id, false);
    this.pointers.clear(); this.stick = { x: 0, y: 0, active: false, cx: 0, cy: 0 }; this.game.analogMove = null;
  }
  fullscreen(id) {
    if (!this.enabled || document.fullscreenElement || !id || !/^(world[1-5]|confirm_world_name|network_start)$/.test(id)) return;
    const el = document.documentElement;
    try {
      const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
      if (r && r.then) r.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* unsupported */ } }).catch(() => {});
    } catch (e) { /* unsupported */ }
  }

  // ------------------------------------------------------------ on-screen keyboard
  field() {
    const g = this.game;
    if (g.creatingWorldName) return { get: () => g.worldNameBuffer, set: v => { g.worldNameBuffer = [...v].filter(c => BC.CubeFont.supports(c)).join('').slice(0, 32); g.show('CREATE_WORLD'); } };
    if (g.commandOpen) return { get: () => g.commandBuffer, set: v => { g.commandBuffer = v.slice(0, 120); g.hud.command = '> ' + g.commandBuffer + '_'; } };
    if (g.screen === 'MULTIPLAYER' || g.screen === 'OPEN_NETWORK') {
      const key = g.addressFocused ? 'networkAddress' : 'networkPort';
      return { get: () => g[key], set: v => { g[key] = g.addressFocused ? v.replace(/[^\x21-\x7e]/g, '').slice(0, 64) : v.replace(/\D/g, '').slice(0, 5); g.message = ''; g.show(g.screen); } };
    }
    return null;
  }
  focusInput() {
    if (!this.enabled || !this.field()) return;
    this.syncInput();
    try { this.input.focus({ preventScroll: true }); } catch (e) { this.input.focus(); }
  }
  syncInput() { const f = this.field(); if (f) this.input.value = f.get(); else this.input.blur(); }
  typed() { const f = this.field(); if (f) { f.set(this.input.value); this.input.value = f.get(); } }

  // ------------------------------------------------------------ drawing
  draw(g) {
    if (!this.enabled || !this.game.active) return;
    const L = this.layout();
    g.save();
    const s = this.stick.active ? { x: this.stick.cx, y: this.stick.cy, r: this.stick.r } : L.stick;
    g.globalAlpha = this.stick.active ? .55 : .3;
    circle(g, s.x, s.y, s.r, 'rgba(10,16,20,.6)', 'rgba(255,255,255,.55)');
    circle(g, s.x + this.stick.x * s.r, s.y + this.stick.y * s.r, s.r * .42, 'rgba(230,236,240,.75)', null);
    for (const b of L.buttons) {
      g.globalAlpha = this.pressed.has(b.id) ? .8 : .45;
      circle(g, b.x, b.y, b.r, this.pressed.has(b.id) ? 'rgba(230,166,66,.75)' : 'rgba(10,16,20,.65)', 'rgba(255,255,255,.5)');
      const label = BC.CubeFont.render(b.label, b.small ? 13 : b.label.length > 2 ? 16 : 22);
      g.globalAlpha = .95; g.drawImage(label, Math.round(b.x - label.width / 2), Math.round(b.y - label.height / 2));
    }
    g.restore();
  }
}
function circle(g, x, y, r, fill, stroke) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = 2; g.strokeStyle = stroke; g.stroke(); }
}
BC.TouchControls = TouchControls;
})();
