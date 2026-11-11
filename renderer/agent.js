/* Nodes: iMessage-style chat, agent tools UI (questions, approvals, reactions, files),
   per-chat thinking and permission controls, named nodes and teams, apps and onboarding.
   Loaded after app.js and extras.js; replaces some of their functions. */
'use strict';

const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
const PERMS = {
  ask: { label: 'Ask me', icon: 'shield', desc: 'Every file change and command asks you first' },
  edit: { label: 'Auto-edit', icon: 'edit', desc: 'Files change freely, commands ask first' },
  plan: { label: 'Plan first', icon: 'memory', desc: 'Nothing changes. You get a plan to approve' },
  full: { label: 'Full trust', icon: 'zap', desc: 'Everything runs without asking' },
};
const THINK = {
  off: { label: 'Quick', desc: 'Answers straight away' },
  low: { label: 'Think a bit', desc: 'Light reasoning, still fast' },
  medium: { label: 'Think', desc: 'Reasons before answering' },
  high: { label: 'Think hard', desc: 'Deepest reasoning, slowest' },
};
const isLower = (t) => /[a-z]/.test(t || '') && t === t.toLowerCase();
function lowerOutsideCode(s) {
  return s.split(/(```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+)/).map((part, i) => (i % 2 ? part : part.toLowerCase())).join('');
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = (new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5;
  const day = diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? d.toLocaleDateString([], { weekday: 'long' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `<b>${day}</b> ${fmtTime(ts)}`;
}
const multi = (conv) => conv.kind !== 'node';
const senderKey = (m) => (m.role === 'user' ? 'me' : m.role === 'banner' || m.role === 'note' ? m.role : (m.side || m.nodeId || '') + (m.groupId || ''));

// ---------------- thread ----------------
window.renderThread = function () {
  const thread = $('#thread');
  if (!thread) return;
  const conv = current();
  if (!conv) return;
  const msgs = conv.messages;
  let html = '';
  if (conv.kind === 'project') html += `<div style="margin-bottom:24px">${projectCard(conv)}</div>`;
  let lastTs = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.groupId) {
      const group = [];
      while (i < msgs.length && msgs[i].groupId === m.groupId) group.push(msgs[i++]);
      i--;
      html += `<div class="im-compare" style="grid-template-columns:repeat(${Math.min(group.length, 3)},minmax(0,1fr))">${group.map((g) => `<div class="card im-cmp" data-mid="${g.id}">${aiInner(g, conv, true)}</div>`).join('')}</div>`;
      continue;
    }
    if (m.ts && m.ts - lastTs > 15 * 60000) html += `<div class="im-time">${dayLabel(m.ts)}</div>`;
    if (m.ts) lastTs = m.ts;
    const prev = msgs[i - 1];
    const next = msgs[i + 1];
    const first = !prev || senderKey(prev) !== senderKey(m) || (m.ts && prev.ts && m.ts - prev.ts > 15 * 60000);
    const last = !next || senderKey(next) !== senderKey(m) || (next.ts && m.ts && next.ts - m.ts > 15 * 60000);
    html += messageHtml(m, conv, i === msgs.length - 1, first, last);
  }
  // Delivered / Read under the last message you sent
  const lastMine = [...msgs].reverse().find((m) => m.role === 'user');
  if (lastMine) {
    const after = msgs.slice(msgs.indexOf(lastMine) + 1).find((m) => m.role === 'ai');
    html = html.replace(`<!--receipt:${lastMine.id}-->`, `<div class="im-receipt">${after ? `Read ${fmtTime(after.ts)}` : 'Delivered'}</div>`);
  }
  if (!msgs.filter((m) => !m.greeting).length && conv.kind !== 'project') {
    const n = nodeById(conv.nodeIds[0]);
    const sugg = conv.kind === 'team' ? ['What can this team do for me?', 'Plan my week', 'Review my landing page', 'Write a launch post'] : (SUGGEST[n.role] || SUGGEST[n.id] || ['What can you do?', 'Help me plan something', 'Look at my project folder', 'Teach me something useful']).slice(0, 4);
    html += `<div class="im-sugg">${sugg.map((s) => `<button class="suggestion">${esc(s)}</button>`).join('')}</div>`;
  }
  thread.innerHTML = html;
  if (conv.kind === 'project') bindProjectCard(thread);
  $$('.suggestion', thread).forEach((b) => b.addEventListener('click', () => (($('#input').value = b.textContent), send())));
  bindMessageActions(thread, conv);
  scrollToBottom();
};

Object.assign(SUGGEST, {
  designer: ['Make me a landing page for a coffee shop', 'Critique my site', 'Pick colours for a fintech app', 'Design a pricing section'],
  chief: ['What needs my attention today?', 'Summarise my unread email', 'What does my week look like?', 'Draft a reply to the last email'],
  writer: ['Write a blog post about remote work', 'Tighten this paragraph', 'Write a product update email', 'Draft a README'],
  strategist: ['Plan a month of content', 'Who is my audience?', 'Ideas for a newsletter', 'Audit my content'],
  social: ['Write 5 posts for our launch', 'Turn this blog into a thread', 'Captions for these photos', 'A posting schedule'],
  seo: ['How do I rank for "coffee beans online"?', 'Audit my homepage SEO', 'Keywords for a SaaS app', 'Write meta descriptions'],
  editor: ['Edit this draft', 'Make this shorter', 'Fact-check this post', 'Fix the tone of this email'],
  video: ['Script a 60-second explainer', 'YouTube titles for my video', 'A hook for a product demo', 'Plan a podcast episode'],
  sales: ['Write a cold email', 'Handle "it\'s too expensive"', 'A follow-up sequence', 'Draft a proposal'],
  marketing: ['Plan our launch', 'Write App Store copy', 'Ideas for growth on a small budget', 'Position us against competitors'],
  support: ['Reply to an angry customer', 'Write a help article', 'A refund policy', 'Common questions to answer'],
  finance: ['Price my product', 'A 12-month forecast', 'Am I profitable?', 'Make an invoice template'],
  legal: ['Write a privacy policy', 'Check this contract', 'Terms of service for an app', 'What is GDPR?'],
  hr: ['Write a job post', 'Interview questions for a designer', 'An onboarding plan', 'A fair salary range'],
  ops: ['Automate this weekly task', 'Write an SOP', 'Which tools should we use?', 'Map our workflow'],
  product: ['Write a spec', 'Prioritise these features', 'Plan an MVP', 'What should we build next?'],
  mobile: ['Build a SwiftUI habit tracker', 'Why does my app crash on launch?', 'App Store review tips', 'Add push notifications'],
  tester: ['Test my project', 'Edge cases for a signup form', 'Write unit tests', 'Find bugs in this code'],
  analyst: ['Analyse this CSV', 'SQL for monthly active users', 'Make a chart of sales', 'What do these numbers mean?'],
  tutor: ['Teach me React', 'Explain how the internet works', 'Quiz me on Spanish', 'Help with my maths'],
});

window.messageHtml = function (m, conv, isLast, first = true, last = true) {
  if (m.role === 'banner') return `<div class="im-time">${esc(m.content)}</div>`;
  if (m.role === 'user') {
    const files = m.files && m.files.length ? `<div class="im-files">${m.files.map((f) => `<span class="file-chip">${icon('memory', 12)}${esc(f.name)}</span>`).join('')}</div>` : '';
    const body = esc(m.content).replace(/@([A-Za-z][\w-]*)/g, (x, n) => (S.nodes.some((nd) => nd.name.replace(/[^\w]/g, '').toLowerCase() === n.toLowerCase()) ? `<span class="mention">${x}</span>` : x));
    return `<div class="im-row me ${first ? 'first' : ''} ${last ? 'last' : ''}" data-mid="${m.id}">
      <div class="im-col">${files}${m.content ? `<div class="bubble me ${last ? 'tail' : ''}" data-bub="${m.id}">${body}${reactionsHtml(m, 'me')}</div>` : ''}
        <div class="im-acts"><button data-act="react" data-mid="${m.id}" title="React">${icon('heart', 13)}</button><button data-act="edit" data-mid="${m.id}" title="Edit and resend">${icon('edit', 13)}</button><button data-act="copy" data-mid="${m.id}" title="Copy">${icon('copy', 13)}</button></div>
      </div></div><!--receipt:${m.id}-->`;
  }
  return `<div class="im-row ai ${first ? 'first' : ''} ${last ? 'last' : ''} ${isLast ? 'newest' : ''}" data-mid="${m.id}">${aiInner(m, conv, false, first, last)}</div>`;
};

function reactionsHtml(m, side) {
  const r = m.reactions || [];
  if (!r.length) return '';
  const seen = [...new Set(r.map((x) => x.emoji))];
  return `<span class="tapbacks ${side}">${seen.map((e) => `<i>${e}</i>`).join('')}</span>`;
}

window.aiInner = function (m, conv, compact, first = true, last = true) {
  const n = nodeById(m.nodeId);
  const job = [...jobs.values()].find((j) => j.msg === m);
  const name = conv.kind === 'compare' ? engineLabel(m.target) : conv.kind === 'pair' ? m.label || engineLabel(conv.pair[m.side]) : n.name;
  const portrait = conv.kind === 'pair' ? pairSideAvatar(m.side, 28) : conv.kind === 'compare' ? '' : av(n, 28);
  const eng = m.meta ? `${m.meta.providerName}${m.meta.model && m.meta.model !== 'default' ? ' · ' + shortModel(m.meta.model) : ''}` : job && job.engine ? job.engine : '';

  const label = (first && (multi(conv) || compact)) ? `<div class="im-name">${esc(name)}${eng && compact ? ` <em>${esc(eng)}</em>` : ''}</div>` : '';
  const notes = [];
  if (m.routing && m.routing.length && S.settings.showRouting) for (const r of m.routing) notes.push(`<div class="im-note warn">${icon('route', 12)}<span><b>${esc(r.providerName)}</b> couldn't answer (${esc(r.reason)}), so the next engine took over</span></div>`);
  const steps = (m.tools || []).filter((t) => !/^Ask\(/.test(t));
  if (steps.length) {
    const shown = steps.slice(-5);
    notes.push(`<div class="im-steps">${steps.length > 5 ? `<div class="st">… ${steps.length - 5} earlier steps</div>` : ''}${shown.map((t, i) => {
      const mm = t.match(/^(\w+)\((.*)\)$/);
      return `<div class="st ${job && i === shown.length - 1 && !m.content ? 'live' : ''}"><span class="dot"></span>${mm ? `<b>${esc(stepVerb(mm[1]))}</b> ${esc(mm[2])}` : esc(t)}</div>`;
    }).join('')}</div>`);
  }
  if (m.reasoningStart && !m.thoughtMs && job) notes.push(`<div class="im-note think" data-think>${icon('brain', 12)}Thinking ${Math.round((Date.now() - m.reasoningStart) / 1000)}s</div>`);
  else if (m.thoughtMs) notes.push(`<div class="im-note think">${icon('brain', 12)}Thought for ${Math.max(1, Math.round(m.thoughtMs / 1000))}s</div>`);

  let bubble = '';
  const cls = `bubble ai ${last && !compact ? 'tail' : ''}`;
  if (m.image) bubble = `<div class="${cls} img"><img class="gen-image" src="${esc(m.image.url)}" alt="${esc(m.image.prompt)}" data-img="${m.id}"></div>`;
  else if (m.error) {
    const list = (m.error.attempts || []).map((x) => `<li><b>${esc(providerById(x.provider)?.name || x.provider)}</b>${x.model && x.model !== 'default' ? ' · ' + esc(shortModel(x.model)) : ''}: ${esc(x.reason)}</li>`).join('');
    bubble = `<div class="error-card"><h4>${icon('alert', 15)}${m.error.noProviders ? 'No engines are ready' : 'No engine could answer'}</h4>${m.error.noProviders ? '<div>Sign in to a coding agent or add a free API key.</div>' : `<ul>${list}</ul>`}<div style="display:flex;gap:8px;margin-top:8px"><button class="btn small" data-act="retry" data-mid="${m.id}">${icon('refresh', 13)}Try again</button><button class="btn small primary" data-goto="engines">${icon('plug', 13)}Set up engines</button></div></div>`;
  } else if (m.content) bubble = `<div class="${cls}" data-bub="${m.id}"><div class="md">${renderMarkdown(m.content.replace(/\n?\[DONE\]\s*$/, ''), { highlight: !job, sources: m.sources })}</div>${reactionsHtml(m, 'ai')}</div>`;
  else if (job && !(m.asks || []).some((a) => a.answer == null) && !(m.approvals || []).some((a) => !a.state)) bubble = `<div class="bubble ai typing ${last ? 'tail' : ''}"><span></span><span></span><span></span></div>`;
  else if (m.stopped) bubble = `<div class="${cls} faint">Stopped.</div>`;

  const cards = [...(m.approvals || []).map((a) => approvalHtml(m, a)), ...(m.asks || []).map((a) => askHtml(m, a))].join('') + (window.assignCardsHtml ? assignCardsHtml(m, conv) : '');
  const files = (m.filesOut || []).length ? `<div class="im-outfiles">${m.filesOut.slice(-8).map((f) => `<button class="file-chip" data-reveal="${esc(f.path)}" title="Show in Finder">${icon('memory', 12)}${esc(f.path.split(/[\\/]/).pop())}<em>${esc(f.action)}</em></button>`).join('')}</div>` : '';
  const sources = m.sources && m.sources.length ? `<div class="sources">${m.sources.slice(0, 6).map((s, i) => `<button class="source" data-src-url="${esc(s.url)}" title="${esc(s.title)}"><img src="https://www.google.com/s2/favicons?sz=32&domain=${esc(hostOf(s.url))}" onerror="this.style.visibility='hidden'"><span>${i + 1}. ${esc(hostOf(s.url))}</span></button>`).join('')}</div>` : '';
  const acts = !job && !m.error && !m.greeting ? `<div class="im-acts">${eng ? `<span class="eng">${esc(eng)}${m.meta ? ` · ${(m.meta.ms / 1000).toFixed(1)}s` : ''}</span>` : ''}<button data-act="react" data-mid="${m.id}" title="React">${icon('heart', 13)}</button>${m.content ? `<button data-act="copy" data-mid="${m.id}" title="Copy">${icon('copy', 13)}</button>` : ''}${conv.kind === 'compare' || conv.kind === 'pair' ? '' : `<button data-act="retry" data-mid="${m.id}" title="Regenerate">${icon('refresh', 13)}</button>`}${m.content ? `<button data-act="remember" data-mid="${m.id}" title="Add to MEMORY.txt">${icon('bookmark', 13)}</button>` : ''}</div>` : '';
  if (compact) return `${label}${notes.join('')}${cards}${bubble}${files}${acts}`;
  return `<div class="im-av">${last ? portrait : ''}</div><div class="im-col">${label}${notes.join('')}${cards}${files}${bubble}${sources}${acts}</div>`;
};
function stepVerb(v) {
  return { Create: 'Created', Write: 'Wrote', Edit: 'Edited', Read: 'Read', List: 'Looked in', Bash: 'Ran', WebSearch: 'Searched', Fetch: 'Read', Browse: 'Opened', Preview: 'Previewing', Docker: 'Docker', Github: 'GitHub', Gmail: 'Gmail', Drive: 'Drive', Calendar: 'Calendar', Notion: 'Notion', Redact: 'Hid', Note: 'Note', Team: 'Checked', Assign: 'Assigned', Plan: 'Planned', Wait: 'Waiting on', Post: 'Posted' }[v] || v;
}

function askHtml(m, a) {
  const done = a.answer != null;
  return `<div class="im-ask ${done ? 'done' : ''}" data-ask="${a.id}" data-mid="${m.id}">
    ${a.by ? `<div class="im-by">${esc(a.by)} asks</div>` : ''}<div class="bubble ai q">${esc(a.question)}</div>
    <div class="im-opts">${(a.options || []).map((o) => `<button class="opt ${a.answer === o ? 'sel' : ''}" ${done ? 'disabled' : ''} data-opt="${esc(o)}">${esc(o)}</button>`).join('')}
    ${a.allowOther && !done ? `<span class="other"><input placeholder="Something else…" data-other><button data-other-go>${icon('send', 12)}</button></span>` : ''}
    ${done && !(a.options || []).includes(a.answer) ? `<button class="opt sel" disabled>${esc(a.answer)}</button>` : ''}</div></div>`;
}
const LANG = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', swift: 'swift', kt: 'kotlin', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', css: 'css', scss: 'scss', json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sh: 'bash', zsh: 'bash', bash: 'bash', sql: 'sql', dockerfile: 'dockerfile', lua: 'lua' };
function hl(code, lang) {
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
    return hljs.highlightAuto(code).value;
  } catch {
    return esc(code);
  }
}
function codeBlock(code, lang, { diff = false, collapsed = true } = {}) {
  const lines = String(code).replace(/\n$/, '').split('\n');
  let rows;
  if (diff) {
    rows = lines.map((l) => {
      const t = l.startsWith('+ ') ? 'add' : l.startsWith('- ') ? 'del' : '';
      return `<div class="cl ${t}"><span class="ln">${t === 'add' ? '+' : t === 'del' ? '−' : ''}</span><span class="cc">${hl(t ? l.slice(2) : l, lang)}</span></div>`;
    });
  } else {
    const html = hl(lines.join('\n'), lang).split('\n');
    rows = html.map((h, i) => `<div class="cl"><span class="ln">${i + 1}</span><span class="cc">${h || ' '}</span></div>`);
  }
  const long = lines.length > 14;
  return `<div class="codeview ${long && collapsed ? 'clipped' : ''}"><div class="hljs cv-body">${rows.join('')}</div>${long && collapsed ? `<button class="cv-more" data-expand>Show all ${lines.length} lines</button>` : ''}</div>`;
}
function approvalHtml(m, a) {
  const kind = a.kind;
  const t = String(a.title || '');
  const fileMatch = t.match(/^(Create|Overwrite|Edit)\s+(.+)$/);
  const file = fileMatch ? fileMatch[2] : '';
  const verb = fileMatch ? fileMatch[1] : '';
  const ext = (file.split('.').pop() || '').toLowerCase();
  const lang = LANG[ext] || (file.toLowerCase().endsWith('dockerfile') ? 'dockerfile' : '');
  const detail = String(a.detail || '');
  const nLines = detail ? detail.split('\n').length : 0;
  const isDiff = verb === 'Edit' && /^- /.test(detail);
  const badge = { Create: ['New file', 'new'], Overwrite: ['Overwrite', 'warn'], Edit: ['Edit', 'edit'] }[verb] || (kind === 'command' ? ['Command', 'cmd'] : ['App action', 'app']);
  const done = a.state;
  const summary = kind === 'command' ? `$ ${detail.split('\n')[0].slice(0, 80)}` : file ? `${file}${nLines && !isDiff ? ` · ${nLines} lines` : ''}` : t;
  let bodyHtml = '';
  if (kind === 'command') bodyHtml = `<div class="cmdview"><span class="pr">$</span>${hl(detail, 'bash')}</div>`;
  else if (kind === 'file' && detail) bodyHtml = codeBlock(detail, lang, { diff: isDiff });
  else if (detail) bodyHtml = `<pre class="appview">${esc(detail)}</pre>`;
  const head = `<div class="ah">${icon(kind === 'command' ? 'terminal' : kind === 'app' ? 'plug' : 'memory', 14)}<b class="${file ? 'fname' : ''}">${esc(file || (kind === 'command' ? 'Run a command' : t))}</b><span class="badge ${badge[1]}">${badge[0]}</span>${lang && file ? `<span class="lang">${esc(lang === 'xml' ? 'html' : lang)}</span>` : ''}${nLines > 1 && file && !isDiff ? `<span class="lang">${nLines} lines</span>` : ''}</div>`;
  if (done) {
    const word = done === 'yes' ? (verb === 'Create' ? 'Created' : verb === 'Overwrite' ? 'Overwrote' : verb === 'Edit' ? 'Edited' : kind === 'command' ? 'Ran' : 'Allowed') : 'Declined';
    return `<div class="im-approve compact ${done}" data-approve="${a.id}" data-mid="${m.id}"><button class="ac-row" data-toggle-approve>${done === 'yes' ? '<span class="okc">✓</span>' : '<span class="noc">✕</span>'}<span class="ac-t">${esc(word)}</span><span class="ac-s">${esc(summary)}</span>${icon('chevron', 12)}</button><div class="ac-body">${head}${bodyHtml}</div></div>`;
  }
  return `<div class="im-approve" data-approve="${a.id}" data-mid="${m.id}">${a.by ? `<div class="im-by">${esc(a.by)} is asking</div>` : ''}${head}${bodyHtml}
    <div class="btns"><button class="btn small primary" data-ok="1">${kind === 'command' ? 'Run' : verb === 'Create' ? 'Create file' : 'Allow'}</button>${a.always ? '<button class="btn small" data-ok="always">Always allow in this chat</button>' : ''}<button class="btn small ghost" data-ok="0">Decline</button></div>
  </div>`;
}

const _baseBind = window.bindMessageActions;
window.bindMessageActions = function (root, conv) {
  // Reactions need their own handler, so the base copy/retry/edit handlers skip them.
  $$('[data-act="react"]', root).forEach((b) => {
    b.removeAttribute('data-act');
    b.dataset.react = b.dataset.mid;
  });
  _baseBind(root, conv);
  $$('[data-react]', root).forEach((b) => b.addEventListener('click', (e) => tapbackPicker(conv, b.dataset.react, e.currentTarget)));
  $$('[data-bub]', root).forEach((b) => b.addEventListener('dblclick', (e) => tapbackPicker(conv, b.dataset.bub, e.currentTarget)));
  $$('[data-reveal]', root).forEach((b) => b.addEventListener('click', () => api.reveal(b.dataset.reveal)));
  $$('[data-expand]', root).forEach((b) => b.addEventListener('click', () => {
    b.closest('.codeview').classList.remove('clipped');
    b.style.display = 'none';
  }));
  $$('[data-toggle-approve]', root).forEach((b) => b.addEventListener('click', () => b.closest('.im-approve').classList.toggle('open')));
  $$('[data-ask]', root).forEach((card) => {
    const m = conv.messages.find((x) => x.id === card.dataset.mid);
    const a = m && (m.asks || []).find((x) => x.id === card.dataset.ask);
    if (!a || a.answer != null) return;
    const answer = (v) => {
      v = String(v || '').trim();
      if (!v) return;
      a.answer = v;
      api.agentReply(a.id, v);
      persist(conv);
      updateMessageEl(conv, m);
    };
    $$('[data-opt]', card).forEach((o) => o.addEventListener('click', () => answer(o.dataset.opt)));
    const inp = $('[data-other]', card);
    inp?.addEventListener('keydown', (e) => e.key === 'Enter' && answer(inp.value));
    $('[data-other-go]', card)?.addEventListener('click', () => answer(inp.value));
  });
  $$('[data-approve]', root).forEach((card) => {
    const m = conv.messages.find((x) => x.id === card.dataset.mid);
    const a = m && (m.approvals || []).find((x) => x.id === card.dataset.approve);
    if (!a || a.state) return;
    $$('[data-ok]', card).forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.ok;
      if (v === 'always') {
        conv.alwaysAllow = { ...(conv.alwaysAllow || {}), [a.kind]: true };
        toast('Allowed for the rest of this chat');
      }
      a.state = v === '0' ? 'no' : 'yes';
      api.agentReply(a.id, v !== '0');
      persist(conv);
      updateMessageEl(conv, m);
    }));
  });
};

function tapbackPicker(conv, mid, anchor) {
  const m = conv.messages.find((x) => x.id === mid);
  if (!m) return;
  const mine = (m.reactions || []).find((r) => r.by === 'me');
  const html = `<div class="tap-pick">${TAPBACKS.map((e) => `<button class="menu-item ${mine && mine.emoji === e ? 'hi' : ''}" data-a="${e}">${e}</button>`).join('')}</div>`;
  openMenu(anchor, html, (d) => {
    m.reactions = (m.reactions || []).filter((r) => r.by !== 'me');
    if (!mine || mine.emoji !== d.a) m.reactions.push({ emoji: d.a, by: 'me', ts: Date.now() });
    persist(conv);
    updateMessageEl(conv, m);
  });
}

window.updateMessageEl = function (conv, m) {
  if (conv.id !== currentId || view !== 'chat') return;
  const el = document.querySelector(`[data-mid="${m.id}"]`);
  if (!el || m.groupId || m.role === 'user') return renderThread();
  const near = isNearBottom();
  const idx = conv.messages.indexOf(m);
  const next = conv.messages[idx + 1];
  const prev = conv.messages[idx - 1];
  const first = !prev || senderKey(prev) !== senderKey(m);
  const last = !next || senderKey(next) !== senderKey(m);
  el.innerHTML = aiInner(m, conv, false, first, last);
  bindMessageActions(el, conv);
  // The message before might lose its tail/avatar when this one joins the group
  const pe = prev && document.querySelector(`[data-mid="${prev.id}"]`);
  if (pe && prev.role === 'ai' && senderKey(prev) === senderKey(m) && pe.querySelector('.tail')) {
    pe.querySelector('.tail').classList.remove('tail');
    const avEl = pe.querySelector('.im-av');
    if (avEl) avEl.innerHTML = '';
    pe.classList.remove('last');
  }
  if (near) scrollToBottom();
};

// ---------------- history includes reactions ----------------
const _baseHistory = window.historyFor;
window.historyFor = function (conv, speaker, upTo) {
  const out = _baseHistory(conv, speaker, upTo);
  const notes = [];
  for (const m of conv.messages) {
    if (m === upTo) break;
    for (const r of m.reactions || []) if (r.by === 'me' && m.role === 'ai' && m.content) notes.push(`${r.emoji} to "${m.content.slice(0, 80).replace(/\s+/g, ' ')}…"`);
  }
  if (notes.length && out.length && out[out.length - 1].role === 'user') out[out.length - 1] = { ...out[out.length - 1], content: out[out.length - 1].content + `\n\n(Earlier, I reacted ${notes.slice(-3).join('; ')})` };
  return out;
};

// ---------------- running a reply ----------------
window.runReply = function (conv, nodeId, opts = {}) {
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
        if (el) el.innerHTML = `${icon('brain', 12)}Thinking ${Math.round((Date.now() - msg.reasoningStart) / 1000)}s`;
      }
    }, 1000);
    const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
    const lowercase = !!(lastUser && isLower(lastUser.content));
    let res;
    try {
      res = await api.startChat({
        reqId, nodeId, messages: historyFor(conv, conv.kind === 'pair' || conv.kind === 'project' ? opts.side : nodeId, msg), pinned: opts.pinned || conv.pinned, web: conv.web !== false,
        noFallback: opts.noFallback ?? (!!conv.pinned && conv.fallback === false), roomNote: opts.roomNote || '', folder: conv.folder || '',
        permission: conv.permission || S.settings.defaultPermission || 'ask', thinking: conv.thinking || S.settings.defaultThinking || 'low', lowercase,
        ...(window.teamReq ? teamReq(conv, nodeId) : {}),
      });
    } catch (e) {
      res = { ok: false, attempts: [{ provider: 'nodes', model: '', reason: String(e.message || e) }] };
    }
    clearInterval(timer);
    jobs.delete(reqId);
    if (res.cwd) conv.cwd = res.cwd;
    if (res.sources && res.sources.length) msg.sources = res.sources;
    if (res.ok) msg.meta = { provider: res.provider, providerName: res.providerName, model: res.model, ms: res.ms };
    else if (res.stopped) msg.stopped = true;
    else {
      msg.content = '';
      msg.error = { attempts: res.attempts || [], noProviders: !!res.noProviders };
    }
    if (lowercase && msg.content) msg.content = lowerOutsideCode(msg.content);
    for (const a of msg.asks || []) if (a.answer == null) a.answer = '(no answer)';
    for (const a of msg.approvals || []) if (!a.state) a.state = 'no';
    for (const t of msg.assigns || []) if (t.state === 'working' || t.state === 'approval') t.state = res.stopped ? 'stopped' : 'failed';
    if (msg.reasoningStart && !msg.thoughtMs) msg.thoughtMs = Date.now() - msg.reasoningStart;
    delete msg.reasoningStart;
    conv.updatedAt = Date.now();
    if (conv.id !== currentId || view !== 'chat') conv.unread = true;
    persist(conv);
    if (conv.id === currentId && view === 'chat') {
      renderThread();
      updateSendBtn();
      updateCtx();
    }
    renderSidebar();
    const st = await api.getState();
    S.providers = st.providers;
    resolve(res.stopped ? 'stopped' : res.ok ? 'ok' : 'failed');
  });
};

const _baseEvent = window.onChatEvent;
window.onChatEvent = function (ev) {
  const job = jobs.get(ev.reqId);
  if (!job) return;
  const m = job.msg;
  const conv = convById(job.convId);
  if (!conv) return;
  if (ev.type === 'sources') {
    m.sources = ev.sources;
    return updateMessageEl(conv, m);
  }
  if (ev.type === 'ask') {
    m.asks = m.asks || [];
    m.asks.push({ id: ev.id, question: ev.question, options: ev.options || [], allowOther: ev.allowOther !== false, answer: null, by: ev.by });
    updateMessageEl(conv, m);
    if (conv.id !== currentId) toast(`${ev.by || nodeById(m.nodeId).name} has a question for you`);
    return;
  }
  if (ev.type === 'approve') {
    if (conv.alwaysAllow && conv.alwaysAllow[ev.kind] && ev.always !== false) return api.agentReply(ev.id, true);
    m.approvals = m.approvals || [];
    m.approvals.push({ id: ev.id, kind: ev.kind, title: ev.title, detail: ev.detail, always: ev.always !== false, state: null, by: ev.by });
    updateMessageEl(conv, m);
    if (conv.id !== currentId) toast(`${ev.by || nodeById(m.nodeId).name} needs your OK`);
    return;
  }
  if (ev.type === 'react') {
    const target = [...conv.messages].reverse().find((x) => x.role === 'user');
    if (target) {
      target.reactions = (target.reactions || []).filter((r) => r.by !== m.nodeId);
      target.reactions.push({ emoji: ev.emoji, by: m.nodeId, ts: Date.now() });
      persist(conv);
      if (conv.id === currentId) renderThread();
    }
    return;
  }
  if (ev.type === 'file') {
    m.filesOut = (m.filesOut || []).filter((f) => f.path !== ev.path);
    m.filesOut.push({ path: ev.path, action: ev.action });
    return updateMessageEl(conv, m);
  }
  return _baseEvent(ev);
};

// ---------------- chat view with new composer ----------------
window.renderChat = function (main) {
  const conv = current();
  if (!conv) {
    if (S.conversations.length) {
      currentId = [...S.conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
      return renderChat(main);
    }
    return renderHome(main);
  }
  if (conv.web === undefined) conv.web = true;
  let title;
  if (conv.kind === 'team') title = `<div class="stack">${conv.nodeIds.slice(0, 5).map((id) => av(nodeById(id), 26)).join('')}</div><div class="tt"><h1>${esc(convTitle(conv))}</h1><span class="sub">${conv.nodeIds.map((id) => nodeById(id).name).slice(0, 5).join(', ')}${conv.nodeIds.length > 5 ? '…' : ''}</span></div>`;
  else if (conv.kind === 'project') title = `<div class="stack">${conv.nodeIds.slice(0, 5).map((id) => av(nodeById(id), 26)).join('')}</div><div class="tt"><h1>${esc(conv.title)}</h1><span class="sub">Project · ${conv.nodeIds.length} nodes</span></div>`;
  else if (conv.kind === 'pair') title = `${pairAvatar(28)}<div class="tt"><h1>${esc(convTitle(conv))}</h1><span class="sub">${esc(engineLabel(conv.pair.a))} ⇄ ${esc(engineLabel(conv.pair.b))}</span></div>`;
  else if (conv.kind === 'compare') title = `${convAvatar(conv, 28)}<div class="tt"><h1>Compare</h1><span class="sub">${esc(conv.compare.map(engineLabel).join(' · '))}</span></div>`;
  else {
    const n = nodeById(conv.nodeIds[0]);
    title = `${av(n, 30)}<div class="tt"><h1>${esc(n.name)}</h1><span class="sub">${esc(n.title && n.title !== n.name ? n.title + ' · ' : '')}${esc(n.tagline)}</span></div>`;
  }
  const folderName = (conv.folder || conv.cwd || '').split(/[\\/]/).pop() || 'Workspace';
  const actions = `
    <button class="chip-btn ${conv.folder ? 'on' : ''}" id="act-folder" title="${esc(conv.folder || conv.cwd || 'Choose the folder this chat works in')}">${icon('folder', 14)}<span>${esc(folderName)}</span></button>
    <button class="icon-btn" id="act-preview" title="Preview the site in this folder">${icon('external', 16)}</button>
    <button class="icon-btn ${browserOpen ? 'on' : ''}" id="act-browser" title="Browser  ⌘B">${icon('panel', 17)}</button>
    <button class="icon-btn" id="act-more" title="More">${icon('more', 17)}</button>`;
  const perm = PERMS[conv.permission || S.settings.defaultPermission || 'ask'];
  const think = THINK[conv.thinking || S.settings.defaultThinking || 'low'];
  const relay = conv.kind === 'compare' || conv.kind === 'pair' || conv.kind === 'project';
  main.innerHTML = `${topbar(title, actions)}
    <div class="chat-scroll im" id="chat-scroll"><div class="thread im-thread" id="thread"></div></div>
    <div class="composer-wrap">
      <div class="composer im-composer">
        <div class="composer-files hidden" id="composer-files"></div>
        <div class="im-inrow">
          <button class="im-plus" id="btn-plus" title="Attach">${icon('plus', 18)}</button>
          <textarea id="input" rows="1" placeholder="${esc(placeholderFor(conv))}" spellcheck="true"></textarea>
          <button class="send-btn" id="btn-send" title="Send">${icon('send', 16)}</button>
        </div>
        <div class="composer-row im-ctrls">
          <button class="pill ${conv.web !== false ? 'on' : ''}" id="btn-web" title="Let nodes search the web and open pages">${icon('globe', 13)}Web</button>
          ${relay ? '' : `<button class="pill" id="btn-model" title="Choose the AI for this chat">${modelPickLabel(conv)}</button>`}
          <button class="pill" id="btn-think" title="${esc(think.desc)}">${icon('brain', 13)}${esc(think.label)}${icon('chevron', 11)}</button>
          <button class="pill perm-${conv.permission || S.settings.defaultPermission || 'ask'}" id="btn-perm" title="${esc(perm.desc)}">${icon(perm.icon, 13)}${esc(perm.label)}${icon('chevron', 11)}</button>
          <span class="grow"></span>
          <button class="ctx-ring" id="btn-ctx" title="Context usage"></button>
        </div>
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
    conv.web = conv.web === false;
    persist(conv);
    renderChat(main);
    toast(conv.web ? 'Nodes can search the web and open pages' : 'Web access off for this chat');
  });
  $('#btn-model')?.addEventListener('click', (e) => openModelMenu(e.currentTarget));
  $('#btn-think').addEventListener('click', (e) => choiceMenu(e.currentTarget, 'How much should nodes think?', THINK, conv.thinking || S.settings.defaultThinking || 'low', (k) => {
    conv.thinking = k;
    persist(conv);
    renderChat(main);
  }));
  $('#btn-perm').addEventListener('click', (e) => choiceMenu(e.currentTarget, 'What can nodes do without asking?', PERMS, conv.permission || S.settings.defaultPermission || 'ask', (k) => {
    conv.permission = k;
    persist(conv);
    renderChat(main);
    if (k === 'full') toast('Full trust: nodes can change files and run commands without asking');
  }));
  $('#btn-ctx').addEventListener('click', (e) => ctxPopover(e.currentTarget));
  $('#act-folder').addEventListener('click', chooseFolder);
  $('#act-preview').addEventListener('click', async () => {
    const dir = conv.folder || conv.cwd || (await api.defaultWorkspace(nodeById(conv.nodeIds[0]).name));
    toast('Starting preview…');
    const r = await api.startPreview(dir);
    if (r.ok) {
      openBrowser(r.url);
      toast(r.kind === 'docker' ? 'Running in Docker' : 'Preview on localhost');
    } else toast(r.error);
  });
  $('#act-browser').addEventListener('click', () => (browserOpen ? closeBrowser() : openBrowser()));
  $('#act-more').addEventListener('click', (e) => convMenu(conv, e.currentTarget));
  updateSendBtn();
  drawUsageBanner();
  input.focus();
};

window.placeholderFor = function (conv) {
  if (conv.kind === 'team') return `Message ${convTitle(conv)}`;
  if (conv.kind === 'project') return 'Steer the project';
  if (conv.kind === 'compare') return 'Ask every model';
  if (conv.kind === 'pair') return 'Describe what to build';
  return `Message ${nodeById(conv.nodeIds[0]).name}`;
};

function choiceMenu(anchor, title, opts, cur, onPick) {
  const html = `<div class="menu-label" style="padding-top:10px">${esc(title)}</div><div class="menu-scroll">${Object.entries(opts).map(([k, o]) => `<button class="menu-item" data-a="${k}"><span class="check">${k === cur ? icon('check', 14) : ''}</span><div>${esc(o.label)}<span class="d">${esc(o.desc)}</span></div></button>`).join('')}</div>`;
  openMenu(anchor, html, (d) => onPick(d.a));
}

// The browser panel stays closed until a node or a link opens it.
S && (S.settings.browserAutoOpen = false);
