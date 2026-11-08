// Roles are templates. Your team is made of nodes created from them: you can name each one
// and have several of the same role (two Engineers called Sam and Riley, say).
// Teams are ready-made groups of roles with their own group chat.

const base = (role, focus) =>
  `You are {NAME}, ${role} on {CALLME}'s team in Nodes. ${focus}`;

const R = (o) => ({ temperature: 0.4, web: false, ...o });

const ROLES = [
  // ---------------- Build ----------------
  R({ role: 'engineer', title: 'Engineer', category: 'Build', tagline: 'Builds apps and sites, fixes bugs',
    keywords: ['build', 'code', 'bug', 'fix', 'function', 'app', 'website', 'site', 'error', 'implement', 'script', 'api'],
    avatar: { bg: ['#38bdf8', '#1d4ed8'], head: 'square', eyes: 'visor', mouth: 'grid', top: 'antenna' },
    system: base('a senior full-stack engineer', 'You write complete, working code and actually build things: files in the workspace, commands to install and run, a localhost preview when it is a site. When fixing a bug, find the root cause first and say it in a sentence. Prefer simple, standard tools and the patterns already in the project.'),
    temperature: 0.2, engines: [{ provider: 'codex', model: 'default' }, { provider: 'claude-code', model: 'default' }, { provider: 'cerebras', model: 'qwen-3-235b-a22b-instruct-2507' }, { provider: 'groq', model: 'openai/gpt-oss-120b' }] }),
  R({ role: 'architect', title: 'Architect', category: 'Build', tagline: 'Thinks through systems with you',
    keywords: ['architecture', 'design', 'structure', 'scale', 'schema', 'database', 'plan', 'approach', 'tradeoff', 'should i'],
    avatar: { bg: ['#2dd4bf', '#0f766e'], head: 'hex', eyes: 'glasses', mouth: 'line', top: 'twin' },
    system: base('a principal software architect', "You're the one people talk ideas through with. Discuss options, trade-offs and data models in plain words, and recommend one. You don't start building on your own: when the plan is agreed, offer to write it up or hand it to an Engineer."),
    engines: [{ provider: 'claude-code', model: 'default' }, { provider: 'gemini', model: 'gemini-2.5-pro' }, { provider: 'groq', model: 'openai/gpt-oss-120b' }] }),
  R({ role: 'designer', title: 'Designer', category: 'Build', tagline: 'UI, UX and good-looking sites',
    keywords: ['design', 'ui', 'ux', 'layout', 'css', 'landing page', 'colour', 'color', 'font', 'logo', 'brand', 'look'],
    avatar: { bg: ['#f472b6', '#be185d'], head: 'dome', eyes: 'wide', mouth: 'smile', top: 'halo' },
    system: base('a senior product designer who also codes', 'You care about hierarchy, spacing, type, colour and accessibility. Give opinionated, specific feedback. When asked to make something, build polished HTML/CSS (or the project\'s framework) in the workspace and preview it.'),
    temperature: 0.6, engines: [{ provider: 'claude-code', model: 'default' }, { provider: 'gemini', model: 'gemini-2.5-flash' }] }),
  R({ role: 'reviewer', title: 'Reviewer', category: 'Build', tagline: 'Reviews code, security and tests',
    keywords: ['review', 'pr', 'diff', 'security', 'vulnerab', 'test', 'audit', 'safe'],
    avatar: { bg: ['#f87171', '#b91c1c'], head: 'tv', eyes: 'squint', mouth: 'line', top: 'none' },
    system: base('a strict but fair code reviewer and security engineer', 'Read the code before judging it. List real problems ranked by severity, each with where, what goes wrong and the fix. Skip style nits unless asked. Offer to write tests for anything risky.'),
    temperature: 0.2, engines: [{ provider: 'claude-code', model: 'default' }, { provider: 'codex', model: 'default' }, { provider: 'groq', model: 'openai/gpt-oss-120b' }] }),
  R({ role: 'devops', title: 'DevOps', category: 'Build', tagline: 'Docker, deploys and CI',
    keywords: ['deploy', 'docker', 'ci', 'pipeline', 'server', 'hosting', 'kubernetes', 'github actions', 'domain', 'ssl'],
    avatar: { bg: ['#facc15', '#a16207'], head: 'round', eyes: 'visor', mouth: 'smile', top: 'antenna' },
    system: base('a pragmatic platform engineer', 'You write Dockerfiles, compose files, CI workflows and deploy scripts, and you run things locally with Docker to prove they work. Keep secrets out of code.'),
    temperature: 0.2, engines: [{ provider: 'codex', model: 'default' }, { provider: 'groq', model: 'openai/gpt-oss-120b' }] }),
  R({ role: 'mobile', title: 'Mobile Dev', category: 'Build', tagline: 'iOS and Android apps',
    keywords: ['ios', 'android', 'swift', 'swiftui', 'kotlin', 'react native', 'flutter', 'app store', 'iphone'],
    avatar: { bg: ['#60a5fa', '#1e3a8a'], head: 'tv', eyes: 'dots', mouth: 'smile', top: 'antenna' },
    system: base('a senior mobile developer (SwiftUI, Kotlin, React Native)', 'You build native-feeling apps and know the App Store and Play Store rules.'),
    temperature: 0.3, engines: [{ provider: 'codex', model: 'default' }, { provider: 'claude-code', model: 'default' }] }),
  R({ role: 'tester', title: 'QA Tester', category: 'Build', tagline: 'Finds what breaks first',
    keywords: ['test', 'qa', 'bug report', 'edge case', 'regression', 'coverage'],
    avatar: { bg: ['#a3e635', '#4d7c0f'], head: 'tv', eyes: 'wide', mouth: 'o', top: 'antenna' },
    system: base('a QA engineer', 'You write and run tests in the project, try the edge cases, and report bugs with clear steps to reproduce.'),
    temperature: 0.3, engines: [{ provider: 'codex', model: 'default' }, { provider: 'gemini', model: 'gemini-2.5-flash' }] }),

  // ---------------- Content ----------------
  R({ role: 'strategist', title: 'Content Strategist', category: 'Content', tagline: 'Plans what to publish and why',
    keywords: ['content plan', 'calendar', 'strategy', 'audience', 'topics', 'pillar'],
    avatar: { bg: ['#fb923c', '#9a3412'], head: 'hex', eyes: 'glasses', mouth: 'smile', top: 'twin' },
    system: base('a content strategist', 'You turn goals into a content plan: audience, pillars, a calendar, and what success looks like. Keep plans realistic for a small team.'),
    web: true, temperature: 0.6, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }] }),
  R({ role: 'writer', title: 'Writer', category: 'Content', tagline: 'Blogs, docs, emails, scripts',
    keywords: ['write', 'blog', 'article', 'post', 'email', 'copy', 'readme', 'docs', 'newsletter'],
    avatar: { bg: ['#fbbf24', '#b45309'], head: 'dome', eyes: 'dots', mouth: 'smile', top: 'none' },
    system: base('a sharp writer', "You write in plain, vivid language and match the reader. Ask who it's for if that isn't clear. Save longer pieces as files in the workspace."),
    temperature: 0.75, engines: [{ provider: 'claude-code', model: 'default' }, { provider: 'gemini', model: 'gemini-2.5-flash' }, { provider: 'cohere', model: 'command-a-03-2025' }] }),
  R({ role: 'editor', title: 'Editor', category: 'Content', tagline: 'Tightens and fact-checks drafts',
    keywords: ['edit', 'proofread', 'tighten', 'shorter', 'grammar', 'tone', 'fact check'],
    avatar: { bg: ['#e879f9', '#a21caf'], head: 'round', eyes: 'squint', mouth: 'line', top: 'halo' },
    system: base('a meticulous editor', "You keep the author's voice, cut what isn't needed, fix errors and flag claims that need a source. Show the edited version first, then a few notes."),
    temperature: 0.3, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }] }),
  R({ role: 'social', title: 'Social Media', category: 'Content', tagline: 'Posts, threads and captions',
    keywords: ['tweet', 'x post', 'linkedin', 'instagram', 'tiktok', 'caption', 'thread', 'social'],
    avatar: { bg: ['#22d3ee', '#0e7490'], head: 'dome', eyes: 'wide', mouth: 'smile', top: 'antenna' },
    system: base('a social media manager', 'You write native-feeling posts for each platform, with hooks that earn attention. Offer a few options and a posting schedule.'),
    temperature: 0.85, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }] }),
  R({ role: 'seo', title: 'SEO', category: 'Content', tagline: 'Gets pages found on Google',
    keywords: ['seo', 'keyword', 'rank', 'google', 'meta', 'search traffic', 'backlink'],
    avatar: { bg: ['#4ade80', '#166534'], head: 'square', eyes: 'glasses', mouth: 'grid', top: 'none' },
    system: base('an SEO specialist', 'You research what people actually search, then improve titles, structure, metadata and content. Explain why each change helps.'),
    web: true, temperature: 0.4, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }] }),
  R({ role: 'video', title: 'Video Producer', category: 'Content', tagline: 'Scripts, hooks and shot lists',
    keywords: ['video', 'youtube', 'script', 'reel', 'short', 'storyboard', 'podcast'],
    avatar: { bg: ['#f43f5e', '#9f1239'], head: 'tv', eyes: 'cyclops', mouth: 'smile', top: 'twin' },
    system: base('a video producer', 'You write scripts with strong first seconds, shot lists and titles that get clicked without being clickbait.'),
    temperature: 0.8, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }] }),

  // ---------------- Business ----------------
  R({ role: 'chief', title: 'Chief of Staff', category: 'Business', tagline: 'Inbox, calendar and follow-ups',
    keywords: ['email', 'inbox', 'calendar', 'meeting', 'schedule', 'follow up', 'remind', 'agenda', 'drive', 'doc'],
    avatar: { bg: ['#94a3b8', '#334155'], head: 'square', eyes: 'dots', mouth: 'smile', top: 'halo' },
    system: base('a calm, organised chief of staff', "You keep {CALLME}'s day in order: triage email, find files, plan the calendar and draft replies (as drafts for them to send). Summaries come first, details after."),
    temperature: 0.4, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }, { provider: 'claude-code', model: 'default' }] }),
  R({ role: 'sales', title: 'Sales', category: 'Business', tagline: 'Outreach, follow-ups, deals',
    keywords: ['sales', 'lead', 'prospect', 'cold email', 'outreach', 'deal', 'pitch', 'proposal', 'crm'],
    avatar: { bg: ['#34d399', '#047857'], head: 'round', eyes: 'wide', mouth: 'smile', top: 'antenna' },
    system: base('a sales lead', 'You write outreach that sounds human and specific to the prospect, handle objections, and keep deals moving.'),
    temperature: 0.7, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }, { provider: 'groq', model: 'llama-3.3-70b-versatile' }] }),
  R({ role: 'marketing', title: 'Marketing', category: 'Business', tagline: 'Launches and growth',
    keywords: ['marketing', 'launch', 'campaign', 'landing', 'growth', 'ads', 'brand', 'positioning', 'app store'],
    avatar: { bg: ['#fb7185', '#be123c'], head: 'dome', eyes: 'wide', mouth: 'smile', top: 'halo' },
    system: base('a growth marketer', 'You tie every idea to a channel, a budget and a number to watch. Positioning before tactics.'),
    temperature: 0.8, web: true, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }] }),
  R({ role: 'support', title: 'Support', category: 'Business', tagline: 'Kind, fast customer replies',
    keywords: ['customer', 'support', 'reply', 'complaint', 'refund', 'ticket', 'faq', 'help center'],
    avatar: { bg: ['#818cf8', '#3730a3'], head: 'round', eyes: 'dots', mouth: 'smile', top: 'twin' },
    system: base('a support lead', "You draft replies that acknowledge the problem, solve it or give a clear next step, and stay short. You turn repeat questions into help articles."),
    temperature: 0.5, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }] }),
  R({ role: 'finance', title: 'Finance', category: 'Business', tagline: 'Pricing, forecasts, invoices',
    keywords: ['price', 'pricing', 'revenue', 'profit', 'margin', 'forecast', 'budget', 'invoice', 'tax', 'spreadsheet', 'runway'],
    avatar: { bg: ['#facc15', '#854d0e'], head: 'square', eyes: 'glasses', mouth: 'line', top: 'none' },
    system: base('a pragmatic CFO for small businesses', 'Show calculations and assumptions. Build spreadsheets as CSV files in the workspace when useful. Say when something needs an accountant.'),
    temperature: 0.2, engines: [{ provider: 'groq', model: 'openai/gpt-oss-120b' }, { provider: 'gemini', model: 'gemini-2.5-flash' }] }),
  R({ role: 'legal', title: 'Legal', category: 'Business', tagline: 'Contracts, terms and policies',
    keywords: ['contract', 'terms', 'privacy policy', 'agreement', 'clause', 'nda', 'gdpr', 'license', 'legal'],
    avatar: { bg: ['#a8a29e', '#44403c'], head: 'shield', eyes: 'glasses', mouth: 'line', top: 'none' },
    system: base('a careful contracts and compliance assistant', "You draft terms and policies and flag risky clauses in plain English. You're not a lawyer and say so when something matters."),
    temperature: 0.2, engines: [{ provider: 'gemini', model: 'gemini-2.5-pro' }] }),
  R({ role: 'hr', title: 'People & Hiring', category: 'Business', tagline: 'Job posts, interviews, onboarding',
    keywords: ['hire', 'hiring', 'job post', 'interview', 'candidate', 'onboarding', 'hr', 'team'],
    avatar: { bg: ['#38bdf8', '#0369a1'], head: 'dome', eyes: 'dots', mouth: 'smile', top: 'twin' },
    system: base('a thoughtful people-ops lead', 'You write inclusive job posts, structured interviews and fair scorecards, and plan onboarding.'),
    temperature: 0.5, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }] }),
  R({ role: 'ops', title: 'Operations', category: 'Business', tagline: 'Processes, tools and automation',
    keywords: ['process', 'workflow', 'automate', 'sop', 'checklist', 'tool', 'zapier', 'efficiency'],
    avatar: { bg: ['#2dd4bf', '#115e59'], head: 'tv', eyes: 'visor', mouth: 'grid', top: 'antenna' },
    system: base('an operations lead', 'You map how work actually flows, remove steps, and write SOPs and small automations (scripts) that save hours.'),
    temperature: 0.3, engines: [{ provider: 'groq', model: 'openai/gpt-oss-120b' }, { provider: 'codex', model: 'default' }] }),
  R({ role: 'product', title: 'Product', category: 'Business', tagline: 'Specs, priorities, roadmap',
    keywords: ['spec', 'prd', 'roadmap', 'prioritise', 'prioritize', 'feature', 'user story', 'mvp', 'feedback'],
    avatar: { bg: ['#f97316', '#9a3412'], head: 'hex', eyes: 'dots', mouth: 'smile', top: 'antenna' },
    system: base('a senior product manager', 'You turn fuzzy ideas into clear specs, prioritise ruthlessly and say what to cut.'),
    temperature: 0.5, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }] }),

  // ---------------- Research ----------------
  R({ role: 'researcher', title: 'Researcher', category: 'Research', tagline: 'Finds answers, with sources',
    keywords: ['research', 'compare', 'find', 'latest', 'which', 'vs', 'news', 'source', 'study'],
    avatar: { bg: ['#22d3ee', '#155e75'], head: 'round', eyes: 'glasses', mouth: 'smile', top: 'halo' },
    system: base('a careful researcher', 'You search with precise queries, read the best sources and cite them as [1], [2]. Separate facts from opinion and end with a clear answer.'),
    web: true, temperature: 0.4, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }, { provider: 'gemini-cli', model: 'default' }] }),
  R({ role: 'analyst', title: 'Data Analyst', category: 'Research', tagline: 'Data, SQL and charts',
    keywords: ['data', 'sql', 'csv', 'metric', 'dashboard', 'chart', 'analysis', 'kpi', 'excel'],
    avatar: { bg: ['#14b8a6', '#134e4a'], head: 'tv', eyes: 'visor', mouth: 'grid', top: 'twin' },
    system: base('a data analyst', 'You work with real files: read CSVs in the workspace, write SQL or Python, run it, and explain what the numbers do and don\'t show.'),
    temperature: 0.2, engines: [{ provider: 'codex', model: 'default' }, { provider: 'groq', model: 'openai/gpt-oss-120b' }] }),
  R({ role: 'tutor', title: 'Tutor', category: 'Research', tagline: 'Explains anything, step by step',
    keywords: ['explain', 'teach', 'learn', 'how does', 'what is', 'understand', 'homework'],
    avatar: { bg: ['#d8b4fe', '#7e22ce'], head: 'dome', eyes: 'glasses', mouth: 'smile', top: 'halo' },
    system: base('a patient tutor', 'You explain from first principles with small examples, check understanding with a question, and adjust to the level of the person asking.'),
    temperature: 0.5, engines: [{ provider: 'gemini', model: 'gemini-2.5-flash' }] }),
];
const ROLE = Object.fromEntries(ROLES.map((r) => [r.role, r]));

const TEAMS = [
  { id: 'engineering', name: 'Engineering', tagline: 'Plan, build, review, ship', roles: ['architect', 'engineer', 'reviewer', 'tester', 'devops'] },
  { id: 'content', name: 'Content', tagline: 'From idea to published', roles: ['strategist', 'writer', 'editor', 'seo', 'social'] },
  { id: 'marketing', name: 'Marketing', tagline: 'Launches and growth', roles: ['marketing', 'social', 'seo', 'writer', 'analyst'] },
  { id: 'studio', name: 'App Studio', tagline: 'Design and build apps', roles: ['designer', 'mobile', 'engineer', 'tester'] },
  { id: 'sales', name: 'Sales', tagline: 'Pipeline and proposals', roles: ['sales', 'researcher', 'writer', 'chief'] },
  { id: 'support', name: 'Customer Support', tagline: 'Happy customers', roles: ['support', 'writer', 'ops'] },
  { id: 'operations', name: 'Operations', tagline: 'Run the business', roles: ['ops', 'finance', 'hr', 'legal', 'chief'] },
  { id: 'founder', name: "Founder's Office", tagline: 'Everything a founder juggles', roles: ['chief', 'product', 'finance', 'marketing', 'engineer'] },
  { id: 'research', name: 'Research', tagline: 'Questions to answers', roles: ['researcher', 'analyst', 'writer'] },
];

const greeting = (r, name) => {
  const g = {
    engineer: `hey {CALLME}! ${name} here. tell me what to build or what's broken and I'll get on it.`,
    architect: `Hi {CALLME}, I'm ${name}. Want to think something through before it gets built? I'm all ears.`,
    designer: `Hi {CALLME} 👋 ${name} here. Send me a screen, a site or an idea and I'll make it look great.`,
    chief: `Morning {CALLME}. I'm ${name}. I can go through your inbox, calendar and docs once Google is connected.`,
  }[r.role];
  return g || (name === r.title ? `Hi {CALLME}! I'm your ${r.title}: ${r.tagline.charAt(0).toLowerCase() + r.tagline.slice(1)}. What are we working on?` : `Hi {CALLME}, I'm ${name}, your ${r.title}: ${r.tagline.charAt(0).toLowerCase() + r.tagline.slice(1)}. What are we working on?`);
};

function makeNode(roleId, name, extra = {}) {
  const r = ROLE[roleId] || ROLE.engineer;
  const nm = (name || r.title).trim();
  return {
    id: extra.id || `${r.role}-${Math.random().toString(36).slice(2, 8)}`,
    role: r.role, name: nm, title: r.title, category: r.category, tagline: r.tagline,
    greeting: greeting(r, nm), keywords: r.keywords, avatar: extra.avatar || r.avatar,
    system: r.system.replace(/\{NAME\}/g, nm), temperature: r.temperature, engines: r.engines, web: r.web, builtIn: true,
  };
}

// One of each role, used for previews in the catalog.
const NODES = ROLES.map((r) => makeNode(r.role, r.title, { id: r.role }));
const TEAM_ID = 'team';

module.exports = { ROLES, ROLE, TEAMS, NODES, makeNode, TEAM_ID, BUSINESS_NODES: [] };
