// KDex Chat (Android) - UI layer. All data stays on this phone.
import { $, $$, esc, uid, fmtBytes, fmtTok, fmtUsd, ago, dayKey } from './util.js';
import { db } from './db.js';
import { secure, fs, App, isNative } from './native.js';
import { PRESETS, listModels } from './providers.js';
import { renderMarkdown } from './md.js';
import * as A from './agent.js';

const S = {
  settings: null, providers: [], models: [], folders: [], chats: [],
  chat: null, folder: null, think: 'off', running: false, abort: null,
  approvals: new Map(), els: new Map(), attach: [], sheetStack: [],
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
function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
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
  fitViewport();
  S.settings = await A.getSettings(); applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  S.providers = await A.getProviders(); S.models = await A.getModels(); S.folders = await A.getFolders();
  wire();
  if (!S.models.length) { showSetup(true); return; }
  await enter();
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
  el.innerHTML = S.models.map((m) => '<option value="' + esc(m.id) + '">' + esc(modelLabel(m)) + '</option>').join('');
  const want = sel || (S.chat && S.chat.model) || S.settings.defaultModel;
  if (want && S.models.find((m) => m.id === want)) el.value = want;
}

// ------------------------------------------------------------ setup / add provider
function showSetup(first) {
  const box = $('#setup'); box.classList.remove('hidden');
  let preset = PRESETS[0];
  const draw = () => {
    box.innerHTML = '<div class="wrap"><svg class="logo"><use href="#i-logo"/></svg><h1>' + (first ? 'Welcome to KDex Chat' : 'Add a provider') + '</h1>' +
      '<p class="sub">Use your own API key. It is stored encrypted on this phone and sent only to the provider you choose.</p>' +
      '<div class="seg" style="flex-wrap:wrap;margin-bottom:14px">' + PRESETS.map((p) => '<button type="button" class="btn sm' + (p.key === preset.key ? ' on' : '') + '" data-p="' + p.key + '"><span class="lbl">' + p.name + '</span></button>').join('') + '</div>' +
      '<label class="field"><span>Name</span><input id="sName" value="' + esc(preset.name) + '"></label>' +
      '<label class="field ' + (preset.key === 'custom' ? '' : 'hidden') + '" id="sUrlF"><span>Base URL (OpenAI-compatible)</span><input id="sUrl" placeholder="https://example.com/v1" value="' + esc(preset.baseUrl) + '" autocapitalize="off"></label>' +
      '<label class="field"><span>API key</span><input id="sKey" type="password" placeholder="' + esc(preset.hint) + '" autocomplete="off" autocapitalize="off"></label>' +
      '<div id="sMsg"></div><div id="sModels"></div>' +
      '<button id="sGo" class="btn primary" type="button" style="width:100%"><span class="lbl">Connect and load models</span></button>' +
      '<div class="safe">' + ICON('lock') + '<span>No account, no server. Chats and files never leave your phone except to your provider.</span></div>' +
      (first ? '' : '<button id="sCancel" class="btn" type="button" style="width:100%"><span class="lbl">Cancel</span></button>') + '</div>';
    $$('[data-p]', box).forEach((b) => b.onclick = () => { preset = PRESETS.find((p) => p.key === b.dataset.p); draw(); });
    $('#sGo').onclick = go;
    if ($('#sCancel')) $('#sCancel').onclick = () => box.classList.add('hidden');
  };
  const go = async () => {
    const msg = $('#sMsg'); msg.innerHTML = '';
    const name = $('#sName').value.trim() || preset.name;
    const baseUrl = (preset.key === 'custom' ? $('#sUrl').value : preset.baseUrl).trim();
    const key = $('#sKey').value.trim();
    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) { msg.innerHTML = '<div class="err">Enter a valid base URL.</div>'; return; }
    if (!key) { msg.innerHTML = '<div class="err">Enter your API key.</div>'; return; }
    const prov = { id: uid(), name, type: preset.type, baseUrl };
    const btn = $('#sGo'); btn.disabled = true; btn.firstElementChild.textContent = 'Checking...';
    let ids = [];
    try { ids = await listModels(prov, key); } catch (e) { msg.innerHTML = '<div class="err">' + esc(e.message || 'Could not connect') + '</div><div class="note">You can still type a model id below.</div>'; }
    btn.disabled = false; btn.firstElementChild.textContent = 'Save provider';
    renderPick(prov, key, ids);
  };
  const renderPick = (prov, key, ids) => {
    const wrap = $('#sModels');
    wrap.innerHTML = (ids.length ? '<div class="ok">Key works. Pick the models you want (max 12).</div><div style="max-height:220px;overflow:auto;margin-bottom:10px">' +
      ids.map((id, i) => '<label class="row-item" style="padding:8px 12px"><input type="checkbox" data-id="' + esc(id) + '"' + (i < 3 ? ' checked' : '') + '><span class="grow t">' + esc(id) + '</span></label>').join('') + '</div>' : '') +
      '<label class="field"><span>Or type a model id</span><input id="sManual" placeholder="e.g. claude-sonnet-5-5" autocapitalize="off"></label>';
    const go = $('#sGo'); go.onclick = async () => {
      const picked = $$('[data-id]:checked', wrap).map((x) => x.dataset.id).slice(0, 12);
      const man = $('#sManual').value.trim(); if (man) picked.push(man);
      if (!picked.length) { $('#sMsg').innerHTML = '<div class="err">Pick or type at least one model.</div>'; return; }
      await secure.set(A.keyName(prov.id), key);
      S.providers.push(prov); await A.saveProviders(S.providers);
      picked.forEach((api) => S.models.push({ id: uid(), providerId: prov.id, apiModel: api, label: api + (S.providers.length > 1 ? ' (' + prov.name + ')' : '') }));
      await A.saveModels(S.models);
      toast('Provider saved');
      if (first) await enter(); else { $('#setup').classList.add('hidden'); fillModels(); if (S.sheetStack.length) openSettings(); }
    };
  };
  draw();
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
  S.chat = { id: uid(), title: '', model: currentModelId(), think: S.settings.defaultThink || 'off', folderId: folder ? folder.id : null, updated: Date.now() };
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
function renderEmpty() {
  $('#messages').innerHTML = '<div class="empty"><svg><use href="#i-logo"/></svg><h2>How can I help?</h2><div>' +
    (S.folder ? 'Working in <b>' + esc(S.folder.name) + '</b>. Ask me to read, search or change files.' : 'Open a folder from Projects to let me work on your files.') + '</div></div>';
}
async function persistChat() {
  if (!S.chat) return;
  S.chat.updated = Date.now(); S.chat.model = currentModelId(); S.chat.think = S.think;
  S.chat.folderId = S.folder ? S.folder.id : null;
  await db.put('chats', S.chat); await db.put('kv', { key: 'lastChat', value: S.chat.id });
}

// ------------------------------------------------------------ context bar (folder chip)
function drawCtx() {
  const bar = $('#ctxBar');
  if (S.folder) { bar.classList.remove('hidden'); $('#chipFolderName').textContent = S.folder.name; updateChangesChip(); }
  else bar.classList.add('hidden');
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
      (m.files && m.files.length ? '<div class="fnames">' + m.files.map(esc).join(', ') + '</div>' : '') + (m.text ? '<div class="bubble">' + esc(m.text) + '</div>' : '');
  } else if (m.role === 'assistant') {
    el.className = 'msg assistant';
    const live = m.status === 'streaming';
    let h = '';
    if (m.thought) h += '<details class="think" data-tk="' + m.id + '"' + (el.dataset.open ? ' open' : '') + '><summary>' + ICON('bulb') + '<span class="lbl">' + thinkLabelOf(m, live) + '</span></summary><div class="tb">' + esc(m.thought) + '</div></details>';
    if (m.text) h += '<div class="body">' + renderMarkdown(m.text) + '</div>';
    else if (live && !m.calls.length && !m.thought) h += '<div class="body"><span class="dots"></span></div>';
    if (!live && (m.text || m.status === 'error')) {
      h += '<div class="acts"><button class="icon-btn" data-act="copy" aria-label="Copy">' + ICON('copy') + '</button><button class="icon-btn" data-act="regen" aria-label="Regenerate">' + ICON('refresh') + '</button></div>';
      if (m.tin || m.tout) h += '<div class="meta">' + fmtTok(m.tin) + ' in · ' + fmtTok(m.tout) + ' out</div>';
    }
    const open = el.querySelector('details.think'); const wasOpen = open && open.open;
    el.innerHTML = h;
    const nd = el.querySelector('details.think'); if (nd && wasOpen) nd.open = true;
    if (nd) nd.addEventListener('toggle', () => { el.dataset.open = nd.open ? '1' : ''; });
    if (!h) el.style.display = 'none'; else el.style.display = '';
  } else if (m.role === 'tool') {
    el.className = 'msg tool-wrap';
    el.innerHTML = toolCard(m);
  }
  scrollEnd();
}
const TOOL_ICON = { list_dir: 'folder', find_files: 'search', search: 'search', read_file: 'file', write_file: 'edit', edit_file: 'edit', delete_file: 'trash' };
function toolCard(m) {
  const st = m.status || 'running';
  let h = '<div class="tool"><div class="th">' + ICON(TOOL_ICON[m.name] || 'file') + '<span class="nm">' + esc(m.name) + '</span><span class="pa">' + esc(m.args || '') + '</span><span class="st ' + st + '">' + esc(st === 'running' ? 'working' : st) + '</span></div>';
  if (m.plan) {
    h += '<div class="diff">' + (m.plan.diff || []).map((l) => '<span class="dl ' + (l.t === 'add' ? 'a' : l.t === 'del' ? 'd' : 'c') + '">' + esc((l.t === 'add' ? '+ ' : l.t === 'del' ? '- ' : '  ') + (l.text || '')) + '</span>').join('') +
      (m.plan.more ? '<span class="dl c">... ' + m.plan.more + ' more lines</span>' : '') + '</div>';
    h += '<div class="tf"><span class="lbl" style="flex:1">' + esc(m.plan.op) + ' · +' + m.plan.added + ' −' + m.plan.removed + '</span>';
    if (st === 'pending') h += '<button class="btn sm" data-tool="reject" data-id="' + m.id + '"><span class="lbl">Reject</span></button><button class="btn primary sm" data-tool="apply" data-id="' + m.id + '"><span class="lbl">Apply</span></button>';
    else if (st === 'applied' && m.backupId) h += '<button class="btn sm" data-tool="undo" data-b="' + m.backupId + '">' + ICON('undo') + '<span class="lbl">Undo</span></button>';
    h += '</div>';
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
  S.approvals.delete(Number(id)); r(v); updateApproveBar();
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
async function send(regenerate) {
  if (S.running) { stopRun(); return; }
  const input = $('#input'); const text = regenerate ? '' : input.value.trim();
  if (!regenerate && !text && !S.attach.length) return;
  if (!S.models.length) { showSetup(true); return; }
  const attach = regenerate ? [] : S.attach;
  const images = attach.filter((a) => a.img).map((a) => ({ mime: a.mime, data: a.data }));
  const files = attach.filter((a) => !a.img);
  const fullText = files.length ? files.map((f) => '[File: ' + f.name + ']\n' + f.text).join('\n\n') + (text ? '\n\n' + text : '') : text;
  if (!regenerate) { input.value = ''; autoGrow(); S.attach = []; drawChips(); }
  if (S.chat.fresh && !S.chat.title) { S.chat.title = (text || (attach[0] && attach[0].name) || 'New chat').slice(0, 48); }
  delete S.chat.fresh; await persistChat(); loadChats();
  S.abort = new AbortController(); setRunning(true);
  const ui = {
    onUser: (m) => renderMsg(m), onAssistant: (m) => renderMsg(m), onDelta: (m) => renderMsg(m),
    onTool: (m) => { renderMsg(m); if (m.status === 'applied' || m.status === 'rejected') updateChangesChip(); },
    onNotice: (t) => toast(t), onMemory: (n) => toast('Remembered: ' + n[0]),
    requestApproval: (tm, signal) => new Promise((resolve) => {
      S.approvals.set(tm.id, resolve); updateApproveBar();
      signal.addEventListener('abort', () => decide(tm.id, 'reject'), { once: true });
    }),
  };
  try {
    await A.runTurn({ chat: S.chat, text: fullText, images, attachNames: attach.map((a) => a.name), folder: S.folder, modelId: currentModelId(), think: S.think, signal: S.abort.signal, ui, regenerate: !!regenerate });
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
  $('#thinkLbl').textContent = 'Thinking: ' + S.think[0].toUpperCase() + S.think.slice(1);
  $$('#thinkMenu .it').forEach((b) => b.classList.toggle('on', b.dataset.think === S.think));
}

// ------------------------------------------------------------ drawer
function openDrawer() { $('#drawer').classList.add('open'); $('#scrim').classList.remove('hidden'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.add('hidden'); }

// ------------------------------------------------------------ sheets
function sheet(title, opts = {}) {
  S.sheetStack.push(title);
  $('#sheetTitle').textContent = title; $('#sheet').classList.remove('hidden');
  $('#sheetBack').classList.toggle('hidden', !opts.back); $('#sheetBack').onclick = opts.back || null;
  const tabs = $('#sheetTabs'); tabs.classList.add('hidden'); tabs.innerHTML = '';
  const body = $('#sheetBody'); body.innerHTML = ''; body.scrollTop = 0; return body;
}
function closeSheet() { $('#sheet').classList.add('hidden'); S.sheetStack = []; }

async function openProjects() {
  const body = sheet('Projects');
  const draw = () => {
    body.innerHTML = '<button id="pOpen" class="btn primary" style="width:100%;margin-bottom:8px">' + ICON('folder') + '<span class="lbl">Open a folder...</span></button>' +
      '<button id="pNone" class="btn" style="width:100%;margin-bottom:8px">' + ICON('plus') + '<span class="lbl">Chat without a folder</span></button>' +
      '<div class="safe">' + ICON('lock') + '<span>I can only touch the folder you pick. A backup is saved before every change.</span></div>' +
      (S.folders.length ? '<div class="h3">Your folders</div>' : '') +
      S.folders.map((f) => '<div class="row-item" data-f="' + f.id + '">' + ICON('folder') + '<div class="grow"><div class="t">' + esc(f.name) + '</div><div class="s">Tap to start a chat here</div></div><button class="icon-btn" data-rmf="' + f.id + '" aria-label="Remove">' + ICON('trash') + '</button></div>').join('') +
      '<div class="note" style="margin-top:12px">Android does not allow picking the whole storage or the Download folder. Choose a subfolder, for example one you create for a project.</div>';
    $('#pOpen').onclick = async () => {
      try {
        const r = await fs.pickFolder(); if (!r || !r.uri) return;
        let f = S.folders.find((x) => x.uri === r.uri);
        if (!f) { f = { id: uid(), name: r.name || 'Folder', uri: r.uri }; S.folders.push(f); await A.saveFolders(S.folders); }
        closeSheet(); await newChat(f); await persistChat(); loadChats();
      } catch (e) { if (!/cancel/i.test(e.message || '')) toast(e.message || 'Could not open the folder'); }
    };
    $('#pNone').onclick = () => { closeSheet(); newChat(null); };
    $$('[data-f]', body).forEach((r) => r.onclick = async (e) => {
      if (e.target.closest('[data-rmf]')) return;
      const f = S.folders.find((x) => x.id === r.dataset.f); closeSheet(); await newChat(f); await persistChat(); loadChats();
    });
    $$('[data-rmf]', body).forEach((b) => b.onclick = async () => {
      const f = S.folders.find((x) => x.id === b.dataset.rmf);
      if (!await confirmBox('Remove folder?', 'This only removes "' + f.name + '" from the list and releases access. Your files are not deleted.', 'Remove')) return;
      try { await fs.releaseFolder(f.uri); } catch (e) { /* ignore */ }
      S.folders = S.folders.filter((x) => x.id !== f.id); await A.saveFolders(S.folders); draw();
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
      try { const t = await fs.readText(S.folder.uri, p, 200000); b2.innerHTML = t.binary ? '<div class="note">Binary file, ' + fmtBytes(t.size) + '</div>' : '<pre class="out" style="white-space:pre-wrap;word-break:break-word;font-size:12px">' + esc(t.text) + '</pre>'; }
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
  try { await A.undoChange(id, S.folder); toast('Undone'); } catch (e) { toast(e.message || 'Could not undo'); }
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
    '<button id="addProv" class="btn" style="width:100%">' + ICON('plus') + '<span class="lbl">Add provider</span></button>' +
    '<div class="h3">Chat</div>' +
    '<label class="field"><span>Default model</span><select id="setModel">' + S.models.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === st.defaultModel ? ' selected' : '') + '>' + esc(modelLabel(m)) + '</option>').join('') + '</select></label>' +
    '<div class="field"><span>Token saving</span>' + seg('setMode', [['economy', 'Economy'], ['balanced', 'Balanced'], ['full', 'Full']], st.mode) + '<small>Older messages are summarised to cut cost. Economy keeps the least context.</small></div>' +
    '<div class="field"><span>Default thinking</span>' + seg('setThink', [['off', 'Off'], ['low', 'Low'], ['high', 'High']], st.defaultThink) + '</div>' +
    '<label class="field"><span>Max steps per message</span><input id="setSteps" type="number" min="1" max="60" value="' + st.maxSteps + '"><small>Stops runaway tool loops.</small></label>' +
    '<label class="field"><span>Custom instructions</span><textarea id="setInstr" placeholder="Tone, language, rules...">' + esc(st.instructions) + '</textarea></label>' +
    '<div class="h3">Files</div>' +
    '<div class="field"><span>Apply changes</span>' + seg('setAuto', [['0', 'Ask me first'], ['1', 'Apply automatically']], st.autoApply ? '1' : '0') + '<small>Backups and Undo work in both modes.</small></div>' +
    '<div class="h3">Appearance</div>' + '<div class="field">' + seg('setTheme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], st.theme) + '</div>' +
    '<div class="h3">Memory</div><div class="field">' + seg('setLearn', [['1', 'Learn about me'], ['0', 'Off']], st.autoLearn ? '1' : '0') + '<small>Short notes saved on this phone and shared with the model so it knows you.</small></div><div id="memList"></div>' +
    '<button id="memAdd" class="btn" style="width:100%">' + ICON('plus') + '<span class="lbl">Add a note</span></button>' +
    '<div class="h3">Data</div>' +
    '<button id="usageBtn" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Usage and cost</span></button>' +
    '<button id="expBtn" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Export this chat as text</span></button>' +
    '<div class="h3">About</div><div class="kv"><span>Version</span><span>1.0.0</span></div><div class="kv"><span>Storage</span><span>On this phone only</span></div>';
  const bindSeg = (id, fn) => $$('#' + id + ' .btn', body).forEach((b) => b.onclick = () => { $$('#' + id + ' .btn', body).forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); });
  bindSeg('setMode', (v) => save({ mode: v })); bindSeg('setThink', (v) => save({ defaultThink: v }));
  bindSeg('setAuto', (v) => save({ autoApply: v === '1' })); bindSeg('setLearn', (v) => save({ autoLearn: v === '1' }));
  bindSeg('setTheme', (v) => { save({ theme: v }); applyTheme(); });
  $('#setModel').onchange = (e) => save({ defaultModel: e.target.value });
  $('#setSteps').onchange = (e) => save({ maxSteps: Math.max(1, Math.min(60, Number(e.target.value) || 20)) });
  $('#setInstr').onchange = (e) => save({ instructions: e.target.value });
  $('#addProv').onclick = () => showSetup(false);
  $$('[data-key]', body).forEach((b) => b.onclick = async () => {
    const v = prompt('New API key'); if (v && v.trim()) { await secure.set(A.keyName(b.dataset.key), v.trim()); toast('Key updated'); }
  });
  $$('[data-rp]', body).forEach((b) => b.onclick = async () => {
    if (S.providers.length === 1) { toast('Add another provider before removing the last one.'); return; }
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
  mem();
  $('#memAdd').onclick = async () => { const v = prompt('Note (one short fact)'); if (v && await A.addMemoryNote(v, 'manual')) mem(); };
  $('#usageBtn').onclick = openUsage; $('#expBtn').onclick = exportChat;
}
async function save(p) { S.settings = await A.saveSettings(p); }

async function openUsage() {
  const body = sheet('Usage and cost', { back: openSettings });
  const rows = await db.all('usage'); const days = new Map();
  rows.forEach((r) => { const d = days.get(r.day) || { tin: 0, tout: 0, cost: 0, priced: false }; d.tin += r.tin; d.tout += r.tout; if (r.cost != null) { d.cost += r.cost; d.priced = true; } days.set(r.day, d); });
  const list = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30);
  const tot = list.reduce((a, [, d]) => ({ tin: a.tin + d.tin, tout: a.tout + d.tout, cost: a.cost + d.cost }), { tin: 0, tout: 0, cost: 0 });
  const today = days.get(dayKey()) || { tin: 0, tout: 0, cost: 0 };
  body.innerHTML = '<div class="kv"><span>Today</span><span>' + fmtTok(today.tin + today.tout) + ' tokens · ' + fmtUsd(today.cost) + '</span></div>' +
    '<div class="kv"><span>Last 30 days</span><span>' + fmtTok(tot.tin + tot.tout) + ' tokens · ' + fmtUsd(tot.cost) + '</span></div><div class="h3">By day</div>' +
    (list.map(([d, v]) => '<div class="kv"><span>' + d + '</span><span>' + fmtTok(v.tin) + ' in · ' + fmtTok(v.tout) + ' out' + (v.priced ? ' · ' + fmtUsd(v.cost) : '') + '</span></div>').join('') || '<div class="note">No usage yet.</div>') +
    '<div class="note" style="margin-top:12px">Cost is an estimate in USD and is shown only for models with known prices. Tokens are always counted from the provider\'s reply.</div>';
}
async function exportChat() {
  const msgs = (await db.byIndex('messages', 'chatId', S.chat.id)).sort((a, b) => a.id - b.id);
  const t = msgs.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => (m.role === 'user' ? 'You' : 'KDex') + ':\n' + (m.text || '')).join('\n\n');
  try { await navigator.clipboard.writeText(t); toast('Chat copied to clipboard'); } catch (e) { toast('Could not copy'); }
}

// ------------------------------------------------------------ wiring
function wire() {
  $('#menuBtn').onclick = openDrawer; $('#scrim').onclick = closeDrawer;
  $('#dNew').onclick = () => newChat(S.folder); $('#topNewBtn').onclick = () => newChat(S.folder);
  $('#dProjects').onclick = () => { closeDrawer(); openProjects(); }; $('#topFolderBtn').onclick = openProjects; $('#chipFolder').onclick = openProjects;
  $('#dSettings').onclick = () => { closeDrawer(); openSettings(); };
  $('#chipFiles').onclick = () => openFiles(''); $('#chipChanges').onclick = openChanges;
  $('#sheetClose').onclick = closeSheet;
  $('#chatSearch').oninput = drawChatList;
  $('#chatList').onclick = async (e) => {
    const d = e.target.closest('[data-del]');
    if (d) {
      if (!await confirmBox('Delete chat?', 'This chat and its backups are removed from the phone.', 'Delete')) return;
      await A.removeChat(d.dataset.del); await loadChats(); if (S.chat && S.chat.id === d.dataset.del) await newChat(S.folder); return;
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
  $('#approveAll').onclick = () => [...S.approvals.keys()].forEach((id) => decide(id, 'apply'));
  $('#messages').addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { const code = c.closest('.codeblock').querySelector('code').textContent; try { await navigator.clipboard.writeText(code); c.firstElementChild.textContent = 'Copied'; setTimeout(() => c.firstElementChild.textContent = 'Copy', 1200); } catch (x) { /* ignore */ } return; }
    const t = e.target.closest('[data-tool]');
    if (t) {
      if (t.dataset.tool === 'undo') { await undoOne(Number(t.dataset.b)); return; }
      decide(t.dataset.id, t.dataset.tool === 'apply' ? 'apply' : 'reject'); return;
    }
    const a = e.target.closest('[data-act]');
    if (a) {
      if (a.dataset.act === 'regen') regenerate();
      else { const el = a.closest('.msg'); const m = await db.get('messages', Number(el.dataset.id)); try { await navigator.clipboard.writeText(m.text || ''); toast('Copied'); } catch (x) { /* ignore */ } }
    }
  });
  $('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(false); } });
  if (App && App.addListener) App.addListener('backButton', () => {
    if (!$('#dialog').classList.contains('hidden')) { $('#dlgNo').click(); return; }
    if (!$('#setup').classList.contains('hidden') && S.models.length) { $('#setup').classList.add('hidden'); return; }
    if (!$('#sheet').classList.contains('hidden')) { const b = $('#sheetBack'); if (!b.classList.contains('hidden')) b.click(); else closeSheet(); return; }
    if ($('#drawer').classList.contains('open')) { closeDrawer(); return; }
    if (S.running) { stopRun(); return; }
    App.exitApp();
  });
}

boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', '<pre style="padding:20px;color:#d64545;white-space:pre-wrap">Startup error: ' + esc(e.message) + '</pre>'); });
