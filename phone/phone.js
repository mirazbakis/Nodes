'use strict';
const root = document.getElementById('root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const { nodeAvatar, teamAvatar } = window.NodeAvatars;
let token = localStorage.getItem('nodes-token');
let state = null;
let openId = null;
let conv = null;
let online = true;
let es = null;

const api = async (path, body) => {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) {
    localStorage.removeItem('nodes-token');
    token = null;
    return showPair();
  }
  return r.json();
};
const nodeById = (id) => (state && state.nodes.find((n) => n.id === id)) || { name: id, avatar: null };
const timeLabel = (ts) => {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const convAv = (c, s) => (c.nodeIds && c.nodeIds.length > 1 ? teamAvatar(c.nodeIds.map((id) => nodeById(id).avatar || { bg: ['#64748b', '#334155'] }), s) : nodeAvatar(nodeById((c.nodeIds || [])[0]).avatar, s));
const md = (t) => DOMPurify.sanitize(marked.parse(t || ''));

function showPair(err) {
  const code = (location.hash.match(/pair=(\d+)/) || [])[1] || '';
  root.innerHTML = `<div class="screen"><div class="pair"><div><img src="/icon.png" width="84" height="84" style="border-radius:20px"><h1>Connect to Nodes</h1><p>Enter the 6-digit code shown in Nodes on your computer under Settings, then Phone.</p>
    <input id="code" inputmode="numeric" maxlength="6" value="${esc(code)}" placeholder="000000"><br><button class="btn" id="go">Connect</button>${err ? `<p class="err" style="margin-top:14px">${esc(err)}</p>` : ''}</div></div></div>`;
  const go = async () => {
    const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: document.getElementById('code').value.trim(), name: /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'Phone' }) });
    const j = await r.json();
    if (!j.token) return showPair(j.error || 'That code did not work');
    token = j.token;
    localStorage.setItem('nodes-token', token);
    history.replaceState(null, '', '/');
    start();
  };
  document.getElementById('go').onclick = go;
  if (code.length === 6) go();
}

function listView() {
  const convs = [...state.conversations].sort((a, b) => (b.nodeIds.length > 1 && b.title === 'Team') - (a.nodeIds.length > 1 && a.title === 'Team') || b.updatedAt - a.updatedAt);
  root.innerHTML = `<div class="screen"><div class="head"><img src="/icon.png" width="28" height="28" style="border-radius:7px"><h1>Nodes</h1></div>${online ? '' : '<div class="offline">Reconnecting to your computer…</div>'}
    <div class="list"><div class="nodes">${state.nodes.map((n) => `<button data-new="${n.id}">${nodeAvatar(n.avatar, 50)}${esc(n.name)}</button>`).join('')}</div>
    <div class="sec">Chats</div>${convs.map((c) => `<button class="row" data-open="${c.id}">${convAv(c, 48)}<div class="b"><div class="top"><b>${esc(c.title && c.nodeIds.length > 1 ? c.title : nodeById(c.nodeIds[0]).name)}</b><span class="time">${timeLabel(c.updatedAt)}</span></div><div class="p">${esc((c.preview || '').replace(/[#*`>_]/g, ''))}</div></div></button>`).join('')}</div></div>`;
  root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openConv(b.dataset.open)));
  root.querySelectorAll('[data-new]').forEach((b) => (b.onclick = async () => {
    const existing = [...state.conversations].filter((c) => c.nodeIds.length === 1 && c.nodeIds[0] === b.dataset.new).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (existing) return openConv(existing.id);
    const r = await api('/api/new', { nodeId: b.dataset.new });
    if (r && r.id) {
      await refresh();
      openConv(r.id);
    }
  }));
}

async function openConv(id) {
  openId = id;
  conv = await api('/api/conv/' + encodeURIComponent(id));
  chatView(true);
}
function chatView(scroll) {
  if (!conv) return;
  const multi = conv.nodeIds.length > 1;
  const title = conv.kind === 'node' ? nodeById(conv.nodeIds[0]).name : conv.title || 'Chat';
  const busy = conv.messages.some((m) => m.role === 'ai' && !m.meta && !m.error && !m.stopped && !m.greeting && !m.image && conv.messages.indexOf(m) === conv.messages.length - 1 && Date.now() - m.ts < 600000);
  const msgs = conv.messages.map((m) => {
    if (m.role === 'banner') return `<div class="banner">${esc(m.content)}</div>`;
    if (m.role === 'note') return `<div class="banner">${esc(nodeById(m.nodeId).name)} · ${esc(m.content)}</div>`;
    if (m.role === 'user') return `<div class="m u"><div>${esc(m.content)}</div></div>`;
    const n = nodeById(m.nodeId);
    const name = m.label || n.name;
    const tools = (m.tools || []).slice(-3).map((t) => `<div class="tool"><i>⏺</i> ${esc(t)}</div>`).join('');
    const body = m.image ? `<img src="${esc(m.image.url)}" style="max-width:100%;border-radius:12px">` : m.error ? `<div class="err">No engine could answer.</div>` : m.content ? `<div class="md">${md(m.content.replace(/\n?\[DONE\]\s*$/, ''))}</div>` : `<div class="typing">Thinking…</div>`;
    return `<div class="m a">${nodeAvatar(n.avatar, 28)}<div style="min-width:0"><div class="n">${esc(name)}${m.meta ? `<span>${esc(m.meta.providerName)}</span>` : ''}</div>${tools}${body}</div></div>`;
  }).join('');
  const thread = document.querySelector('.thread');
  const near = !thread || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
  if (thread && root.dataset.conv === conv.id) {
    thread.innerHTML = msgs;
    if (near) thread.scrollTop = thread.scrollHeight;
    const sb = document.getElementById('send');
    sb.className = 'send ' + (busy ? 'stop' : '');
    sb.textContent = busy ? '■' : '↑';
    sb.dataset.busy = busy ? '1' : '';
    return;
  }
  root.dataset.conv = conv.id;
  const draft = document.getElementById('in')?.value || '';
  root.innerHTML = `<div class="screen"><div class="head"><button class="back" id="back">‹</button>${convAv(conv, 34)}<div class="t"><b>${esc(title)}</b><span>${multi ? conv.nodeIds.length + ' nodes' : esc(nodeById(conv.nodeIds[0]).tagline || '')}</span></div></div>${online ? '' : '<div class="offline">Reconnecting to your computer…</div>'}
    <div class="thread">${msgs}</div>
    <div class="composer"><textarea id="in" rows="1" placeholder="Message">${esc(draft)}</textarea><button class="send ${busy ? 'stop' : ''}" id="send">${busy ? '■' : '↑'}</button></div></div>`;
  const t = document.querySelector('.thread');
  if (scroll || near) t.scrollTop = t.scrollHeight;
  document.getElementById('back').onclick = () => {
    openId = null;
    conv = null;
    root.dataset.conv = '';
    refresh();
  };
  const input = document.getElementById('in');
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  };
  document.getElementById('send').dataset.busy = busy ? '1' : '';
  document.getElementById('send').onclick = async (e) => {
    if (e.currentTarget.dataset.busy) return api('/api/stop', { convId: conv.id });
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await api('/api/send', { convId: conv.id, text });
  };
}

async function refresh() {
  state = await api('/api/state');
  if (!state) return;
  if (!openId) listView();
}

function connect() {
  if (es) es.close();
  es = new EventSource('/api/events?t=' + encodeURIComponent(token));
  es.onopen = () => {
    if (!online) {
      online = true;
      openId ? openConv(openId) : refresh();
    }
  };
  es.onerror = () => {
    online = false;
  };
  es.addEventListener('conv', (e) => {
    const c = JSON.parse(e.data);
    if (state) {
      const i = state.conversations.findIndex((x) => x.id === c.id);
      const slim = { id: c.id, title: c.title, nodeIds: c.nodeIds, updatedAt: c.updatedAt, kind: c.kind, preview: ((c.messages.filter((m) => m.content).pop() || {}).content || '').slice(0, 120) };
      if (i === -1) state.conversations.unshift(slim);
      else state.conversations[i] = slim;
    }
    if (openId === c.id) {
      conv = c;
      chatView(false);
    } else if (!openId) listView();
  });
}

async function start() {
  if (!token) return showPair();
  await refresh();
  if (token) connect();
}
start();
