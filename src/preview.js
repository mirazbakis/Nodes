// Localhost previews for sites the nodes build: Docker when the project has a Dockerfile
// or compose file and Docker is installed, otherwise a small built-in static server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.wasm': 'application/wasm',
};

const servers = new Map(); // dir -> {server, port, url}
const containers = new Map(); // dir -> {name, url, compose}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: opts.timeout || 600000, cwd: opts.cwd, env: opts.env, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (e, out, err) => resolve({ ok: !e, out: String(out || ''), err: String(err || e?.message || '') })));
}

async function dockerStatus(which) {
  const bin = await which('docker');
  if (!bin) return { installed: false, running: false };
  const r = await run(bin, ['info', '--format', '{{.ServerVersion}}'], { timeout: 6000 });
  return { installed: true, running: r.ok && !!r.out.trim(), version: r.out.trim(), bin };
}

function staticServe(dir) {
  if (servers.has(dir)) return Promise.resolve(servers.get(dir));
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.join(dir, rel);
      if (!file.startsWith(dir)) {
        res.writeHead(403);
        return res.end();
      }
      try {
        if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      } catch {}
      if (!fs.existsSync(file)) {
        const spa = path.join(dir, 'index.html');
        if (fs.existsSync(spa) && !path.extname(rel)) file = spa;
        else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('Not found');
        }
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const info = { server, port, url: `http://localhost:${port}/`, kind: 'static' };
      servers.set(dir, info);
      resolve(info);
    });
  });
}

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

// Starts a preview for `dir`. Returns {url, kind, note}.
async function start(dir, { which, env, emit }) {
  if (!fs.existsSync(dir)) throw new Error(`Folder not found: ${dir}`);
  const has = (f) => fs.existsSync(path.join(dir, f));
  const compose = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].find(has);
  const dockerfile = has('Dockerfile');
  if (compose || dockerfile) {
    const d = await dockerStatus(which);
    if (d.installed && d.running) {
      if (containers.has(dir)) return { url: containers.get(dir).url, kind: 'docker', note: 'Already running in Docker.' };
      emit && emit({ type: 'tool', text: `Docker(${compose ? 'compose up' : 'build and run'})` });
      if (compose) {
        const r = await run(d.bin, ['compose', '-f', compose, 'up', '-d', '--build'], { cwd: dir, env });
        if (!r.ok) throw new Error('docker compose failed: ' + r.err.slice(-600));
        const ps = await run(d.bin, ['compose', '-f', compose, 'ps', '--format', '{{.Publishers}}'], { cwd: dir, env });
        const m = ps.out.match(/(\d+)->/) || ps.out.match(/PublishedPort:(\d+)/);
        const url = m ? `http://localhost:${m[1]}/` : 'http://localhost/';
        containers.set(dir, { compose, url, dir, bin: d.bin });
        return { url, kind: 'docker', note: 'Started with docker compose.' };
      }
      const tag = 'nodes-preview-' + crypto.createHash('sha1').update(dir).digest('hex').slice(0, 10);
      const b = await run(d.bin, ['build', '-t', tag, '.'], { cwd: dir, env });
      if (!b.ok) throw new Error('docker build failed: ' + b.err.slice(-600));
      const expose = (fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8').match(/^\s*EXPOSE\s+(\d+)/im) || [])[1] || '80';
      const port = await freePort();
      await run(d.bin, ['rm', '-f', tag], { env });
      const r = await run(d.bin, ['run', '-d', '--name', tag, '-p', `127.0.0.1:${port}:${expose}`, tag], { env });
      if (!r.ok) throw new Error('docker run failed: ' + r.err.slice(-600));
      const url = `http://localhost:${port}/`;
      containers.set(dir, { name: tag, url, bin: d.bin });
      return { url, kind: 'docker', note: `Running in Docker container ${tag}.` };
    }
    if (!has('index.html')) throw new Error(d.installed ? 'Docker is installed but not running. Open Docker Desktop and try again.' : 'This project needs Docker, which is not installed. Get Docker Desktop from docker.com.');
  }
  // Built-in static server. Serve a build folder if there is one.
  let root = dir;
  for (const sub of ['dist', 'build', 'public', 'out', 'site']) {
    if (!has('index.html') && fs.existsSync(path.join(dir, sub, 'index.html'))) {
      root = path.join(dir, sub);
      break;
    }
  }
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('No index.html found to preview. Create one first.');
  const s = await staticServe(root);
  return { url: s.url, kind: 'static', note: 'Served by Nodes on localhost.' };
}

async function stopAll() {
  for (const [, s] of servers) s.server.close();
  servers.clear();
  for (const [, c] of containers) {
    if (c.compose) await run(c.bin, ['compose', '-f', c.compose, 'down'], { cwd: c.dir });
    else await run(c.bin, ['rm', '-f', c.name]);
  }
  containers.clear();
}

function list() {
  return [...servers.entries()].map(([dir, s]) => ({ dir, url: s.url, kind: 'static' })).concat([...containers.entries()].map(([dir, c]) => ({ dir, url: c.url, kind: 'docker' })));
}

module.exports = { start, stopAll, list, dockerStatus };
