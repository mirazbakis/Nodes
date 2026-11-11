// Teamwork between nodes: handing work to teammates (delegation) and the shared progress feed.
//
// A user request starts a "tree". The node answering it can assign tasks to teammates; each
// teammate runs its own full agent loop (its own role prompt, engines and tools) and returns a
// short result. Guard rails live here: depth, cycles, a cap on sub-tasks per request, Stop
// reaching every sub-task, Plan mode only planning, and the chat's permission mode for all.
//
// Progress notes go to the chat the work belongs to (team, project, department or all-hands).
// The renderer stores them with that conversation; this module keeps the latest ones in memory
// so every node's turn can start with them.

const MAX_DEPTH = 2; // the user's node (0) → teammate (1) → teammate's teammate (2), who can't assign further
const MAX_TASKS = 8; // sub-tasks per user request
const FEED_PROMPT = 15;
const FEED_KEEP = 60;

const S = (props, req = []) => ({ type: 'object', properties: props, required: req });
const str = (d) => ({ type: 'string', description: d });
const one = (s, n = 140) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '\n…(cut)' : String(s));
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- tools ----------
// `cli: true` means CLI engines (Codex, Claude Code, Gemini CLI...) get this tool through the
// text protocol in engine.js, since those agents bring their own file and shell tools.
const DEFS = {
  list_teammates: { name: 'list_teammates', cli: true, description: 'See your teammates (other nodes): name, role, what they are good at, and whether they are busy right now.', parameters: S({}) },
  assign_task: {
    name: 'assign_task', cli: true,
    description: 'Hand a piece of real work to a teammate (by name or role, e.g. "Ben" or "designer"). They do it with their own skills and tools in the same workspace and send you back a short result. Use it for parts that fit their specialty (design, copy, research, tests, review, marketing...) or to work in parallel. It returns at once with a task id; start several, then call wait_for_tasks to collect the results. Give them everything they need: they cannot see this chat.',
    parameters: S({
      to: str('Teammate name or role'),
      task: str('What to do, in one or two sentences, with a clear finish line'),
      context: str('Background they need: goal, decisions so far, constraints, what good looks like'),
      files: { type: 'array', items: { type: 'string' }, description: 'Relevant file paths in the workspace' },
      wait: { type: 'boolean', description: 'Wait for the result before continuing (default false)' },
    }, ['to', 'task']),
  },
  wait_for_tasks: { name: 'wait_for_tasks', cli: true, description: 'Wait for tasks you assigned and get their results. Without ids, waits for all of your open tasks.', parameters: S({ ids: { type: 'array', items: { type: 'string' }, description: 'Task ids from assign_task (optional)' } }) },
  post_progress: { name: 'post_progress', cli: true, description: 'Post a one-line progress note to the team feed, which every teammate on this work reads (e.g. "Pricing page done, waiting on copy"). Use it at real milestones, not every step.', parameters: S({ note: str('Short progress note, one line') }, ['note']) },
};
const NAMES = new Set(Object.keys(DEFS));
const has = (name) => NAMES.has(name);

function defs(ctx) {
  if (!ctx || !ctx.mates().length) return [];
  const canAssign = ctx.depth < MAX_DEPTH;
  return [DEFS.list_teammates, ...(canAssign ? [DEFS.assign_task, DEFS.wait_for_tasks] : []), DEFS.post_progress];
}

// ---------- the feed ----------
const feeds = new Map(); // feed conversation id -> [{nodeId, name, text, kind, ts}]
function seedFeed(convId, notes) {
  if (!convId || !Array.isArray(notes)) return;
  const live = feeds.get(convId) || [];
  const seen = new Set(live.map((n) => n.ts + '|' + n.text));
  const merged = [...notes.filter((n) => n && n.text && !seen.has(n.ts + '|' + n.text)).map((n) => ({ nodeId: n.nodeId, name: one(n.name, 40), text: one(n.text, 300), kind: n.kind || 'note', ts: Number(n.ts) || 0 })), ...live];
  feeds.set(convId, merged.sort((a, b) => a.ts - b.ts).slice(-FEED_KEEP));
}
function feedPrompt(convId) {
  const list = (feeds.get(convId) || []).slice(-FEED_PROMPT);
  if (!list.length) return '';
  const t = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `\n\nTEAM FEED (latest progress notes from the team on this work, oldest first). Read it before you start: build on what's done, don't redo it, and pick up anything waiting on you.\n${list.map((n) => `- ${t(n.ts)} ${n.name}: ${one(n.text, 160)}`).join('\n')}`;
}

// ---------- trees and contexts ----------
const busy = new Map(); // nodeId -> {count, task}
function markBusy(nodeId, task, on) {
  const b = busy.get(nodeId) || { count: 0, task: '' };
  b.count += on ? 1 : -1;
  if (on && task) b.task = task;
  if (b.count <= 0) busy.delete(nodeId);
  else busy.set(nodeId, b);
}

// Root of a user request. send(ev) goes to the chat the user is looking at.
function newTree({ reqId, send, permission, thinking, web, feedConvId }) {
  return { reqId, send, permission, thinking, web, feedConvId, count: 0, seq: 0, tasks: new Map() };
}

// One node's run inside a tree. runAgent is main.js's agent runner.
// matesFor(node) lists the nodes that node can work with.
function context({ tree, node, depth = 0, path = [], parentTask = null, matesFor, runAgent, signal, cwd }) {
  return { tree, node, depth, path: [...path, node.id], parentTask, matesFor, mates: () => matesFor(node), runAgent, signal, cwd, mine: new Map() };
}

function note(tree, node, text, kind = 'note') {
  if (!tree || !tree.feedConvId || !text) return;
  const n = { nodeId: node.id, name: node.name, text: one(text, 300), kind, ts: Date.now() };
  const list = feeds.get(tree.feedConvId) || [];
  list.push(n);
  feeds.set(tree.feedConvId, list.slice(-FEED_KEEP));
  tree.send({ type: 'note', convId: tree.feedConvId, ...n });
}

const publicTask = (t) => ({ id: t.id, nodeId: t.to.id, name: t.to.name, fromId: t.from.id, from: t.from.name, task: t.task, state: t.state, step: t.step, result: t.result, at: t.at, ms: t.ms });
function update(t) {
  t.tree.send({ type: 'assign', task: publicTask(t) });
}

function systemFor(ctx, callMe) {
  if (!ctx) return '';
  let s = '';
  const mates = ctx.mates();
  if (mates.length) {
    s += `\n\nTEAMWORK\n- Your teammates (other nodes): ${mates.slice(0, 12).map((n) => `${n.name} (${n.title || n.role})`).join(', ')}.`;
    if (ctx.depth < MAX_DEPTH)
      s += `\n- You can hand real work to them with assign_task: design to a designer, copy to a writer, research to a researcher, tests to QA, and so on, or split a big job to run in parallel. Give each one the task, the context they need and the file paths; they can't see this chat. Start the tasks, then call wait_for_tasks and use their results in your answer. Do small things yourself; don't hand off the whole request or something you were just given.` +
        (ctx.tree.permission === 'plan' ? ' Plan first mode is on: you can plan assignments (assign_task records them) but nobody starts work until the plan is approved.' : '');
    s += '\n- Post short progress notes with post_progress at real milestones, so the team knows where things stand.';
  }
  if (ctx.parentTask) {
    const t = ctx.parentTask;
    s += `\n\nYOU WERE ASSIGNED THIS TASK by ${t.from.name} (${t.from.title || t.from.role}), as part of a request from ${callMe}. Do it properly with your own skills and tools in the workspace. Don't ask ${callMe} questions unless you're truly stuck. When you're done, reply with a concise result for ${t.from.name}: what you did, files you created or changed, and anything left open. Keep it under 200 words.`;
  }
  return s + feedPrompt(ctx.tree.feedConvId);
}

function resolveMate(ctx, to) {
  const mates = ctx.mates();
  const k = key(to);
  if (!k) return null;
  const free = (list) => list.find((n) => !busy.has(n.id)) || list[0];
  return mates.find((n) => key(n.name) === k) || free(mates.filter((n) => key(n.role) === k || key(n.title) === k)) || mates.find((n) => key(n.name).startsWith(k) && k.length >= 3) || free(mates.filter((n) => k.length >= 4 && (key(n.title).includes(k) || key(n.role).includes(k)))) || null;
}

function listText(ctx) {
  const mates = ctx.mates();
  return mates.map((n) => {
    const b = busy.get(n.id);
    return `${n.name}, ${n.title || n.role}${n.team ? ' (' + n.team + ')' : ''}: ${n.tagline || ''}${b ? `. Busy: ${one(b.task, 80)}` : '. Free'}`;
  }).join('\n') || 'You have no teammates yet.';
}

function taskPrompt(t) {
  let p = `${t.from.name} assigned you this task:\n${t.task}`;
  if (t.context) p += `\n\nContext:\n${t.context}`;
  if (t.files && t.files.length) p += `\n\nRelevant files:\n${t.files.map((f) => '- ' + f).join('\n')}`;
  return p;
}

function resultLine(t) {
  if (t.state === 'done') return `Task ${t.id} (${t.to.name}, done):\n${clip(t.result || '(no reply)', 4000)}`;
  if (t.state === 'stopped') return `Task ${t.id} (${t.to.name}): stopped by the user.`;
  if (t.state === 'planned') return `Task ${t.id} (${t.to.name}): planned only, not started (Plan first mode).`;
  return `Task ${t.id} (${t.to.name}, failed): ${one(t.result || 'no engine could do it', 300)}`;
}

function waitFor(list, signal) {
  if (!list.length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    signal && signal.addEventListener('abort', done, { once: true });
    Promise.all(list.map((t) => t.promise)).then(done, done);
  });
}

async function assign(ctx, a, say) {
  const { tree, node } = ctx;
  const task = one(a.task, 2000);
  if (!task) return 'Say what the task is.';
  if (ctx.depth >= MAX_DEPTH) return `You're already working on a task handed down twice, so you can't hand it on again. Do this part yourself.`;
  const to = resolveMate(ctx, a.to);
  if (!to) return `There's no teammate called "${one(a.to, 40)}". Your teammates:\n${listText(ctx)}`;
  if (to.id === node.id) return 'That is you. Do it yourself.';
  if (ctx.path.includes(to.id)) return `${to.name} is already part of this chain of work (${ctx.path.map((id) => (ctx.mates().find((n) => n.id === id) || (id === node.id ? node : { name: id })).name).join(' → ')}), so assigning back would loop. Do it yourself, or say what you need in your result.`;
  const id = `t${++tree.seq}`;
  const t = { id, tree, from: node, to, task, context: a.context ? clip(a.context, 6000) : '', files: Array.isArray(a.files) ? a.files.slice(0, 20).map(String) : [], state: 'working', step: '', result: '', at: Date.now() };
  if (tree.permission === 'plan') {
    t.state = 'planned';
    tree.tasks.set(id, t);
    ctx.mine.set(id, t);
    t.promise = Promise.resolve();
    update(t);
    say(`Plan(${to.name}: ${one(task, 60)})`);
    return `Plan first mode is on, so this is recorded as a planned assignment (${id}: ${to.name} to "${one(task, 80)}") and nothing was started. Put it in your plan; it will run once the user approves.`;
  }
  if (tree.count >= MAX_TASKS) return `This request already has ${MAX_TASKS} hand-offs, the most allowed. Do the rest yourself or collect the results you have.`;
  tree.count++;
  tree.tasks.set(id, t);
  ctx.mine.set(id, t);
  say(`Assign(${to.name}: ${one(task, 60)})`);
  note(tree, node, `Handed to ${to.name}: ${one(task, 120)}`, 'handoff');
  update(t);
  t.promise = runTask(ctx, t);
  if (a.wait) {
    await waitFor([t], ctx.signal);
    return resultLine(t);
  }
  return `Started task ${id}: ${to.name} is on it. Call wait_for_tasks when you need the result.`;
}

async function runTask(ctx, t) {
  const { tree } = ctx;
  const sub = new AbortController();
  const stop = () => sub.abort();
  if (ctx.signal.aborted) sub.abort();
  else ctx.signal.addEventListener('abort', stop, { once: true });
  let text = '';
  let tail = ''; // text since the last tool step: the node's closing answer
  let last = 0;
  let blockTimer = null;
  const push = (force) => {
    if (force || Date.now() - last > 250) {
      last = Date.now();
      update(t);
    }
  };
  const subCtx = context({ tree, node: t.to, depth: ctx.depth + 1, path: ctx.path, parentTask: t, matesFor: ctx.matesFor, runAgent: ctx.runAgent, signal: sub.signal, cwd: ctx.cwd });
  note(tree, t.to, `Started: ${one(t.task, 120)}`, 'start');
  markBusy(t.to.id, t.task, true);
  let res;
  try {
    res = await ctx.runAgent({
      nodeId: t.to.id, reqId: `${tree.reqId}.${t.id}`, messages: [{ role: 'user', content: taskPrompt(t) }],
      permission: tree.permission, thinking: tree.thinking, web: tree.web, folder: ctx.cwd,
    }, {
      signal: sub.signal, team: subCtx, by: t.to.name,
      send: (ev) => {
        if (ev.type === 'delta') return void ((text += ev.text), (tail += ev.text));
        if (ev.type === 'switch') return void (text = tail = '');
        if (ev.type === 'tool') {
          tail = '';
          t.step = one(ev.text, 120);
          return push();
        }
        if (['approve', 'ask', 'browser', 'file', 'usage', 'note', 'assign'].includes(ev.type)) tree.send(ev);
      },
      onWait: (on, what) => {
        t.state = on ? 'approval' : 'working';
        push(true);
        clearTimeout(blockTimer);
        // auto-allowed approvals answer at once; only a real wait is worth a note
        if (on) blockTimer = setTimeout(() => t.state === 'approval' && note(tree, t.to, `Waiting on you: ${one(what, 100)}`, 'blocked'), 1500);
      },
    });
  } catch (e) {
    res = { ok: false, attempts: [{ reason: e.message || String(e) }] };
  } finally {
    markBusy(t.to.id, t.task, false);
    clearTimeout(blockTimer);
    ctx.signal.removeEventListener('abort', stop);
  }
  t.ms = Date.now() - t.at;
  t.step = '';
  if (res.ok) {
    t.state = 'done';
    const all = (res.text || text).trim();
    t.result = tail.trim().length >= 60 ? tail.trim() : all;
    const firstLine = (tail.trim() || all).split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find((l) => l.length > 3) || 'done';
    note(tree, t.to, `Finished: ${one(firstLine, 140)}`, 'done');
  } else if (res.stopped || sub.signal.aborted) {
    t.state = 'stopped';
  } else {
    t.state = 'failed';
    t.result = res.noProviders ? 'No engine is set up for this teammate.' : (res.attempts || []).map((x) => x.reason).filter(Boolean).slice(-1)[0] || 'No engine could do it.';
    note(tree, t.to, `Blocked: couldn't finish "${one(t.task, 60)}" (${one(t.result, 80)})`, 'blocked');
  }
  update(t);
}

// Called when a node's run ends: anything it assigned but never waited for still finishes,
// so the cards complete and the results reach the team feed.
function settle(ctx) {
  if (!ctx) return Promise.resolve();
  return waitFor([...ctx.mine.values()].filter((t) => t.state === 'working' || t.state === 'approval'), ctx.signal);
}

async function run(name, a, ctx, say) {
  a = a || {};
  if (!ctx) return 'Teamwork is not available in this chat.';
  switch (name) {
    case 'list_teammates':
      say('Team(teammates)');
      return listText(ctx);
    case 'assign_task':
      return assign(ctx, a, say);
    case 'wait_for_tasks': {
      const ids = Array.isArray(a.ids) && a.ids.length ? a.ids.map(String) : null;
      const list = [...ctx.mine.values()].filter((t) => !ids || ids.includes(t.id));
      if (!list.length) return ids ? `No tasks with those ids. Yours: ${[...ctx.mine.keys()].join(', ') || 'none'}.` : 'You have no assigned tasks.';
      say(`Wait(${list.map((t) => t.to.name).join(', ')})`);
      await waitFor(list, ctx.signal);
      if (ctx.signal.aborted) return 'Stopped.';
      return list.map(resultLine).join('\n\n');
    }
    case 'post_progress': {
      const text = one(a.note, 300);
      if (!text) return 'Write the note.';
      note(ctx.tree, ctx.node, text, 'note');
      say(`Post(${one(text, 60)})`);
      return 'Posted to the team feed.';
    }
  }
  return `Unknown tool: ${name}`;
}

module.exports = { MAX_DEPTH, MAX_TASKS, defs, has, run, newTree, context, note, seedFeed, systemFor, settle, feeds };
