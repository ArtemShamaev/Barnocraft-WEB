/* Barnocraft WEB — Python Mod API v2 host. Mods run in Pyodide (CPython for WebAssembly) inside a
 * Web Worker, so a mod cannot touch the page or the player's files. The JSON-RPC methods, limits
 * and events are the same as PythonModApi.java. */
(function () {
'use strict';
const BC = globalThis.BC;
const B = BC.B, J = BC.Json;
const API_VERSION = 2, MAX_LINE = 262144;
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const USER_MODS = 'barnocraft-web.user-mods', ENABLED = 'barnocraft-web.mod-enabled';

const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (e) { return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } };
BC.standaloneId = function (filename) {
  const id = filename.replace(/\.py$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
  return !id || id[0] < 'a' || id[0] > 'z' ? 'mod_' + id : id;
};

/** Bundled mods plus mods the player added; each has files and an optional manifest. */
BC.ModCatalog = {
  sources() {
    const list = [];
    for (const [name, files] of Object.entries(BC.BUNDLED_MODS || {})) list.push({ key: 'builtin:' + name, files, builtIn: true });
    for (const [key, mod] of Object.entries(readJson(USER_MODS, {}))) list.push({ key, files: mod.files, single: mod.single, filename: mod.filename, builtIn: false });
    return list;
  },
  entries() {
    const overrides = readJson(ENABLED, {});
    return BC.ModCatalog.sources().map(src => {
      try {
        const manifest = BC.ModCatalog.manifest(src);
        const enabled = overrides[src.key] !== undefined ? overrides[src.key] : manifest.enabled !== false;
        return { key: src.key, id: manifest.id, name: J.str(manifest, 'name', manifest.id), version: J.str(manifest, 'version', '?'),
          api: manifest.api, entry: src.single ? src.filename + ' · одиночный файл' : J.str(manifest, 'entry', 'main.py'), enabled, error: '', builtIn: src.builtIn, manifest, src };
      } catch (e) {
        return { key: src.key, id: src.key, name: src.key, version: '?', api: 0, entry: '', enabled: false, error: e.message, builtIn: src.builtIn, src };
      }
    });
  },
  manifest(src) {
    if (src.single) return { id: BC.standaloneId(src.filename), name: BC.standaloneId(src.filename), version: '1.0.0', api: API_VERSION, entry: src.filename, enabled: true };
    const text = src.files['mod.json'];
    if (!text) throw new Error('нет mod.json');
    if (text.length > 1048576) throw new Error('manifest слишком большой');
    const manifest = JSON.parse(text);
    if (!manifest || typeof manifest !== 'object') throw new Error('manifest должен быть объектом');
    return manifest;
  },
  toggle(key) {
    const entry = BC.ModCatalog.entries().find(e => e.key === key); if (!entry) return;
    const overrides = readJson(ENABLED, {}); overrides[key] = !entry.enabled; writeJson(ENABLED, overrides);
  },
  remove(key) { const mods = readJson(USER_MODS, {}); delete mods[key]; writeJson(USER_MODS, mods); },
  /** Add a folder (FileList from webkitdirectory) or single .py files. */
  async add(fileList) {
    const files = Array.from(fileList);
    const mods = readJson(USER_MODS, {});
    const manifestFile = files.find(f => /(^|\/)mod\.json$/.test(f.webkitRelativePath || f.name) && (f.webkitRelativePath || f.name).split('/').length <= 2);
    if (manifestFile) {
      const root = (manifestFile.webkitRelativePath || '').split('/')[0] || 'mod';
      const out = {};
      for (const f of files) {
        const path = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
        if (/\.(py|json)$/.test(path) && !path.includes('__pycache__') && f.size < 1048576) out[path] = await f.text();
      }
      const manifest = JSON.parse(out['mod.json']);
      mods['user:' + (manifest.id || root)] = { files: out };
      if (!writeJson(USER_MODS, mods)) throw new Error('Недостаточно места в хранилище браузера');
      return manifest.name || manifest.id || root;
    }
    const scripts = files.filter(f => /\.py$/i.test(f.name));
    if (!scripts.length) throw new Error('Выберите папку с mod.json или файл .py');
    for (const f of scripts) mods['file:' + f.name] = { files: { [f.name]: await f.text() }, single: true, filename: f.name };
    if (!writeJson(USER_MODS, mods)) throw new Error('Недостаточно места в хранилище браузера');
    return scripts.map(f => f.name).join(', ');
  }
};

/** Worker body: one Pyodide interpreter, each mod executed as __main__ in its own namespace. */
function modWorkerMain() {
  let py = null, current = null, out = null;
  const flush = () => { const o = out; out = null; return o; };
  self.onmessage = async e => {
    const m = e.data;
    try {
      if (m.type === 'init') {
        importScripts(m.url + 'pyodide.js');
        py = await loadPyodide({ indexURL: m.url,
          stdout: line => { if (out) out.lines.push(line); },
          stderr: line => { if (out) out.logs.push(line); } });
        py.setStdout({ batched: line => { if (out) out.lines.push(line); } });
        py.setStderr({ batched: line => { if (out) out.logs.push(line); } });
        py.FS.mkdirTree('/barnocraft/sdk');
        py.FS.writeFile('/barnocraft/sdk/barnocraft.py', m.sdk);
        py.runPython('import sys\nsys.path.insert(0, "/barnocraft/sdk")\nimport barnocraft\n_bc_mods = {}\n'
          + 'def _bc_dispatch(mod, lines):\n    for line in lines:\n        for api in _bc_mods.get(mod, []):\n            api.handle(line)\n');
        self.postMessage({ type: 'ready' });
      } else if (m.type === 'load') {
        current = m.mod; out = { type: 'out', mod: m.mod, lines: [], logs: [] };
        const dir = '/barnocraft/mods/' + m.mod;
        for (const [path, text] of Object.entries(m.files)) {
          const full = dir + '/' + path; py.FS.mkdirTree(full.substring(0, full.lastIndexOf('/'))); py.FS.writeFile(full, text);
        }
        py.globals.set('_bc_dir', dir); py.globals.set('_bc_entry', dir + '/' + m.entry); py.globals.set('_bc_id', m.mod);
        try {
          py.runPython('before = len(barnocraft.REGISTERED)\nsys.path.insert(0, _bc_dir)\n'
            + 'try:\n    exec(compile(open(_bc_entry, encoding="utf-8").read(), _bc_entry, "exec"), {"__name__": "__main__", "__file__": _bc_entry})\n'
            + 'finally:\n    sys.path.remove(_bc_dir)\n_bc_mods[_bc_id] = barnocraft.REGISTERED[before:]\n'
            + 'if not _bc_mods[_bc_id]:\n    print("Mod did not call api.run()", file=sys.stderr)\n');
          self.postMessage(flush());
        } catch (err) { const o = flush(); o.failed = String(err.message || err); self.postMessage(o); }
      } else if (m.type === 'deliver') {
        out = { type: 'out', mod: m.mod, lines: [], logs: [], ack: true };
        py.globals.set('_bc_lines', py.toPy(m.lines)); py.globals.set('_bc_id', m.mod);
        try { py.runPython('_bc_dispatch(_bc_id, _bc_lines)'); self.postMessage(flush()); }
        catch (err) { const o = flush(); o.failed = String(err.message || err); self.postMessage(o); }
      }
    } catch (err) { self.postMessage({ type: 'fatal', error: String(err && err.message || err) }); }
    current = null; void current;
  };
}

class PythonModApi {
  constructor(world, player, inventory) {
    this.world = world; this.player = player; this.inventory = inventory;
    this.mods = []; this.started = false; this.clock = 0; this.worker = null; this.ready = false; this.waiting = [];
  }
  start() {
    if (this.started) return; this.started = true;
    const enabled = BC.ModCatalog.entries().filter(e => e.enabled && !e.error);
    for (const entry of enabled) {
      try {
        const id = entry.id;
        if (!/^[a-z][a-z0-9_]*$/.test(id) || this.mods.some(m => m.id === id)) throw new Error('invalid/duplicate mod id');
        if (entry.manifest.api !== API_VERSION) throw new Error('requires API 2');
        const entryFile = entry.src.single ? entry.src.filename : J.str(entry.manifest, 'entry', 'main.py');
        if (!entry.src.files[entryFile] || entryFile.includes('..')) throw new Error('invalid entry script');
        this.world.mods.register(id, entry.manifest);
        this.mods.push({ id, files: entry.src.files, entry: entryFile, incoming: [], outbox: [], tick: null, inflight: false, failed: false, loaded: false, exitReported: false, surfaceClock: 0, log: [] });
      } catch (e) { this.world.mods.notice = 'Не загружен мод ' + entry.name + ': ' + e.message; console.warn('[mods]', entry.name, e); }
    }
    BC.Textures.invalidateMods();
    if (!this.mods.length) return;
    try {
      const source = '(' + modWorkerMain.toString() + ')();';
      this.worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'application/javascript' })));
      this.worker.onmessage = e => this.receive(e.data);
      this.worker.onerror = e => this.fatal(e.message || 'ошибка воркера');
      this.worker.postMessage({ type: 'init', url: PYODIDE, sdk: BC.MOD_SDK });
    } catch (e) { this.fatal(e.message); }
  }
  fatal(reason) {
    for (const m of this.mods) m.failed = true;
    this.world.mods.notice = 'Моды недоступны: не удалось запустить Python (Pyodide загружается из интернета). ' + reason;
    console.error('[mods]', reason);
  }
  receive(m) {
    if (m.type === 'fatal') { this.fatal(m.error); return; }
    if (m.type === 'ready') {
      this.ready = true;
      for (const mod of this.mods) {
        this.worker.postMessage({ type: 'load', mod: mod.id, files: mod.files, entry: mod.entry });
        mod.inflight = true;
        mod.outbox.unshift(JSON.stringify({ event: 'load', data: { api: API_VERSION, mod: mod.id, state: this.world.mods.storage[mod.id] || {} } }));
      }
      return;
    }
    const mod = this.mods.find(x => x.id === m.mod); if (!mod) return;
    mod.inflight = false; mod.loaded = true;
    for (const line of m.logs || []) { mod.log.push(line); console.log('[mod ' + mod.id + ']', line); }
    if (mod.log.length > 200) mod.log.splice(0, mod.log.length - 200);
    for (const line of m.lines || []) {
      if (!line.trim()) continue;
      if (line.length > MAX_LINE) { this.fail(mod, 'message too large'); return; }
      if (mod.incoming.length >= 256) { this.fail(mod, 'request queue overflow'); return; }
      mod.incoming.push(line);
    }
    if (m.failed) this.fail(mod, m.failed);
  }
  fail(mod, reason) {
    if (!mod.failed) console.error('[mod ' + mod.id + '] disabled:', reason, mod.log.slice(-10).join('\n'));
    mod.failed = true;
  }
  send(mod, message) {
    if (mod.outbox.length >= 128) { this.fail(mod, 'output queue overflow'); return; }
    mod.outbox.push(JSON.stringify(message));
  }
  tick(dt, selected, yaw) {
    if (!this.started) this.start();
    this.clock += dt; let budget = 128;
    const state = this.world.mods;
    for (const mod of this.mods) {
      mod.surfaceClock = Math.max(0, mod.surfaceClock - dt);
      if (mod.failed) {
        if (!mod.exitReported) { mod.exitReported = true; if (this.ready) state.notice = 'Мод ' + mod.id + ' остановлен. Подробности в консоли браузера (F12)'; }
        for (const k of Array.from(state.overlays.keys())) if (k.startsWith(mod.id + ':')) state.overlays.delete(k);
        continue;
      }
      for (let i = 0; i < 32 && budget > 0 && mod.incoming.length; i++, budget--) {
        const line = mod.incoming.shift(); let requestId = null;
        try {
          const request = JSON.parse(line);
          if (!request || typeof request !== 'object') throw new Error('request id required');
          requestId = request.id;
          if (typeof requestId !== 'number' && typeof requestId !== 'string') throw new Error('request id required');
          const result = this.call(mod, J.str(request, 'method', ''), request.params && typeof request.params === 'object' ? request.params : {});
          this.send(mod, { id: requestId, result: result === null || result === undefined ? {} : result });
        } catch (e) {
          this.send(mod, { id: requestId === null ? 0 : requestId, error: { code: 'invalid_request', message: String(e.message) } });
        }
      }
    }
    const events = state.drainEvents();
    for (const mod of this.mods) if (!mod.failed) for (const event of events) this.send(mod, event);
    if (this.clock >= .1) {
      this.clock = 0;
      const message = JSON.stringify({ event: 'tick', data: state.snapshot(this.player, this.inventory, selected, yaw) });
      for (const mod of this.mods) if (!mod.failed) mod.tick = message;
    }
    if (!this.ready) return;
    for (const mod of this.mods) {
      if (mod.failed || mod.inflight || !mod.loaded) continue;
      const lines = mod.outbox.splice(0);
      if (mod.tick) { lines.push(mod.tick); mod.tick = null; }
      if (!lines.length) continue;
      mod.inflight = true;
      this.worker.postMessage({ type: 'deliver', mod: mod.id, lines });
    }
  }
  call(mod, method, p) {
    const state = this.world.mods, world = this.world, player = this.player, pos = player.position;
    switch (method) {
      case 'api.info': return { version: API_VERSION, mod: mod.id, tick_hz: 10 };
      case 'state.set': {
        const data = JSON.stringify(p); if (data.length > 65536) throw new Error('state too large');
        state.storage[mod.id] = JSON.parse(data); return true;
      }
      case 'entity.spawn': {
        const type = BC.owned(mod.id, J.str(p, 'type', '')), x = J.num(p, 'x', pos.x), z = J.num(p, 'z', pos.z);
        if (Math.hypot(x - pos.x, z - pos.z) > 64) throw new Error('Spawn must be within 64 blocks');
        return state.data(state.spawn(type, x, z));
      }
      case 'entity.goal': {
        const e = state.controlled(mod.id, J.str(p, 'id', ''));
        e.goalX = J.bounded(p, 'x', e.x, 0, world.width - 1); e.goalZ = J.bounded(p, 'z', e.z, 0, world.depth - 1);
        e.stop = J.bounded(p, 'stop', 1, 0, 20); e.goalTime = 1.5; return true;
      }
      case 'entity.teleport': {
        const e = state.controlled(mod.id, J.str(p, 'id', '')), x = J.num(p, 'x', e.x), z = J.num(p, 'z', e.z);
        if (Math.hypot(x - pos.x, z - pos.z) > 32) throw new Error('Teleport must stay near the player');
        const y = state.surface(x | 0, z | 0) + 1;
        if (!state.fits(e, x, y, z) || world.get(x | 0, (y | 0) - 1, z | 0) === B.WATER) return false;
        Object.assign(e, { x, y, z, vy: 0, goalTime: 0 }); return true;
      }
      case 'entity.attack': case 'entity.shoot': {
        const e = state.controlled(mod.id, J.str(p, 'id', ''));
        return state.attack(e, J.str(p, 'target', ''), method.endsWith('shoot'), player);
      }
      case 'entity.remove': { const e = state.controlled(mod.id, J.str(p, 'id', '')); state.entities.delete(e.id); return true; }
      case 'world.get_block':
        return BC.BLOCK_NAMES[world.get(J.integer(p, 'x', 0, 0, world.width - 1), J.integer(p, 'y', 0, 0, BC.HEIGHT - 1), J.integer(p, 'z', 0, 0, world.depth - 1))];
      case 'world.surface': {
        if (mod.surfaceClock > 0) throw new Error('Surface query limited to 2 Hz');
        mod.surfaceClock = .5;
        const size = J.integer(p, 'size', 25, 3, 33), step = J.integer(p, 'step', 2, 1, 4);
        const ox = (pos.x | 0) - ((size / 2) | 0) * step, oz = (pos.z | 0) - ((size / 2) | 0) * step, blocks = [], heights = [];
        for (let z = 0; z < size; z++) {
          const row = [], hs = [];
          for (let x = 0; x < size; x++) {
            const bx = ox + x * step, bz = oz + z * step, y = state.surface(bx, bz);
            row.push(BC.BLOCK_NAMES[world.get(bx, y, bz)]); hs.push(y);
          }
          blocks.push(row); heights.push(hs);
        }
        return { x: ox, z: oz, step, size, blocks, heights };
      }
      case 'ui.image': {
        const id = BC.owned(mod.id, J.str(p, 'id', ''));
        J.validatePixels(p.pixels, 64);
        if (!state.overlays.has(id) && state.overlays.size >= 4) throw new Error('Overlay limit');
        if (J.str(p, 'title', '').length > 64) throw new Error('Title too long');
        state.overlays.set(id, { title: p.title || '', pixels: p.pixels }); return true;
      }
      case 'ui.remove': state.overlays.delete(BC.owned(mod.id, J.str(p, 'id', ''))); return true;
      case 'log': console.log('[mod ' + mod.id + ']', J.str(p, 'message', '')); return true;
      default: throw new Error('Unknown API method: ' + method);
    }
  }
  loadedMods() { return this.mods.filter(m => !m.failed && m.loaded).length; }
  close() {
    if (this.worker) {
      for (const mod of this.mods) if (!mod.failed && mod.loaded) this.worker.postMessage({ type: 'deliver', mod: mod.id, lines: [JSON.stringify({ event: 'unload', data: {} })] });
      const worker = this.worker; setTimeout(() => worker.terminate(), 500);
    }
    this.worker = null; this.mods = [];
  }
}
BC.PythonModApi = PythonModApi;
})();
