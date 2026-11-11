/* Nodes: teamwork. Cards for tasks a node hands to teammates, and the team progress feed
   (short status lines from nodes, stored with the chat the work belongs to).
   Loaded after work.js; wraps a few functions from app.js and agent.js. */
'use strict';

const ASSIGN_STATE = { working: 'Working', approval: 'Needs your OK', done: 'Done', failed: 'Failed', stopped: 'Stopped', planned: 'Planned' };
const openAssigns = new Set();

// The chat whose feed a conversation's work belongs to: the team or project chat itself; for a
// company node's own chat, its department chat (or all-hands). Other chats keep their own feed.
function feedConvFor(conv, nodeId) {
  if (conv.kind !== 'node') return conv;
  const n = nodeById(nodeId || conv.nodeIds[0]);
  const co = n && n.companyId && (S.companies || []).find((c) => c.id === n.companyId);
  if (!co) return conv;
  const dept = (S.teams || []).find((t) => t.name === n.team || t.id === n.team);
  return convById(co.convs?.[dept?.id]) || convById(co.convs?.all) || conv;
}
const feedNotes = (conv) => conv.messages.filter((m) => m.role === 'note').slice(-15).map((m) => ({ nodeId: m.nodeId, name: nodeById(m.nodeId).name, text: m.content, kind: m.kind, ts: m.ts }));

// Extra fields for chat:start (see runReply in agent.js).
window.teamReq = function (conv, nodeId) {
  if (conv.kind === 'compare' || conv.kind === 'pair') return { team: false };
  const f = feedConvFor(conv, nodeId);
  return { convId: conv.id, feedConvId: f.id, feed: feedNotes(f) };
};

// ---------- assignment cards ----------
window.assignCardsHtml = function (m) {
  return (m.assigns || []).map((t) => {
    const n = nodeById(t.nodeId);
    const open = openAssigns.has(m.id + t.id) && t.result;
    const live = t.state === 'working' || t.state === 'approval';
    const via = t.fromId && t.fromId !== m.nodeId ? ` <em>from ${esc(t.from)}</em>` : '';
    const sub = live && t.step ? `<span class="as-step">${esc(t.step.replace(/^(\w+)\((.*)\)$/, (x, v, a) => `${stepVerb(v)} ${a}`))}</span>` : '';
    return `<div class="im-assign ${t.state} ${open ? 'open' : ''}" data-assign="${esc(t.id)}" data-mid="${m.id}">
      <button class="as-row" ${t.result ? 'data-toggle-assign' : 'tabindex="-1"'}>
        <span class="as-av">${av(n, 26)}</span>
        <span class="as-main"><span class="as-name"><b>${esc(t.name || n.name)}</b>${via}</span><span class="as-task">${esc(t.task)}</span>${sub}</span>
        <span class="as-state"><i></i>${ASSIGN_STATE[t.state] || ''}</span>
        ${t.result ? icon('chevron', 12) : ''}
      </button>
      ${open ? `<div class="as-body"><div class="md">${renderMarkdown(t.result)}</div></div>` : ''}
    </div>`;
  }).join('');
};

// ---------- feed lines ----------
const _feedMessageHtml = window.messageHtml;
window.messageHtml = function (m, conv, isLast, first, last) {
  if (m.role !== 'note') return _feedMessageHtml(m, conv, isLast, first, last);
  const n = nodeById(m.nodeId);
  return `<div class="im-feed ${esc(m.kind || 'note')}" data-mid="${m.id}"><span class="fd-av">${av(n, 16)}</span><span class="fd-t"><b>${esc(n.name)}</b> ${esc(m.content)}</span><time>${fmtTime(m.ts)}</time></div>`;
};

// Notes reach every node through the feed in its prompt, not the chat history.
const _feedHistory = window.historyFor;
window.historyFor = function (conv, speaker, upTo) {
  return _feedHistory({ ...conv, messages: conv.messages.filter((m) => m.role !== 'note') }, speaker, upTo);
};

const _feedBind = window.bindMessageActions;
window.bindMessageActions = function (root, conv) {
  _feedBind(root, conv);
  $$('[data-toggle-assign]', root).forEach((b) => b.addEventListener('click', () => {
    const card = b.closest('[data-assign]');
    const m = conv.messages.find((x) => x.id === card.dataset.mid);
    const k = card.dataset.mid + card.dataset.assign;
    openAssigns.has(k) ? openAssigns.delete(k) : openAssigns.add(k);
    if (m) updateMessageEl(conv, m);
  }));
};

// A finished task ticks the matching item on a project's task board, if there is one.
function tickBoard(convs, t) {
  const want = normTask(t.task);
  if (want.length < 6) return;
  for (const c of convs) {
    if (!c || !(c.tasks || []).length) continue;
    const open = c.tasks.filter((x) => x.status !== 'done' && (!x.assignee || x.assignee === t.nodeId));
    const hit = open.find((x) => normTask(x.text) === want) || open.find((x) => {
      const k = normTask(x.text);
      return k.length >= 10 && (want.includes(k) || k.includes(want));
    });
    if (!hit) continue;
    hit.status = 'done';
    hit.doneAt = Date.now();
    if (!hit.assignee) hit.assignee = t.nodeId;
    persist(c);
    if (c.id === currentId && view === 'chat') renderThread();
    return;
  }
}

const _feedEvent = window.onChatEvent;
window.onChatEvent = function (ev) {
  if (ev.type !== 'note' && ev.type !== 'assign') return _feedEvent(ev);
  const job = jobs.get(ev.reqId);
  if (!job) return;
  const conv = convById(job.convId);
  if (!conv) return;
  if (ev.type === 'note') {
    const fc = convById(ev.convId) || conv;
    fc.messages.push({ id: uid(), role: 'note', nodeId: ev.nodeId, content: ev.text, kind: ev.kind, ts: ev.ts || Date.now() });
    fc.updatedAt = Date.now();
    if (fc !== conv) persist(fc);
    if (fc.id === currentId && view === 'chat') renderThread();
    return;
  }
  const m = job.msg;
  const t = ev.task;
  m.assigns = m.assigns || [];
  const i = m.assigns.findIndex((x) => x.id === t.id);
  const prev = i === -1 ? null : m.assigns[i];
  if (i === -1) m.assigns.push(t);
  else m.assigns[i] = t;
  if (t.state === 'approval' && (!prev || prev.state !== 'approval') && conv.id !== currentId) toast(`${t.name} needs your OK`);
  if (t.state === 'done' && (!prev || prev.state !== 'done')) {
    tickBoard([convById(feedConvFor(conv, m.nodeId).id), conv], t);
    persist(conv);
  }
  updateMessageEl(conv, m);
};
