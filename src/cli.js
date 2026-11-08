// Coding CLIs that Nodes can use as engines (they run on the user's own subscriptions/sign-ins).
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';
const SEP = IS_WIN ? ';' : ':';
// Per-platform install/sign-in commands. A value starting with "url:" opens a web page instead.
const plat = (mac, win) => (IS_WIN ? win : mac);

const CLIS = [
  {
    id: 'codex', name: 'Codex', bin: 'codex', vendor: 'OpenAI',
    blurb: 'OpenAI\'s coding agent. Uses your ChatGPT plan.',
    install: 'npm install -g @openai/codex', login: 'codex login',
    status: async (bin) => {
      const out = await run(bin, ['login', 'status']);
      return /logged in/i.test(out) ? { signedIn: true, detail: out.trim().split('\n')[0] } : { signedIn: false };
    },
  },
  {
    id: 'claude-code', name: 'Claude Code', bin: 'claude', vendor: 'Anthropic',
    blurb: 'Anthropic\'s coding agent. Uses your Claude plan.',
    install: plat('curl -fsSL https://claude.ai/install.sh | bash', 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"'), login: plat('claude /login', 'claude'),
    status: async () => {
      if (fs.existsSync(path.join(HOME, '.claude', '.credentials.json'))) return { signedIn: true };
      if (IS_WIN) return { signedIn: false };
      const ok = await new Promise((r) => execFile('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials'], (e) => r(!e)));
      return { signedIn: ok };
    },
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', bin: 'gemini', vendor: 'Google',
    blurb: 'Google\'s agent. Free with a Google account.',
    install: 'npm install -g @google/gemini-cli', login: 'gemini',
    status: async () => {
      const g = path.join(HOME, '.gemini');
      if (fs.existsSync(path.join(g, 'oauth_creds.json')) || process.env.GEMINI_API_KEY) return { signedIn: true };
      try {
        const s = JSON.parse(fs.readFileSync(path.join(g, 'settings.json'), 'utf8'));
        return { signedIn: !!(s.security?.auth?.selectedType || s.selectedAuthType) };
      } catch {
        return { signedIn: false };
      }
    },
  },
  {
    id: 'qwen-code', name: 'Qwen Code', bin: 'qwen', vendor: 'Alibaba',
    blurb: 'Free daily requests with a Qwen account, or local models.',
    install: 'npm install -g @qwen-code/qwen-code', login: 'qwen',
    status: async () => ({ signedIn: fs.existsSync(path.join(HOME, '.qwen')) }),
  },
  {
    id: 'cursor-agent', name: 'Cursor', bin: 'cursor-agent', vendor: 'Cursor',
    blurb: 'Cursor\'s agent in the terminal. Uses your Cursor plan.',
    install: plat('curl https://cursor.com/install -fsS | bash', 'url:https://cursor.com/cli'), login: 'cursor-agent login',
    status: async (bin) => ({ signedIn: /logged in/i.test(await run(bin, ['status'])) }),
  },
  {
    id: 'opencode', name: 'OpenCode', bin: 'opencode', vendor: 'Open source',
    blurb: 'Open-source agent that works with any provider.',
    install: 'npm install -g opencode-ai', login: 'opencode auth login',
    status: async () => ({ signedIn: fs.existsSync(path.join(HOME, '.local', 'share', 'opencode', 'auth.json')) }),
  },
  {
    id: 'ollama-app', name: 'Ollama', bin: 'ollama', vendor: 'Local',
    blurb: 'Run open models on this Mac. Private and unlimited.',
    install: plat('brew install ollama', 'url:https://ollama.com/download/windows'), login: plat('open -a Ollama', 'ollama serve'),
    status: async () => {
      try {
        const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
        const j = await r.json();
        return { signedIn: true, detail: `${(j.models || []).length} models installed` };
      } catch {
        return { signedIn: false, detail: 'Not running' };
      }
    },
  },
];
const byId = Object.fromEntries(CLIS.map((c) => [c.id, c]));

// ---------- PATH resolution (GUI apps get a tiny PATH) ----------
let extraPath = null;
function searchDirs() {
  if (IS_WIN) {
    const A = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    const L = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
    const PF = process.env.ProgramFiles || 'C:\\Program Files';
    return [path.join(A, 'npm'), path.join(HOME, '.local', 'bin'), path.join(PF, 'nodejs'), path.join(L, 'Programs', 'Ollama'), path.join(L, 'cursor-agent'), path.join(HOME, '.bun', 'bin'), path.join(HOME, 'scoop', 'shims'), path.join(L, 'Microsoft', 'WinGet', 'Links'), path.join(L, 'Volta', 'bin'), path.join(HOME, '.opencode', 'bin')];
  }
  const dirs = [path.join(HOME, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, '.npm-global', 'bin'), path.join(HOME, '.bun', 'bin'), path.join(HOME, '.cursor', 'bin'), path.join(HOME, '.claude', 'local'), path.join(HOME, '.opencode', 'bin')];
  try {
    const nvm = path.join(HOME, '.nvm', 'versions', 'node');
    for (const v of fs.readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, 'bin'));
  } catch {}
  return dirs;
}
async function loginShellPath() {
  if (IS_WIN) return '';
  if (extraPath !== null) return extraPath;
  extraPath = await new Promise((resolve) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'echo -n "__P__$PATH"'], { timeout: 4000 }, (e, out) => {
      const m = String(out || '').match(/__P__(.*)$/m);
      resolve(m ? m[1] : '');
    });
  });
  return extraPath;
}
const sysPath = () => process.env.PATH || process.env.Path || '';
async function envPath() {
  const parts = [...searchDirs(), ...(await loginShellPath()).split(SEP), ...sysPath().split(SEP), ...(IS_WIN ? [] : ['/usr/bin', '/bin'])];
  return [...new Set(parts.filter(Boolean))].join(SEP);
}
async function which(bin) {
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat'] : [''];
  for (const d of (await envPath()).split(SEP)) {
    for (const ext of exts) {
      const p = path.join(d, bin + ext);
      try {
        if (IS_WIN) {
          if (fs.statSync(p).isFile()) return p;
        } else {
          fs.accessSync(p, fs.constants.X_OK);
          return p;
        }
      } catch {}
    }
  }
  return null;
}
async function childEnv() {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', GEMINI_CLI_TRUST_WORKSPACE: 'true' };
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
  env[IS_WIN ? 'Path' : 'PATH'] = await envPath();
  return env;
}

// On Windows, npm installs CLIs as .cmd shims, which Node can't start without a shell.
// Starting the shim's JavaScript target with node directly avoids the shell entirely,
// so prompts are never parsed by cmd.exe.
async function resolveLaunch(bin, args) {
  if (!IS_WIN || !/\.(cmd|bat)$/i.test(bin)) return { cmd: bin, args, shell: false };
  try {
    const shim = fs.readFileSync(bin, 'utf8');
    const m = shim.match(/"%~?dp0%?\\([^"]+?\.[cm]?js)"/i);
    if (m) {
      const target = path.join(path.dirname(bin), m[1]);
      const local = path.join(path.dirname(bin), 'node.exe');
      const node = fs.existsSync(local) ? local : await which('node');
      if (node && fs.existsSync(target)) return { cmd: node, args: [target, ...args], shell: false };
    }
  } catch {}
  return { cmd: bin, args, shell: true };
}

function run(bin, args, ms = 8000) {
  return new Promise(async (resolve) => {
    const l = await resolveLaunch(bin, args);
    execFile(l.cmd, l.args, { timeout: ms, env: await childEnv(), shell: l.shell, windowsHide: true }, (e, out, err) => resolve(String(out || '') + String(err || '')));
  });
}

async function scan() {
  return Promise.all(
    CLIS.map(async (c) => {
      const bin = await which(c.bin);
      let st = { signedIn: false };
      if (bin || c.id === 'ollama-app') {
        try {
          st = await c.status(bin);
        } catch {}
      }
      let version = '';
      if (bin && c.id !== 'ollama-app') version = (await run(bin, ['--version'], 5000)).trim().split('\n').pop().slice(0, 40);
      return { id: c.id, name: c.name, vendor: c.vendor, blurb: c.blurb, install: c.install, login: c.login, installed: !!bin || (c.id === 'ollama-app' && st.signedIn), path: bin, version, signedIn: !!st.signedIn, detail: st.detail || '' };
    })
  );
}

// Opens a terminal window running a command: Terminal via a .command file on macOS
// (no automation permission needed), Command Prompt via a .cmd file on Windows.
// Commands starting with "url:" open a web page instead.
async function openInTerminal(command, title) {
  const { shell } = require('electron');
  if (command.startsWith('url:')) return shell.openExternal(command.slice(4));
  const dir = path.join(os.tmpdir(), 'nodes-commands');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${title.replace(/\W+/g, '-')}-${Date.now()}`);
  if (IS_WIN) {
    const file = base + '.cmd';
    const env = await envPath();
    fs.writeFileSync(file, `@echo off\r\ntitle Nodes: ${title}\r\nset "Path=${env}"\r\necho Nodes: ${title}\r\necho.\r\n${command}\r\necho.\r\necho Done. You can close this window and go back to Nodes.\r\npause\r\n`);
    await shell.openPath(file);
    return;
  }
  const file = base + '.command';
  fs.writeFileSync(file, `#!/bin/zsh -il\nclear\necho "Nodes: ${title}"\necho "Running: ${command.replace(/"/g, '\\"')}"\necho\n${command}\necho\necho "Done. You can close this window and go back to Nodes."\n`, { mode: 0o755 });
  await shell.openPath(file);
}

// ---------- running a CLI as a chat engine ----------
function buildPrompt(system, messages) {
  const last = messages[messages.length - 1];
  const earlier = messages.slice(0, -1).slice(-16);
  let p = `${system}\n\n`;
  if (earlier.length) p += `Conversation so far:\n${earlier.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.content}`).join('\n\n')}\n\n`;
  p += `Latest message from the user:\n${last ? last.content : ''}`;
  // Windows caps a command line at about 32,000 characters, so keep the newest part.
  if (IS_WIN && p.length > 24000) p = system.slice(0, 6000) + '\n\n[Earlier conversation trimmed]\n\n' + p.slice(-(24000 - Math.min(system.length, 6000)));
  return p;
}

// permission: 'ask' (read-only, propose changes), 'edit' (may change files), 'plan' (plan only), 'full' (no limits)
// thinking: 'off' | 'low' | 'medium' | 'high'
function argsFor(id, prompt, { permission = 'ask', model, thinking = 'off' }) {
  const m = model && model !== 'default' ? model : null;
  const edit = permission === 'edit' || permission === 'full';
  switch (id) {
    case 'codex': {
      const sandbox = permission === 'full' ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-s', edit ? 'workspace-write' : 'read-only'];
      const effort = thinking && thinking !== 'off' ? ['-c', `model_reasoning_effort="${thinking}"`] : [];
      return ['exec', '--json', '--skip-git-repo-check', ...sandbox, ...effort, ...(m ? ['-m', m] : []), prompt];
    }
    case 'claude-code': {
      const mode = { ask: 'default', edit: 'acceptEdits', plan: 'plan', full: 'bypassPermissions' }[permission] || 'default';
      const readOnly = permission === 'ask' ? ['--allowedTools', 'Read,Grep,Glob,WebSearch,WebFetch'] : [];
      return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', mode, ...readOnly, ...(m ? ['--model', m] : []), prompt];
    }
    case 'gemini-cli': {
      const mode = { ask: 'default', edit: 'auto_edit', plan: 'default', full: 'yolo' }[permission] || 'default';
      return ['-p', prompt, '--output-format', 'stream-json', '--skip-trust', '--approval-mode', mode, ...(m ? ['-m', m] : [])];
    }
    case 'qwen-code': {
      const mode = { edit: ['--approval-mode', 'auto-edit'], full: ['--approval-mode', 'yolo'] }[permission] || [];
      return ['-p', prompt, '--output-format', 'stream-json', ...mode, ...(m ? ['-m', m] : [])];
    }
    case 'cursor-agent':
      return ['-p', '--output-format', 'stream-json', ...(edit ? ['--force'] : []), ...(m ? ['-m', m] : []), prompt];
    case 'opencode':
      return ['run', ...(m ? ['-m', m] : []), prompt];
  }
  return [prompt];
}

const short = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Parses one JSON line into {text, tool, done}
function parseLine(id, j, st) {
  if (id === 'codex') {
    const it = j.item || {};
    if (j.type === 'item.started' && it.type === 'command_execution') return { tool: `Bash(${short(it.command)})` };
    if (j.type === 'item.completed' && it.type === 'agent_message') return { text: it.text + '\n\n' };
    if (j.type === 'item.completed' && it.type === 'file_change') return { tool: `Edit(${(it.changes || []).map((c) => path.basename(c.path || '')).join(', ')})` };
    if (j.type === 'item.started' && it.type === 'web_search') return { tool: `WebSearch(${short(it.query)})` };
    if (j.type === 'error' || j.type === 'turn.failed') return { error: short(j.message || j.error?.message || 'Codex failed', 160) };
    return {};
  }
  if (id === 'gemini-cli') {
    if (j.type === 'message' && j.role === 'assistant') return { text: j.content || '' };
    if (j.type === 'tool_use') return { tool: `${j.tool_name || 'Tool'}(${short(JSON.stringify(j.parameters || {}), 60)})` };
    if (j.type === 'result' && j.status === 'error') return { error: short(j.error?.message || 'Gemini CLI failed', 160) };
    return {};
  }
  // claude-code, qwen-code and cursor-agent share the stream-json shape
  if (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta?.type === 'text_delta') {
    st.streamed = true;
    return { text: j.event.delta.text };
  }
  if (j.type === 'assistant' && j.message?.content) {
    let text = '';
    let tool = null;
    for (const b of j.message.content) {
      if (b.type === 'text' && !st.streamed) text += b.text;
      if (b.type === 'tool_use') tool = `${b.name}(${short(b.input?.command || b.input?.file_path || b.input?.pattern || b.input?.query || b.input?.url || '', 60)})`;
    }
    if (st.streamed) st.streamed = false; // next assistant turn may stream again
    return { text, tool };
  }
  if (j.type === 'result' && j.is_error) return { error: short(j.result || 'failed', 160) };
  return {};
}

async function runCli({ id, model, system, messages, cwd, permission, thinking, signal, onText, onTool }) {
  const meta = byId[id];
  const bin = await which(meta.bin);
  if (!bin) throw Object.assign(new Error(`${meta.name} isn't installed`), { cooldown: 600 });
  const prompt = buildPrompt(system, messages);
  const launch = await resolveLaunch(bin, argsFor(id, prompt, { permission, model, thinking }));
  if (launch.shell) throw Object.assign(new Error(`${meta.name} can't be started safely on this PC`), { cooldown: 3600 });
  const env = await childEnv();
  if (id === 'claude-code' && thinking && thinking !== 'off') env.MAX_THINKING_TOKENS = String({ low: 4000, medium: 12000, high: 31999 }[thinking] || 8000);
  const child = spawn(launch.cmd, launch.args, { cwd: cwd || HOME, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  // On Windows, kill the whole process tree (CLIs start helper processes of their own).
  const kill = () => (IS_WIN && child.pid ? execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {}) : child.kill('SIGTERM'));
  signal.addEventListener('abort', kill);
  let buf = '';
  let errBuf = '';
  let errMsg = null;
  const st = {};
  let gotText = false;
  child.stdout.on('data', (d) => {
    if (id === 'opencode') {
      gotText = true;
      return onText(d.toString());
    }
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      const r = parseLine(id, j, st);
      if (r.tool) onTool(r.tool);
      if (r.text) {
        gotText = true;
        onText(r.text);
      }
      if (r.error) errMsg = r.error;
    }
  });
  child.stderr.on('data', (d) => (errBuf = (errBuf + d.toString()).slice(-4000)));
  const code = await new Promise((r) => child.on('close', r));
  signal.removeEventListener('abort', kill);
  if (signal.aborted) throw Object.assign(new Error('stopped'), { fatal: true });
  if (!gotText) {
    const e = errMsg || short(errBuf.split('\n').filter((l) => /error|denied|login|auth|limit|quota|unavailable|not/i.test(l)).pop() || `exited with code ${code}`, 160);
    const low = e.toLowerCase();
    const cooldown = /login|auth|sign/.test(low) ? 900 : /limit|quota|429|usage/.test(low) ? 600 : 60;
    throw Object.assign(new Error(/login|auth|sign in/.test(low) ? 'not signed in' : e), { cooldown });
  }
}

module.exports = { CLIS, scan, which, openInTerminal, runCli, childEnv };
