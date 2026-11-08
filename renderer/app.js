/* Nodes — renderer */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const { nodeAvatar, teamAvatar, randomSpec, PALETTES, PARTS } = window.NodeAvatars;
const api = window.nodes;

let S = null;
let view = 'home';
let currentId = null;
let homeTarget = { kind: 'node', nodeIds: ['engineer'] };
let homePinned = null;
let homeWeb = null;
let pendingFiles = [];
let searchQuery = '';
let enginesTab = 'agents';
let settingsTab = 'profile';
let expanded = null;
let memoryText = '';
let browserOpen = false;
const jobs = new Map();

// ---------------- helpers ----------------
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2000);
}
function timeLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if ((now - d) / 864e5 < 6) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function groupLabel(ts) {
  const diff = (new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 864e5;
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? 'Previous 7 days' : diff < 30 ? 'Previous 30 days' : 'Older';
}
const nodeById = (id) => S.nodes.find((a) => a.id === id) || S.nodes[0] || S.defaultNodes[0];
const providerById = (id) => S.providers.find((p) => p.id === id);
const convById = (id) => S.conversations.find((c) => c.id === id);
const current = () => convById(currentId);
const providerModels = (p) => (p.cfg.models && p.cfg.models.length ? p.cfg.models : p.models);
const shortModel = (m) => String(m || '').split('/').pop().replace(/:free$/, '');
const callMe = () => S.settings.callMe || S.settings.userName || 'there';
const fmtK = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n)));
function engineLabel(t) {
  if (!t) return 'Auto';
  const p = providerById(t.provider);
  if (!p) return shortModel(t.model);
  if (p.kind === 'cli') return t.model && t.model !== 'default' ? `${p.name} · ${t.model}` : p.name;
  return shortModel(t.model);
}
function av(node, size = 40) {
  return nodeAvatar(node && node.avatar, size);
}
function convAvatar(conv, size = 40) {
  if (conv.kind === 'team') return teamAvatar(conv.nodeIds.map((id) => nodeById(id).avatar), size);
  if (conv.kind === 'pair') return pairAvatar(size);
  if (conv.kind === 'project') return teamAvatar(conv.nodeIds.map((id) => nodeById(id).avatar), size);
  if (conv.kind === 'compare') return `<div class="li-logo" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.27)}px;background:linear-gradient(135deg,#334155,#1e293b)">${icon('sliders', size * 0.45)}</div>`;
  return av(nodeById(conv.nodeIds[0]), size);
}
function pairAvatar(size) {
  return `<svg class="node-av" width="${size}" height="${size}" viewBox="0 0 64 64" style="border-radius:${Math.round(size * 0.27)}px"><defs><linearGradient id="pg${size}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#16a34a"/></linearGradient></defs><rect width="64" height="64" fill="url(#pg${size})"/><circle cx="23" cy="32" r="10" fill="#f4f7fc"/><circle cx="41" cy="32" r="10" fill="#f4f7fc" opacity=".85"/><path d="M28 32h8" stroke="#0b1020" stroke-width="3" stroke-linecap="round"/><path d="m33 28 4 4-4 4" fill="none" stroke="#0b1020" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function convName(conv) {
  if (conv.kind === 'team') return 'Team';
  if (conv.kind === 'pair') return 'Pair';
  if (conv.kind === 'project') return conv.title || 'Project';
  if (conv.kind === 'compare') return 'Compare';
  return nodeById(conv.nodeIds[0]).name;
}

function logoSVG(size = 22, animated = false) {
  return `<img ${animated ? 'class="splash-logo"' : ''} src="icon.png" width="${size}" height="${size}" alt="" draggable="false" style="display:block;${size < 40 ? 'transform:scale(1.25)' : ''}">`;
}

// ---------------- markdown ----------------
marked.setOptions({ gfm: true, breaks: false });
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') node.setAttribute('target', '_blank');
});
function renderMarkdown(text, { highlight = true, sources } = {}) {
  const box = document.createElement('div');
  box.innerHTML = DOMPurify.sanitize(marked.parse(text || ''));
  for (const pre of $$('pre', box)) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const lang = ((code.className || '').match(/language-([\w+#-]+)/) || [])[1] || '';
    if (highlight) {
      try {
        code.innerHTML = lang && hljs.getLanguage(lang) ? hljs.highlight(code.textContent, { language: lang }).value : hljs.highlightAuto(code.textContent).value;
        code.classList.add('hljs');
      } catch {}
    }
    const head = document.createElement('div');
    head.className = 'code-head';
    head.innerHTML = `<span>${esc(lang || 'code')}</span><button data-copy-code>${icon('copy', 12)}Copy</button>`;
    pre.prepend(head);
  }
  if (sources && sources.length) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (/\[\d+\]/.test(walker.currentNode.nodeValue) && !walker.currentNode.parentElement.closest('pre,code')) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const span = document.createElement('span');
      span.innerHTML = esc(n.nodeValue).replace(/\[(\d+)\]/g, (m, d) => (sources[d - 1] ? `<a class="cite" data-src-url="${esc(sources[d - 1].url)}" title="${esc(sources[d - 1].title)}">${d}</a>` : m));
      n.replaceWith(...span.childNodes);
    }
  }
  return box.innerHTML;
}

// ---------------- boot ----------------
async function boot() {
  S = await api.getState();
  applyAccent();
  memoryText = (await api.getMemory()).text;
  $('.splash-logo').outerHTML = logoSVG(132, true);
  const map = { home: 'home', company: 'building', chat: 'chat', projects: 'briefcase', library: 'book', automations: 'zap', apps: 'apps', nodes: 'grid', engines: 'plug', activity: 'activity', settings: 'settings', phone: 'phone' };
  $$('.rail-btn').forEach((b) => (b.innerHTML = icon(map[b.dataset.view || b.dataset.action], 19)));
  $('.brand-mark').innerHTML = logoSVG(20);
  $('#btn-new').innerHTML = icon('plus', 17);
  $('#btn-search').innerHTML = icon('search', 15);
  $('#br-back').innerHTML = icon('back', 16);
  $('#br-fwd').innerHTML = icon('forward', 16);
  $('#br-reload').innerHTML = icon('refresh', 14);
  $('#br-ext').innerHTML = icon('external', 14);
  $('#br-close').innerHTML = icon('x', 15);
  $('#br-lock').innerHTML = icon('lock', 12);

  $$('.rail-btn[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('.rail-btn[data-action=phone]').addEventListener('click', openPhone);
  $('.rail-me').addEventListener('click', () => {
    settingsTab = 'profile';
    setView('settings');
  });
  $('#btn-new').addEventListener('click', (e) => openNewMenu(e.currentTarget));
  $('#btn-search').addEventListener('click', () => {
    $('#search-wrap').classList.toggle('hidden');
    if (!$('#search-wrap').classList.contains('hidden')) $('#search').focus();
    else {
      searchQuery = '';
      $('#search').value = '';
      renderSidebar();
    }
  });
  $('#search').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderSidebar();
  });
  setupBrowser();
  document.addEventListener('click', onGlobalClick);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeLayer());
  api.onChatEvent((ev) => onChatEvent(ev));
  api.onMenu((ch) => onMenu(ch));
  api.onBrowserOpen((url) => openBrowser(url));
  api.onRefresh(async () => {
    const st = await api.getState();
    S.providers = st.providers;
    S.cli = st.cli;
    if (!$('#onboarding').classList.contains('hidden')) return;
    renderSidebar();
    if (view !== 'chat') renderMain();
  });
  api.onPhoneAction((a) => onPhoneAction(a));

  const start = () => {
    if (!S.settings.onboarded) return startOnboarding();
    $('#app').classList.remove('hidden');
    view = S.conversations.length ? 'chat' : 'home';
    const recent = [...S.conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (recent) currentId = recent.id;
    render();
  };
  if (S.settings.launchAnimation) {
    $('#splash').classList.remove('hidden');
    setTimeout(start, 900);
    setTimeout(() => $('#splash').classList.add('out'), 1500);
    setTimeout(() => $('#splash').classList.add('hidden'), 2050);
  } else start();
}

function applyAccent() {
  const a = S.settings.accent || '#4c8dff';
  document.documentElement.style.setProperty('--accent', a);
  const r = parseInt(a.slice(1, 3), 16), g = parseInt(a.slice(3, 5), 16), b = parseInt(a.slice(5, 7), 16);
  document.documentElement.style.setProperty('--accent-soft', `rgba(${r},${g},${b},.14)`);
  document.documentElement.style.setProperty('--accent-ink', r * 0.299 + g * 0.587 + b * 0.114 > 170 ? '#111' : '#fff');
}

function onMenu(ch) {
  if (ch === 'new') openNewChat('node');
  else if (ch === 'new-node') editNode(null);
  else if (ch === 'settings') setView('settings');
  else if (ch === 'export') exportChat();
  else if (ch === 'folder') chooseFolder();
  else if (ch === 'phone') openPhone();
  else if (ch === 'onboarding') startOnboarding();
  else if (ch === 'toggle-sidebar') $('#sidebar').classList.toggle('collapsed');
  else if (ch === 'toggle-browser') (browserOpen ? closeBrowser() : openBrowser());
  else if (ch.startsWith('view-')) setView(ch.slice(5));
}

function onGlobalClick(e) {
  const copyBtn = e.target.closest('[data-copy-code]');
  if (copyBtn) {
    navigator.clipboard.writeText(copyBtn.closest('pre').querySelector('code').textContent);
    copyBtn.innerHTML = `${icon('check', 12)}Copied`;
    setTimeout(() => (copyBtn.innerHTML = `${icon('copy', 12)}Copy`), 1400);
    return;
  }
  const src = e.target.closest('[data-src-url]');
  if (src) {
    e.preventDefault();
    return openBrowser(src.dataset.srcUrl);
  }
  const ext = e.target.closest('[data-href]');
  if (ext) {
    e.preventDefault();
    api.openExternal(ext.dataset.href);
  }
  const link = e.target.closest('.md a[href^="http"]');
  if (link) {
    e.preventDefault();
    openBrowser(link.href);
  }
}

function setView(v) {
  view = v;
  closeLayer();
  render();
}
function render() {
  $$('.rail-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('.rail-me').textContent = (S.settings.userName || callMe() || '?').trim().charAt(0).toUpperCase() || '?';
  const engBtn = $('.rail-btn[data-view=engines]');
  engBtn.querySelector('.badge')?.remove();
  if (!S.providers.some((p) => p.usable && !p.keyless) && !S.providers.some((p) => p.kind === 'cli' && p.usable)) engBtn.insertAdjacentHTML('beforeend', '<span class="badge"></span>');
  $('#sidebar').classList.toggle('hidden', view !== 'chat' && view !== 'home');
  renderSidebar();
  renderMain();
}

// ---------------- sidebar ----------------
function renderSidebar() {
  const list = $('#conv-list');
  let convs = [...S.conversations].sort((a, b) => (b.kind === 'team') - (a.kind === 'team') || !!b.starred - !!a.starred || b.updatedAt - a.updatedAt);
  if (searchQuery) convs = convs.filter((c) => (convTitle(c) + ' ' + c.messages.map((m) => m.content).join(' ')).toLowerCase().includes(searchQuery));
  if (!convs.length) {
    list.innerHTML = `<div class="conv-empty">${searchQuery ? 'No chats match.' : 'No chats yet.'}</div>`;
    return;
  }
  let html = '';
  let last = '';
  for (const c of convs) {
    const g = c.kind === 'team' && !searchQuery ? 'Team' : c.starred && !searchQuery ? 'Pinned' : groupLabel(c.updatedAt);
    if (g !== last) {
      if (g !== 'Team') html += `<div class="conv-group">${g}</div>`;
      last = g;
    }
    const lastMsg = [...c.messages].reverse().find((m) => m.content || m.image);
    let preview = lastMsg ? (lastMsg.image ? 'Image: ' + lastMsg.image.prompt : (lastMsg.role === 'user' ? 'You: ' : c.kind === 'team' ? nodeById(lastMsg.nodeId).name + ': ' : '') + lastMsg.content) : '';
    preview = preview.replace(/[#*`>_]|\[DONE\]/g, '').replace(/\s+/g, ' ').slice(0, 100);
    const busy = [...jobs.values()].some((j) => j.convId === c.id);
    html += `<div class="conv ${c.id === currentId && view === 'chat' ? 'active' : ''}" data-id="${c.id}">
      ${convAvatar(c, 40)}
      <div class="conv-body">
        <div class="conv-top"><div class="conv-title">${esc(convTitle(c))}</div><div class="conv-time">${busy ? '<span class="typing-dots"><i></i><i></i><i></i></span>' : c.unread ? '<span class="unread"></span>' : timeLabel(c.updatedAt)}</div></div>
        <div class="conv-preview">${esc(preview || nodeById(c.nodeIds[0]).tagline)}</div>
      </div>
      <button class="icon-btn conv-more" data-more="${c.id}" title="More">${icon('more', 15)}</button>
    </div>`;
  }
  list.innerHTML = html;
  $$('.conv', list).forEach((el) =>
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) return;
      openConv(el.dataset.id);
    })
  );
  $$('[data-more]', list).forEach((b) => b.addEventListener('click', (e) => convMenu(convById(b.dataset.more), e.currentTarget)));
}
function convTitle(c) {
  if (c.kind === 'node' && !c.renamed) return nodeById(c.nodeIds[0]).name + (c.title && c.messages.some((m) => m.role === 'user') ? ' · ' + c.title : '');
  return c.title || convName(c);
}
function openConv(id) {
  currentId = id;
  const c = current();
  if (c && c.unread) {
    c.unread = false;
    persist(c);
  }
  view = 'chat';
  render();
}
function convMenu(conv, anchor) {
  const html = `<div class="menu-scroll">
    <button class="menu-item" data-a="star">${icon('pin', 15)}${conv.starred ? 'Unpin' : 'Pin to top'}</button>
    <button class="menu-item" data-a="rename">${icon('edit', 15)}Rename</button>
    <button class="menu-item" data-a="folder">${icon('folder', 15)}Set project folder</button>
    <button class="menu-item" data-a="export">${icon('download', 15)}Export as Markdown</button>
    <button class="menu-item" data-a="clear">${icon('refresh', 15)}Clear messages</button>
    <div class="menu-sep"></div>
    <button class="menu-item danger" data-a="delete">${icon('trash', 15)}Delete chat</button></div>`;
  openMenu(anchor, html, async (d) => {
    if (d.a === 'star') {
      conv.starred = !conv.starred;
      persist(conv);
      renderSidebar();
    } else if (d.a === 'rename') {
      const name = await promptModal('Rename chat', 'Name', conv.title || convName(conv));
      if (name != null) {
        conv.title = name.trim();
        conv.renamed = true;
        persist(conv);
        render();
      }
    } else if (d.a === 'folder') {
      currentId = conv.id;
      chooseFolder();
    } else if (d.a === 'export') {
      currentId = conv.id;
      exportChat();
    } else if (d.a === 'clear') {
      conv.messages = conv.messages.filter((m) => m.greeting);
      persist(conv);
      render();
    } else if (d.a === 'delete') {
      for (const j of jobs.values()) if (j.convId === conv.id) api.stopChat(j.reqId);
      await api.deleteConversation(conv.id);
      S.conversations = S.conversations.filter((c) => c.id !== conv.id);
      if (currentId === conv.id) currentId = null;
      render();
    }
  }, { below: true });
}

// ---------------- main router ----------------
function renderMain() {
  const main = $('#main');
  if (view === 'chat') return renderChat(main);
  if (view === 'home') return renderHome(main);
  if (view === 'nodes') return renderNodes(main);
  if (view === 'engines') return renderEngines(main);
  if (view === 'activity') return renderActivity(main);
  if (view === 'settings') return renderSettings(main);
  if (view === 'projects') return renderProjects(main);
  if (view === 'library') return renderLibrary(main);
  if (view === 'automations') return renderAutomations(main);
}
function topbar(titleHtml, actionsHtml = '') {
  return `<div class="topbar drag"><div class="topbar-title">${titleHtml}</div><div class="topbar-actions no-drag">${actionsHtml}</div></div>`;
}

// ---------------- home ----------------
function renderHome(main) {
  const h = new Date().getHours();
  const greet = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const readyCli = S.providers.filter((p) => p.kind === 'cli' && p.usable);
  const readyApi = S.providers.filter((p) => p.kind !== 'cli' && p.usable);
  const answers = S.conversations.reduce((s, c) => s + c.messages.filter((m) => m.meta).length, 0);
  const rescued = S.conversations.reduce((s, c) => s + c.messages.filter((m) => m.meta && m.routing && m.routing.length).length, 0);
  const recent = [...S.conversations].filter((c) => c.messages.some((m) => m.role === 'user')).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  main.innerHTML = `${topbar('')}
  <div class="page"><div class="page-inner">
    <div class="hello"><div class="date">${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1>${greet}, ${esc(callMe())}</h1>
      <p>${S.nodes.length} nodes on your team · ${readyCli.length + readyApi.length} engines ready${rescued ? ` · fallback saved ${rescued} of ${answers} answers` : ''}</p></div>
    <div class="quick">
      <button data-q="team">${icon('users', 18)}<b>Ask the team</b><span>The right nodes jump in, or @mention one</span></button>
      <button data-q="project">${icon('briefcase', 18)}<b>Start a project</b><span>Nodes take turns until it's built</span></button>
      <button data-q="compare">${icon('sliders', 18)}<b>Compare models</b><span>One prompt, answers side by side</span></button>
    </div>
    <div class="home-grid">
      <div class="card card-pad"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><h3>Your team</h3><div class="sub">Click a node to talk to it</div></div><button class="btn small" data-go="nodes">Manage</button></div>
        <div class="team-grid">${S.nodes.map((n) => `<button class="team-tile" data-node="${n.id}">${av(n, 34)}<div style="min-width:0"><b>${esc(n.name)}</b><span>${esc(n.tagline)}</span></div></button>`).join('')}</div></div>
      <div style="display:grid;gap:16px;align-content:start">
        <div class="card card-pad"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3>Engines</h3><button class="btn small" data-go="engines">Set up</button></div>
          ${(S.cli || []).filter((c) => c.id !== 'ollama-app').slice(0, 5).map((c) => `<div class="engine-row"><span class="status-dot ${c.installed && c.signedIn ? '' : c.installed ? 'warn' : 'off'}"></span><span class="nm">${esc(c.name)}</span><span class="sub" style="font-size:12px">${c.installed ? (c.signedIn ? 'Signed in' : 'Needs sign-in') : 'Not installed'}</span></div>`).join('')}
          <div class="engine-row"><span class="status-dot ${readyApi.filter((p) => !p.keyless).length ? '' : 'warn'}"></span><span class="nm">API providers</span><span class="sub" style="font-size:12px">${readyApi.length} ready</span></div></div>
        ${lowEngines().length ? `<div class="card card-pad" style="border-color:rgba(240,176,74,.3)"><h3 style="margin-bottom:6px;display:flex;gap:8px;align-items:center">${icon('alert', 15)}Usage running low</h3>${lowEngines().map((u) => `<div class="engine-row"><span class="status-dot ${u.exhausted ? 'err' : 'warn'}"></span><span class="nm">${esc(u.name)}</span><span class="sub" style="font-size:12px">${u.exhausted ? 'Limit reached' : Math.round(u.pct * 100) + '% left'}</span></div>`).join('')}</div>` : ''}
        <div class="card card-pad"><h3 style="margin-bottom:8px">Recent</h3>${recent.length ? recent.map((c) => `<div class="engine-row" style="cursor:default" data-open="${c.id}">${convAvatar(c, 22)}<span class="nm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(convTitle(c))}</span><span class="sub" style="font-size:12px">${timeLabel(c.updatedAt)}</span></div>`).join('') : '<div class="sub">Nothing yet. Say hi to a node.</div>'}</div>
      </div>
    </div>
  </div></div>`;
  $$('[data-node]', main).forEach((b) => b.addEventListener('click', () => openNodeChat(b.dataset.node)));
  $$('[data-go]', main).forEach((b) => b.addEventListener('click', () => setView(b.dataset.go)));
  $$('[data-open]', main).forEach((b) => b.addEventListener('click', () => openConv(b.dataset.open)));
  $('[data-q=team]', main).addEventListener('click', () => openTeam());
  $('[data-q=project]', main).addEventListener('click', () => newProject());
  $('[data-q=compare]', main).addEventListener('click', () => openNewChat('compare'));
}
function openNodeChat(nodeId) {
  const existing = [...S.conversations].filter((c) => c.kind === 'node' && c.nodeIds[0] === nodeId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (existing) return openConv(existing.id);
  const c = newConversation({ kind: 'node', nodeIds: [nodeId] });
  c.messages.push(greetingMsg(nodeId));
  persist(c);
  openConv(c.id);
}
function openTeam() {
  let t = S.conversations.find((c) => c.kind === 'team');
  if (!t) {
    t = newConversation({ kind: 'team', nodeIds: S.nodes.map((n) => n.id), title: 'Team' });
    t.messages.push(teamGreeting());
    persist(t);
  }
  openConv(t.id);
}
function greetingMsg(nodeId) {
  return { id: uid(), role: 'ai', nodeId, content: nodeById(nodeId).greeting?.replace(/\{CALLME\}/g, callMe()) || `Hi ${callMe()}, I'm ${nodeById(nodeId).name}.`, greeting: true, ts: Date.now() };
}
function teamGreeting() {
  return { id: uid(), role: 'ai', nodeId: S.nodes[0]?.id || 'engineer', content: `Hi ${callMe()}, the whole team is in here. Ask anything and the nodes who know it best will answer, or @mention someone, like **@Reviewer** or **@Architect**.`, greeting: true, ts: Date.now() };
}

// ---------------- chat view ----------------
function chatTarget() {
  const c = current();
  return c || homeTarget;
}
function renderChat(main) {
  const conv = current();
  if (!conv) {
    if (S.conversations.length) {
      currentId = [...S.conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
      return renderChat(main);
    }
    return renderHome(main);
  }
  let title;
  if (conv.kind === 'team') title = `<div class="stack">${conv.nodeIds.slice(0, 5).map((id) => av(nodeById(id), 26)).join('')}</div><h1>${esc(convTitle(conv))}</h1><span class="sub">${conv.nodeIds.length} nodes</span>`;
  else if (conv.kind === 'project') title = `<div class="stack">${conv.nodeIds.slice(0, 5).map((id) => av(nodeById(id), 26)).join('')}</div><h1>${esc(conv.title)}</h1><span class="sub">Project · ${conv.nodeIds.length} nodes</span>`;
  else if (conv.kind === 'pair') title = `${pairAvatar(28)}<h1>${esc(convTitle(conv))}</h1><span class="sub">${esc(engineLabel(conv.pair.a))} ⇄ ${esc(engineLabel(conv.pair.b))}</span>`;
  else if (conv.kind === 'compare') title = `${convAvatar(conv, 28)}<h1>Compare</h1><span class="sub">${esc(conv.compare.map(engineLabel).join(' · '))}</span>`;
  else {
    const n = nodeById(conv.nodeIds[0]);
    title = `${av(n, 28)}<h1>${esc(n.name)}</h1><span class="sub">${esc(conv.renamed ? conv.title : n.tagline)}</span>`;
  }
  const folder = conv.folder ? conv.folder.split('/').pop() : null;
  const actions = `
    <button class="chip-btn ${conv.folder ? 'on' : ''}" id="act-folder" title="${esc(conv.folder || 'Choose the project folder coding agents work in')}">${icon('folder', 14)}<span>${esc(folder || 'No folder')}</span></button>
    <button class="icon-btn ${browserOpen ? 'on' : ''}" id="act-browser" title="Browser  ⌘B">${icon('panel', 17)}</button>
    <button class="icon-btn" id="act-more" title="More">${icon('more', 17)}</button>`;

  main.innerHTML = `${topbar(title, actions)}
    <div class="chat-scroll" id="chat-scroll"><div class="thread" id="thread"></div></div>
    <div class="composer-wrap">
      <div class="composer">
        <div class="composer-files hidden" id="composer-files"></div>
        <textarea id="input" rows="1" placeholder="${esc(placeholderFor(conv))}" spellcheck="true"></textarea>
        <div class="composer-row">
          <button class="tool-btn" id="btn-plus" title="Attach">${icon('plus', 17)}</button>
          <button class="tool-btn ${conv.web ? 'on' : ''}" id="btn-web" title="Search the web">${icon('globe', 15)}${conv.web ? 'Web' : ''}</button>
          ${conv.kind === 'compare' || conv.kind === 'pair' || conv.kind === 'project' ? '' : `<button class="model-pick" id="btn-model" title="Choose the AI for this chat">${modelPickLabel(conv)}</button>`}
          <span class="grow"></span>
          <button class="ctx-ring" id="btn-ctx" title="Context usage"></button>
          <button class="send-btn" id="btn-send" title="Send">${icon('send', 16)}</button>
        </div>
      </div>
      <div class="composer-hint">
        <span>${conv.kind === 'project' ? 'Messages steer the project; the team keeps taking turns' : conv.kind === 'team' ? 'Type <b>@</b> to ask a specific node' : conv.kind === 'pair' ? `Pair mode · up to ${conv.pair.rounds} rounds each` : '<kbd>⏎</kbd> to send · <kbd>⇧⏎</kbd> new line · <b>/image</b> to draw'}</span>
        ${conv.folder ? `<button id="btn-edits" class="${conv.allowEdits ? 'on' : ''}" title="Let coding agents (Codex, Claude Code…) change files in this folder">${icon(conv.allowEdits ? 'edit' : 'lock', 12)}${conv.allowEdits ? 'Agents can edit files' : 'Read-only'}</button>` : `<span>${esc(engineChainHint(conv))}</span>`}
      </div>
    </div>`;

  renderThread();
  renderPendingFiles();
  updateCtx();
  const input = $('#input');
  input.addEventListener('input', () => {
    autosize(input);
    updateSendBtn();
    mentionCheck(input);
  });
  input.addEventListener('keydown', (e) => {
    if (mentionKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && S.settings.sendOnEnter) {
      e.preventDefault();
      send();
    }
  });
  $('#btn-send').addEventListener('click', () => (isBusy() ? stopAll() : send()));
  $('#btn-plus').addEventListener('click', (e) => plusMenu(e.currentTarget));
  $('#btn-web').addEventListener('click', () => {
    conv.web = !conv.web;
    persist(conv);
    renderChat(main);
  });
  $('#btn-model')?.addEventListener('click', (e) => openModelMenu(e.currentTarget));
  $('#btn-ctx').addEventListener('click', (e) => ctxPopover(e.currentTarget));
  $('#act-folder').addEventListener('click', chooseFolder);
  $('#act-browser').addEventListener('click', () => (browserOpen ? closeBrowser() : openBrowser()));
  $('#act-more').addEventListener('click', (e) => convMenu(conv, e.currentTarget));
  $('#btn-edits')?.addEventListener('click', () => {
    conv.allowEdits = !conv.allowEdits;
    persist(conv);
    renderChat(main);
    toast(conv.allowEdits ? 'Coding agents can now edit files in this folder' : 'Coding agents are read-only');
  });
  updateSendBtn();
  drawUsageBanner();
  input.focus();
}
function placeholderFor(conv) {
  if (conv.kind === 'team') return 'Message the team';
  if (conv.kind === 'project') return 'Steer the project, or ask for changes';
  if (conv.kind === 'pair') return conv.messages.some((m) => m.role === 'user') ? 'Add direction for the pair' : 'Describe the project for the pair to build';
  if (conv.kind === 'compare') return 'Ask every model at once';
  return `Message ${nodeById(conv.nodeIds[0]).name}`;
}
function engineChainHint(conv) {
  if (conv.kind === 'compare') return 'Each model answers on its own';
  if (conv.pinned) return conv.fallback === false ? `Only ${engineLabel(conv.pinned)}` : `${engineLabel(conv.pinned)} first, then fallback`;
  return S.settings.autoFallback ? 'Auto · switches engines if one fails' : 'Fallback off';
}
function modelPickLabel(conv) {
  const t = conv.pinned;
  let nm;
  if (t) nm = engineLabel(t);
  else {
    const last = [...conv.messages].reverse().find((m) => m.meta);
    nm = last ? `Auto` : 'Auto';
  }
  const p = t && providerById(t.provider);
  const ic = p && p.kind === 'cli' ? 'terminal' : t ? 'cpu' : 'sparkles';
  return `${icon(ic, 14)}<span class="nm">${esc(nm)}</span>${icon('chevron', 12)}`;
}

function autosize(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 280) + 'px';
  t.style.overflowY = t.scrollHeight > 280 ? 'auto' : 'hidden';
}
function isBusy(id = currentId) {
  return id && [...jobs.values()].some((j) => j.convId === id);
}
function updateSendBtn() {
  const b = $('#btn-send');
  if (!b) return;
  if (isBusy()) {
    b.classList.add('stop');
    b.disabled = false;
    b.innerHTML = icon('stop', 14);
    b.title = 'Stop';
  } else {
    b.classList.remove('stop');
    b.innerHTML = icon('send', 16);
    b.title = 'Send';
    b.disabled = !($('#input')?.value.trim() || pendingFiles.length);
  }
}
function renderPendingFiles() {
  const box = $('#composer-files');
  if (!box) return;
  box.classList.toggle('hidden', !pendingFiles.length);
  box.innerHTML = pendingFiles.map((f, i) => `<span class="file-chip">${icon('memory', 13)}${esc(f.name)}<button data-rm="${i}">${icon('x', 12)}</button></span>`).join('');
  $$('[data-rm]', box).forEach((b) =>
    b.addEventListener('click', () => {
      pendingFiles.splice(+b.dataset.rm, 1);
      renderPendingFiles();
      updateSendBtn();
      updateCtx();
    })
  );
}
function plusMenu(anchor) {
  const html = `<div class="menu-scroll">
    <button class="menu-item" data-a="files">${icon('attach', 15)}<div>Attach files<span class="d">Code or text, up to 400 KB each</span></div></button>
    <button class="menu-item" data-a="folder">${icon('folder', 15)}<div>Project folder<span class="d">Where Codex, Claude Code and others work</span></div></button>
    <button class="menu-item" data-a="image">${icon('image', 15)}<div>Generate an image<span class="d">Free, no key needed</span></div></button>
    <button class="menu-item" data-a="memory">${icon('memory', 15)}<div>Edit MEMORY.txt<span class="d">What every node knows about you</span></div></button></div>`;
  openMenu(anchor, html, async (d) => {
    if (d.a === 'files') {
      for (const f of await api.pickFiles()) f.error ? toast(`${f.name}: ${f.error}`) : pendingFiles.push(f);
      renderPendingFiles();
      updateSendBtn();
      updateCtx();
    } else if (d.a === 'folder') chooseFolder();
    else if (d.a === 'image') {
      const i = $('#input');
      if (!i.value.startsWith('/image ')) i.value = '/image ' + i.value;
      i.focus();
      updateSendBtn();
    } else if (d.a === 'memory') {
      settingsTab = 'memory';
      setView('settings');
    }
  });
}
async function chooseFolder() {
  const conv = current();
  if (!conv) return;
  const f = await api.pickFolder();
  if (!f) return;
  conv.folder = f;
  persist(conv);
  if (view === 'chat') renderChat($('#main'));
  toast(`Coding agents will work in ${f.split('/').pop()}`);
}

// ----- thread -----
function renderThread() {
  const thread = $('#thread');
  if (!thread) return;
  const conv = current();
  if (!conv) return;
  const real = conv.messages.filter((m) => !m.greeting);
  if (!real.length && (conv.kind === 'pair' || conv.kind === 'compare')) {
    const isPair = conv.kind === 'pair';
    const sugg = isPair
      ? ['Build a CLI todo app in Node with tests', 'Write a SwiftUI settings screen with persistence', 'Create a REST API for notes with SQLite', 'Refactor this folder for readability and add docs']
      : ['Write a debounce function in TypeScript', 'Explain the CAP theorem in 5 lines', 'Find the bug: for (var i=0;i<3;i++) setTimeout(()=>console.log(i))', 'Design a schema for a chat app'];
    thread.innerHTML = `<div class="empty">${isPair ? pairAvatar(72) : convAvatar(conv, 72)}<h2>${isPair ? 'Pair mode' : 'Compare models'}</h2><p>${isPair ? `${esc(engineLabel(conv.pair.a))} and ${esc(engineLabel(conv.pair.b))} take turns, each sending the other its progress, until the work is done.` : esc(conv.compare.map(engineLabel).join(' vs '))}</p>
      <div class="suggestions">${sugg.map((s) => `<button class="suggestion">${esc(s)}</button>`).join('')}</div></div>`;
    $$('.suggestion', thread).forEach((b) => b.addEventListener('click', () => (($('#input').value = b.textContent), send())));
    return;
  }
  let html = '';
  const msgs = conv.messages;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.groupId) {
      const group = [];
      while (i < msgs.length && msgs[i].groupId === m.groupId) group.push(msgs[i++]);
      i--;
      html += `<div style="display:grid;grid-template-columns:repeat(${Math.min(group.length, 3)},minmax(0,1fr));gap:12px;margin:0 0 26px">${group.map((g) => `<div class="card" style="padding:14px;min-width:0" data-mid="${g.id}">${aiInner(g, conv, true)}</div>`).join('')}</div>`;
    } else html += messageHtml(m, conv, i === msgs.length - 1);
  }
  if (!real.length && conv.kind !== 'pair' && conv.kind !== 'project') {
    const n = nodeById(conv.nodeIds[0]);
    const sugg = (SUGGEST[n.id] || SUGGEST.engineer).slice(0, 4);
    html += `<div class="suggestions" style="margin:4px 0 0 42px">${sugg.map((s) => `<button class="suggestion">${esc(s)}</button>`).join('')}</div>`;
  }
  if (conv.kind === 'project') html = `<div style="margin-bottom:24px">${projectCard(conv)}</div>` + html;
  thread.innerHTML = html;
  if (conv.kind === 'project') bindProjectCard(thread);
  $$('.suggestion', thread).forEach((b) => b.addEventListener('click', () => (($('#input').value = b.textContent), send())));
  bindMessageActions(thread, conv);
  scrollToBottom();
}
const SUGGEST = {
  engineer: ['Build a REST endpoint with input validation', 'Why is my React component re-rendering?', 'Write a Swift async image loader with caching', 'Turn this bash script into a Node CLI'],
  architect: ['How should I structure a SwiftUI app with sync?', 'Monolith or services for a 3-person team?', 'Design the data model for a habit tracker', 'Plan offline-first sync with conflict handling'],
  debugger: ['TypeError: Cannot read properties of undefined', 'My app crashes only in Release builds', 'Why does this promise never resolve?', 'Memory keeps growing in my Node server'],
  reviewer: ['Review this function for bugs', 'Is this auth middleware safe?', 'What would break in this migration?', 'Check this SQL for injection'],
  frontend: ['Build a polished pricing card in React', 'Make this SwiftUI list feel native', 'Dark mode tokens for a design system', 'Animate a sidebar collapse smoothly'],
  backend: ['Design a rate limiter in Redis', 'Postgres indexes for a feed query', 'JWT vs sessions for a mobile app', 'Write a job queue with retries'],
  devops: ['GitHub Actions to build and sign a Mac app', 'Dockerfile for a Node app, small and secure', 'Deploy a static site with HTTPS', 'Set up preview deployments per PR'],
  tester: ['Write Jest tests for a debounce function', 'XCTest for a view model with async calls', 'Edge cases for a date parser', 'Playwright test for a login flow'],
  security: ['Audit this Express app for common holes', 'How should I store API keys in a Mac app?', 'Threat model a file upload feature', 'Is my CORS setup safe?'],
  researcher: ['Compare Tauri vs Electron in 2026', 'Best SQLite library for Swift right now', 'Latest Node.js LTS changes', 'Which vector DB for a small app?'],
  docs: ['Write a README for my CLI tool', 'Generate a CHANGELOG from these commits', 'Document this API endpoint', 'Write release notes for version 1.1'],
};

function messageHtml(m, conv, isLast) {
  if (m.role === 'banner') return `<div class="pair-banner">${esc(m.content)}</div>`;
  if (m.role === 'user') {
    const files = m.files && m.files.length ? `<div class="files">${m.files.map((f) => `<span class="file-chip">${icon('memory', 12)}${esc(f.name)}</span>`).join('')}</div>` : '';
    const body = esc(m.content).replace(/@([A-Za-z][\w-]*)/g, (x, n) => (S.nodes.some((nd) => nd.name.toLowerCase() === n.toLowerCase()) ? `<span class="mention">${x}</span>` : x));
    return `<div class="msg user" data-mid="${m.id}"><div class="user-col">${files}${m.content ? `<div class="bubble">${body}</div>` : ''}
      <div class="meta"><button class="icon-btn" data-act="edit" data-mid="${m.id}" title="Edit and resend">${icon('edit', 13)}</button><button class="icon-btn" data-act="copy" data-mid="${m.id}" title="Copy">${icon('copy', 13)}</button><button class="icon-btn" data-act="remember" data-mid="${m.id}" title="Add to MEMORY.txt">${icon('bookmark', 13)}</button></div></div></div>`;
  }
  return `<div class="msg ai ${isLast ? 'last' : ''} ${m.greeting ? 'greeting' : ''}" data-mid="${m.id}">${aiInner(m, conv, false)}</div>`;
}

function aiInner(m, conv, compact) {
  const n = nodeById(m.nodeId);
  const job = [...jobs.values()].find((j) => j.msg === m);
  const name = conv.kind === 'compare' ? engineLabel(m.target) : conv.kind === 'pair' ? m.label || engineLabel(conv.pair[m.side]) : n.name;
  const portrait = conv.kind === 'pair' ? pairSideAvatar(m.side, 30) : conv.kind === 'compare' ? '' : av(n, 30);
  const eng = m.meta ? `${m.meta.providerName}${m.meta.model && m.meta.model !== 'default' ? ' · ' + shortModel(m.meta.model) : ''}` : job && job.engine ? job.engine : '';
  const head = `<div class="msg-head"><b>${esc(name)}</b>${eng ? `<span class="eng">${esc(eng)}</span>` : ''}<span class="t">${m.greeting ? '' : timeLabel(m.ts)}</span></div>`;

  let route = '';
  if (m.routing && m.routing.length && S.settings.showRouting) route = `<div class="route">${m.routing.map((r) => `<div class="route-note">${icon('route', 13)}<span><b>${esc(r.providerName)}</b>${r.model && r.model !== 'default' ? ' · ' + esc(shortModel(r.model)) : ''} didn't answer (${esc(r.reason)}), so the next engine took over</span></div>`).join('')}</div>`;
  let tools = '';
  if (m.tools && m.tools.length) {
    const shown = m.tools.slice(-6);
    tools = `<div class="tools">${m.tools.length > 6 ? `<div class="tool"><span class="bullet">⏺</span><span class="tx">… ${m.tools.length - 6} earlier steps</span></div>` : ''}${shown
      .map((t, i) => {
        const mm = t.match(/^(\w+)\((.*)\)$/);
        return `<div class="tool ${job && i === shown.length - 1 && !m.content ? 'live' : ''}"><span class="bullet">⏺</span><span class="tx">${mm ? `<b>${esc(mm[1])}</b>(${esc(mm[2])})` : esc(t)}</span></div>`;
      })
      .join('')}</div>`;
  }
  let sources = '';
  if (m.sources && m.sources.length) sources = `<div class="sources">${m.sources.map((s, i) => `<button class="source" data-src-url="${esc(s.url)}" title="${esc(s.title)}"><img src="https://www.google.com/s2/favicons?sz=32&domain=${esc(hostOf(s.url))}" onerror="this.style.visibility='hidden'"><span>${i + 1}. ${esc(hostOf(s.url))}</span></button>`).join('')}</div>`;
  let thinking = '';
  if (m.reasoningStart && !m.thoughtMs && job) thinking = `<div class="thinking shimmer" data-think>${icon('brain', 13)}Thinking ${Math.round((Date.now() - m.reasoningStart) / 1000)}s</div>`;
  else if (m.thoughtMs) thinking = `<div class="thinking">${icon('brain', 13)}Thought for ${Math.max(1, Math.round(m.thoughtMs / 1000))}s</div>`;

  let body = '';
  if (m.image) body = `<img class="gen-image" src="${esc(m.image.url)}" alt="${esc(m.image.prompt)}" data-img="${m.id}">`;
  else if (m.error) {
    const list = (m.error.attempts || []).map((x) => `<li><b>${esc(providerById(x.provider)?.name || x.provider)}</b>${x.model && x.model !== 'default' ? ' · ' + esc(shortModel(x.model)) : ''}: ${esc(x.reason)}</li>`).join('');
    body = `<div class="error-card"><h4>${icon('alert', 15)}${m.error.noProviders ? 'No engines are ready' : 'No engine could answer'}</h4>
      ${m.error.noProviders ? '<div>Sign in to a coding agent or add a free API key.</div>' : `<div>Nodes tried ${m.error.attempts.length} engine${m.error.attempts.length === 1 ? '' : 's'}:</div><ul>${list}</ul>`}
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn small" data-act="retry" data-mid="${m.id}">${icon('refresh', 13)}Try again</button><button class="btn small primary" data-goto="engines">${icon('plug', 13)}Set up engines</button></div></div>`;
  } else if (m.content) body = `<div class="md">${renderMarkdown(m.content.replace(/\n?\[DONE\]\s*$/, ''), { highlight: !job, sources: m.sources })}${job ? '<span class="caret"></span>' : ''}</div>`;
  else if (job) body = `<div class="status-line"><span class="shimmer">${esc(job.status || 'Thinking…')}</span></div>`;
  else if (m.stopped) body = `<div class="status-line">Stopped.</div>`;

  let meta = '';
  if (!job && !m.error && !m.greeting) {
    meta = `<div class="meta">${m.meta ? `<span class="via">${(m.meta.ms / 1000).toFixed(1)}s</span>` : m.image ? '<span class="via">Pollinations · free</span>' : ''}
      ${m.image ? `<button class="icon-btn" data-act="openimg" data-mid="${m.id}" title="Open full size">${icon('external', 13)}</button>` : `<button class="icon-btn" data-act="copy" data-mid="${m.id}" title="Copy">${icon('copy', 13)}</button>`}
      ${conv.kind === 'compare' || conv.kind === 'pair' ? '' : `<button class="icon-btn" data-act="retry" data-mid="${m.id}" title="Regenerate">${icon('refresh', 13)}</button>`}
      ${m.content ? `<button class="icon-btn" data-act="remember" data-mid="${m.id}" title="Add to MEMORY.txt">${icon('bookmark', 13)}</button>` : ''}</div>`;
  }
  if (compact) return `${head}${route}${tools}${thinking}${body}${meta}`;
  return `<div class="gutter">${portrait}</div><div style="min-width:0">${head}${route}${tools}${sources}${thinking}${body}${meta}</div>`;
}
function pairSideAvatar(side, size) {
  const spec = side === 'b' ? { bg: ['#4ade80', '#15803d'], head: 'round', eyes: 'glasses', mouth: 'smile', top: 'twin' } : { bg: ['#38bdf8', '#1d4ed8'], head: 'square', eyes: 'visor', mouth: 'grid', top: 'antenna' };
  return nodeAvatar(spec, size);
}
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

function bindMessageActions(root, conv) {
  $$('[data-act]', root).forEach((b) =>
    b.addEventListener('click', async () => {
      const m = conv.messages.find((x) => x.id === b.dataset.mid);
      if (!m) return;
      const act = b.dataset.act;
      if (act === 'copy') {
        navigator.clipboard.writeText(m.content);
        toast('Copied');
      } else if (act === 'retry') regenerate(conv, m);
      else if (act === 'edit') editMessage(conv, m);
      else if (act === 'openimg') openBrowser(m.image.url);
      else if (act === 'remember') {
        const text = await promptModal('Add to MEMORY.txt', 'Every node will know this', m.content.slice(0, 300));
        if (text && text.trim()) {
          await api.appendMemory(text.trim());
          memoryText = (await api.getMemory()).text;
          toast('Added to MEMORY.txt');
        }
      }
    })
  );
  $$('[data-goto]', root).forEach((b) => b.addEventListener('click', () => setView(b.dataset.goto)));
  $$('img[data-img]', root).forEach((img) => img.addEventListener('error', () => img.replaceWith(Object.assign(document.createElement('div'), { className: 'status-line', textContent: 'The image service did not return an image. Try again in a moment.' }))));
}

function updateMessageEl(conv, m) {
  if (conv.id !== currentId || view !== 'chat') return;
  const el = document.querySelector(`[data-mid="${m.id}"]`);
  if (!el) return renderThread();
  const near = isNearBottom();
  el.innerHTML = m.groupId ? aiInner(m, conv, true) : aiInner(m, conv, false);
  bindMessageActions(el, conv);
  if (near) scrollToBottom();
}
function isNearBottom() {
  const sc = $('#chat-scroll');
  return !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
}
function scrollToBottom() {
  const sc = $('#chat-scroll');
  if (sc) sc.scrollTop = sc.scrollHeight;
}

// ----- context meter -----
function ctxWindowFor(t) {
  if (!t) return 131072;
  const m = String(t.model || '').toLowerCase();
  const p = t.provider;
  if (p === 'codex') return 272000;
  if (p === 'claude-code' || m.includes('claude') || ['sonnet', 'opus', 'haiku'].includes(m)) return 200000;
  if (p === 'gemini-cli' || m.includes('gemini')) return 1048576;
  if (m.includes('gpt-4.1')) return 1047576;
  if (m.includes('gpt-5')) return 400000;
  if (m.includes('qwen3-coder') || m.includes('qwen-3-235b')) return 262144;
  if (m.includes('command-a') || m.includes('grok-4')) return 256000;
  if (m.includes('llama3.1-8b') || m.includes('qwen-3-32b')) return 65536;
  if (p === 'pollinations' || p === 'ollama' || p === 'lmstudio') return 32768;
  return 131072;
}
function contextInfo() {
  const conv = current();
  if (!conv) return null;
  const n = nodeById(conv.nodeIds[0]);
  const lastMeta = [...conv.messages].reverse().find((m) => m.meta);
  const target = conv.pinned || (lastMeta && { provider: lastMeta.meta.provider, model: lastMeta.meta.model }) || null;
  const win = ctxWindowFor(target);
  const tk = (s) => Math.ceil((s || 0) / 3.7);
  const system = tk((n.system || '').length + 500);
  const memory = tk(memoryText.split('\n').filter((l) => !l.startsWith('#') || l.startsWith('##')).join('\n').length);
  let chat = 0;
  let files = 0;
  let web = 0;
  for (const m of conv.messages.slice(-40)) {
    chat += tk(m.content);
    for (const f of m.files || []) files += tk(f.text);
  }
  for (const f of pendingFiles) files += tk(f.text);
  chat += tk($('#input')?.value);
  const lastSrc = [...conv.messages].reverse().find((m) => m.sources && m.sources.length);
  if (conv.web && lastSrc) web = tk(lastSrc.sources.reduce((s, x) => s + (x.snippet || '').length + 200, 0) + (S.settings.readPages ? 7500 : 0));
  const used = system + memory + chat + files + web;
  return { win, used, parts: [['Instructions', system, '#7cb2ff'], ['MEMORY.txt', memory, '#22d3ee'], ['Conversation', chat, '#34d399'], ['Files', files, '#f0b04a'], ['Web results', web, '#f472b6']], target };
}
function updateCtx() {
  const b = $('#btn-ctx');
  if (!b) return;
  const info = contextInfo();
  if (!info) return;
  const pct = Math.min(1, info.used / info.win);
  const C = 2 * Math.PI * 8;
  const col = pct > 0.85 ? 'var(--err)' : pct > 0.6 ? 'var(--warn)' : 'var(--muted)';
  b.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="2.4"/><circle cx="10" cy="10" r="8" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${Math.max(0.5, pct * C)} ${C}" transform="rotate(-90 10 10)"/></svg>`;
  b.title = `Context: ${fmtK(info.used)} of ${fmtK(info.win)} tokens (${Math.round(pct * 100)}%)`;
}
function ctxPopover(anchor) {
  const info = contextInfo();
  if (!info) return;
  const pct = Math.round((info.used / info.win) * 100);
  const html = `<div class="ctx-pop"><h4>Context window</h4><div class="sub" style="color:var(--muted);font-size:12px">${esc(info.target ? engineLabel(info.target) : 'Auto (estimated for a 128k model)')}</div>
    <div class="big">${fmtK(info.used)} <span style="color:var(--muted);font-size:14px;font-weight:500">/ ${fmtK(info.win)} tokens · ${pct}%</span></div>
    <div class="ctx-bar">${info.parts.map(([, v, c]) => `<i style="width:${(v / info.win) * 100}%;background:${c}"></i>`).join('')}</div>
    <div class="ctx-legend">${info.parts.map(([k, v, c]) => `<div><span class="sw" style="background:${c}"></span>${k}<span class="v">${fmtK(v)}</span></div>`).join('')}<div><span class="sw" style="background:rgba(255,255,255,.12)"></span>Free<span class="v">${fmtK(Math.max(0, info.win - info.used))}</span></div></div>
    <div style="color:var(--faint);font-size:11.5px;margin-top:10px">Estimated. Only the last 40 messages are sent each turn.</div></div>`;
  openMenu(anchor, html, () => {});
}

// ----- sending -----
function newConversation(o) {
  const conv = { id: uid(), kind: 'node', title: '', nodeIds: ['engineer'], pinned: null, fallback: true, web: false, folder: S.settings.defaultFolder || '', allowEdits: false, messages: [], createdAt: Date.now(), updatedAt: Date.now(), ...o };
  if (conv.kind === 'node' && conv.web === false) conv.web = !!nodeById(conv.nodeIds[0]).web;
  S.conversations.unshift(conv);
  return conv;
}
const slim = (conv) => ({ ...conv, messages: conv.messages.map(({ reasoningStart, ...m }) => m) });
function persist(conv) {
  api.saveConversation(slim(conv));
  api.phonePush('conv', slim(conv));
}

async function send(textOverride, convOverride) {
  const conv = convOverride || current();
  if (!conv) return;
  const input = convOverride ? null : $('#input');
  let text = (textOverride ?? input?.value ?? '').trim();
  const files = convOverride ? [] : pendingFiles;
  if ((!text && !files.length) || isBusy(conv.id)) return;
  if (input) {
    input.value = '';
    autosize(input);
  }
  if (/^\/clear\b/.test(text)) {
    conv.messages = conv.messages.filter((m) => m.greeting);
    persist(conv);
    return render();
  }
  if (!convOverride) pendingFiles = [];
  conv.messages.push({ id: uid(), role: 'user', content: text, files: files.map((f) => ({ name: f.name, text: f.text })), ts: Date.now() });
  if (!conv.title && !conv.renamed) conv.title = (text || files[0]?.name || 'New chat').replace(/^\/image\s+/, '').slice(0, 60);
  conv.updatedAt = Date.now();
  persist(conv);
  if (conv.id === currentId && view === 'chat') {
    renderThread();
    renderPendingFiles();
    updateCtx();
  }
  renderSidebar();
  if (/^\/image\s+/.test(text)) return generateImage(conv, text.replace(/^\/image\s+/, ''));
  await respond(conv);
}

function generateImage(conv, prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1e9)}`;
  conv.messages.push({ id: uid(), role: 'ai', nodeId: conv.nodeIds[0], content: '', image: { url, prompt }, ts: Date.now() });
  conv.updatedAt = Date.now();
  persist(conv);
  if (conv.id === currentId) renderThread();
  renderSidebar();
}

function pickTeamResponders(conv, text) {
  const nodes = conv.nodeIds.map(nodeById);
  const mentioned = nodes.filter((n) => new RegExp(`@${n.name.replace(/[^\w]/g, '')}\\b`, 'i').test(text) || new RegExp(`@${n.id}\\b`, 'i').test(text));
  if (/@(team|all|everyone)\b/i.test(text)) return nodes.map((n) => n.id);
  if (mentioned.length) return mentioned.map((n) => n.id);
  const low = text.toLowerCase();
  const scored = nodes.map((n) => ({ id: n.id, s: (n.keywords || []).reduce((s, k) => s + (low.includes(k) ? (k.length > 5 ? 2 : 1) : 0), 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scored.length) return [nodes.find((n) => n.id === 'engineer')?.id || nodes[0].id];
  return scored.slice(0, scored.length > 1 && scored[1].s >= scored[0].s - 1 ? 2 : 1).map((x) => x.id);
}

async function respond(conv) {
  if (conv.kind === 'compare') {
    const groupId = uid();
    await Promise.all(conv.compare.map((t) => runReply(conv, conv.nodeIds[0], { pinned: t, noFallback: true, groupId })));
  } else if (conv.kind === 'pair' || conv.kind === 'project') {
    await runRelay(conv);
  } else if (conv.kind === 'team') {
    const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
    const ids = pickTeamResponders(conv, lastUser ? lastUser.content : '');
    for (const id of ids) if ((await runReply(conv, id, { roomNote: roomNote(conv, id, ids) })) === 'stopped') break;
  } else await runReply(conv, conv.nodeIds[0]);
}
function roomNote(conv, id, responders) {
  const others = conv.nodeIds.filter((x) => x !== id).map((x) => `${nodeById(x).name} (${nodeById(x).tagline})`).join(', ');
  return `You are ${nodeById(id).name} in the team chat with ${callMe()} and the other nodes: ${others}. Messages from other nodes are prefixed with their name in brackets. Reply only as yourself, with no name prefix. ${responders.length > 1 ? `${responders.map((r) => nodeById(r).name).join(' and ')} are both answering this one, so focus on your specialty and don't repeat what's already been said.` : ''} If another node would be better for part of it, say so in one line (e.g. "@Security should check the token handling").`;
}

async function runPair(conv) {
  const { a, b, rounds } = conv.pair;
  conv.messages.push({ id: uid(), role: 'banner', content: `Pair session started · ${engineLabel(a)} builds, ${engineLabel(b)} reviews and continues`, ts: Date.now() });
  let doneVotes = 0;
  let turns = 0;
  outer: for (let r = 0; r < rounds; r++) {
    for (const side of ['a', 'b']) {
      const me = conv.pair[side];
      const other = conv.pair[side === 'a' ? 'b' : 'a'];
      const note =
        `You are pairing with ${engineLabel(other)} (another AI) to finish ${callMe()}'s task. You both see the whole log. ` +
        (side === 'a'
          ? `You lead the build. Do the next concrete chunk of real work (write the code, make the changes), then end with a short "Progress" section: what you did, what's left, and anything you want your partner to check.`
          : `You are the partner. Check your partner's latest progress critically, fix anything wrong, do the next part of the work yourself, then end with a short "Progress" section for your partner.`) +
        ` Keep each turn focused. When the whole task is complete and you have checked it, put [DONE] alone on the last line. Don't say [DONE] if anything is left.`;
      const res = await runReply(conv, conv.nodeIds[0], { pinned: me, side, label: engineLabel(me), roomNote: note, noFallback: conv.pairStrict });
      turns++;
      if (res === 'stopped') {
        conv.messages.push({ id: uid(), role: 'banner', content: 'Pair session stopped', ts: Date.now() });
        break outer;
      }
      const last = conv.messages[conv.messages.length - 1];
      if (res !== 'ok') break outer;
      if (/\[DONE\]\s*$/.test(last.content || '')) {
        doneVotes++;
        if (doneVotes >= 2 || side === 'b') {
          conv.messages.push({ id: uid(), role: 'banner', content: `Done · ${turns} turns`, ts: Date.now() });
          break outer;
        }
      } else doneVotes = 0;
      if (r === rounds - 1 && side === 'b') conv.messages.push({ id: uid(), role: 'banner', content: `Reached the ${rounds}-round limit · send a message to keep going`, ts: Date.now() });
    }
  }
  persist(conv);
  if (conv.id === currentId) renderThread();
}

function historyFor(conv, speaker, upTo) {
  const out = [];
  const multi = conv.kind === 'team' || conv.kind === 'pair' || conv.kind === 'project';
  const seenGroups = new Set();
  const relay = conv.kind === 'pair' || conv.kind === 'project';
  const keyOf = (m) => (relay ? m.side || m.nodeId : m.nodeId);
  const nameOf = (m) => (conv.kind === 'pair' ? m.label || engineLabel(conv.pair[m.side]) : m.label || nodeById(m.nodeId).name);
  for (const m of conv.messages) {
    if (m === upTo) break;
    if (m.role === 'banner' || m.greeting) continue;
    if (m.role === 'user') {
      let content = m.content || '';
      for (const f of m.files || []) content += `\n\n[Attached file: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``;
      out.push({ role: 'user', content: content || '(attached files)' });
    } else {
      if (m.image) {
        out.push({ role: 'assistant', content: `[Generated an image of: ${m.image.prompt}]` });
        continue;
      }
      if (!m.content || m.error) continue;
      if (m.groupId) {
        if (seenGroups.has(m.groupId)) continue;
        seenGroups.add(m.groupId);
      }
      if (multi && keyOf(m) !== speaker) out.push({ role: 'user', content: `[${nameOf(m)}]: ${m.content}` });
      else out.push({ role: 'assistant', content: m.content });
    }
  }
  return out.slice(-40);
}

function runReply(conv, nodeId, opts = {}) {
  return new Promise(async (resolve) => {
    const msg = { id: uid(), role: 'ai', nodeId, content: '', routing: [], tools: [], ts: Date.now(), groupId: opts.groupId, target: opts.pinned, side: opts.side, label: opts.label };
    conv.messages.push(msg);
    const reqId = uid();
    const job = { reqId, convId: conv.id, msg, status: 'Thinking…' };
    jobs.set(reqId, job);
    if (conv.id === currentId && view === 'chat') {
      renderThread();
      updateSendBtn();
    }
    renderSidebar();
    const timer = setInterval(() => {
      if (msg.reasoningStart && !msg.thoughtMs) {
        const el = document.querySelector(`[data-mid="${msg.id}"] [data-think]`);
        if (el) el.innerHTML = `${icon('brain', 13)}Thinking ${Math.round((Date.now() - msg.reasoningStart) / 1000)}s`;
      }
    }, 1000);
    const pinned = opts.pinned || conv.pinned;
    let res;
    try {
      res = await api.startChat({
        reqId, nodeId, messages: historyFor(conv, conv.kind === 'pair' || conv.kind === 'project' ? opts.side : nodeId, msg), pinned, web: !!conv.web,
        noFallback: opts.noFallback ?? (!!conv.pinned && conv.fallback === false), roomNote: opts.roomNote || '', folder: conv.folder || '', allowEdits: !!conv.allowEdits,
      });
    } catch (e) {
      res = { ok: false, attempts: [{ provider: 'nodes', model: '', reason: String(e.message || e) }] };
    }
    clearInterval(timer);
    jobs.delete(reqId);
    if (res.sources && res.sources.length) msg.sources = res.sources;
    if (res.ok) msg.meta = { provider: res.provider, providerName: res.providerName, model: res.model, ms: res.ms };
    else if (res.stopped) msg.stopped = true;
    else {
      msg.content = '';
      msg.error = { attempts: res.attempts || [], noProviders: !!res.noProviders };
    }
    if (msg.reasoningStart && !msg.thoughtMs) msg.thoughtMs = Date.now() - msg.reasoningStart;
    delete msg.reasoningStart;
    conv.updatedAt = Date.now();
    if (conv.id !== currentId || view !== 'chat') conv.unread = true;
    persist(conv);
    if (conv.id === currentId && view === 'chat') {
      updateMessageEl(conv, msg);
      updateSendBtn();
      updateCtx();
      $$('.msg.last').forEach((e) => e.classList.remove('last'));
      document.querySelector(`[data-mid="${msg.id}"]`)?.classList.add('last');
    }
    renderSidebar();
    const st = await api.getState();
    S.providers = st.providers;
    resolve(res.stopped ? 'stopped' : res.ok ? 'ok' : 'failed');
  });
}

const raf = new Set();
let pushTimer = null;
function onChatEvent(ev) {
  const job = jobs.get(ev.reqId);
  if (!job) return;
  const m = job.msg;
  const conv = convById(job.convId);
  if (!conv) return;
  switch (ev.type) {
    case 'attempt': {
      const p = providerById(ev.provider);
      job.engine = `${ev.providerName}${ev.model && ev.model !== 'default' ? ' · ' + shortModel(ev.model) : ''}`;
      job.status = p && p.kind === 'cli' ? `${ev.providerName} is working…` : 'Thinking…';
      break;
    }
    case 'switch':
      m.routing.push({ providerName: ev.providerName, model: ev.model, reason: ev.reason });
      m.content = '';
      m.reasoningStart = null;
      m.thoughtMs = null;
      break;
    case 'tool':
      m.tools.push(ev.text);
      break;
    case 'usage':
      handleUsage(ev);
      return;
    case 'sources':
      m.sources = ev.sources;
      break;
    case 'reasoning':
      if (!m.reasoningStart) m.reasoningStart = Date.now();
      else return;
      break;
    case 'delta':
      if (m.reasoningStart && !m.thoughtMs) m.thoughtMs = Date.now() - m.reasoningStart;
      m.content += ev.text;
      break;
    default:
      return;
  }
  if (!raf.has(m.id)) {
    raf.add(m.id);
    requestAnimationFrame(() => {
      raf.delete(m.id);
      updateMessageEl(conv, m);
    });
  }
  if (!pushTimer)
    pushTimer = setTimeout(() => {
      pushTimer = null;
      api.phonePush('conv', slim(conv));
    }, 350);
}

function stopAll(id = currentId) {
  for (const j of jobs.values()) if (j.convId === id) api.stopChat(j.reqId);
}
async function regenerate(conv, m) {
  if (isBusy(conv.id)) return;
  let start = conv.messages.indexOf(m);
  while (start > 0 && conv.messages[start - 1].role === 'ai' && !conv.messages[start - 1].greeting) start--;
  const lastUser = conv.messages[start - 1];
  conv.messages.splice(start);
  persist(conv);
  renderThread();
  if (lastUser && /^\/image\s+/.test(lastUser.content)) return generateImage(conv, lastUser.content.replace(/^\/image\s+/, ''));
  await respond(conv);
}
function editMessage(conv, m) {
  if (isBusy(conv.id)) return;
  conv.messages.splice(conv.messages.indexOf(m));
  pendingFiles = (m.files || []).filter((f) => f.text);
  persist(conv);
  render();
  const input = $('#input');
  input.value = m.content;
  autosize(input);
  updateSendBtn();
  input.focus();
}
async function exportChat() {
  const conv = current();
  if (!conv) return;
  let md = `# ${convTitle(conv)}\n\n`;
  for (const m of conv.messages) {
    if (m.role === 'user') md += `**${S.settings.userName || 'You'}:**\n\n${m.content}\n\n`;
    else if (m.role === 'banner') md += `---\n_${m.content}_\n\n`;
    else if (m.image) md += `**${nodeById(m.nodeId).name}:**\n\n![${m.image.prompt}](${m.image.url})\n\n`;
    else if (m.content) md += `**${conv.kind === 'pair' ? m.label : conv.kind === 'compare' ? engineLabel(m.target) : nodeById(m.nodeId).name}**${m.meta ? ` _(${m.meta.providerName} · ${m.meta.model})_` : ''}:\n\n${m.content}\n\n`;
  }
  if (await api.exportChat(convTitle(conv), md)) toast('Exported');
}

// ----- @mentions -----
let mention = null;
function mentionCheck(input) {
  const conv = current();
  if (!conv || conv.kind !== 'team') return;
  const before = input.value.slice(0, input.selectionStart);
  const m = before.match(/@(\w*)$/);
  if (!m) {
    if (mention) closeLayer();
    mention = null;
    return;
  }
  const q = m[1].toLowerCase();
  const items = [{ id: 'team', name: 'team', tagline: 'Everyone answers' }, ...S.nodes].filter((n) => n.name.toLowerCase().startsWith(q) || n.id.startsWith(q)).slice(0, 7);
  if (!items.length) return closeLayer();
  mention = { items, hi: 0, start: before.length - m[0].length };
  drawMention(input);
}
function drawMention(input) {
  const html = `<div class="menu-scroll">${mention.items.map((n, i) => `<button class="menu-item ${i === mention.hi ? 'hi' : ''}" data-i="${i}">${n.id === 'team' ? icon('users', 18) : av(n, 22)}<div>${esc(n.name)}<span class="d">${esc(n.tagline)}</span></div></button>`).join('')}</div>`;
  openMenu($('.composer'), html, (d) => insertMention(input, +d.i), { left: true, keepFocus: true });
}
function insertMention(input, i) {
  const n = mention.items[i];
  const v = input.value;
  const end = input.selectionStart;
  input.value = v.slice(0, mention.start) + '@' + n.name.replace(/[^\w]/g, '') + ' ' + v.slice(end);
  mention = null;
  closeLayer();
  input.focus();
  updateSendBtn();
}
function mentionKey(e) {
  if (!mention) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    mention.hi = (mention.hi + (e.key === 'ArrowDown' ? 1 : -1) + mention.items.length) % mention.items.length;
    drawMention(e.target);
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    insertMention(e.target, mention.hi);
    return true;
  }
  if (e.key === 'Escape') {
    mention = null;
    closeLayer();
    return true;
  }
  return false;
}

// ---------------- menus & modals ----------------
function closeLayer() {
  $('#layer').innerHTML = '';
}
function openMenu(anchor, html, onPick, o = {}) {
  closeLayer();
  const layer = $('#layer');
  layer.innerHTML = `${o.keepFocus ? '' : '<div class="scrim clear"></div>'}<div class="menu">${html}</div>`;
  const menu = $('.menu', layer);
  const r = anchor.getBoundingClientRect();
  if (o.left) menu.style.left = r.left + 'px';
  else if (r.left < window.innerWidth / 2) menu.style.left = Math.max(8, r.left) + 'px';
  else menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  if (o.below || r.top < window.innerHeight / 2) menu.style.top = r.bottom + 6 + 'px';
  else menu.style.bottom = window.innerHeight - r.top + 6 + 'px';
  $('.scrim', layer)?.addEventListener('click', closeLayer);
  menu.addEventListener('mousedown', (e) => o.keepFocus && e.preventDefault());
  $$('.menu-item[data-i], .menu-item[data-a], .menu-item[data-p]', menu).forEach((b) =>
    b.addEventListener('click', () => {
      if (b.classList.contains('dim') && b.dataset.setup) {
        closeLayer();
        enginesTab = b.dataset.setup;
        return setView('engines');
      }
      closeLayer();
      onPick(b.dataset);
    })
  );
  return menu;
}
function modal(title, sub, bodyHtml, footHtml, cls = '') {
  closeLayer();
  $('#layer').innerHTML = `<div class="scrim"><div class="modal ${cls}"><div class="modal-head"><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div><button class="icon-btn" data-close>${icon('x', 16)}</button></div><div class="modal-body">${bodyHtml}</div>${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}</div></div>`;
  const scrim = $('#layer .scrim');
  scrim.addEventListener('mousedown', (e) => e.target === scrim && closeLayer());
  $('[data-close]', scrim).addEventListener('click', closeLayer);
  return $('.modal', scrim);
}
function promptModal(title, label, value = '') {
  return new Promise((resolve) => {
    const m = modal(esc(title), '', `<div class="field"><label>${esc(label)}</label><textarea class="textarea" id="pm-v" rows="3" style="min-height:70px">${esc(value)}</textarea></div>`, `<span></span><div class="right"><button class="btn" data-c>Cancel</button><button class="btn primary" data-ok>Save</button></div>`);
    const t = $('#pm-v', m);
    t.focus();
    t.select();
    $('[data-c]', m).addEventListener('click', () => (closeLayer(), resolve(null)));
    $('[data-close]', m).addEventListener('click', () => resolve(null));
    $('[data-ok]', m).addEventListener('click', () => (closeLayer(), resolve(t.value)));
    t.addEventListener('keydown', (e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), closeLayer(), resolve(t.value)));
  });
}

// model menu (per chat)
function engineTargets({ includeUnusable = true } = {}) {
  const groups = [];
  const cliPs = S.providerOrder.map(providerById).filter((p) => p && p.kind === 'cli');
  groups.push({ label: 'Coding agents', items: cliPs.filter((p) => p.usable || includeUnusable).map((p) => ({ p, models: p.models.slice(0, p.usable ? 4 : 1) })) });
  const apis = S.providerOrder.map(providerById).filter((p) => p && p.kind !== 'cli');
  for (const p of apis.filter((p) => p.usable)) groups.push({ label: p.name, items: [{ p, models: providerModels(p).slice(0, 16) }] });
  if (includeUnusable) groups.push({ label: 'Needs a key', items: apis.filter((p) => !p.usable && !p.custom && !p.local).map((p) => ({ p, models: [p.models[0]] })) });
  return groups;
}
function openModelMenu(anchor) {
  const conv = current();
  const draw = (q = '') => {
    const ql = q.toLowerCase();
    let html = `<div class="menu-search"><input id="mm-q" placeholder="Search engines and models" value="${esc(q)}" spellcheck="false"></div><div class="menu-scroll">`;
    if (!ql) html += `<button class="menu-item" data-p="auto"><span class="check">${!conv.pinned ? icon('check', 14) : ''}</span>${icon('sparkles', 15)}<div>Auto<span class="d">Best available engine, switches if one fails</span></div></button>`;
    for (const g of engineTargets()) {
      let rows = '';
      for (const { p, models } of g.items) {
        for (const mdl of models) {
          const label = p.kind === 'cli' ? (mdl === 'default' ? p.name : `${p.name} · ${mdl}`) : shortModel(mdl);
          if (ql && !(label + ' ' + p.name + ' ' + mdl).toLowerCase().includes(ql)) continue;
          const sel = conv.pinned && conv.pinned.provider === p.id && conv.pinned.model === mdl;
          const usable = p.usable;
          const sub = !usable ? (p.kind === 'cli' ? 'Set up' : 'Add key') : p.cooling ? 'resting' : p.kind === 'cli' ? 'your plan' : mdl.endsWith(':free') || p.free ? 'free' : '';
          rows += `<button class="menu-item ${usable ? '' : 'dim'}" data-p="${esc(p.id)}" data-m="${esc(mdl)}" ${usable ? '' : `data-setup="${p.kind === 'cli' ? 'agents' : 'api'}"`}><span class="check">${sel ? icon('check', 14) : ''}</span>${p.kind === 'cli' ? icon('terminal', 15) : `<span class="li-logo" style="width:18px;height:18px;border-radius:5px;font-size:8.5px">${esc(p.name.replace(/[^A-Za-z]/g, '').slice(0, 2))}</span>`}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span><span class="sub">${sub}</span></button>`;
        }
      }
      if (rows) html += `<div class="menu-label">${esc(g.label)}</div>${rows}`;
    }
    html += `</div><div class="menu-foot"><span>Fall back to other engines if it fails</span><button class="toggle ${conv.fallback !== false ? 'on' : ''}" id="mm-fb"></button></div>`;
    const menu = openMenu(anchor, html, (d) => {
      if (d.p === 'auto') conv.pinned = null;
      else conv.pinned = { provider: d.p, model: d.m };
      persist(conv);
      $('#btn-model').innerHTML = modelPickLabel(conv);
      $('.composer-hint span:last-child') && !conv.folder && ($('.composer-hint > span:last-child').textContent = engineChainHint(conv));
      updateCtx();
    });
    const qi = $('#mm-q', menu);
    qi.focus();
    qi.setSelectionRange(q.length, q.length);
    qi.addEventListener('input', () => draw(qi.value));
    $('#mm-fb', menu).addEventListener('click', (e) => {
      conv.fallback = conv.fallback === false;
      e.currentTarget.classList.toggle('on', conv.fallback !== false);
      persist(conv);
      if (!conv.folder) $('.composer-hint > span:last-child').textContent = engineChainHint(conv);
    });
  };
  draw();
}

function openNewMenu(anchor) {
  const html = `<div class="menu-scroll">
    <button class="menu-item" data-a="node">${icon('chat', 15)}<div>Chat with a node<span class="d">One specialist</span></div></button>
    <button class="menu-item" data-a="team">${icon('users', 15)}<div>Team chat<span class="d">Every node, the right ones answer</span></div></button>
    <button class="menu-item" data-a="pair">${icon('route', 15)}<div>Pair two engines<span class="d">They hand off progress and build together</span></div></button>
    <button class="menu-item" data-a="compare">${icon('sliders', 15)}<div>Compare models<span class="d">Same prompt, side by side</span></div></button>
    <div class="menu-sep"></div>
    <button class="menu-item" data-a="newnode">${icon('plus', 15)}<div>Create a node<span class="d">Your own specialist</span></div></button></div>`;
  openMenu(anchor, html, (d) => {
    if (d.a === 'team') openTeam();
    else if (d.a === 'newnode') editNode(null);
    else openNewChat(d.a);
  }, { below: true });
}

function openNewChat(mode = 'node') {
  const targets = [];
  for (const g of engineTargets({ includeUnusable: false })) for (const { p, models } of g.items) if (p.usable) for (const m of models.slice(0, p.kind === 'cli' ? 1 : 6)) targets.push({ provider: p.id, model: m });
  if (mode === 'node') {
    const m = modal('New chat', 'Pick who you want to talk to.', `<div class="pick-grid">${S.nodes.map((n) => `<button class="pick" data-n="${n.id}">${av(n, 36)}<div><b>${esc(n.name)}</b><span>${esc(n.tagline)}</span></div></button>`).join('')}
      <button class="pick" data-new>${`<div class="li-logo" style="width:36px;height:36px">${icon('plus', 16)}</div>`}<div><b>Create a node</b><span>Your own specialist</span></div></button></div>`);
    $$('[data-n]', m).forEach((b) =>
      b.addEventListener('click', () => {
        closeLayer();
        const c = newConversation({ kind: 'node', nodeIds: [b.dataset.n] });
        c.messages.push(greetingMsg(b.dataset.n));
        persist(c);
        openConv(c.id);
      })
    );
    $('[data-new]', m).addEventListener('click', () => editNode(null));
    return;
  }
  if (!targets.length) {
    toast('Set up at least one engine first');
    return setView('engines');
  }
  if (mode === 'compare') {
    const sel = new Set(targets.slice(0, 3).map((t) => t.provider + '|' + t.model));
    const draw = () => {
      const m = modal('Compare models', 'Pick 2 to 4. Each one answers the same prompt.', `<div class="pick-grid">${targets.map((t) => {
        const k = t.provider + '|' + t.model;
        return `<button class="pick ${sel.has(k) ? 'sel' : ''}" data-k="${esc(k)}"><span class="check">${sel.has(k) ? icon('check', 11) : ''}</span><div><b>${esc(engineLabel(t))}</b><span>${esc(providerById(t.provider).name)}</span></div></button>`;
      }).join('')}</div>`, `<span class="sub" style="color:var(--muted);font-size:12.5px">${sel.size} selected</span><div class="right"><button class="btn primary" data-go ${sel.size < 2 ? 'disabled' : ''}>Start</button></div>`, 'wide');
      $$('[data-k]', m).forEach((b) => b.addEventListener('click', () => (sel.has(b.dataset.k) ? sel.delete(b.dataset.k) : sel.size < 4 && sel.add(b.dataset.k), draw())));
      $('[data-go]', m).addEventListener('click', () => {
        closeLayer();
        const compare = [...sel].map((k) => ({ provider: k.split('|')[0], model: k.split('|').slice(1).join('|') }));
        const c = newConversation({ kind: 'compare', nodeIds: ['engineer'], compare, title: 'Compare' });
        persist(c);
        openConv(c.id);
      });
    };
    return draw();
  }
  // pair
  const cli = targets.filter((t) => providerById(t.provider).kind === 'cli');
  let a = cli[0] || targets[0];
  let b = cli[1] || targets.find((t) => t.provider !== a.provider) || targets[1] || targets[0];
  let rounds = 3;
  let strict = false;
  const opts = (sel) => targets.map((t) => `<option value="${esc(t.provider + '|' + t.model)}" ${sel.provider === t.provider && sel.model === t.model ? 'selected' : ''}>${esc(engineLabel(t))} — ${esc(providerById(t.provider).name)}</option>`).join('');
  const draw = () => {
    const m = modal('Pair two engines', 'Two AIs work on one project. Each turn, one sends the other its progress; they keep going until both agree it\'s done.', `
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:end">
        <div class="field"><label>Builder</label><select class="select" id="pa">${opts(a)}</select></div>
        <div style="padding-bottom:7px;color:var(--muted)">${icon('route', 18)}</div>
        <div class="field"><label>Partner (reviews and continues)</label><select class="select" id="pb">${opts(b)}</select></div>
      </div>
      <div class="field"><label>Rounds (each engine gets this many turns)</label><div class="seg" id="pr">${[2, 3, 5, 8].map((n) => `<button class="${n === rounds ? 'on' : ''}" data-r="${n}">${n}</button>`).join('')}</div></div>
      <div class="set-row" style="padding:4px 0;border:0"><div class="l"><b>Strict pairing</b><span>Don't swap in another engine if one of them fails</span></div><button class="toggle ${strict ? 'on' : ''}" id="ps"></button></div>
      <div class="callout" style="margin:0">${icon('folder', 17)}<div><h4>Tip: give them a project folder</h4><p>With a folder set and edits allowed, coding agents like Codex and Claude Code change real files, and each sees what the other did.</p></div></div>`,
      `<span></span><div class="right"><button class="btn" data-c>Cancel</button><button class="btn primary" data-go>Start pairing</button></div>`, 'wide');
    const parse = (v) => ({ provider: v.split('|')[0], model: v.split('|').slice(1).join('|') });
    $('#pa', m).addEventListener('change', (e) => (a = parse(e.target.value)));
    $('#pb', m).addEventListener('change', (e) => (b = parse(e.target.value)));
    $$('[data-r]', m).forEach((x) => x.addEventListener('click', () => ((rounds = +x.dataset.r), draw())));
    $('#ps', m).addEventListener('click', () => ((strict = !strict), draw()));
    $('[data-c]', m).addEventListener('click', closeLayer);
    $('[data-go]', m).addEventListener('click', async () => {
      closeLayer();
      const c = newConversation({ kind: 'pair', nodeIds: ['engineer'], pair: { a, b, rounds }, pairStrict: strict, title: `${engineLabel(a)} ⇄ ${engineLabel(b)}` });
      persist(c);
      openConv(c.id);
    });
  };
  draw();
}

// ---------------- nodes ----------------
function renderNodes(main) {
  const missing = S.defaultNodes.filter((d) => !S.nodes.some((n) => n.id === d.id));
  const bizMissing = (S.businessNodes || []).filter((d) => !S.nodes.some((n) => n.id === d.id));
  main.innerHTML = `${topbar('<h1>Nodes</h1>')}
    <div class="page"><div class="page-inner">
      <div class="page-head"><div><h2>Your team</h2><p>Each node is a specialist with its own instructions and favourite engines. If its engines fail, Nodes keeps falling back until someone answers.</p></div>
      <div style="display:flex;gap:8px"><button class="btn" id="team-chat">${icon('users', 15)}Team chat</button><button class="btn primary" id="new-node">${icon('plus', 15)}New node</button></div></div>
      <div class="node-grid">
        ${S.nodes.map((n) => `<div class="node-card" data-node="${n.id}">
          <div class="row">${av(n, 48)}<div style="min-width:0"><h3>${esc(n.name)}</h3><div class="tag">${esc(n.tagline)}</div></div></div>
          <div class="chips">${[...(n.engines || [])].sort((x, y) => !!providerById(y.provider)?.usable - !!providerById(x.provider)?.usable).slice(0, 3).map((e) => `<span class="chip" style="${providerById(e.provider)?.usable ? '' : 'opacity:.45'}" title="${providerById(e.provider)?.usable ? 'Ready' : 'Not set up yet'}">${esc(engineLabel(e))}</span>`).join('')}${n.autoFallback === false ? '' : '<span class="chip blue">+ fallback</span>'}${n.web ? '<span class="chip green">web</span>' : ''}</div>
          <div class="actions"><button class="btn small primary" data-chat="${n.id}">${icon('chat', 13)}Message</button><button class="btn small" data-edit="${n.id}">${icon('edit', 13)}Edit</button></div>
        </div>`).join('')}
        <div class="node-card add" id="add-node">${icon('plus', 18)}<span>Create a node</span></div>
      </div>
      ${bizMissing.length ? `<div class="section-title"><span>Business pack</span><button class="btn small" data-addbiz>${icon('plus', 13)}Add all</button></div><div class="node-grid">${bizMissing.map((n) => `<div class="node-card"><div class="row">${av(n, 40)}<div><h3>${esc(n.name)}</h3><div class="tag">${esc(n.tagline)}</div></div></div><div class="actions"><button class="btn small" data-readd="${n.id}">${icon('plus', 13)}Add to team</button></div></div>`).join('')}</div>` : ''}
      ${missing.length ? `<div class="section-title">Built-in nodes you removed</div><div class="node-grid">${missing.map((n) => `<div class="node-card"><div class="row">${av(n, 40)}<div><h3>${esc(n.name)}</h3><div class="tag">${esc(n.tagline)}</div></div></div><div class="actions"><button class="btn small" data-readd="${n.id}">${icon('plus', 13)}Add back</button></div></div>`).join('')}</div>` : ''}
    </div></div>`;
  $$('[data-chat]', main).forEach((b) => b.addEventListener('click', (e) => (e.stopPropagation(), openNodeChat(b.dataset.chat))));
  $$('[data-edit]', main).forEach((b) => b.addEventListener('click', (e) => (e.stopPropagation(), editNode(nodeById(b.dataset.edit)))));
  $$('[data-readd]', main).forEach((b) =>
    b.addEventListener('click', async () => {
      S.nodes = await api.saveNode({ ...[...S.defaultNodes, ...(S.businessNodes || [])].find((d) => d.id === b.dataset.readd), builtIn: true });
      addToTeamChat(b.dataset.readd);
      renderNodes(main);
    })
  );
  $('[data-addbiz]', main)?.addEventListener('click', async () => {
    for (const n of bizMissing) {
      S.nodes = await api.saveNode({ ...n, builtIn: true });
      addToTeamChat(n.id);
    }
    toast('Business pack added');
    renderNodes(main);
  });
  $('#new-node').addEventListener('click', () => editNode(null));
  $('#add-node').addEventListener('click', () => editNode(null));
  $('#team-chat').addEventListener('click', openTeam);
}

function addToTeamChat(id) {
  for (const c of S.conversations.filter((c) => c.kind === 'team'))
    if (!c.nodeIds.includes(id)) {
      c.nodeIds.push(id);
      persist(c);
    }
}
function editNode(node) {
  const isNew = !node;
  const a = node ? JSON.parse(JSON.stringify(node)) : { id: 'n-' + uid(), name: '', tagline: '', greeting: '', avatar: randomSpec(), system: 'You are {name}, a specialist who helps {CALLME} with ', temperature: 0.4, engines: [], keywords: [], web: false };
  const engineOptions = [];
  for (const g of engineTargets()) for (const { p, models } of g.items) for (const m of p.kind === 'cli' ? p.models : providerModels(p)) engineOptions.push(`<option value="${esc(p.id + '|' + m)}">${esc(p.kind === 'cli' ? (m === 'default' ? p.name : p.name + ' · ' + m) : p.name + ' · ' + m)}${p.usable ? '' : ' (not set up)'}</option>`);
  const draw = () => {
    const sp = a.avatar;
    const body = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:start">
        <div style="display:grid;gap:8px;justify-items:center">${nodeAvatar(sp, 96)}<button class="btn small ghost" id="nd-rand">${icon('refresh', 12)}Shuffle</button></div>
        <div style="display:grid;gap:10px">
          <input class="input" id="nd-name" placeholder="Name, e.g. iOS Engineer" value="${esc(a.name)}">
          <input class="input" id="nd-tag" placeholder="One-line description" value="${esc(a.tagline)}">
          <div class="pal-row">${PALETTES.map((p, i) => `<button data-pal="${i}" class="${sp.bg[0] === p[0] ? 'on' : ''}" style="background:linear-gradient(135deg,${p[0]},${p[1]})"></button>`).join('')}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${Object.entries(PARTS).map(([k, opts]) => `<div class="field"><label style="text-transform:capitalize">${k}</label><div class="part-row">${opts.map((o) => `<button data-part="${k}" data-v="${o}" class="${sp[k] === o ? 'on' : ''}">${o}</button>`).join('')}</div></div>`).join('')}
      </div>
      <div class="field"><label>Instructions</label><textarea class="textarea" id="nd-sys" rows="7">${esc(a.system)}</textarea><span class="hint">{CALLME} becomes what you asked nodes to call you. MEMORY.txt is added automatically.</span></div>
      <div class="field"><label>Greeting</label><input class="input" id="nd-greet" value="${esc(a.greeting || '')}" placeholder="What it says when you open a new chat"></div>
      <div class="field"><label>Creativity · <span id="nd-tv">${a.temperature}</span></label><input type="range" id="nd-temp" min="0" max="1.2" step="0.1" value="${a.temperature}" style="accent-color:var(--accent)"></div>
      <div class="field"><label>Preferred engines, tried in order</label>
        <div class="engine-list">${(a.engines || []).map((e, i) => `<div class="engine-item"><span class="n">${i + 1}</span><span class="t">${esc(engineLabel(e))} <i>· ${esc(providerById(e.provider)?.name || e.provider)}</i></span><button class="icon-btn" data-up="${i}">${icon('up', 13)}</button><button class="icon-btn" data-rm="${i}">${icon('x', 13)}</button></div>`).join('') || '<div class="hint" style="color:var(--faint);font-size:12px">None. Nodes picks the best available engine.</div>'}</div>
        <select class="select" id="nd-eng"><option value="">Add an engine…</option>${engineOptions.join('')}</select></div>
      <div class="field"><label>Team keywords (comma separated)</label><input class="input" id="nd-kw" value="${esc((a.keywords || []).join(', '))}" placeholder="When these come up in team chat, this node answers"></div>
      <div class="set-row" style="padding:2px 0;border:0"><div class="l"><b>Fall back to other engines</b><span>Keep trying the rest until one answers</span></div><button class="toggle ${a.autoFallback === false ? '' : 'on'}" id="nd-fb"></button></div>
      <div class="set-row" style="padding:2px 0;border:0"><div class="l"><b>Web search by default</b><span>New chats start with web search on</span></div><button class="toggle ${a.web ? 'on' : ''}" id="nd-web"></button></div>`;
    const foot = `<div>${!isNew ? (a.builtIn ? `<button class="btn ghost" id="nd-reset">Reset</button><button class="btn ghost danger" id="nd-del">Remove</button>` : `<button class="btn ghost danger" id="nd-del">${icon('trash', 14)}Delete</button>`) : ''}</div><div class="right"><button class="btn" data-c>Cancel</button><button class="btn primary" id="nd-save">${isNew ? 'Create node' : 'Save'}</button></div>`;
    const m = modal(isNew ? 'Create a node' : `Edit ${esc(a.name)}`, '', body, foot, 'wide');
    const sync = () => {
      a.name = $('#nd-name', m).value;
      a.tagline = $('#nd-tag', m).value;
      a.system = $('#nd-sys', m).value;
      a.greeting = $('#nd-greet', m).value;
      a.temperature = +$('#nd-temp', m).value;
      a.keywords = $('#nd-kw', m).value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    };
    const keep = (fn) => () => {
      sync();
      const st = $('.modal-body', m).scrollTop;
      fn();
      draw();
      $('.modal-body').scrollTop = st;
    };
    $('#nd-rand', m).addEventListener('click', keep(() => (a.avatar = randomSpec())));
    $$('[data-pal]', m).forEach((b) => b.addEventListener('click', keep(() => (a.avatar = { ...a.avatar, bg: PALETTES[+b.dataset.pal] }))));
    $$('[data-part]', m).forEach((b) => b.addEventListener('click', keep(() => (a.avatar = { ...a.avatar, [b.dataset.part]: b.dataset.v }))));
    $('#nd-temp', m).addEventListener('input', (e) => ($('#nd-tv', m).textContent = e.target.value));
    $('#nd-eng', m).addEventListener('change', (e) => {
      if (!e.target.value) return;
      keep(() => {
        const [provider, ...rest] = e.target.value.split('|');
        a.engines = [...(a.engines || []), { provider, model: rest.join('|') }];
      })();
    });
    $$('[data-rm]', m).forEach((b) => b.addEventListener('click', keep(() => a.engines.splice(+b.dataset.rm, 1))));
    $$('[data-up]', m).forEach((b) => b.addEventListener('click', keep(() => {
      const i = +b.dataset.up;
      if (i > 0) [a.engines[i - 1], a.engines[i]] = [a.engines[i], a.engines[i - 1]];
    })));
    $('#nd-fb', m).addEventListener('click', keep(() => (a.autoFallback = a.autoFallback === false)));
    $('#nd-web', m).addEventListener('click', keep(() => (a.web = !a.web)));
    $('[data-c]', m).addEventListener('click', closeLayer);
    $('#nd-save', m).addEventListener('click', async () => {
      sync();
      if (!a.name.trim()) return $('#nd-name', m).focus();
      a.name = a.name.trim();
      a.tagline = a.tagline.trim() || 'Custom node';
      a.system = a.system.replace(/\{name\}/g, a.name);
      if (!a.greeting) a.greeting = `Hi {CALLME}, I'm ${a.name}. ${a.tagline}.`;
      S.nodes = await api.saveNode(a);
      closeLayer();
      toast(isNew ? `${a.name} joined the team` : 'Saved');
      const team = S.conversations.find((c) => c.kind === 'team');
      if (isNew && team && !team.nodeIds.includes(a.id)) {
        team.nodeIds.push(a.id);
        persist(team);
      }
      if (isNew) return openNodeChat(a.id);
      render();
    });
    $('#nd-reset', m)?.addEventListener('click', async () => {
      S.nodes = await api.resetNode(a.id);
      closeLayer();
      render();
      toast('Reset');
    });
    $('#nd-del', m)?.addEventListener('click', async () => {
      S.nodes = await api.deleteNode(a.id);
      for (const c of S.conversations.filter((c) => c.kind === 'team')) {
        c.nodeIds = c.nodeIds.filter((x) => x !== a.id);
        persist(c);
      }
      closeLayer();
      render();
      toast(`${a.name} removed`);
    });
    if (isNew) setTimeout(() => $('#nd-name')?.focus(), 30);
  };
  draw();
}

// ---------------- engines ----------------
function renderEngines(main) {
  const st = $('.page', main)?.scrollTop || 0;
  const tabs = [['agents', 'Coding agents'], ['api', 'API providers'], ['search', 'Web search'], ['order', 'Fallback order']];
  main.innerHTML = `${topbar('<h1>Engines</h1>', `<button class="btn small" id="rescan">${icon('refresh', 13)}Rescan</button>`)}
    <div class="page"><div class="page-inner">
      <div class="page-head"><div><h2>Engines</h2><p>Everything your nodes think with. Coding agents use your existing subscriptions, API providers use keys (many are free), and Nodes falls back through them when one fails.</p></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${enginesTab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="eng-body"></div>
    </div></div>`;
  $$('[data-tab]', main).forEach((b) => b.addEventListener('click', () => ((enginesTab = b.dataset.tab), (expanded = null), renderEngines(main))));
  $('#rescan').addEventListener('click', async (e) => {
    e.currentTarget.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
    S = { ...S, ...(await api.scanCli()) };
    renderEngines(main);
    toast('Rescanned');
  });
  const body = $('#eng-body', main);
  if (enginesTab === 'agents') engAgents(body, main);
  else if (enginesTab === 'api') engApi(body, main);
  else if (enginesTab === 'search') engSearch(body, main);
  else engOrder(body, main);
  $('.page', main).scrollTop = st;
}
function cliCard(c, compact) {
  const p = providerById(c.id);
  const status = c.installed ? (c.signedIn ? `<span class="chip green">${c.id === 'ollama-app' ? 'Running' : 'Connected'}</span>` : `<span class="chip amber">${c.id === 'ollama-app' ? 'Not running' : 'Not signed in'}</span>`) : '<span class="chip">Not installed</span>';
  const btn = !c.installed
    ? `<button class="btn small" data-cli-install="${c.id}">${icon('download', 13)}Install</button>`
    : !c.signedIn
    ? `<button class="btn small primary" data-cli-login="${c.id}">${icon('user', 13)}${c.id === 'ollama-app' ? 'Start' : 'Sign in'}</button>`
    : p ? `<button class="toggle ${p.cfg.enabled === false ? '' : 'on'}" data-enable="${p.id}" title="Use as an engine"></button>` : '';
  return `<div class="${compact ? 'cli-card' : 'li'}">${compact ? `<div class="top"><div class="li-logo">${esc(c.name.slice(0, 2))}</div><div style="flex:1;min-width:0"><b>${esc(c.name)}</b><span>${esc(c.vendor)}</span></div>${status}</div><div class="acts" style="justify-content:space-between"><span style="font-size:12px;color:var(--muted)">${esc(c.blurb)}</span>${btn}</div>` : `<div class="li-row"><div class="li-logo">${esc(c.name.slice(0, 2))}</div><div class="li-main"><div class="li-name">${esc(c.name)} ${status}</div><div class="li-sub">${c.installed && c.path ? `<code>${esc(c.path.replace(S.home, '~'))}</code>${c.version ? ' · ' + esc(c.version) : ''}` : esc(c.blurb)}${c.detail ? ' · ' + esc(c.detail) : ''}</div>${!c.installed ? `<div class="li-sub" style="margin-top:3px"><code>${esc(c.install)}</code></div>` : ''}</div>${c.installed && c.signedIn && p ? `<button class="btn small ghost" data-test="${p.id}">${icon('zap', 13)}Test</button>` : ''}${btn}</div>`}</div>`;
}
function bindCli(root, after) {
  $$('[data-cli-install]', root).forEach((b) => b.addEventListener('click', async () => {
    await api.cliTerminal(b.dataset.cliInstall, 'install');
    toast('Opened Terminal. Come back and press Rescan when it finishes.');
  }));
  $$('[data-cli-login]', root).forEach((b) => b.addEventListener('click', async () => {
    await api.cliTerminal(b.dataset.cliLogin, 'login');
    toast('Finish signing in, then press Rescan');
  }));
  $$('[data-enable]', root).forEach((b) => b.addEventListener('click', async () => {
    const p = providerById(b.dataset.enable);
    S = { ...S, ...(await api.updateProvider(p.id, { enabled: p.cfg.enabled === false })) };
    after();
  }));
  $$('[data-test]', root).forEach((b) => b.addEventListener('click', async () => {
    b.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
    const r = await api.testProvider(b.dataset.test);
    toast(r.ok ? `Working · ${(r.ms / 1000).toFixed(1)}s` : `Failed: ${r.reason}`);
    b.innerHTML = `${icon(r.ok ? 'check' : 'alert', 13)}${r.ok ? 'Works' : 'Failed'}`;
  }));
}
function engAgents(body, main) {
  body.innerHTML = `<div class="callout">${icon('terminal', 18)}<div><h4>Use the AI subscriptions you already pay for</h4><p>Nodes runs these coding agents for you, signed in as you. They're tried before or after the API providers depending on your fallback order, and they can work inside a chat's project folder.</p></div></div>
    <div class="list">${(S.cli || []).map((c) => cliCard(c, false)).join('') || '<div class="conv-empty">Scanning…</div>'}</div>`;
  bindCli(body, () => renderEngines(main));
}
function engApi(body, main) {
  const apis = S.providerOrder.map(providerById).filter((p) => p && p.kind !== 'cli');
  const freeQuick = ['gemini', 'groq', 'openrouter', 'cerebras', 'github', 'mistral'].map(providerById).filter((p) => p && !p.hasKey);
  body.innerHTML = `${freeQuick.length ? `<div class="callout">${icon('sparkles', 18)}<div><h4>Free models in about a minute</h4><p>These have free tiers, no card needed. Make a key, paste it below, and nodes start using it straight away.</p><div class="links">${freeQuick.map((p) => `<button class="btn small" data-href="${esc(p.keyUrl)}">${esc(p.name)} ${icon('external', 12)}</button>`).join('')}</div></div></div>` : ''}
    <div class="list">${apis.map((p) => {
      const st = provStatus(p);
      const open = expanded === p.id;
      const chips = [p.keyless && !p.local ? '<span class="chip green">No key</span>' : '', p.local ? '<span class="chip">Local</span>' : p.free ? '<span class="chip green">Free tier</span>' : p.custom ? '' : '<span class="chip amber">Paid</span>'].join('');
      return `<div class="li" data-p="${p.id}"><div class="li-row click" data-toggle="${p.id}"><div class="li-logo">${esc(p.name.replace(/[^A-Za-z]/g, '').slice(0, 2))}</div><div class="li-main"><div class="li-name">${esc(p.name)} ${chips}</div><div class="li-sub"><span class="status-dot ${st.dot}"></span>${esc(st.text)}</div></div><button class="toggle ${p.cfg.enabled === false ? '' : 'on'}" data-enable="${p.id}"></button>${icon(open ? 'chevron' : 'chevronRight', 15)}</div>${open ? providerDetail(p) : ''}</div>`;
    }).join('')}</div>`;
  $$('[data-toggle]', body).forEach((r) => r.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    expanded = expanded === r.dataset.toggle ? null : r.dataset.toggle;
    renderEngines(main);
  }));
  bindCli(body, () => renderEngines(main));
  const d = expanded && $(`.li[data-p="${expanded}"]`, body);
  if (d) bindProviderDetail(d, providerById(expanded), main);
}
function provStatus(p) {
  if (p.cfg.enabled === false) return { dot: 'off', text: 'Off' };
  if (!p.usable) return { dot: 'off', text: p.custom ? 'Set a base URL' : p.extraFields && p.hasKey ? 'Needs ' + p.extraFields.map((f) => f.label).join(', ') : p.free ? 'Add a free key' : 'Add your key' };
  if (p.cooling) return { dot: 'warn', text: 'Resting after an error · ' + shortModel(p.cfg.defaultModel) };
  return { dot: '', text: 'Ready · ' + shortModel(p.cfg.defaultModel) };
}
function providerDetail(p) {
  const models = providerModels(p);
  return `<div class="li-detail">
    <div style="color:var(--text-2);font-size:12.8px">${esc(p.note)}</div>
    ${p.keyless ? '' : `<div class="field"><label>${esc(p.keyLabel || 'API key')}</label><div class="inline"><input class="input" type="password" id="pk" placeholder="${p.hasKey ? 'Saved ' + esc(p.keyHint) + ' · paste to replace' : 'Paste key'}" autocomplete="off" spellcheck="false"><button class="btn" id="pk-save">Save</button>${p.hasKey ? '<button class="btn ghost" id="pk-clear">Remove</button>' : ''}${p.keyUrl ? `<button class="btn ghost" data-href="${esc(p.keyUrl)}">Get key ${icon('external', 12)}</button>` : ''}</div><span class="hint">Encrypted with your Mac's keychain. Only ever sent to ${esc(p.name)}.</span></div>`}
    ${(p.extraFields || []).map((f) => `<div class="field"><label>${esc(f.label)}</label><div class="inline"><input class="input" data-extra="${f.id}" value="${esc((p.cfg.extra || {})[f.id] || '')}" spellcheck="false"><button class="btn" data-extra-save="${f.id}">Save</button></div></div>`).join('')}
    <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end"><div class="field"><label>Default model</label><select class="select" id="pm">${models.map((m) => `<option ${m === p.cfg.defaultModel ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
      <div class="inline"><button class="btn" id="pm-fetch" ${p.usable ? '' : 'disabled'}>${icon('refresh', 13)}Fetch models</button><button class="btn" id="p-test" ${p.usable ? '' : 'disabled'}>${icon('zap', 13)}Test</button></div></div>
    <div class="result" id="p-result">${p.stats ? `${p.stats.ok} answered · ${p.stats.fail} failed${p.stats.ok ? ` · avg ${(p.stats.totalMs / p.stats.ok / 1000).toFixed(1)}s` : ''}` : ''}</div></div>`;
}
function bindProviderDetail(el, p, main) {
  const refresh = (st) => {
    S = { ...S, ...st };
    renderEngines(main);
    render();
  };
  const showResult = (r) => {
    const res = $(`.li[data-p="${p.id}"] #p-result`);
    if (res) {
      res.className = 'result ' + (r.ok ? 'ok' : 'bad');
      res.textContent = r.ok ? `Working · answered in ${(r.ms / 1000).toFixed(1)}s` : `Didn't work: ${r.reason}`;
    }
  };
  $('#pk-save', el)?.addEventListener('click', async () => {
    const v = $('#pk', el).value.trim();
    if (!v) return $('#pk', el).focus();
    refresh(await api.setKey(p.id, v));
    toast(`${p.name} key saved · testing…`);
    const r = await api.testProvider(p.id);
    S = await api.getState();
    renderEngines(main);
    showResult(r);
  });
  $('#pk', el)?.addEventListener('keydown', (e) => e.key === 'Enter' && $('#pk-save', el).click());
  $('#pk-clear', el)?.addEventListener('click', async () => refresh(await api.setKey(p.id, '')));
  $$('[data-extra-save]', el).forEach((b) => b.addEventListener('click', async () => {
    refresh(await api.updateProvider(p.id, { enabled: true, extra: { [b.dataset.extraSave]: $(`[data-extra="${b.dataset.extraSave}"]`, el).value.trim() } }));
    toast('Saved');
  }));
  $('#pm', el)?.addEventListener('change', async (e) => refresh(await api.updateProvider(p.id, { defaultModel: e.target.value })));
  $('#pm-fetch', el)?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
    try {
      refresh(await api.fetchModels(p.id));
      toast(`${providerById(p.id).cfg.models.length} models found`);
    } catch (err) {
      b.innerHTML = `${icon('refresh', 13)}Fetch models`;
      showResult({ ok: false, reason: String(err.message || err).replace(/^Error invoking remote method[^:]*: (Error: )?/, '') });
    }
  });
  $('#p-test', el)?.addEventListener('click', async (e) => {
    e.currentTarget.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
    const r = await api.testProvider(p.id);
    S = await api.getState();
    renderEngines(main);
    showResult(r);
  });
}
function engSearch(body, main) {
  const s = S.search;
  body.innerHTML = `<div class="callout">${icon('globe', 18)}<div><h4>Real search, not just DuckDuckGo</h4><p>When web search is on, nodes search with the first engine that works, read the top pages, and cite them. The built-in browser engines use a hidden real browser, so they need no key. Add free keys for Brave, Tavily, Serper or Exa for even better results.</p></div></div>
    <div class="list">${s.order.map((id, i) => {
      const e = s.engines.find((x) => x.id === id);
      if (!e) return '';
      const on = s.enabled[id] !== false;
      const ready = e.keyless ? (e.extra ? !!s.extra[id] : true) : e.hasKey;
      return `<div class="li"><div class="li-row"><div class="order"><button data-su="${i}">${icon('up', 12)}</button><button data-sd="${i}">${icon('down', 12)}</button></div><div class="li-logo">${esc(e.name.replace(/[^A-Za-z]/g, '').slice(0, 2))}</div><div class="li-main"><div class="li-name">${esc(e.name)} ${e.keyless ? '<span class="chip green">No key</span>' : '<span class="chip green">Free tier</span>'}</div><div class="li-sub"><span class="status-dot ${on && ready ? '' : 'off'}"></span>${esc(e.note)}</div>
        ${!e.keyless ? `<div class="inline" style="margin-top:8px"><input class="input" type="password" data-skey="${id}" placeholder="${e.hasKey ? 'Key saved · paste to replace' : 'API key'}"><button class="btn small" data-ssave="${id}">Save</button>${e.keyUrl ? `<button class="btn small ghost" data-href="${esc(e.keyUrl)}">Get key</button>` : ''}</div>` : e.extra ? `<div class="inline" style="margin-top:8px"><input class="input" data-sextra="${id}" value="${esc(s.extra[id] || '')}" placeholder="https://searx.example.org"><button class="btn small" data-sesave="${id}">Save</button></div>` : ''}
      </div><button class="toggle ${on ? 'on' : ''}" data-son="${id}"></button></div></div>`;
    }).join('')}</div>
    <div class="section-title">Try it</div><div class="inline"><input class="input" id="s-q" placeholder="Search query" value="latest Swift version"><button class="btn" id="s-test">${icon('search', 13)}Search</button></div><div class="result" id="s-res" style="margin-top:10px"></div>`;
  const upd = async (patch) => {
    S = { ...S, ...(await api.updateSearch(patch)) };
    renderEngines(main);
  };
  const move = (i, d) => {
    const o = [...s.order];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    upd({ order: o });
  };
  $$('[data-su]', body).forEach((b) => b.addEventListener('click', () => move(+b.dataset.su, -1)));
  $$('[data-sd]', body).forEach((b) => b.addEventListener('click', () => move(+b.dataset.sd, 1)));
  $$('[data-son]', body).forEach((b) => b.addEventListener('click', () => upd({ enabled: { ...s.enabled, [b.dataset.son]: s.enabled[b.dataset.son] === false } })));
  $$('[data-ssave]', body).forEach((b) => b.addEventListener('click', async () => {
    S = { ...S, ...(await api.setSearchKey(b.dataset.ssave, $(`[data-skey="${b.dataset.ssave}"]`, body).value)) };
    renderEngines(main);
    toast('Saved');
  }));
  $$('[data-sesave]', body).forEach((b) => b.addEventListener('click', () => upd({ extra: { ...s.extra, [b.dataset.sesave]: $(`[data-sextra="${b.dataset.sesave}"]`, body).value.trim() } })));
  bindCli(body, () => {});
  $('#s-test', body).addEventListener('click', async () => {
    const res = $('#s-res', body);
    res.innerHTML = '<span class="shimmer">Searching…</span>';
    const r = await api.testSearch($('#s-q', body).value);
    res.innerHTML = r.results.length ? `<div style="margin-bottom:6px">Found ${r.results.length} results with <b>${esc(r.engine)}</b>${r.tried.length ? ` (after ${esc(r.tried.join('; '))})` : ''}</div>${r.results.map((x, i) => `<div style="margin:6px 0"><a data-src-url="${esc(x.url)}" style="color:#7fb0ff">${i + 1}. ${esc(x.title)}</a><div style="color:var(--faint)">${esc(x.snippet.slice(0, 140))}</div></div>`).join('')}` : `No results. ${esc(r.tried.join('; '))}`;
  });
}
function engOrder(body, main) {
  const list = S.providerOrder.map(providerById).filter(Boolean);
  body.innerHTML = `<p style="color:var(--muted);margin:0 0 14px;font-size:13px">When a node's preferred engines fail (or you choose Auto), Nodes works down this list until one answers. Engines that just failed rest for a minute and drop to the end.</p>
    <div class="list">${list.map((p, i) => `<div class="li"><div class="li-row"><div class="order"><button data-u="${i}">${icon('up', 12)}</button><button data-d="${i}">${icon('down', 12)}</button></div><span style="color:var(--faint);width:20px;font-variant-numeric:tabular-nums">${i + 1}</span><div class="li-main"><div class="li-name">${esc(p.name)} ${p.kind === 'cli' ? '<span class="chip">agent</span>' : ''}</div></div><span class="status-dot ${p.usable ? (p.cooling ? 'warn' : '') : 'off'}"></span><span style="font-size:12px;color:var(--muted);width:90px">${p.usable ? (p.cooling ? 'Resting' : 'Ready') : 'Not set up'}</span></div></div>`).join('')}</div>`;
  const move = async (i, d) => {
    const o = [...S.providerOrder];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    S = { ...S, ...(await api.setProviderOrder(o)) };
    renderEngines(main);
  };
  $$('[data-u]', body).forEach((b) => b.addEventListener('click', () => move(+b.dataset.u, -1)));
  $$('[data-d]', body).forEach((b) => b.addEventListener('click', () => move(+b.dataset.d, 1)));
}

// ---------------- activity ----------------
function renderActivity(main) {
  const rows = S.providers.filter((p) => p.stats).sort((a, b) => b.stats.ok + b.stats.fail - (a.stats.ok + a.stats.fail));
  const ok = rows.reduce((s, p) => s + p.stats.ok, 0);
  const fail = rows.reduce((s, p) => s + p.stats.fail, 0);
  const rescued = S.conversations.reduce((s, c) => s + c.messages.filter((m) => m.meta && m.routing && m.routing.length).length, 0);
  const answers = S.conversations.reduce((s, c) => s + c.messages.filter((m) => m.meta).length, 0);
  const perNode = {};
  for (const c of S.conversations) for (const m of c.messages) if (m.meta) perNode[m.nodeId] = (perNode[m.nodeId] || 0) + 1;
  main.innerHTML = `${topbar('<h1>Activity</h1>', '<button class="btn small ghost" id="reset">Reset stats</button>')}
    <div class="page"><div class="page-inner">
      <div class="page-head"><div><h2>Activity</h2><p>Every answer, every failure, and how often fallback saved a reply.</p></div></div>
      <div class="stat-cards">${[['Answers', answers], ['Saved by fallback', rescued], ['Engine calls OK', ok], ['Engine calls failed', fail]].map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
      <div class="section-title">Engines</div>
      <div class="list">${rows.length ? `<table class="stats"><thead><tr><th>Engine</th><th>Success</th><th>Answered</th><th>Failed</th><th>Avg time</th><th>Last used</th></tr></thead><tbody>${rows.map((p) => {
        const n = p.stats.ok + p.stats.fail;
        const rate = n ? Math.round((p.stats.ok / n) * 100) : 0;
        return `<tr><td><b>${esc(p.name)}</b></td><td><div style="display:flex;gap:8px;align-items:center"><div class="bar"><i style="width:${rate}%;background:${rate > 80 ? 'var(--ok)' : rate > 40 ? 'var(--warn)' : 'var(--err)'}"></i></div>${rate}%</div></td><td>${p.stats.ok}</td><td>${p.stats.fail}</td><td>${p.stats.ok ? (p.stats.totalMs / p.stats.ok / 1000).toFixed(1) + 's' : '–'}</td><td style="color:var(--muted)">${timeLabel(p.stats.last)}</td></tr>`;
      }).join('')}</tbody></table>` : '<div class="conv-empty">No activity yet.</div>'}</div>
      <div class="section-title">Nodes</div>
      <div class="team-grid">${S.nodes.map((n) => `<div class="team-tile">${av(n, 30)}<div><b>${esc(n.name)}</b><span>${perNode[n.id] || 0} answers</span></div></div>`).join('')}</div>
    </div></div>`;
  $('#reset').addEventListener('click', async () => {
    S = { ...S, ...(await api.resetStats()) };
    renderActivity(main);
  });
}

// ---------------- settings ----------------
const ACCENTS = ['#4c8dff', '#22d3ee', '#34d399', '#f0b04a', '#fb7185', '#f97316', '#e5e7eb'];
async function renderSettings(main) {
  const tabs = [['profile', 'user', 'Profile'], ['memory', 'memory', 'Memory'], ['chat', 'chat', 'Chats & fallback'], ['privacy', 'lock', 'Privacy & data'], ['phone', 'phone', 'Phone'], ['about', 'sparkles', 'About']];
  const s = S.settings;
  let content = '';
  if (settingsTab === 'profile') {
    content = `<div class="set-group">
      <div class="set-row"><div class="l"><b>Your name</b><span>Shown on your messages and exports</span></div><div class="r"><input class="input" id="st-name" value="${esc(s.userName)}" placeholder="Your name"></div></div>
      <div class="set-row"><div class="l"><b>What nodes call you</b><span>A nickname, first name, or anything you like</span></div><div class="r"><input class="input" id="st-call" value="${esc(s.callMe)}" placeholder="${esc(s.userName || 'e.g. boss')}"></div></div>
      <div class="set-row"><div class="l"><b>Accent colour</b><span>Buttons, highlights and your messages</span></div><div class="r"><div class="swatches">${ACCENTS.map((c) => `<button data-acc="${c}" class="${s.accent === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div></div></div>
      <div class="set-row"><div class="l"><b>Launch animation</b><span>Play the intro when Nodes opens</span></div><div class="r"><button class="toggle ${s.launchAnimation ? 'on' : ''}" data-t="launchAnimation"></button></div></div>
      <div class="set-row"><div class="l"><b>Default project folder</b><span>${esc(s.defaultFolder || 'None. New chats start without a folder.')}</span></div><div class="r"><button class="btn small" id="st-folder">Choose…</button>${s.defaultFolder ? '<button class="btn small ghost" id="st-folder-clear">Clear</button>' : ''}</div></div>
    </div><button class="btn primary" id="st-save">Save profile</button>`;
  } else if (settingsTab === 'memory') {
    const mem = await api.getMemory();
    memoryText = mem.text;
    content = `<p style="color:var(--muted);margin:0 0 12px;font-size:13px">Every node reads <b style="color:var(--text)">MEMORY.txt</b> before it answers. Write what they should always know: who you are, your stack, how you like answers. Lines starting with <code>#</code> are notes for you and are ignored. The bookmark button on any message adds it here too.</p>
      <textarea class="textarea mono" id="mem" rows="22" spellcheck="false">${esc(mem.text)}</textarea>
      <div class="inline" style="margin-top:12px;justify-content:space-between"><button class="btn ghost" id="mem-reveal">${icon('folder', 14)}Show in Finder</button><button class="btn primary" id="mem-save">Save MEMORY.txt</button></div>`;
  } else if (settingsTab === 'chat') {
    const row = (k, t, d) => `<div class="set-row"><div class="l"><b>${t}</b><span>${d}</span></div><div class="r"><button class="toggle ${s[k] ? 'on' : ''}" data-t="${k}"></button></div></div>`;
    content = `<div class="set-group">${row('autoFallback', 'Automatic fallback', 'When an engine fails or goes quiet, switch to the next until one answers')}${row('showRouting', 'Show fallback notes', 'A small note in the chat when an engine was skipped')}${row('sendOnEnter', 'Send with Enter', 'Shift+Enter adds a new line')}${row('browserAutoOpen', 'Open browser on web search', 'Show what the node searched in the side panel')}${row('readPages', 'Read top results', 'Nodes reads the top 3 pages so answers are grounded in more than snippets')}</div>
      <div class="set-group">
        <div class="set-row"><div class="l"><b>Wait for first word</b><span>Seconds before switching API engines (coding agents get longer)</span></div><div class="r"><input class="input" style="width:90px" type="number" min="5" max="180" id="st-first" value="${s.firstTokenTimeout}"></div></div>
        <div class="set-row"><div class="l"><b>Most engines to try</b><span>Per answer</span></div><div class="r"><input class="input" style="width:90px" type="number" min="1" max="30" id="st-max" value="${s.maxAttempts}"></div></div>
      </div>`;
  } else if (settingsTab === 'privacy') {
    content = privacySettings();
  } else if (settingsTab === 'phone') {
    content = `<div id="phone-slot"></div>`;
  } else {
    content = `<div class="card card-pad" style="display:flex;gap:18px;align-items:center">${logoSVG(64)}<div><h3 style="font-size:18px">Nodes 1.0</h3><div class="sub">A team of AI engineers that never stops answering. Your chats, keys and MEMORY.txt stay on this Mac.</div></div></div>
      <div class="set-group" style="margin-top:16px"><div class="set-row"><div class="l"><b>Run setup again</b><span>Onboarding: profile, engines and team</span></div><div class="r"><button class="btn small" id="st-ob">Open setup</button></div></div></div>`;
  }
  main.innerHTML = `${topbar('<h1>Settings</h1>')}<div class="page"><div class="page-inner"><div class="settings"><div class="settings-nav">${tabs.map(([k, ic, l]) => `<button class="${settingsTab === k ? 'on' : ''}" data-st="${k}">${icon(ic, 15)}${l}</button>`).join('')}</div><div>${content}</div></div></div></div>`;
  $$('[data-st]', main).forEach((b) => b.addEventListener('click', () => ((settingsTab = b.dataset.st), renderSettings(main))));
  $$('[data-t]', main).forEach((b) => b.addEventListener('click', async () => {
    S.settings = await api.updateSettings({ [b.dataset.t]: !S.settings[b.dataset.t] });
    b.classList.toggle('on', S.settings[b.dataset.t]);
  }));
  $$('[data-acc]', main).forEach((b) => b.addEventListener('click', async () => {
    S.settings = await api.updateSettings({ accent: b.dataset.acc });
    applyAccent();
    renderSettings(main);
  }));
  $('#st-save', main)?.addEventListener('click', async () => {
    S.settings = await api.updateSettings({ userName: $('#st-name').value.trim(), callMe: $('#st-call').value.trim() });
    render();
    toast('Saved');
  });
  $('#st-folder', main)?.addEventListener('click', async () => {
    const f = await api.pickFolder();
    if (f) S.settings = await api.updateSettings({ defaultFolder: f });
    renderSettings(main);
  });
  $('#st-folder-clear', main)?.addEventListener('click', async () => {
    S.settings = await api.updateSettings({ defaultFolder: '' });
    renderSettings(main);
  });
  $('#mem-save', main)?.addEventListener('click', async () => {
    await api.setMemory($('#mem').value);
    memoryText = $('#mem').value;
    toast('MEMORY.txt saved');
  });
  $('#mem-reveal', main)?.addEventListener('click', async () => api.reveal((await api.getMemory()).path));
  ['st-first', 'st-max'].forEach((id) => $('#' + id, main)?.addEventListener('change', async () => {
    S.settings = await api.updateSettings({ firstTokenTimeout: Math.max(5, Math.min(180, +$('#st-first').value || 30)), maxAttempts: Math.max(1, Math.min(30, +$('#st-max').value || 12)) });
  }));
  $('#st-ob', main)?.addEventListener('click', startOnboarding);
  if (settingsTab === 'phone') phonePanel($('#phone-slot', main));
  if (settingsTab === 'privacy') bindPrivacy(main);
}

// ---------------- phone ----------------
async function phonePanel(slot) {
  const info = await api.phoneInfo();
  const draw = (info) => {
    slot.innerHTML = `<div class="set-group"><div class="set-row"><div class="l"><b>Use Nodes on your phone</b><span>Over your Wi-Fi. No account, no cloud: your Mac serves the app and your phone talks to it directly.</span></div><div class="r"><button class="toggle ${info.running ? 'on' : ''}" id="ph-on"></button></div></div></div>
      ${info.running ? `<div class="card card-pad"><div class="phone-box">${info.qr ? `<div class="qr">${info.qr}</div>` : `<div class="qr" style="display:grid;place-items:center;color:#333;font-size:13px;text-align:center">Code expired<br><br></div>`}
        <div style="display:grid;gap:10px"><h3>Scan with your phone's camera</h3><div class="sub">Your phone must be on the same Wi-Fi as this Mac. It opens in the browser; add it to your Home Screen for an app-like feel.</div>
        ${info.pairCode ? `<div><div class="sub">Or open <b style="color:var(--text)">${esc(info.url)}</b> and enter</div><div class="code-big">${info.pairCode}</div></div>` : ''}
        <div><button class="btn small" id="ph-code">${icon('refresh', 13)}New code</button></div></div></div></div>
        <div class="section-title">Paired devices</div><div class="list">${info.devices.length ? info.devices.map((d) => `<div class="li"><div class="li-row"><div class="li-logo">${icon('phone', 16)}</div><div class="li-main"><div class="li-name">${esc(d.name)} ${d.online ? '<span class="chip green">Online</span>' : ''}</div><div class="li-sub">Paired ${timeLabel(d.pairedAt)} · last seen ${timeLabel(d.lastSeen)}</div></div><button class="btn small ghost danger" data-rv="${d.id}">Remove</button></div></div>`).join('') : '<div class="conv-empty">No phones yet</div>'}</div>` : ''}`;
    $('#ph-on', slot).addEventListener('click', async () => draw(await api.phoneEnable(!info.running)));
    $('#ph-code', slot)?.addEventListener('click', async () => draw(await api.phoneNewCode()));
    $$('[data-rv]', slot).forEach((b) => b.addEventListener('click', async () => draw(await api.phoneRevoke(b.dataset.rv))));
  };
  draw(info.running && !info.pairCode ? await api.phoneNewCode() : info);
}
function openPhone() {
  settingsTab = 'phone';
  setView('settings');
}
async function onPhoneAction({ id, type, payload }) {
  let result = { ok: true };
  try {
    if (type === 'send') {
      const conv = convById(payload.convId);
      if (!conv) result = { error: 'chat not found' };
      else {
        send(String(payload.text || ''), conv);
        result = { ok: true };
      }
    } else if (type === 'new') {
      let conv;
      if (payload.nodeId === 'team') {
        openTeam();
        conv = S.conversations.find((c) => c.kind === 'team');
      } else {
        conv = newConversation({ kind: 'node', nodeIds: [payload.nodeId || 'engineer'] });
        conv.messages.push(greetingMsg(conv.nodeIds[0]));
        persist(conv);
        renderSidebar();
      }
      result = { id: conv.id };
    } else if (type === 'stop') stopAll(payload.convId);
    else if (type === 'devices-changed' && view === 'settings' && settingsTab === 'phone') phonePanel($('#phone-slot'));
  } catch (e) {
    result = { error: String(e.message || e) };
  }
  api.phoneReply(id, result);
}

// ---------------- browser panel ----------------
let wv = null;
function setupBrowser() {
  $('#br-close').addEventListener('click', closeBrowser);
  $('#br-back').addEventListener('click', () => wv && wv.canGoBack() && wv.goBack());
  $('#br-fwd').addEventListener('click', () => wv && wv.canGoForward() && wv.goForward());
  $('#br-reload').addEventListener('click', () => wv && wv.reload());
  $('#br-ext').addEventListener('click', () => wv && api.openExternal(wv.getURL()));
  $('#br-form').addEventListener('submit', (e) => {
    e.preventDefault();
    let v = $('#br-url').value.trim();
    if (!v) return;
    if (!/^https?:\/\//.test(v)) v = /^[\w-]+(\.[\w-]+)+(\/|$)/.test(v) ? 'https://' + v : `https://www.google.com/search?q=${encodeURIComponent(v)}`;
    openBrowser(v);
  });
}
function openBrowser(url) {
  browserOpen = true;
  $('#browser').classList.remove('hidden');
  $('#act-browser')?.classList.add('on');
  const body = $('#br-body');
  if (!url && !wv) {
    body.innerHTML = `<div class="browser-empty"><div>${icon('globe', 28)}<p style="margin-top:12px">Sources and links from your nodes open here.<br>Type an address or search above.</p></div></div>`;
    $('#br-url').focus();
    return;
  }
  if (!url) return;
  if (!wv) {
    body.innerHTML = '';
    wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:nodes-browser');
    wv.setAttribute('src', url);
    body.appendChild(wv);
    const prog = $('#br-progress');
    wv.addEventListener('did-start-loading', () => prog.classList.add('loading'));
    wv.addEventListener('did-stop-loading', () => {
      prog.classList.remove('loading');
      prog.style.width = '100%';
      setTimeout(() => (prog.style.width = '0'), 250);
    });
    const upd = (e) => ($('#br-url').value = e.url || wv.getURL());
    wv.addEventListener('did-navigate', upd);
    wv.addEventListener('did-navigate-in-page', (e) => e.isMainFrame && upd(e));
  } else wv.loadURL(url).catch(() => {});
  $('#br-url').value = url;
}
function closeBrowser() {
  browserOpen = false;
  $('#browser').classList.add('hidden');
  $('#act-browser')?.classList.remove('on');
}

// ---------------- onboarding ----------------
let ob = null;
function startOnboarding() {
  closeLayer();
  ob = { step: 0, name: S.settings.userName || '', callMe: S.settings.callMe || '', about: '', picked: new Set(S.defaultNodes.map((n) => n.id)), team: true, rerun: S.settings.onboarded };
  $('#onboarding').classList.remove('hidden');
  drawOnboarding();
  api.scanCli().then((st) => {
    S = { ...S, ...st };
    if (ob && ob.step === 2) drawOnboarding();
  });
}
function drawOnboarding() {
  const steps = 5;
  const el = $('#onboarding');
  let body = '';
  let foot = '';
  const back = ob.step > 0 ? '<button class="btn ghost" data-ob="back">Back</button>' : '<span></span>';
  if (ob.step === 0) {
    body = `<div class="ob-step ob-hero"><div class="ob-parade">${S.defaultNodes.slice(0, 7).map((n, i) => `<div style="animation-delay:${i * 0.12}s">${av(n, 54).replace('class="node-av', `style="animation-delay:${i * 0.2}s" class="node-av`)}</div>`).join('')}</div>
      <h1 style="font-size:40px">Meet your AI team</h1><p class="lead">Nodes is a team of AI engineers that runs on every model you have: Codex, Claude Code, Gemini, Groq and dozens of free ones. If one can't answer, the next one does.</p>
      <button class="btn primary big" data-ob="next">Get started</button><div style="margin-top:12px;color:var(--faint);font-size:12px">Takes about a minute</div></div>`;
  } else if (ob.step === 1) {
    body = `<div class="ob-step"><h1>First, who are you?</h1><p class="lead">Your nodes will use this to talk to you. It stays on this Mac.</p>
      <div class="ob-form">
        <div class="field"><label>Your name</label><input class="input big" id="ob-name" value="${esc(ob.name)}" placeholder="Name" autofocus></div>
        <div class="field"><label>What should your nodes call you?</label><input class="input big" id="ob-call" value="${esc(ob.callMe)}" placeholder="First name, nickname, anything"></div>
        <div class="field"><label>What do you build? (goes into MEMORY.txt)</label><textarea class="textarea" id="ob-about" rows="3" style="min-height:84px" placeholder="e.g. Mac and iOS apps in SwiftUI, a few Electron apps, some Roblox games">${esc(ob.about)}</textarea></div>
      </div></div>`;
    foot = `${back}<button class="btn primary big" data-ob="next">Continue</button>`;
  } else if (ob.step === 2) {
    const cli = (S.cli || []);
    body = `<div class="ob-step"><h1>Connect your engines</h1><p class="lead">Nodes found these coding agents on your Mac. Sign in to any you pay for, and add free API keys for more. You can change all of this later in Engines.</p>
      <div class="cli-grid">${cli.length ? cli.map((c) => cliCard(c, true)).join('') : '<div class="conv-empty">Scanning your Mac…</div>'}</div>
      <div style="display:flex;justify-content:flex-end;margin:10px 0 0"><button class="btn small ghost" data-ob="rescan">${icon('refresh', 13)}Rescan</button></div>
      <div class="section-title">Free API keys (optional)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${['gemini', 'groq', 'openrouter', 'cerebras'].map(providerById).map((p) => `<div class="cli-card"><div class="top"><div class="li-logo">${esc(p.name.replace(/[^A-Za-z]/g, '').slice(0, 2))}</div><div style="flex:1"><b>${esc(p.name)}</b><span>${p.hasKey ? 'Key saved' : 'Free tier'}</span></div>${p.hasKey ? '<span class="chip green">Ready</span>' : `<button class="btn small ghost" data-href="${esc(p.keyUrl)}">Get key</button>`}</div>${p.hasKey ? '' : `<div class="inline"><input class="input" type="password" data-obkey="${p.id}" placeholder="Paste key"><button class="btn small" data-obsave="${p.id}">Save</button></div>`}</div>`).join('')}</div>
      <p style="color:var(--faint);font-size:12px;margin-top:14px">No keys at all? Nodes still works using Pollinations, a free model that needs no sign-up.</p></div>`;
    foot = `${back}<button class="btn primary big" data-ob="next">Continue</button>`;
  } else if (ob.step === 3) {
    body = `<div class="ob-step"><h1>Pick your team</h1><p class="lead">Each node is a specialist with its own chat. You can add, remove and design your own later.</p>
      <div class="section-title" style="margin-top:0">Engineering</div>
      <div class="ob-team">${S.defaultNodes.map((n) => `<button class="pick ${ob.picked.has(n.id) ? 'sel' : ''}" data-pick="${n.id}">${av(n, 40)}<div><b>${esc(n.name)}</b><span>${esc(n.tagline)}</span></div><span class="check">${ob.picked.has(n.id) ? icon('check', 11) : ''}</span></button>`).join('')}</div>
      <div class="section-title">Business pack <span style="font-weight:400;color:var(--faint)">optional</span></div>
      <div class="ob-team">${(S.businessNodes || []).map((n) => `<button class="pick ${ob.picked.has(n.id) ? 'sel' : ''}" data-pick="${n.id}">${av(n, 40)}<div><b>${esc(n.name)}</b><span>${esc(n.tagline)}</span></div><span class="check">${ob.picked.has(n.id) ? icon('check', 11) : ''}</span></button>`).join('')}</div>
      <div class="set-row" style="border:1px solid var(--line);border-radius:14px;margin-top:14px;background:rgba(255,255,255,.02)"><div class="l" style="display:flex;gap:12px;align-items:center">${teamAvatar([...S.defaultNodes, ...(S.businessNodes || [])].filter((n) => ob.picked.has(n.id)).map((n) => n.avatar), 40)}<div><b>Team chat</b><span>One group chat with every node. The right ones answer, or @mention someone.</span></div></div><div class="r"><button class="toggle ${ob.team ? 'on' : ''}" data-ob="team"></button></div></div></div>`;
    foot = `${back}<button class="btn primary big" data-ob="next" ${ob.picked.size ? '' : 'disabled'}>Continue with ${ob.picked.size} node${ob.picked.size === 1 ? '' : 's'}</button>`;
  } else if (ob.step === 4) {
    const picked = [...S.defaultNodes, ...(S.businessNodes || [])].filter((n) => ob.picked.has(n.id));
    body = `<div class="ob-step ob-hero"><div class="ready-burst">${picked.map((n, i) => av(n, 58).replace('class="node-av', `style="animation-delay:${0.08 * i}s" class="node-av`)).join('')}</div>
      <h1>Your team is ready${ob.callMe || ob.name ? ', ' + esc(ob.callMe || ob.name) : ''}</h1><p class="lead">Each node has said hello in its own chat. Want Nodes on your phone too? Turn it on any time from the phone button in the sidebar.</p>
      <button class="btn primary big" data-ob="finish">Open Nodes</button></div>`;
    foot = `${back}<span></span>`;
  }
  el.innerHTML = `<div class="ob-top">${Array.from({ length: steps }, (_, i) => `<span class="ob-dot ${i === ob.step ? 'on' : i < ob.step ? 'done' : ''}"></span>`).join('')}</div><div class="ob-body">${body}</div><div class="ob-foot">${foot}</div>`;
  const syncForm = () => {
    if ($('#ob-name')) {
      ob.name = $('#ob-name').value.trim();
      ob.callMe = $('#ob-call').value.trim();
      ob.about = $('#ob-about').value.trim();
    }
  };
  $$('[data-ob]', el).forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.ob;
    syncForm();
    if (a === 'next') {
      if (ob.step === 1 && !ob.name) return $('#ob-name').focus();
      ob.step++;
    } else if (a === 'back') ob.step--;
    else if (a === 'team') ob.team = !ob.team;
    else if (a === 'rescan') {
      b.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
      S = { ...S, ...(await api.scanCli()) };
    } else if (a === 'finish') return finishOnboarding();
    drawOnboarding();
  }));
  $$('[data-pick]', el).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.pick;
    ob.picked.has(id) ? ob.picked.delete(id) : ob.picked.add(id);
    drawOnboarding();
  }));
  $$('[data-obsave]', el).forEach((b) => b.addEventListener('click', async () => {
    const v = $(`[data-obkey="${b.dataset.obsave}"]`, el).value.trim();
    if (!v) return;
    S = { ...S, ...(await api.setKey(b.dataset.obsave, v)) };
    drawOnboarding();
    toast('Key saved');
  }));
  bindCli(el, () => drawOnboarding());
  $('#ob-name', el)?.focus();
  $('#ob-name', el)?.addEventListener('keydown', (e) => e.key === 'Enter' && $('#ob-call').focus());
}
async function finishOnboarding() {
  S.settings = await api.updateSettings({ userName: ob.name, callMe: ob.callMe || ob.name, onboarded: true });
  if (ob.about) {
    let t = (await api.getMemory()).text;
    t = t.replace(/## My projects and stack\n/, `## My projects and stack\n${ob.about}\n`);
    await api.setMemory(t);
    memoryText = t;
  }
  if (!ob.rerun) {
    const keep = [...S.defaultNodes, ...(S.businessNodes || [])].filter((n) => ob.picked.has(n.id)).map((n) => ({ ...n, builtIn: true }));
    S.nodes = await api.setAllNodes(keep);
    const convs = [];
    const now = Date.now();
    keep.forEach((n, i) => {
      convs.push({ id: uid(), kind: 'node', title: '', nodeIds: [n.id], pinned: null, fallback: true, web: !!n.web, folder: '', allowEdits: false, messages: [{ ...greetingMsg(n.id), ts: now - (i + 1) * 60000 }], createdAt: now, updatedAt: now - (i + 1) * 60000 });
    });
    if (ob.team) convs.unshift({ id: uid(), kind: 'team', title: 'Team', nodeIds: keep.map((n) => n.id), pinned: null, fallback: true, web: false, folder: '', allowEdits: false, messages: [{ ...teamGreeting(), ts: now }], createdAt: now, updatedAt: now });
    S.conversations = convs;
    await api.saveAllConversations(convs);
    currentId = convs[0].id;
  }
  ob = null;
  $('#onboarding').classList.add('hidden');
  $('#app').classList.remove('hidden');
  view = 'chat';
  render();
}

// Start once every script (extras, agent, team) has loaded, so their overrides are in place.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
