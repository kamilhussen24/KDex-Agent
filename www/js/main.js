// KDex Agent (Android) - UI layer. All data stays on this phone.
import { $, $$, esc, uid, fmtBytes, fmtTok, ago, dayKey, dayKeyAgo, copyText } from './util.js';
import { db, kvGet, kvSet } from './db.js';
import { secure, fs, App, Termux, AllFiles, setBars, isNative } from './native.js';
import { PRESETS, QUICK_FILL, listModels, popularModels } from './providers.js';
import { getTermuxPath, setTermuxPath } from './termux.js';
import { renderMarkdown } from './md.js';
import * as A from './agent.js';
import * as G from './git.js';
import { isSecretPath, isEnvLike, maskEnv, protectionOn } from './secrets.js';
import { SUPPORT_EMAIL, APP_VERSION } from './config.js';

const S = {
  settings: null, providers: [], models: [], folders: [], chats: [],
  chat: null, folder: null, think: 'off', running: false, abort: null,
  approvals: new Map(), approvalTm: new Map(), els: new Map(), attach: [], sheetStack: [],
};
const ICON = (n) => '<svg class="ic"><use href="#i-' + n + '"/></svg>';

// ------------------------------------------------------------ helpers
let toastT;
function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 2400);
}
function confirmBox(title, text, yes = 'OK') {
  return new Promise((res) => {
    $('#dlgTitle').textContent = title; $('#dlgText').textContent = text; $('#dlgYes').firstElementChild.textContent = yes;
    $('#dialog').classList.remove('hidden');
    const done = (v) => { $('#dialog').classList.add('hidden'); $('#dlgYes').onclick = $('#dlgNo').onclick = null; res(v); };
    $('#dlgYes').onclick = () => done(true); $('#dlgNo').onclick = () => done(false);
  });
}
/** Dialog with two actions plus Cancel. Resolves 0 (first), 1 (second) or -1 (cancel). */
function choiceBox(title, text, labels) {
  return new Promise((res) => {
    $('#dlgTitle').textContent = title; $('#dlgText').textContent = text;
    $('#dlgYes').firstElementChild.textContent = labels[0]; $('#dlgAlt').firstElementChild.textContent = labels[1]; $('#dlgAlt').classList.remove('hidden');
    $('#dialog').classList.remove('hidden');
    const done = (v) => { $('#dialog').classList.add('hidden'); $('#dlgAlt').classList.add('hidden'); $('#dlgYes').onclick = $('#dlgNo').onclick = $('#dlgAlt').onclick = null; res(v); };
    $('#dlgYes').onclick = () => done(0); $('#dlgAlt').onclick = () => done(1); $('#dlgNo').onclick = () => done(-1);
  });
}
function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('kdex-theme', t); } catch (e) { /* ignore */ }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const mt = document.querySelector('meta[name=theme-color]'); if (mt && bg) mt.setAttribute('content', bg);
  setBars(dark, bg || undefined);
}
function fitViewport() {
  const set = () => document.documentElement.style.setProperty('--vh', (window.visualViewport ? window.visualViewport.height : innerHeight) + 'px');
  set();
  if (window.visualViewport) { visualViewport.addEventListener('resize', set); visualViewport.addEventListener('scroll', set); }
  addEventListener('resize', set);
}
const modelLabel = (m) => m.label || m.apiModel;
function currentModelId() { return $('#modelSelect').value || (S.models[0] && S.models[0].id); }

// ------------------------------------------------------------ boot
async function boot() {
  window.__stage = 'boot'; fitViewport();
  S.settings = await A.getSettings(); applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.__stage = 'settings-ok';
  S.providers = await A.getProviders(); S.models = await A.getModels(); S.folders = await A.getFolders();
  window.__stage = 'wiring'; wire();
  if (!S.models.length && !(await kvGet('setupSkipped', false))) { showSetup(true); window.__stage = 'ready'; return; }
  await enter(); window.__stage = 'ready';
  setTimeout(() => offerAllFiles().catch(() => {}), 1200);
}
/** Opens Android's permission screen; when the user comes back it checks the result. */
async function askAllFiles(done) {
  try { await AllFiles.request(); } catch (e) { toast('Could not open the settings screen'); return; }
  const back = async () => {
    if (document.hidden) return;
    document.removeEventListener('visibilitychange', back);
    const st = await AllFiles.status(); G.resetGitCache();
    toast(st.granted ? 'Fast file access is on' : 'Fast file access is still off');
    if (done) done();
  };
  document.addEventListener('visibilitychange', back);
}
/** Once per install: ask for direct file access. It is optional; the app works without it, only slower. */
async function offerAllFiles() {
  if (!isNative) return;
  const st = await AllFiles.status();
  if (!st.supported || st.granted) return;
  if (await kvGet('allFilesAsked', 0) >= 2) return;
  await kvSet('allFilesAsked', (await kvGet('allFilesAsked', 0)) + 1);
  const r = await choiceBox('Fast file access', 'Allow "All files access" so files and Git work at full speed, like Termux. Android opens a settings screen: turn on the switch for KDex Agent, then come back.', ['Allow', 'Not now']);
  if (r === 0) askAllFiles();
}
async function enter() {
  $('#setup').classList.add('hidden');
  fillModels();
  await loadChats();
  const last = await kvLast();
  if (last && S.chats.find((c) => c.id === last)) await openChat(last); else await newChat();
}
async function kvLast() { const r = await db.get('kv', 'lastChat'); return r && r.value; }
function fillModels(sel) {
  const el = $('#modelSelect');
  if (!S.models.length) { el.innerHTML = '<option value="">Connect a model</option>'; return; }
  el.innerHTML = S.models.map((m) => '<option value="' + esc(m.id) + '">' + esc(modelLabel(m)) + '</option>').join('');
  const want = sel || (S.chat && S.chat.model) || S.settings.defaultModel;
  if (want && S.models.find((m) => m.id === want)) el.value = want;
}

// ------------------------------------------------------------ setup / add provider
/** Model chooser shared by setup and Settings: suggested models, on-demand full list with search, manual id. */
function modelPicker(box, prov, getKey, suggested, have) {
  const picked = new Set(); const manual = []; let all = null; let q = '';
  const present = new Set(have || []);
  const draw = () => {
    const pool = (all || suggested).filter((id) => !present.has(id));
    let ids = q ? pool.filter((id) => id.toLowerCase().includes(q)) : (all ? popularModels(pool, 8) : pool.slice(0, 8));
    const total = ids.length; ids = ids.slice(0, q ? 10 : 8);
    box.innerHTML =
      '<div class="h3">Models</div>' +
      (all ? '<input id="mpQ" class="inp" placeholder="Search ' + all.length + ' models" value="' + esc(q) + '" autocapitalize="off" autocomplete="off">' : '') +
      '<div id="mpList" style="max-height:230px;overflow:auto;margin:8px 0">' +
      (ids.map((id) => '<label class="row-item" style="padding:8px 12px"><input type="checkbox" class="cb" data-id="' + esc(id) + '"' + (picked.has(id) ? ' checked' : '') + '><span class="grow t">' + esc(id) + '</span></label>').join('') ||
        '<div class="note">' + (all ? 'No match. Type the model id below.' : 'No suggestions for this provider. Type a model id below or load the list.') + '</div>') +
      (all && !q && pool.length > ids.length ? '<div class="note">Popular models only. Search the other ' + (pool.length - ids.length) + ' or type any model id below.</div>' : (total > ids.length ? '<div class="note">Showing the first ' + ids.length + '. Search to narrow down.</div>' : '')) + '</div>' +
      manual.map((m) => '<div class="row-item"><div class="grow t">' + esc(m) + '</div><button class="icon-btn" data-rm="' + esc(m) + '" aria-label="Remove ' + esc(m) + '">' + ICON('x') + '</button></div>').join('') +
      '<div class="row" style="display:flex;gap:8px;margin-bottom:8px"><input id="mpMan" class="inp" style="flex:1" placeholder="Type a model id" autocapitalize="off" autocomplete="off"><button id="mpAdd" class="btn sm"><span class="lbl">Add</span></button></div>' +
      (all ? '' : '<button id="mpLoad" class="btn" style="width:100%"><span class="lbl">Load full list from provider</span></button>') + '<div id="mpMsg"></div>';
    $$('[data-id]', box).forEach((c) => c.onchange = () => { c.checked ? picked.add(c.dataset.id) : picked.delete(c.dataset.id); });
    $$('[data-rm]', box).forEach((b) => b.onclick = () => { manual.splice(manual.indexOf(b.dataset.rm), 1); draw(); });
    const add = () => { const v = $('#mpMan').value.trim(); if (v && !manual.includes(v) && !present.has(v)) manual.push(v); draw(); };
    $('#mpAdd').onclick = add; $('#mpMan').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    if ($('#mpQ')) { $('#mpQ').oninput = (e) => { q = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; draw(); const n = $('#mpQ'); n.focus(); n.setSelectionRange(pos, pos); }; }
    if ($('#mpLoad')) $('#mpLoad').onclick = async () => {
      const key = await getKey(); if (!key) { $('#mpMsg').innerHTML = '<div class="err">Enter your API key first.</div>'; return; }
      const b = $('#mpLoad'); b.disabled = true; b.firstElementChild.textContent = 'Loading...';
      try { all = await listModels(prov, key); if (!all.length) throw new Error('The provider returned no models.'); draw(); }
      catch (e) { b.disabled = false; b.firstElementChild.textContent = 'Load full list from provider'; $('#mpMsg').innerHTML = '<div class="err">' + esc(e.message || 'Could not load the list') + '</div>'; }
    };
  };
  draw();
  return () => { const v = $('#mpMan'); if (v && v.value.trim() && !manual.includes(v.value.trim())) manual.push(v.value.trim()); return [...picked, ...manual]; };
}

function showSetup(first, title) {
  const box = $('#setup'); box.classList.remove('hidden');
  let preset = PRESETS[0]; let keep = { name: '', url: '', key: '' };
  let getPicked = () => [];
  const draw = () => {
    box.innerHTML = '<div class="wrap"><img class="logo" src="img/logo.png" alt="" width="72" height="72"><h1>' + (first ? 'Welcome to KDex Agent' : (title || 'Add a provider')) + '</h1>' +
      '<p class="sub">Use your own API key. It is stored encrypted on this phone and sent only to the provider you choose.</p>' +
      '<div class="pgrid">' + PRESETS.map((p) => '<button type="button" class="btn sm' + (p.key === preset.key ? ' on' : '') + '" data-p="' + p.key + '"><span class="lbl">' + p.name + '</span></button>').join('') + '</div>' +
      '<label class="field"><span>Name</span><input id="sName" value="' + esc(keep.name || preset.name) + '"></label>' +
      '<label class="field ' + (preset.key === 'custom' ? '' : 'hidden') + '" id="sUrlF"><span>Base URL (OpenAI-compatible)</span><input id="sUrl" placeholder="https://example.com/v1" value="' + esc(keep.url || preset.baseUrl) + '" autocapitalize="off"><small>Works with any OpenAI-compatible service or server on your own network. Tap one to fill it in:</small><div class="qf">' + QUICK_FILL.map((q, i) => '<button type="button" class="btn sm" data-qf="' + i + '"><span class="lbl">' + esc(q.name) + '</span></button>').join('') + '</div></label>' +
      '<label class="field"><span>API key</span><input id="sKey" type="password" placeholder="' + esc(preset.hint) + '" autocomplete="off" autocapitalize="off" value="' + esc(keep.key) + '"></label>' +
      '<div id="sPick"></div><div id="sMsg"></div>' +
      '<button id="sGo" class="btn primary" type="button" style="width:100%"><span class="lbl">Save provider</span></button>' +
      '<div class="safe">' + ICON('lock') + '<span>No account, no server. Chats and files never leave your phone except to your provider.</span></div>' +
      (first ? '<button id="sSkip" class="btn" type="button" style="width:100%"><span class="lbl">Skip for now</span></button><div class="note">Files, Git and Settings work without a model. You can connect one later in Settings, or when you start a chat.</div>'
        : '<button id="sCancel" class="btn" type="button" style="width:100%"><span class="lbl">Cancel</span></button>') + '</div>';
    $$('[data-p]', box).forEach((b) => b.onclick = () => { keep = { name: '', url: '', key: $('#sKey').value }; preset = PRESETS.find((p) => p.key === b.dataset.p); draw(); });
    const prov = () => ({ id: 'tmp', name: '', type: preset.type, baseUrl: (preset.key === 'custom' ? $('#sUrl').value : preset.baseUrl).trim() });
    getPicked = modelPicker($('#sPick'), { get baseUrl() { return prov().baseUrl; }, type: preset.type }, async () => $('#sKey').value.trim(), preset.models.map((x) => x), []);
    if (preset.models.length) { /* preselect the first two suggestions */ $$('[data-id]', box).slice(0, 2).forEach((c) => { c.checked = true; c.dispatchEvent(new Event('change')); }); }
    $('#sGo').onclick = go;
    if ($('#sCancel')) $('#sCancel').onclick = () => box.classList.add('hidden');
    if ($('#sSkip')) $('#sSkip').onclick = async () => { await kvSet('setupSkipped', true); await enter(); };
    $$('[data-qf]', box).forEach((b) => b.onclick = () => { const q = QUICK_FILL[Number(b.dataset.qf)]; $('#sName').value = q.name.replace(/ \(.*\)/, ''); $('#sUrl').value = q.baseUrl; $('#sKey').placeholder = q.hint; });
  };
  const go = async () => {
    const msg = $('#sMsg'); msg.innerHTML = '';
    const name = $('#sName').value.trim() || preset.name;
    const baseUrl = (preset.key === 'custom' ? $('#sUrl').value : preset.baseUrl).trim().replace(/\/+$/, '');
    const key = $('#sKey').value.trim();
    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) { msg.innerHTML = '<div class="err">Enter a valid base URL.</div>'; return; }
    if (!key) { msg.innerHTML = '<div class="err">Enter your API key.</div>'; return; }
    const picked = [...new Set(getPicked())].slice(0, 20);
    if (!picked.length) { msg.innerHTML = '<div class="err">Pick or type at least one model.</div>'; return; }
    const prov = { id: uid(), name, type: preset.type, baseUrl };
    await secure.set(A.keyName(prov.id), key);
    S.providers.push(prov); await A.saveProviders(S.providers);
    picked.forEach((api) => S.models.push({ id: uid(), providerId: prov.id, apiModel: api, label: api + (S.providers.length > 1 ? ' (' + prov.name + ')' : '') }));
    await A.saveModels(S.models);
    toast('Provider saved');
    if (first) await enter(); else { $('#setup').classList.add('hidden'); fillModels(); if (S.sheetStack.length) openSettings(); }
  };
  draw();
}

/** Settings: add models to an existing provider. */
async function openAddModels(p) {
  const body = sheet('Add models', { back: openSettings });
  const preset = PRESETS.find((x) => x.baseUrl === p.baseUrl);
  const have = S.models.filter((m) => m.providerId === p.id).map((m) => m.apiModel);
  body.innerHTML = '<div class="note" style="text-align:left;margin-top:0">' + esc(p.name) + '</div><div id="amPick"></div><div id="amMsg"></div>';
  const get = modelPicker($('#amPick'), p, () => secure.get(A.keyName(p.id)), preset ? preset.models : [], have);
  const foot = $('#sheetFoot'); foot.classList.remove('hidden'); foot.innerHTML = '<button id="amSave" class="btn primary" style="width:100%"><span class="lbl">Add selected models</span></button>';
  $('#amSave').onclick = async () => {
    const add = [...new Set(get())].filter((id) => !have.includes(id));
    if (!add.length) { toast('Pick or type a model first.'); return; }
    add.forEach((api) => S.models.push({ id: uid(), providerId: p.id, apiModel: api, label: api + (S.providers.length > 1 ? ' (' + p.name + ')' : '') }));
    await A.saveModels(S.models); fillModels(); foot.classList.add('hidden'); toast(add.length + ' model(s) added'); openSettings();
  };
}

// ------------------------------------------------------------ chats
async function loadChats() {
  S.chats = (await db.all('chats')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  drawChatList();
}
function drawChatList() {
  const q = $('#chatSearch').value.trim().toLowerCase();
  const list = S.chats.filter((c) => !q || (c.title || '').toLowerCase().includes(q));
  $('#chatList').innerHTML = list.length ? list.map((c) => {
    const f = S.folders.find((x) => x.id === c.folderId);
    return '<div class="chat-item' + (S.chat && S.chat.id === c.id ? ' on' : '') + '" data-id="' + c.id + '"><div class="t">' + esc(c.title || 'New chat') +
      '<span class="s">' + (f ? esc(f.name) + ' · ' : '') + ago(c.updated) + '</span></div><button class="icon-btn" data-del="' + c.id + '" aria-label="Delete">' + ICON('trash') + '</button></div>';
  }).join('') : '<div class="note">No chats yet</div>';
}
async function newChat(folder) {
  if (S.running) stopRun();
  S.chat = { id: uid(), title: '', model: currentModelId(), think: S.settings.defaultThink || 'off', auto: !!S.settings.autoDefault, folderId: folder ? folder.id : null, updated: Date.now() };
  S.folder = folder || null; S.think = S.chat.think; S.chat.fresh = true;
  S.els.clear(); S.approvals.clear();
  fillModels(S.chat.model); drawCtx(); drawThink(); $('#messages').innerHTML = ''; renderEmpty(); updateApproveBar(); closeDrawer();
}
async function openChat(id) {
  if (S.running) stopRun();
  const c = await db.get('chats', id); if (!c) return newChat();
  S.chat = c; S.folder = S.folders.find((f) => f.id === c.folderId) || null; S.think = c.think || 'off';
  await db.put('kv', { key: 'lastChat', value: id });
  fillModels(c.model); drawCtx(); drawThink();
  S.els.clear(); S.approvals.clear();
  await A.repairHistory(id);
  const msgs = (await db.byIndex('messages', 'chatId', id)).sort((a, b) => a.id - b.id);
  const box = $('#messages'); box.innerHTML = '';
  if (!msgs.length) renderEmpty();
  msgs.forEach((m) => renderMsg(m));
  scrollEnd(true); closeDrawer(); drawChatList(); updateApproveBar();
}
/** Hand a text file to the user: share sheet when available; on the phone otherwise save it into a folder they pick; in a browser a normal download. */
async function saveOut(name, text) {
  const file = new File([text], name, { type: 'text/plain' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  if (isNative) {
    try {
      const f = await fs.pickFolder();
      await fs.writeText(f.uri, name, text);
      if (!S.folders.some((x) => x.uri === f.uri)) await fs.releaseFolder(f.uri).catch(() => {}); // a one-off save should not keep access to that folder
      toast('Saved ' + name + ' in ' + (f.name || 'the folder'));
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('Could not save the file: ' + ((e && e.message) || 'unknown error')); }
    return;
  }
  try {
    const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000); toast('Saving ' + name);
  } catch (e) { toast(await copyText(text) ? 'Could not download, copied instead' : 'Could not save the file'); }
}
function renderEmpty() {
  $('#messages').innerHTML = '<div class="empty"><img src="img/logo.png" alt="" width="64" height="64"><h2>How can I help?</h2><div>' +
    (S.folder ? 'Working in <b>' + esc(S.folder.name) + '</b>. Ask me to read, search or change files.' : 'Ask anything, attach files, or tap the <b>folder</b> button above to let me work on a project. You can add or change the folder any time.') + '</div></div>';
}
async function persistChat() {
  if (!S.chat) return;
  S.chat.updated = Date.now(); S.chat.model = currentModelId(); S.chat.think = S.think;
  S.chat.folderId = S.folder ? S.folder.id : null;
  await db.put('chats', S.chat); await db.put('kv', { key: 'lastChat', value: S.chat.id });
}

// ------------------------------------------------------------ context bar (folder chip)
function drawCtx() {
  $('#chipFolderName').textContent = S.folder ? S.folder.name : 'Add folder';
  $$('#ctxBar .nf').forEach((b) => b.classList.toggle('hidden', !S.folder));
  if (S.folder) { updateChangesChip(); updateGitChip(); }
  updateTermChip();
}
async function updateGitChip() {
  if (!S.folder) return;
  const b = await G.isRepo(S.folder).then((ok) => ok ? G.currentBranch(S.folder) : null).catch(() => null);
  $('#chipGitLbl').textContent = b || 'Git';
}
async function updateChangesChip() {
  if (!S.chat) return;
  const b = (await db.byIndex('backups', 'chatId', S.chat.id)).filter((x) => !x.undone);
  $('#chipChangesLbl').textContent = b.length ? 'Changes (' + b.length + ')' : 'Changes';
}

// ------------------------------------------------------------ message rendering
function scrollEnd(force) {
  const m = $('#messages');
  if (force || m.scrollHeight - m.scrollTop - m.clientHeight < 140) m.scrollTop = m.scrollHeight;
}
function thinkLabelOf(m, live) {
  if (live && !m.text) return 'Thinking...';
  return m.thinkMs ? 'Thought for ' + Math.max(1, Math.round(m.thinkMs / 1000)) + 's' : 'Thought';
}
function renderMsg(m) {
  const box = $('#messages');
  const empty = $('.empty', box); if (empty) empty.remove();
  let el = S.els.get(m.id);
  if (!el) { el = document.createElement('div'); el.dataset.id = m.id; S.els.set(m.id, el); box.appendChild(el); }
  if (m.role === 'user') {
    el.className = 'msg user';
    el.innerHTML = (m.images && m.images.length ? '<div class="thumbs">' + m.images.map((i) => '<img alt="" src="data:' + i.mime + ';base64,' + i.data + '">').join('') + '</div>' : '') +
      (m.fileData && m.fileData.length ? '<div class="ufiles">' + m.fileData.map((f, i) => '<button type="button" class="ufile" data-ufile="' + m.id + ':' + i + '" aria-label="Save ' + esc(f.name) + '">' + ICON('file') + '<span class="nm">' + esc(f.name) + '</span><span class="sz">' + esc(fmtBytes(f.size)) + '</span></button>').join('') + '</div>' : (m.files && m.files.length ? '<div class="fnames">' + m.files.map(esc).join(', ') + '</div>' : '')) + (m.text ? '<div class="bubble">' + esc(m.text) + '</div>' : '');
  } else if (m.role === 'assistant') {
    el.className = 'msg assistant';
    const live = m.status === 'streaming';
    let h = '';
    if (m.thought) h += '<details class="think" data-tk="' + m.id + '"' + (el.dataset.open ? ' open' : '') + '><summary>' + ICON('bulb') + '<span class="lbl">' + thinkLabelOf(m, live) + '</span></summary><div class="tb">' + esc(m.thought) + '</div></details>';
    if (m.text) h += '<div class="body">' + renderMarkdown(m.text) + '</div>';
    else if (live && !m.calls.length && !m.thought) h += '<div class="body"><span class="dots"></span></div>';
    if (!live && (m.text || m.status === 'error')) {
      h += '<div class="acts"><button class="icon-btn" data-act="copy" aria-label="Copy">' + ICON('copy') + '</button><button class="icon-btn" data-act="regen" aria-label="Regenerate">' + ICON('refresh') + '</button><button class="icon-btn" data-act="report" aria-label="Report this reply">' + ICON('flag') + '</button></div>';
      if (m.tin || m.tout) h += '<div class="meta">' + fmtTok(m.tin) + ' in · ' + fmtTok(m.tout) + ' out</div>';
    }
    const open = el.querySelector('details.think'); const wasOpen = open && open.open;
    el.innerHTML = h;
    const nd = el.querySelector('details.think'); if (nd && wasOpen) nd.open = true;
    if (nd) nd.addEventListener('toggle', () => { el.dataset.open = nd.open ? '1' : ''; });
    if (!h) el.style.display = 'none'; else el.style.display = '';
  } else if (m.role === 'event') {
    el.className = 'msg event'; el.innerHTML = ICON('folder') + '<span>' + esc(m.label || '') + '</span>';
  } else if (m.role === 'tool') {
    el.className = 'msg tool-wrap';
    el.innerHTML = toolCard(m);
    if (m.name === 'update_plan' && m.steps) {
      const prev = $('.tool-wrap[data-plan]', box); // one live checklist: update it in place
      if (prev && prev !== el) { prev.innerHTML = el.innerHTML; S.els.set(m.id, prev); el.remove(); } else el.dataset.plan = '1';
    }
  }
  scrollEnd();
}
const TOOL_ICON = { git_status: 'branch', git_diff: 'branch', git_log: 'branch', git_commit: 'branch', git_push: 'up', git_pull: 'down', unzip: 'file', zip: 'file', run_command: 'terminal', request_env_var: 'lock', start_job: 'terminal', check_job: 'terminal', stop_job: 'terminal', list_jobs: 'terminal', update_plan: 'list', make_file: 'file', list_dir: 'folder', find_files: 'search', search: 'search', read_file: 'file', write_file: 'edit', edit_file: 'edit', delete_file: 'trash' };
function planCard(m) {
  const done = m.steps.filter((x) => x.status === 'done').length;
  return '<div class="tool plan"><div class="th">' + ICON('list') + '<span class="nm">Plan</span><span class="pa">' + done + ' of ' + m.steps.length + ' done</span></div><div class="steps">' +
    m.steps.map((x) => '<div class="stp ' + x.status + '"><span class="dot"></span><span class="tx">' + esc(x.text) + '</span></div>').join('') + '</div></div>';
}
function toolCard(m) {
  if (m.name === 'update_plan' && m.steps) return planCard(m);
  if (m.name === 'make_file' && m.file) {
    return '<div class="tool"><div class="th">' + ICON('file') + '<span class="nm">' + esc(m.file.name) + '</span><span class="pa">' + esc(fmtBytes(m.file.size)) + '</span></div>' +
      '<div class="tf"><span class="lbl" style="flex:1">Ready</span><button class="btn sm" data-tool="copyfile" data-id="' + m.id + '">' + ICON('copy') + '<span class="lbl">Copy</span></button>' +
      '<button class="btn primary sm" data-tool="getfile" data-id="' + m.id + '">' + ICON('down') + '<span class="lbl">Download</span></button></div></div>';
  }
  const st = m.status || 'running';
  let h = '<div class="tool"><div class="th">' + ICON(TOOL_ICON[m.name] || 'file') + '<span class="nm">' + esc(m.name) + '</span><span class="pa">' + esc(m.args || '') + '</span><span class="st ' + st + '">' + esc(st === 'running' ? 'working' : st) + '</span></div>';
  if (m.plan) {
    h += '<div class="diff">' + (m.plan.diff || []).map((l) => '<span class="dl ' + (l.t === 'add' ? 'a' : l.t === 'del' ? 'd' : 'c') + '">' + esc((l.t === 'add' ? '+ ' : l.t === 'del' ? '- ' : '  ') + (l.text || '')) + '</span>').join('') +
      (m.plan.more ? '<span class="dl c">... ' + m.plan.more + ' more lines</span>' : '') + '</div>';
    h += '<div class="tf"><span class="lbl" style="flex:1">' + esc(m.plan.op) + (m.plan.auto ? ' · allowed' : '') + (m.plan.risky && st === 'pending' ? ' · risky' : '') + ((m.plan.path === 'git' || m.plan.path === 'zip' || m.plan.path === 'unzip' || m.plan.path === 'terminal') ? '' : ' · +' + m.plan.added + ' −' + m.plan.removed) + '</span>';
    if (st === 'pending') h += '<button class="btn sm" data-tool="reject" data-id="' + m.id + '"><span class="lbl">Reject</span></button><button class="btn primary sm" data-tool="apply" data-id="' + m.id + '"><span class="lbl">' + (m.plan.path === 'terminal' ? 'Run' : 'Apply') + '</span></button>' +
      (m.plan.path === 'terminal' && m.plan.allowKeys && m.plan.allowKeys.length ? '</div><div class="tf"><button class="linkbtn" data-tool="always" data-id="' + m.id + '">Always allow ' + esc(m.plan.allowKeys.join(', ')) + ' in this chat</button>' : '');
    else if (st === 'applied' && m.backupId) h += '<button class="btn sm" data-tool="undo" data-b="' + m.backupId + '">' + ICON('undo') + '<span class="lbl">Undo</span></button>';
    h += '</div>';
    if (m.plan.path === 'terminal' && m.content && st !== 'pending') h += '<pre class="out">' + esc(m.content.slice(-3000)) + '</pre>';
  } else if (m.status === 'error' || m.status === 'cancelled') {
    h += '<pre class="out">' + esc((m.content || '').slice(0, 400)) + '</pre>';
  }
  return h + '</div>';
}

// ------------------------------------------------------------ approvals
function pendingCount() { return S.approvals.size; }
function updateApproveBar() {
  const n = pendingCount(); const bar = $('#approveBar');
  if (!n) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden'); $('#approveText').textContent = n + ' change' + (n > 1 ? 's' : '') + ' waiting for your approval';
}
function decide(id, v) {
  const r = S.approvals.get(Number(id)); if (!r) return;
  S.approvals.delete(Number(id)); S.approvalTm.delete(Number(id)); r(v); updateApproveBar();
}

// ------------------------------------------------------------ sending
const WEIRD_MIME = /^image\/(png|jpe?g|webp|gif)$/;
function setRunning(v) {
  S.running = v; const b = $('#sendBtn');
  b.classList.toggle('stop', v); b.innerHTML = ICON(v ? 'stop' : 'up'); b.setAttribute('aria-label', v ? 'Stop' : 'Send');
}
function stopRun() {
  if (S.abort) S.abort.abort();
  [...S.approvals.keys()].forEach((id) => decide(id, 'reject'));
}
function noModelNotice() {
  const box = $('#messages'); const empty = $('.empty', box); if (empty) empty.remove();
  if ($('#nmNotice')) { $('#nmNotice').scrollIntoView(); return; }
  const d = document.createElement('div'); d.className = 'msg'; d.id = 'nmNotice';
  d.innerHTML = '<div class="card"><div class="t">Connect a model to chat</div><p>Files, Git and Settings work without one. To get replies, add a provider and your API key.</p><button class="btn primary sm" id="nmGo"><span class="lbl">Connect a model</span></button></div>';
  box.appendChild(d); d.scrollIntoView();
  $('#nmGo').onclick = () => { d.remove(); showSetup(false, 'Connect a model'); };
}
async function send(regenerate) {
  if (S.running) { stopRun(); return; }
  const input = $('#input'); const text = regenerate ? '' : input.value.trim();
  if (!regenerate && !text && !S.attach.length) return;
  if (!S.models.length) { noModelNotice(); return; }
  const attach = regenerate ? [] : S.attach;
  const images = attach.filter((a) => a.img).map((a) => ({ mime: a.mime, data: a.data }));
  const files = attach.filter((a) => !a.img);
  if (!regenerate) { input.value = ''; autoGrow(); S.attach = []; drawChips(); }
  if (S.chat.fresh && !S.chat.title) { S.chat.title = (text || (attach[0] && attach[0].name) || 'New chat').slice(0, 48); }
  delete S.chat.fresh; await persistChat(); loadChats();
  S.abort = new AbortController(); setRunning(true);
  const ui = {
    onUser: (m) => renderMsg(m), onAssistant: (m) => renderMsg(m), onDelta: (m) => renderMsg(m),
    onTool: (m) => { renderMsg(m); if (m.status === 'applied' || m.status === 'rejected') updateChangesChip(); },
    requestSecret: (info, signal) => askSecret(info, signal),
    onNotice: (t) => toast(t), onMemory: (n) => toast('Remembered: ' + n[0]),
    requestApproval: (tm, signal) => new Promise((resolve) => {
      S.approvals.set(tm.id, resolve); S.approvalTm.set(tm.id, tm); updateApproveBar();
      signal.addEventListener('abort', () => decide(tm.id, 'reject'), { once: true });
    }),
  };
  try {
    await A.runTurn({ chat: S.chat, text, images, attachFiles: files, attachNames: attach.map((a) => a.name), folder: S.folder, modelId: currentModelId(), think: S.think, signal: S.abort.signal, ui, regenerate: !!regenerate });
  } catch (e) {
    toast(e.message || 'Something went wrong');
    const m = { chatId: S.chat.id, role: 'assistant', text: '[Error: ' + (e.message || 'failed') + ']', status: 'error', calls: [], at: Date.now() };
    m.id = await db.put('messages', m); renderMsg(m);
  }
  setRunning(false); S.abort = null; updateApproveBar(); updateChangesChip(); loadChats();
}
async function regenerate() {
  if (S.running) return;
  const msgs = (await db.byIndex('messages', 'chatId', S.chat.id)).sort((a, b) => a.id - b.id);
  let i = msgs.length - 1; while (i >= 0 && msgs[i].role !== 'user') i--;
  if (i < 0) return;
  for (const m of msgs.slice(i + 1)) { await db.del('messages', m.id); const el = S.els.get(m.id); if (el) el.remove(); S.els.delete(m.id); }
  await send(true);
}

// ------------------------------------------------------------ attachments
function drawChips() {
  $('#chips').innerHTML = S.attach.map((a, i) => '<span class="achip">' + (a.img ? '<img alt="" src="data:' + a.mime + ';base64,' + a.data + '">' : ICON('file')) + '<span class="lbl" style="max-width:120px">' + esc(a.name) + '</span><button type="button" class="icon-btn" data-rm="' + i + '">' + ICON('x') + '</button></span>').join('');
}
function shrinkImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => {
      const max = 1568; const k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read image')); };
    im.src = url;
  });
}
async function addFiles(list) {
  for (const f of Array.from(list)) {
    try {
      if (WEIRD_MIME.test(f.type)) S.attach.push({ img: true, name: f.name, mime: 'image/jpeg', data: await shrinkImage(f) });
      else if (f.size > 400 * 1024) toast(f.name + ' is too large (max 400 KB). Put it in a project folder instead.');
      else { const t = await f.text(); if (t.includes('\u0000')) toast(f.name + ' looks like a binary file.'); else S.attach.push({ name: f.name, text: t }); }
    } catch (e) { toast(e.message); }
  }
  drawChips();
}
function autoGrow() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; }

// ------------------------------------------------------------ thinking pill
function drawThink() {
  const tl = 'Thinking: ' + S.think[0].toUpperCase() + S.think.slice(1);
  $('#thinkBtn').setAttribute('aria-label', tl); $('#thinkBtn').title = tl; $('#thinkBtn').classList.toggle('on', S.think !== 'off');
  $$('#thinkMenu .it').forEach((b) => b.classList.toggle('on', b.dataset.think === S.think));
}

// ------------------------------------------------------------ drawer
function openDrawer() { $('#drawer').classList.add('open'); $('#scrim').classList.remove('hidden'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.add('hidden'); }

// ------------------------------------------------------------ sheets
function sheet(title, opts = {}) {
  S.sheetStack.push(title);
  $$('#sheet .sheet-head button').forEach((b) => { b.disabled = false; });
  $('#sheetTitle').textContent = title; $('#sheet').classList.remove('hidden');
  $('#sheetBack').classList.toggle('hidden', !opts.back); $('#sheetBack').onclick = opts.back || null;
  const tabs = $('#sheetTabs'); tabs.classList.add('hidden'); tabs.innerHTML = '';
  $('#sheetFoot').classList.add('hidden'); $('#sheetFoot').innerHTML = '';
  const body = $('#sheetBody'); body.innerHTML = ''; body.scrollTop = 0; return body;
}
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheetFoot').classList.add('hidden'); S.sheetStack = []; }

/** Use `f` (or no folder) in the current chat. Messages stay; the model is told about the change. */
async function applyFolder(f) {
  const c = S.chat; if (!c) return;
  const cur = S.folder;
  if ((cur && f && cur.id === f.id) || (!cur && !f)) { closeSheet(); return; }
  const had = (await db.byIndex('messages', 'chatId', c.id)).some((x) => x.role === 'user');
  if (had && cur && f) {
    const r = await choiceBox('Change folder?', 'This chat is working in "' + cur.name + '". Use "' + f.name + '" here, or start a new chat for it?', ['Use here', 'New chat']);
    if (r === 1) { closeSheet(); await newChat(f); await persistChat(); loadChats(); return; }
    if (r !== 0) return;
  }
  if (S.running) stopRun();
  S.folder = f; c.folderId = f ? f.id : null;
  c.allow = []; // "Always allow" belongs to the old folder
  if (had) {
    const ev = { chatId: c.id, role: 'event', status: 'done', at: Date.now(),
      label: f ? 'Folder: ' + f.name : 'Folder removed',
      text: f ? 'The user changed the project folder. You now work in "' + f.name + '"' + (cur ? ' (before: "' + cur.name + '")' : ' (before: no folder)') + '. File results from earlier messages may belong to another location, so read again before relying on them.'
        : 'The user removed the project folder. You have no file or terminal tools in this chat now.' };
    ev.id = await db.put('messages', ev); renderMsg(ev); scrollEnd(true);
    await persistChat(); loadChats();
  } else if ($('.empty', $('#messages'))) renderEmpty();
  drawCtx(); updateApproveBar(); closeSheet();
  toast(f ? 'Using ' + f.name + ' in this chat' : 'Folder removed from this chat');
  if (f) detectRepo(f);
}
/** Look at an existing repository (for example one made in Termux). Reads only; nothing is changed or deleted. */
async function detectRepo(f) {
  try {
    const r = await G.inspectRepo(f); if (!r || S.folder !== f) return;
    const app = await G.getGitSettings(); const id = r.issues.find((x) => x.code === 'identity' && x.cand);
    if (id && !app.name && !app.email) await G.saveGitSettings({ name: id.cand.name, email: id.cand.email });
    const o = r.remotes.find((x) => x.name === 'origin') || r.remotes[0];
    const ssh = r.issues.some((x) => x.code === 'ssh');
    setTimeout(() => toast('Git repository found · ' + (r.branch || 'no commits') + (o ? ' · ' + o.host + '/' + o.path : ' · no remote') + (id && !app.name && !app.email ? ' · identity imported' : '') + (ssh ? ' · SSH remote needs HTTPS' : '')), 1800);
    updateGitChip();
  } catch (e) { /* detection is best effort */ }
}

async function openProjects() {
  const body = sheet('Folder for this chat');
  const paths = {};
  const loadPaths = async () => { for (const f of S.folders) paths[f.id] = await getTermuxPath(f).catch(() => null); };
  await loadPaths();
  const draw = () => {
    body.innerHTML = '<button id="pOpen" class="btn primary" style="width:100%;margin-bottom:8px">' + ICON('folder') + '<span class="lbl">Open a folder...</span></button>' +
      '<button id="pClone" class="btn" style="width:100%;margin-bottom:8px">' + ICON('branch') + '<span class="lbl">Clone a repository...</span></button>' +
      (S.folder ? '<button id="pDetach" class="btn" style="width:100%;margin-bottom:8px">' + ICON('x') + '<span class="lbl">Remove folder from this chat</span></button>' : '') +
      '<button id="pNone" class="btn" style="width:100%;margin-bottom:8px">' + ICON('plus') + '<span class="lbl">New chat without a folder</span></button>' +
      '<div class="safe">' + ICON('lock') + '<span>I can only touch the folder you pick. A backup is saved before every change.</span></div>' +
      (S.folders.length ? '<div class="h3">Your folders</div>' : '') +
      S.folders.map((f) => '<div class="row-item frow" data-f="' + f.id + '">' + ICON('folder') + '<div class="grow"><div class="t">' + esc(f.name) + '</div><div class="s">' + (S.folder && S.folder.id === f.id ? 'Used in this chat' : 'Tap to use in this chat') + '</div></div>' +
        '<button class="icon-btn rbtn" data-nf="' + f.id + '" aria-label="New chat in this folder">' + ICON('plus') + '</button><button class="icon-btn rbtn" data-rmf="' + f.id + '" aria-label="Remove">' + ICON('trash') + '</button>' +
        '<div class="fp"><span class="fpath">' + esc(paths[f.id] || 'Path unknown').replace(/\//g, '/<wbr>') + '</span>' + (paths[f.id] ? '<button class="icon-btn rbtn" data-cp="' + f.id + '" aria-label="Copy path of ' + esc(f.name) + '">' + ICON('copy') + '</button>' : '') + '</div></div>').join('') +
      '<div class="note" style="margin-top:12px">Android does not allow picking the whole storage or the Download folder. Choose a subfolder, for example one you create for a project.</div>';
    $('#pOpen').onclick = async () => {
      try {
        const r = await fs.pickFolder(); if (!r || !r.uri) return;
        let f = S.folders.find((x) => x.uri === r.uri);
        if (!f) { f = { id: uid(), name: r.name || 'Folder', uri: r.uri }; S.folders.push(f); await A.saveFolders(S.folders); }
        await applyFolder(f);
      } catch (e) { if (!/cancel/i.test(e.message || '')) toast(e.message || 'Could not open the folder'); }
    };
    $('#pClone').onclick = cloneFlow;
    if ($('#pDetach')) $('#pDetach').onclick = () => applyFolder(null);
    $('#pNone').onclick = () => { closeSheet(); newChat(null); };
    $$('[data-f]', body).forEach((r) => r.onclick = async (e) => {
      if (e.target.closest('[data-rmf]') || e.target.closest('[data-nf]') || e.target.closest('[data-cp]')) return;
      await applyFolder(S.folders.find((x) => x.id === r.dataset.f));
    });
    $$('[data-cp]', body).forEach((b) => b.onclick = async () => { toast(await copyText(paths[b.dataset.cp]) ? 'Path copied' : 'Could not copy'); });
    $$('[data-nf]', body).forEach((b) => b.onclick = async () => { const f = S.folders.find((x) => x.id === b.dataset.nf); closeSheet(); await newChat(f); await persistChat(); loadChats(); });
    $$('[data-rmf]', body).forEach((b) => b.onclick = async () => {
      const f = S.folders.find((x) => x.id === b.dataset.rmf);
      if (!await confirmBox('Remove folder?', 'This only removes "' + f.name + '" from the list and releases access. Your files are not deleted.', 'Remove')) return;
      try { await fs.releaseFolder(f.uri); } catch (e) { /* ignore */ }
      S.folders = S.folders.filter((x) => x.id !== f.id); await A.saveFolders(S.folders);
      if (S.folder && S.folder.id === f.id) { S.folder = null; if (S.chat) S.chat.folderId = null; drawCtx(); }
      draw();
    });
  };
  draw();
}

async function openFiles(path = '') {
  if (!S.folder) return;
  const body = sheet(S.folder.name + (path ? ' / ' + path : ''), { back: path ? () => openFiles(path.split('/').slice(0, -1).join('/')) : null });
  body.innerHTML = '<div class="note">Loading...</div>';
  try {
    const es = (await fs.list(S.folder.uri, path)).sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    body.innerHTML = es.length ? es.map((e) => '<div class="row-item" data-p="' + esc(e.path) + '" data-d="' + (e.isDir ? 1 : 0) + '">' + ICON(e.isDir ? 'folder' : 'file') + '<div class="grow"><div class="t">' + esc(e.name) + '</div>' + (e.isDir ? '' : '<div class="s">' + fmtBytes(e.size) + '</div>') + '</div></div>').join('') : '<div class="note">This folder is empty</div>';
    $$('[data-p]', body).forEach((r) => r.onclick = async () => {
      if (r.dataset.d === '1') return openFiles(r.dataset.p);
      const p = r.dataset.p; const b2 = sheet(p, { back: () => openFiles(path) });
      try { const t = await fs.readText(S.folder.uri, p, 200000); const hide = isSecretPath(p) && await protectionOn(); b2.innerHTML = t.binary ? '<div class="note">Binary file, ' + fmtBytes(t.size) + '</div>' : (hide ? '<div class="note" style="text-align:left">Protected file. Its values are hidden here and from the agent. Open it in a file editor to change it.</div>' : '') + '<pre class="out" style="white-space:pre-wrap;word-break:break-word;font-size:12px">' + esc(hide ? (isEnvLike(p) ? maskEnv(t.text) : '<hidden>') : t.text) + '</pre>'; }
      catch (e) { b2.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; }
    });
  } catch (e) { body.innerHTML = '<div class="err">' + esc(e.message || 'Could not read the folder') + '</div>'; }
}

async function openChanges() {
  if (!S.chat) return;
  const body = sheet('Changes');
  const draw = async () => {
    const all = (await db.byIndex('backups', 'chatId', S.chat.id)).sort((a, b) => b.id - a.id);
    const live = all.filter((b) => !b.undone);
    body.innerHTML = (live.length ? '<button id="undoAll" class="btn danger" style="width:100%;margin-bottom:10px">' + ICON('undo') + '<span class="lbl">Undo all (' + live.length + ')</span></button>' : '') +
      (all.length ? all.map((b) => '<div class="row-item">' + ICON(b.op === 'delete' ? 'trash' : 'edit') + '<div class="grow"><div class="t">' + esc(b.path) + '</div><div class="s">' + esc(b.op) + ' · ' + ago(b.at) + (b.undone ? ' · undone' : '') + '</div></div>' +
        (b.undone ? '' : '<button class="btn sm" data-u="' + b.id + '">' + ICON('undo') + '<span class="lbl">Undo</span></button>') + '</div>').join('') : '<div class="note">No changes in this chat yet.</div>') +
      '<div class="safe">' + ICON('lock') + '<span>Backup saved before every change.</span></div>';
    $$('[data-u]', body).forEach((b) => b.onclick = async () => { await undoOne(Number(b.dataset.u)); draw(); });
    if ($('#undoAll')) $('#undoAll').onclick = async () => {
      if (!await confirmBox('Undo all changes?', 'Every change from this chat is rolled back, newest first.', 'Undo all')) return;
      for (const b of live) await undoOne(b.id); draw();
    };
  };
  draw();
}
async function undoOne(id) {
  try { const bk = await db.get('backups', id); const bf = (bk && S.folders.find((x) => x.id === bk.folderId)) || S.folder; if (!bf) throw new Error('The folder of this change is no longer available.'); await A.undoChange(id, bf); toast('Undone'); } catch (e) { toast(e.message || 'Could not undo'); }
  updateChangesChip();
  const msgs = await db.byIndex('messages', 'chatId', S.chat.id);
  msgs.filter((m) => m.backupId === id).forEach((m) => { m.status = 'undone'; m.content += ' (undone by the user)'; db.put('messages', m); renderMsg(m); });
}

// ------------------------------------------------------------ settings
function openSettings() {
  const body = sheet('Settings');
  const st = S.settings;
  const seg = (id, opts, cur) => '<div class="seg" id="' + id + '">' + opts.map(([v, l]) => '<button type="button" class="btn sm' + (v === cur ? ' on' : '') + '" data-v="' + v + '"><span class="lbl">' + l + '</span></button>').join('') + '</div>';
  body.innerHTML =
    '<div class="h3">Providers</div>' +
    S.providers.map((p) => '<div class="row-item">' + ICON('key') + '<div class="grow"><div class="t">' + esc(p.name) + '</div><div class="s">' + esc(p.baseUrl) + '</div></div><button class="btn sm" data-key="' + p.id + '"><span class="lbl">Change key</span></button><button class="icon-btn" data-rp="' + p.id + '" aria-label="Remove">' + ICON('trash') + '</button></div>').join('') +
    '<button id="addProv" class="btn" style="width:100%;margin-top:8px">' + ICON('plus') + '<span class="lbl">Add provider</span></button>' +
    '<div class="h3">Models</div>' +
    S.models.map((m) => '<div class="row-item"><div class="grow"><div class="t">' + esc(m.apiModel) + '</div><div class="s">' + esc((S.providers.find((x) => x.id === m.providerId) || {}).name || '') + '</div></div><button class="icon-btn" data-rmm="' + m.id + '" aria-label="Remove ' + esc(m.apiModel) + '">' + ICON('x') + '</button></div>').join('') +
    S.providers.map((p) => '<button class="btn" data-am="' + p.id + '" style="width:100%;margin-top:8px">' + ICON('plus') + '<span class="lbl">Add model to ' + esc(p.name) + '</span></button>').join('') +
    '<div class="h3">Chat</div>' +
    '<label class="field"><span>Default model</span><select id="setModel">' + S.models.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === st.defaultModel ? ' selected' : '') + '>' + esc(modelLabel(m)) + '</option>').join('') + '</select></label>' +
    '<div class="field"><span>Token saving</span>' + seg('setMode', [['economy', 'Economy'], ['balanced', 'Balanced'], ['full', 'Full']], st.mode) + '<small>Older messages are summarised to cut cost. Economy keeps the least context.</small></div>' +
    '<div class="field"><span>Default thinking</span>' + seg('setThink', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], st.defaultThink) + '</div>' +
    '<label class="field"><span>Max steps per message</span><input id="setSteps" type="number" min="1" max="60" value="' + st.maxSteps + '"><small>Stops runaway tool loops.</small></label>' +
    '<label class="field"><span>Custom instructions</span><textarea id="setInstr" placeholder="Tone, language, rules...">' + esc(st.instructions) + '</textarea></label>' +
    '<div class="h3">Files</div>' +
    '<div class="field"><span>Approvals in new chats</span>' + seg('setAutoDef', [['0', 'Ask first'], ['1', 'Auto']], st.autoDefault ? '1' : '0') + '<small>Auto runs file changes, zip, commits and everyday commands without asking. Deleting data, sudo, force push, publishing and similar risky actions still ask. You can switch any chat with the chip above the messages. Backups and Undo always work.</small></div>' +
    '<div class="field"><span>Protect secret files</span>' + seg('setProt', [['1', 'On'], ['0', 'Off']], st.protectSecrets !== false ? '1' : '0') + '<small>.env files, keys and credentials stay hidden from the agent and the chat. The agent can still run your project with them. Secret values are removed from terminal output, and new secret files are never committed automatically.</small></div>' +
    '<div class="h3">Appearance</div>' + '<div class="field">' + seg('setTheme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], st.theme) + '</div>' +
    '<div class="h3">Memory</div><div class="field">' + seg('setLearn', [['1', 'Learn about me'], ['0', 'Off']], st.autoLearn ? '1' : '0') + '<small>Short notes saved on this phone and shared with the model so it knows you.</small></div><div id="memList"></div>' +
    '<button id="memAdd" class="btn" style="width:100%">' + ICON('plus') + '<span class="lbl">Add a note</span></button>' +
    '<div class="h3">Data</div>' +
    '<button id="usageBtn" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Token usage</span></button>' +
    '<button id="expBtn" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Export this chat as text</span></button>' +
    '<button id="delAll" class="btn danger" style="width:100%;margin-bottom:8px"><span class="lbl">Delete all conversations</span></button>' +
    '<button id="bkOut" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Back up all data to a folder</span></button>' +
    '<button id="bkIn" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Restore from a backup</span></button>' +
    '<div class="h3">Terminal (Termux)</div><div class="field">' + seg('setTerm', [['0', 'Off'], ['1', 'On']], st.termux ? '1' : '0') + '<small>Lets the agent run shell commands in Termux after you approve each one. Advanced.</small></div><div id="termBox"></div>' +
    '<div class="h3">Fast file access</div><div id="afBox"></div>' +
    '<div class="h3">Git</div><button id="gitId" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Identity and access tokens</span></button>' +
    '<div class="h3">About</div><div class="kv"><span>Version</span><span>' + APP_VERSION + '</span></div><div class="kv"><span>Storage</span><span>On this phone only</span></div>';
  const bindSeg = (id, fn) => $$('#' + id + ' .btn', body).forEach((b) => b.onclick = () => { $$('#' + id + ' .btn', body).forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); });
  bindSeg('setMode', (v) => save({ mode: v })); bindSeg('setThink', (v) => save({ defaultThink: v }));
  bindSeg('setProt', (v) => save({ protectSecrets: v === '1' })); bindSeg('setAutoDef', (v) => save({ autoDefault: v === '1' })); bindSeg('setLearn', (v) => save({ autoLearn: v === '1' }));
  const drawAF = async () => {
    const box = $('#afBox'); if (!box) return;
    const st2 = await AllFiles.status();
    box.innerHTML = '<div class="kv"><span>All files access</span><span>' + (st2.web ? 'Android only' : !st2.supported ? 'Not needed' : st2.granted ? 'On' : 'Off') + '</span></div><div class="note" style="text-align:left">' + (st2.granted ? 'Files and Git use direct paths, like Termux does.' : 'Direct file access makes files and Git much faster. You turn it on once in Android settings.') + '</div>' + (st2.supported && !st2.granted ? '<button id="afOn" class="btn primary" style="width:100%;margin-bottom:8px"><span class="lbl">Turn on fast access</span></button>' : '');
    if ($('#afOn')) $('#afOn').onclick = () => askAllFiles(drawAF);
  };
  drawAF();
  const rdTerm = () => drawTerm(rdTerm);
  bindSeg('setTerm', async (v) => { await save({ termux: v === '1' }); rdTerm(); updateTermChip(); });
  bindSeg('setTheme', (v) => { save({ theme: v }); applyTheme(); });
  $('#setModel').onchange = (e) => save({ defaultModel: e.target.value });
  $('#setSteps').onchange = (e) => save({ maxSteps: Math.max(1, Math.min(60, Number(e.target.value) || 20)) });
  $('#setInstr').onchange = (e) => save({ instructions: e.target.value });
  $('#addProv').onclick = () => showSetup(false);
  $$('[data-am]', body).forEach((b) => b.onclick = () => openAddModels(S.providers.find((x) => x.id === b.dataset.am)));
  $$('[data-rmm]', body).forEach((b) => b.onclick = async () => {
    S.models = S.models.filter((m) => m.id !== b.dataset.rmm); await A.saveModels(S.models);
    if (S.settings.defaultModel === b.dataset.rmm) await save({ defaultModel: S.models[0] ? S.models[0].id : '' });
    fillModels(); openSettings();
  });
  $$('[data-key]', body).forEach((b) => b.onclick = async () => {
    const v = await askText('New API key', 'Paste the key'); if (v) { await secure.set(A.keyName(b.dataset.key), v); toast('Key updated'); }
  });
  $$('[data-rp]', body).forEach((b) => b.onclick = async () => {
    if (!await confirmBox('Remove provider?', 'Its key and models are deleted from this phone.', 'Remove')) return;
    await secure.remove(A.keyName(b.dataset.rp));
    S.providers = S.providers.filter((p) => p.id !== b.dataset.rp); S.models = S.models.filter((m) => m.providerId !== b.dataset.rp);
    await A.saveProviders(S.providers); await A.saveModels(S.models); fillModels(); openSettings();
  });
  const mem = async () => {
    const list = await A.getMemory();
    $('#memList').innerHTML = list.map((m) => '<div class="row-item"><div class="grow s" style="white-space:normal;color:var(--fg)">' + esc(m.text) + '</div><button class="icon-btn" data-dm="' + m.id + '">' + ICON('x') + '</button></div>').join('') || '<div class="note">No notes yet.</div>';
    $$('[data-dm]', body).forEach((b) => b.onclick = async () => { await A.saveMemory((await A.getMemory()).filter((x) => x.id !== b.dataset.dm)); mem(); });
  };
  rdTerm();
  mem();
  $('#memAdd').onclick = async () => { const v = await askText('Add a note', 'One short fact'); if (v && await A.addMemoryNote(v, 'manual')) mem(); };
  $('#usageBtn').onclick = openUsage; $('#expBtn').onclick = exportChat;
  $('#delAll').onclick = async () => {
    if (!await confirmBox('Delete all conversations?', 'Every chat, its messages and its change backups are removed from this phone. Your folders, files, settings, memory notes and keys are not touched. This cannot be undone.', 'Delete all')) return;
    if (S.running) stopRun();
    for (const st of ['messages', 'backups', 'chats']) for (const row of await db.all(st)) await db.del(st, row.id);
    closeSheet(); await newChat(null); await loadChats(); toast('All conversations deleted');
  };
  $('#bkOut').onclick = () => exportBackup().catch((e) => toast(e.message)); $('#bkIn').onclick = () => importBackup().catch((e) => toast(e.message));
  $('#gitId').onclick = () => openGitIdentity(openSettings);
}
async function drawTerm(redraw) {
  {
    const box = $('#termBox'); if (!box) return;
    if (!S.settings.termux) { box.innerHTML = ''; return; }
    const stt = await Termux.status().catch(() => ({}));
    const path = S.folder ? await getTermuxPath(S.folder) : null;
    box.innerHTML =
      '<div class="kv"><span>Termux app</span><span>' + (stt.installed ? 'installed' : (stt.web ? 'Android only' : 'not found')) + '</span></div>' +
      '<div class="kv"><span>Permission</span><span>' + (stt.granted ? 'granted' : 'not granted') + '</span></div>' +
      (S.folder ? '<div class="kv"><span>Path of "' + esc(S.folder.name) + '"</span><span style="word-break:break-all;text-align:right">' + esc(path || 'unknown') + '</span></div>' : '<div class="note">Open a project to see its Termux path.</div>') +
      '<div style="display:flex;gap:8px;margin:8px 0;flex-wrap:wrap">' + (stt.granted ? '' : '<button id="tmPerm" class="btn sm"><span class="lbl">Grant permission</span></button>') +
      '<button id="tmTest" class="btn sm"><span class="lbl">Test connection</span></button>' + (S.folder ? '<button id="tmPath" class="btn sm"><span class="lbl">Change path</span></button>' : '') + '</div><div id="tmMsg"></div>' +
      '<div class="card"><div class="t">One-time setup</div><p>1. Install Termux from F-Droid or GitHub (not Google Play).<br>2. In Termux run: <code>mkdir -p ~/.termux &amp;&amp; echo "allow-external-apps=true" &gt;&gt; ~/.termux/termux.properties</code>, then restart Termux.<br>3. Tap Grant permission here (Run commands in Termux environment).<br>4. Pick your project folder through Termux\'s own storage entry, or run <code>termux-setup-storage</code> and pick a folder in shared storage.</p></div>';
    const msg = (h) => { $('#tmMsg').innerHTML = h; };
    if ($('#tmPerm')) $('#tmPerm').onclick = async () => { try { await Termux.permission(); } catch (e) { msg('<div class="err">' + esc(e.message) + '</div>'); } redraw(); };
    if ($('#tmTest')) $('#tmTest').onclick = async () => {
      msg('<div class="busy"><span class="spin"></span>Running a test command...</div>');
      try { const r = await Termux.run('echo ok; uname -m', undefined, 20000); msg('<div class="ok">Works (exit ' + r.exitCode + '): ' + esc((r.stdout || '').trim().replace(/\n/g, ', ')) + '</div>'); }
      catch (e) { msg('<div class="err">' + esc(e.message) + '</div>'); }
    };
    if ($('#tmPath')) $('#tmPath').onclick = async () => { const v = await askText('Path in Termux', '/data/data/com.termux/files/home/project', path || ''); if (v !== null) { await setTermuxPath(S.folder, v); redraw(); } };
  }
}
async function openTerminal() {
  const body = sheet('Terminal');
  const seg = (v) => '<div class="seg" id="tSeg">' + [['0', 'Off'], ['1', 'On']].map(([k, l]) => '<button type="button" class="btn sm' + (k === v ? ' on' : '') + '" data-v="' + k + '"><span class="lbl">' + l + '</span></button>').join('') + '</div>';
  const draw = () => {
    body.innerHTML = '<p class="note" style="text-align:left;margin-top:0">Let the agent run commands in Termux, inside this project, like on a computer. Every command asks for your approval first.</p>' +
      '<div class="field"><span>Terminal for the agent</span>' + seg(S.settings.termux ? '1' : '0') + '</div>' +
      '<div class="field"><span>Git token for Termux</span><div class="seg" id="tTok">' + [['1', 'Lend'], ['0', 'Never']].map(([k, l]) => '<button type="button" class="btn sm' + ((S.settings.gitTokenTermux !== false ? '1' : '0') === k ? ' on' : '') + '" data-v="' + k + '"><span class="lbl">' + l + '</span></button>').join('') +
      '</div><small>When a git clone, pull, fetch or push runs in Termux, your saved token is lent to that one command. It is not stored in Termux and the model never sees it.</small></div><div id="termBox"></div>';
    $$('#tSeg .btn', body).forEach((b) => b.onclick = async () => { await save({ termux: b.dataset.v === '1' }); updateTermChip(); draw(); });
    $$('#tTok .btn', body).forEach((b) => b.onclick = async () => { await save({ gitTokenTermux: b.dataset.v === '1' }); draw(); });
    drawTerm(draw);
  };
  draw();
}
function updateTermChip() {
  const l = $('#chipTermLbl'); if (l) l.textContent = S.settings.termux ? 'Terminal on' : 'Terminal';
  const a = $('#chipAuto'); if (a) { const on = !!(S.chat && S.chat.auto); a.classList.toggle('on', on); $('#chipAutoLbl').textContent = on ? 'Auto' : 'Ask first'; a.title = on ? 'Auto: safe actions run without asking' : 'Ask before every action'; }
}
async function toggleAuto() {
  if (!S.chat) return;
  S.chat.auto = !S.chat.auto; await db.put('chats', S.chat); updateTermChip();
  if (S.chat.auto) { toast('Auto: risky actions still ask'); for (const [id, tm] of [...S.approvalTm.entries()]) { if (!(tm.plan && tm.plan.risky) && S.approvals.has(id)) decide(id, 'apply'); } }
  else toast('Asking before every action');
}
let saveChain = Promise.resolve();
/** Applies the change at once (so the UI never lags a tap behind), then writes it to storage in order. */
function save(p) {
  S.settings = { ...S.settings, ...p };
  saveChain = saveChain.then(() => A.saveSettings(p)).catch(() => {});
  return saveChain;
}

async function openUsage() {
  const body = sheet('Token usage', { back: openSettings });
  const rows = await db.all('usage'); const days = new Map();
  rows.forEach((r) => { const d = days.get(r.day) || { tin: 0, tout: 0 }; d.tin += r.tin; d.tout += r.tout; days.set(r.day, d); });
  const key = dayKey(); const month = key.slice(0, 7);
  const sum = (f) => [...days.entries()].filter(([d]) => f(d)).reduce((a, [, v]) => ({ tin: a.tin + v.tin, tout: a.tout + v.tout }), { tin: 0, tout: 0 });
  const today = sum((d) => d === key); const mon = sum((d) => d.startsWith(month));
  const list = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  const line = (l, v) => '<div class="kv"><span>' + l + '</span><span>' + fmtTok(v.tin + v.tout) + ' tokens</span></div>';
  body.innerHTML = line('Today', today) + line('This month', mon) +
    '<div class="h3">Last 7 days</div>' +
    (list.map(([d, v]) => '<div class="kv"><span>' + d + '</span><span>' + fmtTok(v.tin) + ' in · ' + fmtTok(v.tout) + ' out</span></div>').join('') || '<div class="note">No usage yet.</div>') +
    '<div class="note" style="margin-top:12px">Counted from each provider\'s reply. Older days are removed after 14 days.</div>';
  const old = [...days.keys()].filter((d) => d < dayKeyAgo(14));
  if (old.length) rows.filter((r) => old.includes(r.day)).forEach((r) => db.del('usage', r.id).catch(() => {}));
}
async function exportChat() {
  const msgs = (await db.byIndex('messages', 'chatId', S.chat.id)).sort((a, b) => a.id - b.id);
  const t = msgs.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => (m.role === 'user' ? 'You' : 'KDex') + ':\n' + (m.text || '')).join('\n\n');
  toast(await copyText(t) ? 'Chat copied to clipboard' : 'Could not copy');
}

// ------------------------------------------------------------ git UI
const pct = (p) => (p && p.phase ? p.phase + (p.total ? ' ' + Math.round((p.loaded / p.total) * 100) + '%' : '') : '');
const GS = { tab: 'changes', sel: new Set(), known: new Set(), keepSel: false, hist: 10, reuse: null };
const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

const PHASES = { 'Analyzing workdir': 'Checking files', 'Updating workdir': 'Updating files', 'Counting objects': 'Counting objects', 'Compressing objects': 'Packing', 'Receiving objects': 'Downloading', 'Writing objects': 'Uploading', 'Resolving deltas': 'Finishing', 'Enumerating objects': 'Counting objects', 'Total': 'Finishing' };
const phaseOf = (p) => (p && p.phase ? (PHASES[p.phase] || p.phase) : '');
function busyLine(text, frac, onCancel) {
  const el = $('#gMsg'); if (!el) return;
  if (!text) { el.innerHTML = ''; return; }
  const w = frac == null ? 0 : Math.max(2, Math.min(100, Math.round(frac * 100)));
  el.innerHTML = '<div class="busy2"><div class="bl"><span class="spin"></span><span class="bt">' + esc(text) + '</span>' + (onCancel ? '<button class="linkbtn" id="gCancel">Cancel</button>' : '') + '</div><div class="bar' + (frac == null ? ' ind' : '') + '"><i' + (frac == null ? '' : ' style="width:' + w + '%"') + '></i></div></div>';
  if (onCancel) $('#gCancel').onclick = onCancel;
}
function errLine(text) {
  const el = $('#gMsg'); if (!el) return;
  if (!text) { el.innerHTML = ''; return; }
  const urls = [...new Set(String(text).match(/https?:\/\/[^\s<>"')]+/g) || [])];
  const html = esc(text).replace(/\n/g, '<br>');
  el.innerHTML = '<div class="err">' + html + '</div>' + (urls.length ? '<div class="erract">' + urls.slice(0, 2).map((u, i) => '<button class="btn sm" data-cu="' + i + '"><span class="lbl">Copy link</span></button>').join('') + '</div>' : '');
  $$('[data-cu]', el).forEach((b) => b.onclick = async () => toast(await copyText(urls[+b.dataset.cu]) ? 'Link copied. Open it in your browser.' : 'Could not copy'));
}
const DONE = { Fetching: 'Fetched', Pulling: 'Pulled', Pushing: 'Pushed', 'Force pushing': 'Force pushed', Committing: 'Committed', Discarding: 'Discarded', 'Creating branch': 'Branch created', 'Switching branch': 'Switched branch', Merging: 'Merged', 'Deleting branch': 'Branch deleted', 'Undoing commit': 'Commit undone', 'Saving remote': 'Remote saved', 'Switching to HTTPS': 'Remote switched to HTTPS' };
async function gitRun(label, fn, after, keep) {
  $$('#sheetBody .btn, #sheetBody .linkbtn, #sheetBody .icon-btn, #sheetBody .stg').forEach((b) => { b.disabled = true; });
  const t0 = Date.now(); const ac = new AbortController();
  const cancel = () => { ac.abort(); busyLine('Cancelling...'); };
  busyLine(label + '...', null, cancel);
  try {
    await fn((p) => { const ph = phaseOf(p); busyLine(label + (ph ? ' · ' + ph : '') + (p && p.total ? ' ' + Math.round((p.loaded / p.total) * 100) + '%' : ''), p && p.total ? p.loaded / p.total : null, cancel); }, ac.signal);
    if (ac.signal.aborted) { await openGit(GS.tab); toast('Cancelled'); return; }
    const secs = (Date.now() - t0) / 1000; toast((DONE[label] || 'Done') + (secs >= 2 ? ' · ' + secs.toFixed(1) + 's' : ''));
    if (keep && S.gitState && !S.gitState.pending) GS.reuse = typeof keep === 'function' ? keep(S.gitState.changes) : S.gitState.changes;
    if (after) await after(); else await openGit();
  } catch (e) {
    const m = (e && e.message) || String(e);
    if (ac.signal.aborted) { await openGit(GS.tab); toast('Cancelled'); return; }
    if (/^Set your Git name/.test(m)) { toast('Add your Git name and email first.'); openGitIdentity(() => openGit()); return; }
    await openGit(GS.tab, true); errLine(m);
  }
}

/** The cheap parts first, so the sheet opens fast. File changes and repository details follow. */
async function loadGitQuick(folder) {
  const [branch, branches, history, remote] = await Promise.all([G.currentBranch(folder), G.branches(folder), G.log(folder, GS.hist), G.remoteInfo(folder)]);
  const ab = remote ? await G.aheadBehind(folder) : null;
  const needToken = remote ? !(await G.getToken(remote.host).catch(() => null)) : false;
  return { branch, changes: [], pending: true, branches, history, remote, ab, needToken, repo: null };
}
async function loadGitChanges(folder, st) {
  const changes = await G.status(folder);
  const cur = new Set(changes.map((c) => c.path));
  const prevKnown = GS.keepSel ? GS.known : new Set();
  GS.sel = new Set([...cur].filter((p) => !prevKnown.has(p) || GS.sel.has(p)));
  GS.known = cur; GS.keepSel = true;
  st.changes = changes; st.pending = false;
}

const skeleton = () => '<div class="skel"><i style="width:60%"></i><i style="width:90%"></i><i style="width:75%"></i></div>';
let gitLoadId = 0;
async function openGit(tab, keepMsg) {
  if (!S.folder) { toast('Open a folder first.'); return; }
  const folder = S.folder; G.resetGitCache(folder);
  if (!(await G.isRepo(folder))) return openGitStart(folder);
  if (tab) GS.tab = tab;
  const my = ++gitLoadId;
  const reuse = GS.reuse; GS.reuse = null; // the working tree did not change, so do not scan every file again
  const body = sheet('Git');
  body.innerHTML = skeleton();
  let st;
  try { st = await loadGitQuick(folder); } catch (e) { body.innerHTML = '<div class="err">' + esc(e.message || String(e)) + '</div>'; return; }
  if (my !== gitLoadId) return;
  S.gitState = st;
  if (reuse) { st.changes = reuse; st.pending = false; const cur = new Set(reuse.map((c) => c.path)); GS.sel = new Set([...GS.sel].filter((x) => cur.has(x))); GS.known = cur; }
  const paint = () => {
    const head = gitHead(st);
    const tabs = [['changes', 'Changes' + (st.pending ? '' : st.changes.length ? ' (' + st.changes.length + ')' : '')], ['branches', 'Branches'], ['history', 'History'], ['remote', 'Remote']];
    const tb = $('#sheetTabs'); tb.classList.remove('hidden');
    tb.innerHTML = tabs.map(([k, l]) => '<button class="tab' + (GS.tab === k ? ' on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('');
    $$('[data-tab]', tb).forEach((b) => b.onclick = () => { GS.tab = b.dataset.tab; renderGitTab(folder, st, head, body); $$('[data-tab]', tb).forEach((x) => x.classList.toggle('on', x === b)); });
    renderGitTab(folder, st, head, body);
  };
  paint();
  // heavier work in the background; ignore it if the sheet moved on
  const stillHere = () => my === gitLoadId && S.gitState === st;
  (reuse ? Promise.resolve() : loadGitChanges(folder, st)).then(() => { if (!stillHere()) return; const keep = $('#gMsg') ? $('#gMsg').innerHTML : ''; const msg = $('#gMessage') ? $('#gMessage').value : ''; const top = $('#sheetBody').scrollTop; paint(); if ($('#gMsg')) $('#gMsg').innerHTML = keep; if ($('#gMessage')) $('#gMessage').value = msg; $('#sheetBody').scrollTop = top; updateGitChip(); }).catch((e) => { if (stillHere()) { st.pending = false; paint(); errLine((e && e.message) || String(e)); } });
  G.inspectRepo(folder).then((r) => { if (!stillHere()) return; st.repo = r; if (GS.tab === 'remote') { const top = $('#sheetBody').scrollTop; paint(); $('#sheetBody').scrollTop = top; } }).catch(() => {});
  if (keepMsg) return;
}

function gitHead(st) {
  const abTxt = st.ab && st.ab.ahead != null ? ((st.ab.ahead ? '↑' + st.ab.ahead : '') + (st.ab.behind ? ' ↓' + st.ab.behind : '')).trim() : '';
  return (
    '<div class="gsum"><div class="top2">' + ICON('branch') + '<div class="nm">' + esc(st.branch || '') + '</div>' + (abTxt ? '<span class="ab">' + abTxt + '</span>' : (st.remote && st.ab && st.ab.noRemoteBranch ? '<span class="ab">not pushed</span>' : '')) + '</div>' +
    '<div class="rm">' + (st.remote ? esc(st.remote.host + '/' + st.remote.path) : 'No remote yet') + '</div>' +
    '<div class="seg"><button id="gFetch" class="btn sm">' + ICON('fetch') + '<span class="lbl">Fetch</span></button><button id="gPull" class="btn sm">' + ICON('down') + '<span class="lbl">Pull</span></button><button id="gPush" class="btn sm">' + ICON('up') + '<span class="lbl">Push</span></button></div></div><div id="gMsg"></div>' +
    (st.needToken && st.remote.host ? '<div class="warnbar"><span>No access token saved for ' + esc(st.remote.host) + '. You need one to push or to use a private repository.</span><button id="gTok" class="btn sm"><span class="lbl">Add token</span></button></div>' : ''));
}

function renderGitTab(folder, st, head, body) {
  const foot = $('#sheetFoot'); foot.classList.add('hidden'); foot.innerHTML = '';
  let h = head;
  if (GS.tab === 'changes') {
    if (st.pending) h += '<div style="margin-top:16px">' + skeleton() + '</div>';
    else if (!st.changes.length) h += '<div class="note" style="margin-top:18px">No changes since the last commit.</div>';
    else {
      const staged = st.changes.filter((c) => GS.sel.has(c.path)); const unstaged = st.changes.filter((c) => !GS.sel.has(c.path));
      const row = (c, on) => '<div class="gr"><button class="stg' + (on ? ' on' : '') + '" data-sel="' + esc(c.path) + '" aria-label="' + (on ? 'Unstage ' : 'Stage ') + esc(c.path) + '">' + ICON(on ? 'minus' : 'plus') + '</button><div class="grow" data-gf="' + esc(c.path) + '"><div class="t">' + esc(baseOf(c.path)) + '</div>' + (dirOf(c.path) ? '<div class="s">' + esc(dirOf(c.path)) + '</div>' : '') + '</div><span class="kind ' + c.kind + '">' + c.kind + '</span><button class="icon-btn" data-gd="' + esc(c.path) + '" aria-label="Discard ' + esc(c.path) + '" style="width:34px;height:34px">' + ICON('undo') + '</button></div>';
      h += '<div class="gbar"><span class="h4">Staged (' + staged.length + ')</span>' + (staged.length ? '<button id="gUnstageAll" class="linkbtn">Unstage all</button>' : '') + '</div>' +
        (staged.map((c) => row(c, true)).join('') || '<div class="note" style="text-align:left">Nothing staged. Tap + on a file to include it in the next commit.</div>') +
        '<div class="gbar"><span class="h4">Changes (' + unstaged.length + ')</span><span>' + (unstaged.length ? '<button id="gStageAll" class="linkbtn">Stage all</button>' : '') + '<button id="gDiscardAll" class="linkbtn danger" style="margin-left:14px">Discard all</button></span></div>' +
        (unstaged.map((c) => row(c, false)).join('') || '<div class="note" style="text-align:left">Everything is staged.</div>');
      foot.classList.remove('hidden');
      foot.innerHTML = '<textarea id="gMessage" rows="1" placeholder="Commit message"></textarea><div class="row"><button id="gSuggest" class="btn" aria-label="Suggest a message">' + ICON('bulb') + '<span class="lbl">Suggest</span></button><button id="gCommit" class="btn primary"><span class="lbl"></span></button></div>';
    }
  } else if (GS.tab === 'branches') {
    h += '<button id="gNew" class="btn" style="width:100%;margin:10px 0 8px">' + ICON('plus') + '<span class="lbl">New branch from here</span></button>' +
      st.branches.map((b) => '<div class="row-item"><div class="grow"><div class="t">' + esc(b) + '</div></div>' + (b === st.branch ? '<span class="badge cur">current</span>' :
        '<button class="btn sm" data-sw="' + esc(b) + '"><span class="lbl">Switch</span></button><button class="btn sm" data-mg="' + esc(b) + '"><span class="lbl">Merge</span></button><button class="icon-btn" data-db="' + esc(b) + '" aria-label="Delete ' + esc(b) + '" style="width:34px;height:34px">' + ICON('trash') + '</button>') + '</div>').join('') +
      '<div class="note" style="text-align:left">Merge brings the chosen branch into <b>' + esc(st.branch || '') + '</b>.</div>';
  } else if (GS.tab === 'history') {
    h += (st.history.length ? '<button id="gUndo" class="btn" style="width:100%;margin:10px 0 4px">' + ICON('undo') + '<span class="lbl">Undo last commit (keep changes)</span></button>' : '') +
      (st.history.map((x) => '<div class="hist"><div class="t">' + esc(x.commit.message.trim().split('\n')[0]) + '</div><div class="s">' + esc(x.commit.author.name) + ' · ' + x.oid.slice(0, 7) + ' · ' + ago(x.commit.author.timestamp * 1000) + '</div></div>').join('') || '<div class="note">No commits yet.</div>') +
      (st.history.length >= GS.hist ? '<button id="gMore" class="btn" style="width:100%;margin-top:10px"><span class="lbl">Show 10 more</span></button>' : '');
  } else {
    h += repoCard(st);
    h += '<div class="h3">Remote</div><div class="card"><div class="t" style="word-break:break-all">' + (st.remote ? esc(st.remote.url) : 'No remote set') + '</div><div style="margin-top:10px"><button id="gRemote" class="btn sm"><span class="lbl">' + (st.remote ? 'Change URL' : 'Set remote URL') + '</span></button></div></div>';
    if (!st.remote) h += '<div class="h3">Create a new repository</div><div class="card"><p>Create a repository on GitHub or GitLab for these files and upload them.</p><button id="gPublish" class="btn primary" style="width:100%"><span class="lbl">Create and push</span></button></div>';
    h += '<div class="h3">Account</div><div class="card"><div class="kv" style="border:0"><span>Author</span><span id="gAuthor"></span></div><button id="gIdent" class="btn sm"><span class="lbl">Identity and tokens</span></button></div>' +
      '<div class="h3">Danger zone</div><div class="card danger-zone"><p>Force push replaces the remote branch with yours. Commits only on the remote are lost.</p><button id="gForce" class="btn sm danger"' + (st.remote ? '' : ' disabled') + '><span class="lbl">Force push</span></button>' +
      '<p style="margin-top:14px">Remove Git data for this folder from the app. Your files stay untouched.</p><button id="gWipe" class="btn sm danger"><span class="lbl">Remove Git from this folder</span></button></div>';
  }
  body.innerHTML = h;
  bindGit(folder, st, body);
}


function repoCard(st) {
  const r = st.repo;
  if (!r) return '<div class="h3">Repository</div><div class="card">' + skeleton() + '</div>';
  const o = r.remotes.find((x) => x.name === 'origin') || r.remotes[0];
  const kv = (k, v) => v ? '<div class="kv"><span>' + k + '</span><span>' + v + '</span></div>' : '';
  const proto = o ? '<span class="badge ' + (o.protocol === 'https' ? 'cur' : 'warn') + '">' + o.protocol.toUpperCase() + '</span>' : '';
  const when = r.head ? ago(r.head.at) : '';
  let h = '<div class="h3">Repository</div><div class="card repo">' +
    kv('Branch', esc(r.branch || 'none') + (r.detached ? ' (detached)' : '')) +
    kv('Tracking', esc(r.upstream || '')) +
    kv('Remote', o ? esc(o.host + '/' + o.path) + ' ' + proto : 'none') +
    kv('Last commit', r.head ? esc(r.head.message) : '') +
    kv('By', r.head ? esc(r.head.name + ' <' + r.head.email + '>') + (when ? ' · ' + esc(when) : '') : '') +
    kv('Repo author', r.config.name ? esc(r.config.name + ' <' + r.config.email + '>') : '') +
    kv('Data', r.mode === 'native' ? 'In the folder (.git)' : 'Inside the app') +
    '</div>';
  if (r.issues.length) h += r.issues.map((i, n) => '<div class="warnbar ' + i.level + '"><span>' + esc(i.text) + '</span>' + (i.fix ? '<button class="btn sm" data-fix="' + n + '"><span class="lbl">' + esc(i.fix) + '</span></button>' : '') + '</div>').join('');
  return h;
}

function bindGit(folder, st, body) {
  $$('[data-fix]', body).forEach((b) => b.onclick = async () => {
    const i = st.repo.issues[+b.dataset.fix];
    if (i.code === 'ssh') gitRun('Switching to HTTPS', () => G.useHttps(folder, i.remote, i.to), () => openGit('remote'));
    else if (i.code === 'identity') { if (i.cand) { await G.saveGitSettings({ name: i.cand.name, email: i.cand.email }); toast('Git identity saved'); await openGit('remote'); } else openGitIdentity(() => openGit('remote')); }
  });
  const run = (label, fn, keep) => gitRun(label, fn, undefined, keep);
  $('#gFetch').onclick = () => run('Fetching', (pr, sg) => G.fetchRemote(folder, { onProgress: pr, signal: sg }), true);
  $('#gPull').onclick = () => run('Pulling', (pr, sg) => G.pull(folder, { onProgress: pr, signal: sg }));
  $('#gPush').onclick = async () => {
    if (st.changes.length && !await confirmBox('Uncommitted changes', 'Push uploads commits only. Your ' + st.changes.length + ' uncommitted change(s) stay on this phone.', 'Push')) return;
    run('Pushing', (pr, sg) => G.push(folder, { onProgress: pr, signal: sg }), true);
  };
  $$('[data-gf]', body).forEach((r) => r.onclick = () => openGitDiff(folder, r.dataset.gf));
  const redraw = () => { const m = $('#gMessage') ? $('#gMessage').value : ''; const top = $('#sheetBody').scrollTop; renderGitTab(folder, st, gitHead(st), body); if ($('#gMessage')) $('#gMessage').value = m; $('#sheetBody').scrollTop = top; };
  $$('[data-sel]', body).forEach((c) => c.onclick = () => { GS.sel.has(c.dataset.sel) ? GS.sel.delete(c.dataset.sel) : GS.sel.add(c.dataset.sel); redraw(); });
  if ($('#gStageAll')) $('#gStageAll').onclick = () => { st.changes.forEach((x) => GS.sel.add(x.path)); redraw(); };
  if ($('#gUnstageAll')) $('#gUnstageAll').onclick = () => { GS.sel.clear(); redraw(); };
  $$('[data-gd]', body).forEach((b) => b.onclick = async () => {
    if (!await confirmBox('Discard changes?', 'Restore ' + b.dataset.gd + ' to the last commit. A new file is deleted.', 'Discard')) return;
    run('Discarding', () => G.discard(folder, b.dataset.gd));
  });
  if ($('#gDiscardAll')) $('#gDiscardAll').onclick = async () => {
    if (!await confirmBox('Discard all changes?', 'All ' + st.changes.length + ' changed files go back to the last commit. New files are deleted. This cannot be undone.', 'Discard all')) return;
    run('Discarding', () => G.discardAll(folder));
  };
  if ($('#gCommit')) {
    syncCommit(st);
    const ta = $('#gMessage'); ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'; };
    $('#gSuggest').onclick = async () => {
      const b = $('#gSuggest'); b.disabled = true; const l = b.querySelector('.lbl'); l.textContent = 'Thinking...';
      try { ta.value = await A.suggestCommitMessage(currentModelId(), folder); ta.oninput(); } catch (e) { errLine(e.message); }
      b.disabled = false; l.textContent = 'Suggest';
    };
    $('#gCommit').onclick = () => { const paths = st.changes.map((c) => c.path).filter((p) => GS.sel.has(p)); run('Committing', () => G.commit(folder, ta.value, paths, st.changes), (ch) => ch.filter((c) => !paths.includes(c.path))); };
  }
  if ($('#gTok')) $('#gTok').onclick = async () => { const t = await askText('Access token for ' + st.remote.host, 'Paste the token'); if (t) { await G.saveToken(st.remote.host, t); await G.rememberHost(st.remote.host); toast('Token saved'); openGit(GS.tab); } };
  if ($('#gNew')) $('#gNew').onclick = async () => { const n = await askText('New branch', 'Branch name', 'feature/my-change'); if (n) run('Creating branch', () => G.createBranch(folder, n.replace(/\s+/g, '-')), true); };
  $$('[data-sw]', body).forEach((b) => b.onclick = () => run('Switching branch', () => G.checkout(folder, b.dataset.sw)));
  $$('[data-mg]', body).forEach((b) => b.onclick = async () => { if (await confirmBox('Merge branch?', 'Merge "' + b.dataset.mg + '" into "' + st.branch + '"?', 'Merge')) run('Merging', () => G.mergeBranch(folder, b.dataset.mg)); });
  $$('[data-db]', body).forEach((b) => b.onclick = async () => { if (await confirmBox('Delete branch?', 'Delete "' + b.dataset.db + '" from this phone. The remote copy is not touched.', 'Delete')) run('Deleting branch', () => G.deleteBranch(folder, b.dataset.db)); });
  if ($('#gMore')) $('#gMore').onclick = () => { GS.hist = Math.min(GS.hist + 10, 50); openGit('history'); };
  if ($('#gUndo')) $('#gUndo').onclick = async () => { if (await confirmBox('Undo last commit?', 'The commit is removed from this branch. Its changes come back as uncommitted changes. Nothing is lost.', 'Undo commit')) run('Undoing commit', () => G.undoLastCommit(folder)); };
  if ($('#gRemote')) $('#gRemote').onclick = async () => { const u = await askText(st.remote ? 'Change remote URL' : 'Set remote URL', 'https://github.com/user/repo.git', st.remote ? st.remote.url : ''); if (u) run('Saving remote', () => G.setRemote(folder, u), true); };
  if ($('#gPublish')) $('#gPublish').onclick = () => openGitStart(folder, 'new');
  if ($('#gIdent')) { G.getGitSettings().then((g) => { const a = $('#gAuthor'); if (a) a.textContent = g.name ? g.name + ' <' + g.email + '>' : 'not set'; }); $('#gIdent').onclick = () => openGitIdentity(() => openGit('remote')); }
  if ($('#gForce')) $('#gForce').onclick = async () => {
    if (!await confirmBox('Force push?', 'This overwrites "' + st.branch + '" on the remote with your local version. Anyone else\'s commits there will be lost.', 'Force push')) return;
    run('Force pushing', (pr, sg) => G.push(folder, { force: true, onProgress: pr, signal: sg }), true);
  };
  if ($('#gWipe')) $('#gWipe').onclick = async () => {
    if (!await confirmBox('Remove Git from this folder?', 'The commit history of this project is deleted. Your files are not touched.', 'Remove')) return;
    await G.remove(folder); toast('Git removed'); updateGitChip(); openGit();
  };
}
function syncCommit(st) {
  const n = st.changes.filter((c) => GS.sel.has(c.path)).length; const b = $('#gCommit'); if (!b) return;
  b.disabled = !n; b.querySelector('.lbl').textContent = n ? 'Commit ' + n + ' staged' : 'Stage files first';
}
/** Private input for a secret value. Resolves with the text, or null on Skip. The value never touches the chat. */
function askSecret(info, signal) {
  return new Promise((res) => {
    $('#dlgTitle').textContent = 'Add ' + info.name + (info.step ? ' (' + info.step + ')' : '');
    $('#dlgText').innerHTML = (info.description ? '<div style="margin-bottom:8px">' + esc(info.description) + '</div>' : '') +
      '<div style="margin-bottom:8px;font-size:12.5px">Saved to <b>' + esc(info.file) + '</b> in this project. The agent never sees the value and it is not shown in the chat.</div>' +
      '<div style="display:flex;gap:6px"><input id="dlgInput" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex:1;min-width:0;height:42px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:var(--card);outline:0" placeholder="Value"><button id="dlgEye" type="button" class="icon-btn" aria-label="Show value">' + ICON('eye') + '</button></div>';
    $('#dlgYes').firstElementChild.textContent = 'Save'; $('#dlgNo').firstElementChild.textContent = 'Skip'; $('#dialog').classList.remove('hidden');
    setTimeout(() => { const i = $('#dlgInput'); if (i) i.focus(); }, 60);
    $('#dlgEye').onclick = () => { const i = $('#dlgInput'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#dlgEye').setAttribute('aria-label', show ? 'Hide value' : 'Show value'); };
    const done = (v) => {
      const t = $('#dlgInput') ? $('#dlgInput').value : '';
      $('#dialog').classList.add('hidden'); $('#dlgText').textContent = ''; $('#dlgNo').firstElementChild.textContent = 'Cancel'; $('#dlgYes').onclick = $('#dlgNo').onclick = null;
      res(v && t.trim() ? t.trim() : null);
    };
    $('#dlgYes').onclick = () => { if (!$('#dlgInput').value.trim()) { $('#dlgInput').focus(); return; } done(true); };
    $('#dlgNo').onclick = () => done(false);
    if (signal) signal.addEventListener('abort', () => { if (!$('#dialog').classList.contains('hidden')) done(false); }, { once: true });
  });
}
function askText(title, placeholder, value = '') {
  return new Promise((res) => {
    $('#dlgTitle').textContent = title; $('#dlgText').innerHTML = '<input id="dlgInput" style="width:100%;height:42px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:var(--card);outline:0" placeholder="' + esc(placeholder) + '" autocapitalize="off" autocomplete="off">';
    $('#dlgInput').value = value; $('#dlgYes').firstElementChild.textContent = 'OK'; $('#dialog').classList.remove('hidden');
    setTimeout(() => { const i = $('#dlgInput'); if (i) i.focus(); }, 50);
    const done = (v) => { const t = $('#dlgInput') ? $('#dlgInput').value.trim() : ''; $('#dialog').classList.add('hidden'); $('#dlgText').textContent = ''; $('#dlgYes').onclick = $('#dlgNo').onclick = null; res(v ? t : null); };
    $('#dlgYes').onclick = () => done(true); $('#dlgNo').onclick = () => done(false);
  });
}

async function openGitDiff(folder, path) {
  const body = sheet(path, { back: () => openGit() });
  body.innerHTML = '<div class="busy"><span class="spin"></span>Loading...</div>';
  try {
    const d = await G.diffFile(folder, path);
    body.innerHTML = '<div class="gbar"><span>+' + d.added + ' −' + d.removed + '</span></div><div class="tool"><div class="diff" style="max-height:none">' + d.lines.map((l) => '<span class="dl ' + (l.t === 'add' ? 'a' : l.t === 'del' ? 'd' : 'c') + '">' + esc((l.t === 'add' ? '+ ' : l.t === 'del' ? '- ' : '  ') + (l.text || '')) + '</span>').join('') + '</div></div>';
  } catch (e) { body.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; }
}

/** Start screen for a folder without Git: clone, publish as a new repository, or keep it local. */
async function openGitStart(folder, mode) {
  const body = sheet('Git for ' + folder.name);
  const hosts = await G.listTokenHosts();
  let empty = true; try { empty = !(await fs.list(folder.uri, '')).length; } catch (e) { /* ignore */ }
  let m = mode || (empty ? 'clone' : 'new');
  const draw = () => {
    const tabs = [['clone', 'Clone'], ['new', 'New repo'], ['local', 'Local only']];
    let h = '<div class="seg" style="margin-bottom:14px">' + tabs.map(([k, l]) => '<button class="btn sm' + (m === k ? ' on' : '') + '" data-m="' + k + '"><span class="lbl">' + l + '</span></button>').join('') + '</div><div id="gMsg"></div>';
    if (m === 'clone') {
      h += '<p class="note" style="text-align:left;margin-top:0">Download a repository into a new folder named after it, inside <b>' + esc(folder.name) + '</b>. The new folder opens as its own project.</p>' + cloneFields(hosts) +
        '<button id="cGo" class="btn primary" style="width:100%;margin-top:8px"><span class="lbl">Clone repository</span></button>';
    } else if (m === 'new') {
      h += '<p class="note" style="text-align:left;margin-top:0">Create a repository on GitHub or GitLab for the files in this folder and upload them.</p>' +
        '<div class="field"><span>Service</span><div class="seg" id="nProv"><button class="btn sm on" data-v="github"><span class="lbl">GitHub</span></button><button class="btn sm" data-v="gitlab"><span class="lbl">GitLab</span></button></div></div>' +
        '<label class="field hidden" id="nHostF"><span>GitLab host</span><input id="nHost" value="gitlab.com" autocapitalize="off"></label>' +
        '<label class="field"><span>Repository name</span><input id="nName" value="' + esc(G.repoSlug(folder.name)) + '" autocapitalize="off"></label>' +
        '<div class="field"><span>Visibility</span><div class="seg" id="nVis"><button class="btn sm on" data-v="private"><span class="lbl">Private</span></button><button class="btn sm" data-v="public"><span class="lbl">Public</span></button></div></div>' +
        '<label class="field"><span>Description (optional)</span><input id="nDesc"></label>' +
        '<label class="field"><span>Access token</span><input id="nTok" type="password" autocomplete="off" autocapitalize="off" placeholder="' + (hosts.length ? 'Leave empty to use a saved token' : 'Needs permission to create repositories') + '"></label>' +
        '<label class="gr" style="border:0"><input type="checkbox" class="cb" id="nIgn" checked><span>Add a .gitignore (node_modules, .env, logs) if missing</span></label>' +
        '<button id="nGo" class="btn primary" style="width:100%;margin-top:8px"><span class="lbl">Create and push</span></button>' +
        '<div class="safe">' + ICON('lock') + '<span>Every file in this folder is uploaded. Check for secrets first.</span></div>';
    } else {
      h += '<p class="note" style="text-align:left;margin-top:0">Track changes on this phone only. You can add a remote later.</p><button id="lGo" class="btn primary" style="width:100%"><span class="lbl">Initialize repository</span></button>';
    }
    body.innerHTML = h;
    $$('[data-m]', body).forEach((b) => b.onclick = () => { m = b.dataset.m; draw(); });
    const segVal = (id) => { const on = $('#' + id + ' .on'); return on ? on.dataset.v : ''; };
    ['nProv', 'nVis'].forEach((id) => { $$('#' + id + ' .btn', body).forEach((b) => b.onclick = () => { $$('#' + id + ' .btn', body).forEach((x) => x.classList.toggle('on', x === b)); if (id === 'nProv') $('#nHostF').classList.toggle('hidden', b.dataset.v !== 'gitlab'); }); });
    const lock = (on) => $$('#sheetBody .btn').forEach((b) => b.disabled = on);
    const fail = (e) => { lock(false); const msg = (e && e.message) || String(e); if (/^Set your Git name/.test(msg)) { toast('Add your Git name and email first.'); openGitIdentity(() => openGitStart(folder, m)); } else errLine(msg); };
    if ($('#cGo')) $('#cGo').onclick = async () => {
      const v = readCloneFields(); if (!v.url) { errLine('Enter the repository URL.'); return; }
      lock(true);
      try { await runClone(folder, v, (t) => busyLine(t)); } catch (e) { fail(e); }
    };
    if ($('#nGo')) $('#nGo').onclick = async () => {
      const provider = segVal('nProv'); lock(true); busyLine('Starting...');
      try {
        if ($('#nIgn').checked) { try { await fs.stat(folder.uri, '.gitignore').then(async (s) => { if (!s || !s.exists) await fs.writeText(folder.uri, '.gitignore', 'node_modules/\n.env\n.env.*\n*.log\n.DS_Store\n__pycache__/\n*.pyc\n'); }); } catch (e) { /* optional */ } }
        const r = await G.publishNew(folder, { provider, host: $('#nHost').value.trim(), name: $('#nName').value, isPrivate: segVal('nVis') === 'private', description: $('#nDesc').value.trim(), token: $('#nTok').value.trim(), message: 'Initial commit' }, (t) => busyLine(t + '...'));
        toast('Repository created'); GS.keepSel = false; drawCtx(); await openGit('remote'); const el = $('#gMsg'); if (el) el.innerHTML = '<div class="ok">Uploaded to ' + esc(r.webUrl || r.cloneUrl) + '</div>';
      } catch (e) { fail(e); }
    };
    if ($('#lGo')) $('#lGo').onclick = async () => { try { await G.init(folder); toast('Repository created'); GS.keepSel = false; drawCtx(); openGit('changes'); } catch (e) { fail(e); } };
  };
  draw();
}

async function openGitIdentity(back) {
  const body = sheet('Git identity and tokens', { back });
  const gs = await G.getGitSettings(); const hosts = await G.listTokenHosts();
  body.innerHTML =
    '<div class="h3">Commit author</div>' +
    '<label class="field"><span>Name</span><input id="gName" value="' + esc(gs.name) + '"></label>' +
    '<label class="field"><span>Email</span><input id="gEmail" type="email" value="' + esc(gs.email) + '" autocapitalize="off"></label>' +
    '<div class="h3">Access tokens</div>' +
    (hosts.map((h) => '<div class="row-item">' + ICON('key') + '<div class="grow"><div class="t">' + esc(h) + '</div><div class="s">Token saved</div></div><button class="icon-btn" data-rh="' + esc(h) + '">' + ICON('trash') + '</button></div>').join('') || '<div class="note">No tokens saved.</div>') +
    '<label class="field" style="margin-top:10px"><span>Host</span><input id="tHost" value="github.com" autocapitalize="off"></label>' +
    '<label class="field"><span>Token</span><input id="tTok" type="password" autocomplete="off" autocapitalize="off"><small>GitHub: Settings > Developer settings > Personal access tokens (needs repo access). GitLab: a token with write_repository.</small></label>' +
    '<button id="tSave" class="btn primary" style="width:100%"><span class="lbl">Save</span></button><div id="tMsg"></div>';
  $('#tSave').onclick = async () => {
    await G.saveGitSettings({ name: $('#gName').value.trim(), email: $('#gEmail').value.trim() });
    const h = $('#tHost').value.trim().toLowerCase(); const t = $('#tTok').value.trim();
    if (t && h) { await G.saveToken(h, t); await G.rememberHost(h); }
    toast('Saved'); openGitIdentity(back);
  };
  $$('[data-rh]', body).forEach((b) => b.onclick = async () => { await G.forgetHost(b.dataset.rh); openGitIdentity(back); });
}

// ------------------------------------------------------------ clone from Projects
function cloneFields(hosts) {
  return '<label class="field"><span>Repository URL</span><input id="cUrl" placeholder="https://github.com/user/repo.git" autocapitalize="off" autocomplete="off"></label>' +
    '<label class="field"><span>Access token</span><input id="cTok" type="password" autocomplete="off" autocapitalize="off" placeholder="' + (hosts && hosts.length ? 'Leave empty to use a saved token' : 'Private repos and pushing') + '"><small>Stored encrypted on this phone, once per host.</small></label>' +
    '<label class="field"><span>Folder name (optional)</span><input id="cName" placeholder="Defaults to the repository name" autocapitalize="off" autocomplete="off"></label>' +
    '<label class="gr" style="border:0"><input type="checkbox" class="cb" id="cFull"><span>Download full history (slower)</span></label>';
}
const readCloneFields = () => ({ url: $('#cUrl').value.trim(), token: $('#cTok').value.trim(), name: $('#cName').value.trim(), full: $('#cFull').checked });
/** Clone into a new sub-folder of `parent` and open it as a project. */
async function runClone(parent, v, say) {
  say('Cloning...');
  const f = await G.cloneInto(parent, v.url, { token: v.token, name: v.name, depth: v.full ? 0 : 1, id: uid(), onProgress: (p) => say('Cloning ' + pct(p)) });
  S.folders.push(f); await A.saveFolders(S.folders);
  GS.keepSel = false; closeSheet(); await applyFolder(f);
  if (S.folder && S.folder.id === f.id) { toast('Cloned into ' + f.name); openGit('changes'); }
}
/** Projects > Clone: ask for the repository, then for the folder it should go into. */
async function cloneFlow() {
  const body = sheet('Clone a repository', { back: openProjects });
  const hosts = await G.listTokenHosts();
  body.innerHTML = '<p class="note" style="text-align:left;margin-top:0">You choose any folder on your phone. A new folder named after the repository is created inside it, so the folder does not need to be empty.</p><div id="gMsg"></div>' + cloneFields(hosts) +
    '<button id="cGo" class="btn primary" style="width:100%;margin-top:8px"><span class="lbl">Choose folder and clone</span></button>';
  $('#cGo').onclick = async () => {
    const v = readCloneFields(); if (!v.url) { errLine('Enter the repository URL.'); return; }
    let r; try { r = await fs.pickFolder(); } catch (e) { if (!/cancel/i.test(e.message || '')) errLine(e.message || 'Could not open the folder'); return; }
    if (!r || !r.uri) return;
    $$('#sheet .btn').forEach((b) => { b.disabled = true; });
    const parent = { id: uid(), name: r.name || 'Folder', uri: r.uri };
    try { await runClone(parent, v, (t) => busyLine(t)); }
    catch (e) { $$('#sheet .btn').forEach((b) => { b.disabled = false; }); const m = (e && e.message) || String(e); if (/^Set your Git name/.test(m)) { toast('Clone does not need a name, but pushing does. Add it in Settings > Git.'); } errLine(m); }
  };
}

// ------------------------------------------------------------ report a reply (store policy for AI apps)
async function reportReply(id) {
  const m = await db.get('messages', id); if (!m) return;
  if (!await confirmBox('Report this reply?', 'Use this if the reply is harmful, offensive or wrong in a dangerous way. The reply text is flagged on this phone' + (SUPPORT_EMAIL ? ' and an email draft opens so you can send it to us.' : '.'), 'Report')) return;
  m.reported = true; await db.put('messages', m);
  if (SUPPORT_EMAIL) location.href = 'mailto:' + SUPPORT_EMAIL + '?subject=' + encodeURIComponent('KDex Agent: reported reply') + '&body=' + encodeURIComponent('Reported reply:\n\n' + (m.text || '').slice(0, 3000));
  toast('Reported. Thank you.');
}

// ------------------------------------------------------------ backup export / import (no API keys inside)
async function exportBackup() {
  const r = await fs.pickFolder().catch(() => null); if (!r || !r.uri) return;
  const data = { app: 'kdex-agent', version: 1, at: Date.now() };
  for (const st of ['kv', 'chats', 'messages', 'backups', 'usage']) data[st] = await db.all(st);
  data.kv = data.kv.filter((x) => x.key !== 'lastChat');
  const name = 'kdex-agent-backup-' + dayKey() + '.json';
  await fs.writeText(r.uri, name, JSON.stringify(data));
  toast('Saved ' + name + ' in ' + (r.name || 'the folder'));
}
async function importBackup() {
  const r = await fs.pickFolder().catch(() => null); if (!r || !r.uri) return;
  const files = (await fs.list(r.uri, '')).filter((e) => !e.isDir && /^kdex-agent-backup-.*\.json$/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name));
  if (!files.length) { toast('No backup file found in that folder.'); return; }
  const f = files[0];
  if (!await confirmBox('Restore backup?', 'Restore ' + f.name + '? Chats, notes and settings in the file replace the current ones. API keys are never in a backup; add them again if needed.', 'Restore')) return;
  const t = await fs.readText(r.uri, f.path, 64 * 1024 * 1024);
  const data = JSON.parse(t.text);
  if (data.app !== 'kdex-agent') { toast('This is not a KDex Agent backup.'); return; }
  for (const st of ['chats', 'messages', 'backups', 'usage']) { for (const row of await db.all(st)) await db.del(st, st === 'chats' || st === 'kv' ? row.id || row.key : row.id); }
  for (const st of ['kv', 'chats', 'messages', 'backups', 'usage']) for (const row of data[st] || []) await db.put(st, row);
  toast('Restored. Restarting...'); setTimeout(() => location.reload(), 700);
}

// ------------------------------------------------------------ wiring
function wire() {
  // After startup, a failed action shows a message instead of covering the app with an error page.
  const oops = (e) => { const r = e && (e.reason || e.error) || e; const msg = String((r && r.message) || r || 'Unknown error').slice(0, 140); console.error(r); toast('Something went wrong: ' + msg); };
  window.addEventListener('unhandledrejection', (e) => { if (window.__stage !== 'ready') return; e.preventDefault(); oops(e); });
  window.addEventListener('error', (e) => { if (window.__stage !== 'ready' || (e.target && (e.target.src || e.target.href))) return; oops(e); });
  $('#menuBtn').onclick = openDrawer; $('#scrim').onclick = closeDrawer;
  $('#dNew').onclick = () => newChat(null); $('#topNewBtn').onclick = () => newChat(null);
  $('#dProjects').onclick = () => { closeDrawer(); openProjects(); }; $('#topFolderBtn').onclick = openProjects; $('#chipFolder').onclick = openProjects;
  $('#dSettings').onclick = () => { closeDrawer(); openSettings(); };
  $('#chipFiles').onclick = () => openFiles(''); $('#chipGit').onclick = () => openGit(); $('#chipChanges').onclick = openChanges; $('#chipTerm').onclick = openTerminal; $('#chipAuto').onclick = toggleAuto;
  $('#sheetClose').onclick = closeSheet;
  $('#chatSearch').oninput = drawChatList;
  $('#chatList').onclick = async (e) => {
    const d = e.target.closest('[data-del]');
    if (d) {
      if (!await confirmBox('Delete chat?', 'This chat and its backups are removed from the phone.', 'Delete')) return;
      await A.removeChat(d.dataset.del); await loadChats(); if (S.chat && S.chat.id === d.dataset.del) await newChat(null); return;
    }
    const it = e.target.closest('[data-id]'); if (it) openChat(it.dataset.id);
  };
  $('#composer').onsubmit = (e) => { e.preventDefault(); send(false); };
  $('#input').addEventListener('input', autoGrow);
  $('#attachBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  $('#chips').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { S.attach.splice(Number(b.dataset.rm), 1); drawChips(); } };
  $('#thinkBtn').onclick = (e) => { e.stopPropagation(); $('#thinkMenu').classList.toggle('hidden'); };
  $('#thinkMenu').onclick = (e) => { const b = e.target.closest('[data-think]'); if (!b) return; S.think = b.dataset.think; drawThink(); $('#thinkMenu').classList.add('hidden'); persistChat(); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#thinkMenu')) $('#thinkMenu').classList.add('hidden'); });
  $('#modelSelect').onchange = persistChat;
  $('#modelSelect').addEventListener('pointerdown', (e) => { if (!S.models.length) { e.preventDefault(); showSetup(false, 'Connect a model'); } });
  $('#approveAll').onclick = () => [...S.approvals.keys()].forEach((id) => decide(id, 'apply'));
  $('#messages').addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) {
      const box = c.closest('.code'); const code = box && box.querySelector('code');
      const ok = code ? await copyText(code.textContent) : false;
      c.firstElementChild.textContent = ok ? 'Copied' : 'Failed'; setTimeout(() => { c.firstElementChild.textContent = 'Copy'; }, 1400); return;
    }
    const uf = e.target.closest('[data-ufile]');
    if (uf) { const [mid, ix] = uf.dataset.ufile.split(':'); const um = await db.get('messages', Number(mid)); const f = um && um.fileData && um.fileData[Number(ix)]; if (f) await saveOut(f.name, f.text); return; }
    const t = e.target.closest('[data-tool]');
    if (t) {
      if (t.dataset.tool === 'getfile' || t.dataset.tool === 'copyfile') {
        const fm = await db.get('messages', Number(t.dataset.id)); if (!fm || !fm.file) return;
        if (t.dataset.tool === 'copyfile') { toast(await copyText(fm.fileContent) ? 'Copied' : 'Could not copy'); return; }
        await saveOut(fm.file.name, fm.fileContent); return;
      }
      if (t.dataset.tool === 'undo') { await undoOne(Number(t.dataset.b)); return; }
      decide(t.dataset.id, t.dataset.tool === 'apply' ? 'apply' : t.dataset.tool === 'always' ? 'always' : 'reject'); return;
    }
    const a = e.target.closest('[data-act]');
    if (a) {
      if (a.dataset.act === 'regen') regenerate();
      else if (a.dataset.act === 'report') reportReply(Number(a.closest('.msg').dataset.id));
      else { const el = a.closest('.msg'); const m = await db.get('messages', Number(el.dataset.id)); toast(await copyText(m.text || '') ? 'Copied' : 'Could not copy'); }
    }
  });
  $('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(false); } });
  if (App && App.addListener) Promise.resolve(App.addListener('backButton', () => {
    if (!$('#dialog').classList.contains('hidden')) { $('#dlgNo').click(); return; }
    if (!$('#setup').classList.contains('hidden') && $('#sCancel')) { $('#sCancel').click(); return; }
    if (!$('#sheet').classList.contains('hidden')) { const b = $('#sheetBack'); if (!b.classList.contains('hidden')) b.click(); else closeSheet(); return; }
    if ($('#drawer').classList.contains('open')) { closeDrawer(); return; }
    if (S.running) { stopRun(); return; }
    App.exitApp();
  })).catch(() => {});
}

boot().catch((e) => { const f = document.getElementById('fatal'); f.style.display = 'block'; f.textContent = 'Startup error: ' + (e && (e.stack || e.message)) + '\nstage=' + window.__stage; });
