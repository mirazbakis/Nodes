// Screen control for nodes: see the screen, move the mouse, click, type, press keys, scroll,
// open apps and list windows. Uses only what ships with the OS, so nothing needs compiling:
//   macOS   : Electron desktopCapturer for screenshots; osascript (JXA) posting CoreGraphics events
//             for input; the Accessibility API for window text; `open -a` for apps.
//   Windows : Electron desktopCapturer; PowerShell with user32 SendInput / SetCursorPos and
//             UI Automation (never cmd.exe).
//   Others  : every call returns a plain "not supported" result.
//
// Coordinates: everything a node sees and sends is in the pixels of the last screenshot of the
// chosen display (or the size a screenshot would have). They are mapped back to real screen
// coordinates with the scale kept from that capture.
//
// One node controls the screen at a time. stop() aborts the current and any queued actions
// immediately (kills the helper process) and refuses further actions from that reply.
const { spawn } = require('child_process');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const SUPPORTED = IS_MAC || IS_WIN;
const MAX_W = 1280;

let E;
function el() {
  if (E === undefined) {
    try {
      E = require('electron');
      if (!E || typeof E !== 'object' || !E.screen) E = null;
    } catch {
      E = null;
    }
  }
  return E;
}

const S = {
  dry: !!process.env.NODES_SCREEN_DRY_RUN, // build and validate input commands, never post them
  owner: null, // { id, node } of the reply controlling the screen
  stopped: new Set(), // reply ids the user stopped
  ctrl: new AbortController(),
  queue: Promise.resolve(),
  geom: null, // { display, id, bounds, w, h }
  listeners: new Set(),
};

const SETTINGS = {
  screen: IS_MAC ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' : '',
  accessibility: IS_MAC ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility' : '',
};

class ScreenError extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra);
  }
}
const notSupported = () => new ScreenError(`Screen control isn't available on this computer yet (${process.platform}). It works on macOS and Windows.`, { code: 'unsupported' });

// ---------- session ----------
function notify() {
  const st = status();
  for (const fn of S.listeners) {
    try {
      fn(st);
    } catch {}
  }
}
function status() {
  return { active: !!S.owner, node: S.owner ? S.owner.node : null, id: S.owner ? S.owner.id : null };
}
function onChange(fn) {
  S.listeners.add(fn);
  return () => S.listeners.delete(fn);
}
// Claim the screen for a reply. Returns an error string if another reply holds it.
function begin(id, node) {
  if (S.stopped.has(id)) return 'The user stopped screen control for this reply. Do not try again unless they ask you to.';
  if (S.owner && S.owner.id !== id) return `${S.owner.node} is using the screen right now. Wait for it to finish, or ask the user.`;
  if (!S.owner) {
    S.owner = { id, node: node || 'A node' };
    notify();
  }
  return null;
}
// The reply finished: release the screen.
function end(id) {
  S.stopped.delete(id);
  if (S.owner && S.owner.id === id) {
    S.owner = null;
    notify();
  }
}
// Emergency stop: abort whatever is running or queued and refuse further actions from that reply.
function stop() {
  const was = S.owner;
  if (was) S.stopped.add(was.id);
  S.ctrl.abort();
  S.ctrl = new AbortController();
  S.queue = Promise.resolve();
  S.owner = null;
  notify();
  return was;
}
const isStopped = (id) => S.stopped.has(id);

// Run actions one at a time; anything queued when stop() fires is dropped.
function enqueue(fn) {
  const signal = S.ctrl.signal;
  const p = S.queue.then(() => {
    if (signal.aborted) throw new ScreenError('Stopped by the user.', { code: 'stopped' });
    return fn(signal);
  });
  S.queue = p.catch(() => {});
  return p;
}

// ---------- permissions ----------
function permissions() {
  if (!SUPPORTED) return { supported: false, screen: false, accessibility: false };
  if (!IS_MAC) return { supported: true, screen: true, accessibility: true };
  const e = el();
  const sp = e && e.systemPreferences;
  let screen = true;
  let accessibility = true;
  try {
    if (sp) screen = sp.getMediaAccessStatus('screen') === 'granted';
  } catch {}
  try {
    if (sp) accessibility = sp.isTrustedAccessibilityClient(false);
  } catch {}
  return { supported: true, screen, accessibility };
}
const MISSING = {
  screen: 'Nodes needs Screen Recording permission to see your screen. Turn on Nodes in System Settings > Privacy & Security > Screen & System Audio Recording, then quit and reopen Nodes.',
  accessibility: 'Nodes needs Accessibility permission to click and type for you. Turn on Nodes in System Settings > Privacy & Security > Accessibility.',
};
function need(kind) {
  if (!SUPPORTED) throw notSupported();
  const p = permissions();
  if (!p[kind]) throw new ScreenError(MISSING[kind], { code: 'permission', need: kind });
}
function openSettings(kind) {
  const url = SETTINGS[kind];
  const e = el();
  if (url && e && e.shell) e.shell.openExternal(url);
  return !!url;
}

// ---------- displays and coordinates ----------
function displays() {
  const e = el();
  if (!e) return [];
  const prim = e.screen.getPrimaryDisplay().id;
  return e.screen.getAllDisplays().map((d, i) => ({ index: i + 1, id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor, primary: d.id === prim }));
}
function pickDisplay(n) {
  const all = displays();
  if (!all.length) throw new ScreenError('Could not find a display.');
  if (n != null && n !== '') {
    const d = all[Number(n) - 1];
    if (!d) throw new ScreenError(`There is no display ${n}. Displays: ${all.map((x) => x.index).join(', ')}.`);
    return d;
  }
  if (S.geom) {
    const same = all.find((x) => x.id === S.geom.id);
    if (same) return same;
  }
  return all.find((x) => x.primary) || all[0];
}
function sizeFor(b) {
  const k = Math.min(1, MAX_W / b.width);
  return { w: Math.round(b.width * k), h: Math.round(b.height * k) };
}
function geomFor(n) {
  const d = pickDisplay(n);
  if (S.geom && S.geom.id === d.id && S.geom.bounds.width === d.bounds.width && S.geom.bounds.height === d.bounds.height) return S.geom;
  const { w, h } = sizeFor(d.bounds);
  return (S.geom = { display: d.index, id: d.id, bounds: d.bounds, w, h });
}
// Screenshot pixels -> global screen coordinates (points on macOS, physical pixels on Windows).
function toScreen(x, y, n) {
  const g = geomFor(n);
  x = Number(x);
  y = Number(y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new ScreenError('x and y must be numbers (pixels in the screenshot).');
  if (x < 0 || y < 0 || x > g.w || y > g.h) throw new ScreenError(`(${x}, ${y}) is outside the screen, which is ${g.w}x${g.h} in screenshot pixels.`);
  const p = { x: Math.round(g.bounds.x + (x * g.bounds.width) / g.w), y: Math.round(g.bounds.y + (y * g.bounds.height) / g.h) };
  const e = el();
  if (IS_WIN && e && e.screen.dipToScreenPoint) return e.screen.dipToScreenPoint(p);
  return p;
}
// Global screen coordinates -> screenshot pixels, or null when off the current display.
function fromScreen(x, y, g) {
  const e = el();
  if (IS_WIN && e && e.screen.screenToDipPoint) ({ x, y } = e.screen.screenToDipPoint({ x, y }));
  const b = g.bounds;
  if (x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) return null;
  return [Math.round(((x - b.x) * g.w) / b.width), Math.round(((y - b.y) * g.h) / b.height)];
}

// ---------- capture ----------
async function capture({ display } = {}) {
  if (!SUPPORTED) throw notSupported();
  need('screen');
  const e = el();
  if (!e || !e.desktopCapturer) throw new ScreenError('Screen capture needs the Nodes app.');
  const d = pickDisplay(display);
  const { w, h } = sizeFor(d.bounds);
  const sources = await e.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[d.index - 1] || sources[0];
  if (!src || !src.thumbnail || src.thumbnail.isEmpty()) {
    if (IS_MAC) throw new ScreenError(MISSING.screen, { code: 'permission', need: 'screen' });
    throw new ScreenError('Could not take a screenshot.');
  }
  const img = src.thumbnail;
  const size = img.getSize();
  S.geom = { display: d.index, id: d.id, bounds: d.bounds, w: size.width, h: size.height };
  return { mime: 'image/jpeg', data: img.toJPEG(70).toString('base64'), width: size.width, height: size.height, display: d.index, displays: displays().length };
}

// ---------- helper processes ----------
function runProc(cmd, args, { input, env, signal, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new ScreenError('Stopped by the user.', { code: 'stopped' }));
    const child = spawn(cmd, args, { env: env ? { ...process.env, ...env } : process.env, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const kill = () => child.kill('SIGKILL');
    const t = setTimeout(kill, timeout);
    const onAbort = () => kill();
    signal && signal.addEventListener('abort', onAbort);
    child.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(t);
      signal && signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) return reject(new ScreenError('Stopped by the user.', { code: 'stopped' }));
      if (code !== 0) return reject(new ScreenError((err || out || `helper exited with ${code}`).trim().slice(0, 400)));
      resolve(out.trim());
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}
const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
};

// ---------- macOS (JXA + CoreGraphics) ----------
const MAC_KEYS = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26, '-': 27, 8: 28, 0: 29, ']': 30, o: 31, u: 32, '[': 33,
  i: 34, p: 35, return: 36, enter: 36, l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46,
  '.': 47, tab: 48, space: 49, '`': 50, backspace: 51, delete: 51, escape: 53, esc: 53,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  home: 115, pageup: 116, forwarddelete: 117, del: 117, end: 119, pagedown: 121, left: 123, right: 124, down: 125, up: 126,
};
const MAC_MODS = { cmd: 0x100000, command: 0x100000, meta: 0x100000, super: 0x100000, win: 0x100000, ctrl: 0x40000, control: 0x40000, alt: 0x80000, option: 0x80000, opt: 0x80000, shift: 0x20000, fn: 0x800000 };

function parseCombo(combo, keys, mods) {
  const parts = String(combo || '').toLowerCase().replace(/\s+/g, '').split('+').filter(Boolean);
  if (!parts.length) throw new ScreenError('Give a key, like "enter", "cmd+c" or "ctrl+shift+t".');
  const key = parts.pop();
  const alias = { arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down', pgup: 'pageup', pgdn: 'pagedown', ret: 'return', '⌘': 'cmd' };
  const k = alias[key] || key;
  if (!(k in keys)) throw new ScreenError(`Unknown key "${key}". Use letters, digits, enter, tab, space, escape, backspace, delete, arrows (left/right/up/down), home, end, pageup, pagedown or f1-f12.`);
  let flags = [];
  for (const m of parts) {
    const mm = alias[m] || m;
    if (!(mm in mods)) throw new ScreenError(`Unknown modifier "${m}". Use cmd, ctrl, alt/option, shift${IS_WIN ? ' or win' : ''}.`);
    flags.push(mods[mm]);
  }
  return { key: keys[k], mods: flags };
}

const MAC_PRELUDE = `ObjC.import('CoreGraphics'); ObjC.import('AppKit');
const LOG = [];
const post = (e, what) => { if (DRY) { LOG.push(what); return; } $.CGEventPost(0, e); };
const pt = (x, y) => $.CGPointMake(x, y);
const pause = (s) => { if (!DRY) delay(s); };
function mouse(type, x, y, btn, clicks, what) {
  const e = $.CGEventCreateMouseEvent(null, type, pt(x, y), btn);
  if (clicks) $.CGEventSetIntegerValueField(e, 1, clicks);
  post(e, what);
}
function cur() { const p = $.CGEventGetLocation($.CGEventCreate(null)); return [Math.round(p.x), Math.round(p.y)]; }
function key(code, flags, down) {
  const e = $.CGEventCreateKeyboardEvent(null, code, down);
  $.CGEventSetFlags(e, flags);
  post(e, (down ? 'keydown ' : 'keyup ') + code + (flags ? ' flags ' + flags : ''));
}
function uni(ch) {
  const r = Ref('S'); r[0] = ch;
  for (const down of [true, false]) {
    const e = $.CGEventCreateKeyboardEvent(null, 0, down);
    $.CGEventKeyboardSetUnicodeString(e, 1, r);
    if (DRY) { const back = $.NSEvent.eventWithCGEvent(e).characters.js; LOG.push((down ? 'char ' : 'charup ') + back); } else $.CGEventPost(0, e);
  }
}
`;

// Each action becomes a small JXA program; arguments are embedded as JSON, never as code.
function macScript(action, a, dry) {
  const BTN = { left: [1, 2, 0], right: [3, 4, 1], middle: [25, 26, 2] };
  let body;
  switch (action) {
    case 'move':
      body = `mouse(5, A.x, A.y, 0, 0, 'move ' + A.x + ',' + A.y);`;
      break;
    case 'click': {
      const [down, up, btn] = BTN[a.button] || BTN.left;
      body = `mouse(5, A.x, A.y, 0, 0, 'move ' + A.x + ',' + A.y); pause(0.05);
for (let i = 1; i <= A.count; i++) { mouse(${down}, A.x, A.y, ${btn}, i, 'down ${a.button || 'left'} ' + A.x + ',' + A.y + ' #' + i); pause(0.02); mouse(${up}, A.x, A.y, ${btn}, i, 'up #' + i); pause(0.06); }`;
      break;
    }
    case 'drag':
      body = `mouse(5, A.x1, A.y1, 0, 0, 'move ' + A.x1 + ',' + A.y1); pause(0.05);
mouse(1, A.x1, A.y1, 0, 1, 'down ' + A.x1 + ',' + A.y1); pause(0.08);
for (let i = 1; i <= 20; i++) { const x = A.x1 + (A.x2 - A.x1) * i / 20, y = A.y1 + (A.y2 - A.y1) * i / 20; mouse(6, x, y, 0, 1, 'drag ' + Math.round(x) + ',' + Math.round(y)); pause(0.015); }
pause(0.08); mouse(2, A.x2, A.y2, 0, 1, 'up ' + A.x2 + ',' + A.y2);`;
      break;
    case 'scroll':
      body = `if (A.x != null) { mouse(5, A.x, A.y, 0, 0, 'move ' + A.x + ',' + A.y); pause(0.05); }
for (let i = 0; i < A.steps; i++) { const e = $.CGEventCreateScrollWheelEvent2(null, 1, 2, A.dy, A.dx, 0); post(e, 'scroll ' + A.dy + ',' + A.dx); pause(0.03); }`;
      break;
    case 'type':
      body = `let skipped = 0;
for (const c of A.text) {
  const code = c.codePointAt(0);
  if (c === '\\n') { key(36, 0, true); key(36, 0, false); }
  else if (c === '\\t') { key(48, 0, true); key(48, 0, false); }
  else if (code > 0xffff) { skipped++; continue; }
  else uni(code);
  pause(0.012);
}
OUT.skipped = skipped;`;
      break;
    case 'key':
      body = `for (let n = 0; n < A.repeat; n++) {
  let flags = 0;
  for (const m of A.mods) { flags |= m; key(${'{ 1048576: 55, 262144: 59, 524288: 58, 131072: 56, 8388608: 63 }'}[m], flags, true); }
  key(A.key, flags, true); pause(0.02); key(A.key, flags, false);
  for (const m of A.mods.slice().reverse()) { flags &= ~m; key(${'{ 1048576: 55, 262144: 59, 524288: 58, 131072: 56, 8388608: 63 }'}[m], flags, false); }
  pause(0.05);
}`;
      break;
    default:
      throw new ScreenError(`Unknown action ${action}`);
  }
  return `const DRY = ${dry ? 'true' : 'false'}; const A = ${JSON.stringify(a)}; const OUT = {};
${MAC_PRELUDE}
${body}
OUT.ok = true; OUT.cursor = cur(); if (DRY) OUT.log = LOG;
JSON.stringify(OUT);`;
}

// Frontmost app, visible windows and (when allowed) the focused window's accessibility text.
const MAC_DESCRIBE = `ObjC.import('AppKit'); ObjC.import('CoreGraphics'); ObjC.import('ApplicationServices');
const t0 = Date.now();
const OUT = {};
const fa = $.NSWorkspace.sharedWorkspace.frontmostApplication;
OUT.front = fa.localizedName.js; const pid = fa.processIdentifier;
const wins = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
OUT.windows = wins.filter((w) => w.kCGWindowLayer === 0 && w.kCGWindowBounds && w.kCGWindowBounds.Width > 40 && w.kCGWindowBounds.Height > 40)
  .slice(0, 30).map((w) => ({ app: w.kCGWindowOwnerName, title: w.kCGWindowName || '', x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, w: w.kCGWindowBounds.Width, h: w.kCGWindowBounds.Height }));
if (A.ax && $.AXIsProcessTrusted()) {
  const attr = (el, n) => { const r = Ref(); if ($.AXUIElementCopyAttributeValue(el, $(n), r) !== 0) return null; return ObjC.castRefToObject(r[0]); };
  const str = (v) => { if (!v) return ''; try { const u = ObjC.unwrap(v); return typeof u === 'string' ? u : typeof u === 'number' ? String(u) : ''; } catch (e) { return ''; } };
  const nums = (v) => { if (!v) return null; const m = String(v.description.js).match(/[xw]:(-?[\\d.]+) [yh]:(-?[\\d.]+)/); return m ? [+m[1], +m[2]] : null; };
  const w = attr($.AXUIElementCreateApplication(pid), 'AXFocusedWindow');
  const items = []; const q = w ? [[w, 0]] : [];
  while (q.length && items.length < 90 && Date.now() - t0 < 3500) {
    const [el, d] = q.shift();
    const role = str(attr(el, 'AXRole')).replace(/^AX/, '');
    const label = (str(attr(el, 'AXTitle')) || str(attr(el, 'AXDescription')) || str(attr(el, 'AXValue')) || str(attr(el, 'AXPlaceholderValue'))).replace(/\\s+/g, ' ').trim();
    const p = nums(attr(el, 'AXPosition')), s = nums(attr(el, 'AXSize'));
    if (label && p && s && s[0] > 0 && s[1] > 0 && d > 0) items.push({ role, label: label.slice(0, 100), x: p[0] + s[0] / 2, y: p[1] + s[1] / 2 });
    if (d < 14) { const k = attr(el, 'AXChildren'); if (k) for (let i = 0; i < Math.min(k.count, 50); i++) q.push([k.objectAtIndex(i), d + 1]); }
  }
  OUT.items = items;
}
JSON.stringify(OUT);`;

// ---------- Windows (PowerShell + user32) ----------
const WIN_KEYS = {
  return: 0x0d, enter: 0x0d, tab: 0x09, space: 0x20, backspace: 0x08, delete: 0x2e, del: 0x2e, forwarddelete: 0x2e, escape: 0x1b, esc: 0x1b,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, insert: 0x2d,
  '-': 0xbd, '=': 0xbb, '[': 0xdb, ']': 0xdd, ';': 0xba, "'": 0xde, ',': 0xbc, '.': 0xbe, '/': 0xbf, '\\': 0xdc, '`': 0xc0,
};
for (let i = 0; i < 26; i++) WIN_KEYS[String.fromCharCode(97 + i)] = 0x41 + i;
for (let i = 0; i < 10; i++) WIN_KEYS[String(i)] = 0x30 + i;
for (let i = 1; i <= 12; i++) WIN_KEYS['f' + i] = 0x6f + i;
// cmd maps to Ctrl so "cmd+c" means copy on both systems.
const WIN_MODS = { ctrl: 0x11, control: 0x11, cmd: 0x11, command: 0x11, meta: 0x11, shift: 0x10, alt: 0x12, option: 0x12, opt: 0x12, win: 0x5b, super: 0x5b };

const WIN_CS = `using System; using System.Runtime.InteropServices; using System.Threading; using System.Text; using System.Collections.Generic;
public static class NI {
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int dx; public int dy; public uint data; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KI { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MI mi; [FieldOffset(0)] public KI ki; }
  [StructLayout(LayoutKind.Sequential)] public struct IN { public uint type; public U u; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, IN[] i, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static bool Dry = false;
  public static List<string> Log = new List<string>();
  static void Send(IN i, string what) { if (Dry) { Log.Add(what); return; } SendInput(1, new IN[] { i }, Marshal.SizeOf(typeof(IN))); }
  static void Wait(int ms) { if (!Dry) Thread.Sleep(ms); }
  public static void Move(int x, int y) { if (Dry) Log.Add("move " + x + "," + y); else SetCursorPos(x, y); }
  public static int[] Cursor() { POINT p; GetCursorPos(out p); return new int[] { p.X, p.Y }; }
  public static void Mouse(uint flags, int data, string what) { IN i = new IN(); i.type = 0; i.u.mi.flags = flags; i.u.mi.data = (uint)data; Send(i, what); }
  public static void Key(ushort vk, bool up) { IN i = new IN(); i.type = 1; i.u.ki.vk = vk; uint f = up ? 2u : 0u; if ((vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B) f |= 1u; i.u.ki.flags = f; Send(i, (up ? "keyup " : "keydown ") + vk); }
  public static void Char(char c) { foreach (bool up in new bool[] { false, true }) { IN i = new IN(); i.type = 1; i.u.ki.scan = c; i.u.ki.flags = 4u | (up ? 2u : 0u); Send(i, (up ? "charup " : "char ") + c); } }
  public static void Click(int x, int y, uint down, uint up, int count) { Move(x, y); Wait(50); for (int n = 1; n <= count; n++) { Mouse(down, 0, "down #" + n); Wait(20); Mouse(up, 0, "up #" + n); Wait(60); } }
  public static void Drag(int x1, int y1, int x2, int y2) { Move(x1, y1); Wait(50); Mouse(2, 0, "down"); Wait(80); for (int n = 1; n <= 20; n++) { Move(x1 + (x2 - x1) * n / 20, y1 + (y2 - y1) * n / 20); Wait(15); } Wait(80); Mouse(4, 0, "up"); }
  public static void Type(string s) { foreach (char c in s) { if (c == '\\n') { Key(0x0D, false); Key(0x0D, true); } else if (c == '\\r') { } else if (c == '\\t') { Key(0x09, false); Key(0x09, true); } else Char(c); Wait(10); } }
  public static void Combo(ushort[] mods, ushort vk, int repeat) { for (int r = 0; r < repeat; r++) { foreach (ushort m in mods) Key(m, false); Key(vk, false); Wait(20); Key(vk, true); for (int j = mods.Length - 1; j >= 0; j--) Key(mods[j], true); Wait(50); } }
}`;

// The script is fixed; the action and its arguments travel in an environment variable as JSON.
const WIN_PS = `$ErrorActionPreference = 'Stop'
$A = $env:NODES_SCREEN_ARGS | ConvertFrom-Json
Add-Type -TypeDefinition @'
${WIN_CS}
'@
[NI]::Dry = [bool]$A.dry
[void][NI]::SetProcessDPIAware()
$out = @{ ok = $true }
switch ($A.action) {
  'move' { [NI]::Move([int]$A.x, [int]$A.y) }
  'click' {
    $b = @{ left = @(2, 4); right = @(8, 16); middle = @(32, 64) }[[string]$A.button]
    if (-not $b) { $b = @(2, 4) }
    [NI]::Click([int]$A.x, [int]$A.y, [uint32]$b[0], [uint32]$b[1], [int]$A.count)
  }
  'drag' { [NI]::Drag([int]$A.x1, [int]$A.y1, [int]$A.x2, [int]$A.y2) }
  'scroll' {
    if ($A.x -ne $null) { [NI]::Move([int]$A.x, [int]$A.y); Start-Sleep -Milliseconds 50 }
    for ($i = 0; $i -lt [int]$A.steps; $i++) {
      if ([int]$A.dy -ne 0) { [NI]::Mouse(0x800, 120 * [int]$A.dy, "wheel $($A.dy)") }
      if ([int]$A.dx -ne 0) { [NI]::Mouse(0x1000, 120 * [int]$A.dx, "hwheel $($A.dx)") }
      if (-not $A.dry) { Start-Sleep -Milliseconds 30 }
    }
  }
  'type' { [NI]::Type([string]$A.text) }
  'key' { [NI]::Combo([uint16[]]@($A.mods | ForEach-Object { [uint16]$_ }), [uint16]$A.key, [int]$A.repeat) }
  'describe' {
    $fg = [NI]::GetForegroundWindow(); [uint32]$fpid = 0;[void][NI]::GetWindowThreadProcessId($fg, [ref]$fpid)
    $p = Get-Process -Id $fpid -ErrorAction SilentlyContinue
    $out.front = if ($p) { if ($p.MainWindowTitle) { "$($p.ProcessName) - $($p.MainWindowTitle)" } else { $p.ProcessName } } else { '' }
    $out.windows = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 30 | ForEach-Object {
      $r = New-Object NI+RECT; [void][NI]::GetWindowRect($_.MainWindowHandle, [ref]$r)
      @{ app = $_.ProcessName; title = $_.MainWindowTitle; x = $r.L; y = $r.T; w = $r.R - $r.L; h = $r.B - $r.T }
    })
    if ($A.ax) {
      try {
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($fg)
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $q = New-Object System.Collections.Queue; $q.Enqueue(@($root, 0)); $items = @(); $t0 = Get-Date
        while ($q.Count -gt 0 -and $items.Count -lt 90 -and ((Get-Date) - $t0).TotalMilliseconds -lt 3500) {
          $cur = $q.Dequeue(); $e = $cur[0]; $d = $cur[1]
          $c = $e.Current; $r = $c.BoundingRectangle
          if ($d -gt 0 -and $c.Name -and -not $r.IsEmpty -and $r.Width -gt 0) { $items += @{ role = $c.ControlType.ProgrammaticName -replace '^ControlType\\.', ''; label = $c.Name.Substring(0, [Math]::Min(100, $c.Name.Length)); x = $r.X + $r.Width / 2; y = $r.Y + $r.Height / 2 } }
          if ($d -lt 14) { $k = $walker.GetFirstChild($e); $n = 0; while ($k -ne $null -and $n -lt 50) { $q.Enqueue(@($k, ($d + 1))); $k = $walker.GetNextSibling($k); $n++ } }
        }
        $out.items = $items
      } catch { }
    }
  }
  'open' {
    $name = [string]$A.name
    $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like "*$name*" -or $_.MainWindowTitle -like "*$name*") } | Select-Object -First 1
    if ($p) {
      $out.focused = "$($p.ProcessName) - $($p.MainWindowTitle)"
      if (-not $A.dry) { if ([NI]::IsIconic($p.MainWindowHandle)) { [void][NI]::ShowWindow($p.MainWindowHandle, 9) }; [void][NI]::SetForegroundWindow($p.MainWindowHandle) }
    } else {
      $out.started = $name
      if (-not $A.dry) { Start-Process -FilePath $name }
    }
  }
}
if ($A.dry) { $out.log = @([NI]::Log) }
$c = [NI]::Cursor(); $out.cursor = @($c[0], $c[1])
$out | ConvertTo-Json -Compress -Depth 5`;

function winCommand(action, a) {
  const enc = Buffer.from(WIN_PS, 'utf16le').toString('base64');
  return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], env: { NODES_SCREEN_ARGS: JSON.stringify({ ...a, action, dry: !!S.dry }) } };
}

// ---------- platform dispatch ----------
async function exec(action, a, signal) {
  if (IS_MAC) {
    const script = macScript(action, a, S.dry);
    return parse(await runProc('/usr/bin/osascript', ['-l', 'JavaScript', '-'], { input: script, signal, timeout: action === 'type' ? 120000 : 20000 }));
  }
  const c = winCommand(action, a);
  return parse(await runProc(c.cmd, c.args, { env: c.env, signal, timeout: action === 'type' ? 120000 : 30000 }));
}

// Public input actions. Coordinates are screenshot pixels; `display` picks the display (1-based).
function input(action, a = {}) {
  if (!SUPPORTED) return Promise.reject(notSupported());
  return enqueue(async (signal) => {
    need('accessibility');
    let p;
    switch (action) {
      case 'move': {
        const s = toScreen(a.x, a.y, a.display);
        p = { x: s.x, y: s.y };
        break;
      }
      case 'click': {
        const s = toScreen(a.x, a.y, a.display);
        const button = ['left', 'right', 'middle'].includes(a.button) ? a.button : 'left';
        p = { x: s.x, y: s.y, button, count: Math.max(1, Math.min(3, Number(a.count) || 1)) };
        break;
      }
      case 'drag': {
        const s1 = toScreen(a.x1 ?? a.from_x, a.y1 ?? a.from_y, a.display);
        const s2 = toScreen(a.x2 ?? a.to_x, a.y2 ?? a.to_y, a.display);
        p = { x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y };
        break;
      }
      case 'scroll': {
        const dir = String(a.direction || 'down');
        const amount = Math.max(1, Math.min(25, Number(a.amount) || 5));
        p = { dy: dir === 'down' ? -1 : dir === 'up' ? 1 : 0, dx: dir === 'right' ? -1 : dir === 'left' ? 1 : 0, steps: amount };
        if (IS_WIN) p.dx = -p.dx; // macOS wheel 2 is positive for left; Windows HWHEEL is positive for right
        if (a.x != null && a.y != null) Object.assign(p, toScreen(a.x, a.y, a.display));
        break;
      }
      case 'type': {
        const text = String(a.text ?? '');
        if (!text) throw new ScreenError('Nothing to type.');
        if (text.length > 4000) throw new ScreenError('That is too much text to type at once (4000 characters max). Split it up.');
        p = { text };
        break;
      }
      case 'key': {
        const k = parseCombo(a.keys || a.key, IS_WIN ? WIN_KEYS : MAC_KEYS, IS_WIN ? WIN_MODS : MAC_MODS);
        p = { key: k.key, mods: k.mods, repeat: Math.max(1, Math.min(20, Number(a.repeat) || 1)) };
        break;
      }
      default:
        throw new ScreenError(`Unknown screen action "${action}".`);
    }
    const r = await exec(action, p, signal);
    if (r.cursor && S.geom) {
      const c = fromScreen(r.cursor[0], r.cursor[1], S.geom);
      r.cursor = c;
    }
    return r;
  });
}

// Open an app by name, or bring it to the front if it is already running.
function openApp(name) {
  if (!SUPPORTED) return Promise.reject(notSupported());
  name = String(name || '').trim();
  if (!name || name.length > 120 || /^-|[\0\n\r]/.test(name)) return Promise.reject(new ScreenError('Give the app name, like "Safari" or "Notes".'));
  return enqueue(async (signal) => {
    if (IS_MAC) {
      if (S.dry) return { ok: true, dry: true, command: ['/usr/bin/open', '-a', name] };
      try {
        await runProc('/usr/bin/open', ['-a', name], { signal });
      } catch (e) {
        if (e.code === 'stopped') throw e;
        throw new ScreenError(`Couldn't find an app called "${name}".`);
      }
      return { ok: true, opened: name };
    }
    const c = winCommand('open', { name });
    return parse(await runProc(c.cmd, c.args, { env: c.env, signal }));
  });
}

// Text description of the screen: frontmost app, windows, and (ax=true) labelled controls of the
// focused window with their centres in screenshot pixels.
async function describe({ ax = false, display } = {}) {
  if (!SUPPORTED) throw notSupported();
  const g = geomFor(display);
  const trusted = permissions().accessibility;
  let r;
  if (IS_MAC) r = parse(await runProc('/usr/bin/osascript', ['-l', 'JavaScript', '-'], { input: `const A = ${JSON.stringify({ ax: ax && trusted })};\n${MAC_DESCRIBE}`, timeout: 12000, signal: S.ctrl.signal }));
  else {
    const c = winCommand('describe', { ax });
    r = parse(await runProc(c.cmd, c.args, { env: c.env, timeout: 20000, signal: S.ctrl.signal }));
  }
  const lines = [`Display ${g.display} of ${displays().length}, ${g.w}x${g.h} screenshot pixels.`, `Frontmost app: ${r.front || 'unknown'}.`];
  const wins = (r.windows || []).map((w) => {
    const a = fromScreen(w.x, w.y, g);
    const b = fromScreen(w.x + w.w, w.y + w.h, g);
    const where = a && b ? ` at (${a[0]}, ${a[1]})-(${b[0]}, ${b[1]})` : a ? ` from (${a[0]}, ${a[1]})` : ' (on another display)';
    return `- ${w.app}${w.title ? ': ' + w.title : ''}${where}`;
  });
  if (wins.length) lines.push('Windows, front to back:', ...wins);
  if (ax) {
    const items = (r.items || []).map((i) => ({ ...i, at: fromScreen(i.x, i.y, g) })).filter((i) => i.at);
    if (items.length) lines.push('Controls in the focused window (click their centres):', ...items.map((i) => `- ${i.role} "${i.label}" at (${i.at[0]}, ${i.at[1]})`));
    else if (IS_MAC && !trusted) lines.push('(Control labels need Accessibility permission.)');
    else lines.push('(This window does not expose readable controls.)');
  }
  return lines.join('\n');
}

function setDryRun(v) {
  S.dry = !!v;
}

module.exports = {
  SUPPORTED, ScreenError, MISSING,
  permissions, openSettings, displays, capture, describe, input, openApp,
  begin, end, stop, isStopped, status, onChange, setDryRun,
  // for tests
  _macScript: macScript, _winCommand: winCommand, _parseCombo: parseCombo, _WIN_PS: WIN_PS, _keys: { MAC_KEYS, MAC_MODS, WIN_KEYS, WIN_MODS },
};
