/* Nodes — projects, library, automations, palette, usage warnings, privacy */
'use strict';

// ---------------- usage warnings ----------------
const usageToastAt = {};
function handleUsage(ev) {
  S.usage = S.usage || {};
  const prev = S.usage[ev.provider] || {};
  S.usage[ev.provider] = ev.exhausted ? { ...prev, exhausted: true, reason: ev.reason, at: Date.now(), pct: 0 } : { ...prev, exhausted: false, pct: ev.pct, remaining: ev.remaining, limit: ev.limit, kind: ev.kind, at: Date.now() };
  if (!S.settings.usageWarnings) return;
  if (Date.now() - (usageToastAt[ev.provider] || 0) < 10 * 60000) return;
  usageToastAt[ev.provider] = Date.now();
  const name = providerById(ev.provider)?.name || ev.provider;
  toast(ev.exhausted ? `${name} has hit its usage limit. Nodes is switching to other engines.` : `${name} is running low: ${Math.round(ev.pct * 100)}% of its ${ev.kind || 'quota'} left`);
  if (view === 'chat') drawUsageBanner();
}
function lowEngines() {
  const out = [];
  for (const [id, u] of Object.entries(S.usage || {})) {
    if (!u || Date.now() - (u.at || 0) > 6 * 3600000) continue;
    if (u.exhausted || (u.pct != null && u.pct < 0.15)) out.push({ id, name: providerById(id)?.name || id, ...u });
  }
  return out;
}
function drawUsageBanner() {
  const wrap = $('.composer-wrap');
  if (!wrap || !S.settings.usageWarnings) return;
  wrap.querySelector('.usage-warn')?.remove();
  const conv = current();
  const relevant = lowEngines().filter((u) => !conv || !conv.pinned || conv.pinned.provider === u.id || u.exhausted);
  if (!relevant.length) return;
  const u = relevant[0];
  const text = u.exhausted ? `<b>${esc(u.name)}</b> has hit its usage limit. Your nodes will use other engines until it resets.` : `<b>${esc(u.name)}</b> is running low: ${Math.round(u.pct * 100)}% of its ${esc(u.kind || 'quota')} left (${fmtK(u.remaining)} of ${fmtK(u.limit)}).`;
  wrap.insertAdjacentHTML('afterbegin', `<div class="usage-warn">${icon('alert', 14)}<span>${text}${relevant.length > 1 ? ` <span style="color:var(--faint)">+${relevant.length - 1} more</span>` : ''}</span><button class="icon-btn" data-dismiss-usage="${u.id}" title="Dismiss">${icon('x', 13)}</button></div>`);
  wrap.querySelector('[data-dismiss-usage]').addEventListener('click', async (e) => {
    S.usage = await api.clearUsage(e.currentTarget.dataset.dismissUsage);
    drawUsageBanner();
  });
}

// ---------------- projects (multi-node relay) ----------------
function projectMembers(conv) {
  if (conv.kind === 'pair') return [{ key: 'a', nodeId: conv.nodeIds[0], pinned: conv.pair.a, label: engineLabel(conv.pair.a) }, { key: 'b', nodeId: conv.nodeIds[0], pinned: conv.pair.b, label: engineLabel(conv.pair.b) }];
  return conv.members.map((m) => ({ key: m.nodeId, nodeId: m.nodeId, pinned: m.engine || null, label: nodeById(m.nodeId).name }));
}
async function runRelay(conv) {
  const members = projectMembers(conv);
  const rounds = conv.kind === 'pair' ? conv.pair.rounds : conv.rounds || 3;
  const isPair = conv.kind === 'pair';
  const roster = members.map((m, i) => `${i + 1}. ${m.label}${isPair ? '' : ` (${nodeById(m.nodeId).tagline})`}${m.pinned ? ` on ${engineLabel(m.pinned)}` : ''}`).join('\n');
  conv.status = 'running';
  conv.messages.push({ id: uid(), role: 'banner', content: isPair ? `Pair session · ${members[0].label} builds, ${members[1].label} reviews and continues` : `Round robin · ${members.map((m) => m.label).join(' → ')}`, ts: Date.now() });
  let doneStreak = 0;
  let turns = 0;
  let finished = false;
  outer: for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < members.length; i++) {
      const me = members[i];
      const next = members[(i + 1) % members.length];
      const first = r === 0 && i === 0 && !conv.messages.some((m) => m.side && m.content);
      let note = isPair
        ? `You are pairing with ${next.label} (another AI) to finish ${callMe()}'s task. You both see the whole log. ` +
          (i === 0 ? `You lead the build: do the next concrete chunk of real work, then end with a short "Progress" section: what you did, what's left, what your partner should check.` : `You are the partner: check the latest progress critically, fix what's wrong, do the next part yourself, then end with a short "Progress" section for your partner.`)
        : `You are ${me.label} on the project "${conv.title}". Goal: ${conv.goal}\nThe project team, taking turns in this order:\n${roster}\n` +
          (first ? `You go first: break the goal into a short plan with a task for each team member, then start on your own part.` : `It's your turn. Read the log, then do your part of the work as ${me.label}: build, fix or check what falls in your specialty. Don't redo others' work unless it's wrong.`) +
          ` End with "## Handoff to ${next.label}": what you did, what's left, and exactly what you need from them.`;
      note += ` When the whole task is complete and checked, put [DONE] alone on the last line. Never say [DONE] while anything is left.`;
      if (conv.folder) note += ` Work in the project folder ${conv.folder}${conv.allowEdits ? ' (you may edit files there)' : ' (read-only: propose changes as diffs)'}.`;
      const res = await runReply(conv, me.nodeId, { pinned: me.pinned, side: me.key, label: me.label, roomNote: note, noFallback: !!conv.pairStrict });
      turns++;
      conv.turns = (conv.turns || 0) + 1;
      if (res === 'stopped') {
        conv.messages.push({ id: uid(), role: 'banner', content: 'Stopped', ts: Date.now() });
        conv.status = 'paused';
        break outer;
      }
      if (res !== 'ok') {
        conv.status = 'blocked';
        break outer;
      }
      const last = conv.messages[conv.messages.length - 1];
      if (/\[DONE\]\s*$/.test(last.content || '')) {
        doneStreak++;
        if (doneStreak >= Math.min(2, members.length)) {
          finished = true;
          break outer;
        }
      } else doneStreak = 0;
    }
  }
  if (finished) {
    conv.status = 'done';
    conv.messages.push({ id: uid(), role: 'banner', content: `Done · ${turns} turns`, ts: Date.now() });
    toast(`${conv.title || 'Project'} is done`);
  } else if (conv.status === 'running') {
    conv.status = 'paused';
    conv.messages.push({ id: uid(), role: 'banner', content: `Paused after ${rounds} round${rounds === 1 ? '' : 's'} · send a message or press Continue to keep going`, ts: Date.now() });
  }
  persist(conv);
  if (conv.id === currentId && view === 'chat') renderThread();
  renderSidebar();
}

const STATUS = { running: ['Working', 'blue'], paused: ['Paused', 'amber'], done: ['Done', 'green'], blocked: ['Needs attention', 'red'], new: ['Not started', ''] };
function projectCard(conv) {
  const [label, color] = STATUS[conv.status || 'new'];
  const busy = isBusy(conv.id);
  return `<div class="project-card card">
    <div style="display:flex;gap:14px;align-items:flex-start">
      <div class="stack" style="padding-top:2px">${conv.members.slice(0, 5).map((m) => av(nodeById(m.nodeId), 30)).join('')}</div>
      <div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center"><h3 style="margin:0">${esc(conv.title)}</h3><span class="chip ${color}">${busy ? 'Working' : label}</span></div>
        <div class="sub" style="margin-top:3px">${esc(conv.goal || '')}</div>
        <div class="pc-meta">${conv.folder ? `<span>${icon('folder', 12)}${esc(conv.folder.split('/').pop())}</span>` : ''}<span>${icon('users', 12)}${conv.members.map((m) => esc(nodeById(m.nodeId).name)).join(' → ')}</span><span>${icon('route', 12)}${conv.turns || 0} turns</span></div></div>
      ${conv.status !== 'done' && !busy ? `<button class="btn small primary" data-continue="${conv.id}">${icon('zap', 13)}${conv.turns ? 'Continue' : 'Start'}</button>` : busy ? `<button class="btn small" data-stop="${conv.id}">${icon('stop', 12)}Stop</button>` : ''}
    </div></div>`;
}
function bindProjectCard(root) {
  $$('[data-continue]', root).forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = convById(b.dataset.continue);
      if (!c || isBusy(c.id)) return;
      if (!c.messages.some((m) => m.role === 'user')) c.messages.push({ id: uid(), role: 'user', content: `Project goal: ${c.goal}`, ts: Date.now() });
      if (view === 'chat') renderThread();
      runRelay(c);
    })
  );
  $$('[data-stop]', root).forEach((b) => b.addEventListener('click', (e) => (e.stopPropagation(), stopAll(b.dataset.stop))));
}

function renderProjects(main) {
  const projects = S.conversations.filter((c) => c.kind === 'project').sort((a, b) => b.updatedAt - a.updatedAt);
  main.innerHTML = `${topbar('<h1>Projects</h1>', `<button class="btn small primary" id="np">${icon('plus', 13)}New project</button>`)}
    <div class="page"><div class="page-inner">
      <div class="page-head"><div><h2>Projects</h2><p>Give a goal to a team of nodes. They take turns, each one doing its part and handing its progress to the next, until the work is done. Point them at a folder and coding agents can build it for real.</p></div></div>
      ${projects.length ? `<div style="display:grid;gap:10px">${projects.map((p) => `<div data-open="${p.id}">${projectCard(p)}</div>`).join('')}</div>` : `<div class="card card-pad" style="text-align:center;padding:50px 20px"><div style="display:flex;justify-content:center;margin-bottom:14px" class="stack">${S.nodes.slice(0, 4).map((n) => av(n, 44)).join('')}</div><h3 style="font-size:16px">No projects yet</h3><div class="sub" style="margin:4px 0 16px">For example: Architect plans, Engineer builds, Tester writes tests, Reviewer signs off.</div><button class="btn primary" id="np2">${icon('plus', 14)}Start a project</button></div>`}
      <div class="section-title">Pair mode</div>
      <div class="card card-pad" style="display:flex;gap:14px;align-items:center">${pairAvatar(40)}<div style="flex:1"><h3>Pair two engines</h3><div class="sub">Two AIs, such as Codex and Gemini CLI, pass progress back and forth on one task.</div></div><button class="btn" id="pp">${icon('route', 14)}New pair</button></div>
    </div></div>`;
  $('#np', main).addEventListener('click', () => newProject());
  $('#np2', main)?.addEventListener('click', () => newProject());
  $('#pp', main).addEventListener('click', () => openNewChat('pair'));
  $$('[data-open]', main).forEach((el) => el.addEventListener('click', () => openConv(el.dataset.open)));
  bindProjectCard(main);
}

const PROJECT_PRESETS = [
  { name: 'Ship a feature', ids: ['architect', 'engineer', 'tester', 'reviewer'] },
  { name: 'Fix a bug', ids: ['debugger', 'engineer', 'tester'] },
  { name: 'Security pass', ids: ['security', 'engineer', 'reviewer'] },
  { name: 'Launch', ids: ['pm', 'marketing', 'docs'] },
  { name: 'Full stack app', ids: ['architect', 'backend', 'frontend', 'devops', 'tester'] },
];
function newProject() {
  const pickRole = (role) => {
    const co = typeof coSel !== 'undefined' && (S.companies || []).find((c) => c.id === coSel);
    return (co && S.nodes.find((n) => n.companyId === co.id && n.role === role)) || S.nodes.find((n) => n.role === role);
  };
  let def = [...new Set(['architect', 'engineer', 'tester', 'reviewer'].map(pickRole).filter(Boolean))];
  if (!def.length) def = S.nodes.slice(0, 4);
  const st = { title: '', goal: '', folder: S.settings.defaultFolder || '', allowEdits: true, rounds: 3, members: def.map((n) => ({ nodeId: n.id, engine: null })) };
  const targets = [];
  for (const g of engineTargets({ includeUnusable: false })) for (const { p, models } of g.items) if (p.usable) for (const m of models.slice(0, p.kind === 'cli' ? 1 : 4)) targets.push({ provider: p.id, model: m });
  const draw = () => {
    const sync = () => {
      if (!$('#pj-title')) return;
      st.title = $('#pj-title').value;
      st.goal = $('#pj-goal').value;
    };
    const m = modal('New project', 'A team of nodes takes turns on one goal, handing off progress to each other.', `
      <input class="input big" id="pj-title" placeholder="Project name" value="${esc(st.title)}">
      <div class="field"><label>Goal</label><textarea class="textarea" id="pj-goal" rows="3" style="min-height:80px" placeholder="What should exist when they're done? Be specific: features, stack, constraints.">${esc(st.goal)}</textarea></div>
      <div class="field"><label>Quick teams</label><div class="part-row" style="text-transform:none">${PROJECT_PRESETS.map((p, i) => `<button data-preset="${i}">${esc(p.name)}</button>`).join('')}</div></div>
      <div class="field"><label>Team, in turn order</label><div class="engine-list">${st.members.map((mm, i) => {
        const n = nodeById(mm.nodeId);
        return `<div class="engine-item" style="padding:6px">${av(n, 26)}<span class="t" style="padding-left:4px"><b style="font-weight:600">${esc(n.name)}</b> <i>· ${esc(n.tagline)}</i></span>
          <select class="select" style="width:190px;height:28px;font-size:12px" data-eng="${i}"><option value="">Auto engine</option>${targets.map((t) => `<option value="${esc(t.provider + '|' + t.model)}" ${mm.engine && mm.engine.provider === t.provider && mm.engine.model === t.model ? 'selected' : ''}>${esc(engineLabel(t))}</option>`).join('')}</select>
          <button class="icon-btn" data-mup="${i}">${icon('up', 13)}</button><button class="icon-btn" data-mrm="${i}">${icon('x', 13)}</button></div>`;
      }).join('')}</div>
        <select class="select" id="pj-add"><option value="">Add a node…</option>${S.nodes.filter((n) => !st.members.some((x) => x.nodeId === n.id)).map((n) => `<option value="${n.id}">${esc(n.name)} · ${esc(n.tagline)}</option>`).join('')}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>Project folder</label><div class="inline"><button class="btn" id="pj-folder" style="flex:1;justify-content:flex-start;overflow:hidden">${icon('folder', 14)}<span style="overflow:hidden;text-overflow:ellipsis">${esc(st.folder ? st.folder.replace(S.home, '~') : 'Choose…')}</span></button></div></div>
        <div class="field"><label>Rounds before pausing</label><div class="seg">${[1, 2, 3, 5, 8].map((n) => `<button class="${n === st.rounds ? 'on' : ''}" data-r="${n}">${n}</button>`).join('')}</div></div>
      </div>
      ${st.folder ? `<div class="set-row" style="padding:2px 0;border:0"><div class="l"><b>Let coding agents edit files</b><span>Codex, Claude Code and others can change files in the folder</span></div><button class="toggle ${st.allowEdits ? 'on' : ''}" id="pj-edits"></button></div>` : ''}`,
      `<span class="sub" style="color:var(--muted);font-size:12.5px">${st.members.length} nodes · ${st.members.length * st.rounds} turns max</span><div class="right"><button class="btn" data-c>Cancel</button><button class="btn primary" id="pj-go" ${st.members.length ? '' : 'disabled'}>Start project</button></div>`, 'wide');
    const redraw = (fn) => () => {
      sync();
      fn();
      draw();
    };
    $$('[data-preset]', m).forEach((b) => b.addEventListener('click', async () => {
      sync();
      const p = PROJECT_PRESETS[+b.dataset.preset];
      const members = [];
      for (const role of p.ids) {
        let n = pickRole(role);
        if (!n) n = await addNode(role, freeName(role, S.nodes.map((x) => x.name)), { quiet: true });
        if (!members.some((x) => x.nodeId === n.id)) members.push({ nodeId: n.id, engine: null });
      }
      st.members = members;
      if (!st.title) st.title = p.name;
      draw();
    }));
    $$('[data-eng]', m).forEach((s) => s.addEventListener('change', () => {
      const v = s.value;
      st.members[+s.dataset.eng].engine = v ? { provider: v.split('|')[0], model: v.split('|').slice(1).join('|') } : null;
    }));
    $$('[data-mup]', m).forEach((b) => b.addEventListener('click', redraw(() => {
      const i = +b.dataset.mup;
      if (i > 0) [st.members[i - 1], st.members[i]] = [st.members[i], st.members[i - 1]];
    })));
    $$('[data-mrm]', m).forEach((b) => b.addEventListener('click', redraw(() => st.members.splice(+b.dataset.mrm, 1))));
    $('#pj-add', m).addEventListener('change', (e) => e.target.value && redraw(() => st.members.push({ nodeId: e.target.value, engine: null }))());
    $$('[data-r]', m).forEach((b) => b.addEventListener('click', redraw(() => (st.rounds = +b.dataset.r))));
    $('#pj-folder', m).addEventListener('click', async () => {
      sync();
      const f = await api.pickFolder();
      if (f) st.folder = f;
      draw();
    });
    $('#pj-edits', m)?.addEventListener('click', redraw(() => (st.allowEdits = !st.allowEdits)));
    $('[data-c]', m).addEventListener('click', closeLayer);
    $('#pj-go', m).addEventListener('click', () => {
      sync();
      if (!st.goal.trim()) return $('#pj-goal').focus();
      closeLayer();
      const c = newConversation({ kind: 'project', title: st.title.trim() || st.goal.slice(0, 40), goal: st.goal.trim(), nodeIds: st.members.map((x) => x.nodeId), members: st.members, rounds: st.rounds, folder: st.folder, allowEdits: !!st.folder && st.allowEdits, status: 'new', turns: 0 });
      c.messages.push({ id: uid(), role: 'user', content: `Project goal: ${c.goal}`, ts: Date.now() });
      persist(c);
      openConv(c.id);
      runRelay(c);
    });
    setTimeout(() => !st.title && $('#pj-title')?.focus(), 30);
  };
  draw();
}

// ---------------- library (templates) ----------------
const TEMPLATES = [
  { cat: 'Coding', node: 'engineer', title: 'Implement a feature', text: 'Implement this feature end to end:\n\nFeature: \nStack: \nConstraints: \n\nGive me the full code for each file and how to test it.' },
  { cat: 'Coding', node: 'debugger', title: 'Debug an error', text: 'I get this error:\n\n```\n\n```\n\nWhat I was doing: \nWhat I expected: \nRelevant code:\n```\n\n```' },
  { cat: 'Coding', node: 'reviewer', title: 'Review a diff', text: 'Review this diff for bugs, security issues and edge cases. Rank findings by severity.\n\n```diff\n\n```' },
  { cat: 'Coding', node: 'tester', title: 'Write tests', text: 'Write thorough tests for this code, covering edge cases and failure paths. Framework: \n\n```\n\n```' },
  { cat: 'Coding', node: 'architect', title: 'Design a system', text: 'Help me design this system before I build it:\n\nWhat it does: \nUsers / scale: \nMust work with: \n\nGive me options, a recommendation, the data model and the main flows.' },
  { cat: 'Coding', node: 'docs', title: 'Write a README', text: 'Write a README for this project: what it is, install, usage examples, configuration and contributing.\n\nProject details:\n' },
  { cat: 'Coding', node: 'devops', title: 'CI pipeline', text: 'Write a GitHub Actions workflow that builds, tests and releases this project.\n\nLanguage / build tool: \nRelease target: ' },
  { cat: 'Business', node: 'sales', title: 'Cold email sequence', text: 'Write a 3-email cold outreach sequence.\n\nWho I sell to: \nWhat I sell: \nWhy them, why now: \nCall to action: ' },
  { cat: 'Business', node: 'marketing', title: 'Launch plan', text: 'Make a 2-week launch plan for my product with channels, posts and a day-by-day checklist.\n\nProduct: \nAudience: \nBudget: ' },
  { cat: 'Business', node: 'marketing', title: 'App Store listing', text: 'Write an App Store listing: name ideas, subtitle (30 chars), promotional text, description and keywords (100 chars).\n\nApp: ' },
  { cat: 'Business', node: 'finance', title: 'Pricing model', text: 'Help me price my product. Compare 3 pricing models with projected revenue for 100, 1,000 and 10,000 customers.\n\nProduct: \nCosts per customer: \nCompetitors charge: ' },
  { cat: 'Business', node: 'finance', title: 'Cash flow forecast', text: 'Build a 12-month cash flow forecast table with formulas I can paste into a spreadsheet.\n\nStarting cash: \nMonthly revenue: \nGrowth: \nMonthly costs: ' },
  { cat: 'Business', node: 'support', title: 'Reply to a customer', text: 'Draft a reply to this customer. Kind, clear, and with a next step.\n\nTheir message:\n' },
  { cat: 'Business', node: 'legal', title: 'Privacy policy', text: 'Write a plain-English privacy policy for my app.\n\nApp: \nData collected: \nThird parties: \nWhere users are: ' },
  { cat: 'Business', node: 'legal', title: 'Review a contract', text: 'Flag risky or unusual clauses in this agreement and suggest better wording.\n\n' },
  { cat: 'Business', node: 'pm', title: 'One-page spec', text: 'Turn this idea into a one-page spec: problem, users, goals, non-goals, requirements, risks, success metrics.\n\nIdea: ' },
  { cat: 'Business', node: 'analyst', title: 'SQL for a metric', text: 'Write SQL for this metric and explain it.\n\nMetric: \nTables and columns: ' },
  { cat: 'Business', node: 'recruiter', title: 'Job post + interview', text: 'Write a job post and 8 structured interview questions with a scorecard.\n\nRole: \nTeam: \nMust-haves: ' },
  { cat: 'Everyday', node: 'researcher', title: 'Compare options', text: 'Compare these options and recommend one for my situation:\n\nOptions: \nMy situation: ' },
  { cat: 'Everyday', node: 'docs', title: 'Summarise notes', text: 'Summarise these notes into decisions, action items (with owners) and open questions:\n\n' },
];
function renderLibrary(main) {
  const cats = [...new Set(TEMPLATES.map((t) => t.cat))];
  const all = [...S.nodes];
  main.innerHTML = `${topbar('<h1>Library</h1>')}
    <div class="page"><div class="page-inner">
      <div class="page-head"><div><h2>Library</h2><p>Ready-made prompts for coding and running a business. Pick one and it opens with the right node, ready to fill in.</p></div></div>
      ${cats.map((c) => `<div class="section-title">${c}</div><div class="tpl-grid">${TEMPLATES.filter((t) => t.cat === c).map((t) => {
        const n = all.find((x) => x.id === t.node) || [...S.defaultNodes, ...(S.businessNodes || [])].find((x) => x.id === t.node);
        const missing = !S.nodes.some((x) => x.id === t.node);
        return `<button class="tpl" data-tpl="${TEMPLATES.indexOf(t)}">${n ? av(n, 28) : ''}<div><b>${esc(t.title)}</b><span>${esc(n ? n.name : '')}${missing ? ' · not on your team yet' : ''}</span></div></button>`;
      }).join('')}</div>`).join('')}
    </div></div>`;
  $$('[data-tpl]', main).forEach((b) => b.addEventListener('click', () => useTemplate(TEMPLATES[+b.dataset.tpl])));
}
async function useTemplate(t) {
  if (!S.nodes.some((n) => n.id === t.node)) {
    const def = [...S.defaultNodes, ...(S.businessNodes || [])].find((n) => n.id === t.node);
    if (def) {
      S.nodes = await api.saveNode({ ...def, builtIn: true });
      toast(`${def.name} joined your team`);
    }
  }
  openNodeChat(t.node);
  setTimeout(() => {
    const i = $('#input');
    if (!i) return;
    i.value = t.text;
    autosize(i);
    updateSendBtn();
    i.focus();
    const blank = t.text.indexOf(': \n');
    i.setSelectionRange(blank > -1 ? blank + 2 : t.text.length, blank > -1 ? blank + 2 : t.text.length);
  }, 60);
}

// ---------------- automations ----------------
function renderAutomations(main) {
  const list = S.automations || [];
  main.innerHTML = `${topbar('<h1>Automations</h1>', `<button class="btn small primary" id="na">${icon('plus', 13)}New automation</button>`)}
    <div class="page"><div class="page-inner">
      <div class="page-head"><div><h2>Automations</h2><p>Have a node do something on a schedule, like a morning brief, a daily standup summary or a weekly dependency check. Results land in a chat. Runs while Nodes is open.</p></div></div>
      ${list.length ? `<div class="list">${list.map((a, i) => `<div class="li"><div class="li-row">${av(nodeById(a.nodeId), 34)}<div class="li-main"><div class="li-name">${esc(a.name)} ${a.enabled ? '' : '<span class="chip">Off</span>'}</div><div class="li-sub">${esc(nodeById(a.nodeId).name)} · ${a.days === 'weekdays' ? 'Weekdays' : a.days === 'weekly' ? 'Mondays' : 'Every day'} at ${esc(a.time)}${a.web ? ' · with web search' : ''}${a.lastRun ? ' · last ran ' + timeLabel(a.lastRun) : ''}</div></div>
        <button class="btn small ghost" data-run="${i}">${icon('zap', 13)}Run now</button><button class="btn small ghost" data-edit="${i}">${icon('edit', 13)}</button><button class="toggle ${a.enabled ? 'on' : ''}" data-tog="${i}"></button></div></div>`).join('')}</div>`
        : `<div class="card card-pad" style="text-align:center;padding:44px 20px">${icon('zap', 26)}<h3 style="margin-top:12px;font-size:16px">No automations yet</h3><div class="sub" style="margin:4px 0 16px">Try a morning tech brief from Researcher, or a daily "what should I work on" from Product.</div><button class="btn primary" id="na2">${icon('plus', 14)}New automation</button></div>`}
    </div></div>`;
  const save = async (l) => {
    S.automations = await api.setAutomations(l);
    renderAutomations(main);
  };
  $('#na', main).addEventListener('click', () => editAutomation(null));
  $('#na2', main)?.addEventListener('click', () => editAutomation(null));
  $$('[data-tog]', main).forEach((b) => b.addEventListener('click', () => {
    const l = [...list];
    l[+b.dataset.tog] = { ...l[+b.dataset.tog], enabled: !l[+b.dataset.tog].enabled };
    save(l);
  }));
  $$('[data-run]', main).forEach((b) => b.addEventListener('click', () => runAutomation(list[+b.dataset.run], true)));
  $$('[data-edit]', main).forEach((b) => b.addEventListener('click', () => editAutomation(+b.dataset.edit)));
}
function editAutomation(idx) {
  const a = idx == null ? { id: uid(), name: '', nodeId: S.nodes.find((n) => n.id === 'researcher')?.id || S.nodes[0].id, prompt: '', time: '09:00', days: 'daily', web: true, enabled: true } : { ...S.automations[idx] };
  const m = modal(idx == null ? 'New automation' : 'Edit automation', '', `
    <input class="input big" id="au-name" placeholder="Name, e.g. Morning tech brief" value="${esc(a.name)}">
    <div class="field"><label>Node</label><select class="select" id="au-node">${S.nodes.map((n) => `<option value="${n.id}" ${n.id === a.nodeId ? 'selected' : ''}>${esc(n.name)} · ${esc(n.tagline)}</option>`).join('')}</select></div>
    <div class="field"><label>What it should do</label><textarea class="textarea" id="au-prompt" rows="4" style="min-height:90px" placeholder="e.g. Give me a 5-bullet brief of what changed in Swift, Xcode and Apple developer news in the last 24 hours.">${esc(a.prompt)}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label>Time</label><input class="input" type="time" id="au-time" value="${esc(a.time)}"></div>
    <div class="field"><label>Repeat</label><select class="select" id="au-days">${[['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Every Monday']].map(([k, l]) => `<option value="${k}" ${a.days === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="set-row" style="padding:2px 0;border:0"><div class="l"><b>Search the web first</b><span>For briefs and news</span></div><button class="toggle ${a.web ? 'on' : ''}" id="au-web"></button></div>`,
    `<div>${idx != null ? '<button class="btn ghost danger" id="au-del">Delete</button>' : ''}</div><div class="right"><button class="btn" data-c>Cancel</button><button class="btn primary" id="au-save">Save</button></div>`);
  $('#au-web', m).addEventListener('click', (e) => ((a.web = !a.web), e.currentTarget.classList.toggle('on', a.web)));
  $('[data-c]', m).addEventListener('click', closeLayer);
  $('#au-del', m)?.addEventListener('click', async () => {
    S.automations = await api.setAutomations(S.automations.filter((_, i) => i !== idx));
    closeLayer();
    render();
  });
  $('#au-save', m).addEventListener('click', async () => {
    Object.assign(a, { name: $('#au-name').value.trim(), nodeId: $('#au-node').value, prompt: $('#au-prompt').value.trim(), time: $('#au-time').value || '09:00', days: $('#au-days').value });
    if (!a.prompt) return $('#au-prompt').focus();
    if (!a.name) a.name = a.prompt.slice(0, 40);
    const l = [...(S.automations || [])];
    if (idx == null) l.push(a);
    else l[idx] = a;
    S.automations = await api.setAutomations(l);
    closeLayer();
    render();
    toast('Automation saved');
  });
}
async function runAutomation(a, manual) {
  let conv = a.convId && convById(a.convId);
  if (!conv) {
    conv = newConversation({ kind: 'node', nodeIds: [a.nodeId], title: a.name, renamed: true, web: !!a.web });
    a.convId = conv.id;
  }
  conv.web = !!a.web;
  a.lastRun = Date.now();
  S.automations = await api.setAutomations(S.automations.map((x) => (x.id === a.id ? a : x)));
  if (manual) openConv(conv.id);
  await send(a.prompt, conv);
}
function automationTick() {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const day = now.getDay();
  for (const a of S.automations || []) {
    if (!a.enabled || a.time !== hm) continue;
    if (a.days === 'weekdays' && (day === 0 || day === 6)) continue;
    if (a.days === 'weekly' && day !== 1) continue;
    if (a.lastRun && now - a.lastRun < 120000) continue;
    runAutomation(a, false);
  }
}
setInterval(() => S && S.settings.onboarded && automationTick(), 30000);

// ---------------- command palette ----------------
function openPalette() {
  if (!S || !S.settings.onboarded) return;
  const items = [
    ...S.nodes.map((n) => ({ k: 'Message ' + n.name, d: n.tagline, ic: av(n, 20), run: () => openNodeChat(n.id) })),
    { k: 'Team chat', d: 'Every node', ic: icon('users', 16), run: openTeam },
    { k: 'New project', d: 'Nodes work on a goal together', ic: icon('briefcase', 16), run: newProject },
    { k: 'Pair two engines', d: 'Two AIs build together', ic: icon('route', 16), run: () => openNewChat('pair') },
    { k: 'Compare models', d: 'Side by side', ic: icon('sliders', 16), run: () => openNewChat('compare') },
    { k: 'Create a node', d: 'Design your own specialist', ic: icon('plus', 16), run: () => editNode(null) },
    ...[['home', 'Home'], ['projects', 'Projects'], ['nodes', 'Nodes'], ['library', 'Library'], ['automations', 'Automations'], ['engines', 'Engines'], ['activity', 'Activity'], ['settings', 'Settings']].map(([v, l]) => ({ k: 'Go to ' + l, d: '', ic: icon('chevronRight', 16), run: () => setView(v) })),
    { k: 'Edit MEMORY.txt', d: 'What every node knows', ic: icon('memory', 16), run: () => ((settingsTab = 'memory'), setView('settings')) },
    { k: 'Connect phone', d: 'Over Wi-Fi', ic: icon('phone', 16), run: openPhone },
    { k: 'Toggle browser', d: '⌘B', ic: icon('panel', 16), run: () => (browserOpen ? closeBrowser() : openBrowser()) },
    ...TEMPLATES.map((t) => ({ k: 'Template: ' + t.title, d: t.cat, ic: icon('book', 16), run: () => useTemplate(t) })),
    ...[...S.conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40).map((c) => ({ k: convTitle(c), d: 'Chat · ' + timeLabel(c.updatedAt), ic: convAvatar(c, 20), run: () => openConv(c.id) })),
  ];
  let q = '';
  let hi = 0;
  closeLayer();
  $('#layer').innerHTML = `<div class="scrim" style="align-items:start;padding-top:14vh"><div class="palette"><div class="pal-in">${icon('search', 16)}<input id="pal-q" placeholder="Search chats, nodes, actions, templates…" spellcheck="false"><kbd>esc</kbd></div><div class="pal-list" id="pal-list"></div></div></div>`;
  const scrim = $('#layer .scrim');
  scrim.addEventListener('mousedown', (e) => e.target === scrim && closeLayer());
  const input = $('#pal-q');
  const filtered = () => items.filter((i) => !q || (i.k + ' ' + i.d).toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  const draw = () => {
    const f = filtered();
    hi = Math.min(hi, Math.max(0, f.length - 1));
    $('#pal-list').innerHTML = f.length ? f.map((it, i) => `<button class="menu-item ${i === hi ? 'hi' : ''}" data-pi="${i}"><span style="width:20px;display:grid;place-items:center">${it.ic}</span><div style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.k)}</div><span class="sub">${esc(it.d)}</span></button>`).join('') : '<div class="conv-empty">Nothing found</div>';
    $$('[data-pi]').forEach((b) => b.addEventListener('click', () => go(+b.dataset.pi)));
  };
  const go = (i) => {
    const it = filtered()[i];
    closeLayer();
    if (it) it.run();
  };
  input.addEventListener('input', () => ((q = input.value), (hi = 0), draw()));
  input.addEventListener('keydown', (e) => {
    const n = filtered().length;
    if (e.key === 'ArrowDown') (e.preventDefault(), (hi = (hi + 1) % n), draw());
    else if (e.key === 'ArrowUp') (e.preventDefault(), (hi = (hi - 1 + n) % n), draw());
    else if (e.key === 'Enter') (e.preventDefault(), go(hi));
  });
  draw();
  input.focus();
}
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
  }
});

// ---------------- privacy & data settings ----------------
function privacySettings() {
  const s = S.settings;
  const row = (k, t, d) => `<div class="set-row"><div class="l"><b>${t}</b><span>${d}</span></div><div class="r"><button class="toggle ${s[k] ? 'on' : ''}" data-t="${k}"></button></div></div>`;
  return `<div class="set-group">${row('redactSecrets', 'Hide secrets before sending', 'API keys, tokens and private keys in your messages are replaced with [REDACTED SECRET] before they leave this Mac')}${row('localOnly', 'Local-only mode', 'Only use engines running on this Mac (Ollama, LM Studio). Nothing goes to the cloud, and web search is off')}${row('usageWarnings', 'Usage warnings', 'Warn when an engine is running low on quota or has hit its limit')}</div>
    <div class="set-group">
      <div class="set-row"><div class="l"><b>Back up everything</b><span>Chats, nodes, projects, automations, settings and MEMORY.txt. API keys are never included.</span></div><div class="r"><button class="btn small" id="bk-out">${icon('download', 13)}Export…</button></div></div>
      <div class="set-row"><div class="l"><b>Restore from a backup</b><span>Merges into what you have. Nothing is deleted.</span></div><div class="r"><button class="btn small" id="bk-in">Import…</button></div></div>
    </div>
    <div class="callout">${icon('lock', 18)}<div><h4>Where your data lives</h4><p>Chats, nodes and MEMORY.txt are stored only on this Mac. Keys are encrypted with your macOS keychain. Prompts go only to the engine that answers them, and to your search engine when web search is on.</p></div></div>`;
}
function bindPrivacy(main) {
  $('#bk-out', main)?.addEventListener('click', async () => {
    const p = await api.exportBackup();
    if (p) toast('Backup saved');
  });
  $('#bk-in', main)?.addEventListener('click', async () => {
    try {
      if (await api.importBackup()) {
        S = await api.getState();
        render();
        toast('Backup restored');
      }
    } catch (e) {
      toast(String(e.message || e).replace(/^Error invoking remote method[^:]*: (Error: )?/, ''));
    }
  });
}
