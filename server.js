#!/usr/bin/env node
/* Barnocraft WEB server: serves the game over HTTP and relays LAN multiplayer messages over
 * WebSocket between the host's browser and up to seven guests. No npm dependencies.
 *
 *   node server.js [port]        (default 25565; also BARNOCRAFT_PORT or PORT on hosting)
 * Several worlds can be open at once: each host opens a room, guests join it by its code.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.BARNOCRAFT_PORT || process.env.PORT || 25565);
// On a cloud host the container addresses mean nothing to players.
const HOSTED = !!process.env.PORT && !process.argv[2];
const PROTOCOL = 'barnocraft-web/1', MAX_PLAYERS = 8, MAX_FRAME = 32 * 1024 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.css': 'text/css', '.md': 'text/markdown; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.txt': 'text/plain' };

function lanAddresses() {
  const result = [];
  if (HOSTED) return result;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|tun|virbr|vmnet|lo)/.test(name)) continue;
    for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) result.push(a.address);
  }
  return result;
}

// ---------------------------------------------------------------- static files
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/lan') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ addresses: lanAddresses(), port: PORT })); return;
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT) || /[\\/]\.(git|env)/.test(file)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Не найдено'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- minimal RFC 6455 WebSocket
class Socket {
  constructor(raw) {
    this.raw = raw; this.buffer = Buffer.alloc(0); this.fragments = []; this.open = true;
    this.onmessage = () => {}; this.onclose = () => {};
    raw.on('data', chunk => { this.buffer = Buffer.concat([this.buffer, chunk]); this.parse(); });
    raw.on('close', () => this.closed());
    raw.on('error', () => this.closed());
    raw.setNoDelay(true);
  }
  parse() {
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1], opcode = b0 & 15, masked = (b1 & 128) !== 0;
      let length = b1 & 127, offset = 2;
      if (length === 126) { if (this.buffer.length < 4) return; length = this.buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (this.buffer.length < 10) return; length = Number(this.buffer.readBigUInt64BE(2)); offset = 10; }
      if (length > MAX_FRAME) { this.close(1009); return; }
      const total = offset + (masked ? 4 : 0) + length;
      if (this.buffer.length < total) return;
      let payload = this.buffer.subarray(offset + (masked ? 4 : 0), total);
      if (masked) { const mask = this.buffer.subarray(offset, offset + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      this.buffer = this.buffer.subarray(total);
      if (opcode === 8) { this.close(1000); return; }
      if (opcode === 9) { this.frame(10, payload); continue; }
      if (opcode === 10) continue;
      if (opcode === 1 || opcode === 0) {
        this.fragments.push(payload);
        if (b0 & 128) {
          const text = Buffer.concat(this.fragments).toString('utf8'); this.fragments = [];
          try { this.onmessage(JSON.parse(text)); } catch (e) { /* ignore malformed */ }
        }
      }
    }
  }
  frame(opcode, payload) {
    if (!this.open) return;
    const n = payload.length; let header;
    if (n < 126) header = Buffer.from([128 | opcode, n]);
    else if (n < 65536) { header = Buffer.alloc(4); header[0] = 128 | opcode; header[1] = 126; header.writeUInt16BE(n, 2); }
    else { header = Buffer.alloc(10); header[0] = 128 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(n), 2); }
    this.raw.write(Buffer.concat([header, payload]));
  }
  send(object) { this.frame(1, Buffer.from(JSON.stringify(object), 'utf8')); }
  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code, 0); this.frame(8, p);
    this.raw.end(); this.closed();
  }
  closed() { if (!this.open) return; this.open = false; this.onclose(); }
}

// ---------------------------------------------------------------- relay (rooms)
const rooms = new Map(); // code → { host, guests: Map, nextId }
const MAX_ROOMS = 200;
function log(text) { console.log('[LAN] ' + text); }
server.on('upgrade', (req, raw) => {
  if (new URL(req.url, 'http://localhost').pathname !== '/ws' || !req.headers['sec-websocket-key']) { raw.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  raw.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const socket = new Socket(raw), remote = req.headers['x-forwarded-for'] || raw.remoteAddress;
  let role = null, id = -1, room = null, code = '';
  const reject = reason => { socket.send({ type: 'relay-error', reason }); log('Отказ ' + remote + ': ' + reason); socket.close(); };
  socket.onmessage = m => {
    if (!role) {
      if (!m || m.type !== 'relay-hello') return reject('Ожидалось приветствие');
      if (m.proto !== PROTOCOL) return reject('Разные версии игры. Обновите страницу у всех игроков');
      code = typeof m.room === 'string' && /^[A-Za-z0-9]{1,16}$/.test(m.room) ? m.room : 'lan';
      room = rooms.get(code);
      if (m.role === 'host') {
        if (room) return reject(code === 'lan' ? 'На этом сервере уже открыт другой мир' : 'Комната ' + code + ' занята. Выберите другой код');
        if (rooms.size >= MAX_ROOMS) return reject('Сервер перегружен, попробуйте позже');
        room = { host: socket, guests: new Map(), nextId: 1 }; rooms.set(code, room);
        role = 'host'; id = 0;
        socket.send({ type: 'relay-ok', role, addresses: lanAddresses(), port: PORT }); log('Хозяин открыл мир [' + code + ']: ' + remote);
      } else {
        if (!room) return reject(code === 'lan' ? 'Мир не открыт для сети. Хозяин должен нажать «Открыть для сети»' : 'Комната ' + code + ' не найдена');
        if (room.guests.size >= MAX_PLAYERS - 1) return reject('Сервер заполнен (до ' + MAX_PLAYERS + ' игроков)');
        role = 'guest'; id = room.nextId++; room.guests.set(id, socket);
        socket.send({ type: 'relay-ok', role, id }); room.host.send({ type: 'peer-join', peer: id }); log('Гость ' + id + ' [' + code + ']: ' + remote);
      }
      return;
    }
    if (role === 'guest') { room.host.send({ from: id, msg: m }); return; }
    // host → guests
    if (!m || !m.msg) return;
    if (m.to === 'all') { for (const g of room.guests.values()) g.send(m.msg); }
    else { const g = room.guests.get(m.to); if (g) { g.send(m.msg); if (m.msg.type === 'ERROR') setTimeout(() => g.close(), 2000); } }
  };
  socket.onclose = () => {
    if (role === 'host' && rooms.get(code) === room) {
      rooms.delete(code); log('Хозяин закрыл мир [' + code + ']');
      for (const g of room.guests.values()) { g.send({ type: 'relay-error', reason: 'Хозяин закрыл сеть' }); g.close(); }
    } else if (role === 'guest' && room.guests.get(id) === socket) {
      room.guests.delete(id); if (rooms.get(code) === room) room.host.send({ type: 'peer-leave', peer: id });
      log('Гость ' + id + ' [' + code + '] отключился');
    }
  };
});

server.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? 'Порт ' + PORT + ' занят. Укажите другой: node server.js 8088' : e.message);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('Barnocraft WEB: http://localhost:' + PORT + '/');
  for (const a of lanAddresses()) console.log('  в локальной сети: http://' + a + ':' + PORT + '/');
});
