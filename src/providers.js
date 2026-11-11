// Catalog of every AI provider Relay can talk to.
// kind: 'openai' = OpenAI-compatible /chat/completions, 'anthropic' = native Messages API.
// free: true when the provider has a real free tier (no card needed).
// keyless: true when it works with no key at all.

const PROVIDERS = [
  // Coding CLIs: run on the user's own subscriptions. Usable once installed and signed in.
  { id: 'codex', name: 'Codex', kind: 'cli', keyless: true, cliEngine: true, note: 'Runs OpenAI Codex with your ChatGPT sign-in. Can read your project folder.', models: ['default'] },
  { id: 'claude-code', name: 'Claude Code', kind: 'cli', keyless: true, cliEngine: true, note: 'Runs Claude Code with your Claude sign-in. Can read your project folder.', models: ['default', 'sonnet', 'opus', 'haiku'] },
  { id: 'gemini-cli', name: 'Gemini CLI', kind: 'cli', keyless: true, free: true, cliEngine: true, note: 'Runs Gemini CLI with your Google sign-in. Free daily quota.', models: ['default', 'gemini-2.5-pro', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'] },
  { id: 'qwen-code', name: 'Qwen Code', kind: 'cli', keyless: true, free: true, cliEngine: true, note: 'Runs Qwen Code with your Qwen sign-in or local models.', models: ['default'] },
  { id: 'cursor-agent', name: 'Cursor', kind: 'cli', keyless: true, cliEngine: true, note: 'Runs the Cursor agent with your Cursor plan.', models: ['default'] },
  { id: 'opencode', name: 'OpenCode', kind: 'cli', keyless: true, cliEngine: true, note: 'Runs OpenCode with whatever providers it has set up.', models: ['default'] },
  {
    id: 'groq', name: 'Groq', kind: 'openai', free: true,
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    note: 'Free tier. Extremely fast Llama, GPT-OSS, Qwen and Kimi models.',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'],
  },
  {
    id: 'gemini', name: 'Google Gemini', kind: 'openai', free: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Free tier from Google AI Studio. Long context, strong reasoning.',
    models: ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
  },
  {
    id: 'cerebras', name: 'Cerebras', kind: 'openai', free: true,
    baseUrl: 'https://api.cerebras.ai/v1',
    keyUrl: 'https://cloud.cerebras.ai/',
    note: 'Free tier. The fastest inference available.',
    models: ['gpt-oss-120b', 'llama-3.3-70b', 'qwen-3-235b-a22b-instruct-2507', 'qwen-3-32b', 'llama3.1-8b'],
  },
  {
    id: 'openrouter', name: 'OpenRouter', kind: 'openai', free: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'One key, hundreds of models. Every model ending in ":free" costs nothing.',
    headers: { 'HTTP-Referer': 'https://athenesoftworks.com', 'X-Title': 'Relay' },
    freeFilter: ':free',
    models: ['deepseek/deepseek-chat-v3-0324:free', 'qwen/qwen3-coder:free', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-r1-0528:free', 'moonshotai/kimi-k2:free', 'z-ai/glm-4.5-air:free', 'google/gemma-3-27b-it:free', 'mistralai/mistral-small-3.2-24b-instruct:free', 'openai/gpt-oss-20b:free'],
  },
  {
    id: 'mistral', name: 'Mistral', kind: 'openai', free: true,
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    note: 'Free "Experiment" plan. Includes Codestral for coding.',
    models: ['mistral-small-latest', 'mistral-large-latest', 'codestral-latest', 'magistral-small-latest', 'open-mistral-nemo'],
  },
  {
    id: 'github', name: 'GitHub Models', kind: 'openai', free: true,
    baseUrl: 'https://models.github.ai/inference',
    keyUrl: 'https://github.com/settings/personal-access-tokens',
    keyLabel: 'GitHub token (Models: read)',
    note: 'Free with any GitHub account. GPT-4.1, Llama, DeepSeek, Phi and more.',
    models: ['openai/gpt-4.1', 'openai/gpt-4.1-mini', 'openai/gpt-4o-mini', 'deepseek/DeepSeek-V3-0324', 'meta/Llama-3.3-70B-Instruct', 'microsoft/Phi-4'],
  },
  {
    id: 'sambanova', name: 'SambaNova', kind: 'openai', free: true,
    baseUrl: 'https://api.sambanova.ai/v1',
    keyUrl: 'https://cloud.sambanova.ai/apis',
    note: 'Free tier. Fast DeepSeek and Llama.',
    models: ['DeepSeek-V3-0324', 'Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1', 'Llama-4-Maverick-17B-128E-Instruct'],
  },
  {
    id: 'nvidia', name: 'NVIDIA NIM', kind: 'openai', free: true,
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyUrl: 'https://build.nvidia.com/',
    note: 'Free developer credits. Huge catalog including Qwen3 Coder and Kimi K2.',
    models: ['meta/llama-3.3-70b-instruct', 'qwen/qwen3-coder-480b-a35b-instruct', 'moonshotai/kimi-k2-instruct', 'deepseek-ai/deepseek-r1'],
  },
  {
    id: 'huggingface', name: 'Hugging Face', kind: 'openai', free: true,
    baseUrl: 'https://router.huggingface.co/v1',
    keyUrl: 'https://huggingface.co/settings/tokens',
    note: 'Free monthly credits across many inference partners.',
    models: ['openai/gpt-oss-120b', 'meta-llama/Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-V3-0324', 'Qwen/Qwen3-Coder-480B-A35B-Instruct'],
  },
  {
    id: 'cohere', name: 'Cohere', kind: 'openai', free: true,
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
    note: 'Free trial key. Command A is great at writing and RAG.',
    models: ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r7b-12-2024'],
  },
  {
    id: 'zai', name: 'Z.ai (GLM)', kind: 'openai', free: true,
    baseUrl: 'https://api.z.ai/api/paas/v4',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    note: 'GLM-4.5-Flash is free.',
    models: ['glm-4.5-flash', 'glm-4.5-air', 'glm-4.5'],
  },
  {
    id: 'together', name: 'Together AI', kind: 'openai', free: true,
    baseUrl: 'https://api.together.xyz/v1',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    note: 'Has permanently free Llama 3.3 70B and DeepSeek R1 Distill endpoints.',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free'],
  },
  {
    id: 'cloudflare', name: 'Cloudflare Workers AI', kind: 'openai', free: true,
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1',
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    extraFields: [{ id: 'accountId', label: 'Account ID' }],
    note: '10,000 free requests a day. Needs your account ID too.',
    models: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-120b', '@cf/qwen/qwen2.5-coder-32b-instruct'],
  },
  {
    id: 'chutes', name: 'Chutes', kind: 'openai', free: true,
    baseUrl: 'https://llm.chutes.ai/v1',
    keyUrl: 'https://chutes.ai/app/api',
    note: 'Community GPU network with free open models.',
    models: ['deepseek-ai/DeepSeek-V3-0324', 'Qwen/Qwen3-235B-A22B', 'zai-org/GLM-4.5-Air'],
  },
  {
    id: 'pollinations', name: 'Pollinations', kind: 'openai', free: true, keyless: true,
    chatUrl: 'https://text.pollinations.ai/openai',
    keyUrl: 'https://auth.pollinations.ai/',
    note: 'Works with no key at all. Relay always has this as a last resort.',
    models: ['openai'],
  },
  // Paid / bring-your-own-key
  {
    id: 'openai', name: 'OpenAI', kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: 'GPT models. Paid.',
    models: ['gpt-5-mini', 'gpt-5', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini', 'gpt-4o-mini'],
  },
  {
    id: 'anthropic', name: 'Anthropic', kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: 'Claude models with your own key. Paid.',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
  },
  {
    id: 'xai', name: 'xAI Grok', kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai/',
    note: 'Grok models. Paid, with occasional free credits.',
    models: ['grok-4', 'grok-4-fast', 'grok-code-fast-1', 'grok-3-mini'],
  },
  {
    id: 'deepseek', name: 'DeepSeek', kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'Very cheap. Chat and Reasoner.',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'perplexity', name: 'Perplexity', kind: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    keyUrl: 'https://www.perplexity.ai/settings/api',
    note: 'Sonar models with built-in web search. Paid.',
    models: ['sonar', 'sonar-pro', 'sonar-reasoning'],
  },
  {
    id: 'moonshot', name: 'Moonshot (Kimi)', kind: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    note: 'Kimi K2. Cheap, strong at agentic coding.',
    models: ['kimi-k2-0905-preview', 'kimi-latest'],
  },
  // Local
  {
    id: 'ollama', name: 'Ollama (local)', kind: 'openai', local: true, keyless: true, free: true,
    baseUrl: 'http://localhost:11434/v1',
    keyUrl: 'https://ollama.com/download',
    note: 'Runs models on this Mac. Private and unlimited. Click "Fetch models" after pulling some.',
    models: ['llama3.2', 'qwen2.5-coder', 'gemma3'],
  },
  {
    id: 'lmstudio', name: 'LM Studio (local)', kind: 'openai', local: true, keyless: true, free: true,
    baseUrl: 'http://localhost:1234/v1',
    keyUrl: 'https://lmstudio.ai/',
    note: 'Runs models on this Mac through LM Studio\'s local server.',
    models: ['local-model'],
  },
  {
    id: 'custom', name: 'Custom endpoint', kind: 'openai', custom: true,
    baseUrl: '',
    keyUrl: '',
    extraFields: [{ id: 'baseUrl', label: 'Base URL (OpenAI-compatible, ending in /v1)' }],
    note: 'Any OpenAI-compatible server: vLLM, LiteLLM, Fireworks, DeepInfra, Novita, and so on.',
    models: [],
  },
];

const byId = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

// Approximate context windows (tokens) for the token meter.
function contextWindow(provider, model) {
  const m = String(model || '').toLowerCase();
  if (provider === 'codex') return 272000;
  if (provider === 'claude-code' || m.includes('claude') || ['sonnet', 'opus', 'haiku'].includes(m)) return 200000;
  if (provider === 'gemini-cli' || m.includes('gemini')) return 1048576;
  if (m.includes('gpt-4.1')) return 1047576;
  if (m.includes('gpt-5')) return 400000;
  if (m.includes('qwen3-coder') || m.includes('qwen-3-235b') || m.includes('kimi-k2-0905')) return 262144;
  if (m.includes('command-a')) return 256000;
  if (m.includes('grok-4')) return 256000;
  if (m.includes('llama-4')) return 131072;
  if (m.includes('llama3.1-8b') || m.includes('qwen-3-32b')) return 65536;
  if (provider === 'pollinations') return 32768;
  if (provider === 'ollama' || provider === 'lmstudio') return 32768;
  return 131072;
}

module.exports = { PROVIDERS, byId, contextWindow };
