// The chat engine: builds a token-cheap context, streams the reply, runs file tools in a loop,
// asks the user before every change, keeps backups for Undo, learns memory notes, records usage.
import { db, kvGet, kvSet } from './db.js';
import { secure } from './native.js';
import { stream, complete } from './providers.js';
import { TOOLS, WRITE_TOOLS, runRead, planWrite, applyWrite, undoBackup } from './tools.js';
import { estimateTokens, uid, dayKey } from './util.js';
import { isRepo } from './git.js';
import { TERMUX_TOOLS, TERMUX_ACTIONS, previewTermux, runTermux, getTermuxPath } from './termux.js';
import { ARCHIVE_TOOLS, ARCHIVE_ACTIONS, previewArchive, runArchive } from './archive.js';
import { GIT_TOOLS, GIT_READS, GIT_ACTIONS, runGitRead, previewGitAction, runGitAction } from './gittools.js';

export const BUDGETS = { economy: 4000, balanced: 12000, full: 60000 };

// ------------------------------------------------------------------ settings & models
export const defaults = { theme: 'system', mode: 'balanced', maxSteps: 20, autoApply: false, maxOut: 8000, instructions: '', autoLearn: true, defaultModel: '', defaultThink: 'off', termux: false };

export async function getSettings() {
  return { ...defaults, ...(await kvGet('settings', {})) };
}
export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await kvSet('settings', next);
  return next;
}

export const getProviders = () => kvGet('providers', []);
export const saveProviders = (list) => kvSet('providers', list);
export const getModels = () => kvGet('models', []);
export const saveModels = (list) => kvSet('models', list);
export const getFolders = () => kvGet('folders', []);
export const saveFolders = (list) => kvSet('folders', list);
export const getMemory = () => kvGet('memory', []);
export const saveMemory = (list) => kvSet('memory', list);

export const keyName = (providerId) => 'apikey:' + providerId;

export async function runtimeFor(modelId) {
  const models = await getModels();
  const m = models.find((x) => x.id === modelId) || models[0];
  if (!m) throw new Error('No model set up yet. Open Settings and add a provider.');
  const provider = (await getProviders()).find((p) => p.id === m.providerId);
  if (!provider) throw new Error('The provider for this model was removed. Pick another model.');
  const apiKey = await secure.get(keyName(provider.id));
  if (!apiKey) throw new Error('No API key saved for ' + provider.name + '. Add it in Settings.');
  return { model: m, provider, apiKey, apiModel: m.apiModel };
}

// ------------------------------------------------------------------ prices (estimates, USD per 1M tokens)
const PRICES = [
  { re: /claude-fable-5/i, in: 8, out: 40, cr: 0.2 },
  { re: /claude-opus-5/i, in: 4, out: 20, cr: 0.2 },
  { re: /claude-sonnet-5/i, in: 2, out: 10, cr: 0.1 },
  { re: /claude-haiku-5/i, in: 0.1, out: 0.5, cr: 0.01 },
];
export function costOf(apiModel, tin, tout, tcached) {
  const p = PRICES.find((x) => x.re.test(apiModel || ''));
  if (!p) return null;
  const fresh = Math.max(0, tin - tcached);
  return (fresh * p.in + tcached * p.cr + tout * p.out) / 1e6;
}
async function recordUsage(kind, rt, u) {
  if (!u || (!u.in && !u.out)) return;
  await db.put('usage', {
    day: dayKey(), at: Date.now(), kind, modelId: rt.model.id, label: rt.model.label || rt.apiModel,
    tin: u.in || 0, tout: u.out || 0, cached: u.cached || 0, cost: costOf(rt.apiModel, u.in || 0, u.out || 0, u.cached || 0),
  });
}

// ------------------------------------------------------------------ system prompt
function systemPrompt(folder, memory, summary, custom, termuxPath) {
  const parts = [
    'You are KDex Agent, an AI assistant inside an Android app. Answer in the language the user writes in. Be clear, practical and brief.',
  ];
  if (folder) {
    parts.push(
      'You are working inside the user\'s project folder "' + folder.name + '". You can list, search, read, create, edit and delete files there with the provided tools. ' +
      'All paths are relative to this folder.\n' +
      'Rules: look before you change (list_dir, find_files or search, then read_file). Prefer edit_file with a small unique "find" over rewriting a whole file. ' +
      'Do what the user asked and nothing else. The user approves every change and can undo it. ' +
      (termuxPath
        ? 'You can run shell commands with run_command in Termux (Linux on this phone); the project is at ' + termuxPath + '. Use it for unzip, installs, scripts, tests and git. Commands must exit on their own (no prompts, editors or endless servers). Check the exit code and fix failures yourself. Prefer the file tools for reading and editing files. '
        : 'You cannot run code or commands, but you do have built-in unzip and zip tools for archives; use them instead of telling the user to run a command. For anything else you cannot do, say so and tell the user what to run. ') +
      'When finished, summarize what you changed in a few lines. Do not paste file contents into the reply unless asked. ' +
      'If git tools are provided, this folder is a Git repository: use git_status/git_diff to review work, and git_commit/git_push/git_pull only when the user asks (each needs their approval). ' +
      'Read each file once; for large files use search to locate lines before reading a range. Do not repeat a read you already have.'
    );
  } else {
    parts.push('No project folder is open, so you have no file tools. If the user wants you to work on files, tell them to open a folder from Projects.');
  }
  if (custom && custom.trim()) parts.push('User instructions:\n' + custom.trim());
  if (memory.length) parts.push('What you know about the user from earlier chats (use it naturally, do not recite it):\n' + memory.map((m) => '- ' + m.text).join('\n'));
  if (summary) parts.push('Summary of the earlier part of this chat:\n' + summary);
  return parts.join('\n\n');
}

// ------------------------------------------------------------------ history -> neutral messages
function toNeutral(m, opts) {
  if (m.role === 'user') {
    const o = { role: 'user', text: m.text || '' };
    if (m.images && m.images.length) {
      if (opts.keepImages) o.images = m.images.map((i) => ({ mime: i.mime, data: i.data }));
      else o.text += '\n[image omitted to save tokens]';
    }
    return o;
  }
  if (m.role === 'assistant') {
    const calls = (m.calls || []).map((c) => {
      const args = { ...(c.args || {}) };
      if (opts.compact) {
        if (typeof args.content === 'string' && args.content.length > 300) args.content = args.content.slice(0, 200) + '\n[content omitted to save tokens]';
        ['find', 'replace'].forEach((k) => { if (typeof args[k] === 'string' && args[k].length > 300) args[k] = args[k].slice(0, 200) + ' [omitted]'; });
      }
      return { id: c.id, name: c.name, args };
    });
    return { role: 'assistant', text: m.text || '', calls, raw: m.raw, reasoning: m.reasoning };
  }
  let content = m.content || '';
  if (opts.compact && content.length > 600) content = content.slice(0, 300) + '\n[earlier tool output omitted to save tokens]';
  return { role: 'tool', callId: m.callId, name: m.name, content };
}

function weigh(m) {
  let t = estimateTokens(m.text || m.content || '') + 8;
  (m.calls || []).forEach((c) => { t += estimateTokens(JSON.stringify(c.args || {})) + 12; });
  if (m.images) t += m.images.length * 800;
  return t;
}

/** Make sure every tool call has a result (the app may have been closed mid-run). */
export async function repairHistory(chatId) {
  const msgs = (await db.byIndex('messages', 'chatId', chatId)).sort((a, b) => a.id - b.id);
  const have = new Set(msgs.filter((m) => m.role === 'tool').map((m) => m.callId));
  for (const m of msgs) {
    if (m.role === 'assistant' && m.status === 'streaming') { m.status = 'done'; await db.put('messages', m); }
    if (m.role === 'assistant') {
      for (const c of m.calls || []) {
        if (!have.has(c.id)) {
          await db.put('messages', { chatId, role: 'tool', callId: c.id, name: c.name, content: 'Cancelled: the app was closed before this finished.', status: 'cancelled', at: Date.now() });
        }
      }
    }
    if (m.role === 'tool' && m.status === 'pending') { m.status = 'cancelled'; m.content = 'Cancelled by the user.'; await db.put('messages', m); }
  }
}

async function summarize(chat, rt, dropped) {
  const fresh = dropped.filter((m) => m.id > (chat.summarizedUpto || 0));
  if (!fresh.length) return chat;
  const block = fresh.map((m) => {
    if (m.role === 'user') return 'User: ' + (m.text || '').slice(0, 1200);
    if (m.role === 'assistant') return 'Assistant: ' + (m.text || '').slice(0, 1200) + (m.calls && m.calls.length ? ' [' + m.calls.map((c) => c.name + ' ' + ((c.args && c.args.path) || '')).join(', ') + ']' : '');
    return '';
  }).filter(Boolean).join('\n').slice(0, 14000);
  try {
    const { text, usage } = await complete({
      provider: rt.provider, apiKey: rt.apiKey, apiModel: rt.apiModel,
      system: 'You maintain a compact memory of a long chat between a user and an AI assistant. You receive the previous summary (may be empty) and older messages. ' +
        'Write an UPDATED summary that keeps what is needed to continue: goals, decisions, important facts, names, file names, code identifiers, constraints and open tasks. ' +
        'Dense and factual, at most 300 words, same language as the user. Reply with the summary text only.',
      messages: [{ role: 'user', text: 'Previous summary:\n' + (chat.summary || '(none)') + '\n\nOlder messages:\n' + block }],
      maxTokens: 700,
    });
    await recordUsage('summary', rt, usage);
    chat.summary = text.trim();
    chat.summarizedUpto = fresh[fresh.length - 1].id;
    await db.put('chats', chat);
  } catch (e) { /* keep going without a new summary */ }
  return chat;
}

async function buildContext(chat, rt, folder, settings, memory) {
  const termuxPathCtx = folder && settings.termux ? await getTermuxPath(folder).catch(() => null) : null;
  const all = (await db.byIndex('messages', 'chatId', chat.id)).sort((a, b) => a.id - b.id)
    .filter((m) => !(m.role === 'assistant' && m.status === 'error'));
  const budget = BUDGETS[settings.mode] || BUDGETS.balanced;
  let lastUser = -1;
  all.forEach((m, i) => { if (m.role === 'user') lastUser = i; });

  let start = all.length;
  let used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const w = weigh(all[i]);
    if (used + w > budget && i < lastUser) break;
    used += w;
    start = i;
  }
  while (start < all.length && start < lastUser && all[start].role !== 'user') start++;
  if (start > lastUser) start = lastUser < 0 ? 0 : lastUser;

  if (start > 0) await summarize(chat, rt, all.slice(0, start));

  const userIdx = all.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0);
  const keepImgFrom = userIdx.length >= 2 ? userIdx[userIdx.length - 2] : 0;
  const msgs = all.slice(start).map((m, k) => {
    const i = start + k;
    return toNeutral(m, { compact: i < lastUser, keepImages: i >= keepImgFrom });
  });
  return { system: systemPrompt(folder, memory, chat.summary, settings.custom || settings.instructions, termuxPathCtx), messages: msgs };
}

// ------------------------------------------------------------------ memory learning
const PERSONAL_HINT = new RegExp([
  "\\b(my name|i am|i'm|im|i live|i work|i have|i own|i like|i love|i hate|i prefer|i study|i was born|call me|remember|my (wife|husband|son|daughter|brother|sister|mother|mom|father|dad|friend|birthday|business|company|job|shop|page|channel|team|dog|cat|phone|city|country|village))\\b",
  'আমার', 'আমি', 'আমাকে', 'আমরা', 'মনে রাখ', 'মনে রেখ', 'আমাদের', 'amar nam', 'amar ',
].join('|'), 'i');

const LEARN_SYSTEM =
  'You keep a short list of durable facts about a user so a chat assistant can remember them later.\n' +
  'Read the user\'s latest message. Extract ONLY lasting facts the user states about themselves or people and things in their life: ' +
  'name or nickname, city, language, job, business or project names, family or friends, tools they use, stable likes, dislikes and preferences, goals, ' +
  'or something they explicitly ask to be remembered. Do not extract questions, one-off tasks, temporary moods, or facts about the topic being discussed. ' +
  'Never store passwords, API keys, card or ID numbers, or health, legal or financial details.\n' +
  'Write each fact as one short line in the same language the user used, starting with the subject (for example "Name: Kamil" or "Lives in Sylhet"). ' +
  'Skip anything already in the known notes. At most 3 lines. If nothing qualifies, reply exactly: NONE';

export async function addMemoryNote(text, src) {
  const t = String(text || '').trim().slice(0, 240);
  if (!t) return false;
  let list = await getMemory();
  if (list.some((m) => m.text.toLowerCase() === t.toLowerCase())) return false;
  list.push({ id: uid(), text: t, src: src || 'manual', at: Date.now() });
  while (list.length > 80) list.shift();
  while (list.reduce((n, m) => n + m.text.length, 0) > 3000 && list.length > 1) list.shift();
  await saveMemory(list);
  return true;
}

async function learn(text, rt, settings) {
  const t = String(text || '').trim();
  if (!settings.autoLearn || t.length < 8 || t.length > 1500 || !PERSONAL_HINT.test(t)) return [];
  const known = (await getMemory()).slice(-40).map((m) => '- ' + m.text).join('\n') || '(none)';
  const { text: out, usage } = await complete({
    provider: rt.provider, apiKey: rt.apiKey, apiModel: rt.apiModel, system: LEARN_SYSTEM,
    messages: [{ role: 'user', text: 'Known notes:\n' + known + '\n\nUser message:\n' + t }], maxTokens: 150,
  });
  await recordUsage('memory', rt, usage);
  const saved = [];
  for (const l of String(out || '').split('\n')) {
    const f = l.replace(/^\s*[-*\d.)]+\s*/, '').trim();
    if (!f || /^none\.?$/i.test(f) || saved.length >= 3) continue;
    if (await addMemoryNote(f, 'auto')) saved.push(f);
  }
  return saved;
}

// ------------------------------------------------------------------ the turn loop
/**
 * ctx: { chat, text, images, folder, modelId, think, signal, ui }
 * ui: { onUser(msg), onAssistant(msg), onDelta(msg), onTool(msg), onNotice(text), onMemory(notes), requestApproval(toolMsg) -> Promise<'apply'|'reject'> }
 */
export async function runTurn(ctx) {
  const { chat, folder, signal, ui } = ctx;
  const settings = await getSettings();
  const rt = await runtimeFor(ctx.modelId);
  const memory = await getMemory();
  const think = ctx.think || 'off';

  await repairHistory(chat.id);

  if (!ctx.regenerate) {
    const userMsg = { chatId: chat.id, role: 'user', text: ctx.text || '', images: ctx.images && ctx.images.length ? ctx.images : undefined, files: ctx.attachNames, at: Date.now(), status: 'done' };
    userMsg.id = await db.put('messages', userMsg);
    ui.onUser(userMsg);
    learn(ctx.text, rt, settings).then((n) => { if (n.length) ui.onMemory(n); }).catch(() => {});
  }
  chat.updated = Date.now();
  chat.model = ctx.modelId;
  chat.think = think;
  await db.put('chats', chat);

  const hasGit = folder ? await isRepo(folder).catch(() => false) : false;
  const termuxPath = folder && settings.termux ? await getTermuxPath(folder).catch(() => null) : null;
  const base = TOOLS.concat(ARCHIVE_TOOLS, termuxPath ? TERMUX_TOOLS : []);
  const tools = folder ? (hasGit ? base.concat(GIT_TOOLS) : base) : null;
  const maxTokens = Math.max(512, Math.min(settings.maxOut || 8000, 64000));
  let steps = 0;

  for (;;) {
    if (signal.aborted) return;
    steps++;
    if (steps > Math.max(1, settings.maxSteps)) {
      const note = { chatId: chat.id, role: 'assistant', text: 'I stopped after ' + settings.maxSteps + ' steps to keep costs under control. Say "continue" if you want me to go on.', model: rt.model.id, status: 'done', at: Date.now() };
      note.id = await db.put('messages', note);
      ui.onAssistant(note);
      return;
    }

    const built = await buildContext(chat, rt, folder, settings, memory);
    const asst = { chatId: chat.id, role: 'assistant', text: '', thought: '', thinkMs: 0, calls: [], model: rt.model.id, status: 'streaming', tin: 0, tout: 0, at: Date.now() };
    asst.id = await db.put('messages', asst);
    ui.onAssistant(asst);

    let thinkStart = 0;
    let usage = null;
    let failed = null;
    let lastSave = 0;
    try {
      for await (const ev of stream({
        provider: rt.provider, apiKey: rt.apiKey, apiModel: rt.apiModel, system: built.system, messages: built.messages,
        tools, maxTokens, think, signal,
      })) {
        if (ev.t === 'thought') {
          if (!thinkStart) thinkStart = Date.now();
          asst.thought += ev.text;
          ui.onDelta(asst);
        } else if (ev.t === 'delta') {
          if (thinkStart && !asst.thinkMs) asst.thinkMs = Date.now() - thinkStart;
          asst.text += ev.text;
          ui.onDelta(asst);
          if (Date.now() - lastSave > 1500) { lastSave = Date.now(); db.put('messages', asst).catch(() => {}); }
        } else if (ev.t === 'call') {
          asst.calls.push({ id: ev.id, name: ev.name, args: ev.args, bad: ev.bad });
        } else if (ev.t === 'raw') {
          asst.raw = ev.blocks;
        } else if (ev.t === 'reasoning') {
          asst.reasoning = ev.text;
        } else if (ev.t === 'usage') {
          usage = ev;
        } else if (ev.t === 'notice') {
          ui.onNotice(ev.text);
        }
      }
    } catch (e) {
      if (signal.aborted) { failed = null; } else failed = e;
    }
    if (thinkStart && !asst.thinkMs) asst.thinkMs = Date.now() - thinkStart;

    if (failed) {
      asst.status = 'error';
      asst.text += (asst.text ? '\n\n' : '') + '[Error: ' + (failed.message || 'Request failed') + ']';
      asst.calls = [];
    } else {
      asst.status = 'done';
      if (signal.aborted && !asst.text && !asst.calls.length) asst.text = '[Stopped]';
    }
    if (usage) { asst.tin = usage.in; asst.tout = usage.out; await recordUsage('chat', rt, usage); }
    await db.put('messages', asst);
    ui.onAssistant(asst);

    if (failed || !asst.calls.length) return;

    // ---- run the tool calls
    for (const call of asst.calls) {
      if (signal.aborted) {
        const m = { chatId: chat.id, role: 'tool', callId: call.id, name: call.name, content: 'Cancelled by the user.', status: 'cancelled', at: Date.now() };
        m.id = await db.put('messages', m); ui.onTool(m);
        continue;
      }
      const tm = { chatId: chat.id, role: 'tool', callId: call.id, name: call.name, args: previewArgs(call), content: '', status: 'running', at: Date.now() };
      tm.id = await db.put('messages', tm);
      ui.onTool(tm);
      try {
        if (call.bad) throw new Error('The tool arguments were not valid JSON. Try again with valid arguments.');
        if (!folder) throw new Error('No project folder is open.');
        if (TERMUX_ACTIONS.has(call.name)) {
          const lines = await previewTermux(call.args || {}, folder);
          tm.plan = { path: 'terminal', op: 'runs in Termux', added: 0, removed: 0, diff: lines, more: 0 };
          tm.status = 'pending';
          await db.put('messages', tm);
          ui.onTool(tm);
          const decision = await ui.requestApproval(tm, signal); // commands always ask, even in auto-apply mode
          if (decision !== 'apply') {
            tm.status = 'rejected';
            tm.content = signal.aborted ? 'Cancelled by the user.' : 'The user rejected this command. Do not retry it; ask what they want instead.';
          } else {
            tm.content = await runTermux(call.args || {}, folder);
            tm.status = 'applied';
          }
        } else if (ARCHIVE_ACTIONS.has(call.name)) {
          const lines = await previewArchive(call.name, call.args || {}, folder);
          tm.plan = { path: call.name === 'zip' ? 'zip' : 'unzip', op: call.name, added: 0, removed: 0, diff: lines, more: 0 };
          tm.status = 'pending';
          await db.put('messages', tm);
          ui.onTool(tm);
          const decision = await ui.requestApproval(tm, signal); // always asks, even in auto-apply mode
          if (decision !== 'apply') {
            tm.status = 'rejected';
            tm.content = signal.aborted ? 'Cancelled by the user.' : 'The user rejected this. Do not retry it; ask what they want instead.';
          } else {
            tm.content = await runArchive(call.name, call.args || {}, folder);
            tm.status = 'applied';
          }
        } else if (GIT_ACTIONS.has(call.name)) {
          const lines = await previewGitAction(call.name, call.args || {}, folder);
          tm.plan = { path: 'git', op: call.name, added: 0, removed: 0, diff: lines, more: 0 };
          tm.status = 'pending';
          await db.put('messages', tm);
          ui.onTool(tm);
          const decision = await ui.requestApproval(tm, signal); // git actions always ask, even in auto-apply mode
          if (decision !== 'apply') {
            tm.status = 'rejected';
            tm.content = signal.aborted ? 'Cancelled by the user.' : 'The user rejected this. Do not retry it; ask what they want instead.';
          } else {
            tm.content = await runGitAction(call.name, call.args || {}, folder);
            tm.status = 'applied';
          }
        } else if (GIT_READS.has(call.name)) {
          tm.content = await runGitRead(call.name, call.args || {}, folder);
          tm.status = 'done';
        } else if (WRITE_TOOLS.has(call.name)) {
          const plan = await planWrite(call.name, call.args, folder);
          tm.plan = { path: plan.path, op: plan.op, added: plan.added, removed: plan.removed, diff: plan.diff.lines, more: plan.diff.more };
          let decision = 'apply';
          if (!settings.autoApply) {
            tm.status = 'pending';
            await db.put('messages', tm);
            ui.onTool(tm);
            decision = await ui.requestApproval(tm, signal);
          }
          if (decision !== 'apply') {
            tm.status = 'rejected';
            tm.content = signal.aborted ? 'Cancelled by the user.' : 'The user rejected this change. Do not retry it; ask what they want instead.';
          } else {
            const bk = { chatId: chat.id, folderId: folder.id, path: plan.path, existed: plan.before !== null, content: plan.before === null ? '' : plan.before, op: plan.op, at: Date.now(), undone: false };
            bk.id = await db.put('backups', bk);
            tm.content = await applyWrite(plan, folder);
            tm.status = 'applied';
            tm.backupId = bk.id;
          }
        } else {
          tm.content = await runRead(call.name, call.args, folder);
          tm.status = 'done';
        }
      } catch (e) {
        tm.status = 'error';
        tm.content = 'Error: ' + (e && e.message ? e.message : String(e));
      }
      await db.put('messages', tm);
      ui.onTool(tm);
    }
    if (signal.aborted) return;
  }
}

function previewArgs(call) {
  const a = call.args || {};
  if (a.command != null) return String(a.command).slice(0, 80);
  if (a.path != null) return String(a.path);
  if (a.dest != null) return String(a.dest);
  if (a.query != null) return String(a.query);
  if (a.pattern != null) return String(a.pattern);
  return '';
}

export async function undoChange(backupId, folder) {
  const b = await db.get('backups', backupId);
  if (!b || b.undone) return false;
  await undoBackup(b, folder);
  b.undone = true;
  await db.put('backups', b);
  return true;
}

export async function removeChat(chatId) {
  await db.delByIndex('messages', 'chatId', chatId);
  await db.delByIndex('backups', 'chatId', chatId);
  await db.del('chats', chatId);
}

export async function suggestCommitMessage(modelId, folder) {
  const { status, diffFile } = await import('./git.js');
  const ch = await status(folder);
  if (!ch.length) throw new Error('Nothing to commit.');
  let sample = '';
  for (const c of ch.slice(0, 6)) {
    try { const d = await diffFile(folder, c.path); sample += '\n# ' + c.kind + ' ' + c.path + '\n' + d.lines.filter((l) => l.t !== 'ctx').slice(0, 40).map((l) => (l.t === 'add' ? '+' : '-') + (l.text || '').slice(0, 160)).join('\n'); } catch (e) { /* skip */ }
  }
  const rt = await runtimeFor(modelId);
  const { text, usage } = await complete({
    provider: rt.provider, apiKey: rt.apiKey, apiModel: rt.apiModel,
    system: 'Write one Git commit message: a short imperative subject line (max 60 characters), nothing else. No quotes, no prefixes, no explanation.',
    messages: [{ role: 'user', text: 'Files changed: ' + ch.map((c) => c.kind + ' ' + c.path).join(', ') + '\n' + sample.slice(0, 6000) }], maxTokens: 60,
  });
  await recordUsage('commit', rt, usage);
  return String(text || '').split('\n')[0].replace(/^["'`]+|["'`]+$/g, '').trim().slice(0, 100);
}
