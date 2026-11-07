const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { PROVIDERS, byId, contextWindow } = require('./src/providers');
const { NODES, BUSINESS_NODES, TEAM_ID } = require('./src/nodes');
const engine = require('./src/engine');
const cli = require('./src/cli');
const { search, readPage, SEARCH_ENGINES } = require('./src/search');
const { PhoneServer } = require('./src/phone');

app.setName('Nodes');
nativeTheme.themeSource = 'dark';
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
if (IS_WIN) app.setAppUserModelId('com.athenesoftworks.nodes');

// ---------------- storage ----------------
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'nodes.json');
const keyFile = () => path.join(dataDir(), 'keys.bin');
const memoryFile = () => path.join(dataDir(), 'MEMORY.txt');
const MEMORY_TEMPLATE = `# MEMORY.txt
# Every node reads this file before it answers. Edit it in Nodes (Settings > Memory) or in any text editor.
# Lines starting with # are notes for you and are ignored.

## About me

## How I like answers

## My projects and stack

## Things to remember
`;
function readMemory() {
  try {
    return fs.readFileSync(memoryFile(), 'utf8');
  } catch {
    return MEMORY_TEMPLATE;
  }
}
function memoryForPrompt() {
  return readMemory().split('\n').filter((l) => !l.trim().startsWith('#') || l.trim().startsWith('##')).join('\n').replace(/^##.*\n(?=\s*(##|$))/gm, '').trim();
}

let data;
let keys = {};
let saveTimer = null;
let cliScan = [];

function defaults() {
  const providers = {};
  for (const p of PROVIDERS) providers[p.id] = { enabled: !p.local && !p.custom, defaultModel: p.models[0] || '', models: [], extra: {} };
  const order = [
    'gemini', 'groq', 'cerebras', 'openrouter', 'codex', 'claude-code', 'mistral', 'github', 'gemini-cli', 'sambanova', 'nvidia', 'huggingface', 'cohere', 'zai', 'together', 'cloudflare', 'chutes', 'qwen-code', 'cursor-agent', 'opencode',
    'openai', 'anthropic', 'xai', 'deepseek', 'perplexity', 'moonshot', 'pollinations', 'ollama', 'lmstudio', 'custom',
  ];
  return {
    version: 2,
    providers,
    providerOrder: [...new Set([...order, ...PROVIDERS.map((p) => p.id)])],
    nodes: NODES.map((n) => ({ ...n, builtIn: true })),
    conversations: [],
    search: { order: SEARCH_ENGINES.map((e) => e.id), enabled: {}, extra: {} },
    settings: {
      onboarded: false, userName: '', callMe: '', about: '', accent: '#4c8dff',
      autoFallback: true, firstTokenTimeout: 30, idleTimeout: 60, maxAttempts: 12, sendOnEnter: true, showRouting: true,
      browserAutoOpen: true, readPages: true, launchAnimation: true, phoneEnabled: false, defaultFolder: '',
      redactSecrets: true, localOnly: false, usageWarnings: true,
    },
    devices: [],
    stats: {},
    usage: {},
    automations: [],
  };
}

function load() {
  try {
    data = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch {
    data = defaults();
  }
  const d = defaults();
  data.settings = { ...d.settings, ...(data.settings || {}) };
  data.providers = data.providers || {};
  for (const p of PROVIDERS) data.providers[p.id] = { ...d.providers[p.id], ...(data.providers[p.id] || {}) };
  data.providerOrder = [...new Set([...(data.providerOrder || []).filter((id) => byId[id]), ...d.providerOrder])];
  data.nodes = data.nodes && data.nodes.length ? data.nodes : d.nodes;
  data.conversations = data.conversations || [];
  data.search = { ...d.search, ...(data.search || {}) };
  data.search.order = [...new Set([...(data.search.order || []).filter((id) => SEARCH_ENGINES.some((e) => e.id === id)), ...d.search.order])];
  data.devices = data.devices || [];
  data.stats = data.stats || {};
  data.usage = data.usage || {};
  data.automations = data.automations || [];
  try {
    const raw = fs.readFileSync(keyFile());
    keys = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
  } catch {
    keys = {};
  }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
function flush() {
  clearTimeout(saveTimer);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile() + '.tmp', JSON.stringify(data));
  fs.renameSync(dataFile() + '.tmp', dataFile());
}
function saveKeys() {
  const json = JSON.stringify(keys);
  fs.writeFileSync(keyFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json), { mode: 0o600 });
}

function applyCliScan(scan) {
  cliScan = scan;
  for (const s of scan) {
    if (data.providers[s.id]) data.providers[s.id].cliReady = s.installed && s.signedIn;
  }
  if (data.providers.ollama) {
    const o = scan.find((s) => s.id === 'ollama-app');
    if (o && o.signedIn && data.providers.ollama.autoDetected !== true) {
      data.providers.ollama.enabled = true;
      data.providers.ollama.autoDetected = true;
    }
  }
}

function publicState() {
  return {
    providers: PROVIDERS.map((p) => ({
      ...p, cfg: data.providers[p.id], hasKey: !!keys[p.id], keyHint: keys[p.id] ? '••••' + String(keys[p.id]).slice(-4) : '',
      usable: engine.usable(p, data.providers[p.id], keys[p.id]), cooling: engine.isCooling(p.id), stats: data.stats[p.id] || null,
      ctx: contextWindow(p.id, data.providers[p.id].defaultModel),
    })),
    providerOrder: data.providerOrder,
    nodes: data.nodes,
    defaultNodes: NODES,
    teamId: TEAM_ID,
    conversations: data.conversations,
    settings: data.settings,
    search: { ...data.search, engines: SEARCH_ENGINES.map((e) => ({ ...e, hasKey: !!keys['search:' + e.id] })) },
    cli: cliScan,
    home: os.homedir(),
    platform: process.platform,
    usage: data.usage,
    automations: data.automations,
    businessNodes: BUSINESS_NODES,
  };
}

const SECRET_RES = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, /\bgh[pousr]_[A-Za-z0-9]{30,}/g, /\bgithub_pat_[A-Za-z0-9_]{40,}/g, /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g, /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, /\bgsk_[A-Za-z0-9]{30,}/g, /\b(?:sk|pk|rk)_live_[A-Za-z0-9]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
function redact(text) {
  let n = 0;
  let out = String(text || '');
  for (const re of SECRET_RES) out = out.replace(re, () => (n++, '[REDACTED SECRET]'));
  return { out, n };
}

function bumpStat(provider, ok, ms, tin = 0, tout = 0) {
  const s = (data.stats[provider] = data.stats[provider] || { ok: 0, fail: 0, totalMs: 0, last: 0 });
  s.tokensIn = (s.tokensIn || 0) + tin;
  s.tokensOut = (s.tokensOut || 0) + tout;
  if (ok) {
    s.ok++;
    s.totalMs += ms;
  } else s.fail++;
  s.last = Date.now();
}

// ---------------- window ----------------
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1340, height: 860, minWidth: 940, minHeight: 600,
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 19 }, vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#101114', symbolColor: '#b9bac3', height: 52 }, backgroundColor: '#101114', autoHideMenuBar: true }),
    show: false, icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) win.webContents.send('browser:open', url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/.test(url)) win.webContents.send('browser:open', url);
    }
  });
  // Lock down the in-app browser panel.
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    params.partition = 'persist:nodes-browser';
  });
  app.on('web-contents-created', (_e, wc) => {
    if (wc.getType() === 'webview') {
      wc.setWindowOpenHandler(({ url }) => {
        wc.loadURL(url);
        return { action: 'deny' };
      });
    }
  });
}

function buildMenu() {
  const send = (ch) => () => win && win.webContents.send('menu', ch);
  const settings = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('settings') };
  const file = [
    { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: send('new') }, { label: 'New Node…', accelerator: 'CmdOrCtrl+Shift+N', click: send('new-node') },
    { label: 'Open Folder for Chat…', accelerator: 'CmdOrCtrl+O', click: send('folder') }, { type: 'separator' }, { label: 'Export Chat…', accelerator: 'CmdOrCtrl+E', click: send('export') },
  ];
  const view = {
    label: 'View',
    submenu: [
      { label: 'Home', accelerator: 'CmdOrCtrl+1', click: send('view-home') }, { label: 'Chats', accelerator: 'CmdOrCtrl+2', click: send('view-chat') }, { label: 'Nodes', accelerator: 'CmdOrCtrl+3', click: send('view-nodes') }, { label: 'Engines', accelerator: 'CmdOrCtrl+4', click: send('view-engines') }, { label: 'Activity', accelerator: 'CmdOrCtrl+5', click: send('view-activity') },
      { type: 'separator' }, { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: send('toggle-sidebar') }, { label: 'Toggle Browser', accelerator: 'CmdOrCtrl+B', click: send('toggle-browser') },
      { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
    ],
  };
  const help = { role: 'help', submenu: [{ label: 'Connect Phone…', click: send('phone') }, { label: 'Run Setup Again…', click: send('onboarding') }] };
  const template = IS_MAC
    ? [
        { role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, settings, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
        { label: 'File', submenu: [...file, { type: 'separator' }, { role: 'close' }] },
        { role: 'editMenu' }, view, { role: 'windowMenu' }, help,
      ]
    : [{ label: 'File', submenu: [...file, { type: 'separator' }, settings, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }, view, help];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------- phone ----------------
const pending = new Map();
const phone = new PhoneServer({
  root: __dirname,
  devices: [],
  saveDevices: () => save(),
  getState: (full) => ({
    profile: { name: data.settings.userName, callMe: data.settings.callMe },
    nodes: data.nodes.map(({ id, name, tagline, avatar }) => ({ id, name, tagline, avatar })),
    teamId: TEAM_ID,
    conversations: full
      ? data.conversations
      : data.conversations.map((c) => ({ id: c.id, title: c.title, nodeIds: c.nodeIds, updatedAt: c.updatedAt, preview: (c.messages.filter((m) => m.content).pop() || {}).content?.slice(0, 120) || '' })),
  }),
  action: (type, payload) =>
    new Promise((resolve) => {
      if (!win || win.isDestroyed()) return resolve({ error: 'Nodes is not open on your computer' });
      const id = Math.random().toString(36).slice(2);
      pending.set(id, resolve);
      win.webContents.send('phone:action', { id, type, payload });
      setTimeout(() => pending.has(id) && (pending.delete(id), resolve({ error: 'timeout' })), 15000);
    }),
});
ipcMain.on('phone:reply', (_e, { id, result }) => {
  const r = pending.get(id);
  if (r) {
    pending.delete(id);
    r(result);
  }
});
ipcMain.on('phone:push', (_e, event, payload) => phone.broadcast(event, payload));
ipcMain.handle('phone:info', () => phone.info());
ipcMain.handle('phone:enable', async (_e, on) => {
  data.settings.phoneEnabled = !!on;
  save();
  if (on) {
    await phone.start();
    phone.newPairCode();
  } else phone.stop();
  return phoneInfoWithQr();
});
ipcMain.handle('phone:newcode', () => {
  phone.newPairCode();
  return phoneInfoWithQr();
});
ipcMain.handle('phone:revoke', (_e, id) => {
  phone.revoke(id);
  return phoneInfoWithQr();
});
async function phoneInfoWithQr() {
  const info = phone.info();
  if (info.pairUrl) info.qr = await QRCode.toString(info.pairUrl, { type: 'svg', margin: 1, color: { dark: '#0b0c0f', light: '#ffffff' } });
  return info;
}

// ---------------- IPC ----------------
const running = new Map();

ipcMain.handle('state:get', () => publicState());
ipcMain.handle('conv:save', (_e, conv) => {
  const i = data.conversations.findIndex((c) => c.id === conv.id);
  if (i === -1) data.conversations.unshift(conv);
  else data.conversations[i] = conv;
  save();
  return true;
});
ipcMain.handle('conv:saveAll', (_e, convs) => {
  data.conversations = convs;
  save();
  return true;
});
ipcMain.handle('conv:delete', (_e, id) => {
  data.conversations = data.conversations.filter((c) => c.id !== id);
  save();
  return true;
});
ipcMain.handle('node:save', (_e, node) => {
  const i = data.nodes.findIndex((a) => a.id === node.id);
  if (i === -1) data.nodes.push(node);
  else data.nodes[i] = node;
  save();
  return data.nodes;
});
ipcMain.handle('node:setAll', (_e, nodes) => {
  data.nodes = nodes;
  save();
  return data.nodes;
});
ipcMain.handle('node:delete', (_e, id) => {
  data.nodes = data.nodes.filter((a) => a.id !== id);
  save();
  return data.nodes;
});
ipcMain.handle('node:reset', (_e, id) => {
  const def = NODES.find((a) => a.id === id);
  const i = data.nodes.findIndex((a) => a.id === id);
  if (def && i >= 0) data.nodes[i] = { ...def, builtIn: true };
  save();
  return data.nodes;
});
ipcMain.handle('provider:update', (_e, id, patch) => {
  data.providers[id] = { ...data.providers[id], ...patch, extra: { ...(data.providers[id].extra || {}), ...(patch.extra || {}) } };
  engine.clearCooldowns(id);
  save();
  return publicState();
});
ipcMain.handle('provider:order', (_e, order) => {
  data.providerOrder = order.filter((id) => byId[id]);
  save();
  return publicState();
});
ipcMain.handle('key:set', (_e, id, value) => {
  if (value) keys[id] = String(value).trim();
  else delete keys[id];
  saveKeys();
  engine.clearCooldowns(id);
  if (value && data.providers[id]) data.providers[id].enabled = true;
  save();
  return publicState();
});
ipcMain.handle('provider:models', async (_e, id) => {
  const p = byId[id];
  const ids = await engine.fetchModels(p, data.providers[id], keys[id]);
  data.providers[id].models = ids;
  if (ids.length && !ids.includes(data.providers[id].defaultModel)) data.providers[id].defaultModel = p.models.find((m) => ids.includes(m)) || ids[0];
  save();
  return publicState();
});
ipcMain.handle('provider:test', async (_e, id, model) => {
  const p = byId[id];
  const started = Date.now();
  engine.clearCooldowns(id);
  try {
    const r = await engine.attempt({
      provider: p, cfg: data.providers[id], key: keys[id], model: model || data.providers[id].defaultModel || p.models[0],
      system: 'Reply with exactly: OK', messages: [{ role: 'user', content: 'Say OK.' }], temperature: 0,
      signal: new AbortController().signal, timeouts: { first: 40, idle: 40 }, emit: () => {}, cwd: os.homedir(),
    });
    bumpStat(id, true, Date.now() - started);
    save();
    return { ok: true, ms: Date.now() - started, reply: r.text.slice(0, 80) };
  } catch (e) {
    bumpStat(id, false, 0);
    save();
    return { ok: false, reason: e.message };
  }
});
ipcMain.handle('cli:scan', async () => {
  applyCliScan(await cli.scan());
  save();
  return publicState();
});
ipcMain.handle('cli:terminal', async (_e, id, which) => {
  const c = cli.CLIS.find((x) => x.id === id);
  if (!c) return false;
  if (id === 'ollama-app' && which === 'install') {
    shell.openExternal('https://ollama.com/download');
    return true;
  }
  await cli.openInTerminal(which === 'install' ? c.install : c.login, `${which === 'install' ? 'Install' : 'Sign in to'} ${c.name}`);
  return true;
});
ipcMain.handle('search:update', (_e, patch) => {
  data.search = { ...data.search, ...patch };
  save();
  return publicState();
});
ipcMain.handle('search:key', (_e, id, value) => {
  if (value) keys['search:' + id] = String(value).trim();
  else delete keys['search:' + id];
  saveKeys();
  return publicState();
});
ipcMain.handle('search:test', async (_e, q) => {
  const cfg = searchCfg();
  return search(q || 'electron app framework', cfg);
});
ipcMain.handle('settings:update', (_e, patch) => {
  data.settings = { ...data.settings, ...patch };
  save();
  return data.settings;
});
ipcMain.handle('memory:get', () => ({ text: readMemory(), path: memoryFile() }));
ipcMain.handle('memory:set', (_e, text) => {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(memoryFile(), text);
  return true;
});
ipcMain.handle('memory:append', (_e, line) => {
  let t = readMemory();
  if (!/## Things to remember/.test(t)) t += '\n## Things to remember\n';
  t = t.replace(/(## Things to remember\n)/, `$1- ${String(line).replace(/\n+/g, ' ').trim()}\n`);
  fs.writeFileSync(memoryFile(), t);
  return true;
});
ipcMain.handle('usage:clear', (_e, id) => {
  if (id) delete data.usage[id];
  else data.usage = {};
  save();
  return data.usage;
});
ipcMain.handle('automations:set', (_e, list) => {
  data.automations = list;
  save();
  return data.automations;
});
ipcMain.handle('backup:export', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: `Nodes Backup ${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (canceled || !filePath) return false;
  const { stats, ...rest } = data;
  fs.writeFileSync(filePath, JSON.stringify({ app: 'Nodes', exportedAt: new Date().toISOString(), memory: readMemory(), data: rest }, null, 1));
  return filePath;
});
ipcMain.handle('backup:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (canceled || !filePaths[0]) return false;
  const j = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  if (j.app !== 'Nodes' || !j.data) throw new Error('Not a Nodes backup');
  const ids = new Set(data.conversations.map((c) => c.id));
  data.conversations = [...data.conversations, ...(j.data.conversations || []).filter((c) => !ids.has(c.id))];
  const nids = new Set(data.nodes.map((n) => n.id));
  data.nodes = [...data.nodes, ...(j.data.nodes || []).filter((n) => !nids.has(n.id))];
  data.automations = [...data.automations, ...(j.data.automations || [])];
  if (j.memory && j.memory.trim()) fs.writeFileSync(memoryFile(), j.memory);
  save();
  return true;
});
ipcMain.handle('stats:reset', () => {
  data.stats = {};
  save();
  return publicState();
});
ipcMain.handle('open:external', (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});
ipcMain.handle('reveal', (_e, p) => p && shell.showItemInFolder(p));
ipcMain.handle('export:chat', async (_e, title, markdown) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: (title || 'Chat').replace(/[/:]/g, '-') + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, markdown);
  return true;
});
ipcMain.handle('folder:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], message: 'Choose the project folder this chat works in' });
  return canceled ? null : filePaths[0];
});
ipcMain.handle('file:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  if (canceled) return [];
  return filePaths.map((fp) => {
    const st = fs.statSync(fp);
    if (st.size > 400 * 1024) return { name: path.basename(fp), error: 'too large (max 400 KB)' };
    const buf = fs.readFileSync(fp);
    if (buf.includes(0)) return { name: path.basename(fp), error: 'not a text file' };
    return { name: path.basename(fp), text: buf.toString('utf8') };
  });
});

function searchCfg() {
  const k = {};
  for (const e of SEARCH_ENGINES) if (keys['search:' + e.id]) k[e.id] = keys['search:' + e.id];
  return { order: data.search.order, enabled: data.search.enabled || {}, keys: k, extra: data.search.extra || {} };
}

ipcMain.handle('chat:start', async (e, req) => {
  const { reqId, nodeId, pinned } = req;
  const web = req.web && !data.settings.localOnly;
  const node = data.nodes.find((a) => a.id === nodeId) || data.nodes[0];
  const ctrl = new AbortController();
  running.set(reqId, ctrl);
  let outChars = 0;
  const emit = (ev) => {
    if (ev.type === 'delta') outChars += ev.text.length;
    if (ev.type === 'usage') {
      const prev = data.usage[ev.provider] || {};
      const u = (data.usage[ev.provider] = { ...prev, at: Date.now() });
      if (ev.exhausted) Object.assign(u, { exhausted: true, reason: ev.reason, pct: 0 });
      else if (u.pct == null || ev.pct < u.pct || Date.now() - (prev.at || 0) > 60000 || prev.exhausted) Object.assign(u, { exhausted: false, pct: ev.pct, remaining: ev.remaining, limit: ev.limit, kind: ev.kind });
      ev = { ...ev, low: u.exhausted || u.pct < 0.15 };
      if (!ev.low) return;
    }
    if (!e.sender.isDestroyed()) e.sender.send('chat:event', { reqId, ...ev });
  };
  let redacted = 0;
  if (data.settings.redactSecrets) {
    req.messages = req.messages.map((m) => {
      const r = redact(m.content);
      redacted += r.n;
      return { ...m, content: r.out };
    });
    if (redacted) emit({ type: 'tool', text: `Redact(${redacted} secret${redacted === 1 ? '' : 's'} hidden before sending)` });
  }
  const messages = req.messages;

  const callMe = data.settings.callMe || data.settings.userName || 'the user';
  let system = (node.system || '').replace(/\{CALLME\}/g, callMe);
  system += `\n\nThe user's name is ${data.settings.userName || 'not set'}; address them as "${callMe}" when it's natural. Today is ${new Date().toDateString()}.`;
  const mem = memoryForPrompt();
  if (mem && mem.replace(/##.*$/gm, '').trim()) system += `\n\nMEMORY.txt (what ${callMe} wants every node to know; use it when relevant, never recite it):\n${mem}`;
  if (req.folder) system += `\n\nThe chat's project folder is ${req.folder}.`;
  if (req.roomNote) system += '\n\n' + req.roomNote;

  let sources = [];
  if (web) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      emit({ type: 'tool', text: 'WebSearch(' + lastUser.content.split('\n\n[Attached file')[0].slice(0, 60) + ')' });
      const q = lastUser.content.split('\n\n[Attached file')[0].slice(0, 300);
      const r = await search(q, searchCfg());
      sources = r.results;
      emit({ type: 'sources', sources, engine: r.engine, pageUrl: r.pageUrl });
      if (sources.length) {
        let pages = [];
        if (data.settings.readPages) {
          emit({ type: 'tool', text: `ReadPages(${Math.min(3, sources.length)} results)` });
          pages = await Promise.all(sources.slice(0, 3).map((s) => readPage(s.url)));
        }
        system += '\n\nWeb results for the latest message (cite as [n] when you use them):\n' + sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.snippet}${pages[i] ? `\nPage text: ${pages[i]}` : ''}`).join('\n\n');
      }
    }
  }
  emit({ type: 'system', chars: system.length });

  let chain = engine.buildChain({
    agent: req.noFallback ? { ...node, engines: [], autoFallback: false } : node, pinned, providerCfgs: data.providers, providerOrder: data.providerOrder, keys, autoFallback: data.settings.autoFallback,
  });
  if (data.settings.localOnly) {
    chain = chain.filter((c) => byId[c.provider].local);
    if (!chain.length) {
      for (const id of ['ollama', 'lmstudio']) if (engine.usable(byId[id], { ...data.providers[id], enabled: true }, null)) chain.push({ provider: id, model: data.providers[id].defaultModel });
      if (!chain.length) chain = [{ provider: 'ollama', model: data.providers.ollama.defaultModel || 'llama3.2' }];
    }
  }
  // Engines known to be out of quota go last.
  chain = [...chain.filter((c) => !data.usage[c.provider]?.exhausted || Date.now() - data.usage[c.provider].at > 30 * 60000 || c === chain[0] && pinned), ...chain.filter((c) => data.usage[c.provider]?.exhausted && Date.now() - data.usage[c.provider].at <= 30 * 60000 && !(c === chain[0] && pinned))];
  if (!chain.length) {
    running.delete(reqId);
    return { ok: false, attempts: [], noProviders: true, sources };
  }
  const result = await engine.run({
    chain, providerCfgs: data.providers, keys, system, messages, temperature: node.temperature ?? 0.5, signal: ctrl.signal,
    timeouts: { first: data.settings.firstTokenTimeout, idle: data.settings.idleTimeout }, emit, maxAttempts: data.settings.maxAttempts,
    cwd: req.folder || data.settings.defaultFolder || os.homedir(), allowEdits: !!req.allowEdits,
  });
  running.delete(reqId);
  const inTok = Math.round((system.length + messages.reduce((n, m) => n + m.content.length, 0)) / 3.7);
  for (const a of result.attempts) bumpStat(a.provider, a.ok, a.ms, inTok, a.ok ? Math.round(outChars / 3.7) : 0);
  if (result.ok && data.usage[result.provider]?.exhausted) data.usage[result.provider].exhausted = false;
  save();
  return { ...result, sources, text: undefined, systemChars: system.length, ctx: result.ok ? contextWindow(result.provider, result.model) : null };
});
ipcMain.handle('chat:stop', (_e, reqId) => {
  const c = running.get(reqId);
  if (c) c.abort();
  return true;
});

app.whenReady().then(async () => {
  load();
  if (!fs.existsSync(memoryFile())) fs.writeFileSync(memoryFile(), MEMORY_TEMPLATE);
  phone.devices = data.devices;
  buildMenu();
  createWindow();
  cli.scan().then((s) => {
    applyCliScan(s);
    save();
    if (win && !win.isDestroyed()) win.webContents.send('state:refresh');
  });
  if (data.settings.phoneEnabled) phone.start();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('before-quit', () => {
  phone.stop();
  if (data) flush();
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
