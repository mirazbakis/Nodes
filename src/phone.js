// Phone access over the local Wi-Fi network. No accounts, no cloud, no database:
// the Mac serves a small web app, a phone pairs once by scanning a QR code, and chats sync live.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PhoneServer {
  constructor({ root, devices, saveDevices, getState, action }) {
    this.root = root; // app directory
    this.devices = devices; // [{token, name, pairedAt, lastSeen}]
    this.saveDevices = saveDevices;
    this.getState = getState; // () => {nodes, conversations, profile}
    this.action = action; // async (type, payload) => result (runs in the desktop renderer)
    this.clients = new Set();
    this.server = null;
    this.port = null;
    this.pairCode = null;
    this.pairExpires = 0;
  }

  lanAddress() {
    const nets = os.networkInterfaces();
    const prefer = ['en0', 'en1'];
    const all = [];
    for (const [name, list] of Object.entries(nets)) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) all.push({ name, address: n.address });
    all.sort((a, b) => (prefer.includes(b.name) ? 1 : 0) - (prefer.includes(a.name) ? 1 : 0));
    return all[0] ? all[0].address : null;
  }

  async start() {
    if (this.server) return this.info();
    for (const port of [4747, 4748, 4749, 4757]) {
      try {
        await new Promise((resolve, reject) => {
          const s = http.createServer((req, res) => this.handle(req, res).catch((e) => this.json(res, 500, { error: String(e.message || e) })));
          s.once('error', reject);
          s.listen(port, '0.0.0.0', () => {
            this.server = s;
            this.port = port;
            resolve();
          });
        });
        break;
      } catch {}
    }
    return this.info();
  }

  stop() {
    for (const c of this.clients) c.end();
    this.clients.clear();
    if (this.server) this.server.close();
    this.server = null;
    this.port = null;
  }

  newPairCode() {
    this.pairCode = String(crypto.randomInt(100000, 999999));
    this.pairExpires = Date.now() + 10 * 60 * 1000;
    return this.info();
  }

  info() {
    const ip = this.lanAddress();
    const url = this.server && ip ? `http://${ip}:${this.port}/` : null;
    return {
      running: !!this.server, ip, port: this.port, url,
      pairUrl: url && this.pairCode && Date.now() < this.pairExpires ? `${url}#pair=${this.pairCode}` : null,
      pairCode: Date.now() < this.pairExpires ? this.pairCode : null,
      devices: this.devices.map(({ token, ...d }) => ({ ...d, id: token.slice(0, 8), online: [...this.clients].some((c) => c.token === token) })),
    };
  }

  revoke(id) {
    const d = this.devices.find((x) => x.token.startsWith(id));
    if (!d) return this.info();
    this.devices.splice(this.devices.indexOf(d), 1);
    for (const c of [...this.clients]) if (c.token === d.token) c.end();
    this.saveDevices();
    return this.info();
  }

  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) c.write(payload);
  }

  json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  auth(req) {
    const h = req.headers.authorization || '';
    const url = new URL(req.url, 'http://x');
    const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('t');
    const d = token && this.devices.find((x) => x.token === token);
    if (d) d.lastSeen = Date.now();
    return d;
  }

  body(req) {
    return new Promise((resolve) => {
      let b = '';
      req.on('data', (d) => (b += d).length > 2e6 && req.destroy());
      req.on('end', () => {
        try {
          resolve(JSON.parse(b || '{}'));
        } catch {
          resolve({});
        }
      });
    });
  }

  file(res, rel, type) {
    const p = path.join(this.root, rel);
    if (!p.startsWith(this.root) || !fs.existsSync(p)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    fs.createReadStream(p).pipe(res);
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    // static
    const statics = {
      '/': ['phone/index.html', 'text/html; charset=utf-8'],
      '/phone.css': ['phone/phone.css', 'text/css'],
      '/phone.js': ['phone/phone.js', 'text/javascript'],
      '/avatars.js': ['renderer/avatars.js', 'text/javascript'],
      '/marked.js': ['renderer/vendor/marked.min.js', 'text/javascript'],
      '/purify.js': ['renderer/vendor/purify.min.js', 'text/javascript'],
      '/icon.png': ['renderer/icon.png', 'image/png'],
      '/manifest.json': ['phone/manifest.json', 'application/manifest+json'],
    };
    if (req.method === 'GET' && statics[p]) return this.file(res, ...statics[p]);

    if (p === '/api/pair' && req.method === 'POST') {
      const b = await this.body(req);
      if (!this.pairCode || Date.now() > this.pairExpires || String(b.code) !== this.pairCode) return this.json(res, 403, { error: 'That pairing code has expired. Open Connect phone on your Mac for a new one.' });
      const token = crypto.randomBytes(24).toString('hex');
      this.devices.push({ token, name: String(b.name || 'Phone').slice(0, 40), pairedAt: Date.now(), lastSeen: Date.now() });
      this.pairCode = null;
      this.saveDevices();
      this.action('devices-changed', {});
      return this.json(res, 200, { token });
    }

    const device = this.auth(req);
    if (!device) return this.json(res, 401, { error: 'not paired' });

    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': hi\n\n');
      res.token = device.token;
      this.clients.add(res);
      this.action('devices-changed', {});
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        this.clients.delete(res);
        this.action('devices-changed', {});
      });
      return;
    }
    if (p === '/api/state') return this.json(res, 200, this.getState());
    if (p.startsWith('/api/conv/')) {
      const conv = this.getState(true).conversations.find((c) => c.id === decodeURIComponent(p.slice(10)));
      return conv ? this.json(res, 200, conv) : this.json(res, 404, { error: 'not found' });
    }
    if (req.method === 'POST' && p === '/api/send') return this.json(res, 200, await this.action('send', await this.body(req)));
    if (req.method === 'POST' && p === '/api/new') return this.json(res, 200, await this.action('new', await this.body(req)));
    if (req.method === 'POST' && p === '/api/stop') return this.json(res, 200, await this.action('stop', await this.body(req)));
    this.json(res, 404, { error: 'unknown' });
  }
}

module.exports = { PhoneServer };
