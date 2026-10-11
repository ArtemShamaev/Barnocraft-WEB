/* Barnocraft WEB — survival inventory: 20 slots (10 hotbar), 2×2 crafting grid, stacks and durability. */
(function () {
'use strict';
const BC = globalThis.BC;
const B = BC.B;
const SLOT_COUNT = 20, HOTBAR_SIZE = 10, CRAFT_SIZE = 4;
const EMPTY = Object.freeze({ item: null, count: 0, durability: 0 });

const limit = id => BC.item(id).stackLimit();
const isTool = id => BC.item(id).tool();
function makeSlot(item, count, durability) {
  if (!item || count <= 0) return EMPTY;
  const it = BC.item(item);
  if (durability === undefined) durability = it.tool() && count === 1 ? it.maxDurability() : 0;
  return { item, count, durability };
}
BC.makeSlot = makeSlot;
BC.EMPTY_SLOT = EMPTY;
function validSlot(s) {
  if (!s || typeof s !== 'object') return false;
  if (s.item === null || s.item === undefined) return s.count === 0 && (s.durability || 0) === 0;
  if (typeof s.item !== 'string' || !Number.isInteger(s.count) || s.count < 1) return false;
  const it = BC.item(s.item);
  if (s.count > (it.tool() ? 1 : BC.MAX_STACK)) return false;
  const d = s.durability || 0;
  return Number.isInteger(d) && d >= 0 && d <= it.maxDurability();
}
BC.validSlot = validSlot;
function restoreSlot(s) {
  if (!validSlot(s)) throw new Error('Некорректный слот инвентаря');
  if (!s.item) return EMPTY;
  // Retired workshop items become iron ingots, as in the Java edition.
  if (BC.item(s.item).retired()) return makeSlot('IRON_INGOT', s.count);
  return { item: s.item, count: s.count, durability: s.durability || 0 };
}
BC.restoreSlot = restoreSlot;

class Inventory {
  constructor() {
    this.slots = new Array(SLOT_COUNT).fill(EMPTY);
    this.craft = new Array(CRAFT_SIZE).fill(EMPTY);
    this.creative = false;
  }
  setCreative(v) { this.creative = !!v; }
  creativePick(index, item) {
    if (!this.creative || index < 0 || index >= HOTBAR_SIZE || !item || BC.item(item).retired()) return;
    this.slots[index] = makeSlot(item, limit(item));
  }
  snapshot() { return { slots: this.slots.map(s => ({ ...s })), craft: this.craft.map(s => ({ ...s })) }; }
  restore(snapshot) {
    if (!snapshot) snapshot = Inventory.emptySnapshot();
    if (!Array.isArray(snapshot.slots) || snapshot.slots.length !== SLOT_COUNT
        || !Array.isArray(snapshot.craft) || snapshot.craft.length !== CRAFT_SIZE) throw new Error('Некорректный размер инвентаря');
    const slots = snapshot.slots.map(restoreSlot), craft = snapshot.craft.map(restoreSlot);
    this.slots = slots; this.craft = craft;
  }
  static emptySnapshot() { return { slots: new Array(SLOT_COUNT).fill(EMPTY), craft: new Array(CRAFT_SIZE).fill(EMPTY) }; }
  count(type) { let total = 0; for (const s of this.slots) if (s.item === type) total += s.count; return total; }
  countAt(i) { return i >= 0 && i < SLOT_COUNT ? this.slots[i].count : 0; }
  slotAtIndex(i) { return i >= 0 && i < SLOT_COUNT ? this.slots[i] : null; }
  itemAt(i) { return i >= 0 && i < SLOT_COUNT ? this.slots[i].item : null; }
  hotbarItemAt(i) { return i >= 0 && i < HOTBAR_SIZE ? this.slots[i].item : null; }
  durabilityAt(i) { const s = this.slotAtIndex(i); return s ? s.durability : 0; }
  craftSlotAt(i) { return i >= 0 && i < CRAFT_SIZE ? this.craft[i] : null; }
  consumeAt(i, expected) {
    if (i < 0 || i >= SLOT_COUNT) return false;
    const s = this.slots[i];
    if (!expected || s.item !== expected || s.count === 0) return false;
    if (this.creative) return true;
    this.slots[i] = s.count === 1 ? EMPTY : { ...s, count: s.count - 1 };
    return true;
  }
  /** Drop a whole stack (with its durability) into one slot; merges within the stack limit. */
  acceptSlotAt(i, source) {
    if (i < 0 || i >= SLOT_COUNT || !source || !source.item) return false;
    const current = this.slots[i];
    if (!current.item) { this.slots[i] = { ...source }; return true; }
    if (current.item !== source.item || current.count + source.count > limit(source.item)) return false;
    this.slots[i] = { ...current, count: current.count + source.count }; return true;
  }
  replaceAt(i, expected, replacement) {
    if (i < 0 || i >= SLOT_COUNT || this.slots[i].item !== expected) return false;
    this.slots[i] = makeSlot(replacement, 1); return true;
  }
  damageToolAt(i) {
    if (this.creative || i < 0 || i >= SLOT_COUNT) return false;
    const s = this.slots[i];
    if (!s.item || !isTool(s.item) || s.durability === 0) return false;
    this.slots[i] = s.durability - 1 === 0 ? EMPTY : { ...s, durability: s.durability - 1 };
    return true;
  }
  acceptAt(i, item) {
    if (i < 0 || i >= SLOT_COUNT || !item) return false;
    const s = this.slots[i];
    if ((s.item && s.item !== item) || s.count >= limit(item)) return false;
    this.slots[i] = s.item ? { ...s, count: s.count + 1 } : makeSlot(item, 1);
    return true;
  }
  /** Move up to `count` items into slot i; returns how many fit. Tools keep their durability. */
  insertAt(i, item, count, durability) {
    if (i < 0 || i >= SLOT_COUNT || !item || count <= 0) return 0;
    const s = this.slots[i];
    if (!s.item) { const n = Math.min(count, limit(item)); this.slots[i] = makeSlot(item, n, isTool(item) ? durability : 0); return n; }
    if (s.item !== item || isTool(item)) return 0;
    const n = Math.min(count, limit(item) - s.count);
    if (n <= 0) return 0;
    this.slots[i] = { ...s, count: s.count + n }; return n;
  }
  removeAt(i, n) {
    const s = this.slots[i];
    if (!s || !s.item || n <= 0) return;
    this.slots[i] = s.count <= n ? EMPTY : { ...s, count: s.count - n };
  }
  /** Add items anywhere, respecting each item's stack limit; returns the leftover count. */
  add(type, amount = 1) {
    if (!type || amount <= 0) return 0;
    let remaining = amount; const lim = limit(type);
    if (!isTool(type)) for (let i = 0; i < SLOT_COUNT && remaining > 0; i++) {
      const s = this.slots[i];
      if (s.item === type && s.count < lim) { const n = Math.min(lim - s.count, remaining); this.slots[i] = { ...s, count: s.count + n }; remaining -= n; }
    }
    for (let i = 0; i < SLOT_COUNT && remaining > 0; i++) if (!this.slots[i].item) {
      const n = Math.min(lim, remaining); this.slots[i] = makeSlot(type, n); remaining -= n;
    }
    return remaining;
  }
  /** Add a stack preserving tool durability; returns the leftover count. */
  addStack(item, count, durability) {
    if (!item || count <= 0) return 0;
    if (!isTool(item)) return this.add(item, count);
    for (let i = 0; i < SLOT_COUNT; i++) if (!this.slots[i].item) { this.slots[i] = makeSlot(item, 1, durability); return count - 1; }
    return count;
  }
  canAdd(type, amount) {
    let capacity = 0; const lim = limit(type), tool = isTool(type);
    for (const s of this.slots) capacity += !tool && s.item === type ? lim - s.count : !s.item ? lim : 0;
    return capacity >= amount;
  }
  addBlock(block, amount = 1) {
    if (block === B.LEAVES) {
      if (Math.random() < .10) this.add('STICK', 1);
      if (Math.random() < .16) this.add('WHEAT_SEEDS', 1);
      return 0;
    }
    const item = BC.blockItem(block);
    return item ? this.add(item, amount) : amount;
  }
  take(type, amount) {
    if (!type || amount <= 0 || this.count(type) < amount) return false;
    let remaining = amount;
    for (let i = 0; i < SLOT_COUNT && remaining > 0; i++) {
      const s = this.slots[i]; if (s.item !== type) continue;
      const n = Math.min(s.count, remaining);
      this.slots[i] = n === s.count ? EMPTY : { ...s, count: s.count - n };
      remaining -= n;
    }
    return true;
  }
  has(type) { return this.count(type) > 0; }

  // ------------------------------------------------------------ crafting
  matchingModRecipe() {
    for (const recipe of BC.Items.craftRecipes()) {
      const present = new Map(); let occupied = 0;
      for (const s of this.craft) if (s.item) { occupied++; present.set(s.item, (present.get(s.item) || 0) + s.count); }
      if (occupied !== recipe.ingredients.size || present.size !== recipe.ingredients.size) continue;
      let equal = true;
      for (const [k, v] of recipe.ingredients) if (present.get(k) !== v) { equal = false; break; }
      if (equal) return recipe;
    }
    return null;
  }
  craftPreview() {
    const recipe = this.matchingModRecipe(); if (recipe) return recipe.result;
    const c = this.craft, n = id => c.filter(s => s.item === id).length, any = id => c.some(s => s.item === id);
    const occupied = c.filter(s => s.item).length;
    if (occupied === 4 && n('PLANK') === 3 && any('STICK')) return 'CHEST';
    if (occupied === 3 && n('WHEAT') === 3) return 'BREAD';
    if (occupied === 4 && n('PLANK') === 2 && n('STICK') === 2) return 'STONE_HOE';
    const plankCount = c.filter(s => s.item === 'PLANK').reduce((a, s) => a + s.count, 0);
    if (occupied <= 2 && occupied > 0 && occupied === n('PLANK') && plankCount === 2) return 'STICK';
    if (occupied === 1 && any('GOLD_INGOT')) return 'ROTATOR';
    if (occupied === 1 && any('STICK')) return 'SHARP_STICK';
    if (occupied === 2 && any('COAL') && any('STICK')) return 'TORCH';
    if (occupied === 1 && any('WOOD')) return 'PLANK';
    if (occupied === 4 && n('PLANK') === 4) return 'DOOR';
    if (occupied === 3 && n('PLANK') === 3) return 'STAIRS';
    if (occupied === 4 && n('STONE') === 4) return 'FURNACE';
    if (occupied === 2 && any('STICK')) {
      const heads = [['AXE_HEAD', 'STONE_AXE'], ['PICKAXE_HEAD', 'STONE_PICKAXE'], ['SHOVEL_HEAD', 'STONE_SHOVEL'],
        ['IRON_AXE_HEAD', 'IRON_AXE'], ['IRON_PICKAXE_HEAD', 'IRON_PICKAXE'], ['IRON_SHOVEL_HEAD', 'IRON_SHOVEL'],
        ['GOLD_AXE_HEAD', 'GOLD_AXE'], ['GOLD_PICKAXE_HEAD', 'GOLD_PICKAXE'], ['GOLD_SHOVEL_HEAD', 'GOLD_SHOVEL']];
      for (const [head, tool] of heads) if (any(head)) return tool;
    }
    if (c[0].item === 'STONE' && c[1].item === 'STONE' && c[2].item === 'PLANK' && c[3].item === 'PLANK') return 'STONECUTTER';
    if (occupied === 4 && n('WOOL') === 2 && n('PLANK') === 2) return 'BED';
    if (occupied === 3 && any('TORCH') && any('GLASS') && any('IRON_INGOT')) return 'LANTERN';
    if (occupied === 3 && n('IRON_INGOT') === 3) return 'BUCKET';
    return null;
  }
  craftPreviewCount() {
    const result = this.craftPreview(); if (!result) return 0;
    const recipe = this.matchingModRecipe();
    return recipe ? recipe.count : result === 'PLANK' ? 4 : result === 'STICK' ? 16 : 1;
  }
  craftFromGrid() {
    const result = this.craftPreview(); if (!result) return false;
    const recipe = this.matchingModRecipe();
    const outputCount = this.craftPreviewCount();
    if (!this.canAdd(result, outputCount)) return false;
    const useFrom = (id, amount) => {
      let remaining = amount;
      for (let i = 0; i < CRAFT_SIZE && remaining > 0; i++) {
        const s = this.craft[i]; if (s.item !== id) continue;
        const used = Math.min(remaining, s.count);
        this.craft[i] = s.count === used ? EMPTY : { ...s, count: s.count - used }; remaining -= used;
      }
    };
    if (recipe) for (const [id, count] of recipe.ingredients) useFrom(id, count);
    else if (result === 'STICK') useFrom('PLANK', 2);
    else for (let i = 0; i < CRAFT_SIZE; i++) { const s = this.craft[i]; if (s.item) this.craft[i] = s.count === 1 ? EMPTY : { ...s, count: s.count - 1 }; }
    this.add(result, outputCount);
    return true;
  }

  // ------------------------------------------------------------ drag and drop
  refSlot(ref) {
    const m = /^(slot|hotbar|craft):(\d+)$/.exec(ref || ''); if (!m) return null;
    const i = +m[2];
    if (m[1] === 'craft') return i < CRAFT_SIZE ? this.craft[i] : null;
    return i < (m[1] === 'hotbar' ? HOTBAR_SIZE : SLOT_COUNT) ? this.slots[i] : null;
  }
  setRef(ref, value) {
    const m = /^(slot|hotbar|craft):(\d+)$/.exec(ref || ''); if (!m) return;
    if (m[1] === 'craft') this.craft[+m[2]] = value; else this.slots[+m[2]] = value;
  }
  hasItemRef(ref) { const s = this.refSlot(ref); return !!(s && s.item); }
  moveRef(fromRef, toRef, one = false) {
    if (!fromRef || !toRef || fromRef === toRef) return true;
    const from = this.refSlot(fromRef), to = this.refSlot(toRef);
    if (!from || !to || !from.item) return false;
    const lim = limit(from.item);
    // One item (right mouse button): never repairs tools, never exceeds the stack limit.
    const split = toRef.startsWith('craft:') && !fromRef.startsWith('craft:') && from.count > 1
      && (!to.item || to.item === from.item) && to.count < lim;
    if (one || split) {
      if (to.item && (to.item !== from.item || isTool(from.item))) return false;
      if (to.count >= lim) return false;
      this.setRef(toRef, to.item ? { ...to, count: to.count + 1 } : makeSlot(from.item, 1, from.durability));
      this.setRef(fromRef, from.count === 1 ? EMPTY : { ...from, count: from.count - 1 });
      return true;
    }
    if (!to.item) { this.setRef(toRef, from); this.setRef(fromRef, EMPTY); return true; }
    if (from.item === to.item && !isTool(from.item)) {
      const space = lim - to.count; if (space <= 0) return false;
      const moved = Math.min(space, from.count);
      this.setRef(toRef, { ...to, count: to.count + moved });
      this.setRef(fromRef, from.count - moved > 0 ? { ...from, count: from.count - moved } : EMPTY);
      return true;
    }
    this.setRef(fromRef, to); this.setRef(toRef, from);
    return true;
  }
  clear() { this.slots.fill(EMPTY); this.craft.fill(EMPTY); }
}
Inventory.SLOT_COUNT = SLOT_COUNT; Inventory.HOTBAR_SIZE = HOTBAR_SIZE; Inventory.CRAFT_SIZE = CRAFT_SIZE;
BC.Inventory = Inventory;
})();
