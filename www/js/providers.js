// Provider adapters (run on the phone, calling the provider directly with the user's own key).
//
// stream({ provider, apiKey, apiModel, system, messages, tools, maxTokens, think, signal })
// is an async generator yielding:
//   { t:'delta', text }                    answer text
//   { t:'thought', text }                  reasoning text
//   { t:'call', id, name, args }           a tool call
//   { t:'raw', blocks }                    provider-specific blocks that must be sent back (Anthropic thinking)
//   { t:'usage', in, out, cached }
//   { t:'notice', text }                   something the UI should tell the user
//
// messages (neutral format):
//   { role:'user', text, images?:[{mime,data}] }
//   { role:'assistant', text, calls?:[{id,name,args}], raw?:[...], reasoning? }
//   { role:'tool', callId, name, content }
import { httpStream } from './native.js';

const BUDGET = { low: 2048, medium: 6000, high: 16000 };
const EFFORT = { low: 'low', medium: 'medium', high: 'high' };

async function* sseEvents(body) {
  let buf = '';
  for await (const chunk of body) {
    buf += chunk;
    for (;;) {
      const m = /\r?\n\r?\n/.exec(buf);
      if (!m) break;
      const block = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const data = [];
      block.split(/\r?\n/).forEach((l) => { if (l.startsWith('data:')) data.push(l.slice(5).replace(/^ /, '')); });
      if (data.length) yield data.join('\n');
    }
  }
  const tail = buf.trim();
  if (tail.startsWith('data:')) yield tail.slice(5).trim();
}

async function readAll(body) {
  let s = '';
  for await (const c of body) s += c;
  return s;
}

function httpError(status, text) {
  let detail = String(text || '').slice(0, 600);
  try {
    const j = JSON.parse(text);
    const e = j && (j.error || j);
    detail = (e && (e.message || (typeof e === 'string' ? e : ''))) || detail;
  } catch (e) { /* keep raw text */ }
  let hint = '';
  if (status === 401 || status === 403) hint = ' Check your API key in Settings.';
  if (status === 429) hint = ' Rate limit or no credit left on this key.';
  if (/image|vision|multimodal|modalit/i.test(detail) && /not support|unsupported|invalid|cannot|does not|only text|text-only|no support/i.test(detail)) hint = ' This model cannot read pictures. Remove the picture or switch to a vision model.' + hint;
  const err = new Error('Provider error ' + status + (detail ? ': ' + detail : '') + hint);
  err.status = status;
  return err;
}

/** Best guess whether a model can read pictures. Only well-known text-only families answer false. */
export function likelySeesImages(apiModel) {
  const id = String(apiModel || '').toLowerCase();
  if (/vision|vl\b|-vl-|llava|pixtral|gemini|claude|gpt-4o|gpt-4\.1|gpt-5|gpt-4-turbo|o3\b|o4|omni|llama-?4|kimi-k2\.?[5-9]|glm-4\.?[5-9]v|qwen.*(vl|omni)/.test(id)) return true;
  if (/deepseek|gpt-3\.5|o1-mini|o3-mini|coder|codestral|qwq|mistral-(7b|small|large|medium)|mixtral|command-r|gemma-?[12]\b|llama-?[23]|phi-?[1-3]|kimi|glm|minimax|qwen|sonar|text-|instruct/.test(id)) return false;
  return true;
}

const trimBase = (u) => String(u || '').replace(/\/+$/, '');

// ------------------------------------------------------------------ OpenAI-compatible
function openaiMessages(system, messages, passReasoning) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  let pendingImgs = [];
  messages.forEach((m, i) => {
    if (m.role === 'user') {
      if (m.images && m.images.length) {
        const parts = [];
        if (m.text) parts.push({ type: 'text', text: m.text });
        m.images.forEach((im) => parts.push({ type: 'image_url', image_url: { url: 'data:' + im.mime + ';base64,' + im.data } }));
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: m.text || ' ' });
      }
    } else if (m.role === 'assistant') {
      const o = { role: 'assistant', content: m.text || (m.calls && m.calls.length ? null : ' ') };
      if (m.calls && m.calls.length) {
        o.tool_calls = m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
        if (passReasoning && m.reasoning) o.reasoning_content = m.reasoning;
      }
      out.push(o);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.callId, content: m.content || ' ' });
      if (m.images && m.images.length) pendingImgs.push(...m.images);
    }
    // a tool message cannot hold pictures here, so they follow as one user message after the run of tool results
    const nxt = messages[i + 1];
    if (pendingImgs.length && !(nxt && nxt.role === 'tool')) {
      out.push({ role: 'user', content: [{ type: 'text', text: '(Picture from the view_image tool)' }].concat(pendingImgs.map((im) => ({ type: 'image_url', image_url: { url: 'data:' + im.mime + ';base64,' + im.data } }))) });
      pendingImgs = [];
    }
  });
  return out;
}

async function* openaiStream(o) {
  const { provider, apiKey, apiModel, system, messages, tools, maxTokens, think, signal } = o;
  const base = trimBase(provider.baseUrl);
  const isOpenAI = /api\.openai\.com/.test(base);
  const passReasoning = /deepseek/i.test(base) || provider.passReasoning === true;
  const flags = { usage: true, effort: EFFORT[think] || '', maxParam: isOpenAI ? 'max_completion_tokens' : 'max_tokens' };
  const msgs = openaiMessages(system, messages, passReasoning);

  let res = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const body = { model: apiModel, messages: msgs, stream: true };
    if (flags.usage) body.stream_options = { include_usage: true };
    if (maxTokens) body[flags.maxParam] = maxTokens;
    if (flags.effort) body.reasoning_effort = flags.effort;
    if (tools && tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    res = await httpStream({
      url: base + '/chat/completions', method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
    });
    if (res.status < 400) break;
    const text = await readAll(res.body);
    if (res.status !== 400 && res.status !== 422) throw httpError(res.status, text);
    if (flags.usage && /stream_options|include_usage/i.test(text)) { flags.usage = false; continue; }
    if (flags.effort && /reasoning|effort|thinking/i.test(text)) { flags.effort = ''; yield { t: 'notice', text: 'This model does not support thinking. Answering without it.' }; continue; }
    if (flags.maxParam === 'max_tokens' && /max_completion_tokens/i.test(text)) { flags.maxParam = 'max_completion_tokens'; continue; }
    if (flags.maxParam === 'max_completion_tokens' && /max_tokens/i.test(text) && !/max_completion_tokens/i.test(text)) { flags.maxParam = 'max_tokens'; continue; }
    throw httpError(res.status, text);
  }

  const calls = [];
  let reasoning = '';
  for await (const data of sseEvents(res.body)) {
    const payload = data.trim();
    if (!payload) continue;
    if (payload === '[DONE]') break;
    let j;
    try { j = JSON.parse(payload); } catch (e) { continue; }
    if (j.error) throw new Error(typeof j.error === 'string' ? j.error : j.error.message || 'Provider error');
    const ch = j.choices && j.choices[0];
    const d = ch && ch.delta;
    if (d) {
      const rs = d.reasoning_content || d.reasoning;
      if (typeof rs === 'string' && rs) { reasoning += rs; yield { t: 'thought', text: rs }; }
      if (typeof d.content === 'string' && d.content) yield { t: 'delta', text: d.content };
      if (Array.isArray(d.tool_calls)) {
        d.tool_calls.forEach((tc) => {
          const i = tc.index == null ? 0 : tc.index;
          const cur = calls[i] || (calls[i] = { id: '', name: '', args: '' });
          if (tc.id) cur.id = tc.id;
          if (tc.function) {
            if (tc.function.name) cur.name += tc.function.name;
            if (tc.function.arguments) cur.args += tc.function.arguments;
          }
        });
      }
    }
    if (j.usage) {
      const cached = j.usage.prompt_tokens_details && j.usage.prompt_tokens_details.cached_tokens;
      yield { t: 'usage', in: j.usage.prompt_tokens || 0, out: j.usage.completion_tokens || 0, cached: cached || 0 };
    }
  }
  for (const c of calls) {
    if (!c) continue;
    let args = {};
    let bad = false;
    try { args = c.args ? JSON.parse(c.args) : {}; } catch (e) { bad = true; }
    yield { t: 'call', id: c.id || 'call_' + Math.random().toString(36).slice(2, 10), name: c.name, args, bad };
  }
  if (reasoning && calls.length) yield { t: 'reasoning', text: reasoning };
}

// ------------------------------------------------------------------ Anthropic
function anthropicMessages(messages, withThinking) {
  const out = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  messages.forEach((m) => {
    if (m.role === 'user') {
      const blocks = [];
      (m.images || []).forEach((im) => blocks.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } }));
      blocks.push({ type: 'text', text: m.text || ' ' });
      push('user', blocks);
    } else if (m.role === 'assistant') {
      const blocks = [];
      if (withThinking && m.raw && m.raw.length) m.raw.forEach((b) => blocks.push(b));
      if (m.text) blocks.push({ type: 'text', text: m.text });
      (m.calls || []).forEach((c) => blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} }));
      push('assistant', blocks);
    } else if (m.role === 'tool') {
      const last = out[out.length - 1];
      const block = { type: 'tool_result', tool_use_id: m.callId, content: m.content || ' ' };
      if (m.images && m.images.length) block.content = m.images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })).concat([{ type: 'text', text: m.content || ' ' }]);
      if (last && last.role === 'user') {
        // tool results must come before any other content of the same user turn
        let i = 0;
        while (i < last.content.length && last.content[i].type === 'tool_result') i++;
        last.content.splice(i, 0, block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  });
  return out;
}

async function* anthropicStream(o) {
  const { provider, apiKey, apiModel, system, messages, tools, maxTokens, think, signal } = o;
  const base = trimBase(provider.baseUrl);
  let thinkOn = !!BUDGET[think];

  let res = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const msgs = anthropicMessages(messages, thinkOn);
    // cache the stable prefix: everything before the newest turn
    if (msgs.length >= 2) {
      const prev = msgs[msgs.length - 2];
      const lastBlock = prev.content[prev.content.length - 1];
      if (lastBlock && lastBlock.type !== 'thinking' && lastBlock.type !== 'redacted_thinking') lastBlock.cache_control = { type: 'ephemeral' };
    }
    const body = { model: apiModel, max_tokens: maxTokens || 8192, stream: true, messages: msgs };
    if (system) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    if (tools && tools.length) {
      body.tools = tools.map((t, i) => {
        const x = { name: t.name, description: t.description, input_schema: t.parameters };
        if (i === tools.length - 1) x.cache_control = { type: 'ephemeral' };
        return x;
      });
    }
    if (thinkOn) {
      body.thinking = { type: 'enabled', budget_tokens: BUDGET[think] };
      body.max_tokens = Math.max(body.max_tokens, BUDGET[think] + 2048);
    }
    res = await httpStream({
      url: base + '/v1/messages', method: 'POST', signal,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status < 400) break;
    const text = await readAll(res.body);
    if (thinkOn && (res.status === 400 || res.status === 422) && /thinking|budget/i.test(text)) {
      thinkOn = false;
      yield { t: 'notice', text: 'This model does not support thinking. Answering without it.' };
      continue;
    }
    throw httpError(res.status, text);
  }

  let tin = 0; let tout = 0; let cached = 0;
  const blocks = [];
  for await (const data of sseEvents(res.body)) {
    let j;
    try { j = JSON.parse(data); } catch (e) { continue; }
    if (j.type === 'message_start' && j.message && j.message.usage) {
      const u = j.message.usage;
      cached = u.cache_read_input_tokens || 0;
      tin = (u.input_tokens || 0) + cached + (u.cache_creation_input_tokens || 0);
      tout = u.output_tokens || 0;
    } else if (j.type === 'content_block_start') {
      const cb = j.content_block || {};
      blocks[j.index] = { type: cb.type, id: cb.id, name: cb.name, text: '', thinking: '', signature: '', json: '', data: cb.data };
    } else if (j.type === 'content_block_delta') {
      const b = blocks[j.index];
      const d = j.delta || {};
      if (d.type === 'text_delta' && d.text) { if (b) b.text += d.text; yield { t: 'delta', text: d.text }; }
      else if (d.type === 'thinking_delta' && d.thinking) { if (b) b.thinking += d.thinking; yield { t: 'thought', text: d.thinking }; }
      else if (d.type === 'signature_delta' && b) b.signature += d.signature || '';
      else if (d.type === 'input_json_delta' && b) b.json += d.partial_json || '';
    } else if (j.type === 'message_delta' && j.usage) {
      tout = j.usage.output_tokens || tout;
    } else if (j.type === 'error') {
      throw new Error((j.error && j.error.message) || 'Provider error');
    }
  }
  const raw = [];
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === 'thinking') raw.push({ type: 'thinking', thinking: b.thinking, signature: b.signature });
    else if (b.type === 'redacted_thinking') raw.push({ type: 'redacted_thinking', data: b.data });
    else if (b.type === 'tool_use') {
      let args = {};
      let bad = false;
      try { args = b.json ? JSON.parse(b.json) : {}; } catch (e) { bad = true; }
      yield { t: 'call', id: b.id, name: b.name, args, bad };
    }
  }
  if (raw.length) yield { t: 'raw', blocks: raw };
  yield { t: 'usage', in: tin, out: tout, cached };
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
const NET_RE = /network|fetch|failed|timeout|timed out|connection|reset|offline|socket|unknownhost|unable to resolve|aborted by software/i;
const MAX_WAIT_MS = 10 * 60 * 1000;
/** Resolves after `ms`, as soon as the network comes back, or when the request is cancelled. */
function pause(ms, signal) {
  return new Promise((res) => {
    let t = null;
    const done = () => { clearTimeout(t); window.removeEventListener('online', done); if (signal) signal.removeEventListener('abort', done); res(); };
    t = setTimeout(done, ms);
    window.addEventListener('online', done, { once: true });
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
}
/**
 * One reply stream. Busy servers and rate limits are retried a few times. A dropped connection waits for the network to
 * return (up to 10 minutes) and then asks again, also when it dropped in the middle of a reply: a { t: 'restart' } event
 * tells the caller to discard the partial reply, so the work continues instead of failing.
 */
export async function* stream(opts) {
  const run = () => (opts.provider.type === 'anthropic' ? anthropicStream(opts) : openaiStream(opts));
  let busy = 0; let waited = 0; let drops = 0;
  for (;;) {
    let started = false;
    try {
      for await (const ev of run()) { started = true; yield ev; }
      if (drops) yield { t: 'notice', text: 'Back online: continued' };
      return;
    } catch (e) {
      const aborted = opts.signal && opts.signal.aborted;
      if (aborted) throw e;
      const isNet = !e.status && NET_RE.test(String((e && e.message) || e));
      const isBusy = RETRY_STATUS.has(e.status);
      if (!isNet && !isBusy) throw e;
      if (started) yield { t: 'restart' };
      if (isBusy) {
        if (++busy > 2) throw e;
        yield { t: 'notice', text: 'The provider is busy: trying again' };
        await pause(busy === 1 ? 1500 : 4000, opts.signal);
      } else {
        if (waited >= MAX_WAIT_MS) throw new Error('No connection for 10 minutes, so the request was stopped. Check the internet and send it again.');
        if (drops === 0 || drops % 6 === 0) yield { t: 'notice', text: 'No connection: waiting to reconnect' };
        const wait = Math.min(2000 * Math.pow(1.6, drops), 15000); drops++;
        const t0 = Date.now(); await pause(wait, opts.signal); waited += Date.now() - t0;
      }
      if (opts.signal && opts.signal.aborted) throw e;
    }
  }
}

/** Collect a plain-text reply (used for summaries and memory notes). */
export async function complete(opts) {
  let text = '';
  let usage = { in: 0, out: 0, cached: 0 };
  for await (const ev of stream({ ...opts, tools: null, think: 'off' })) {
    if (ev.t === 'delta') text += ev.text;
    else if (ev.t === 'usage') usage = ev;
  }
  return { text, usage };
}

/** List the model ids a key can use. Also serves as the "test my key" call. */
export async function listModels(provider, apiKey) {
  const base = trimBase(provider.baseUrl);
  const isAnthropic = provider.type === 'anthropic';
  const res = await httpStream({
    url: isAnthropic ? base + '/v1/models?limit=100' : base + '/models',
    method: 'GET',
    headers: isAnthropic
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: 'Bearer ' + apiKey },
  });
  const text = await readAll(res.body);
  if (res.status >= 400) throw httpError(res.status, text);
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('Unexpected reply from the provider'); }
  const arr = Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : [];
  const NOT_CHAT = /embed|tts|whisper|transcribe|speech|audio|realtime|image|imagen|veo|lyria|clip|dall-e|moderation|rerank|vision-only|aqa/i;
  return [...new Set(arr.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean).map((id) => id.replace(/^models\//, '')).filter((id) => !NOT_CHAT.test(id)))].sort();
}

/** The few models most people want: stable names first (no dates, previews or experiments), shorter ids first. */
export function popularModels(ids, n = 8) {
  const BAD = /(\d{4}-\d{2}-\d{2}|-\d{6,8}$|preview|exp|latest|-\d{3}$|search|codex|oss|instruct|gemma|distill)/i;
  const score = (id) => (BAD.test(id) ? 100 : 0) + id.length;
  return [...ids].sort((a, b) => score(a) - score(b)).slice(0, n);
}

export const PRESETS = [
  { key: 'anthropic', name: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', hint: 'sk-ant-...', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'] },
  { key: 'openai', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', hint: 'sk-...', models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'o4-mini'] },
  { key: 'gemini', name: 'Gemini', type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', hint: 'AIza...', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { key: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', hint: 'sk-...', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { key: 'xai', name: 'xAI', type: 'openai', baseUrl: 'https://api.x.ai/v1', hint: 'xai-...', models: ['grok-4'] },
  { key: 'custom', name: 'Custom', type: 'openai', baseUrl: '', hint: 'API key', models: [] },
];
/** One-tap fills for the Custom provider (any OpenAI-compatible service). */
export const QUICK_FILL = [
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', hint: 'sk-or-...' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', hint: 'gsk_...' },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', hint: 'API key' },
  { name: 'Together', baseUrl: 'https://api.together.xyz/v1', hint: 'API key' },
  { name: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', hint: 'any text' },
];
