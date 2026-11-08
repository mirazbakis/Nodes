/* Nodes — work layer: companies, docs (company wiki), project task boards,
   usage saver, and node cursors in the browser panel. Loaded after team.js. */
'use strict';

Object.assign(ICONS, {
  building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/>',
  pointer: '<path d="M4 3l7 17 2.5-7.5L21 10z"/>',
});

const DEPT_COLORS = {
  engineering: ['#38bdf8', '#6366f1'], content: ['#f472b6', '#a855f7'], marketing: ['#fb923c', '#f43f5e'], studio: ['#2dd4bf', '#3b82f6'],
  sales: ['#facc15', '#f97316'], support: ['#34d399', '#06b6d4'], operations: ['#a3e635', '#22c55e'], founder: ['#f59e0b', '#ef4444'], research: ['#818cf8', '#c084fc'],
};
const deptGrad = (id) => {
  const [a, b] = DEPT_COLORS[id] || ['#4c8dff', '#a855f7'];
  return `linear-gradient(135deg, ${a}, ${b})`;
};
const STAGES = ['Idea', 'Building', 'Launched', 'Growing'];
const companyNodes = (co) => S.nodes.filter((n) => n.companyId === co.id);
let coSel = null;
let docState = null;

// ---------------- routing ----------------
window.renderMain = (function (base) {
  return function () {
    if (view === 'company') return renderCompany($('#main'));
    if (view === 'doc') return renderDoc($('#main'));
    return base();
  };
})(window.renderMain);

// ---------------- company page ----------------
async function renderCompany(main) {
  const cos = S.companies || [];
  if (!cos.length) {
    main.innerHTML = `${topbar('<h1>Company</h1>')}<div class="page"><div class="page-inner">
      <div class="co-hero live-in">
        <div class="co-hero-art">${['engineering', 'content', 'marketing', 'sales', 'operations'].map((d, i) => `<span style="background:${deptGrad(d)};--i:${i}"></span>`).join('')}</div>
        <h2>Run your company with a team of nodes</h2>
        <p>Tell Nodes what you're building. It staffs each department with nodes, sets up their group chats and starts a company wiki they all read and keep up to date.</p>
        <div class="co-hero-points">
          <div>${icon('users', 16)}<b>Departments</b><span>Engineering, Content, Sales and more, each with its own chat</span></div>
          <div>${icon('doc', 16)}<b>Company docs</b><span>Pages your nodes read before working and update as they go</span></div>
          <div>${icon('board', 16)}<b>Projects with boards</b><span>Tasks assigned to nodes, moving from To do to Done</span></div>
        </div>
        <button class="btn primary big" id="co-new">${icon('plus', 15)}Create a company</button>
      </div></div></div>`;
    $('#co-new', main).addEventListener('click', () => companyModal());
    return;
  }
  const co = cos.find((c) => c.id === coSel) || cos[0];
  coSel = co.id;
  const dir = await api.companyDir(co.id);
  const docs = dir ? await api.docsList(dir) : [];
  const people = companyNodes(co);
  const depts = (co.teams || []).map((t) => ({ t: (S.teams || []).find((x) => x.id === t), conv: convById(co.convs?.[t]) })).filter((d) => d.t);
  const projects = S.conversations.filter((c) => c.kind === 'project' && c.members?.some((m) => people.some((p) => p.id === m.nodeId))).sort((a, b) => b.updatedAt - a.updatedAt);
  const initial = esc((co.name || '?').trim()[0].toUpperCase());
  main.innerHTML = `${topbar(`<h1>${esc(co.name)}</h1>`, `${cos.length > 1 ? `<select class="select" id="co-switch" style="height:30px;width:auto">${cos.map((c) => `<option value="${c.id}" ${c.id === co.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}<button class="btn small ghost" id="co-add">${icon('plus', 13)}New company</button>`)}
    <div class="page"><div class="page-inner">
      <div class="co-head live-in">
        <div class="co-mark" style="background:${deptGrad(co.teams?.[0])}">${initial}</div>
        <div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h2>${esc(co.name)}</h2>${co.stage ? `<span class="chip">${esc(co.stage)}</span>` : ''}</div><p>${esc(co.what || 'No description yet.')}</p></div>
        <button class="btn small" id="co-edit">${icon('edit', 13)}Edit</button>
      </div>
      <div class="co-actions live-in" style="--d:1">
        <button data-co="allhands"><span style="background:${deptGrad('founder')}">${icon('users', 17)}</span><b>All-hands chat</b><i>Everyone at ${esc(co.name)}</i></button>
        <button data-co="project"><span style="background:${deptGrad('engineering')}">${icon('board', 17)}</span><b>New project</b><i>A goal, a team, a task board</i></button>
        <button data-co="page"><span style="background:${deptGrad('content')}">${icon('doc', 17)}</span><b>New page</b><i>Add to the company wiki</i></button>
        <button data-co="dept"><span style="background:${deptGrad('support')}">${icon('plus', 17)}</span><b>Add a department</b><i>Staff it with nodes</i></button>
      </div>
      <div class="section-title"><span>Departments</span></div>
      <div class="dept-grid">${depts.map((d, i) => `<button class="dept live-in" style="--d:${i + 2}" data-dept="${d.t.id}"><div class="dept-band" style="background:${deptGrad(d.t.id)}"></div><b>${esc(d.t.name)}</b><span>${esc(d.t.tagline)}</span><div class="stack">${(d.conv?.nodeIds || []).slice(0, 5).map((id) => av(nodeById(id), 24)).join('')}</div></button>`).join('') || '<div class="conv-empty">No departments yet.</div>'}</div>
      <div class="section-title"><span>Company docs</span><button class="btn small ghost" data-co="page">${icon('plus', 13)}New page</button></div>
      <div class="doc-grid">${docs.map((d, i) => `<button class="doc-card live-in" style="--d:${Math.min(i, 8) + 3}" data-doc="${esc(d.name)}"><div class="doc-ic">${icon('doc', 16)}</div><b>${esc(d.name)}</b><span>${esc(d.head.replace(/^#.*$/m, '').replace(/\[( |x|X)\]/g, '').replace(/[#*_>`|-]/g, '').trim().slice(0, 110) || 'Empty page')}</span><i>${timeLabel(d.mtime)}</i></button>`).join('') || '<div class="conv-empty">No pages yet.</div>'}</div>
      <div class="section-title"><span>Projects</span><button class="btn small ghost" data-co="project">${icon('plus', 13)}New project</button></div>
      ${projects.length ? `<div style="display:grid;gap:10px">${projects.map((p) => `<div data-open="${p.id}" class="live-in">${projectCard(p)}</div>`).join('')}</div>` : '<div class="conv-empty">No projects yet. Start one and your nodes split it into tasks.</div>'}
      <div class="section-title"><span>People</span><span class="sub" style="font-size:12px">${people.length} nodes</span></div>
      <div class="people-grid">${people.map((n, i) => `<button class="person live-in" style="--d:${Math.min(i, 10) + 4}" data-person="${n.id}">${av(n, 38)}<b>${esc(n.name)}</b><span>${esc(n.title)}${n.team ? ` · ${esc(n.team)}` : ''}</span></button>`).join('')}</div>
    </div></div>`;
  $('#co-switch', main)?.addEventListener('change', (e) => ((coSel = e.target.value), renderCompany(main)));
  $('#co-add', main).addEventListener('click', () => companyModal());
  $('#co-edit', main).addEventListener('click', () => companyModal(co));
  $$('[data-co]', main).forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.co;
    if (a === 'allhands') openConv(co.convs?.all || ensureAllHands(co));
    else if (a === 'project') newProject();
    else if (a === 'page') newPageModal(co, dir);
    else if (a === 'dept') deptModal(co);
  }));
  $$('[data-dept]', main).forEach((b) => b.addEventListener('click', () => {
    const id = co.convs?.[b.dataset.dept];
    if (id && convById(id)) openConv(id);
  }));
  $$('[data-doc]', main).forEach((b) => b.addEventListener('click', () => openDoc({ dir, name: b.dataset.doc, companyId: co.id })));
  $$('[data-person]', main).forEach((b) => b.addEventListener('click', () => {
    const c = S.conversations.find((x) => x.kind === 'node' && x.nodeIds[0] === b.dataset.person);
    if (c) openConv(c.id);
  }));
  $$('[data-open]', main).forEach((el) => el.addEventListener('click', () => openConv(el.dataset.open)));
  bindProjectCard(main);
}

function ensureAllHands(co) {
  const ids = companyNodes(co).map((n) => n.id);
  const c = newConversation({ kind: 'team', nodeIds: ids, title: `${co.name} all-hands`, renamed: true, companyId: co.id });
  c.messages.push({ id: uid(), role: 'ai', nodeId: ids[0], content: `Welcome to ${co.name}, ${callMe()}! The whole team is here: ${andList(ids.map((id) => nodeById(id).name))}. Tell us what you need, or @mention someone.`, greeting: true, ts: Date.now() });
  persist(c);
  co.convs = { ...(co.convs || {}), all: c.id };
  api.saveCompany(co);
  return c.id;
}

async function staffDepartment(co, teamId) {
  const t = (S.teams || []).find((x) => x.id === teamId);
  if (!t) return;
  const members = [];
  for (const role of t.roles) {
    let n = S.nodes.find((x) => x.companyId === co.id && x.role === role);
    if (!n) {
      const used = new Set(S.nodes.map((x) => x.name.toLowerCase()));
      const human = [...FRIENDLY, 'Noah', 'Mia', 'Omar', 'Lena', 'Hugo', 'Elif', 'Kemal', 'Asha', 'Jonah', 'Sana', 'Remy', 'Talia'].find((nm) => !used.has(nm.toLowerCase()));
      const r = await api.createNode(role, human || freeName(role, S.nodes.map((x) => x.name)), null, { companyId: co.id, team: t.name });
      S.nodes = r.nodes;
      n = r.node;
      const c1 = newConversation({ kind: 'node', nodeIds: [n.id] });
      c1.messages.push(greetingMsg(n.id));
      persist(c1);
    }
    members.push(n.id);
  }
  const c = newConversation({ kind: 'team', nodeIds: members, title: `${co.name} · ${t.name}`, renamed: true, companyId: co.id });
  c.messages.push({ id: uid(), role: 'ai', nodeId: members[0], content: `Hi ${callMe()}! ${t.name} at ${co.name} is ready: ${andList(members.map((m) => nodeById(m).name))}. What should we work on first?`, greeting: true, ts: Date.now() });
  persist(c);
  co.convs = { ...(co.convs || {}), [t.id]: c.id };
  if (!co.teams.includes(t.id)) co.teams.push(t.id);
}

function companyModal(edit) {
  const st = edit ? { ...edit, teams: [...(edit.teams || [])] } : { name: '', what: '', audience: '', stage: '', goals: '', voice: '', teams: [] };
  const draw = () => {
    const sync = () => {
      for (const k of ['name', 'what', 'audience', 'goals', 'voice']) if ($('#co-' + k)) st[k] = $('#co-' + k).value;
    };
    const m = modal(edit ? 'Edit company' : 'Create a company', edit ? 'Your nodes read this before they work.' : 'Describe it once. Every node in the company works with this in mind.', `
      <input class="input big" id="co-name" placeholder="Company name" value="${esc(st.name)}">
      <div class="field"><label>What it does</label><input class="input" id="co-what" placeholder="e.g. A booking app for independent barbers" value="${esc(st.what)}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>Customers</label><input class="input" id="co-audience" placeholder="Who it's for" value="${esc(st.audience)}"></div>
        <div class="field"><label>Stage</label><div class="seg">${STAGES.map((s) => `<button class="${st.stage === s ? 'on' : ''}" data-stage="${s}">${s}</button>`).join('')}</div></div>
      </div>
      <div class="field"><label>Goals right now</label><textarea class="textarea" id="co-goals" rows="2" style="min-height:58px" placeholder="e.g. Launch in March, reach 500 paying shops">${esc(st.goals)}</textarea></div>
      <div class="field"><label>Brand voice <span style="color:var(--faint);font-weight:400">optional</span></label><input class="input" id="co-voice" placeholder="e.g. Friendly, plain English, no hype" value="${esc(st.voice)}"></div>
      ${edit ? '' : `<div class="field"><label>Departments</label><div class="dept-pick">${(S.teams || []).map((t) => `<button class="${st.teams.includes(t.id) ? 'on' : ''}" data-team="${t.id}" style="--g:${deptGrad(t.id)}"><i></i><b>${esc(t.name)}</b><span>${t.roles.length} nodes · ${esc(t.tagline)}</span></button>`).join('')}</div></div>`}`,
      `${edit ? '<button class="btn ghost danger" id="co-del">Delete company</button>' : `<span class="sub" style="font-size:12.5px;color:var(--muted)">${st.teams.length ? `${new Set(st.teams.flatMap((id) => (S.teams.find((t) => t.id === id) || { roles: [] }).roles)).size} nodes will join` : 'Pick at least one department'}</span>`}<div class="right"><button class="btn" data-c>Cancel</button><button class="btn primary" id="co-go">${edit ? 'Save' : 'Create company'}</button></div>`, 'wide');
    const redraw = (fn) => () => (sync(), fn(), draw());
    $$('[data-stage]', m).forEach((b) => b.addEventListener('click', redraw(() => (st.stage = st.stage === b.dataset.stage ? '' : b.dataset.stage))));
    $$('[data-team]', m).forEach((b) => b.addEventListener('click', redraw(() => {
      const id = b.dataset.team;
      st.teams = st.teams.includes(id) ? st.teams.filter((x) => x !== id) : [...st.teams, id];
    })));
    $('[data-c]', m).addEventListener('click', closeLayer);
    $('#co-del', m)?.addEventListener('click', async () => {
      if (!confirm(`Delete ${edit.name}? Its nodes and chats stay; the company and its links are removed. Pages stay in ~/Nodes.`)) return;
      const r = await api.deleteCompany(edit.id);
      S.companies = r.companies;
      S.nodes = r.nodes;
      closeLayer();
      coSel = null;
      render();
    });
    $('#co-go', m).addEventListener('click', async () => {
      sync();
      if (!st.name.trim()) return $('#co-name').focus();
      if (!edit && !st.teams.length) return toast('Pick at least one department');
      closeLayer();
      if (edit) {
        const r = await api.saveCompany({ ...edit, ...st, name: st.name.trim() });
        S.companies = r.companies;
        return render();
      }
      const co = { id: 'co-' + uid(), name: st.name.trim(), what: st.what.trim(), audience: st.audience.trim(), stage: st.stage, goals: st.goals.trim(), voice: st.voice.trim(), teams: [], convs: {}, createdAt: Date.now() };
      toast(`Setting up ${co.name}…`);
      let r = await api.saveCompany(co);
      for (const t of st.teams) await staffDepartment(co, t);
      ensureAllHands(co);
      r = await api.saveCompany(co);
      S.companies = r.companies;
      await seedDocs(co, r.dir);
      coSel = co.id;
      celebrate();
      toast(`${co.name} is ready with ${companyNodes(co).length} nodes`);
      setView('company');
    });
    setTimeout(() => !st.name && $('#co-name')?.focus(), 30);
  };
  draw();
}

function deptModal(co) {
  const left = (S.teams || []).filter((t) => !co.teams.includes(t.id));
  if (!left.length) return toast('Every department is already set up');
  const m = modal('Add a department', `New nodes join ${esc(co.name)} with their own group chat.`, `<div class="dept-pick">${left.map((t) => `<button data-team="${t.id}" style="--g:${deptGrad(t.id)}"><i></i><b>${esc(t.name)}</b><span>${t.roles.length} nodes · ${esc(t.tagline)}</span></button>`).join('')}</div>`, '');
  $$('[data-team]', m).forEach((b) => b.addEventListener('click', async () => {
    closeLayer();
    await staffDepartment(co, b.dataset.team);
    const all = convById(co.convs?.all);
    if (all) for (const n of companyNodes(co)) if (!all.nodeIds.includes(n.id)) (all.nodeIds.push(n.id), persist(all));
    const r = await api.saveCompany(co);
    S.companies = r.companies;
    toast('Department added');
    render();
  }));
}

async function seedDocs(co, dir) {
  if (!dir) return;
  const lines = [`# ${co.name}`, '', co.what || '', ''];
  if (co.audience) lines.push(`**Customers:** ${co.audience}`, '');
  if (co.stage) lines.push(`**Stage:** ${co.stage}`, '');
  lines.push('## Team', '', ...companyNodes(co).map((n) => `- **${n.name}**${n.name !== n.title ? `, ${n.title}` : ''}${n.team ? ` (${n.team})` : ''}`), '');
  await api.docsWrite(dir, 'Company overview', lines.join('\n'));
  if (co.goals) await api.docsWrite(dir, 'Goals', `# Goals\n\n${co.goals.split(/\n|,\s*(?=[A-Z])/).map((g) => `- [ ] ${g.trim()}`).join('\n')}\n`);
  if (co.voice) await api.docsWrite(dir, 'Brand voice', `# Brand voice\n\n${co.voice}\n\n## Do\n\n- \n\n## Don't\n\n- \n`);
}

// ---------------- docs (company wiki) ----------------
const PAGE_TEMPLATES = [
  { id: 'blank', name: 'Blank page', ic: 'doc', body: '' },
  { id: 'meeting', name: 'Meeting notes', ic: 'users', body: '## Attendees\n\n- \n\n## Notes\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] ' },
  { id: 'spec', name: 'Product spec', ic: 'target', body: '## Problem\n\n\n## Who it\'s for\n\n\n## Goals\n\n- \n\n## Non-goals\n\n- \n\n## Requirements\n\n- [ ] \n\n## Open questions\n\n- ' },
  { id: 'sop', name: 'How we do it (SOP)', ic: 'check', body: '## When to use this\n\n\n## Steps\n\n1. \n2. \n3. \n\n## Owner\n\n' },
  { id: 'weekly', name: 'Weekly update', ic: 'activity', body: '## Wins\n\n- \n\n## Numbers\n\n| Metric | This week | Last week |\n|---|---|---|\n|  |  |  |\n\n## Next week\n\n- [ ] \n\n## Blockers\n\n- ' },
  { id: 'persona', name: 'Customer profile', ic: 'user', body: '## Who they are\n\n\n## What they need\n\n- \n\n## What they say\n\n> \n\n## Where to find them\n\n- ' },
  { id: 'okrs', name: 'Goals & OKRs', ic: 'zap', body: '## Objective\n\n\n### Key results\n\n- [ ] \n- [ ] \n- [ ] ' },
  { id: 'launch', name: 'Launch checklist', ic: 'megaphone', body: '## Before\n\n- [ ] \n\n## Launch day\n\n- [ ] \n\n## After\n\n- [ ] ' },
];
function newPageModal(co, dir) {
  const people = companyNodes(co);
  let tpl = 'blank';
  const draw = () => {
    const m = modal('New page', 'Start from a template, or have a node write it.', `
      <input class="input big" id="pg-title" placeholder="Page title">
      <div class="tpl-pick">${PAGE_TEMPLATES.map((t) => `<button class="${t.id === tpl ? 'on' : ''}" data-tpl="${t.id}">${icon(t.ic, 15)}${esc(t.name)}</button>`).join('')}</div>
      ${people.length ? `<div class="field"><label>Or have a node write it</label><div class="pick-row">${people.slice(0, 12).map((n) => `<button data-writer="${n.id}" title="${esc(n.title)}">${av(n, 26)}<span>${esc(n.name)}</span></button>`).join('')}</div></div>` : ''}`,
      `<span></span><div class="right"><button class="btn" data-c>Cancel</button><button class="btn primary" id="pg-go">Create page</button></div>`);
    $$('[data-tpl]', m).forEach((b) => b.addEventListener('click', () => {
      const v = $('#pg-title', m).value;
      tpl = b.dataset.tpl;
      draw();
      $('#pg-title').value = v || (tpl === 'blank' ? '' : PAGE_TEMPLATES.find((t) => t.id === tpl).name);
    }));
    $('[data-c]', m).addEventListener('click', closeLayer);
    const title = () => ($('#pg-title', m).value.trim() || PAGE_TEMPLATES.find((t) => t.id === tpl).name).replace(/[\\/:*?"<>|]/g, '-');
    $('#pg-go', m).addEventListener('click', async () => {
      const name = title();
      const t = PAGE_TEMPLATES.find((x) => x.id === tpl);
      await api.docsWrite(dir, name, `# ${name}\n\n${t.body}`);
      closeLayer();
      openDoc({ dir, name, companyId: co.id, editing: true });
    });
    $$('[data-writer]', m).forEach((b) => b.addEventListener('click', () => {
      const name = title();
      const t = PAGE_TEMPLATES.find((x) => x.id === tpl);
      closeLayer();
      askNodeAbout(b.dataset.writer, `Write the "${name}" page for our company wiki${tpl !== 'blank' ? ` using a ${t.name.toLowerCase()} layout` : ''}. Ask me anything you need first, then save it as Docs/${name}.md.`);
    }));
    setTimeout(() => $('#pg-title')?.focus(), 30);
  };
  draw();
}
function askNodeAbout(nodeId, text) {
  let c = S.conversations.find((x) => x.kind === 'node' && x.nodeIds[0] === nodeId);
  if (!c) {
    c = newConversation({ kind: 'node', nodeIds: [nodeId] });
    persist(c);
  }
  openConv(c.id);
  setTimeout(() => {
    const t = $('#input');
    if (!t) return;
    t.value = text;
    t.dispatchEvent(new Event('input'));
    t.focus();
  }, 60);
}
async function openDoc(d) {
  docState = { ...d, text: await api.docsRead(d.dir, d.name) };
  if (docState.editing == null) docState.editing = !docState.text.replace(/^#.*$/m, '').trim();
  setView('doc');
}
let docSaveT = null;
async function renderDoc(main) {
  if (!docState) return setView('company');
  const d = docState;
  const co = (S.companies || []).find((c) => c.id === d.companyId);
  const pages = await api.docsList(d.dir);
  const people = co ? companyNodes(co) : [];
  const body = d.text.replace(/^# .*\n+/, '');
  main.innerHTML = `${topbar(`<button class="btn small ghost" id="doc-back">${icon('back', 14)}${esc(co ? co.name : 'Back')}</button>`, `<div class="seg"><button class="${d.editing ? '' : 'on'}" data-mode="read">Read</button><button class="${d.editing ? 'on' : ''}" data-mode="edit">Edit</button></div><button class="btn small" id="doc-ask">${icon('sparkles', 13)}Ask a node</button><button class="icon-btn" id="doc-more">${icon('more', 16)}</button>`)}
    <div class="page doc-page"><div class="doc-side">${pages.map((p) => `<button class="${p.name === d.name ? 'on' : ''}" data-page="${esc(p.name)}">${icon('doc', 13)}<span>${esc(p.name)}</span></button>`).join('')}<button class="doc-add" id="doc-new">${icon('plus', 13)}<span>New page</span></button></div>
    <div class="doc-main live-in">
      <input class="doc-title" id="doc-title" value="${esc(d.name)}" spellcheck="false">
      <div class="doc-meta">${icon('folder', 12)} Docs/${esc(d.name)}.md · your nodes read and update these pages</div>
      ${d.editing ? `<textarea class="doc-edit" id="doc-text" placeholder="Write in Markdown. # headings, - lists, - [ ] checklists, | tables |">${esc(body)}</textarea>` : `<div class="doc-read md">${body.trim() ? renderMarkdown(body) : '<p style="color:var(--faint)">Empty page. Click Edit to write, or Ask a node to fill it in.</p>'}</div>`}
    </div></div>`;
  $('#doc-back', main).addEventListener('click', () => setView('company'));
  $$('[data-mode]', main).forEach((b) => b.addEventListener('click', () => ((d.editing = b.dataset.mode === 'edit'), renderDoc(main))));
  $$('[data-page]', main).forEach((b) => b.addEventListener('click', () => openDoc({ dir: d.dir, name: b.dataset.page, companyId: d.companyId })));
  $('#doc-new', main).addEventListener('click', () => co && newPageModal(co, d.dir));
  const save = () => api.docsWrite(d.dir, d.name, `# ${d.name}\n\n${$('#doc-text') ? $('#doc-text').value : body}`);
  const ta = $('#doc-text', main);
  if (ta) {
    const fit = () => ((ta.style.height = 'auto'), (ta.style.height = Math.max(320, ta.scrollHeight) + 'px'));
    fit();
    ta.addEventListener('input', () => {
      fit();
      d.text = `# ${d.name}\n\n${ta.value}`;
      clearTimeout(docSaveT);
      docSaveT = setTimeout(save, 500);
    });
    ta.focus();
  }
  // Checklists in read mode are tickable.
  $$('.doc-read input[type=checkbox]', main).forEach((cb, i) => {
    cb.disabled = false;
    cb.addEventListener('change', () => {
      let n = -1;
      d.text = d.text.replace(/^(\s*[-*] )\[( |x|X)\]/gm, (all, pre, mark) => (++n === i ? `${pre}[${cb.checked ? 'x' : ' '}]` : all));
      api.docsWrite(d.dir, d.name, d.text);
    });
  });
  $('#doc-title', main).addEventListener('change', async (e) => {
    const nn = e.target.value.trim().replace(/[\\/:*?"<>|]/g, '-');
    if (!nn || nn === d.name) return;
    const text = `# ${nn}\n\n${$('#doc-text') ? $('#doc-text').value : body}`;
    await api.docsWrite(d.dir, nn, text, d.name);
    d.name = nn;
    d.text = text;
    renderDoc(main);
  });
  $('#doc-ask', main).addEventListener('click', (e) => {
    if (!people.length) return toast('Add a department first');
    openMenu(e.currentTarget, people.map((n, i) => `<button class="menu-item" data-i="${i}">${av(n, 20)}<div>${esc(n.name)}<span class="d">${esc(n.title)}</span></div></button>`).join(''), ({ i }) => {
      save();
      askNodeAbout(people[+i].id, `Read Docs/${d.name}.md and `);
    });
  });
  $('#doc-more', main).addEventListener('click', (e) => openMenu(e.currentTarget, `<button class="menu-item" data-a="reveal">${icon('folder', 15)}Show in ${platformName()}</button><button class="menu-item danger" data-a="del">${icon('trash', 15)}Move to Trash</button>`, async ({ a }) => {
    if (a === 'reveal') api.reveal(`${d.dir}/Docs/${d.name}.md`);
    if (a === 'del') {
      await api.docsDelete(d.dir, d.name);
      toast('Page moved to Trash');
      setView('company');
    }
  }));
}
const platformName = () => (S.platform === 'win32' ? 'Explorer' : 'Finder');

// ---------------- project task boards ----------------
const normTask = (t) => t.toLowerCase().replace(/\*\*|`/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function syncTasks(conv, msg) {
  if (!msg || !msg.content) return;
  conv.tasks = conv.tasks || [];
  const names = (conv.members || []).map((m) => ({ id: m.nodeId, name: nodeById(m.nodeId).name.toLowerCase() }));
  let changed = false;
  for (const line of msg.content.split('\n')) {
    const mm = line.match(/^\s*[-*]\s*\[( |x|X)\]\s+(.+?)\s*$/);
    if (!mm) continue;
    let text = mm[2];
    let assignee = null;
    const at = text.match(/\(?@([\w .'-]+?)\)?\s*$/);
    if (at) {
      const who = names.find((n) => n.name === at[1].trim().toLowerCase());
      if (who) assignee = who.id;
      text = text.slice(0, at.index).trim();
    }
    text = text.replace(/\*\*/g, '').replace(/[.;]$/, '').trim();
    if (!text) continue;
    const key = normTask(text);
    const done = mm[1] !== ' ';
    const ex = conv.tasks.find((t) => normTask(t.text) === key);
    if (ex) {
      if (done && ex.status !== 'done') (ex.status = 'done'), (ex.doneAt = Date.now()), (changed = true);
      if (assignee && !ex.assignee) (ex.assignee = assignee), (changed = true);
    } else {
      conv.tasks.push({ id: uid(), text, assignee: assignee || (done ? msg.nodeId : null), status: done ? 'done' : 'todo', by: msg.nodeId, at: Date.now() });
      changed = true;
    }
  }
  if (changed) persist(conv);
}
window.runReply = (function (base) {
  return async function (conv, nodeId, opts = {}) {
    if (conv.kind === 'project') {
      opts = { ...opts, roomNote: (opts.roomNote || '') + `\nTask board: list work as a Markdown checklist, one task per line, like "- [ ] Write the pricing page (@Name)" with the teammate who should do it. When you finish a task, repeat it ticked: "- [x] Write the pricing page". The board in the app updates from these lines.` };
      for (const t of conv.tasks || []) if (t.assignee === nodeId && t.status === 'todo') t.status = 'doing';
      if (conv.id === currentId && view === 'chat') renderThread();
    }
    const res = await base(conv, nodeId, opts);
    if (conv.kind === 'project') {
      const last = [...conv.messages].reverse().find((m) => m.role === 'ai' && m.nodeId === nodeId);
      syncTasks(conv, last);
      if (conv.id === currentId && view === 'chat') renderThread();
    }
    return res;
  };
})(window.runReply);

const COLS = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];
function boardHtml(conv) {
  const tasks = conv.tasks || [];
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const members = (conv.members || []).map((m) => nodeById(m.nodeId));
  return `<div class="board" data-board="${conv.id}">
    <div class="board-head"><b>${icon('board', 14)}Task board</b><div class="board-bar"><i style="width:${pct}%"></i></div><span>${done}/${tasks.length} done</span></div>
    <div class="board-cols">${COLS.map(([k, label]) => {
      const list = tasks.filter((t) => t.status === k);
      return `<div class="board-col ${k}"><div class="board-col-head"><span class="dot"></span>${label}<i>${list.length}</i></div>${list.map((t) => {
        const n = t.assignee && nodeById(t.assignee);
        return `<div class="task" data-task="${t.id}" title="Click to move it along">${n ? av(n, 20) : '<i class="task-none"></i>'}<span>${esc(t.text)}</span><button class="icon-btn" data-task-del="${t.id}" title="Remove">${icon('x', 11)}</button></div>`;
      }).join('') || `<div class="board-empty">${k === 'todo' ? 'Nodes add tasks here as they plan' : 'Nothing yet'}</div>`}</div>`;
    }).join('')}</div>
    <form class="board-add" data-board-add="${conv.id}"><input class="input" placeholder="Add a task…"><select class="select">${members.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}<option value="">Anyone</option></select><button class="btn small">${icon('plus', 12)}Add</button></form>
  </div>`;
}
window.projectCard = (function (base) {
  return function (conv) {
    const tasks = conv.tasks || [];
    if (view === 'chat' && conv.id === currentId) return base(conv) + boardHtml(conv);
    if (!tasks.length) return base(conv);
    const done = tasks.filter((t) => t.status === 'done').length;
    return base(conv).replace(/<\/div><\/div>$/, `<div class="board-mini"><div class="board-bar"><i style="width:${Math.round((done / tasks.length) * 100)}%"></i></div><span>${done}/${tasks.length} tasks</span></div></div></div>`);
  };
})(window.projectCard);
window.bindProjectCard = (function (base) {
  return function (root) {
    base(root);
    $$('[data-board]', root).forEach((b) => {
      const conv = convById(b.dataset.board);
      if (!conv) return;
      const redraw = () => (persist(conv), renderThread());
      $$('[data-task]', b).forEach((el) => el.addEventListener('click', (e) => {
        if (e.target.closest('[data-task-del]')) return;
        const t = conv.tasks.find((x) => x.id === el.dataset.task);
        t.status = { todo: 'doing', doing: 'done', done: 'todo' }[t.status];
        if (t.status === 'done') celebrate(el);
        redraw();
      }));
      $$('[data-task-del]', b).forEach((x) => x.addEventListener('click', () => {
        conv.tasks = conv.tasks.filter((t) => t.id !== x.dataset.taskDel);
        redraw();
      }));
      $('[data-board-add]', b).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const text = $('input', f).value.trim();
        if (!text) return;
        conv.tasks = conv.tasks || [];
        conv.tasks.push({ id: uid(), text, assignee: $('select', f).value || null, status: 'todo', by: 'user', at: Date.now() });
        redraw();
      });
    });
  };
})(window.bindProjectCard);

// Business-ready project presets, by role. Missing roles are added to your team automatically.
PROJECT_PRESETS.splice(0, PROJECT_PRESETS.length,
  { name: 'Ship a feature', ids: ['architect', 'engineer', 'tester', 'reviewer'] },
  { name: 'Build an MVP', ids: ['product', 'designer', 'engineer', 'tester'] },
  { name: 'Launch a product', ids: ['marketing', 'writer', 'social', 'seo'] },
  { name: 'Content calendar', ids: ['strategist', 'writer', 'editor', 'social'] },
  { name: 'Sales pipeline', ids: ['researcher', 'sales', 'writer'] },
  { name: 'Investor update', ids: ['chief', 'finance', 'writer'] },
  { name: 'Hire someone', ids: ['hr', 'writer', 'legal'] },
  { name: 'Fix a bug', ids: ['engineer', 'tester'] }
);
// ---------------- usage saver ----------------
window.renderActivity = (function (base) {
  return async function (main) {
    base(main);
    const st = await api.getState();
    S.settings = st.settings;
    const saved = st.saved?.calls || 0;
    const limits = Object.entries(S.usage || st.usage || {}).filter(([, u]) => u && (u.pct != null || u.exhausted));
    const head = $('.page-head', main);
    if (!head) return;
    head.insertAdjacentHTML('afterend', `<div class="saver live-in">
      <div class="saver-ic">${icon('gauge', 20)}</div>
      <div style="flex:1;min-width:0"><b>Usage saver</b><span>Quick questions go to fast, free engines first, so your Codex and Claude Code subscriptions are kept for real work. When an engine runs low, Nodes moves to the next one before you hit the wall.</span></div>
      <div class="saver-num"><b>${saved}</b><span>subscription calls saved</span></div>
      <button class="toggle ${S.settings.saver ? 'on' : ''}" id="saver-t"></button>
    </div>
    ${limits.length ? `<div class="section-title">Plan limits</div><div class="limit-grid">${limits.map(([id, u]) => {
      const pct = u.exhausted ? 0 : Math.round((u.pct || 0) * 100);
      return `<div class="limit"><b>${esc(providerById(id)?.name || id)}</b><div class="board-bar ${pct < 15 ? 'low' : ''}"><i style="width:${pct}%"></i></div><span>${u.exhausted ? 'Out for now, resting' : `${pct}% left${u.kind ? ` · ${esc(u.kind)}` : ''}`}</span></div>`;
    }).join('')}</div>` : ''}`);
    $('#saver-t', main).addEventListener('click', async (e) => {
      S.settings = await api.updateSettings({ saver: !S.settings.saver });
      e.currentTarget.classList.toggle('on', S.settings.saver);
    });
  };
})(window.renderActivity);

// ---------------- node cursors in the browser panel ----------------
const cursors = new Map();
function cursorFor(node) {
  const body = $('#br-body');
  let c = cursors.get(node.id);
  if (!c || !body.contains(c.el)) {
    const color = node.avatar?.bg?.[0] || '#4c8dff';
    const el = document.createElement('div');
    el.className = 'node-cursor';
    el.style.setProperty('--c', color);
    el.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 3l7 17 2.5-7.5L21 10z" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="nc-tag">${av(node, 18)}<span>${esc(node.name)}</span></div>`;
    body.appendChild(el);
    c = { el, x: 40, y: 40, hide: null };
    el.style.transform = `translate(${c.x}px, ${c.y}px)`;
    cursors.set(node.id, c);
  }
  c.el.classList.add('on');
  clearTimeout(c.hide);
  c.hide = setTimeout(() => c.el.classList.remove('on'), 9000);
  return c;
}
function controlBar(node, conv) {
  const body = $('#br-body');
  let bar = $('.br-control', body);
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'br-control';
    body.appendChild(bar);
  }
  bar.innerHTML = `${av(node, 18)}<span><b>${esc(node.name)}</b> is using the browser</span><button>Take over</button>`;
  bar.classList.add('on');
  $('button', bar).onclick = () => (stopAll(conv.id), bar.classList.remove('on'));
  clearTimeout(bar._t);
  bar._t = setTimeout(() => bar.classList.remove('on'), 9000);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOOK_JS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  document.querySelectorAll('[data-nodes-id]').forEach((e) => e.removeAttribute('data-nodes-id'));
  const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [contenteditable=true], summary, label[for]')].filter(vis);
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  els.sort((a, b) => (inView(b) - inView(a)));
  const items = els.slice(0, 90).map((el, i) => {
    el.setAttribute('data-nodes-id', i + 1);
    const tag = el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.name || el.getAttribute('href') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    const kind = tag === 'a' ? 'link' : tag === 'input' ? 'input ' + (el.type || 'text') : tag === 'textarea' ? 'text box' : tag === 'select' ? 'dropdown' : tag === 'button' || el.getAttribute('role') === 'button' ? 'button' : tag;
    return '#' + (i + 1) + ' [' + kind + '] ' + (label || '(no label)') + (inView(el) ? '' : ' (below)');
  });
  const text = (document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 5000);
  return 'URL: ' + location.href + '\\nTitle: ' + document.title + '\\n\\nPage text:\\n' + text + '\\n\\nThings you can click or type into:\\n' + items.join('\\n');
})()`;
const RECT_JS = (n) => `(() => { const el = document.querySelector('[data-nodes-id="${n}"]'); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2, tag: el.tagName }; })()`;
async function browserAct(node, conv, action, a) {
  if (!browserOpen || !wv) {
    if (action === 'look') return 'Nothing is open in the browser panel. Use open_in_browser with a URL first.';
    return 'The browser panel is closed. Open a page with open_in_browser, then browser_look.';
  }
  controlBar(node, conv);
  const cur = cursorFor(node);
  const move = async (x, y) => {
    cur.x = x;
    cur.y = y;
    cur.el.style.transform = `translate(${x}px, ${y}px)`;
    await sleep(650);
  };
  try {
    if (action === 'look') {
      await move(30 + Math.random() * 120, 60 + Math.random() * 80);
      return await wv.executeJavaScript(LOOK_JS);
    }
    if (action === 'scroll') {
      await wv.executeJavaScript(`window.scrollBy({ top: ${a.direction === 'up' ? -1 : 1} * innerHeight * 0.8, behavior: 'smooth' })`);
      await sleep(700);
      return `Scrolled ${a.direction}. Call browser_look to see what's there now.`;
    }
    const r = await wv.executeJavaScript(RECT_JS(Number(a.target)));
    if (!r) return `There's no #${a.target} on the page now. Call browser_look again.`;
    await sleep(250);
    await move(r.x, r.y);
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    cur.el.classList.add('click');
    setTimeout(() => cur.el.classList.remove('click'), 450);
    wv.sendInputEvent({ type: 'mouseMove', x, y });
    wv.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wv.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    if (action === 'click') {
      await sleep(1200);
      return `Clicked #${a.target}. The page is now ${wv.getURL()}. Call browser_look to see it.`;
    }
    await sleep(150);
    await wv.executeJavaScript(`(() => { const el = document.querySelector('[data-nodes-id="${Number(a.target)}"]'); if (el) { el.focus(); if ('value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } } })()`);
    await wv.insertText(String(a.text || ''));
    if (a.submit) {
      await sleep(200);
      wv.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      wv.sendInputEvent({ type: 'char', keyCode: '\r' });
      wv.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await sleep(1300);
    }
    return `Typed into #${a.target}${a.submit ? ' and pressed Enter' : ''}. Call browser_look to check the result.`;
  } catch (e) {
    return 'Browser error: ' + (e.message || e);
  }
}
window.onChatEvent = (function (base) {
  return function (ev) {
    if (ev.type === 'browser') {
      const job = jobs.get(ev.reqId);
      const conv = job && convById(job.convId);
      if (!job || !conv) return api.agentReply(ev.id, 'The chat is gone.');
      browserAct(nodeById(job.msg.nodeId), conv, ev.action, ev.args || {}).then((r) => api.agentReply(ev.id, r));
      return;
    }
    return base(ev);
  };
})(window.onChatEvent);

// ---------------- liveliness ----------------
function celebrate(anchor) {
  const host = document.body;
  const r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, width: 0, height: 0 };
  const colors = ['#ff8a4c', '#f472b6', '#a855f7', '#38bdf8', '#34d399', '#facc15'];
  for (let i = 0; i < (anchor ? 14 : 36); i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.left = r.left + r.width / 2 + 'px';
    p.style.top = r.top + r.height / 2 + 'px';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', (Math.random() - 0.5) * (anchor ? 160 : 520) + 'px');
    p.style.setProperty('--dy', -(Math.random() * (anchor ? 90 : 260) + 40) + 'px');
    p.style.setProperty('--r', Math.random() * 720 - 360 + 'deg');
    host.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }
}
// Projects finishing get a little celebration.
window.toast = (function (base) {
  return function (text) {
    if (/ is done$/.test(text || '')) celebrate();
    return base(text);
  };
})(window.toast);
