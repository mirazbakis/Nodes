// Coding CLIs that Nodes can use as engines (they run on the user's own subscriptions/sign-ins).
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();

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
    install: 'curl -fsSL https://claude.ai/install.sh | bash', login: 'claude /login',
    status: async () => {
      if (fs.existsSync(path.join(HOME, '.claude', '.credentials.json'))) return { signedIn: true };
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
    install: 'curl https://cursor.com/install -fsS | bash', login: 'cursor-agent login',
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
    install: 'brew install ollama', login: 'open -a Ollama',
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
  const dirs = [path.join(HOME, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, '.npm-global', 'bin'), path.join(HOME, '.bun', 'bin'), path.join(HOME, '.cursor', 'bin'), path.join(HOME, '.claude', 'local'), path.join(HOME, '.opencode', 'bin')];
  try {
    const nvm = path.join(HOME, '.nvm', 'versions', 'node');
    for (const v of fs.readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, 'bin'));
  } catch {}
  return dirs;
}
async function loginShellPath() {
  if (extraPath !== null) return extraPath;
  extraPath = await new Promise((resolve) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'echo -n "__P__$PATH"'], { timeout: 4000 }, (e, out) => {
      const m = String(out || '').match(/__P__(.*)$/m);
      resolve(m ? m[1] : '');
    });
  });
  return extraPath;
}
async function envPath() {
  const parts = [...searchDirs(), ...(await loginShellPath()).split(':'), ...(process.env.PATH || '').split(':'), '/usr/bin', '/bin'];
  return [...new Set(parts.filter(Boolean))].join(':');
}
async function which(bin) {
  for (const d of (await envPath()).split(':')) {
    const p = path.join(d, bin);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}
async function childEnv() {
  return { ...process.env, PATH: await envPath(), NO_COLOR: '1', FORCE_COLOR: '0', GEMINI_CLI_TRUST_WORKSPACE: 'true' };
}

function run(bin, args, ms = 8000) {
  return new Promise(async (resolve) => {
    execFile(bin, args, { timeout: ms, env: await childEnv() }, (e, out, err) => resolve(String(out || '') + String(err || '')));
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

// Opens Terminal running a command, via a .command file (no automation permission needed).
async function openInTerminal(command, title) {
  const dir = path.join(os.tmpdir(), 'nodes-commands');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${title.replace(/\W+/g, '-')}-${Date.now()}.command`);
  fs.writeFileSync(file, `#!/bin/zsh -il\nclear\necho "Nodes: ${title}"\necho "Running: ${command.replace(/"/g, '\\"')}"\necho\n${command}\necho\necho "Done. You can close this window and go back to Nodes."\n`, { mode: 0o755 });
  const { shell } = require('electron');
  await shell.openPath(file);
}

// ---------- running a CLI as a chat engine ----------
function buildPrompt(system, messages) {
  const last = messages[messages.length - 1];
  const earlier = messages.slice(0, -1).slice(-16);
  let p = `${system}\n\n`;
  if (earlier.length) p += `Conversation so far:\n${earlier.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.content}`).join('\n\n')}\n\n`;
  p += `Latest message from the user:\n${last ? last.content : ''}`;
  return p;
}

function argsFor(id, prompt, { allowEdits, model }) {
  const m = model && model !== 'default' ? model : null;
  switch (id) {
    case 'codex':
      return ['exec', '--json', '--skip-git-repo-check', '-s', allowEdits ? 'workspace-write' : 'read-only', ...(m ? ['-m', m] : []), prompt];
    case 'claude-code':
      return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', allowEdits ? 'acceptEdits' : 'default', ...(allowEdits ? [] : ['--allowedTools', 'Read,Grep,Glob,WebSearch,WebFetch']), ...(m ? ['--model', m] : []), prompt];
    case 'gemini-cli':
      return ['-p', prompt, '--output-format', 'stream-json', '--skip-trust', '--approval-mode', allowEdits ? 'auto_edit' : 'default', ...(m ? ['-m', m] : [])];
    case 'qwen-code':
      return ['-p', prompt, '--output-format', 'stream-json', ...(allowEdits ? ['--approval-mode', 'auto-edit'] : []), ...(m ? ['-m', m] : [])];
    case 'cursor-agent':
      return ['-p', '--output-format', 'stream-json', ...(allowEdits ? ['--force'] : []), ...(m ? ['-m', m] : []), prompt];
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

async function runCli({ id, model, system, messages, cwd, allowEdits, signal, onText, onTool }) {
  const meta = byId[id];
  const bin = await which(meta.bin);
  if (!bin) throw Object.assign(new Error(`${meta.name} isn't installed`), { cooldown: 600 });
  const prompt = buildPrompt(system, messages);
  const child = spawn(bin, argsFor(id, prompt, { allowEdits, model }), { cwd: cwd || HOME, env: await childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = () => child.kill('SIGTERM');
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

module.exports = { CLIS, scan, which, openInTerminal, runCli };
