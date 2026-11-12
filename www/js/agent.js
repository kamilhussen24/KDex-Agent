// The chat engine: builds a token-cheap context, streams the reply, runs file tools in a loop,
// asks the user before every change, keeps backups for Undo, learns memory notes, records usage.
import { db, kvGet, kvSet } from './db.js';
import { secure } from './native.js';
import { stream, complete } from './providers.js';
import { TOOLS, WRITE_TOOLS, runRead, planWrite, applyWrite, undoBackup } from './tools.js';
import { estimateTokens, uid, dayKey } from './util.js';
import { isRepo } from './git.js';
import { TERMUX_TOOLS, TERMUX_ACTIONS, TERMUX_READS, previewTermux, runTermux, getTermuxPath, previewJob, runJob, allowKeys, isAllowed, isRiskyCommand } from './termux.js';
import { ARCHIVE_TOOLS, ARCHIVE_ACTIONS, previewArchive, runArchive } from './archive.js';
import { GIT_TOOLS, GIT_READS, GIT_ACTIONS, runGitRead, previewGitAction, runGitAction } from './gittools.js';

export const BUDGETS = { economy: 3000, balanced: 9000, full: 60000 };

// ------------------------------------------------------------------ settings & models
const PLAN_TOOL = {
  name: 'update_plan',
  description: 'Show the user a short checklist of the steps of a multi-step task and keep it up to date. Call it at the start of any task with 3 or more steps, then again each time a step starts or finishes. Send the full list every time.',
  parameters: {
    type: 'object',
    properties: { steps: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['todo', 'doing', 'done'] } }, required: ['text', 'status'] } } },
    required: ['steps'],
  },
};
export const defaults = { theme: 'system', mode: 'balanced', maxSteps: 20, autoApply: false, autoDefault: false, maxOut: 8000, instructions: '', autoLearn: true, defaultModel: '', defaultThink: 'off', termux: false };

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

async function recordUsage(kind, rt, u) {
  if (!u || (!u.in && !u.out)) return;
  await db.put('usage', {
    day: dayKey(), at: Date.now(), kind, modelId: rt.model.id, label: rt.model.label || rt.apiModel,
    tin: u.in || 0, tout: u.out || 0, cached: u.cached || 0,
  });
}

// ------------------------------------------------------------------ system prompt
const ABOUT =
  'ABOUT YOU AND THIS APP\n' +
  'You are KDex Agent, the AI assistant inside the KDex Agent Android app (made by Kamil Hussen, brand KDex, kamildex.com). The app has no server and no account: ' +
  'the user brings their own API key (Anthropic, OpenAI, Gemini, DeepSeek, xAI or any OpenAI-compatible service), it is stored encrypted on the phone, and chats and files go only to the chosen provider. ' +
  'The user gives the app one project folder; you can work only inside that folder. ' +
  'What the app can do: chat in any language; read, search, create, edit and delete files in the project with approval, automatic backups and Undo; unzip and zip archives; ' +
  'full Git (status, diff, commit, push, pull, branches, clone, publish to GitHub or GitLab) with approval for every action; run shell commands through Termux when the user turns Terminal on; ' +
  'a live task checklist; background jobs such as local web servers (through Termux); optional thinking levels (Off, Low, Medium, High) from the bulb button; attach images and text files; remember short notes about the user; show token usage in Settings. ' +
  'Where things are: Settings from the menu (providers, models, token saving, thinking, terminal, git identity), the folder chip above the chat (add, switch or remove the project folder at any time; the conversation stays), and the Files, Git and Changes chips. ' +
  'If asked who you are or what you can do, answer from this description in the user\'s language. Do not claim to be a specific underlying model unless the user asks which model is selected; then say it depends on the model they chose in the top bar. ' +
  'For any task with 3 or more steps, first call update_plan with the steps, then call it again as each step starts and finishes, so the user can follow progress. Skip it for quick one-step answers. ' +
  'Never invent abilities: if something is not listed here, say you cannot do it in this app.\n\n' +
  'APP GUIDE (use it to help the user set things up; give the steps in the user\'s language and keep them short)\n' +
  '- Connect a model: Settings > Add provider, pick the service, paste the API key, choose models (a few popular ones are listed; any other model id can be typed). Thinking: bulb button (Off, Low, Medium, High). Token usage: Settings > Token usage.\n' +
  '- Open a project: folder button > Open a folder, then pick the folder. Only that folder is accessible.\n' +
  '- Approvals: the chip above the chat switches Ask first and Auto. Auto runs everyday actions and still asks for risky ones (rm, sudo, force push, publishing). File changes keep backups and Undo.\n' +
  '- Git: the Git chip. Folder without Git: Clone, New repo (publishes to GitHub or GitLab) or Local only. Pushing needs a name, email and access token: Settings > Git > Identity and access tokens.\n' +
  '- TERMINAL SETUP, needed once before commands work: (1) Install the Termux app from F-Droid or GitHub, not Google Play. (2) Open Termux and run: mkdir -p ~/.termux && echo "allow-external-apps=true" >> ~/.termux/termux.properties, then close and reopen Termux. ' +
  '(3) In this app tap the Terminal chip, switch it On, tap Grant permission, then Test connection. (4) For a folder in shared storage run termux-setup-storage once in Termux; if the project path shows unknown, use Change path. Keep Termux open and exempt from battery limits.\n' +
  '- If the user asks to run a command, install something or start a server and the terminal is off, do not pretend: tell them these steps, starting with whichever are missing. ' +
  'If a command fails with "Could not reach Termux" or "not found", Termux is not installed or step 2 is missing. A permission error means tap Grant permission. Exit code 127 means the program is missing (pkg install it). Permission denied on files means run termux-setup-storage.\n\n' +
  'HOW TO WORK WELL\n' +
  'Understand the request first. For anything with several steps, think it through, then act. Be concise: no filler, no repeating the question, no pasting whole files. ' +
  'Keep tokens low: read only what you need, read each file once, use search to find lines, prefer small edits. ' +
  'Never claim something worked unless a tool result shows it. If a tool fails, read the error, fix the cause and try again once or twice, then explain plainly what is blocking you.';

function systemPrompt(folder, memory, summary, custom, termuxPath) {
  const parts = [ABOUT, 'Answer in the language the user writes in (Bengali, English or mixed).'];
  if (folder) {
    parts.push(
      'PROJECT: you are working inside the folder "' + folder.name + '". Tools: list_dir, find_files, search, read_file, create/edit/delete files. All paths are relative to this folder; you cannot reach anything outside it.\n' +
      'Rules: look before you change (list_dir, find_files or search, then read_file). Prefer edit_file with a small unique "find" over rewriting a whole file. ' +
      'Do what the user asked and nothing else. The user approves every change and can undo it. ' +
      (termuxPath
        ? 'TERMINAL: run_command runs a bash command in Termux (Linux on this phone) with the project at ' + termuxPath + '. Use it like a computer shell: unzip, installs (pkg/pip/npm), scripts, builds, tests, git. ' +
          'Each command must finish on its own (no prompts, editors or servers that never exit; add -y flags). The user approves every command. ' +
          'After a command you receive stdout, stderr and the exit code. Exit code 0 means success; anything else means it failed. Read the output carefully, then tell the user the real result in plain words (what ran, what happened, what the output means). ' +
          'PHONE LIMITS (important): Termux runs on an Android phone: ARM processor, limited RAM, limited storage, battery, no root. There is no sudo, no systemd, no Docker or virtual machines, and no apt-get; install with pkg install (for example pkg install nodejs python git). Use $HOME and $PREFIX, not /usr or /etc, and ports above 1024. ' +
          'Install only what the task needs, prefer small tools (SQLite, python3 -m http.server, plain Node), and never install or run heavy things: Docker, Android Studio or Gradle builds, PyTorch, TensorFlow or large AI models, full IDEs, big databases, browsers. If a request needs something that heavy, say so plainly and suggest a lighter way or doing that part on a PC or server. ' +
          'Before installing, check with command -v tool, df -h . (free space) and free -m (memory). If pip or npm fails building native code, try the pkg version (for example pkg install python-numpy) or a pure Python or JavaScript alternative. Tell the user roughly how big an install is before a large one. ' +
          'SERVERS AND LONG-RUNNING COMMANDS: never run them with run_command (it would hang). Use start_job with a short name, then check_job to confirm it is running and read the log, and stop_job when done. To serve a website use for example start_job python3 -m http.server 8080 --bind 0.0.0.0 (or the project\'s own dev command), then give the user the link http://localhost:8080 (same phone) and mention that other devices on the same Wi-Fi can use the phone\'s IP address. ' +
          'If it failed, fix the cause (a missing package, a wrong path, a typo) and retry at most twice before explaining. Check results with a quick command (ls, cat, a test) instead of assuming. '
        : 'You cannot run shell commands. You do have built-in unzip and zip tools; use them instead of telling the user to run a command. If the user wants scripts, installs or builds run, give them the TERMINAL SETUP steps from the app guide. ') +
      'When finished, summarize what you changed in a few lines. ' +
      'If git tools are provided, this folder is a Git repository: use git_status/git_diff to review work, and git_commit/git_push/git_pull only when the user asks (each needs their approval).'
    );
  } else {
    parts.push('No project folder is open, so you have no file tools. If the user wants you to work on files, tell them to tap the Add folder chip above the chat (the folder can be added or changed at any time without losing this conversation).');
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
  const raw = (await db.byIndex('messages', 'chatId', chat.id)).sort((a, b) => a.id - b.id)
    .filter((m) => !(m.role === 'assistant' && m.status === 'error'));
  // Folder-change events are shown to the user as dividers; the model gets them as a note on the next user message.
  const all = []; let pend = '';
  for (const m of raw) {
    if (m.role === 'event') { pend += (pend ? ' ' : '') + m.text; continue; }
    if (m.role === 'user' && pend) { all.push({ ...m, text: '[' + pend + ']\n' + (m.text || '') }); pend = ''; } else all.push(m);
  }
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
  const base = TOOLS.concat(ARCHIVE_TOOLS, [PLAN_TOOL], termuxPath ? TERMUX_TOOLS : []);
  const tools = folder ? (hasGit ? base.concat(GIT_TOOLS) : base) : null;
  const maxTokens = Math.max(512, Math.min(settings.maxOut || 8000, 64000));
  let steps = 0;

  const readSeen = new Set(); let ranTools = false;
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

    if (!failed && !asst.calls.length && !asst.text.trim() && !signal.aborted && ranTools) {
      asst.text = 'The steps above are finished. Ask me if you want a summary or a next step.';
      await db.put('messages', asst); ui.onAssistant(asst);
    }
    if (failed || !asst.calls.length) return;

    // ---- run the tool calls
    for (const call of asst.calls) {
      if (signal.aborted) {
        const m = { chatId: chat.id, role: 'tool', callId: call.id, name: call.name, content: 'Cancelled by the user.', status: 'cancelled', at: Date.now() };
        m.id = await db.put('messages', m); ui.onTool(m);
        continue;
      }
      ranTools = true;
      const tm = { chatId: chat.id, role: 'tool', callId: call.id, name: call.name, args: previewArgs(call), content: '', status: 'running', at: Date.now() };
      tm.id = await db.put('messages', tm);
      ui.onTool(tm);
      try {
        if (call.bad) throw new Error('The tool arguments were not valid JSON. Try again with valid arguments.');
        if (!folder) throw new Error('No project folder is open.');
        if (call.name === 'update_plan') {
          const steps = (Array.isArray(call.args && call.args.steps) ? call.args.steps : []).slice(0, 20).map((x) => ({ text: String((x && x.text) || '').slice(0, 160), status: ['todo', 'doing', 'done'].includes(x && x.status) ? x.status : 'todo' })).filter((x) => x.text);
          tm.steps = steps; tm.args = steps.filter((x) => x.status === 'done').length + '/' + steps.length + ' done';
          tm.content = 'Plan updated.'; tm.status = 'done';
        } else if (TERMUX_READS.has(call.name)) {
          tm.content = await runJob(call.name, call.args || {}, folder);
          tm.status = 'done';
        } else if (TERMUX_ACTIONS.has(call.name)) {
          const isJob = call.name === 'start_job';
          const lines = isJob ? await previewJob(call.args || {}, folder) : await previewTermux(call.args || {}, folder);
          const keys = allowKeys((call.args || {}).command);
          const risky = isRiskyCommand((call.args || {}).command);
          const auto = (chat.auto && !risky) || (!risky && isAllowed((call.args || {}).command, chat.allow));
          tm.plan = { path: 'terminal', op: isJob ? 'starts in the background' : 'runs in Termux', added: 0, removed: 0, diff: lines, more: 0, allowKeys: keys, auto, risky };
          let decision = 'apply';
          if (!auto) {
            tm.status = 'pending';
            await db.put('messages', tm);
            ui.onTool(tm);
            decision = await ui.requestApproval(tm, signal); // commands ask unless the user allowed them for this chat
          }
          if (decision === 'always' && keys.length) { chat.allow = [...new Set([...(chat.allow || []), ...keys])]; await db.put('chats', chat); decision = 'apply'; }
          if (decision !== 'apply') {
            tm.status = 'rejected';
            tm.content = signal.aborted ? 'Cancelled by the user.' : 'The user rejected this command. Do not retry it; ask what they want instead.';
          } else {
            tm.content = isJob ? await runJob(call.name, call.args || {}, folder) : await runTermux(call.args || {}, folder);
            tm.status = 'applied';
            readSeen.clear();
          }
        } else if (ARCHIVE_ACTIONS.has(call.name)) {
          const lines = await previewArchive(call.name, call.args || {}, folder);
          tm.plan = { path: call.name === 'zip' ? 'zip' : 'unzip', op: call.name, added: 0, removed: 0, diff: lines, more: 0, risky: false, auto: !!chat.auto };
          let decision = 'apply';
          if (!chat.auto) {
            tm.status = 'pending';
            await db.put('messages', tm);
            ui.onTool(tm);
            decision = await ui.requestApproval(tm, signal);
          }
          if (decision !== 'apply') {
            tm.status = 'rejected';
            tm.content = signal.aborted ? 'Cancelled by the user.' : 'The user rejected this. Do not retry it; ask what they want instead.';
          } else {
            tm.content = await runArchive(call.name, call.args || {}, folder);
            readSeen.clear();
            tm.status = 'applied';
          }
        } else if (GIT_ACTIONS.has(call.name)) {
          const lines = await previewGitAction(call.name, call.args || {}, folder);
          const riskyGit = call.name === 'git_push' && !!(call.args && (call.args.force || call.args.force_push));
          tm.plan = { path: 'git', op: call.name, added: 0, removed: 0, diff: lines, more: 0, risky: riskyGit, auto: !!chat.auto && !riskyGit };
          let decision = 'apply';
          if (!(chat.auto && !riskyGit)) {
            tm.status = 'pending';
            await db.put('messages', tm);
            ui.onTool(tm);
            decision = await ui.requestApproval(tm, signal);
          }
          if (decision !== 'apply') {
            tm.status = 'rejected';
            tm.content = signal.aborted ? 'Cancelled by the user.' : 'The user rejected this. Do not retry it; ask what they want instead.';
          } else {
            tm.content = await runGitAction(call.name, call.args || {}, folder);
            readSeen.clear();
            tm.status = 'applied';
          }
        } else if (GIT_READS.has(call.name)) {
          tm.content = await runGitRead(call.name, call.args || {}, folder);
          tm.status = 'done';
        } else if (WRITE_TOOLS.has(call.name)) {
          const plan = await planWrite(call.name, call.args, folder);
          tm.plan = { path: plan.path, op: plan.op, added: plan.added, removed: plan.removed, diff: plan.diff.lines, more: plan.diff.more };
          let decision = 'apply';
          if (!(settings.autoApply || chat.auto)) {
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
            readSeen.clear();
            tm.status = 'applied';
            tm.backupId = bk.id;
          }
        } else {
          const rk = call.name === 'read_file' ? JSON.stringify([call.args && call.args.path, call.args && call.args.offset, call.args && call.args.limit]) : null;
          if (rk && readSeen.has(rk)) tm.content = '[Already read earlier in this task and unchanged since. Use that content instead of reading again.]';
          else { tm.content = await runRead(call.name, call.args, folder); if (rk) readSeen.add(rk); }
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
  if (a.command != null) return (a.name ? a.name + ': ' : '') + String(a.command).slice(0, 80);
  if (a.steps != null) return (Array.isArray(a.steps) ? a.steps.length : 0) + ' steps';
  if (a.name != null && !a.path) return String(a.name);
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
