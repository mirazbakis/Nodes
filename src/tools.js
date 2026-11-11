// Tools every node can use on the user's computer. Changes go through the chat's permission mode:
//   ask  = "Ask me"      : reading is free, every change asks first
//   edit = "Auto-edit"   : files change freely in the workspace, commands ask first
//   plan = "Plan first"  : nothing changes, the node proposes a plan
//   full = "Full trust"  : everything runs without asking
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const connectors = require('./connectors');
const screen = require('./screen');

const IS_WIN = process.platform === 'win32';
const S = (props, req = []) => ({ type: 'object', properties: props, required: req });
const str = (d) => ({ type: 'string', description: d });

function defs({ web, connected }) {
  const t = [
    { name: 'ask_user', description: 'Ask the user a question with tappable answers. Use it when the request is ambiguous, or before bigger work to confirm the approach. Keep options short (2-4). Wait for the answer before continuing.', parameters: S({ question: str('The question, one sentence'), options: { type: 'array', items: { type: 'string' }, description: '2-4 short answer choices' }, allow_other: { type: 'boolean', description: 'Let the user type their own answer (default true)' } }, ['question', 'options']) },
    { name: 'list_files', description: 'List files and folders in the workspace (or a sub-folder).', parameters: S({ path: str('Folder, relative to the workspace. Default "."') }) },
    { name: 'read_file', description: 'Read a text file from the workspace.', parameters: S({ path: str('File path, relative to the workspace') }, ['path']) },
    { name: 'write_file', description: 'Create or overwrite a file in the workspace. Creates folders as needed.', parameters: S({ path: str('File path, relative to the workspace'), content: str('Full file contents') }, ['path', 'content']) },
    { name: 'edit_file', description: 'Replace exact text in a file. "find" must match exactly once.', parameters: S({ path: str('File path'), find: str('Exact text to replace'), replace: str('New text') }, ['path', 'find', 'replace']) },
    { name: 'run_command', description: `Run a shell command in the workspace (${IS_WIN ? 'cmd.exe' : 'zsh'}). Use for installs, builds, tests and git. Times out after 3 minutes.`, parameters: S({ command: str('The command to run') }, ['command']) },
    { name: 'preview_site', description: 'Start a localhost preview of a website in the workspace and show it to the user in the browser panel. Uses Docker if the project has a Dockerfile or compose file, otherwise serves the folder directly.', parameters: S({ path: str('Folder with the site, relative to the workspace. Default "."') }) },
    { name: 'react', description: "Add a tapback reaction to the user's last message, like iMessage. Use sparingly, when it feels natural.", parameters: S({ emoji: { type: 'string', enum: ['❤️', '👍', '👎', '😂', '‼️', '❓'], description: 'The reaction' } }, ['emoji']) },
  ];
  if (web)
    t.push(
      { name: 'web_search', description: 'Search the web. Write your own precise query (keywords, product names, versions, year); do not just paste the user message.', parameters: S({ query: str('Search query') }, ['query']) },
      { name: 'read_webpage', description: 'Fetch a web page and return its readable text.', parameters: S({ url: str('Full URL') }, ['url']) },
      { name: 'open_in_browser', description: 'Open a page in the browser panel next to the chat so the user can see it.', parameters: S({ url: str('Full URL') }, ['url']) },
      { name: 'browser_look', description: 'See the page open in the browser panel: its URL, title, readable text and a numbered list of things you can click or type into. Call it before clicking or typing, and again after the page changes.', parameters: S({}) },
      { name: 'browser_click', description: 'Click something in the browser panel, by its number from browser_look. The user watches your cursor move.', parameters: S({ target: { type: 'number', description: 'Element number from browser_look' } }, ['target']) },
      { name: 'browser_type', description: 'Type into a field in the browser panel, by its number from browser_look. Never type passwords, card numbers or other secrets.', parameters: S({ target: { type: 'number', description: 'Element number from browser_look' }, text: str('Text to type'), submit: { type: 'boolean', description: 'Press Enter afterwards' } }, ['target', 'text']) },
      { name: 'browser_scroll', description: 'Scroll the page in the browser panel.', parameters: S({ direction: { type: 'string', enum: ['down', 'up'] } }, ['direction']) }
    );
  if (screen.SUPPORTED) t.push(...SCREEN_DEFS);
  return t.concat(connectors.defs(connected));
}

// ---------- screen control (the user's real desktop, see src/screen.js) ----------
const NO_SECRETS = 'Never type or enter passwords, passcodes, payment card or bank details, or other credentials, and never click to submit them; ask the user (ask_user) to do that part themselves.';
const XY = (what) => ({ x: { type: 'number', description: `${what} x, in pixels of the latest screen_look screenshot` }, y: { type: 'number', description: `${what} y, in pixels of the latest screen_look screenshot` } });
const SCREEN_DEFS = [
  { name: 'screen_look', description: "See the user's whole screen (not the browser panel): a screenshot plus the frontmost app and open windows. Coordinates for the other screen_ tools are pixels in this screenshot. Look before acting and again after anything changes. Only use the screen when the user asks you to do something on their computer.", parameters: S({ display: { type: 'number', description: 'Display number for multi-monitor setups (default: main display)' } }) },
  { name: 'screen_click', description: `Click on the user's screen. ${NO_SECRETS}`, parameters: S({ ...XY('Click'), button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Default left' }, clicks: { type: 'number', description: '2 for a double-click, 3 for a triple-click (default 1)' } }, ['x', 'y']) },
  { name: 'screen_type', description: `Type text into whatever has keyboard focus on the user's screen (click the field first). New lines press Return. ${NO_SECRETS}`, parameters: S({ text: str('Text to type') }, ['text']) },
  { name: 'screen_key', description: `Press a key or shortcut on the user's screen, e.g. "enter", "escape", "tab", "cmd+c", "ctrl+shift+t", "alt+f4", "down". On Windows cmd means Ctrl. ${NO_SECRETS}`, parameters: S({ keys: str('Key or combo joined with +'), repeat: { type: 'number', description: 'Times to press it (default 1)' } }, ['keys']) },
  { name: 'screen_scroll', description: "Scroll on the user's screen, optionally over a point.", parameters: S({ direction: { type: 'string', enum: ['down', 'up', 'left', 'right'] }, amount: { type: 'number', description: 'Wheel notches, 1-25 (default 5)' }, ...XY('Pointer') }, ['direction']) },
  { name: 'screen_drag', description: `Drag with the left mouse button from one point to another on the user's screen (move windows, select text, drag files). ${NO_SECRETS}`, parameters: S({ from_x: { type: 'number' }, from_y: { type: 'number' }, to_x: { type: 'number' }, to_y: { type: 'number' } }, ['from_x', 'from_y', 'to_x', 'to_y']) },
  { name: 'screen_open_app', description: 'Open an app on the user\'s computer by name, or bring it to the front if it is already open (e.g. "Notes", "Safari", "Calculator").', parameters: S({ name: str('App name') }, ['name']) },
];

async function screenTool(name, a, ctx) {
  const act = name.slice(7);
  const say = (t) => ctx.emit({ type: 'tool', text: t });
  if (ctx.permission === 'plan') return 'Plan first mode is on, so screen control is off. Put the steps in your plan instead.';
  const stoppedMsg = 'The user stopped screen control. Do not use the screen again in this reply; tell them where you got to.';
  if (screen.isStopped(ctx.reqId)) return stoppedMsg;
  if (ctx.permission !== 'full' && !ctx.screenOk) {
    const ok = await ctx.approve({ kind: 'screen', title: `Let ${ctx.nodeName || 'this node'} use your screen`, detail: `${ctx.nodeName || 'This node'} will see your screen and can move the mouse, click and type for you. A bar at the top of the screen shows while it's in control. Press Stop on that bar or ${ctx.screenShortcut || 'the stop shortcut'} to take back control at any time.\nIt won't enter passwords or payment details; it will ask you to do that.`, always: true });
    if (!ok) return 'The user said no to screen control. Do not ask again in this reply; help another way.';
    ctx.screenOk = true;
  }
  // macOS privacy permissions: tell the user once in plain words, with a button to fix it.
  const missing = async (kind) => {
    if (!ctx.screenAsked) {
      ctx.screenAsked = true;
      const ans = await ctx.ask({ question: screen.MISSING[kind], options: ['Open System Settings', 'Not now'], allowOther: false });
      if (ans === 'Open System Settings') screen.openSettings(kind);
    }
    return `Screen control is blocked: ${screen.MISSING[kind]} The user has been shown how to allow it. Don't retry screen tools until they say it's on.`;
  };
  const perms = screen.permissions();
  const vision = !!ctx.vision;
  if (act === 'look' && vision && !perms.screen) return missing('screen');
  if (act !== 'look' && act !== 'open_app' && !perms.accessibility) return missing('accessibility');
  const busy = screen.begin(ctx.reqId, ctx.nodeName); // shows the "in control" bar
  if (busy) return busy;
  try {
    const at = (x, y) => `(${Math.round(x)}, ${Math.round(y)})`;
    switch (act) {
      case 'look': {
        say('Screen(look)');
        if (vision) {
          const img = await screen.capture({ display: a.display });
          const text = await screen.describe({ display: a.display }).catch(() => '');
          return { text: `Screenshot attached (${img.width}x${img.height}). Use these pixel coordinates for screen_click and the other screen tools.\n${text}`, image: { mime: img.mime, data: img.data } };
        }
        const text = await screen.describe({ ax: true, display: a.display });
        return `${text}\n\nNote: the engine answering right now can't see images, so this is a text description of the screen instead of a screenshot. Use the positions above for clicks.`;
      }
      case 'click': {
        const n = Math.max(1, Math.min(3, Number(a.clicks) || 1));
        const b = ['right', 'middle'].includes(a.button) ? a.button : 'left';
        say(`Screen(${n === 2 ? 'double-click' : n === 3 ? 'triple-click' : b === 'left' ? 'click' : b + '-click'} ${at(a.x, a.y)})`);
        const r = await screen.input('click', { x: a.x, y: a.y, button: b, count: n });
        return `Clicked at ${at(a.x, a.y)}.${r.log ? ' [dry run] ' + r.log.join('; ') : ''} Call screen_look to see what happened.`;
      }
      case 'type': {
        say(`Screen(type ${String(a.text || '').length} characters)`);
        const r = await screen.input('type', { text: a.text });
        return `Typed ${String(a.text || '').length} characters.${r.skipped ? ` ${r.skipped} emoji or symbols could not be typed and were skipped.` : ''}${r.log ? ' [dry run] ' + r.log.length + ' events' : ''}`;
      }
      case 'key': {
        say(`Screen(key ${String(a.keys || '').slice(0, 30)})`);
        const r = await screen.input('key', { keys: a.keys, repeat: a.repeat });
        return `Pressed ${a.keys}${Number(a.repeat) > 1 ? ' ×' + a.repeat : ''}.${r.log ? ' [dry run] ' + r.log.join('; ') : ''}`;
      }
      case 'scroll': {
        say(`Screen(scroll ${a.direction || 'down'})`);
        await screen.input('scroll', a);
        return `Scrolled ${a.direction || 'down'}. Call screen_look to see the result.`;
      }
      case 'drag': {
        say(`Screen(drag ${at(a.from_x, a.from_y)} to ${at(a.to_x, a.to_y)})`);
        await screen.input('drag', a);
        return `Dragged from ${at(a.from_x, a.from_y)} to ${at(a.to_x, a.to_y)}.`;
      }
      case 'open_app': {
        say(`Screen(open ${String(a.name || '').slice(0, 40)})`);
        const r = await screen.openApp(a.name);
        return r.dry ? `[dry run] ${r.command.join(' ')}` : r.focused ? `Brought ${r.focused} to the front.` : `Opened ${a.name}. Call screen_look to see it.`;
      }
    }
    return `Unknown screen tool: ${name}`;
  } catch (e) {
    if (e.code === 'stopped') return stoppedMsg;
    if (e.code === 'permission') return missing(e.need);
    if (e.code === 'unsupported') return e.message;
    throw e;
  }
}

function resolveIn(cwd, p, permission) {
  const full = path.resolve(cwd, p || '.');
  if (permission !== 'full' && full !== cwd && !full.startsWith(cwd + path.sep)) throw new Error(`"${p}" is outside the workspace (${cwd}). Use a path inside it, or switch the chat to Full trust.`);
  return full;
}
const rel = (cwd, p) => path.relative(cwd, p) || '.';
const clip = (s, n) => (s.length > n ? s.slice(0, n / 2) + `\n…(${s.length - n} characters cut)…\n` + s.slice(-n / 2) : s);

function shell(command, cwd, env, signal, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const child = IS_WIN ? spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd, env, windowsHide: true }) : spawn(process.env.SHELL || '/bin/zsh', ['-lc', command], { cwd, env });
    let out = '';
    const add = (d) => (out = (out + d.toString()).slice(-60000));
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const kill = () => child.kill('SIGTERM');
    const t = setTimeout(() => {
      out += '\n[stopped after 3 minutes; for servers, use preview_site instead]';
      kill();
    }, timeoutMs);
    signal && signal.addEventListener('abort', kill);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
    child.on('error', (e) => resolve({ code: -1, out: String(e.message) }));
  });
}

function listDir(dir, depth = 0, out = [], base = dir) {
  if (out.length > 300) return out;
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.DS_Store') {
      if (e.isDirectory()) out.push(`${'  '.repeat(depth)}${e.name}/ (skipped)`);
      continue;
    }
    out.push(`${'  '.repeat(depth)}${e.name}${e.isDirectory() ? '/' : ''}`);
    if (e.isDirectory() && depth < 2) listDir(path.join(dir, e.name), depth + 1, out, base);
  }
  return out;
}

// ctx: { cwd, permission, env, signal, approve, ask, emit, openUrl, search, readPage, preview, react, tokens, google, connected,
//        reqId, nodeName, screenShortcut, vision (set per call: can the current engine see images) }
async function run(name, a, ctx) {
  const { cwd, permission, emit } = ctx;
  a = a || {};
  const say = (t) => emit({ type: 'tool', text: t });
  const plan = permission === 'plan';
  const gate = async (kind, title, detail) => {
    if (plan) return false;
    if (permission === 'full') return true;
    if (kind === 'file' && permission === 'edit') return true;
    return ctx.approve({ kind, title, detail, always: true });
  };
  try {
    switch (name) {
      case 'ask_user': {
        say(`Ask(${String(a.question).slice(0, 60)})`);
        const answer = await ctx.ask({ question: a.question, options: (a.options || []).slice(0, 5), allowOther: a.allow_other !== false });
        return answer == null ? 'The user did not answer.' : `The user answered: ${answer}`;
      }
      case 'react': {
        ctx.react(a.emoji);
        return 'Reaction added.';
      }
      case 'list_files': {
        fs.mkdirSync(cwd, { recursive: true });
        const dir = resolveIn(cwd, a.path, permission);
        say(`List(${rel(cwd, dir)})`);
        const l = listDir(dir);
        return l.length ? l.join('\n') : '(empty folder)';
      }
      case 'read_file': {
        const f = resolveIn(cwd, a.path, permission);
        say(`Read(${rel(cwd, f)})`);
        const buf = fs.readFileSync(f);
        if (buf.includes(0)) return `${a.path} is a binary file (${buf.length} bytes).`;
        return clip(buf.toString('utf8'), 60000);
      }
      case 'write_file': {
        const f = resolveIn(cwd, a.path, permission);
        const exists = fs.existsSync(f);
        if (plan) return 'Plan first mode is on, so nothing was written. Describe the change in your plan instead.';
        if (!(await gate('file', `${exists ? 'Overwrite' : 'Create'} ${rel(cwd, f)}`, String(a.content || '').slice(0, 1800)))) return 'The user declined this change.';
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, String(a.content ?? ''));
        say(`${exists ? 'Write' : 'Create'}(${rel(cwd, f)})`);
        emit({ type: 'file', path: f, action: exists ? 'updated' : 'created' });
        return `${exists ? 'Updated' : 'Created'} ${rel(cwd, f)} (${String(a.content || '').length} characters).`;
      }
      case 'edit_file': {
        const f = resolveIn(cwd, a.path, permission);
        const text = fs.readFileSync(f, 'utf8');
        const n = text.split(a.find).length - 1;
        if (n !== 1) return n === 0 ? `Could not find that text in ${a.path}. Read the file and try again with an exact match.` : `That text appears ${n} times in ${a.path}. Include more surrounding lines so it matches once.`;
        if (plan) return 'Plan first mode is on, so nothing was changed.';
        if (!(await gate('file', `Edit ${rel(cwd, f)}`, `- ${String(a.find).slice(0, 700)}\n+ ${String(a.replace).slice(0, 700)}`))) return 'The user declined this change.';
        fs.writeFileSync(f, text.replace(a.find, a.replace));
        say(`Edit(${rel(cwd, f)})`);
        emit({ type: 'file', path: f, action: 'edited' });
        return `Edited ${rel(cwd, f)}.`;
      }
      case 'run_command': {
        if (plan) return 'Plan first mode is on, so the command was not run. Include it in your plan.';
        if (!(await gate('command', 'Run a command', a.command))) return 'The user declined to run this command.';
        fs.mkdirSync(cwd, { recursive: true });
        say(`Bash(${String(a.command).slice(0, 70)})`);
        const r = await shell(a.command, cwd, ctx.env, ctx.signal);
        return `exit code ${r.code}\n${clip(r.out || '(no output)', 16000)}`;
      }
      case 'preview_site': {
        const dir = resolveIn(cwd, a.path, permission);
        say(`Preview(${rel(cwd, dir)})`);
        const r = await ctx.preview(dir);
        ctx.openUrl(r.url);
        return `Preview running at ${r.url} (${r.note}) and open in the browser panel.`;
      }
      case 'web_search': {
        say(`WebSearch(${String(a.query).slice(0, 70)})`);
        const r = await ctx.search(a.query);
        if (!r.results.length) return `No results for "${a.query}". Try different words.`;
        return r.results.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.snippet}`).join('\n\n');
      }
      case 'read_webpage': {
        say(`Fetch(${String(a.url).replace(/^https?:\/\//, '').slice(0, 60)})`);
        const t = await ctx.readPage(a.url);
        return t || 'Could not read that page.';
      }
      case 'browser_look':
      case 'browser_click':
      case 'browser_type':
      case 'browser_scroll': {
        const act = name.slice(8);
        if ((act === 'click' || act === 'type') && plan) return 'Plan first mode is on, so you can look at pages but not click or type. Put the steps in your plan.';
        if ((act === 'click' || act === 'type') && permission === 'ask' && !ctx.browserOk) {
          if (!(await ctx.approve({ kind: 'browser', title: 'Use the browser panel', detail: 'Let this node click and type in the browser panel for the rest of this reply. You can watch its cursor.' }))) return 'The user said no to browser control.';
          ctx.browserOk = true;
        }
        say(`Browser(${act}${a.target != null ? ' #' + a.target : ''}${a.direction ? ' ' + a.direction : ''})`);
        const r = await ctx.browser(act, a);
        return r == null ? 'The browser panel did not respond (the chat may have been stopped).' : typeof r === 'string' ? r : JSON.stringify(r);
      }
      case 'open_in_browser': {
        say(`Browse(${String(a.url).replace(/^https?:\/\//, '').slice(0, 60)})`);
        ctx.openUrl(a.url);
        return 'Opened in the browser panel.';
      }
    }
    if (name.startsWith('screen_')) return await screenTool(name, a, ctx);
    if (connectors.has(name)) {
      say(`${name.split('_')[0][0].toUpperCase() + name.split('_')[0].slice(1)}(${name.split('_').slice(1).join(' ')})`);
      if (plan && /create|comment|draft|send|clone/.test(name)) return 'Plan first mode is on, so nothing was changed.';
      return await connectors.run(name, a, { ...ctx, approve: (o) => (permission === 'full' ? Promise.resolve(true) : ctx.approve(o)) });
    }
    return `Unknown tool: ${name}`;
  } catch (e) {
    return `Error: ${e.message || e}`;
  }
}

function defaultWorkspace(nodeName) {
  return path.join(os.homedir(), 'Nodes', String(nodeName || 'Workspace').replace(/[^\w .-]/g, ''));
}

module.exports = { defs, run, defaultWorkspace };
