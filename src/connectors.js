// Connections to the user's own accounts: GitHub, Google (Gmail, Drive, Calendar) and Notion.
// Tokens are stored encrypted by main.js; this module only uses them.
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CONNECTORS = [
  { id: 'github', name: 'GitHub', blurb: 'Repos, issues, files and pull requests.', soon: !require('./oauth').github.clientId },
  { id: 'google', name: 'Google Workspace', blurb: 'Gmail, Google Drive and Google Calendar.', soon: !require('./oauth').google.clientId },
  { id: 'notion', name: 'Notion', blurb: 'Search and read your pages.', soon: true },
];

const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/calendar.events'];

const clip = (s, n = 6000) => {
  s = typeof s === 'string' ? s : JSON.stringify(s, null, 1);
  return s.length > n ? s.slice(0, n) + `\n…(${s.length - n} more characters)` : s;
};

// ---------------- GitHub ----------------
async function gh(token, method, url, body) {
  const r = await fetch(url.startsWith('http') ? url : 'https://api.github.com' + url, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Nodes', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}

// ---------------- Google ----------------
// OAuth with a loopback redirect and PKCE.
function googleSignIn({ clientId, clientSecret, openExternal }) {
  return new Promise((resolve, reject) => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(12).toString('hex');
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') return res.end();
      const done = (msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<body style="font:16px -apple-system,system-ui;background:#131312;color:#f4f2eb;display:grid;place-items:center;height:100vh;margin:0"><div>${msg}</div></body>`);
        setTimeout(() => server.close(), 300);
      };
      if (u.searchParams.get('state') !== state) return done('Something went wrong. Close this tab and try again from Nodes.');
      const code = u.searchParams.get('code');
      if (!code) {
        done('Sign-in was cancelled. You can close this tab.');
        return reject(new Error(u.searchParams.get('error') || 'cancelled'));
      }
      try {
        const port = server.address().port;
        const r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret || '', redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code', code_verifier: verifier }),
        });
        const j = await r.json();
        if (!j.refresh_token) throw new Error(j.error_description || j.error || 'No refresh token returned');
        let email = '';
        try {
          email = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64url').toString()).email || '';
        } catch {}
        done('Google is connected to Nodes. You can close this tab.');
        resolve({ refresh: j.refresh_token, access: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000, email });
      } catch (e) {
        done('Could not finish connecting. Close this tab and try again from Nodes.');
        reject(e);
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state }).toString();
      openExternal(auth.toString());
    });
    setTimeout(() => {
      try {
        server.close();
      } catch {}
      reject(new Error('Timed out waiting for Google sign-in'));
    }, 5 * 60 * 1000);
  });
}

async function googleToken(store) {
  const g = store.get();
  if (!g || !g.refresh) throw new Error('Google is not connected. Connect it in Settings › Apps.');
  if (g.access && g.expires > Date.now()) return g.access;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret || '', refresh_token: g.refresh, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google sign-in expired. Reconnect it in Settings › Apps.');
  store.set({ ...g, access: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}
async function gapi(store, url, opts = {}) {
  const tok = await googleToken(store);
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${tok}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Google ${r.status}: ${t.slice(0, 300)}`);
  return opts.raw ? t : t ? JSON.parse(t) : {};
}
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const header = (msg, n) => (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === n)?.value || '';
function bodyText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts || []) {
    const t = bodyText(p);
    if (t) return t;
  }
  if (part.mimeType === 'text/html' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return '';
}
const mime = (to, subject, body) => b64(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`);

// ---------------- Notion ----------------
async function notion(token, path, body) {
  const r = await fetch('https://api.notion.com/v1' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Notion ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const notionTitle = (p) => Object.values(p.properties || {}).find((v) => v.type === 'title')?.title?.map((t) => t.plain_text).join('') || p.title?.map?.((t) => t.plain_text).join('') || 'Untitled';

// ---------------- tool definitions ----------------
const S = (props, req = []) => ({ type: 'object', properties: props, required: req });
const str = (d) => ({ type: 'string', description: d });
const num = (d) => ({ type: 'number', description: d });

function defs(connected) {
  const out = [];
  if (connected.github)
    out.push(
      { name: 'github_list_repos', description: "List the user's GitHub repositories (most recently pushed first).", parameters: S({ limit: num('How many, default 20') }) },
      { name: 'github_list_issues', description: 'List issues or pull requests in a repository.', parameters: S({ repo: str('owner/name'), state: str('open, closed or all') }, ['repo']) },
      { name: 'github_read_file', description: 'Read a file from a GitHub repository.', parameters: S({ repo: str('owner/name'), path: str('File path'), ref: str('Branch or commit, optional') }, ['repo', 'path']) },
      { name: 'github_create_issue', description: 'Open a new issue. Needs approval.', parameters: S({ repo: str('owner/name'), title: str('Title'), body: str('Markdown body') }, ['repo', 'title']) },
      { name: 'github_comment', description: 'Comment on an issue or pull request. Needs approval.', parameters: S({ repo: str('owner/name'), number: num('Issue or PR number'), body: str('Comment') }, ['repo', 'number', 'body']) },
      { name: 'github_clone', description: 'Clone a repository into the workspace so you can work on it.', parameters: S({ repo: str('owner/name') }, ['repo']) },
      { name: 'github_create_pull_request', description: 'Open a pull request from a branch you already pushed. Needs approval.', parameters: S({ repo: str('owner/name'), head: str('Branch with the changes'), base: str('Target branch, e.g. main'), title: str('Title'), body: str('Description') }, ['repo', 'head', 'base', 'title']) }
    );
  if (connected.google)
    out.push(
      { name: 'gmail_search', description: 'Search Gmail. Uses Gmail search syntax, e.g. "from:alex is:unread newer_than:7d".', parameters: S({ query: str('Gmail search query'), limit: num('Max results, default 10') }, ['query']) },
      { name: 'gmail_read', description: 'Read one email by id.', parameters: S({ id: str('Message id from gmail_search') }, ['id']) },
      { name: 'gmail_draft', description: 'Create a Gmail draft for the user to review. Needs approval.', parameters: S({ to: str('Recipient'), subject: str('Subject'), body: str('Plain-text body') }, ['to', 'subject', 'body']) },
      { name: 'gmail_send', description: 'Send an email right away. Always needs approval. Prefer gmail_draft.', parameters: S({ to: str('Recipient'), subject: str('Subject'), body: str('Plain-text body') }, ['to', 'subject', 'body']) },
      { name: 'drive_search', description: 'Search Google Drive files by name or contents.', parameters: S({ query: str('Words to search for'), limit: num('Max results, default 10') }, ['query']) },
      { name: 'drive_read', description: 'Read a Google Doc, Sheet (as CSV) or text file from Drive.', parameters: S({ id: str('File id from drive_search') }, ['id']) },
      { name: 'calendar_upcoming', description: "List the user's upcoming calendar events.", parameters: S({ days: num('How many days ahead, default 7') }) },
      { name: 'calendar_create_event', description: 'Create a calendar event. Needs approval.', parameters: S({ title: str('Title'), start: str('Start, ISO 8601 with timezone'), end: str('End, ISO 8601 with timezone'), attendees: str('Comma-separated emails, optional'), description: str('Optional notes') }, ['title', 'start', 'end']) }
    );
  if (connected.notion)
    out.push(
      { name: 'notion_search', description: "Search the user's Notion pages.", parameters: S({ query: str('Search text') }, ['query']) },
      { name: 'notion_read_page', description: 'Read a Notion page as text.', parameters: S({ id: str('Page id from notion_search') }, ['id']) }
    );
  return out;
}

// Which tools change something outside Nodes and so always need the user's OK (unless Full trust).
const MUTATING = new Set(['github_create_issue', 'github_comment', 'github_create_pull_request', 'gmail_draft', 'gmail_send', 'calendar_create_event']);

async function run(name, a, ctx) {
  const { tokens, google, cwd, approve } = ctx;
  if (MUTATING.has(name)) {
    const ok = await approve({ kind: 'app', title: name.replace(/_/g, ' '), detail: clip(a, 1500), always: name !== 'gmail_send' });
    if (!ok) return 'The user declined this action.';
  }
  switch (name) {
    case 'github_list_repos': {
      const r = await gh(tokens.github, 'GET', `/user/repos?sort=pushed&per_page=${Math.min(+a.limit || 20, 100)}`);
      return r.map((x) => `${x.full_name}${x.private ? ' (private)' : ''} · ${x.description || ''} · pushed ${x.pushed_at}`).join('\n') || 'No repositories.';
    }
    case 'github_list_issues': {
      const r = await gh(tokens.github, 'GET', `/repos/${a.repo}/issues?state=${a.state || 'open'}&per_page=30`);
      return r.map((x) => `#${x.number} ${x.pull_request ? '[PR] ' : ''}${x.title} (${x.state}) by ${x.user?.login}`).join('\n') || 'None.';
    }
    case 'github_read_file': {
      const r = await gh(tokens.github, 'GET', `/repos/${a.repo}/contents/${encodeURI(a.path)}${a.ref ? `?ref=${encodeURIComponent(a.ref)}` : ''}`);
      if (Array.isArray(r)) return r.map((x) => `${x.type === 'dir' ? '📁' : '📄'} ${x.path}`).join('\n');
      return clip(Buffer.from(r.content || '', 'base64').toString('utf8'), 20000);
    }
    case 'github_create_issue': {
      const r = await gh(tokens.github, 'POST', `/repos/${a.repo}/issues`, { title: a.title, body: a.body || '' });
      return `Opened issue #${r.number}: ${r.html_url}`;
    }
    case 'github_comment': {
      const r = await gh(tokens.github, 'POST', `/repos/${a.repo}/issues/${a.number}/comments`, { body: a.body });
      return `Commented: ${r.html_url}`;
    }
    case 'github_create_pull_request': {
      const r = await gh(tokens.github, 'POST', `/repos/${a.repo}/pulls`, { head: a.head, base: a.base, title: a.title, body: a.body || '' });
      return `Opened pull request #${r.number}: ${r.html_url}`;
    }
    case 'github_clone': {
      const dest = require('path').join(cwd, a.repo.split('/').pop());
      const ok = await approve({ kind: 'command', title: `Clone ${a.repo}`, detail: `git clone into ${dest}`, always: true });
      if (!ok) return 'The user declined.';
      const r = await new Promise((res) => execFile('git', ['-c', `http.extraHeader=Authorization: Bearer ${tokens.github}`, 'clone', '--depth', '50', `https://github.com/${a.repo}.git`, dest], { timeout: 300000 }, (e, o, er) => res({ ok: !e, er: String(er || e?.message || '') })));
      return r.ok ? `Cloned into ${dest}. Work there with the file tools.` : `Clone failed: ${r.er.slice(-400)}`;
    }
    case 'gmail_search': {
      const l = await gapi(google, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${Math.min(+a.limit || 10, 25)}&q=${encodeURIComponent(a.query)}`);
      const rows = [];
      for (const m of l.messages || []) {
        const x = await gapi(google, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        rows.push(`id ${m.id} · ${header(x, 'date')} · from ${header(x, 'from')} · "${header(x, 'subject')}" · ${x.snippet}`);
      }
      return rows.join('\n') || 'No emails found.';
    }
    case 'gmail_read': {
      const x = await gapi(google, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${a.id}?format=full`);
      return clip(`From: ${header(x, 'from')}\nTo: ${header(x, 'to')}\nDate: ${header(x, 'date')}\nSubject: ${header(x, 'subject')}\n\n${bodyText(x.payload)}`, 12000);
    }
    case 'gmail_draft': {
      const r = await gapi(google, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', body: JSON.stringify({ message: { raw: mime(a.to, a.subject, a.body) } }) });
      return `Draft saved in Gmail (id ${r.id}). The user can review and send it.`;
    }
    case 'gmail_send': {
      await gapi(google, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw: mime(a.to, a.subject, a.body) }) });
      return `Sent to ${a.to}.`;
    }
    case 'drive_search': {
      const q = `fullText contains '${String(a.query).replace(/'/g, "\\'")}' and trashed = false`;
      const r = await gapi(google, `https://www.googleapis.com/drive/v3/files?pageSize=${Math.min(+a.limit || 10, 25)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&q=${encodeURIComponent(q)}`);
      return (r.files || []).map((f) => `id ${f.id} · ${f.name} · ${f.mimeType.split('.').pop()} · modified ${f.modifiedTime}`).join('\n') || 'No files found.';
    }
    case 'drive_read': {
      const meta = await gapi(google, `https://www.googleapis.com/drive/v3/files/${a.id}?fields=name,mimeType`);
      let text;
      if (meta.mimeType === 'application/vnd.google-apps.document') text = await gapi(google, `https://www.googleapis.com/drive/v3/files/${a.id}/export?mimeType=text/plain`, { raw: true });
      else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') text = await gapi(google, `https://www.googleapis.com/drive/v3/files/${a.id}/export?mimeType=text/csv`, { raw: true });
      else if (meta.mimeType === 'application/vnd.google-apps.presentation') text = await gapi(google, `https://www.googleapis.com/drive/v3/files/${a.id}/export?mimeType=text/plain`, { raw: true });
      else if (/^text\/|json|csv|markdown/.test(meta.mimeType)) text = await gapi(google, `https://www.googleapis.com/drive/v3/files/${a.id}?alt=media`, { raw: true });
      else return `${meta.name} is a ${meta.mimeType} file, which can't be read as text.`;
      return clip(`${meta.name}\n\n${text}`, 20000);
    }
    case 'calendar_upcoming': {
      const now = new Date();
      const until = new Date(now.getTime() + (+a.days || 7) * 864e5);
      const r = await gapi(google, `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${now.toISOString()}&timeMax=${until.toISOString()}`);
      return (r.items || []).map((e) => `${e.start?.dateTime || e.start?.date} → ${e.summary || '(no title)'}${e.location ? ' @ ' + e.location : ''}${e.attendees ? ` · ${e.attendees.length} people` : ''}`).join('\n') || 'Nothing scheduled.';
    }
    case 'calendar_create_event': {
      const r = await gapi(google, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST', body: JSON.stringify({ summary: a.title, description: a.description || '', start: { dateTime: a.start }, end: { dateTime: a.end }, attendees: (a.attendees || '').split(',').map((x) => x.trim()).filter(Boolean).map((email) => ({ email })) }),
      });
      return `Created "${r.summary}": ${r.htmlLink}`;
    }
    case 'notion_search': {
      const r = await notion(tokens.notion, '/search', { query: a.query, page_size: 15 });
      return (r.results || []).map((p) => `id ${p.id} · ${notionTitle(p)} · ${p.object} · edited ${p.last_edited_time}`).join('\n') || 'Nothing found. Make sure the page is shared with your Nodes integration.';
    }
    case 'notion_read_page': {
      const r = await notion(tokens.notion, `/blocks/${a.id}/children?page_size=100`);
      const text = (r.results || []).map((b) => {
        const v = b[b.type];
        return (v?.rich_text || []).map((t) => t.plain_text).join('') || '';
      }).filter(Boolean).join('\n');
      return clip(text || '(empty page)', 20000);
    }
  }
  return `Unknown tool ${name}`;
}

module.exports = { CONNECTORS, defs, run, googleSignIn, has: (n) => n.startsWith('github_') || n.startsWith('gmail_') || n.startsWith('drive_') || n.startsWith('calendar_') || n.startsWith('notion_') };
