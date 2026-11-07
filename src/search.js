// Web search for nodes. Engines are tried in the user's order until one returns results.
// "browser-google"/"browser-bing" drive a hidden real browser window (no key, real results).

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0 Safari/537.36';

const SEARCH_ENGINES = [
  { id: 'browser-google', name: 'Google (built-in browser)', free: true, keyless: true, note: 'Real Google results through a hidden browser window. No key.' },
  { id: 'brave', name: 'Brave Search API', free: true, keyUrl: 'https://api-dashboard.search.brave.com/app/keys', note: 'Independent index. 2,000 free searches a month.' },
  { id: 'tavily', name: 'Tavily', free: true, keyUrl: 'https://app.tavily.com/home', note: 'Built for AI agents. 1,000 free searches a month.' },
  { id: 'serper', name: 'Serper (Google)', free: true, keyUrl: 'https://serper.dev/api-key', note: 'Google results as JSON. 2,500 free searches.' },
  { id: 'exa', name: 'Exa', free: true, keyUrl: 'https://dashboard.exa.ai/api-keys', note: 'Neural search, great for docs and code. Free credits.' },
  { id: 'searxng', name: 'SearXNG', free: true, keyless: true, extra: 'url', note: 'Your own or a public SearXNG instance URL (with JSON enabled).' },
  { id: 'browser-bing', name: 'Bing (built-in browser)', free: true, keyless: true, note: 'Real Bing results through a hidden browser window. No key.' },
  { id: 'duckduckgo', name: 'DuckDuckGo', free: true, keyless: true, note: 'Simple HTML results. No key.' },
  { id: 'wikipedia', name: 'Wikipedia', free: true, keyless: true, note: 'Encyclopedia lookups. No key.' },
];

const decode = (s) =>
  (s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim();

// ---------- hidden browser ----------
let BrowserWindow = null;
let session = null;
try {
  ({ BrowserWindow, session } = require('electron'));
} catch {}

async function browserSearch(url, extractJs) {
  if (!BrowserWindow) throw new Error('no browser');
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { partition: 'persist:nodes-browser', sandbox: true, contextIsolation: true, images: false } });
  win.webContents.setUserAgent(UA);
  try {
    await Promise.race([win.loadURL(url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))]);
    const host = new URL(win.webContents.getURL()).host;
    if (/consent|sorry|captcha/.test(win.webContents.getURL()) || host.startsWith('consent.')) throw new Error('blocked by consent/captcha');
    let results = [];
    for (let i = 0; i < 6 && !results.length; i++) {
      results = await win.webContents.executeJavaScript(extractJs);
      if (!results.length) await new Promise((r) => setTimeout(r, 400));
    }
    return results;
  } finally {
    win.destroy();
  }
}

const GOOGLE_JS = `(() => {
  const out = [];
  for (const h of document.querySelectorAll('#search a h3')) {
    const a = h.closest('a'); if (!a || !a.href.startsWith('http') || a.href.includes('google.com/')) continue;
    const box = a.closest('[data-hveid], .g, .MjjYud') || a.parentElement;
    const sn = box && (box.querySelector('[data-sncf], .VwiC3b, .IsZvec') || {}).innerText;
    out.push({ title: h.innerText, url: a.href, snippet: (sn || '').slice(0, 300) });
  }
  return out;
})()`;
const BING_JS = `(() => [...document.querySelectorAll('li.b_algo')].map(li => {
  const a = li.querySelector('h2 a'); const p = li.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3, p');
  return a ? { title: a.innerText, url: a.href, snippet: p ? p.innerText.slice(0, 300) : '' } : null;
}).filter(Boolean))()`;

// ---------- engines ----------
const engines = {
  'browser-google': (q) => browserSearch(`https://www.google.com/search?hl=en&num=10&q=${encodeURIComponent(q)}`, GOOGLE_JS),
  'browser-bing': (q) => browserSearch(`https://www.bing.com/search?setlang=en&q=${encodeURIComponent(q)}`, BING_JS),
  async brave(q, key) {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?count=8&q=${encodeURIComponent(q)}`, { headers: { 'X-Subscription-Token': key, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('brave ' + r.status);
    const j = await r.json();
    return (j.web?.results || []).map((x) => ({ title: x.title, url: x.url, snippet: decode(x.description) }));
  },
  async tavily(q, key) {
    const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ query: q, max_results: 8, include_answer: false }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('tavily ' + r.status);
    const j = await r.json();
    return (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: (x.content || '').slice(0, 400) }));
  },
  async serper(q, key) {
    const r = await fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q, num: 8 }), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('serper ' + r.status);
    const j = await r.json();
    return (j.organic || []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet || '' }));
  },
  async exa(q, key) {
    const r = await fetch('https://api.exa.ai/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key }, body: JSON.stringify({ query: q, numResults: 8, contents: { text: { maxCharacters: 400 } } }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('exa ' + r.status);
    const j = await r.json();
    return (j.results || []).map((x) => ({ title: x.title || x.url, url: x.url, snippet: (x.text || '').slice(0, 400) }));
  },
  async searxng(q, _key, extra) {
    if (!extra) throw new Error('no url');
    const r = await fetch(`${extra.replace(/\/+$/, '')}/search?format=json&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('searx ' + r.status);
    const j = await r.json();
    return (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content || '' }));
  },
  async duckduckgo(q) {
    const r = await fetch('https://html.duckduckgo.com/html/', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'q=' + encodeURIComponent(q), signal: AbortSignal.timeout(10000) });
    const html = await r.text();
    if (html.includes('anomaly')) throw new Error('ddg blocked');
    const out = [];
    const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html))) {
      let url = m[1];
      const u = url.match(/uddg=([^&]+)/);
      if (u) url = decodeURIComponent(u[1]);
      out.push({ title: decode(m[2]), url, snippet: decode(m[3]) });
    }
    return out;
  },
  async wikipedia(q) {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Nodes/1.0 (desktop app)' }, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    return (j.query?.search || []).map((x) => ({ title: x.title, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')), snippet: decode(x.snippet) }));
  },
};

const searchPageUrl = {
  'browser-google': (q) => `https://www.google.com/search?hl=en&q=${encodeURIComponent(q)}`,
  'browser-bing': (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  brave: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
  serper: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  wikipedia: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
};

// cfg: { order: [ids], enabled: {id:bool}, keys: {id:key}, extra: {id:value} }
async function search(q, cfg, limit = 6) {
  const tried = [];
  for (const id of cfg.order) {
    const meta = SEARCH_ENGINES.find((e) => e.id === id);
    if (!meta || cfg.enabled[id] === false) continue;
    const key = cfg.keys[id];
    if (!meta.keyless && !key) continue;
    if (meta.extra && !cfg.extra[id]) continue;
    try {
      const r = (await engines[id](q, key, cfg.extra[id])).filter((x) => x.url && x.title);
      if (r.length) return { engine: meta.name, engineId: id, results: r.slice(0, limit), pageUrl: (searchPageUrl[id] || searchPageUrl['browser-google'])(q), tried };
      tried.push(`${meta.name}: no results`);
    } catch (e) {
      tried.push(`${meta.name}: ${e.message}`);
    }
  }
  return { engine: null, results: [], tried, pageUrl: searchPageUrl['browser-google'](q) };
}

// Fetches a page and returns readable text (for grounding answers on the top results).
async function readPage(url, max = 2500) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(8000), redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/html|text|json/.test(type)) return '';
    let html = (await r.text()).slice(0, 600000);
    html = html.replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)[\s\S]*?<\/\1>/gi, ' ');
    const main = html.match(/<(article|main)[\s\S]*?<\/\1>/i);
    return decode((main ? main[0] : html).replace(/<\/(p|div|h\d|li|tr|pre)>/gi, '\n')).slice(0, max);
  } catch {
    return '';
  }
}

module.exports = { search, readPage, SEARCH_ENGINES };
