/* Nodes: your team (named nodes from role templates, several of the same role), team chats
   from templates, the Apps page (GitHub, Google, Docker) and the onboarding. */
'use strict';

ICONS.apps = '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>';
const CATS = ['Build', 'Content', 'Business', 'Research'];
const FRIENDLY = ['Sam', 'Riley', 'Alex', 'Maya', 'Leo', 'Nora', 'Kai', 'Ava', 'Theo', 'Iris', 'Milo', 'Zara', 'Finn', 'Luna', 'Ezra', 'Ruby', 'Jude', 'Isla'];
const roleOf = (id) => (S.roles || []).find((r) => r.role === id);
function freeName(roleId, taken) {
  const r = roleOf(roleId);
  const used = new Set(taken.map((x) => x.toLowerCase()));
  if (r && !used.has(r.title.toLowerCase())) return r.title;
  return FRIENDLY.find((n) => !used.has(n.toLowerCase())) || `${r ? r.title : 'Node'} ${taken.length + 1}`;
}
const roleAv = (r, size) => nodeAvatar(r.avatar, size);
const andList = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

// ---------------- Nodes page ----------------
window.renderNodes = function (main) {
  const teams = S.conversations.filter((c) => c.kind === 'team');
  main.innerHTML = `${topbar('<h1>Nodes</h1>')}
    <div class="page"><div class="page-inner">
      <div class="page-head"><div><h2>Your team</h2><p>Nodes are agents that work on your computer. Name them, add as many as you like (even several of the same role), and group them into teams.</p></div>
        <div style="display:flex;gap:8px"><button class="btn" id="new-team">${icon('users', 15)}New team</button><button class="btn primary" id="add-node">${icon('plus', 15)}Add a node</button></div></div>
      ${S.nodes.length ? `<div class="node-grid">${S.nodes.map((n) => `<div class="node-card" data-node="${n.id}">
        <div class="row">${av(n, 48)}<div style="min-width:0"><h3>${esc(n.name)}</h3><div class="tag">${esc(n.title && n.title !== n.name ? n.title + ' · ' + (n.category || '') : n.category || '')}</div></div></div>
        <p class="tag" style="margin:0">${esc(n.tagline)}</p>
        <div class="actions"><button class="btn small primary" data-chat="${n.id}">${icon('chat', 13)}Message</button><button class="btn small" data-edit="${n.id}">${icon('edit', 13)}Edit</button><button class="btn small ghost" data-dup="${n.id}" title="Add another ${esc(n.title || '')}">${icon('plus', 13)}</button></div>
      </div>`).join('')}</div>` : `<div class="card card-pad" style="text-align:center;padding:40px">No nodes yet. <button class="btn primary" id="add-node-2" style="margin-left:10px">${icon('plus', 14)}Add your first node</button></div>`}
      <div class="section-title"><span>Your teams</span></div>
      ${teams.length ? `<div class="team-cards">${teams.map((t) => `<button class="team-card" data-open="${t.id}"><div class="stack">${t.nodeIds.slice(0, 5).map((id) => av(nodeById(id), 30)).join('')}</div><b>${esc(convTitle(t))}</b><span>${t.nodeIds.map((id) => nodeById(id).name).join(', ')}</span></button>`).join('')}</div>` : '<div class="sub" style="color:var(--muted);font-size:13.5px">No teams yet. Start one from a template below or build your own.</div>'}
      <div class="section-title"><span>Team templates</span></div>
      <div class="team-cards">${(S.teams || []).map((t) => `<button class="team-card tpl" data-tpl="${t.id}"><div class="stack">${t.roles.map((r) => roleAv(roleOf(r), 30)).join('')}</div><b>${esc(t.name)}</b><span>${esc(t.tagline)} · ${t.roles.map((r) => roleOf(r).title).join(', ')}</span></button>`).join('')}</div>
    </div></div>`;
  $$('[data-chat]', main).forEach((b) => b.addEventListener('click', () => openNodeChat(b.dataset.chat)));
  $$('[data-edit]', main).forEach((b) => b.addEventListener('click', () => editNode(nodeById(b.dataset.edit))));
  $$('[data-dup]', main).forEach((b) => b.addEventListener('click', async () => {
    const n = nodeById(b.dataset.dup);
    const name = await promptModal(`Another ${n.title || n.name}`, 'Name', freeName(n.role, S.nodes.map((x) => x.name)));
    if (name && name.trim()) await addNode(n.role, name.trim());
  }));
  $$('[data-open]', main).forEach((b) => b.addEventListener('click', () => openConv(b.dataset.open)));
  $$('[data-tpl]', main).forEach((b) => b.addEventListener('click', () => createTeamFromTemplate(b.dataset.tpl)));
  $('#add-node', main).addEventListener('click', () => addNodeModal());
  $('#add-node-2', main)?.addEventListener('click', () => addNodeModal());
  $('#new-team', main).addEventListener('click', () => newTeamModal());
};

async function addNode(role, name, { open = false, quiet = false } = {}) {
  const r = await api.createNode(role, name);
  S.nodes = r.nodes;
  const c = newConversation({ kind: 'node', nodeIds: [r.node.id] });
  c.messages.push(greetingMsg(r.node.id));
  persist(c);
  for (const t of S.conversations.filter((x) => x.kind === 'team' && x.allNodes)) if (!t.nodeIds.includes(r.node.id)) (t.nodeIds.push(r.node.id), persist(t));
  if (!quiet) toast(`${name} joined your team`);
  if (open) openConv(c.id);
  else render();
  return r.node;
}

function addNodeModal() {
  let cat = 'All';
  const draw = () => {
    const roles = (S.roles || []).filter((r) => cat === 'All' || r.category === cat);
    const m = modal('Add a node', 'Pick a role and give it a name. You can add the same role more than once.', `
      <div class="seg">${['All', ...CATS].map((c) => `<button class="${c === cat ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
      <div class="role-grid">${roles.map((r) => {
        const count = S.nodes.filter((n) => n.role === r.role).length;
        return `<button class="role" data-role="${r.role}">${roleAv(r, 40)}<div><b>${esc(r.title)}</b><span>${esc(r.tagline)}</span></div>${count ? `<em>${count} on team</em>` : ''}</button>`;
      }).join('')}</div>`, '', 'wide');
    $$('[data-cat]', m).forEach((b) => b.addEventListener('click', () => ((cat = b.dataset.cat), draw())));
    $$('[data-role]', m).forEach((b) => b.addEventListener('click', async () => {
      const role = b.dataset.role;
      const name = await promptModal(`New ${roleOf(role).title}`, 'What should it be called?', freeName(role, S.nodes.map((x) => x.name)));
      if (name && name.trim()) await addNode(role, name.trim(), { open: true });
    }));
  };
  draw();
}

async function createTeamFromTemplate(id) {
  const t = (S.teams || []).find((x) => x.id === id);
  if (!t) return;
  const members = [];
  for (const role of t.roles) {
    let n = S.nodes.find((x) => x.role === role);
    if (!n) n = await addNode(role, freeName(role, S.nodes.map((x) => x.name)), { quiet: true });
    members.push(n.id);
  }
  const c = newConversation({ kind: 'team', nodeIds: members, title: t.name, renamed: true });
  c.messages.push({ id: uid(), role: 'ai', nodeId: members[0], content: `Hi ${callMe()}! The ${t.name} team is here: ${andList(members.map((m) => nodeById(m).name))}. Ask anything, or @mention one of us.`, greeting: true, ts: Date.now() });
  persist(c);
  toast(`${t.name} team created`);
  openConv(c.id);
}

function newTeamModal() {
  const sel = new Set();
  let name = '';
  const draw = () => {
    const m = modal('New team', 'A group chat with the nodes you pick. The right ones answer, or @mention someone.', `
      <input class="input big" id="tm-name" placeholder="Team name, e.g. Launch crew" value="${esc(name)}">
      <div class="pick-grid">${S.nodes.map((n) => `<button class="pick ${sel.has(n.id) ? 'sel' : ''}" data-n="${n.id}">${av(n, 34)}<div><b>${esc(n.name)}</b><span>${esc(n.title || n.tagline)}</span></div><span class="check">${sel.has(n.id) ? icon('check', 11) : ''}</span></button>`).join('')}</div>`,
      `<span class="sub" style="color:var(--muted);font-size:12.5px">${sel.size} selected</span><div class="right"><button class="btn primary" id="tm-go" ${sel.size < 2 ? 'disabled' : ''}>Create team</button></div>`);
    $('#tm-name', m).addEventListener('input', (e) => (name = e.target.value));
    $$('[data-n]', m).forEach((b) => b.addEventListener('click', () => ((sel.has(b.dataset.n) ? sel.delete(b.dataset.n) : sel.add(b.dataset.n)), draw())));
    $('#tm-go', m).addEventListener('click', () => {
      closeLayer();
      const c = newConversation({ kind: 'team', nodeIds: [...sel], title: name.trim() || 'Team', renamed: true });
      c.messages.push({ id: uid(), role: 'ai', nodeId: [...sel][0], content: `Hey ${callMe()}! ${andList([...sel].map((x) => nodeById(x).name))} here. What are we working on?`, greeting: true, ts: Date.now() });
      persist(c);
      openConv(c.id);
    });
  };
  draw();
}

window.openTeam = function () {
  const t = S.conversations.filter((c) => c.kind === 'team').sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (t) return openConv(t.id);
  if (S.nodes.length < 2) return addNodeModal();
  newTeamModal();
};

window.openNewChat = (function (base) {
  return function (mode = 'node') {
    if (mode !== 'node') return base(mode);
    if (!S.nodes.length) return addNodeModal();
    const m = modal('New chat', 'Who do you want to talk to?', `<div class="pick-grid">${S.nodes.map((n) => `<button class="pick" data-n="${n.id}">${av(n, 36)}<div><b>${esc(n.name)}</b><span>${esc(n.title || n.tagline)}</span></div></button>`).join('')}
      <button class="pick" data-new><div class="li-logo" style="width:36px;height:36px">${icon('plus', 16)}</div><div><b>Add a node</b><span>From 25 roles</span></div></button></div>`);
    $$('[data-n]', m).forEach((b) => b.addEventListener('click', () => {
      closeLayer();
      const c = newConversation({ kind: 'node', nodeIds: [b.dataset.n] });
      c.messages.push(greetingMsg(b.dataset.n));
      persist(c);
      openConv(c.id);
    }));
    $('[data-new]', m).addEventListener('click', () => addNodeModal());
  };
})(window.openNewChat);

// ---------------- Apps page ----------------
async function renderApps(main) {
  main.innerHTML = `${topbar('<h1>Apps</h1>')}<div class="page"><div class="page-inner"><div class="conv-empty">Loading…</div></div></div>`;
  const st = await api.appsState();
  const conn = st.connected;
  const info = st.info || {};
  const logo = { github: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.08 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>', google: '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8Z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8Z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4Z"/></svg>' };
  const row = (c) => {
    const on = conn[c.id];
    const who = c.id === 'github' ? info.github?.login && '@' + info.github.login : info.google?.email;
    return `<div class="li"><div class="li-row"><div class="li-logo" style="background:#1f1e1b">${logo[c.id]}</div><div class="li-main"><div class="li-name">${esc(c.name)} ${on ? '<span class="chip green">Connected</span>' : ''}</div><div class="li-sub">${esc(on && who ? `${who} · ` : '')}${esc(c.blurb)}</div></div>${c.soon ? '<span class="chip">Coming soon</span>' : on ? `<button class="btn small ghost danger" data-disc="${c.id}">Disconnect</button>` : `<button class="btn small primary" data-conn="${c.id}">Sign in</button>`}</div></div>`;
  };
  main.innerHTML = `${topbar('<h1>Apps</h1>')}<div class="page"><div class="page-inner">
    <div class="page-head"><div><h2>Apps</h2><p>Sign in once and your nodes can work with your accounts. Anything that sends, posts or changes something asks you first.</p></div></div>
    <div class="list">${st.connectors.map(row).join('')}</div>
    <div class="section-title"><span>Localhost previews</span></div>
    <div class="list"><div class="li"><div class="li-row"><div class="li-logo" style="background:#1d63ed;color:#fff">${icon('cpu', 18)}</div><div class="li-main"><div class="li-name">Docker ${st.docker.installed ? (st.docker.running ? '<span class="chip green">Running</span>' : '<span class="chip amber">Installed, not running</span>') : '<span class="chip">Not installed</span>'}</div><div class="li-sub">${st.docker.running && st.docker.version ? `Version ${esc(st.docker.version)}. ` : ''}Nodes runs projects with a Dockerfile or compose file in Docker, and serves plain sites with its own built-in server.</div></div>${st.docker.installed ? '' : '<button class="btn small" data-href="https://www.docker.com/products/docker-desktop/">Get Docker</button>'}</div></div>
    ${(st.previews || []).map((p) => `<div class="li"><div class="li-row"><div class="li-main"><div class="li-name">${esc(p.dir.split(/[\\/]/).pop())} <span class="chip">${p.kind}</span></div><div class="li-sub">${esc(p.url)}</div></div><button class="btn small" data-src-url="${esc(p.url)}">Open</button></div></div>`).join('')}</div>
  </div></div>`;
  $$('[data-disc]', main).forEach((b) => b.addEventListener('click', async () => {
    await api.appsToken(b.dataset.disc, '');
    renderApps(main);
  }));
  $$('[data-conn]', main).forEach((b) => b.addEventListener('click', () => connectApp(b.dataset.conn, st.connectors.find((c) => c.id === b.dataset.conn), () => renderApps(main))));
}
async function connectApp(id, c, done) {
  if (id === 'github') return connectGithub(done);
  if (id !== 'google') return toast('Coming soon');
  toast('Finish signing in with Google in your browser');
  const r = await api.appsGoogle();
  if (r.ok) toast('Connected ' + (r.info?.email || 'Google'));
  else toast(r.error || 'Sign-in failed');
  done && done();
}
async function connectGithub(done) {
  const r = await api.appsGithubStart();
  if (!r.ok) return toast(r.error || 'Could not reach GitHub');
  navigator.clipboard.writeText(r.userCode).catch(() => {});
  const m = modal('Sign in with GitHub', 'GitHub opened in your browser. Paste this code there to connect.', `<div class="gh-code">${esc(r.userCode)}</div><div class="gh-wait">Waiting for GitHub…</div>`, `<button class="btn ghost" data-copy>Copy code</button><div class="right"><button class="btn" data-open>Open GitHub again</button></div>`);
  let open = true;
  $('[data-copy]', m).addEventListener('click', () => (navigator.clipboard.writeText(r.userCode), toast('Code copied')));
  $('[data-open]', m).addEventListener('click', () => api.openExternal ? api.openExternal(r.url) : window.open(r.url));
  $('[data-close]', m).addEventListener('click', () => ((open = false), api.appsGithubCancel()));
  const res = await api.appsGithubWait();
  if (!open) return;
  closeLayer();
  toast(res.ok ? 'Connected @' + (res.info?.login || 'GitHub') : res.error || 'Sign-in failed');
  done && done();
}
window.renderMain = (function (base) {
  return function () {
    if (view === 'apps') return renderApps($('#main'));
    return base();
  };
})(window.renderMain);

// ---------------- Onboarding ----------------
window.startOnboarding = function () {
  closeLayer();
  ob = { step: 0, name: S.settings.userName || '', callMe: S.settings.callMe || '', about: '', picks: [], teams: [], cat: 'All', rerun: S.settings.onboarded };
  $('#onboarding').classList.remove('hidden');
  drawOnboarding();
  api.scanCli().then((st) => {
    S = { ...S, ...st };
    if (ob && ob.step === 3) drawOnboarding();
  });
};
const OB_STEPS = ['Welcome', 'You', 'Team', 'Engines', 'Ready'];
window.drawOnboarding = function () {
  const el = $('#onboarding');
  let body = '';
  let next = 'Continue';
  let canNext = true;
  const s = ob.step;
  if (s === 0) {
    const parade = (S.roles || []).slice(0, 9);
    body = `<div class="obx-hero">
      <div class="obx-parade">${parade.map((r, i) => `<span style="--d:${i * 0.09}s">${roleAv(r, 58)}</span>`).join('')}</div>
      <h1>Your AI team,<br>on your computer.</h1>
      <p>Nodes are agents that build, write, research and run errands for you, on any AI you have: Codex, Claude Code, Gemini and 20+ free models.</p></div>`;
    next = 'Get started';
  } else if (s === 1) {
    body = `<div class="obx-head"><h2>Nice to meet you</h2><p>Your nodes use this to talk to you. It stays on this computer.</p></div>
      <div class="obx-form">
        <label>Your name<input class="input big" id="ob-name" value="${esc(ob.name)}" placeholder="Name"></label>
        <label>What should your nodes call you?<input class="input big" id="ob-call" value="${esc(ob.callMe)}" placeholder="Nickname, first name, anything"></label>
        <label>What do you work on? <em>optional</em><textarea class="textarea" id="ob-about" rows="3" placeholder="e.g. I run a small coffee brand and build our website and app myself.">${esc(ob.about)}</textarea></label>
      </div>`;
    canNext = !!ob.name;
  } else if (s === 2) {
    const roles = (S.roles || []).filter((r) => ob.cat === 'All' || r.category === ob.cat);
    body = `<div class="obx-head"><h2>Build your team</h2><p>Tap roles to add them. Add the same one twice if you want two, and rename anyone. You can change this any time.</p></div>
      <div class="obx-teams">${(S.teams || []).map((t) => `<button class="obx-tchip ${ob.teams.includes(t.id) ? 'on' : ''}" data-team="${t.id}"><span class="stack">${t.roles.slice(0, 4).map((r) => roleAv(roleOf(r), 20)).join('')}</span>${esc(t.name)}</button>`).join('')}</div>
      <div class="obx-tray ${ob.picks.length ? '' : 'empty'}">${ob.picks.length ? ob.picks.map((p, i) => `<div class="obx-pick">${roleAv(roleOf(p.role), 30)}<input value="${esc(p.name)}" data-pname="${i}" spellcheck="false"><button data-prm="${i}" title="Remove">${icon('x', 12)}</button></div>`).join('') : 'Nobody yet. Pick a team above or tap roles below.'}</div>
      <div class="seg" style="margin:4px 0 12px">${['All', ...CATS].map((c) => `<button class="${c === ob.cat ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
      <div class="role-grid">${roles.map((r) => {
        const n = ob.picks.filter((p) => p.role === r.role).length;
        return `<button class="role ${n ? 'sel' : ''}" data-role="${r.role}">${roleAv(r, 40)}<div><b>${esc(r.title)}</b><span>${esc(r.tagline)}</span></div>${n ? `<em>×${n}</em>` : `<i>${icon('plus', 14)}</i>`}</button>`;
      }).join('')}</div>`;
    canNext = ob.picks.length > 0;
    next = ob.picks.length ? `Continue with ${ob.picks.length} node${ob.picks.length === 1 ? '' : 's'}` : 'Add at least one node';
  } else if (s === 3) {
    const cli = S.cli || [];
    body = `<div class="obx-head"><h2>Connect your AIs</h2><p>Nodes uses the coding agents you already pay for, plus free models. Sign in to any you have; skip the rest.</p></div>
      <div class="cli-grid">${cli.length ? cli.map((c) => cliCard(c, true)).join('') : '<div class="conv-empty">Looking for AIs on your computer…</div>'}</div>
      <div class="section-title"><span>Free API keys <em style="font-weight:400;color:var(--faint)">optional</em></span><button class="btn small ghost" data-ob="rescan">${icon('refresh', 13)}Rescan</button></div>
      <div class="obx-keys">${['gemini', 'groq', 'openrouter', 'cerebras'].map(providerById).filter(Boolean).map((p) => `<div class="cli-card"><div class="top"><div class="li-logo">${esc(p.name.replace(/[^A-Za-z]/g, '').slice(0, 2))}</div><div style="flex:1"><b>${esc(p.name)}</b><span>${p.hasKey ? 'Key saved' : 'Free tier'}</span></div>${p.hasKey ? '<span class="chip green">Ready</span>' : `<button class="btn small ghost" data-href="${esc(p.keyUrl)}">Get key</button>`}</div>${p.hasKey ? '' : `<div class="inline"><input class="input" type="password" data-obkey="${p.id}" placeholder="Paste key"><button class="btn small" data-obsave="${p.id}">Save</button></div>`}</div>`).join('')}</div>
      <p class="obx-fine">No AIs at all? Nodes still works with a free model that needs no sign-up.</p>`;
  } else {
    const picks = ob.picks;
    body = `<div class="obx-hero"><div class="obx-burst">${picks.slice(0, 10).map((p, i) => `<span style="--d:${i * 0.07}s">${roleAv(roleOf(p.role), 60)}</span>`).join('')}</div>
      <h1>${esc(ob.callMe || ob.name || 'Hey')}, meet your team.</h1>
      <p>${esc(picks.map((p) => p.name).join(', '))} ${picks.length === 1 ? 'is' : 'are'} ready. Each has its own chat${picks.length > 1 ? ', and there\'s a group chat for everyone' : ''}.</p></div>`;
    next = 'Open Nodes';
  }
  el.innerHTML = `<div class="obx">
    <div class="obx-top"><div class="obx-progress">${OB_STEPS.map((t, i) => `<span class="${i === s ? 'on' : i < s ? 'done' : ''}">${t}</span>`).join('')}</div></div>
    <div class="obx-body"><div class="obx-card s${s}">${body}</div></div>
    <div class="obx-foot"><div>${s > 0 ? '<button class="btn ghost" data-ob="back">Back</button>' : ''}</div><div style="display:flex;gap:8px">${s === 3 ? '<button class="btn ghost" data-ob="next">Skip</button>' : ''}<button class="btn primary big" data-ob="${s === 4 ? 'finish' : 'next'}" ${canNext ? '' : 'disabled'}>${esc(next)}</button></div></div>
  </div>`;
  const sync = () => {
    if ($('#ob-name')) {
      ob.name = $('#ob-name').value.trim();
      ob.callMe = $('#ob-call').value.trim();
      ob.about = $('#ob-about').value.trim();
    }
    $$('[data-pname]', el).forEach((i) => (ob.picks[+i.dataset.pname].name = i.value.trim() || ob.picks[+i.dataset.pname].name));
  };
  $('#ob-name', el)?.addEventListener('input', () => {
    ob.name = $('#ob-name').value.trim();
    $('.obx-foot .btn.primary').disabled = !ob.name;
  });
  $$('[data-ob]', el).forEach((b) => b.addEventListener('click', async () => {
    sync();
    const a = b.dataset.ob;
    if (a === 'next') ob.step++;
    else if (a === 'back') ob.step--;
    else if (a === 'rescan') {
      b.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
      S = { ...S, ...(await api.scanCli()) };
    } else if (a === 'finish') return finishOnboarding();
    drawOnboarding();
  }));
  $$('[data-cat]', el).forEach((b) => b.addEventListener('click', () => (sync(), (ob.cat = b.dataset.cat), drawOnboarding())));
  $$('[data-role]', el).forEach((b) => b.addEventListener('click', () => {
    sync();
    ob.picks.push({ role: b.dataset.role, name: freeName(b.dataset.role, ob.picks.map((p) => p.name)) });
    drawOnboarding();
  }));
  $$('[data-prm]', el).forEach((b) => b.addEventListener('click', () => (sync(), ob.picks.splice(+b.dataset.prm, 1), drawOnboarding())));
  $$('[data-team]', el).forEach((b) => b.addEventListener('click', () => {
    sync();
    const t = S.teams.find((x) => x.id === b.dataset.team);
    if (ob.teams.includes(t.id)) {
      ob.teams = ob.teams.filter((x) => x !== t.id);
    } else {
      ob.teams.push(t.id);
      for (const r of t.roles) if (!ob.picks.some((p) => p.role === r)) ob.picks.push({ role: r, name: freeName(r, ob.picks.map((p) => p.name)) });
    }
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
};

window.finishOnboarding = async function () {
  S.settings = await api.updateSettings({ userName: ob.name, callMe: ob.callMe || ob.name, onboarded: true });
  if (ob.about) {
    let t = (await api.getMemory()).text;
    t = t.replace(/## My projects and stack\n/, `## My projects and stack\n${ob.about}\n`);
    await api.setMemory(t);
    memoryText = t;
  }
  const now = Date.now();
  const convs = ob.rerun ? [...S.conversations] : [];
  const created = [];
  for (const p of ob.picks) {
    const r = await api.createNode(p.role, p.name);
    S.nodes = r.nodes;
    created.push(r.node);
  }
  created.forEach((n, i) => {
    convs.push({ id: uid(), kind: 'node', title: '', nodeIds: [n.id], pinned: null, fallback: true, web: true, folder: '', messages: [{ ...greetingMsg(n.id), ts: now - (i + 1) * 60000 }], createdAt: now, updatedAt: now - (i + 1) * 60000 });
  });
  const teamConv = (title, ids, allNodes) => ({ id: uid(), kind: 'team', title, renamed: true, allNodes, nodeIds: ids, pinned: null, fallback: true, web: true, folder: '', messages: [{ id: uid(), role: 'ai', nodeId: ids[0], content: `Hi ${ob.callMe || ob.name}! The ${title} team is here: ${andList(ids.map((x) => created.find((c) => c.id === x)?.name).filter(Boolean))}. Ask anything and the right one of us will answer, or @mention someone.`, greeting: true, ts: now }], createdAt: now, updatedAt: now });
  for (const tid of ob.teams) {
    const t = S.teams.find((x) => x.id === tid);
    const ids = t.roles.map((r) => created.find((c) => c.role === r)?.id).filter(Boolean);
    if (ids.length > 1) convs.unshift(teamConv(t.name, ids, false));
  }
  if (!ob.teams.length && created.length > 1) convs.unshift(teamConv('Team', created.map((c) => c.id), true));
  S.conversations = convs;
  await api.saveAllConversations(convs);
  currentId = convs[0]?.id || null;
  ob = null;
  $('#onboarding').classList.add('hidden');
  $('#app').classList.remove('hidden');
  view = 'chat';
  render();
};
