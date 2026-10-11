/* Barnocraft WEB — menu screens and HUD drawn on a 2D canvas with the cube font.
 * Layouts use the Java edition's coordinates: menu origin at the screen centre, y up. */
(function () {
'use strict';
const BC = globalThis.BC;
const rgba = (r, g, b, a = 1) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const C = {
  NORMAL: rgba(.13, .20, .24), HOVER_LIGHTEN: .11, PANEL: rgba(.035, .065, .09, .97), ACCENT: rgba(.91, .66, .26),
  WHITE: '#ffffff', SUB: hex(.7, .8, .82), WARN: hex(1, .76, .48), GREEN: rgba(.32, .39, .25), RED: rgba(.40, .17, .14)
};
BC.UIColors = C;

function lighten(color, amount) {
  const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(color); if (!m) return color;
  const f = v => Math.min(255, Math.round(+v + amount * 255));
  return `rgba(${f(m[1])},${f(m[2])},${f(m[3])},${m[4]})`;
}
function durabilityColor(f) { return f > .5 ? rgba(.34, .78, .34) : f > .2 ? rgba(.91, .68, .22) : rgba(.88, .28, .22); }

class Menu {
  constructor() {
    this.items = []; this.hits = []; this.visible = false; this.backdrop = .91; this.hovered = null;
    this.loadingClock = 0; this.loadingBar = false; this.tooltipItems = new Map(); this.furnaceProgress = null;
    this.width = 1280; this.height = 720; this.scale = 1;
  }
  clear(backdrop = .91) { this.items = []; this.hits = []; this.visible = true; this.backdrop = backdrop; this.loadingBar = false; this.tooltipItems.clear(); this.furnaceProgress = null; }
  hide() { this.visible = false; }
  rect(w, h, color, x, y) { this.items.push({ t: 'rect', w, h, color, x, y }); }
  text(value, size, x, y, color = C.WHITE, align = 'center') { this.items.push({ t: 'text', value: String(value), size, x, y, color, align }); }
  hit(id, x, y, w, h, color, label) {
    const hit = { id, x, y, w, h, color, label };
    if (color) this.items.push({ t: 'button', hit }); this.hits.push(hit); return hit;
  }
  button(id, label, x, y, w, h, color = C.NORMAL, size = 13) { this.hit(id, x, y, w, h, color); this.text(label, size, x + w / 2, y + h / 2 - BC.CubeFont.height(size) / 2); }
  wrapped(message, size, y, perLine, lines = 3, color = C.WARN) {
    if (!message) return;
    for (let line = 0; line < lines && line * perLine < message.length; line++)
      this.text(message.substring(line * perLine, (line + 1) * perLine), size, 0, y - line * (size + 3), color);
  }
  card(w, h, accentY) { this.rect(w, h, C.PANEL, -w / 2, -h / 2); if (accentY !== undefined) this.rect(64, 4, C.ACCENT, -32, accentY); }

  // ------------------------------------------------------------ screens
  show(title, subtitle, buttons, message) {
    this.clear(); this.card(500, 600, 228);
    this.text(title, 32, 0, 180); this.text(subtitle, 16, 0, 146, C.SUB);
    let y = 86;
    for (const b of buttons) { this.hit(b.id, -200, y, 400, 44, C.NORMAL); this.text(b.label, 20, 0, y + 9); y -= 54; }
    this.wrapped(message, 15, -246, 46);
  }
  showLoading(title) {
    this.clear(.08);
    this.text('Barnocraft WEB', 32, 0, 270);
    this.rect(620, 92, rgba(.025, .045, .06, .84), -310, -304);
    this.text(title, 20, 0, -245); this.text('Лес и пустыня · блоки, существа и реки', 13, 0, -272, hex(.76, .86, .91));
    this.rect(560, 4, rgba(.12, .2, .24), -280, -288);
    this.loadingBar = true;
  }
  showNetwork(hosting, address, port, addressFocused, skin, connecting, message, relayHint, portLabel = 'Порт') {
    this.clear(); this.card(640, 600);
    this.text(hosting ? 'Открыть для сети' : 'Мультиплеер', 28, 0, 245);
    this.text(hosting ? 'Друзья подключаются к серверу Barnocraft WEB' : 'Подключение к миру друга', 15, 0, 210, C.SUB);
    if (!hosting) this.networkField('network_address', 'Адрес: ' + address + (addressFocused ? '_' : ''), -270, 143, 540, 38, addressFocused);
    else this.text('WebSocket · до 8 игроков · мир хранится у хозяина', 14, 0, 155);
    this.networkField('network_port', portLabel + ': ' + port + (!addressFocused ? '_' : ''), -160, 93, 320, 38, !addressFocused);
    if (relayHint) this.text(relayHint, 11, 0, 70, C.SUB);
    for (let i = 0; i < 2; i++) {
      this.items.push({ t: 'player', skin: i, x: i === 0 ? -125 : 125, y: -113 });
      this.networkField('network_skin_' + i, (skin === i ? '> ' : '') + (i === 0 ? 'Саня' : 'Ваня'), i === 0 ? -220 : 30, -164, 190, 38, skin === i);
    }
    this.hit('network_start', -270, -232, 300, 44, rgba(.32, .43, .27));
    this.text(connecting ? 'Подключение...' : hosting ? 'Открыть мир' : 'Подключиться', 18, -120, -232 + 13);
    this.hit('back', 50, -232, 220, 44, C.NORMAL); this.text(connecting ? 'Отмена' : 'Назад', 18, 160, -232 + 13);
    this.wrapped(message, 13, -260, 70);
  }
  networkField(id, label, x, y, w, h, focused) {
    this.hit(id, x, y, w, h, focused ? rgba(.24, .36, .37) : C.NORMAL);
    this.text(label, 18, x + w / 2, y + (h - 18) / 2);
  }
  showWorlds(slots, message) {
    this.clear(); this.card(640, 600, 260);
    this.text('Миры', 30, 0, 210); this.text('Пять сохранений', 15, 0, 178, C.SUB);
    for (let slot = 1; slot <= 5; slot++) {
      const y = 124 - (slot - 1) * 58, info = slots[slot];
      const label = slot + ': ' + (info ? info.name : 'Пустой слот');
      this.hit('world' + slot, -250, y, 420, 44, C.NORMAL);
      this.text(label, 17, -232, y + 13, C.WHITE, 'left'); // fixed: the Java label overflowed the card
      if (info) {
        this.hit('export_world_' + slot, 180, y, 46, 44, rgba(.18, .30, .36)); this.text('↓', 22, 203, y + 8);
        this.hit('delete_world_' + slot, 232, y, 46, 44, C.RED); this.text('×', 24, 255, y + 8);
      }
    }
    this.hit('create_world', -280, -210, 190, 42, C.GREEN); this.text('Создать мир', 15, -185, -197);
    this.hit('import_world', -80, -210, 170, 42, rgba(.18, .30, .36)); this.text('Импорт', 15, 5, -197);
    this.hit('back', 100, -210, 180, 42, C.NORMAL); this.text('Назад', 17, 190, -198);
    this.text('↓ — экспорт сохранения в файл · × — удалить', 11, 0, -236, C.SUB);
    if (message) this.text(message, 13, 0, -262, C.WARN);
  }
  showMods(mods, message) {
    this.clear(); this.card(640, 600, 260);
    this.text('Моды', 30, 0, 210); this.text('Загружаются при входе в мир · Python Mod API v2 · Pyodide', 13, 0, 178, C.SUB);
    if (!mods.length) this.text('Моды не найдены', 17, 0, 70, hex(.83, .86, .82));
    const shown = Math.min(mods.length, 7);
    for (let i = 0; i < shown; i++) {
      const mod = mods[i], y = 132 - i * 50;
      this.hit('mod_toggle:' + mod.key, -290, y - 20, 470, 44, rgba(.08, .12, .15));
      this.text(mod.name, 17, -280, y + 7, C.WHITE, 'left');
      this.text(mod.id + '  ·  v' + mod.version + '  ·  API ' + mod.api + '  ·  ' + mod.entry + (mod.builtIn ? '  ·  встроенный' : ''), 11, -280, y - 12, hex(.68, .77, .79), 'left');
      const state = mod.error ? 'ОШИБКА' : mod.enabled ? 'ВКЛ' : 'ВЫКЛ';
      this.text(state, 12, 150, y + 1, mod.error ? hex(1, .58, .45) : mod.enabled ? hex(.42, .78, .48) : hex(.72, .72, .68));
      if (!mod.builtIn) { this.hit('mod_remove:' + mod.key, 190, y - 20, 44, 44, C.RED); this.text('×', 22, 212, y - 8); }
      if (mod.error) this.text(mod.error.substring(0, 80), 10, 0, y - 28, hex(1, .58, .45));
    }
    if (mods.length > shown) this.text('И ещё модов: ' + (mods.length - shown), 13, 0, -208, C.SUB);
    this.hit('mod_add_folder', -280, -255, 200, 40, C.GREEN); this.text('Папка с модом', 14, -180, -243);
    this.hit('mod_add_file', -70, -255, 150, 40, C.GREEN); this.text('Файл .py', 14, 5, -243);
    this.hit('back', 90, -255, 190, 40, C.NORMAL); this.text('Назад', 17, 185, -244);
    this.text('Нажмите на мод, чтобы включить или выключить его', 11, 0, -222, C.SUB);
    if (message) this.text(message, 12, 0, -278, C.WARN);
  }
  showDeleteWorld(name, message) {
    this.clear(); this.card(500, 360, 128);
    this.text('Удалить мир?', 28, 0, 84); this.text(name, 18, 0, 34, hex(.78, .83, .82));
    this.hit('confirm_delete_world', -200, -62, 190, 44, rgba(.48, .17, .14)); this.text('Удалить', 17, -105, -49);
    this.hit('cancel_delete_world', 10, -62, 190, 44, C.NORMAL); this.text('Отмена', 17, 105, -49);
    if (message) this.text(message, 14, 0, -125, C.WARN);
  }
  showSliders(title, subtitle, sliders, buttons, message) {
    this.clear(); this.card(500, 600, 228);
    this.text(title, 32, 0, 180); this.text(subtitle, 16, 0, 146, C.SUB);
    let y = 86;
    for (const s of sliders) {
      this.text(s.label + ': ' + s.value, 17, 0, y + 19);
      this.rect(360, 6, rgba(.20, .30, .32), -180, y - 5);
      // Fixed: the knob shows the current value (it was always centred in the Java edition).
      this.rect(80, 10, rgba(.83, .60, .22), -180 + s.fraction * 280, y - 7);
      this.hits.push({ id: s.id, x: -200, y: y - 18, w: 400, h: 42, slider: true });
      y -= 64;
    }
    for (const b of buttons) { this.hit(b.id, -200, y, 400, 44, C.NORMAL); this.text(b.label, 20, 0, y + 9); y -= 54; }
    this.wrapped(message, 13, -262, 50);
  }
  showCreateWorld(name, message) {
    this.clear(); this.card(500, 360, 128);
    this.text('Новый мир', 28, 0, 88); this.text('Имя', 16, 0, 38, hex(.75, .83, .82));
    this.rect(400, 48, C.NORMAL, -200, -18);
    this.text((name || 'Введите имя') + '_', 19, 0, -1);
    this.hit('confirm_world_name', -200, -92, 190, 42, C.GREEN); this.text('Создать', 17, -105, -80);
    this.hit('cancel_world_name', 10, -92, 190, 42, C.NORMAL); this.text('Отмена', 17, 105, -80);
    if (message) this.text(message, 14, 0, -136, C.WARN);
  }
  beginPanel(title, subtitle, w, h) {
    this.clear();
    this.rect(w, h, rgba(.075, .085, .078, .98), -w / 2, -h / 2);
    this.rect(w - 20, 2, rgba(.40, .36, .25), -w / 2 + 10, h / 2 - 52);
    this.text(title, 25, 0, h / 2 - 35); this.text(subtitle, 13, 0, h / 2 - 72, hex(.75, .77, .70));
    this.text('E / Esc — закрыть', 12, 0, -h / 2 + 15, hex(.65, .69, .64));
  }
  panelSlot(id, slot, x, y, size, title) {
    this.hit(id, x, y, size, size, rgba(.25, .27, .24));
    this.rect(size - 4, size - 4, rgba(.10, .115, .105), x + 2, y + 2);
    this.drawSlot(slot, x, y, size);
    const label = title || (slot && slot.item ? BC.item(slot.item).title : '');
    if (label) this.tooltipItems.set(id, label);
  }
  drawSlot(slot, x, y, size) {
    if (!slot || !slot.item) return;
    const item = BC.item(slot.item), icon = size - 12;
    this.items.push({ t: 'icon', texture: item.texture, x: x + (size - icon) / 2, y: y + (size - icon) / 2, size: icon });
    if (slot.count > 1) this.items.push({ t: 'text', value: String(slot.count), size: 12, x: x + size - 19, y: y + 5, color: C.WHITE, align: 'left' });
    if (item.tool()) {
      const f = slot.durability / item.maxDurability(), w = size - 12;
      this.rect(w, 3, rgba(.08, .08, .08), x + 6, y + 3); this.rect(w * f, 3, durabilityColor(f), x + 6, y + 3);
    }
  }
  playerStorage(inv, top, step) {
    const startX = -((4 * step) + 40) / 2;
    for (let i = 10; i < BC.Inventory.SLOT_COUNT; i++) {
      const local = i - 10; this.panelSlot('slot:' + i, inv.slotAtIndex(i), startX + (local % 5) * step, top - ((local / 5) | 0) * step, 40);
    }
  }
  hotbar(inv, y, step) {
    const startX = -((BC.Inventory.HOTBAR_SIZE - 1) * step + 40) / 2;
    for (let i = 0; i < BC.Inventory.HOTBAR_SIZE; i++) this.panelSlot('slot:' + i, inv.slotAtIndex(i), startX + i * step, y, 40);
  }
  showCreative(inv, page, selected) {
    const items = Menu.creativeItems(), pages = Math.max(1, Math.ceil(items.length / 40)); page = BC.floorMod(page, pages);
    this.beginPanel('Креатив', 'Выберите слот панели, затем предмет', 640, 600);
    for (let i = 0; i < 40 && page * 40 + i < items.length; i++) {
      const item = items[page * 40 + i];
      this.panelSlot('creative:' + item.id, BC.makeSlot(item.id, item.stackLimit()), -265 + (i % 10) * 54, 150 - ((i / 10) | 0) * 54, 46, item.title);
    }
    this.button('creative_prev', '<', -265, -92, 55, 28); this.button('creative_next', '>', 210, -92, 55, 28);
    this.text('Страница ' + (page + 1) + ' / ' + pages, 15, 0, -86);
    const held = inv.hotbarItemAt(selected);
    this.text('Слот ' + (selected + 1) + ' · ' + (held ? BC.item(held).title : 'Пусто'), 15, 0, -135);
    this.rect(46, 46, rgba(.9, .75, .35), -238 + selected * 48, -208);
    this.hotbar(inv, -205, 48);
    this.text('Пробел — вверх · Shift — вниз · gamemode 0 — выживание', 12, 0, -255);
  }
  showInventory(inv, message) {
    this.beginPanel('Инвентарь', 'Создание · 2 × 2', 640, 600);
    const size = 48, gap = 8;
    for (let i = 0; i < BC.Inventory.CRAFT_SIZE; i++) this.panelSlot('craft:' + i, inv.craftSlotAt(i), -250 + (i % 2) * (size + gap), 150 - ((i / 2) | 0) * (size + gap), size);
    this.text('→', 22, -92, 112, hex(.84, .85, .79));
    const result = inv.craftPreview();
    this.panelSlot('craft_result', result ? BC.makeSlot(result, inv.craftPreviewCount()) : null, -55, 105, 56, result ? 'Создать: ' + BC.item(result).title : 'Результат');
    if (message) this.text(message, 12, 110, 125, C.WARN, 'left');
    this.text('Инвентарь', 17, -245, 30, hex(.86, .79, .61), 'left');
    this.playerStorage(inv, -28, 48);
    this.text('Быстрая панель', 15, -245, -155, hex(.86, .79, .61), 'left');
    this.hotbar(inv, -205, 48);
    this.text('ЛКМ: взять / положить стопку · ПКМ: по одному предмету', 12, 0, -260, hex(.68, .76, .75));
  }
  showStonecutter(inv, machine, message) {
    this.beginPanel('Камнерез', 'Выберите заготовку', 640, 600);
    const recipes = ['AXE_HEAD', 'PICKAXE_HEAD', 'SHOVEL_HEAD', 'IRON_AXE_HEAD', 'IRON_PICKAXE_HEAD', 'IRON_SHOVEL_HEAD', 'GOLD_AXE_HEAD', 'GOLD_PICKAXE_HEAD', 'GOLD_SHOVEL_HEAD'];
    const labels = ['Топор', 'Кирка', 'Лопата', 'Жел. топор', 'Жел. кирка', 'Жел. лопата', 'Зол. топор', 'Зол. кирка', 'Зол. лопата'];
    recipes.forEach((r, i) => {
      const x = -270 + (i % 3) * 96, y = 145 - ((i / 3) | 0) * 34;
      this.button('recipe:' + r, labels[i], x, y, 88, 28, machine.recipe === r ? rgba(.53, .40, .19) : C.NORMAL, 12);
    });
    const material = BC.World.stonecutterMaterial(machine.recipe);
    this.panelSlot('machine:0', machine.coal, -135, 15, 52, 'Уголь');
    this.text('+', 17, -67, 31, hex(.8, .8, .74));
    this.panelSlot('machine:1', machine.stone, -40, 15, 52, BC.item(material).title + ' × ' + BC.World.stonecutterMaterialCount(machine.recipe));
    this.text('→', 19, 32, 31, hex(.8, .8, .74));
    this.panelSlot('machine:2', machine.output, 60, 15, 52, BC.item(machine.recipe).title);
    this.button('machine_craft', 'Изготовить', 160, 22, 112, 34, rgba(.37, .43, .27));
    this.text('Инвентарь', 16, -245, -54, hex(.86, .79, .61), 'left');
    this.playerStorage(inv, -78, 40);
    this.text('Быстрая панель', 14, -245, -167, hex(.86, .79, .61), 'left');
    this.hotbar(inv, -208, 40);
    if (message) this.text(message, 12, 0, -253, hex(1, .75, .45));
  }
  showFurnace(inv, furnace, progress, message) {
    this.beginPanel('Печь', 'Перетащите топливо и продукт в слоты · плавка идёт и при закрытой печи', 640, 600);
    this.panelSlot('furnace:0', furnace.coal, -145, 110, 56, 'Топливо');
    this.panelSlot('furnace:1', furnace.input, -20, 110, 56, 'Для готовки');
    this.panelSlot('furnace:2', furnace.output, 150, 110, 56, 'Готовый продукт');
    this.text('Топливо', 12, -117, 89, hex(.77, .80, .75)); this.text('Сырьё', 12, 8, 89, hex(.77, .80, .75)); this.text('Результат', 12, 178, 89, hex(.77, .80, .75));
    this.rect(92, 8, rgba(.13, .16, .15), 8, 78);
    this.furnaceProgress = { x: 8, y: 78, w: 92, h: 8, value: progress };
    this.items.push({ t: 'progress', ref: this.furnaceProgress });
    this.rect(40, 8, rgba(.18, .14, .11), -136, 74);
    this.rect(40, (furnace.coal.count > 0 ? 1 : .15) * 8, rgba(.94, .38, .13), -136, 74);
    this.text('Инвентарь', 16, -245, 34, hex(.86, .79, .61), 'left');
    this.playerStorage(inv, 10, 40);
    this.text('Быстрая панель', 14, -245, -138, hex(.86, .79, .61), 'left');
    this.hotbar(inv, -180, 40);
    if (message) this.text(message, 12, 0, -244, hex(1, .75, .45));
  }
  showChest(inv, chest) {
    this.beginPanel(chest.deathCache ? 'Сундук погибшего' : 'Сундук', chest.deathCache ? 'Заберите вещи; сундук исчезнет при закрытии' : 'Хранилище · 27 слотов', 640, 600);
    this.text('Содержимое', 15, -244, 156, hex(.86, .79, .61), 'left');
    for (let i = 0; i < 27; i++) this.panelSlot('chest:' + i, chest.slots[i], -220 + (i % 9) * 48, 100 - ((i / 9) | 0) * 48, 40);
    this.text('Инвентарь', 15, -244, -78, hex(.86, .79, .61), 'left');
    for (let i = 10; i < BC.Inventory.SLOT_COUNT; i++) { const l = i - 10; this.panelSlot('slot:' + i, inv.slotAtIndex(i), -120 + (l % 5) * 48, -125 - ((l / 5) | 0) * 46, 40); }
    this.text('Быстрая панель', 13, -244, -199, hex(.86, .79, .61), 'left'); // fixed: overlapped the hotbar
    for (let i = 0; i < BC.Inventory.HOTBAR_SIZE; i++) this.panelSlot('slot:' + i, inv.slotAtIndex(i), -220 + i * 48, -250, 40);
  }
  static creativeItems() { return BC.Items.values().filter(i => !i.retired()); }

  // ------------------------------------------------------------ input and drawing
  resize(w, h) { this.width = w; this.height = h; this.scale = Math.min(1, Math.min(w / 540, h / 640)); }
  toMenu(cx, cy) { return { x: (cx - this.width / 2) / this.scale, y: (this.height / 2 - cy) / this.scale }; }
  hitAt(cx, cy) {
    const p = this.toMenu(cx, cy);
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return { hit: h, fraction: BC.clamp((p.x - h.x - 20) / (h.w - 40), 0, 1) };
    }
    return null;
  }
  click(cx, cy) { const r = this.hitAt(cx, cy); return r ? r.hit.id : null; }
  sliderFraction(cx, cy) { const r = this.hitAt(cx, cy); return r && r.hit.slider ? r.fraction : null; }
  hover(cx, cy) { const r = this.hitAt(cx, cy); this.hovered = r ? r.hit.id : null; this.cursor = { x: cx, y: cy }; }
  update(dt) { this.loadingClock += dt; }
  draw(g, dragIcon) {
    if (!this.visible) return;
    const s = this.scale, ox = this.width / 2, oy = this.height / 2;
    g.fillStyle = rgba(.025, .05, .075, this.backdrop); g.fillRect(0, 0, this.width, this.height);
    const X = x => ox + x * s, Y = (y, h) => oy - (y + h) * s;
    for (const it of this.items) {
      if (it.t === 'rect') { g.fillStyle = it.color; g.fillRect(X(it.x), Y(it.y, it.h), it.w * s, it.h * s); }
      else if (it.t === 'button') {
        const h = it.hit; g.fillStyle = this.hovered === h.id ? lighten(h.color, C.HOVER_LIGHTEN) : h.color;
        g.fillRect(X(h.x), Y(h.y, h.h), h.w * s, h.h * s);
      } else if (it.t === 'text') {
        const img = BC.CubeFont.render(it.value, it.size, it.color);
        const x = it.align === 'left' ? it.x : it.x - img.width / 2;
        g.drawImage(img, Math.round(X(x)), Math.round(Y(it.y, img.height)), img.width * s, img.height * s);
      } else if (it.t === 'icon') {
        g.drawImage(BC.Textures.icon(it.texture, 64), X(it.x), Y(it.y, it.size), it.size * s, it.size * s);
      } else if (it.t === 'progress') {
        const r = it.ref; g.fillStyle = rgba(.87, .56, .20);
        g.fillRect(X(r.x), Y(r.y, r.h), r.w * BC.clamp(r.value, 0, 1) * s, r.h * s);
      } else if (it.t === 'player') drawPlayer(g, X(it.x), Y(it.y, 0), it.skin, s);
    }
    if (this.loadingBar) {
      const x = -280 + (.5 + .5 * Math.sin(this.loadingClock * 1.4)) * 440;
      g.fillStyle = rgba(.91, .73, .35); g.fillRect(X(x), Y(-288, 4), 120 * s, 4 * s);
    }
    const tip = this.hovered && this.tooltipItems.get(this.hovered);
    if (tip && this.cursor) {
      const img = BC.CubeFont.render(tip, 13);
      const tx = Math.min(this.width - img.width - 6, this.cursor.x + 14), ty = this.cursor.y + 16;
      g.fillStyle = 'rgba(8,12,14,.92)'; g.fillRect(tx - 4, ty - 2, img.width + 8, img.height + 4); g.drawImage(img, tx, ty);
    }
    if (dragIcon && this.cursor) g.drawImage(BC.Textures.icon(dragIcon, 64), this.cursor.x - 16, this.cursor.y - 16, 32, 32);
  }
}
function wrapText(text, width) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines.map(l => l.substring(0, width));
}
/** Front view of the two characters (the Java edition used 3D models in this menu). */
function drawPlayer(g, cx, baseY, skin, s) {
  const k = 82 * s, flesh = skin === 0 ? '#e5b18c' : '#d29a73', shirt = skin === 0 ? '#388bab' : '#b34b3d',
    pants = skin === 0 ? '#273e65' : '#354733', hair = skin === 0 ? '#6b422c' : '#322a26';
  const box = (color, x, y, w, h) => { g.fillStyle = color; g.fillRect(cx + (x - w / 2) * k, baseY - (y + h / 2) * k, w * k, h * k); };
  box('#302f2d', -.125, .08, .23, .16); box('#302f2d', .125, .08, .23, .16);
  box(pants, -.125, .47, .22, .61); box(pants, .125, .47, .22, .61);
  box(shirt, 0, 1.055, .48, .61); box('#433b32', 0, .77, .49, .07); box('#e9dbb8', 0, 1.335, .18, .08);
  if (skin === 0) box('#e2d7b5', 0, 1.08, .49, .10); else box('#d07b58', .12, 1.16, .12, .14);
  for (const x of [-.35, .35]) { box(shirt, x, 1.19, .20, .30); box(flesh, x, .89, .18, .32); }
  box(flesh, 0, 1.575, .45, .45); box(hair, 0, 1.76, .47, .14);
  box(hair, skin === 0 ? .12 : 0, 1.685, skin === 0 ? .21 : .45, .08);
  for (const x of [-.108, .108]) { box('#ffffff', x, 1.58, .082, .065); box(skin === 0 ? '#3a634f' : '#3d5169', x, 1.577, .035, .052); box(hair, x, 1.64, .095, .025); }
  box('#86594b', 0, 1.438, .10, .022);
  if (skin === 1) { box(hair, 0, 1.40, .26, .075); box(hair, 0, 1.461, .16, .025); }
  else { box('#ae7050', -.16, 1.504, .032, .021); box('#ae7050', .16, 1.504, .032, .021); }
}
BC.Menu = Menu;

// ---------------------------------------------------------------- HUD
class Hud {
  constructor() {
    this.selected = 1; this.notice = ''; this.noticeTime = 0; this.damage = 0; this.command = '';
    this.vitals = { health: 20, hunger: 20, creative: false }; this.overlays = new Map(); this.active = false; this.hint = '';
    this.width = 1280; this.height = 720;
  }
  notify(text) { this.notice = text; this.noticeTime = 4; }
  damageFlash() { this.damage = .32; }
  update(dt) { this.noticeTime = Math.max(0, this.noticeTime - dt); this.damage = Math.max(0, this.damage - dt); }
  resize(w, h) { this.width = w; this.height = h; }
  barGeometry() {
    const barWidth = BC.HOTBAR_SIZE * 48 + 10, scale = Math.min(1, this.width / (barWidth + 20));
    return { barWidth, scale, left: this.width / 2 - barWidth / 2 * scale, slotStart: -barWidth / 2 + 6 };
  }
  /** Index of the hotbar slot under a screen point, or -1. */
  hotbarIndexAt(cx, cy) {
    const { scale, slotStart } = this.barGeometry();
    const x = (cx - this.width / 2) / scale, y = (this.height - 16 - cy) / scale;
    if (y < 4 || y > 52) return -1;
    const i = Math.floor((x - slotStart) / 48);
    return i >= 0 && i < BC.HOTBAR_SIZE ? i : -1;
  }
  overlayCell(cx, cy) {
    let top = 245 - 180; // the first overlay starts 245 px below the top edge in the Java layout
    for (const [id, data] of this.overlays) {
      const extra = 14 * Math.max(0, wrapText(String(data.title || 'Mod'), 31).length - 1);
      const x = cx - (this.width - 210), y = cy - top;
      if (x >= 0 && x < 180 && y >= 0 && y < 180) {
        const rows = data.pixels.length, cols = data.pixels[0].length;
        return { id, x: Math.min(cols - 1, (x / 180 * cols) | 0), y: Math.min(rows - 1, (y / 180 * rows) | 0) };
      }
      top += 220 + extra;
    }
    return null;
  }
  draw(g, inventory) {
    const W = this.width, H = this.height;
    if (this.damage > 0) { g.fillStyle = `rgba(255,20,20,${.24 * this.damage / .32})`; g.fillRect(0, 0, W, H); }
    // Mod overlays (top right); long titles wrap instead of running off the screen.
    let top = 245 - 180;
    for (const data of this.overlays.values()) {
      if (!data.canvas) data.canvas = BC.Textures.pixelCanvas(data.pixels);
      const lines = wrapText(String(data.title || 'Mod'), 31);
      g.fillStyle = 'rgba(8,13,18,.9)'; g.fillRect(W - 216, top - 6 - lines.length * 14, 192, 192 + lines.length * 14);
      g.imageSmoothingEnabled = false; g.drawImage(data.canvas, W - 210, top, 180, 180);
      lines.forEach((line, i) => g.drawImage(BC.CubeFont.render(line, 12), W - 212, top - 4 - (lines.length - i) * 14));
      top += 220 + 14 * Math.max(0, lines.length - 1);
    }
    // Vitals
    const text = this.vitals.creative ? 'Креатив · Полёт' : '♥ ' + this.vitals.health + '/' + BC.Player.MAX_HEALTH + '   Голод ' + this.vitals.hunger + '/' + BC.Player.MAX_HUNGER;
    const warn = !this.vitals.creative && (this.vitals.health <= 6 || this.vitals.hunger <= 4);
    g.fillStyle = 'rgba(5,6,8,.72)'; g.fillRect(14, 10, 268, 30);
    g.drawImage(BC.CubeFont.render(text, 13, warn ? '#ff6e57' : '#ffd1b0'), 22, 15);
    // Command line
    if (this.command) {
      const img = BC.CubeFont.render(this.command, 16);
      g.fillStyle = 'rgba(5,6,8,.88)'; g.fillRect(16, 48, img.width + 20, 30); g.drawImage(img, 26, 53);
    }
    // Crosshair
    if (this.active) { g.fillStyle = '#fff'; g.fillRect(W / 2 - 1, H / 2 - 7, 2, 14); g.fillRect(W / 2 - 7, H / 2 - 1, 14, 2); }
    // Hotbar
    const { barWidth, scale, slotStart } = this.barGeometry();
    g.save(); g.translate(W / 2, H - 16); g.scale(scale, scale);
    const Y = (y, h) => -(y + h);
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(-barWidth / 2, Y(0, 56), barWidth, 56);
    g.fillStyle = '#fff'; g.fillRect(slotStart + this.selected * 48, Y(6, 44), 44, 44);
    for (let i = 0; i < BC.HOTBAR_SIZE; i++) {
      const x = slotStart + i * 48, slot = inventory.slotAtIndex(i);
      g.fillStyle = '#333'; g.fillRect(x + 2, Y(8, 40), 40, 40);
      if (slot && slot.item) {
        const item = BC.item(slot.item);
        g.drawImage(BC.Textures.icon(item.texture, 64), x + 6, Y(12, 32), 32, 32);
        if (slot.count > 1) g.drawImage(BC.CubeFont.render(String(slot.count), 12), x + 24, Y(9, 16));
        if (item.tool()) {
          const f = slot.durability / item.maxDurability();
          g.fillStyle = '#141414'; g.fillRect(x + 4, Y(4, 3), 32, 3); g.fillStyle = durabilityColor(f); g.fillRect(x + 4, Y(4, 3), 32 * Math.max(.01, f), 3);
        }
      }
    }
    const held = inventory.slotAtIndex(this.selected), label = (this.selected + 1) + ' — ' + (held && held.item ? BC.item(held.item).title : 'Пусто');
    const img = BC.CubeFont.render(label, 20); g.drawImage(img, -img.width / 2, Y(62, img.height));
    g.restore();
    // Notice
    if (this.noticeTime > 0 && this.notice) {
      const n = BC.CubeFont.render(this.notice, 17); g.drawImage(n, W / 2 - n.width / 2, H - 110 - n.height);
    }
    if (this.hint) {
      const n = BC.CubeFont.render(this.hint, 17);
      g.fillStyle = 'rgba(5,8,10,.7)'; g.fillRect(W / 2 - n.width / 2 - 12, H / 2 + 30, n.width + 24, n.height + 12);
      g.drawImage(n, W / 2 - n.width / 2, H / 2 + 36);
    }
  }
}
BC.Hud = Hud;
})();
