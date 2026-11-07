// Relay's engine: streams a reply from one provider, and when it fails or goes quiet,
// moves on to the next provider in the chain until one answers.

const { byId } = require('./providers');
const cli = require('./cli');

class AttemptError extends Error {
  constructor(reason, { status, cooldown, fatal } = {}) {
    super(reason);
    this.status = status;
    this.cooldown = cooldown || 0; // seconds to rest this provider/model
    this.fatal = fatal; // the request itself was cancelled
  }
}

// ---------- cooldowns (in-memory) ----------
const cooldowns = new Map(); // key -> until(ms)
const coolKey = (p, m) => `${p}|${m || '*'}`;
function cool(provider, model, seconds) {
  if (!seconds) return;
  cooldowns.set(coolKey(provider, model), Date.now() + seconds * 1000);
}
function isCooling(provider, model) {
  const now = Date.now();
  return [coolKey(provider, model), coolKey(provider)].some((k) => (cooldowns.get(k) || 0) > now);
}
function clearCooldowns(provider) {
  for (const k of [...cooldowns.keys()]) if (!provider || k.startsWith(provider + '|')) cooldowns.delete(k);
}

// ---------- helpers ----------
function endpointFor(provider, cfg) {
  if (provider.chatUrl) return provider.chatUrl;
  let base = provider.custom ? (cfg.extra && cfg.extra.baseUrl) || '' : provider.baseUrl;
  if (provider.extraFields) {
    for (const f of provider.extraFields) base = base.replace(`{${f.id}}`, encodeURIComponent((cfg.extra && cfg.extra[f.id]) || ''));
  }
  base = base.replace(/\/+$/, '');
  return provider.kind === 'anthropic' ? `${base}/messages` : `${base}/chat/completions`;
}

function modelsUrlFor(provider, cfg) {
  if (provider.id === 'pollinations') return 'https://text.pollinations.ai/models';
  let base = provider.custom ? (cfg.extra && cfg.extra.baseUrl) || '' : provider.baseUrl;
  if (provider.extraFields) {
    for (const f of provider.extraFields) base = base.replace(`{${f.id}}`, encodeURIComponent((cfg.extra && cfg.extra[f.id]) || ''));
  }
  if (provider.id === 'cloudflare') return base.replace(/\/ai\/v1$/, '/ai/models/search?per_page=100&task=Text%20Generation');
  if (provider.id === 'github') return 'https://models.github.ai/catalog/models';
  return base.replace(/\/+$/, '') + '/models';
}

function authHeaders(provider, key) {
  if (provider.kind === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function classify(status, bodyText) {
  const body = (bodyText || '').slice(0, 300).replace(/\s+/g, ' ');
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) return new AttemptError('key was rejected', { status, cooldown: 600 });
  if (status === 402 || lower.includes('insufficient') || lower.includes('credit') || lower.includes('billing'))
    return new AttemptError('out of credits on this account', { status, cooldown: 1800 });
  if (status === 429) return new AttemptError('rate limited or free quota used up', { status, cooldown: 90 });
  if (status === 404 || lower.includes('model_not_found') || lower.includes('does not exist') || lower.includes('not found'))
    return new AttemptError('model not available', { status, cooldown: 3600 });
  if (status === 400) return new AttemptError(`rejected the request${body ? ': ' + body.slice(0, 140) : ''}`, { status, cooldown: 0 });
  if (status >= 500) return new AttemptError(`server error (${status})`, { status, cooldown: 30 });
  return new AttemptError(`HTTP ${status}${body ? ': ' + body.slice(0, 140) : ''}`, { status, cooldown: 20 });
}

// Splits <think>...</think> blocks out of streamed content.
function makeThinkSplitter(onText, onReasoning) {
  let buf = '';
  let inThink = false;
  return {
    push(chunk) {
      buf += chunk;
      while (buf.length) {
        if (inThink) {
          const end = buf.indexOf('</think>');
          if (end === -1) {
            // keep a tail in case the closing tag is split
            const keep = Math.min(buf.length, 7);
            onReasoning(buf.slice(0, buf.length - keep));
            buf = buf.slice(buf.length - keep);
            return;
          }
          onReasoning(buf.slice(0, end));
          buf = buf.slice(end + 8);
          inThink = false;
        } else {
          const start = buf.indexOf('<think>');
          if (start === -1) {
            const lt = buf.lastIndexOf('<');
            if (lt !== -1 && buf.length - lt < 7 && '<think>'.startsWith(buf.slice(lt))) {
              onText(buf.slice(0, lt));
              buf = buf.slice(lt);
              return;
            }
            onText(buf);
            buf = '';
            return;
          }
          onText(buf.slice(0, start));
          buf = buf.slice(start + 7);
          inThink = true;
        }
      }
    },
    flush() {
      if (!buf) return;
      if (inThink) onReasoning(buf);
      else onText(buf);
      buf = '';
    },
  };
}

async function* sseLines(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      yield line;
    }
  }
  if (buf.trim()) yield buf;
}

// ---------- usage / rate-limit headers ----------
function readLimits(id, h, emit) {
  const num = (k) => {
    const v = h.get(k);
    return v == null || v === '' ? null : parseFloat(v);
  };
  const pairs = [
    ['requests', num('x-ratelimit-remaining-requests') ?? num('x-ratelimit-remaining-requests-day') ?? num('x-ratelimit-remaining'), num('x-ratelimit-limit-requests') ?? num('x-ratelimit-limit-requests-day') ?? num('x-ratelimit-limit')],
    ['tokens', num('x-ratelimit-remaining-tokens') ?? num('x-ratelimit-remaining-tokens-day'), num('x-ratelimit-limit-tokens') ?? num('x-ratelimit-limit-tokens-day')],
    ['tokens', num('anthropic-ratelimit-tokens-remaining'), num('anthropic-ratelimit-tokens-limit')],
  ];
  for (const [kind, remaining, limit] of pairs) {
    if (remaining == null || !limit) continue;
    emit({ type: 'usage', provider: id, kind, remaining, limit, pct: remaining / limit });
  }
}

// ---------- one attempt ----------
async function attemptCli({ provider, model, system, messages, signal, timeouts, emit, cwd, allowEdits }) {
  let text = '';
  const ctrl = new AbortController();
  const onOuter = () => ctrl.abort();
  signal.addEventListener('abort', onOuter);
  let timer;
  let why = '';
  const arm = (secs, w) => {
    clearTimeout(timer);
    timer = setTimeout(() => ((why = w), ctrl.abort()), secs * 1000);
  };
  const limit = Math.max(timeouts.first, 300);
  arm(limit, `no answer within ${limit}s`);
  const splitter = makeThinkSplitter(
    (t) => {
      if (!t) return;
      text += t;
      emit({ type: 'delta', text: t });
    },
    (r) => r && emit({ type: 'reasoning', chars: r.length })
  );
  try {
    await cli.runCli({
      id: provider.id, model, system, messages, cwd, allowEdits, signal: ctrl.signal,
      onText: (t) => {
        arm(limit, `went quiet for ${limit}s`);
        splitter.push(t);
      },
      onTool: (t) => {
        arm(limit, `went quiet for ${limit}s`);
        emit({ type: 'tool', text: t });
      },
    });
    splitter.flush();
  } catch (e) {
    if (signal.aborted) throw new AttemptError('stopped', { fatal: true });
    if (why) throw new AttemptError(why, { cooldown: 60 });
    if (/limit|quota|usage|429/i.test(e.message || '')) emit({ type: 'usage', provider: provider.id, providerName: provider.name, exhausted: true, reason: e.message });
    throw new AttemptError(e.message || String(e), { cooldown: e.cooldown || 60 });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onOuter);
  }
  if (!text.trim()) throw new AttemptError('returned an empty reply', { cooldown: 30 });
  return { text: text.trim() };
}

async function attempt(opts) {
  if (opts.provider.kind === 'cli') return attemptCli(opts);
  const { provider, cfg, key, model, system, messages, temperature, signal, timeouts, emit } = opts;
  const url = endpointFor(provider, cfg);
  if (!url || url.startsWith('/')) throw new AttemptError('no endpoint configured', { cooldown: 0 });

  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  signal.addEventListener('abort', onOuterAbort);
  let timer = null;
  let gotToken = false;
  const arm = (secs, why) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ctrl.timeoutReason = why;
      ctrl.abort();
    }, secs * 1000);
  };
  arm(timeouts.first, `no response within ${timeouts.first}s`);

  let text = '';
  let reasoningChars = 0;
  const splitter = makeThinkSplitter(
    (t) => {
      if (!t) return;
      text += t;
      emit({ type: 'delta', text: t });
    },
    (r) => {
      if (!r) return;
      reasoningChars += r.length;
      emit({ type: 'reasoning', chars: r.length });
    }
  );
  const tick = () => {
    if (!gotToken) {
      gotToken = true;
      emit({ type: 'firstToken' });
    }
    arm(timeouts.idle, `stopped responding for ${timeouts.idle}s`);
  };

  let body;
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeaders(provider, key), ...(provider.headers || {}) };
  if (provider.kind === 'anthropic') {
    // Anthropic needs alternating user/assistant turns starting with user.
    const merged = [];
    for (const m of messages) {
      if (merged.length && merged[merged.length - 1].role === m.role) merged[merged.length - 1].content += '\n\n' + m.content;
      else merged.push({ role: m.role, content: m.content });
    }
    while (merged.length && merged[0].role !== 'user') merged.shift();
    body = { model, system, messages: merged, max_tokens: 8192, stream: true, temperature: Math.min(1, temperature) };
  } else {
    body = { model, stream: true, messages: [{ role: 'system', content: system }, ...messages] };
    if (!/^(o\d|gpt-5)/.test(model) && provider.id !== 'pollinations') body.temperature = temperature;
  }

  try {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      if (signal.aborted) throw new AttemptError('stopped', { fatal: true });
      if (ctrl.timeoutReason) throw new AttemptError(ctrl.timeoutReason, { cooldown: 45 });
      throw new AttemptError(provider.local ? 'not running on this Mac' : 'could not connect', { cooldown: provider.local ? 120 : 20 });
    }
    readLimits(provider.id, res.headers, emit);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const err = classify(res.status, t);
      if (err.status === 429 || err.status === 402) emit({ type: 'usage', provider: provider.id, providerName: provider.name, exhausted: true, reason: err.message });
      throw err;
    }

    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('event-stream')) {
      // Some servers ignore stream:true and return one JSON body.
      const j = await res.json().catch(() => null);
      const c = j && (j.choices?.[0]?.message?.content ?? (j.content || []).map((b) => b.text || '').join(''));
      if (!c) throw new AttemptError('returned an empty reply', { cooldown: 20 });
      tick();
      splitter.push(c);
      splitter.flush();
    } else {
      for await (const line of sseLines(res.body)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) throw classify(j.error.code === 429 ? 429 : 500, JSON.stringify(j.error));
        if (provider.kind === 'anthropic') {
          if (j.type === 'content_block_delta') {
            tick();
            if (j.delta.type === 'text_delta') splitter.push(j.delta.text);
            else if (j.delta.type === 'thinking_delta') {
              reasoningChars += j.delta.thinking.length;
              emit({ type: 'reasoning', chars: j.delta.thinking.length });
            }
          } else if (j.type === 'error') throw classify(500, JSON.stringify(j.error));
        } else {
          const d = j.choices?.[0]?.delta || {};
          const r = d.reasoning || d.reasoning_content;
          if (r) {
            tick();
            reasoningChars += r.length;
            emit({ type: 'reasoning', chars: r.length });
          }
          if (d.content) {
            tick();
            splitter.push(d.content);
          }
        }
      }
      splitter.flush();
    }
  } catch (e) {
    if (signal.aborted) throw new AttemptError('stopped', { fatal: true });
    if (e instanceof AttemptError) throw e;
    if (ctrl.timeoutReason) throw new AttemptError(ctrl.timeoutReason, { cooldown: 45 });
    throw new AttemptError(`connection dropped (${e.message || e})`, { cooldown: 20 });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onOuterAbort);
  }

  if (!text.trim()) throw new AttemptError(reasoningChars ? 'thought but never answered' : 'returned an empty reply', { cooldown: 20 });
  return { text };
}

// ---------- chain ----------
function usable(provider, cfg, key) {
  if (!cfg || cfg.enabled === false) return false;
  if (provider.kind === 'cli') return !!cfg.cliReady;
  if (provider.custom) return !!(cfg.extra && cfg.extra.baseUrl);
  if (provider.extraFields && provider.extraFields.some((f) => !(cfg.extra && cfg.extra[f.id]))) return false;
  return provider.keyless || !!key;
}

function buildChain({ agent, pinned, providerCfgs, providerOrder, keys, autoFallback }) {
  const out = [];
  const seen = new Set();
  const add = (provider, model, source) => {
    if (!provider || !model) return;
    const k = `${provider}|${model}`;
    if (seen.has(k)) return;
    const p = byId[provider];
    if (!p || !usable(p, providerCfgs[provider], keys[provider])) return;
    seen.add(k);
    out.push({ provider, model, source });
  };
  if (pinned) add(pinned.provider, pinned.model, 'pinned');
  for (const e of agent.engines || []) add(e.provider, e.model, 'agent');
  if (autoFallback && agent.autoFallback !== false) {
    for (const id of providerOrder) {
      const cfg = providerCfgs[id] || {};
      add(id, cfg.defaultModel || byId[id]?.models[0], 'fallback');
    }
    // second pass: a backup model on each provider, for when one model is down but the account is fine
    for (const id of providerOrder) {
      const cfg = providerCfgs[id] || {};
      const models = cfg.models && cfg.models.length ? cfg.models : byId[id]?.models || [];
      const backup = models.find((m) => m !== (cfg.defaultModel || models[0]));
      add(id, backup, 'fallback');
    }
  }
  // Keep pinned first; push resting providers to the back instead of dropping them.
  const head = out.filter((c) => c.source === 'pinned');
  const rest = out.filter((c) => c.source !== 'pinned');
  return [...head, ...rest.filter((c) => !isCooling(c.provider, c.model)), ...rest.filter((c) => isCooling(c.provider, c.model))];
}

async function run({ chain, providerCfgs, keys, system, messages, temperature, signal, timeouts, emit, maxAttempts = 12, cwd, allowEdits }) {
  const attempts = [];
  for (const c of chain.slice(0, maxAttempts)) {
    const provider = byId[c.provider];
    const started = Date.now();
    emit({ type: 'attempt', provider: c.provider, providerName: provider.name, model: c.model });
    try {
      const { text } = await attempt({
        provider, cfg: providerCfgs[c.provider] || {}, key: keys[c.provider], model: c.model,
        system, messages, temperature, signal, timeouts, emit, cwd, allowEdits,
      });
      const ms = Date.now() - started;
      attempts.push({ ...c, ok: true, ms });
      return { ok: true, provider: c.provider, providerName: provider.name, model: c.model, ms, text, attempts };
    } catch (e) {
      if (e.fatal) return { ok: false, stopped: true, attempts };
      cool(c.provider, e.status === 401 || e.status === 403 || e.status === 402 ? null : c.model, e.cooldown);
      attempts.push({ ...c, ok: false, reason: e.message, ms: Date.now() - started });
      emit({ type: 'switch', provider: c.provider, providerName: provider.name, model: c.model, reason: e.message });
    }
  }
  return { ok: false, attempts };
}

// ---------- utilities used by settings ----------
async function fetchModels(provider, cfg, key) {
  const url = modelsUrlFor(provider, cfg);
  const res = await fetch(url, { headers: { ...authHeaders(provider, key), ...(provider.headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw classify(res.status, await res.text().catch(() => ''));
  const j = await res.json();
  let ids = [];
  if (Array.isArray(j)) ids = j.map((m) => m.id || m.name).filter(Boolean);
  else if (Array.isArray(j.data)) ids = j.data.map((m) => m.id).filter(Boolean);
  else if (Array.isArray(j.result)) ids = j.result.map((m) => m.name).filter(Boolean);
  else if (Array.isArray(j.models)) ids = j.models.map((m) => m.id || m.name).filter(Boolean);
  ids = ids.filter((id) => !/embed|whisper|tts|audio|image|vision-only|moderation|rerank|guard|dall-e|transcribe/i.test(id));
  if (provider.freeFilter) {
    const free = ids.filter((id) => id.endsWith(provider.freeFilter));
    if (free.length) ids = free;
  }
  return [...new Set(ids)].sort();
}

module.exports = { run, buildChain, fetchModels, attempt, clearCooldowns, isCooling, usable, AttemptError };
