// KDex Agent (Android) - UI layer. All data stays on this phone.
import { $, $$, esc, uid, fmtBytes, fmtTok, ago, dayKey, dayKeyAgo, copyText } from './util.js';
import { db, kvGet, kvSet } from './db.js';
import { secure, fs, App, Termux, AllFiles, Work, Launch, setBars, isNative } from './native.js';
import * as D from './diag.js';
import { highlight, langOf } from './highlight.js';
import { diffHtml } from './diffview.js';
import { BINARY_EXT, isGitInternal } from './tools.js';
import { PRESETS, QUICK_FILL, listModels, popularModels, likelySeesImages } from './providers.js';
import { getTermuxPath, setTermuxPath, hasCustomTermuxPath, runTermux, isRiskyCommand } from './termux.js';
import * as CI from './ci.js';
import { renderMarkdown } from './md.js';
import * as A from './agent.js';
import * as G from './git.js';
import { isSecretPath, isEnvLike, maskEnv, protectionOn, scrub, redactPatterns } from './secrets.js';
import { SUPPORT_EMAIL, APP_VERSION } from './config.js';
import { checkUpdate, isNewer, REPO_URL } from './update.js';
import { officeText, isOffice, isPdf, pdfText, PDF_MAX_BYTES } from './docs.js';
import { prepareImage } from './image.js';
import { isHtmlName, bundleFromFolder, bundleText } from './preview.js';
import { testServer, saveSecret, dropSecret, getSecret, remoteFolderOf, rememberServer, closeServer, remoteRead, remoteWrite, BIG_FILE } from './remote.js';
import { scratchFolder, scratchFiles, scratchCount, scratchClear, scratchUsage, SCRATCH_CAP } from './scratch.js';
import { toolLabel, opLabel } from './toollabels.js';

const S = {
  settings: null, providers: [], models: [], folders: [], chats: [],
  chat: null, folder: null, think: 'off', running: false, abort: null, runChat: null,
  approvals: new Map(), approvalTm: new Map(), els: new Map(), attach: [], sheetStack: [], queue: [],
};
const ICON = (n) => '<svg class="ic"><use href="#i-' + n + '"/></svg>';
/** The folder the file tools work on right now: the project, or this chat's Scratch desk. */
const curF = () => S.folder || (S.chat ? scratchFolder(S.chat.id) : null);
const folderFor = (id) => (String(id || '').startsWith('scratch-') ? scratchFolder(String(id).slice(8)) : (S.folders.find((x) => x.id === id) || S.folder));
const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

// ------------------------------------------------------------ helpers
let toastT; let toastH;
/** Picks the look of a notification from its wording: ok, warn, err or info. */
function toastKind(t) {
  if (/^(nothing|open a folder|pick or type|add your git|clone does not)/i.test(t)) return 'warn';
  if (/could not|couldn't|can't|cannot|failed|went wrong|rejected|denied|not a kdex|no backup|not found|no connection|error/i.test(t)) return 'err';
  if (/^(saved|saving|copied|done|cloned|undone|restored|reported|remembered|token saved|key updated|provider saved|git removed|git identity saved|repository created|all conversations deleted|committed|pushed|pulled|fetched)/i.test(t)) return 'ok';
  return 'info';
}
/** Notification levels. Quiet (the default) shows only errors, warnings and results of long tasks (opts.result). Everything else (confirmations of things the screen already shows) appears only in All. */
const shows = (kind, opts) => !(!S.settings || S.settings.quietToasts !== false) || kind === 'err' || kind === 'warn' || !!opts.result || !!opts.action;
/** One quiet status line above the message box: offline, waiting, provider busy. Replaces popups for these. */
let netTimer;
function netLine(text) {
  const el = $('#netLine'); if (!el) return;
  clearTimeout(netTimer);
  if (!text) { if (!el.classList.contains('hidden')) { el.classList.add('hidden'); el.innerHTML = ''; } return; }
  el.innerHTML = '<span class="spin"></span><span>' + esc(text) + '</span>'; el.classList.remove('hidden');
  if (/^Offline/.test(text)) netTimer = setTimeout(() => netLine('Still waiting. Tap Stop to cancel.'), 5 * 60 * 1000);
}
/** Shows "Copied" on the button itself for a moment, instead of a popup. */
function flashCopied(el, ok) {
  if (!ok || !el) { toast('Could not copy'); return; }
  const lbl = el.querySelector && el.querySelector('.lbl');
  if (lbl) { const o = lbl.textContent; lbl.textContent = 'Copied'; setTimeout(() => { lbl.textContent = o; }, 1400); return; }
  const u = el.querySelector && el.querySelector('use');
  if (u) { const o = u.getAttribute('href'); u.setAttribute('href', '#i-check'); setTimeout(() => u.setAttribute('href', o), 1400); }
}
const TOAST_ICON = { ok: 'check', err: 'alert', warn: 'alert', info: 'info' };
/** Shortens one very long word (a URL, a path) in the middle, so both its start and its end stay visible. */
const midCut = (t) => String(t).replace(/\S{38,}/g, (w) => w.slice(0, 20) + '\u2026' + w.slice(-14));
/** Swipe a notification left, right or up to dismiss it. */
function swipeable(el) {
  if (el._sw) return; el._sw = true;
  let x0 = 0; let y0 = 0; let dx = 0; let dy = 0; let on = false; let id = null;
  const base = 'translate(-50%,0)';
  el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; on = true; id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; el.style.transition = 'none'; try { el.setPointerCapture(id); } catch (x) { /* ignore */ } });
  el.addEventListener('pointermove', (e) => {
    if (!on) return; dx = e.clientX - x0; dy = Math.min(0, e.clientY - y0);
    if (Math.abs(dx) > 6 || dy < -6) el._moved = true;
    el.style.transform = 'translate(calc(-50% + ' + dx + 'px),' + dy + 'px)';
    el.style.opacity = String(Math.max(0.15, 1 - Math.max(Math.abs(dx) / 260, -dy / 120)));
  });
  const end = () => {
    if (!on) return; on = false; try { el.releasePointerCapture(id); } catch (x) { /* ignore */ }
    el.style.transition = '';
    if (Math.abs(dx) > 70 || dy < -40) {
      const out = dx > 70 ? 'calc(-50% + 140%)' : dx < -70 ? 'calc(-50% - 140%)' : '-50%';
      el.style.transform = 'translate(' + out + ',' + (dy < -40 ? '-80px' : '0') + ')'; el.style.opacity = '0';
      clearTimeout(toastT); toastH = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('show'); el.style.transform = el.style.opacity = ''; }, 200);
    } else { el.style.transform = el.style.opacity = ''; if (!el.classList.contains('show')) el.style.transform = base; }
    setTimeout(() => { el._moved = false; }, 0);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
// While a notification is on screen the first touch anywhere only dismisses it (nothing else is triggered); the next touch works normally.
let tapEat = 0;
document.addEventListener('pointerdown', (e) => {
  const el = $('#toast'); if (!el || el.classList.contains('hidden') || !el.classList.contains('show') || el.contains(e.target)) return;
  if (el._dismiss) el._dismiss(); tapEat = Date.now() + 700; e.stopPropagation();
}, true);
document.addEventListener('click', (e) => { if (tapEat && Date.now() < tapEat) { tapEat = 0; e.stopPropagation(); e.preventDefault(); } }, true);
/** Notification: a short pill for one line, a card when there is a detail. Tap a card to see the full text and copy it. `opts.action = { label, fn }` adds a button. */
function toast(t, opts = {}) {
  const el = $('#toast'); const text = String(t == null ? '' : t).trim(); if (!text) return;
  const kind = opts.kind || toastKind(text);
  if (!shows(kind, opts)) return;
  let title = text; let detail = '';
  const cut = /^(.{3,60}?)(?: \u00b7 |: )(.+)$/.exec(text);
  if (cut) { title = cut[1]; detail = cut[2]; } else if (text.length > 70) { const m = /^(.{20,70}?[.!?])\s+(.+)$/.exec(text); if (m) { title = m[1]; detail = m[2]; } }
  const card = !!detail || !!opts.action;
  let open = false;
  const draw = () => {
    el.className = 'toast ' + kind + (card ? ' card' : ' pill') + (open ? ' open show' : ' show');
    el.innerHTML = '<span class="tic">' + ICON(TOAST_ICON[kind]) + '</span><span class="ttx"><span class="tt1">' + esc(open ? title : midCut(title)) + '</span>' + (detail ? '<span class="tt2">' + esc(open ? detail : midCut(detail)) + '</span>' : '') + '</span>' +
      (opts.action ? '<button type="button" class="tact" data-a="1">' + esc(opts.action.label) + '</button>' : ''); 
  };
  draw(); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  const hide = () => { el.classList.remove('show'); toastH = setTimeout(() => el.classList.add('hidden'), 220); };
  const arm = (ms) => { clearTimeout(toastT); toastT = setTimeout(hide, ms); };
  clearTimeout(toastH);
  el._dismiss = hide;
  swipeable(el);
  el.onclick = async (e) => {
    if (el._moved) { el._moved = false; return; }
    if (e.target.closest('[data-a]')) { try { opts.action.fn(); } catch (x) { /* ignore */ } hide(); return; }
    if (card && !open) { open = true; draw(); el.classList.add('show'); arm(9000); return; }
    hide();
  };
  arm(kind === 'err' || card ? 4200 : 2400);
  if (kind === 'err') D.log('error', text);
}
window.__toast = toast;
window.__errLine = errLine;
window.__errTest = (t) => { const d = explainGitError(t); return d; };
function confirmBox(title, text, yes = 'OK') {
  return new Promise((res) => {
    $('#dlgTitle').textContent = title; $('#dlgText').textContent = text; $('#dlgYes').firstElementChild.textContent = yes;
    $('#dialog').classList.remove('hidden');
    const done = (v) => { $('#dialog').classList.add('hidden'); $('#dlgYes').onclick = $('#dlgNo').onclick = null; res(v); };
    $('#dlgYes').onclick = () => done(true); $('#dlgNo').onclick = () => done(false);
  });
}
/** Dialog with two actions plus Cancel. Resolves 0 (first), 1 (second) or -1 (cancel). */
function choiceBox(title, text, labels, opts) {
  const noCancel = !!(opts && opts.noCancel); const stack = !!(opts && opts.stack);
  return new Promise((res) => {
    $('#dlgYes').parentElement.classList.toggle('stack', stack);
    $('#dlgTitle').textContent = title; $('#dlgText').textContent = text;
    $('#dlgYes').firstElementChild.textContent = labels[0]; $('#dlgAlt').firstElementChild.textContent = labels[1] || ''; $('#dlgAlt').classList.toggle('hidden', labels.length < 2);
    if (noCancel) $('#dlgNo').classList.add('hidden');
    $('#dialog').classList.remove('hidden');
    const done = (v) => { $('#dialog').classList.add('hidden'); $('#dlgYes').parentElement.classList.remove('stack'); $('#dlgAlt').classList.add('hidden'); $('#dlgNo').classList.remove('hidden'); $('#dialog').onclick = null; $('#dlgYes').onclick = $('#dlgNo').onclick = $('#dlgAlt').onclick = null; res(v); };
    $('#dlgYes').onclick = () => done(0); $('#dlgAlt').onclick = () => done(1); $('#dlgNo').onclick = () => done(-1);
    if (noCancel) $('#dialog').onclick = (e) => { if (e.target === $('#dialog')) done(-1); };
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
  window.__stage = 'boot'; D.install(); fitViewport();
  S.settings = await A.getSettings(); applyTheme(); CI.onBuild((w) => drawCi(w));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.__stage = 'settings-ok';
  S.providers = await A.getProviders(); S.models = await A.getModels(); S.folders = await A.getFolders(); S.folders.forEach(rememberServer);
  window.__stage = 'wiring'; wire();
  if (!S.models.length && !(await kvGet('setupSkipped', false))) { showSetup(true); document.documentElement.classList.add('ready'); window.__stage = 'ready'; return; }
  await enter(); document.documentElement.classList.add('ready'); window.__stage = 'ready';
  autoUpdateCheck().catch(() => {});
  Launch.onLaunch(() => Launch.take().then(handleLaunch)); Launch.take().then(handleLaunch);
}
/** Opens Android's permission screen; when the user comes back it checks the result. */
async function askAllFiles(done) {
  let r = null;
  try { r = await AllFiles.request(); } catch (e) { toast('Could not open the settings screen'); if (done) done(); return; }
  const check = async () => {
    const st = await AllFiles.status(); G.resetGitCache();
    toast(st.granted ? 'Fast file access is on' : 'Fast file access is still off');
    if (done) done();
  };
  // Android 8 to 10 answer with a small box; the answer is already in when the request returns (unless the settings page had to open)
  if (r && r.legacy && !r.settings) { await check(); return; }
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
  const r = await choiceBox('Fast file access', st.legacy ? 'Allow storage access so files and Git run at full speed, like Termux. Android asks once: tap Allow.' : 'Allow "All files access" so files and Git run at full speed, like Termux. Android opens a settings screen: turn on the switch for KDex Agent, then come back.', ['Allow', 'Not now'], { noCancel: true });
  if (r === 0) await new Promise((res) => askAllFiles(res));
}
async function enter() {
  $('#setup').classList.add('hidden');
  fillModels();
  await loadChats();
  const last = await kvLast();
  const pending = await kvGet('draft:new', ''); // an unsent message in a new chat: open that new chat so it is there
  if (!pending && last && S.chats.find((c) => c.id === last)) await openChat(last); else await newChat();
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
    const same = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
    for (const q of S.providers) {
      if (same(q.baseUrl) === same(baseUrl) && await secure.get(A.keyName(q.id)) === key) { msg.innerHTML = '<div class="err">This provider is already added (' + esc(q.name) + '). Add more models from its card in Settings.</div>'; return; }
    }
    let uniq = name; for (let n = 2; S.providers.some((q) => q.name === uniq); n++) uniq = name + ' (' + n + ')';
    const prov = { id: uid(), name: uniq, type: preset.type, baseUrl };
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
  const row = (c) => {
    const f = S.folders.find((x) => x.id === c.folderId);
    return '<div class="chat-item' + (S.chat && S.chat.id === c.id ? ' on' : '') + '" data-id="' + c.id + '"><div class="t">' + esc(c.title || 'New chat') +
      '<span class="s">' + (f ? esc(f.name) + ' \u00b7 ' : '') + ago(c.updated) + '</span></div>' + (c.pinned ? '<svg class="ic pinmark"><use href="#i-pin"/></svg>' : '') +
      '<button class="icon-btn" data-menu="' + c.id + '" aria-label="Chat menu">' + ICON('dots') + '</button></div>';
  };
  const pinned = list.filter((c) => c.pinned), rest = list.filter((c) => !c.pinned);
  $('#chatList').innerHTML = list.length
    ? (pinned.length ? '<div class="chat-head">Pinned</div>' + pinned.map(row).join('') + (rest.length ? '<div class="chat-head">Recent</div>' : '') : '') + rest.map(row).join('')
    : '<div class="note">' + (q ? 'No chats match' : 'No chats yet') + '</div>';
}
let lpBlockUntil = 0; let lpOpenAt = 0; // while the opening finger is down the guard is open-ended; it ends 300 ms after the finger lifts
document.addEventListener('pointerup', () => { if (lpBlockUntil === Infinity) lpBlockUntil = Date.now() + 300; }, true);
document.addEventListener('touchend', () => { if (lpBlockUntil === Infinity) lpBlockUntil = Date.now() + 300; }, true);
/** Press and hold a chat row to open the same menu as the three dots. Works with the system long-press (contextmenu), so Android cannot steal it. */
function chatLongPress() {
  const list = $('#chatList'); let t = null, row = null, x0 = 0, y0 = 0;
  const cancel = () => { clearTimeout(t); t = null; if (row) { row.classList.remove('pressing'); row = null; } };
  const open = (r, pt) => {
    if ($('#rowMenu')) return; lpBlockUntil = Infinity; lpOpenAt = Date.now();
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* not supported */ }
    openRowMenu(r, r.dataset.id, pt);
  };
  list.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('[data-menu]')) return;
    const it = e.target.closest('.chat-item[data-id]'); if (!it) return;
    cancel(); row = it; x0 = e.clientX; y0 = e.clientY; it.classList.add('pressing');
    t = setTimeout(() => { const r = row; if (!r) return; const pt = { x: x0, y: y0 }; cancel(); open(r, pt); }, 400);
  });
  // Only real finger movement or a scroll cancels. A system pointercancel does not: Android sends it right when its own long press begins.
  list.addEventListener('pointermove', (e) => { if (t && (Math.abs(e.clientX - x0) > 12 || Math.abs(e.clientY - y0) > 12)) cancel(); });
  list.addEventListener('pointerup', cancel, true); list.addEventListener('scroll', cancel, true);
  list.addEventListener('touchmove', (e) => { const f = e.touches[0]; if (t && f && (Math.abs(f.clientX - x0) > 12 || Math.abs(f.clientY - y0) > 12)) cancel(); }, { passive: true });
  list.addEventListener('contextmenu', (e) => {
    const it = e.target.closest('.chat-item[data-id]'); if (!it) return;
    e.preventDefault(); const pt = { x: e.clientX || x0, y: e.clientY || y0 }; cancel(); open(it, pt);
  });
}
/** Text size of command output (the A- and A+ buttons); kept between visits. */
function outFs() { let v = 11; try { v = Number(localStorage.getItem('kdex.outfs')) || 11; } catch (e) { /* storage blocked */ } return Math.max(8, Math.min(16, v)); }
function setOutFs(n) { n = Math.max(8, Math.min(16, n)); document.documentElement.style.setProperty('--outfs', n + 'px'); document.querySelectorAll('.fnum').forEach((b) => { b.textContent = n; b.classList.toggle('chg', n !== 11); }); try { localStorage.setItem('kdex.outfs', String(n)); } catch (e) { /* storage blocked */ } }
setOutFs(outFs());
function closeRowMenu() {
  const m = $('#rowMenu'); if (m) m.remove(); const c = $('#rowScrim'); if (c) c.remove();
  document.querySelectorAll('.menu-on').forEach((x) => x.classList.remove('menu-on'));
  document.querySelectorAll('.dimming').forEach((x) => x.classList.remove('dimming'));
}
/** Dims the other rows while a menu is open; the pressed row stays distinct. */
function markMenuRow(row, list) { if (!row || !list) return; row.classList.add('menu-on'); list.classList.add('dimming'); }
/** Small menu next to a chat row: Pin, Rename, Delete. */
function openRowMenu(btn, id, pt) {
  closeRowMenu(); if (!pt) lpBlockUntil = 0;
  const c = S.chats.find((x) => x.id === id); if (!c) return;
  // A transparent layer under the menu: the first tap outside only closes the menu and does nothing else.
  const sc = document.createElement('div'); sc.id = 'rowScrim'; sc.className = 'rowscrim';
  // Close on click (not pointerdown): the scrim must still be under the finger when the
  // synthesized click arrives, otherwise that click lands on the chat row underneath.
  // A tap has its own pointerdown on this layer; a click without one is the leftover of the finger that opened the menu.
  const away = (e) => { e.preventDefault(); e.stopPropagation(); if (!sc._down && Date.now() < lpBlockUntil) return; closeRowMenu(); };
  // Close the moment the finger touches (Android can swallow the first click after a long press). The layer stays a moment so that tap cannot reach the chat under it.
  sc.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (Date.now() - lpOpenAt < 150 && lpBlockUntil !== 0) return; sc._down = true; const mm = $('#rowMenu'); if (mm) mm.remove(); setTimeout(closeRowMenu, 450); });
  sc.addEventListener('click', away); sc.addEventListener('contextmenu', (e) => { if (Date.now() < lpBlockUntil) { e.preventDefault(); return; } away(e); });
  document.body.appendChild(sc);
  const m = document.createElement('div'); m.id = 'rowMenu'; m.className = 'rowmenu';
  m.innerHTML = '<button data-a="pin">' + ICON('pin') + '<span>' + (c.pinned ? 'Unpin' : 'Pin') + '</span></button><button data-a="rename">' + ICON('edit') + '<span>Rename</span></button><button data-a="del" class="danger">' + ICON('trash') + '<span>Delete</span></button>';
  document.body.appendChild(m);
  markMenuRow(btn.closest('.chat-item'), $('#chatList'));
  // Below the row, or above it when there is no room, like the file menu: the pressed row is never covered.
  // A long press and the three dots give the same place.
  const rowEl = btn.closest('.chat-item') || btn; const r = rowEl.getBoundingClientRect(); const mh = m.offsetHeight, mw = m.offsetWidth;
  m.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(window.innerHeight - mh - 8, r.bottom + 4 + mh > window.innerHeight - 8 ? r.top - mh - 4 : r.bottom + 4)) + 'px';
  m.onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; closeRowMenu();
    const row = await db.get('chats', id); if (!row) return;
    if (b.dataset.a === 'pin') { row.pinned = !row.pinned; await db.put('chats', row); if (S.chat && S.chat.id === id) S.chat.pinned = row.pinned; await loadChats(); toast(row.pinned ? 'Pinned' : 'Unpinned'); }
    else if (b.dataset.a === 'rename') {
      const v = await askText('Rename chat', 'Chat name', row.title || 'New chat', true);
      if (!v) return;
      row.title = v.slice(0, 80); await db.put('chats', row); if (S.chat && S.chat.id === id) S.chat.title = row.title; await loadChats();
    } else {
      const busyHere = S.running && S.runChat && S.runChat.id === id;
      if (!await confirmBox('Delete chat?', 'This chat and its backups are removed from the phone.' + (busyHere ? ' Its running task stops too.' : ''), 'Delete')) return;
      if (S.running && S.runChat && S.runChat.id === id) { stopRun(); await waitIdle(); }
      await A.removeChat(id); await loadChats(); if (S.chat && S.chat.id === id) await newChat(null);
      await db.del('kv', 'draft:' + id).catch(() => {});
    }
  };
}
async function newChat(folder) {
  await flushDraft(); $('#input').value = ''; autoGrow();
  S.chat = { id: uid(), title: '', model: currentModelId(), think: S.settings.defaultThink || 'off', auto: !!S.settings.autoDefault && !(folder && folder.remote), folderId: folder ? folder.id : null, updated: Date.now() };
  S.folder = folder || null; S.think = S.chat.think; S.chat.fresh = true;
  S.els.clear(); if (!S.running) S.approvals.clear();
  fillModels(S.chat.model); drawCtx(); drawThink(); drawPlan(); $('#messages').innerHTML = ''; renderEmpty(); setRunning(S.running); updateApproveBar(); closeDrawer(); drawRing();
  await loadDraft();
}
/** Content shared from another app, or a notification tap: open the right chat and drop the shared text/files into the composer. */
async function handleLaunch(l) {
  if (!l || !$('#setup').classList.contains('hidden')) return;
  if (l.chat && (!S.chat || S.chat.id !== l.chat) && S.chats.find((c) => c.id === l.chat)) await openChat(l.chat);
  const sh = l.share; if (!sh) return;
  const used = (await db.byIndex('messages', 'chatId', S.chat.id)).length > 0;
  if (used) { const r = await choiceBox('Shared to KDex Agent', 'Add it to this chat, or start a new one?', ['New chat', 'This chat'], { noCancel: true }); if (r === -1) return; if (r === 0) await newChat(S.folder); }
  const txt = [sh.subject, sh.text].filter(Boolean).join('\n\n');
  const input = $('#input'); if (txt) { input.value = (input.value ? input.value + '\n\n' : '') + txt; autoGrow(); }
  const bad = [];
  for (const f of sh.files || []) { if (f.status === 'ok' && typeof f.text === 'string') S.attach.push({ name: f.name, text: f.text }); else bad.push(f.name); }
  if (bad.length) toast(bad.length === 1 ? bad[0] + " can't be read (too large or not text)." : bad.length + " files can't be read (too large or not text).");
  drawChips(); input.focus();
}
window.__kdexLaunch = handleLaunch;
async function openChat(id) {
  if (!(S.chat && S.chat.id === id)) { await flushDraft(); $('#input').value = ''; autoGrow(); }
  const live = S.running && S.runChat && S.runChat.id === id; // the task of this chat is still running: use its live chat object
  const c = live ? S.runChat : await db.get('chats', id); if (!c) return newChat();
  S.chat = c; S.folder = S.folders.find((f) => f.id === c.folderId) || null; S.think = c.think || 'off'; touchFolder(S.folder);
  await db.put('kv', { key: 'lastChat', value: id });
  fillModels(c.model); drawCtx(); drawThink(); drawPlan();
  S.els.clear(); if (!S.running) S.approvals.clear();
  if (!live) await A.repairHistory(id);
  const msgs = (await db.byIndex('messages', 'chatId', id)).sort((a, b) => a.id - b.id);
  const box = $('#messages'); box.innerHTML = '';
  if (!msgs.length) renderEmpty();
  msgs.forEach((m) => renderMsg(m));
  trimCont(); scrollEnd(true); closeDrawer(); drawChatList(); setRunning(S.running); updateApproveBar(); drawRing();
  await loadDraft();
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
  const rm = !!(S.folder && S.folder.remote); // a server: no Git panel and no Termux terminal
  $$('#ctxBar .nf').forEach((b) => b.classList.toggle('hidden', !S.folder));
  if (rm) { $('#chipGit').classList.add('hidden'); $('#chipTerm').classList.add('hidden'); }
  const fu = $('#chipFolder use'); if (fu) fu.setAttribute('href', rm ? '#i-server' : '#i-folder');
  drawScratch();
  if (S.folder) { updateChangesChip(); if (!rm) updateGitChip(); }
  updateTermChip(); drawCi(CI.getBuild());
}
async function updateGitChip() {
  if (!S.folder) return;
  const b = await G.isRepo(S.folder).then((ok) => ok ? G.currentBranch(S.folder) : null).catch(() => null);
  $('#chipGitLbl').textContent = b || 'Git';
}
async function updateChangesChip() {
  drawScratch();
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
  el.style.display = m.auto || (m.role === 'assistant' && m.empty && !m.text && !m.thought) ? 'none' : '';
  if (m.role === 'user') {
    el.className = 'msg user';
    el.innerHTML = (m.images && m.images.length ? '<div class="thumbs">' + m.images.map((i) => '<img alt="" src="data:' + i.mime + ';base64,' + i.data + '">').join('') + '</div>' : m.imagesRemoved ? '<div class="gone">' + m.imagesRemoved + ' picture' + (m.imagesRemoved > 1 ? 's' : '') + ' removed</div>' : '') +
      (m.fileData && m.fileData.length ? '<div class="ufiles">' + m.fileData.map((f, i) => '<button type="button" class="ufile" data-ufile="' + m.id + ':' + i + '" aria-label="Save ' + esc(f.name) + '">' + ICON('file') + '<span class="nm">' + esc(f.name) + '</span><span class="sz">' + esc(fmtBytes(f.size)) + '</span></button>').join('') + '</div>' : (m.files && m.files.length ? '<div class="fnames">' + m.files.map(esc).join(', ') + '</div>' : '')) + (m.text ? '<div class="bubble">' + esc(m.text) + '</div>' : '') + (m.steered ? '<div class="steer">Sent while working</div>' : '');
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
    if (!live && m.cont) h += '<div class="controw"><button class="btn primary sm" type="button" data-act="cont"><span class="lbl">Continue</span></button></div>';
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
const TOOL_ICON = { git_status: 'branch', git_diff: 'branch', git_log: 'branch', git_commit: 'branch', git_push: 'up', git_pull: 'down', unzip: 'file', zip: 'file', run_command: 'terminal', request_env_var: 'lock', start_job: 'terminal', check_job: 'terminal', stop_job: 'terminal', list_jobs: 'terminal', update_plan: 'list', save_notes: 'list', make_file: 'file', list_dir: 'folder', find_files: 'search', search: 'search', find_symbol: 'search', read_file: 'file', write_file: 'edit', edit_file: 'edit', delete_file: 'trash', web_fetch: 'search', view_image: 'file', project_map: 'folder', project_checks: 'list', check_tools: 'terminal', github_runs: 'branch', github_run_log: 'branch', github_issues: 'branch', calculate: 'list', convert_units: 'list', remember: 'file', clipboard_read: 'file', clipboard_write: 'file', set_alarm: 'list', set_timer: 'list', generate_image: 'file', pre_push_check: 'list', bump_version: 'edit', release: 'up', release_info: 'list', review_changes: 'search', report_findings: 'list' };
function planCard(m) {
  const done = m.steps.filter((x) => x.status === 'done').length;
  return '<div class="tool plan"><div class="th">' + ICON('list') + '<span class="nm">Plan</span><span class="pa">' + done + ' of ' + m.steps.length + ' done</span></div><div class="steps">' +
    m.steps.map((x) => '<div class="stp ' + x.status + '"><span class="dot"></span><span class="tx">' + esc(x.text) + '</span></div>').join('') + '</div></div>';
}
/** Plain card for reading a web page: site and page, a short status, and the reason when it fails. */
function webCard(m) {
  const st = m.status || 'running';
  const label = { running: 'Reading', pending: 'Waiting', applied: 'Done', rejected: 'Skipped', error: "Couldn't read", cancelled: 'Stopped' }[st] || st;
  const cls = st === 'applied' ? 'applied' : st === 'error' || st === 'cancelled' ? 'error' : st === 'pending' ? 'pending' : st;
  let host = '', page = '';
  try { const u = new URL((m.plan && m.plan.diff && m.plan.diff[0] && m.plan.diff[0].text) || m.args); host = u.hostname.replace(/^www\./, ''); page = (u.pathname + u.search).replace(/^\/$/, ''); } catch (e) { host = String(m.args || '').slice(0, 60); }
  if (page.length > 50) page = page.slice(0, 49) + '\u2026';
  let h = '<div class="tool wcard"><div class="th">' + ICON('globe') + '<span class="nm">Read web page</span><span class="st ' + cls + '">' + esc(label) + '</span></div>' +
    '<div class="wsite"><b>' + esc(host) + '</b>' + esc(page) + '</div>';
  if (st === 'error' && m.content) h += '<div class="wwhy">' + esc(String(m.content).replace(/^Error:\s*/i, '').split('\n')[0].slice(0, 140)) + '</div>';
  if (st === 'pending' && m.plan) {
    if (m.plan.tip) h += '<div class="wtip">You\u2019ve allowed ' + m.plan.tip + ' sites in this chat. Allow every website here so it stops asking?<br><button class="btn sm" data-tool="allweb" data-id="' + m.id + '"><span class="lbl">Allow every website</span></button></div>';
    h += '<div class="tf"><span style="flex:1"></span><button class="btn sm" data-tool="reject" data-id="' + m.id + '"><span class="lbl">Reject</span></button><button class="btn primary sm" data-tool="apply" data-id="' + m.id + '"><span class="lbl">Read</span></button></div>' +
      '<div class="tf"><button class="linkbtn" data-tool="always" data-id="' + m.id + '">Always allow ' + esc(host) + ' in this chat</button></div>';
  }
  return h + '</div>';
}
function findingsCard(m) {
  const f = m.findings || { items: [], summary: '' };
  let h = '<div class="tool rvcard"><div class="th">' + ICON('search') + '<span class="nm">Review</span><span class="pa">' + esc(m.args || '') + '</span></div>';
  if (!f.items.length) h += '<div class="rvok">' + ICON('check') + '<span>No problems found</span></div>';
  else h += f.items.map((x, i) => '<div class="rvrow"><span class="rvic sv-' + x.severity + '">' + ICON(x.severity === 'risk' ? 'warn' : x.severity === 'leftover' ? 'bug' : 'info') + '</span><div class="rvtx"><div class="rvt">' + esc(x.title) + '</div>' + (x.path ? '<div class="rvp">' + esc(x.path) + (x.line ? ':' + x.line : '') + '</div>' : '') + '</div><button class="btn sm" data-tool="fixfind" data-id="' + m.id + '" data-i="' + i + '"><span class="lbl">Fix</span></button></div>').join('');
  if (f.summary) h += '<div class="rvsum">' + esc(f.summary) + '</div>';
  return h + '</div>';
}
function toolCard(m) {
  if (m.name === 'update_plan' && m.steps) return planCard(m);
  if (m.name === 'report_findings' && m.findings) return findingsCard(m);
  if (m.name === 'web_fetch') return webCard(m);
  if (m.name === 'make_file' && m.file) {
    return '<div class="tool"><div class="th">' + ICON('file') + '<span class="nm">' + esc(m.file.name) + '</span><span class="pa">' + esc(fmtBytes(m.file.size)) + '</span></div>' +
      '<div class="tf"><span class="lbl" style="flex:1">Ready</span><button class="btn sm" data-tool="copyfile" data-id="' + m.id + '">' + ICON('copy') + '<span class="lbl">Copy</span></button>' +
      (isHtmlName(m.file && m.file.name) ? '<button class="btn sm iconly" data-tool="prevfile" data-id="' + m.id + '" aria-label="Preview">' + ICON('eye') + '</button>' : '') + '<button class="btn primary sm" data-tool="getfile" data-id="' + m.id + '">' + ICON('down') + '<span class="lbl">Download</span></button></div></div>';
  }
  const st = m.status || 'running';
  let h = '<div class="tool"><div class="th">' + ICON(TOOL_ICON[m.name] || 'file') + '<span class="nm">' + esc(toolLabel(m.name)) + '</span><span class="pa">' + esc(m.args || '') + '</span><span class="st ' + st + '">' + esc(st === 'running' ? 'working' : st) + '</span></div>';
  if (m.plan) {
    h += '<div class="diff">' + (m.plan.diff || []).map((l) => '<span class="dl ' + (l.t === 'add' ? 'a' : l.t === 'del' ? 'd' : l.t === 'warn' ? 'w' : 'c') + '">' + esc((l.t === 'add' ? '+ ' : l.t === 'del' ? '- ' : '  ') + (l.text || '')) + '</span>').join('') +
      (m.plan.more ? '<span class="dl c">... ' + m.plan.more + ' more lines</span>' : '') + '</div>';
    h += '<div class="tf"><span class="lbl" style="flex:1">' + esc(opLabel(m.plan.op)) + (m.plan.auto ? ' · allowed' : '') + (m.plan.risky && st === 'pending' ? ' · risky' : '') + (m.plan.outside && st === 'pending' ? ' · outside folder' : '') + ((m.plan.web || m.plan.path === 'git' || m.plan.path === 'zip' || m.plan.path === 'unzip' || m.plan.path === 'terminal' || m.plan.path === 'device' || m.plan.path === 'image' || m.plan.path === 'release' || m.plan.path === 'version') ? '' : ' · +' + m.plan.added + ' −' + m.plan.removed) + '</span>';
    if (st === 'pending' && m.plan.warn) h += '</div><div class="tf warnrow"><button class="btn sm" data-tool="reject" data-id="' + m.id + '"><span class="lbl">Cancel</span></button><span style="flex:1"></span><button class="btn sm" data-tool="apply" data-id="' + m.id + '"><span class="lbl">Push anyway</span></button><button class="btn primary sm" data-tool="fix" data-id="' + m.id + '"><span class="lbl">Fix it</span></button>';
    else if (st === 'pending') h += '<button class="btn sm" data-tool="reject" data-id="' + m.id + '"><span class="lbl">Reject</span></button><button class="btn primary sm" data-tool="apply" data-id="' + m.id + '"><span class="lbl">' + (m.plan.path === 'terminal' ? 'Run' : m.plan.web ? 'Read' : m.plan.path === 'image' ? 'Create' : m.plan.path === 'device' ? 'Allow' : m.plan.path === 'release' ? 'Release' : 'Apply') + '</span></button>' +
      ((m.plan.path === 'terminal' || m.plan.web) && m.plan.allowKeys && m.plan.allowKeys.length && !m.plan.risky && !m.plan.ask ? '</div><div class="tf"><button class="linkbtn" data-tool="always" data-id="' + m.id + '">Always allow ' + esc(m.plan.allowKeys.map((k) => k.replace(/^web:/, '')).join(', ')) + ' in this chat</button>' : '');
    else if (st === 'applied' && m.backupId) h += '<button class="btn sm" data-tool="undo" data-b="' + m.backupId + '">' + ICON('undo') + '<span class="lbl">Undo</span></button>';
    h += '</div>';
    if (m.plan.path === 'terminal' && m.content && st !== 'pending') { const oc = m.content.slice(-3000); h += '<pre class="out">' + esc(oc) + '</pre>' + (oc.split('\n').length > 12 ? '<div class="tf outx"><span class="fsz hidden"><button class="fbtn" data-tool="fs-" type="button" aria-label="Smaller text">A\u2212</button><button class="fnum' + (outFs() !== 11 ? ' chg' : '') + '" data-tool="fs0" type="button" aria-label="Reset text size">' + outFs() + '</button><button class="fbtn" data-tool="fs+" type="button" aria-label="Larger text">A+</button></span><span style="flex:1"></span><button class="linkbtn" data-tool="xout" type="button">Expand</button></div>' : ''); }
    if (m.check) h += '<div class="tf chk ' + (m.check.ok ? 'good' : 'bad') + '">' + ICON('shield-check') + '<span class="lbl" style="flex:1">' + (m.check.ok ? 'Check passed' : 'Check failed') + ' \u00b7 ' + esc(String(m.check.cmd).slice(0, 160)) + '</span></div>' + (m.check.ok ? '' : '<pre class="out">' + esc(m.check.text) + '</pre>');
    if (m.preview && m.preview.length) h += '<div class="genimg"><img alt="Generated picture" src="data:' + m.preview[0].mime + ';base64,' + m.preview[0].data + '"></div>';
  } else if (m.status === 'error' || m.status === 'cancelled') {
    h += '<pre class="out wrap">' + esc((m.content || '').slice(0, 400)) + '</pre>';
  }
  return h + '</div>';
}

// ------------------------------------------------------------ approvals
function pendingCount() { return S.approvals.size; }
/** True when the running task belongs to the chat on screen. */
function runHere() { return !!(S.running && S.runChat && S.chat && S.chat.id === S.runChat.id); }
function updateApproveBar() {
  const n = !S.running || runHere() ? pendingCount() : 0; const bar = $('#approveBar');
  drawRunStrip();
  if (!n) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden'); $('#approveText').textContent = n + ' waiting for your approval';
}
/** One line under the top bar while a task runs in another chat: where it is, and a way back. */
function drawRunStrip() {
  const el = $('#runStrip'); if (!el) return;
  if (!S.running || !S.runChat || runHere()) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const title = S.runChat.title || 'New chat';
  const wait = pendingCount() > 0;
  el.innerHTML = (wait ? '' : '<span class="spin"></span>') + '<span class="rs-t">' + (wait ? 'Waiting for your approval in ' : 'Working in ') + '\u201c' + esc(title) + '\u201d</span><button type="button" class="linkbtn" data-a="view"><span class="lbl">View</span></button>';
  el.classList.remove('hidden');
  $('[data-a=view]', el).onclick = () => openChat(S.runChat.id);
}
/** Resolves once the running task has ended (used before deleting its chat or starting another). */
async function waitIdle(ms = 8000) {
  const t0 = Date.now();
  while (S.running && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50));
}
function decide(id, v) {
  const r = S.approvals.get(Number(id)); if (!r) return;
  S.approvals.delete(Number(id)); S.approvalTm.delete(Number(id)); r(v); updateApproveBar();
}

// ------------------------------------------------------------ sending
const WEIRD_MIME = /^image\/(png|jpe?g|webp|gif)$/;
// Small ring next to the other composer icons: how full the chat history is for the chosen token-saving mode.
async function drawRing() {
  const btn = $('#ctxBtn'); if (!btn) return;
  const id = S.chat && S.chat.id; let u = null;
  try { if (id && !S.chat.fresh) u = await A.contextUsage(id); } catch (e) { u = null; }
  if (!u || !u.used || (S.chat && S.chat.id !== id)) { btn.classList.add('hidden'); return; }
  const r = 7.5, c = 2 * Math.PI * r, col = u.pct < 70 ? 'var(--ok)' : u.pct < 90 ? '#e0a14d' : 'var(--bad)';
  btn.innerHTML = '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="' + r + '" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="2.2"/><circle cx="10" cy="10" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="' + (c * u.pct / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 10 10)"/></svg>';
  btn.setAttribute('aria-label', 'Context ' + u.pct + '% used'); btn.title = 'Context ' + u.pct + '% used'; btn.dataset.pct = u.pct; btn.dataset.used = u.used; btn.dataset.budget = u.budget; btn.dataset.mode = u.mode;
  btn.classList.remove('hidden');
}
async function showRing() {
  const b = $('#ctxBtn'); const pct = b.dataset.pct, used = +b.dataset.used, budget = +b.dataset.budget;
  const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n));
  const mode = b.dataset.mode.charAt(0).toUpperCase() + b.dataset.mode.slice(1);
  const v = await choiceBox('Context ' + pct + '% used', k(used) + ' of ' + k(budget) + ' tokens (' + mode + ' mode). When it fills up, older messages are summarised automatically.', ['OK', 'New chat'], { noCancel: true });
  if (v === 1) newChat(S.folder);
}
function setRunning(v) {
  S.running = v; if (!v) S.runChat = null;
  const stop = runHere(); const sb = $('#stopBtn'); if (sb) sb.classList.toggle('hidden', !stop);
  drawQueue(); drawRunStrip();
}
/** Back on the main screen. It never stops a task: while one runs it asks first, otherwise it needs a second press to leave. */
let backAt = 0; let backAsking = false;
async function onBackRoot() {
  if (backAsking) return;
  if (S.running) {
    backAsking = true;
    const v = await choiceBox('A task is running', 'Leaving now may stop it.', ['Stay', 'Leave'], { noCancel: true });
    backAsking = false;
    if (v === 1) App.exitApp();
    return;
  }
  if (Date.now() - backAt < 2000) { App.exitApp(); return; }
  backAt = Date.now();
  const h = $('#exitHint'); if (h) { h.classList.add('show'); clearTimeout(h._t); h._t = setTimeout(() => h.classList.remove('show'), 2000); }
}
window.__kdexBack = onBackRoot;
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
const lastSent = { text: '', at: 0 };
/** Some phone keyboards give back the word they were still composing right after the box is cleared. Clear it again if the same text returns. */
let ghostSeq = 0;
function ghostGuard(sent) {
  const input = $('#input'); const my = ++ghostSeq;
  [60, 200, 500, 1000].forEach((ms) => setTimeout(() => { if (my === ghostSeq && input.value.trim() === sent) { input.value = ''; autoGrow(); } }, ms));
}
async function send(regenerate) {
  if (S.running && runHere()) { // a task runs here: a typed message waits in line and joins at the next step
    if (regenerate) return;
    const qt = $('#input').value.trim();
    if (!qt && !S.attach.length) return;
    if (S.attach.length) { toast('Attachments can be added when the task is done', { kind: 'warn' }); return; }
    S.queue.push(qt); $('#input').value = ''; autoGrow(); dropDraft(false); ghostGuard(qt); drawQueue(); return;
  }
  if (S.running) { // a task runs in another chat: one task at a time, so ask what to do
    if (!regenerate && !$('#input').value.trim() && !S.attach.length) return;
    const v = await choiceBox('Another task is running', 'Finish or stop \u201c' + (S.runChat && S.runChat.title || 'New chat') + '\u201d before starting a new one here.', ['Wait', 'Stop it'], { noCancel: true });
    if (v !== 1) return;
    stopRun(); await waitIdle(); if (S.running) return;
  }
  const input = $('#input'); const text = regenerate ? '' : input.value.trim();
  if (!regenerate && !text && !S.attach.length) return;
  if (!regenerate && text && !S.attach.length && text === lastSent.text && Date.now() - lastSent.at < 4000) { input.value = ''; autoGrow(); return; }
  if (!S.models.length) { noModelNotice(); return; }
  const attach = regenerate ? [] : S.attach;
  const images = attach.filter((a) => a.img).map((a) => ({ mime: a.mime, data: a.data }));
  const files = attach.filter((a) => !a.img);
  if (!regenerate) { input.value = ''; autoGrow(); dropDraft(!!(S.chat && S.chat.fresh)); S.attach = []; drawChips(); if (text) { lastSent.text = text; lastSent.at = Date.now(); ghostGuard(text); } }
  if (S.chat.fresh && !S.chat.title) { S.chat.title = (text || (attach[0] && attach[0].name) || 'New chat').slice(0, 48); }
  const tu = $('#turnUndo'); if (tu) tu.remove();
  $$('.controw').forEach((x) => x.remove()); const pd = $('#planDone'); if (pd) pd.remove(); input.placeholder = 'Message KDex Agent';
  delete S.chat.fresh; await persistChat(); loadChats();
  const chat = S.chat; const folder = S.folder; const think = S.think; const planOn = !!chat.plan; let runOk = true; S.queue = [];
  const here = () => !!(S.chat && S.chat.id === chat.id); // false while the user looks at another chat: the task keeps running, the screen is not touched
  S.abort = new AbortController(); S.runChat = chat; setRunning(true);
  Work.start('Working on your request'); const t0 = Date.now();
  const ui = {
    onUser: (m) => { if (here()) renderMsg(m); }, onAssistant: (m) => { if (here()) renderMsg(m); }, onDelta: (m) => { if (here()) { netLine(''); renderMsg(m); } },
    onTool: (m) => { if (!here()) return; renderMsg(m); if (m.status === 'applied' || m.status === 'rejected') updateChangesChip(); else if (m.name === 'make_file' && m.status === 'done') drawScratch(); },
    takeQueued: async () => { const q = S.queue.splice(0); drawQueue(); return q; }, hasQueued: () => S.queue.length > 0,
    requestSecret: (info, signal) => askSecret(info, signal), askUser: (q, opts, signal) => { Work.needs('A question is waiting for you', chat.id); return askChoice(q, opts, signal); }, watchBuild: (folder, sha, label) => { CI.watchBuild(folder, sha, label); },
    onNotice: (t) => { if (/^No connection/i.test(t)) { netLine('Offline. Waiting to reconnect...'); Work.start('Waiting for connection'); } else if (/^Back online/i.test(t)) { netLine(''); Work.start('Working on your request'); } else if (/busy/i.test(t)) netLine('The provider is busy. Trying again...'); else toast(t, { kind: 'warn' }); }, onMemory: (n) => toast('Remembered: ' + n[0]),
    requestApproval: (tm, signal) => new Promise((resolve) => {
      const first = !pendingCount(); S.approvals.set(tm.id, resolve); S.approvalTm.set(tm.id, tm); updateApproveBar();
      if (first) Work.needs('Waiting for your approval', chat.id);
      signal.addEventListener('abort', () => decide(tm.id, 'reject'), { once: true });
    }),
  };
  try {
    await A.runTurn({ chat, text, images, attachFiles: files, attachNames: attach.map((a) => a.name), folder, modelId: currentModelId(), think, plan: planOn, signal: S.abort.signal, ui, regenerate: !!regenerate });
    netLine('');
    if (!S.abort || !S.abort.signal.aborted) Work.done(true, 'Your request is done.', chat.id);
    D.log('run', 'Agent run \u00b7 ' + Math.round((Date.now() - t0) / 100) / 10 + 's');
  } catch (e) {
    runOk = false; netLine(''); D.log('error', 'Agent run failed: ' + (e.message || e)); Work.done(false, String(e.message || 'Something went wrong').slice(0, 120), chat.id);
    toast(e.message || 'Something went wrong', { kind: 'err' });
    const m = { chatId: chat.id, role: 'assistant', text: '[Error: ' + (e.message || 'failed') + ']', status: 'error', calls: [], at: Date.now() };
    m.id = await db.put('messages', m); if (here()) renderMsg(m);
  }
  if (S.queue.length) { // a message that never got picked up goes back into the box so nothing is lost
    const left = S.queue.splice(0).join('\n'); ghostSeq++;
    if (here()) { const inp = $('#input'); inp.value = left + (inp.value ? '\n' + inp.value : ''); autoGrow(); toast('Your message was not sent. It is back in the box.', { kind: 'warn' }); }
  }
  const wasAway = !here(); const stopped = !!(S.abort && S.abort.signal.aborted);
  Work.stop(); setRunning(false); S.abort = null; updateApproveBar(); loadChats();
  if (wasAway) { if (!stopped) toast('Task finished in \u201c' + (chat.title || 'New chat') + '\u201d', { result: true, action: { label: 'View', fn: () => openChat(chat.id) } }); return; }
  updateChangesChip(); drawRing(); if (planOn && runOk && !stopped) showPlanCard(); showTurnUndo(t0);
}
/** Puts a ready-made request in the chat and sends it (used by Fix buttons). */
async function quickSend(text) {
  if (S.running) { toast('Wait for the current task to finish', { kind: 'warn' }); return; }
  if (!S.models.length) { noModelNotice(); return; }
  const input = $('#input'); input.value = text; autoGrow(); await send();
}
/** Build status bar above the message box: shows the GitHub build of the last push and a Fix it button when it fails. */
async function drawCi(w) {
  const old = $('#ciBar'); if (old) old.remove();
  if (!w || !S.folder || S.folder.id !== w.folderId || w.phase === 'off' && !w.msg) return;
  const tries = await CI.fixTries(w.folderId);
  const el = document.createElement('div'); el.id = 'ciBar'; el.className = 'cibar ' + w.phase;
  const busy = w.phase === 'waiting' || w.phase === 'running';
  const ic = busy ? '<span class="spin"></span>' : w.phase === 'passed' ? '<span class="ciic ok">' + ICON('check') + '</span>' : '<span class="ciic bad">' + ICON(w.phase === 'failed' ? 'warn' : 'info') + '</span>';
  el.innerHTML = ic + '<span class="grow">' + esc(CI.describe(w, tries)) + '</span>' +
    (w.phase === 'failed' && tries < CI.MAX_FIX_TRIES ? '<button class="btn primary sm" data-a="fix"><span class="lbl">Fix it</span></button>' : '') +
    (!busy ? '<button class="btn sm" data-a="x" aria-label="Dismiss"><span class="lbl">Close</span></button>' : '');
  $('#approveBar').before(el);
  const fx = $('[data-a=fix]', el); if (fx) fx.onclick = async () => {
    const n = await CI.addFixTry(w.folderId); CI.stopWatch();
    await quickSend('The GitHub build for my last push failed' + (w.run ? ' (run #' + w.run.id + ')' : '') + '. Read its log with github_run_log, find the cause, fix it with the smallest edits, run pre_push_check, and commit. Do not push without asking me. This is fix try ' + n + ' of ' + CI.MAX_FIX_TRIES + '.');
  };
  const cx = $('[data-a=x]', el); if (cx) cx.onclick = () => CI.stopWatch();
}
/** After a task that changed two or more files: one tap to undo the whole task, or review the list. */
async function showTurnUndo(since) {
  const old = $('#turnUndo'); if (old) old.remove();
  if (!S.chat) return;
  const live = (await db.byIndex('backups', 'chatId', S.chat.id)).filter((b) => !b.undone && b.at >= since).sort((a, b) => b.id - a.id);
  if (live.length < 2) return;
  const el = document.createElement('div'); el.id = 'turnUndo'; el.className = 'turnundo';
  el.innerHTML = '<span class="grow">' + live.length + ' changes made</span><button class="btn sm" data-a="review"><span class="lbl">Review</span></button><button class="btn sm danger" data-a="undo">' + ICON('undo') + '<span class="lbl">Undo all</span></button>';
  $('#messages').appendChild(el); scrollEnd(true);
  $('[data-a=review]', el).onclick = openChanges;
  $('[data-a=undo]', el).onclick = async () => {
    if (!await confirmBox('Undo this whole task?', 'The ' + live.length + ' changes made in this task are rolled back, newest first. Other earlier changes stay.', 'Undo all')) return;
    for (const b of live) await undoOne(b.id);
    el.remove(); updateChangesChip();
  };
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
async function addFiles(list) {
  let imageNote = false;
  for (const f of Array.from(list)) {
    try {
      if (WEIRD_MIME.test(f.type)) { const im = await prepareImage(f); S.attach.push({ img: true, name: f.name, mime: im.mime, data: im.data }); imageNote = true; }
      else if (isPdf(f.name)) {
        if (f.size > PDF_MAX_BYTES) toast(f.name + ' is too large (max 15 MB).', { kind: 'warn' });
        else { const r = await pdfText(f); S.attach.push({ name: f.name, text: '[PDF: ' + r.pages + ' page' + (r.pages === 1 ? '' : 's') + (r.cut ? ', first ' + r.read + ' pages read because the file is long' : '') + ']\n' + r.text }); }
      }
      else if (isOffice(f.name)) { if (f.size > 8 * 1048576) toast(f.name + ' is too large (max 8 MB).', { kind: 'warn' }); else { let t = await officeText(f); let note = ''; if (t.length > 400 * 1024) { t = t.slice(0, 400 * 1024); note = '\n[Text cut: the file is long]'; } S.attach.push({ name: f.name, text: t + note }); } }
      else if (f.size > 400 * 1024) toast(f.name + ' is too large (max 400 KB). Put it in a project folder instead.', { kind: 'warn' });
      else { const t = await f.text(); if (t.includes('\u0000')) toast(f.name + ' looks like a binary file.', { kind: 'warn' }); else S.attach.push({ name: f.name, text: t }); }
    } catch (e) { toast(e.message, { kind: 'err' }); }
  }
  drawChips();
  if (imageNote) warnNoVision();
}
function warnNoVision() {
  const m = S.models.find((x) => x.id === currentModelId());
  if (m && !likelySeesImages(m.apiModel) && !(S.visionWarned = S.visionWarned || new Set()).has(m.id) && S.visionWarned.add(m.id)) toast("Pictures may not work. This model may not read pictures; if the reply ignores it, switch to a vision model (for example Claude, GPT-4o or Gemini).", { kind: 'warn' });
}
// ---- drafts: what is typed in the message box survives leaving the chat, closing the app or a phone shutdown
let draftTimer = null;
const draftKey = () => (S.chat && !S.chat.fresh ? 'draft:' + S.chat.id : 'draft:new');
async function flushDraft() {
  clearTimeout(draftTimer); draftTimer = null;
  if (!S.chat) return; // no chat is open yet (app start): there is nothing to save and the stored draft must stay
  const t = $('#input'); if (!t) return; const v = t.value; const key = draftKey();
  try {
    if (!v.trim() || redactPatterns(v) !== v) await db.del('kv', key); // empty, or it looks like a key or token: do not keep it
    else await kvSet(key, v);
  } catch (e) { /* storage unavailable */ }
}
const scheduleDraft = () => { clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft, 600); };
async function loadDraft() {
  const t = $('#input'); if (!t || t.value) return;
  try { const v = await kvGet(draftKey(), ''); if (v && !t.value) { t.value = v; autoGrow(); } } catch (e) { /* none */ }
}
async function dropDraft(fresh) {
  clearTimeout(draftTimer); draftTimer = null;
  try { await db.del('kv', fresh ? 'draft:new' : draftKey()); if (S.chat) await db.del('kv', 'draft:' + S.chat.id); } catch (e) { /* none */ }
}
function autoGrow() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; }

// ------------------------------------------------------------ thinking pill
/** The Continue button belongs only to the newest message of a chat. */
function trimCont() { const last = $('#messages').lastElementChild; $$('.controw').forEach((x) => { if (x.closest('.msg') !== last) x.remove(); }); }
function drawPlan() {
  const on = !!(S.chat && S.chat.plan); const b = $('#planBtn'); if (!b) return;
  b.classList.toggle('on', on); const l = 'Plan mode: ' + (on ? 'on' : 'off'); b.setAttribute('aria-label', l); b.title = l;
  $('#planHint').classList.toggle('hidden', !on); $('#composer .box').classList.toggle('plan', on);
}
/** Messages typed while the task runs wait here as small chips until the agent picks them up. */
function drawQueue() {
  const el = $('#queueBar'); if (!el) return;
  const show = runHere() && S.queue.length > 0;
  el.classList.toggle('hidden', !show);
  el.innerHTML = show ? S.queue.map((t, i) => '<div class="qchip">' + ICON('clock') + '<span>' + esc(t) + '</span><button class="icon-btn" type="button" data-q="' + i + '" aria-label="Remove this message">' + ICON('x') + '</button></div>').join('') : '';
  $$('[data-q]', el).forEach((b) => { b.onclick = () => { S.queue.splice(+b.dataset.q, 1); drawQueue(); }; });
}
/** After a Plan mode answer: build it, or ask for changes. */
function showPlanCard() {
  const old = $('#planDone'); if (old) old.remove();
  if (!S.chat) return;
  const el = document.createElement('div'); el.id = 'planDone'; el.className = 'turnundo';
  el.innerHTML = '<span class="grow">Plan ready</span><button class="btn sm" data-a="rev">' + ICON('edit') + '<span class="lbl">Revise</span></button><button class="btn primary sm" data-a="go">' + ICON('check') + '<span class="lbl">Build this plan</span></button>';
  $('#messages').appendChild(el); scrollEnd(true);
  $('[data-a=rev]', el).onclick = () => { const i = $('#input'); i.placeholder = 'What should change in the plan?'; i.focus(); };
  $('[data-a=go]', el).onclick = async () => { el.remove(); if (S.chat) { S.chat.plan = false; drawPlan(); persistChat(); } await quickSend('Build the plan above now. Make the changes.'); };
}
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
  $('#sheetTitle').innerHTML = '<span>' + esc(title) + '</span>'; $('#sheetTitle').title = title; $('#sheet').classList.remove('hidden');
  $('#sheetBack').classList.toggle('hidden', !opts.back); $('#sheetBack').onclick = opts.back || null;
  const tabs = $('#sheetTabs'); tabs.classList.add('hidden'); tabs.innerHTML = '';
  $('#sheetFoot').classList.add('hidden'); $('#sheetFoot').innerHTML = '';
  const body = $('#sheetBody'); body.innerHTML = ''; body.scrollTop = 0; return body;
}
/** Drag the grip or title bar down to close a sheet, like a native bottom sheet. */
function sheetDrag() {
  const card = $('#sheet .sheet-card'); const root = $('#sheet'); if (!card || card._drag) return; card._drag = true;
  const zone = [$('#sheetGrip'), $('.sheet-head', card)];
  let on = false; let y0 = 0; let t0 = 0; let dy = 0; let id = null; let h = 1;
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reset = () => { card.style.transition = card.style.transform = ''; root.style.transition = root.style.background = ''; };
  zone.forEach((z) => {
    z.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; on = true; id = e.pointerId; y0 = e.clientY; t0 = Date.now(); dy = 0; h = card.offsetHeight || 1; card.style.transition = root.style.transition = 'none'; try { z.setPointerCapture(id); } catch (x) { /* ignore */ } });
    z.addEventListener('pointermove', (e) => {
      if (!on) return; dy = Math.max(0, e.clientY - y0);
      card.style.transform = 'translateY(' + dy + 'px)';
      root.style.background = 'rgba(0,0,0,' + (0.45 * (1 - Math.min(1, dy / h))).toFixed(3) + ')';
    });
    const end = () => {
      if (!on) return; on = false; try { z.releasePointerCapture(id); } catch (x) { /* ignore */ }
      const v = dy / Math.max(1, Date.now() - t0);
      const t = calm ? '0s' : '.2s';
      card.style.transition = 'transform ' + t + ' ease'; root.style.transition = 'background ' + t + ' ease';
      if (dy > h * 0.25 || (v > 0.6 && dy > 30)) {
        card.style.transform = 'translateY(100%)'; root.style.background = 'rgba(0,0,0,0)';
        setTimeout(() => { closeSheet(); reset(); }, calm ? 0 : 200);
      } else { card.style.transform = ''; root.style.background = ''; setTimeout(reset, calm ? 0 : 220); }
    };
    z.addEventListener('pointerup', end); z.addEventListener('pointercancel', end);
  });
}
/** Touch swipe that dismisses a panel from anywhere on it. axis 'x' (towards negative) or 'y' (towards positive). */
function swipeDismiss(el, o) {
  let x0 = 0; let y0 = 0; let t0 = 0; let mode = null; let d = 0; let size = 1;
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const X = o.axis === 'x'; const sign = X ? -1 : 1;
  el.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { mode = 'skip'; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); mode = null; d = 0; size = (X ? el.offsetWidth : el.offsetHeight) || 1; }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (mode === 'skip') return;
    const dx = e.touches[0].clientX - x0; const dy = e.touches[0].clientY - y0;
    const main = (X ? dx : dy) * sign; const cross = Math.abs(X ? dy : dx);
    if (mode === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      mode = (main > 0 && main > cross * 1.2 && o.can(e.target)) ? 'drag' : 'skip';
      if (mode === 'drag') o.begin();
    }
    if (mode !== 'drag') return;
    if (e.cancelable) e.preventDefault();
    d = Math.max(0, main); o.move(d, size);
  }, { passive: false });
  const end = () => {
    if (mode !== 'drag') { mode = null; return; }
    mode = null; const v = d / Math.max(1, Date.now() - t0);
    if (d > size * 0.3 || (v > 0.6 && d > 30)) o.commit(calm); else o.cancel(calm);
  };
  el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
}
/** True when something between the touch and the panel is scrolled, so a swipe should scroll it instead. */
function scrolledAbove(target, stop) {
  for (let n = target; n && n !== stop; n = n.parentElement) { if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight) return true; if (/^(TEXTAREA|INPUT)$/.test(n.tagName)) return true; }
  return false;
}
function touchSwipes() {
  const dr = $('#drawer'); const sc = $('#scrim');
  swipeDismiss(dr, {
    axis: 'x', can: () => true, begin: () => { dr.style.transition = 'none'; },
    move: (d, w) => { dr.style.transform = 'translateX(' + (-d) + 'px)'; sc.style.opacity = String(1 - Math.min(1, d / w)); },
    commit: (calm) => { dr.style.transition = calm ? 'none' : 'transform .18s ease'; dr.style.transform = 'translateX(-102%)'; setTimeout(() => { closeDrawer(); dr.style.transition = dr.style.transform = sc.style.opacity = ''; }, calm ? 0 : 180); },
    cancel: (calm) => { dr.style.transition = calm ? 'none' : 'transform .18s ease'; dr.style.transform = ''; sc.style.opacity = ''; setTimeout(() => { dr.style.transition = ''; }, calm ? 0 : 200); },
  });
  const card = $('#sheet .sheet-card'); const root = $('#sheet');
  const rs = () => { card.style.transition = card.style.transform = ''; root.style.transition = root.style.background = ''; };
  swipeDismiss(card, {
    axis: 'y', can: (t) => !t.closest('#sheetGrip, .sheet-head') && !scrolledAbove(t, card), begin: () => { card.style.transition = root.style.transition = 'none'; },
    move: (d, h) => { card.style.transform = 'translateY(' + d + 'px)'; root.style.background = 'rgba(0,0,0,' + (0.45 * (1 - Math.min(1, d / h))).toFixed(3) + ')'; },
    commit: (calm) => { card.style.transition = calm ? 'none' : 'transform .2s ease'; root.style.transition = calm ? 'none' : 'background .2s ease'; card.style.transform = 'translateY(100%)'; root.style.background = 'rgba(0,0,0,0)'; setTimeout(() => { closeSheet(); rs(); }, calm ? 0 : 200); },
    cancel: (calm) => { card.style.transition = calm ? 'none' : 'transform .2s ease'; root.style.transition = calm ? 'none' : 'background .2s ease'; card.style.transform = ''; root.style.background = ''; setTimeout(rs, calm ? 0 : 220); },
  });
}
// Update checks: when the app starts or comes back after a while (6 hours), when Settings > About is opened (1 hour),
// and on demand. A failed check waits 15 minutes before the next quiet try, and an unchanged answer (304) costs no rate limit.
const UPD_AUTO_MS = 6 * 3600 * 1000; const UPD_OPEN_MS = 5 * 60 * 1000; const UPD_RETRY_MS = 15 * 60 * 1000;
let updBusy = null;
/** One check at a time. Returns { r } with the fresh answer, or { skipped } when the saved answer is recent enough. */
function refreshUpdate(maxAgeMs, force) {
  if (updBusy) return updBusy;
  updBusy = (async () => {
    const last = await kvGet('updLast', null); const now = Date.now(); const good = last && last.r && last.r.ok ? last.r : null;
    if (!force) {
      if (good && now - last.at < maxAgeMs) return { skipped: true };
      if (now - (await kvGet('updFail', 0)) < UPD_RETRY_MS) return { skipped: true };
    }
    const r = await checkUpdate(APP_VERSION, null, good);
    if (r.ok) { await kvSet('updLast', { at: now, r }); await kvSet('updFail', 0); } else await kvSet('updFail', now);
    return { r };
  })().finally(() => { updBusy = null; });
  return updBusy;
}
/** Settings > About: shows the last known update result, refreshes it quietly when it is over an hour old, and lets the user check now. */
async function drawUpdate(body) {
  const st = $('#updState', body); const box = $('#updBox', body); if (!st || !box) return;
  const show = (r) => {
    if (!r) { st.textContent = 'Not checked'; box.innerHTML = '<button id="updGo" class="btn" style="width:100%"><span class="lbl">Check for updates</span></button>'; }
    else if (!r.ok) { st.textContent = r.error || 'Could not check'; box.innerHTML = '<button id="updGo" class="btn" style="width:100%"><span class="lbl">Try again</span></button>'; }
    else if (r.newer) { st.textContent = r.latest + ' available'; box.innerHTML = '<a class="btn primary" style="display:flex;width:100%;justify-content:center;text-decoration:none" href="' + esc(r.apk || r.url) + '" target="_blank" rel="noopener"><span class="lbl">Download ' + esc(r.latest) + (r.size ? ' (' + fmtBytes(r.size) + ')' : '') + '</span></a><small style="display:block;margin-top:6px;color:var(--mut);font-size:13px;line-height:1.4">Open the downloaded file to install. Your chats and settings stay.</small>'; }
    else { st.textContent = r.none ? 'No releases yet' : 'Up to date'; box.innerHTML = '<button id="updGo" class="btn" style="width:100%"><span class="lbl">Check for updates</span></button>'; }
    const g = $('#updGo', body); if (g) g.onclick = async () => { st.textContent = 'Checking...'; g.disabled = true; const x = await refreshUpdate(0, true); if (body.isConnected) show(x.r || null); };
  };
  const last = await kvGet('updLast', null);
  const known = last && last.r && last.r.ok ? Object.assign({}, last.r, { newer: isNewer(last.r.latest, APP_VERSION) }) : null;
  show(known);
  if (!known || Date.now() - last.at >= UPD_OPEN_MS) {
    const hold = known; if (known) st.textContent = 'Checking...';
    const x = await refreshUpdate(UPD_OPEN_MS, false);
    if (body.isConnected) show(x.r && x.r.ok ? x.r : hold);
  }
}
/** Quietly, at most every 6 hours, on start and when the app comes back to the screen. Tells the user once per new version. */
async function autoUpdateCheck() {
  if (!isNative) return;
  const x = await refreshUpdate(UPD_AUTO_MS, false); const r = x.r;
  if (r && r.ok && r.newer && (await kvGet('updToldFor', '')) !== r.latest) { await kvSet('updToldFor', r.latest); toast('Update ' + r.latest + ' is available. See Settings > About.', { result: true }); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoUpdateCheck().catch(() => {}); });
function openLicenses() {
  const body = sheet('Licenses', { back: () => openSettings() });
  const item = (n, l, t) => '<div class="kv" style="display:block"><b>' + esc(n) + '</b> <span style="color:var(--mut)">' + esc(l) + '</span><div style="color:var(--mut);font-size:13px;margin-top:2px">' + esc(t) + '</div></div>';
  body.innerHTML = '<div class="note" style="text-align:left">KDex Agent is source-available. Source: <a class="link" href="' + REPO_URL + '" target="_blank" rel="noopener">GitHub</a></div>' +
    item('KDex Agent', 'KDex Agent License', 'Copyright (c) 2026 Kamil Hussen (KDex). You may use it and send improvements; you may not redistribute or sell it.') + item('Capacitor', 'MIT', 'Ionic and contributors') + item('Inter font', 'SIL OFL 1.1', 'The Inter Project Authors') + item('Eclipse JGit', 'EDL (BSD-3-Clause)', 'Eclipse Foundation and contributors') + item('AndroidX libraries', 'Apache 2.0', 'Google') + item('pdf.js', 'Apache 2.0', 'Mozilla and contributors') + item('fflate', 'MIT', 'Arjun Barrett') + item('isomorphic-git and LightningFS', 'MIT', 'The isomorphic-git authors') + item('buffer', 'MIT', 'Feross Aboukhadijeh and contributors');
}
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheetFoot').classList.add('hidden'); S.sheetStack = []; }

/** Use `f` (or no folder) in the current chat. Messages stay; the model is told about the change. */
async function touchFolder(f) { if (!f) return; const x = S.folders.find((y) => y.id === f.id); if (x) { x.used = Date.now(); f.used = x.used; await A.saveFolders(S.folders); } }
async function applyFolder(f) {
  const c = S.chat; if (!c) return;
  rememberServer(f);
  touchFolder(f);
  const cur = S.folder;
  if ((cur && f && cur.id === f.id) || (!cur && !f)) { closeSheet(); return; }
  const had = (await db.byIndex('messages', 'chatId', c.id)).some((x) => x.role === 'user');
  if (had && cur && f) {
    const r = await choiceBox('Change folder?', 'This chat is working in "' + cur.name + '". Use "' + f.name + '" here, or start a new chat for it?', ['Use here', 'New chat'], { noCancel: true });
    if (r === 1) { closeSheet(); await newChat(f); await persistChat(); loadChats(); return; }
    if (r !== 0) return;
  }
  if (S.running && S.runChat && S.runChat.id === c.id) {
    if (await choiceBox('Change folder?', 'A task is running in this chat. Changing the folder stops it.', ['Change']) !== 0) return;
    stopRun(); await waitIdle();
  }
  S.folder = f; c.folderId = f ? f.id : null;
  c.allow = []; // "Always allow" belongs to the old folder
  if (had) {
    const ev = { chatId: c.id, role: 'event', status: 'done', at: Date.now(),
      label: f ? 'Folder: ' + f.name : 'Folder removed',
      text: f ? 'The user changed the project folder. You now work in "' + f.name + '"' + (cur ? ' (before: "' + cur.name + '")' : ' (before: no folder)') + '. File results from earlier messages may belong to another location, so read again before relying on them.'
        : 'The user removed the project folder. You now work on the private Scratch desk of this chat (file tools only; no terminal or Git).' };
    ev.id = await db.put('messages', ev); renderMsg(ev); scrollEnd(true);
    await persistChat(); loadChats();
  } else if ($('.empty', $('#messages'))) renderEmpty();
  drawCtx(); updateApproveBar(); closeSheet();
  if (f && f.remote && c.auto) { c.auto = false; await db.put('chats', c); updateTermChip(); toast('Auto is off for servers. Turn it on in this chat if you want.', { kind: 'warn' }); }
  toast(f ? 'Using ' + f.name + ' in this chat' : 'Folder removed from this chat');
  if (f && !f.remote) detectRepo(f);
  if (f && !cur) { const n = await scratchCount(c.id).catch(() => 0); if (n) await offerScratchMove(c, f, n); }
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
  let fq = '';
  const byRecent = () => S.folders.map((f, i) => [f, i]).sort((a, b) => ((b[0].used || 0) - (a[0].used || 0)) || (a[1] - b[1])).map((x) => x[0]);
  const loadPaths = async () => { for (const f of S.folders) paths[f.id] = f.remote ? f.user + '@' + f.host + ' \u00b7 ' + f.root : await getTermuxPath(f).catch(() => null); };
  await loadPaths();
  const draw = () => {
    body.innerHTML = '<button id="pOpen" class="btn primary" style="width:100%;margin-bottom:8px">' + ICON('folder') + '<span class="lbl">Open a folder...</span></button>' +
      '<button id="pPath" class="btn" style="width:100%;margin-bottom:8px">' + ICON('edit') + '<span class="lbl">Open by path...</span></button>' +
      '<button id="pClone" class="btn" style="width:100%;margin-bottom:8px">' + ICON('branch') + '<span class="lbl">Clone a repository...</span></button>' +
      '<button id="pServer" class="btn" style="width:100%;margin-bottom:8px">' + ICON('server') + '<span class="lbl">Connect a server...</span></button>' +
      (S.folder ? '<button id="pDetach" class="btn" style="width:100%;margin-bottom:8px">' + ICON('x') + '<span class="lbl">Remove folder from this chat</span></button>' : '') +
      '<button id="pNone" class="btn" style="width:100%;margin-bottom:8px">' + ICON('plus') + '<span class="lbl">New chat without a folder</span></button>' +
      '<div class="safe">' + ICON('lock') + '<span>I can only touch the folder you pick. A backup is saved before every change.</span></div>' +
      (S.folders.length ? '<div class="h3">Your folders</div>' : '') +
      (S.folders.length >= 6 ? '<label class="fsearch">' + ICON('search') + '<input id="fQ" placeholder="Search folders" autocomplete="off" value="' + esc(fq) + '"></label>' : '') +
      byRecent().map((f) => '<div class="row-item frow" data-f="' + f.id + '">' + ICON(f.remote ? 'server' : 'folder') + '<div class="grow"><div class="t">' + esc(f.name) + '</div><div class="s">' + (S.folder && S.folder.id === f.id ? 'Used in this chat' : f.used ? 'Opened ' + ago(f.used) : 'Tap to use in this chat') + '</div></div>' +
        '<button class="icon-btn rbtn" data-nf="' + f.id + '" aria-label="New chat in this folder">' + ICON('plus') + '</button>' + (f.remote ? '<button class="icon-btn rbtn" data-es="' + f.id + '" aria-label="Edit server">' + ICON('edit') + '</button>' : '') + '<button class="icon-btn rbtn" data-ck="' + f.id + '" aria-label="Checks after edits for ' + esc(f.name) + '">' + ICON('shield-check') + '</button><button class="icon-btn rbtn" data-rmf="' + f.id + '" aria-label="Remove">' + ICON('trash') + '</button>' +
        '<div class="fp"><span class="fpath">' + esc(paths[f.id] || 'Path unknown').replace(/\//g, '/<wbr>') + '</span>' + (paths[f.id] && !f.remote ? '<button class="icon-btn rbtn" data-cp="' + f.id + '" aria-label="Copy path of ' + esc(f.name) + '">' + ICON('copy') + '</button>' : '') + '</div></div>').join('') +
      '<div class="note" style="margin-top:12px">Android does not allow picking the whole storage or the Download folder. Choose a subfolder, for example one you create for a project.</div>';
    $('#pOpen').onclick = async () => {
      await offerAllFiles().catch(() => {});
      try {
        const r = await fs.pickFolder(); if (!r || !r.uri) return;
        let f = S.folders.find((x) => x.uri === r.uri);
        if (!f) { f = { id: uid(), name: r.name || 'Folder', uri: r.uri }; S.folders.push(f); await A.saveFolders(S.folders); }
        await applyFolder(f);
      } catch (e) { if (!/cancel/i.test(e.message || '')) toast(e.message || 'Could not open the folder', { kind: 'err' }); }
    };
    const filt = () => { const q = fq.trim().toLowerCase(); $$('[data-f]', body).forEach((r) => { const f = S.folders.find((x) => x.id === r.dataset.f); r.style.display = !q || (f && f.name.toLowerCase().includes(q)) ? '' : 'none'; }); };
    if ($('#fQ')) { $('#fQ').oninput = (e) => { fq = e.target.value; filt(); }; filt(); }
    $('#pPath').onclick = openByPath;
    $('#pClone').onclick = cloneFlow;
    $('#pServer').onclick = () => openServerForm();
    $$('[data-es]', body).forEach((b) => b.onclick = () => openServerForm(S.folders.find((x) => x.id === b.dataset.es)));
    $$('[data-ck]', body).forEach((b) => b.onclick = () => openChecks(S.folders.find((x) => x.id === b.dataset.ck)));
    if ($('#pDetach')) $('#pDetach').onclick = () => applyFolder(null);
    $('#pNone').onclick = () => { closeSheet(); newChat(null); };
    $$('[data-f]', body).forEach((r) => r.onclick = async (e) => {
      if (e.target.closest('[data-rmf]') || e.target.closest('[data-nf]') || e.target.closest('[data-cp]') || e.target.closest('[data-es]') || e.target.closest('[data-ck]')) return;
      await applyFolder(S.folders.find((x) => x.id === r.dataset.f));
    });
    $$('[data-cp]', body).forEach((b) => b.onclick = async () => { flashCopied(b, await copyText(paths[b.dataset.cp])); });
    $$('[data-nf]', body).forEach((b) => b.onclick = async () => { const f = S.folders.find((x) => x.id === b.dataset.nf); touchFolder(f); closeSheet(); await newChat(f); await persistChat(); loadChats(); });
    $$('[data-rmf]', body).forEach((b) => b.onclick = async () => {
      const f = S.folders.find((x) => x.id === b.dataset.rmf);
      if (!await confirmBox(f.remote ? 'Remove server?' : 'Remove folder?', f.remote ? 'This removes "' + f.name + '" and its saved password or key from this phone. Nothing on the server changes.' : 'This only removes "' + f.name + '" from the list and releases access. Your files are not deleted.', 'Remove')) return;
      try { if (f.remote) { await closeServer(f.id); await dropSecret(f.id); } else await fs.releaseFolder(f.uri); } catch (e) { /* ignore */ }
      S.folders = S.folders.filter((x) => x.id !== f.id); await A.saveFolders(S.folders);
      if (S.folder && S.folder.id === f.id) { S.folder = null; if (S.chat) S.chat.folderId = null; drawCtx(); }
      draw();
    });
  };
  draw();
}

/** Per-folder check that runs after the agent changes a file (for example npm run lint). */
function openChecks(f) {
  if (!f) return;
  const body = sheet('Checks after edits', { back: openProjects });
  const ck = f.checks || { on: false, cmd: '', glob: '' };
  const needTerm = !f.remote && !(S.settings && S.settings.termux);
  body.innerHTML = '<div class="note" style="text-align:left;margin-top:0">Runs after I change a file in <b>' + esc(f.name) + '</b>. If it fails, I see the errors right away and fix them. A passing check shows as one line.</div>' +
    '<label class="gr" style="border:0"><input type="checkbox" class="cb" id="ckOn"' + (ck.on ? ' checked' : '') + '><span>Run a check after edits</span></label>' +
    '<label class="field"><span>Command</span><input id="ckCmd" value="' + esc(ck.cmd || '') + '" placeholder="npm run lint" autocapitalize="off" autocomplete="off" spellcheck="false"></label>' +
    '<label class="field"><span>Files</span><input id="ckGlob" value="' + esc(ck.glob || '') + '" placeholder="*.js, *.ts" autocapitalize="off" autocomplete="off" spellcheck="false"></label>' +
    '<div class="note" style="text-align:left">Only runs when a changed file matches Files (empty means every file). Use {files} in the command to pass the changed files. ' + (f.remote ? 'It runs on the server.' : needTerm ? 'It needs Terminal: turn it on in Settings.' : 'It runs in Termux.') + '</div>';
  const save = async () => { f.checks = { on: $('#ckOn').checked, cmd: $('#ckCmd').value.trim(), glob: $('#ckGlob').value.trim() }; await A.saveFolders(S.folders); };
  ['#ckOn', '#ckCmd', '#ckGlob'].forEach((q) => { $(q).onchange = save; });
  $('#ckCmd').oninput = () => { if ($('#ckCmd').value.trim() && !$('#ckOn').checked) { $('#ckOn').checked = true; } };
}

/** Open any folder by typing its path. The path is checked as you type, and nothing is opened until it exists. */
async function openByPath() {
  const body = sheet('Open by path', { back: openProjects });
  const st = await AllFiles.status();
  const ok = !!st.granted || !!st.web;
  body.innerHTML = '<p class="note" style="text-align:left;margin-top:0">Type or paste the full path of a folder on this phone, for example <code>/storage/emulated/0/Projects/my-app</code>. It must exist before it can be opened.</p>' +
    '<input id="opPath" class="inp" type="text" inputmode="url" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="/storage/emulated/0/..." style="width:100%;font:14px ui-monospace,Menlo,monospace">' +
    '<div id="opMsg" class="opmsg"></div>' +
    (ok ? '' : '<button id="opAllow" class="btn" style="width:100%;margin-top:8px">' + ICON('shield') + '<span class="lbl">' + (st.legacy ? 'Allow storage access' : 'Allow all files access') + '</span></button>') +
    '<button id="opGo" class="btn primary" style="width:100%;margin-top:10px">' + ICON('folder') + '<span class="lbl">Check and open</span></button>';
  const inp = $('#opPath'); const msg = $('#opMsg'); let found = null; let seq = 0;
  const show = (kind, text) => { msg.className = 'opmsg ' + kind; msg.textContent = text; };
  const check = async () => {
    const v = inp.value.trim(); const my = ++seq; found = null;
    if (!v) { show('', ''); return null; }
    if (!ok) { show('err', st.legacy ? 'Allow storage access first.' : 'Turn on "All files access" first.'); return null; }
    show('', 'Checking...');
    try {
      const r = await fs.openPath(v); if (my !== seq) return null;
      found = r; show('good', 'Folder found \u00b7 ' + r.items + ' item' + (r.items === 1 ? '' : 's') + (r.writable ? '' : ' \u00b7 read only') + (r.full && r.full !== v ? '\n' + r.full : '')); return r;
    } catch (e) { if (my === seq) show('err', (e && e.message) || 'Could not check this path.'); return null; }
  };
  let t = null; inp.oninput = () => { clearTimeout(t); t = setTimeout(check, 400); };
  if ($('#opAllow')) $('#opAllow').onclick = () => askAllFiles(() => openByPath());
  const go = async () => {
    const r = found || await check(); if (!r) { if (!msg.textContent) show('err', 'Type a folder path.'); return; }
    if (r.root && !await confirmBox('Open the whole storage?', 'This gives the agent your entire shared storage, every folder on the phone. Every change still asks you first. A single project folder is safer.', 'Open anyway')) return;
    try {
      let f = S.folders.find((x) => x.uri === r.uri);
      if (!f) { f = { id: uid(), name: r.name || 'Folder', uri: r.uri }; S.folders.push(f); await A.saveFolders(S.folders); }
      D.log('info', 'Opened folder by path');
      await applyFolder(f);
    } catch (e) { show('err', (e && e.message) || 'Could not open the folder'); }
  };
  $('#opGo').onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  setTimeout(() => inp.focus(), 150);
}

// ------------------------------------------------------------ servers (SSH and SFTP)
/** Add or edit a server: test the connection first, save only when it works, then use it in this chat. */
async function openServerForm(edit) {
  const body = sheet(edit ? 'Edit server' : 'Connect a server', { back: openProjects });
  const old = edit ? await getSecret(edit.id) : {};
  let auth = edit ? edit.auth : 'password';
  const v = (q) => ($(q).value || '').trim();
  body.innerHTML =
    '<div class="field"><span>Name</span><input id="svName" placeholder="My VPS" autocomplete="off" value="' + esc(edit ? edit.name : '') + '"></div>' +
    '<div class="field"><span>Host and port</span><div style="display:flex;gap:8px"><input id="svHost" style="flex:1" type="text" inputmode="url" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="vps.example.com" value="' + esc(edit ? edit.host : '') + '"><input id="svPort" style="width:84px" inputmode="numeric" autocomplete="off" value="' + esc(edit ? edit.port : 22) + '"></div></div>' +
    '<div class="field"><span>User</span><input id="svUser" type="text" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="deploy" value="' + esc(edit ? edit.user : '') + '"></div>' +
    '<div class="field"><span>Sign in with</span><div class="seg" id="svAuth"><button type="button" class="btn sm" data-v="password"><span class="lbl">Password</span></button><button type="button" class="btn sm" data-v="key"><span class="lbl">Key</span></button></div></div>' +
    '<div class="field" id="svPassBox"><span>Password</span><input id="svPass" type="password" autocomplete="off" placeholder="' + (edit && old.password ? 'Saved. Leave empty to keep it.' : '') + '"></div>' +
    '<div class="field" id="svKeyBox"><span>Private key (RSA or ECDSA)</span><textarea id="svKey" class="keybox" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="' + (edit && old.key ? 'Saved. Leave empty to keep it.' : '-----BEGIN OPENSSH PRIVATE KEY-----') + '"></textarea>' +
    '<button id="svKeyFile" type="button" class="btn sm" style="margin-top:8px"><span class="lbl">Choose key file</span></button>' +
    '<div class="field" style="margin-top:12px"><span>Passphrase, if the key has one</span><input id="svPhrase" type="password" autocomplete="off"></div></div>' +
    '<div class="field"><span>Start folder</span><input id="svRoot" type="text" inputmode="url" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="/var/www/site" value="' + esc(edit ? edit.root : '/') + '"></div>' +
    '<div class="note" style="text-align:left;margin-top:0">File changes stay inside the start folder. Commands run with the permissions of this user, and each one asks first. The password or key stays on this phone, in secure storage.</div>' +
    '<div id="svOut"></div><button id="svGo" class="btn primary" style="width:100%;margin-top:8px"><span class="lbl">Test and connect</span></button>';
  const showAuth = () => { $$('#svAuth .btn', body).forEach((b) => b.classList.toggle('on', b.dataset.v === auth)); $('#svPassBox').classList.toggle('hidden', auth !== 'password'); $('#svKeyBox').classList.toggle('hidden', auth !== 'key'); };
  $$('#svAuth .btn', body).forEach((b) => b.onclick = () => { auth = b.dataset.v; showAuth(); });
  showAuth();
  $('#svKeyFile').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.style.display = 'none'; document.body.appendChild(inp);
    inp.onchange = async () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return; if (f.size > 20000) { toast('That file is too large to be a key.', { kind: 'warn' }); return; } $('#svKey').value = await f.text(); };
    inp.addEventListener('cancel', () => inp.remove()); inp.click();
  };
  const out = $('#svOut'); const go = $('#svGo');
  const say = (kind, text) => { out.innerHTML = text ? '<div class="opmsg ' + kind + '">' + esc(text) + '</div>' : ''; };
  let result = null; let profile = null; let secret = null;
  const useIt = async () => {
    const id = profile.id;
    await saveSecret(id, secret);
    await closeServer(id);
    const keep = edit ? S.folders.find((x) => x.id === id) : null;
    const f = { ...remoteFolderOf(profile), used: Date.now() };
    if (keep && keep.used) f.used = Date.now();
    S.folders = S.folders.filter((x) => x.id !== id).concat([f]); await A.saveFolders(S.folders);
    rememberServer(f);
    if (S.folder && S.folder.id === id) S.folder = f;
    D.log('info', 'Server saved');
    await applyFolder(f);
  };
  go.onclick = async () => {
    if (result) { go.disabled = true; try { await useIt(); } catch (e) { go.disabled = false; say('err', (e && e.message) || 'Could not save the server.'); } return; }
    const host = v('#svHost'); const user = v('#svUser'); let root = v('#svRoot') || '/'; const port = parseInt(v('#svPort'), 10) || 22;
    if (!host) { say('err', 'Enter the host, for example vps.example.com.'); return; }
    if (!user) { say('err', 'Enter the user name.'); return; }
    if (port < 1 || port > 65535) { say('err', 'The port must be between 1 and 65535.'); return; }
    if (!root.startsWith('/')) root = '/' + root;
    secret = auth === 'password' ? { password: $('#svPass').value || old.password || '' } : { key: $('#svKey').value.trim() || old.key || '', passphrase: $('#svPhrase').value || (!$('#svKey').value.trim() ? old.passphrase : '') || '' };
    if (auth === 'password' && !secret.password) { say('err', 'Enter the password.'); return; }
    if (auth === 'key' && !secret.key) { say('err', 'Paste the private key or choose the key file.'); return; }
    profile = { id: edit ? edit.id : 'srv-' + uid(), name: v('#svName') || host, host, port, user, auth, root };
    go.disabled = true; say('', 'Connecting...');
    try {
      const r = await testServer(profile, secret);
      if (!r.rootFound || !r.rootIsDir) { say('err', 'Signed in, but the folder ' + root + ' was not found on the server. Check the start folder.'); go.disabled = false; return; }
      profile.root = r.root || root; profile.fingerprint = r.fingerprint;
      result = r;
      out.innerHTML = '<div class="sv-rows">' + ['Reached ' + host, 'Signed in as ' + user, 'Folder ' + profile.root + ' found'].map((t) => '<div class="sv-row">' + ICON('check') + '<span>' + esc(t) + '</span></div>').join('') + '</div><div class="sv-fp">Server key ' + esc(String(r.fingerprint || '').slice(0, 47)) + '</div>';
      go.firstElementChild.textContent = 'Use in this chat'; go.disabled = false; go.scrollIntoView({ block: 'end', behavior: 'smooth' });
      $$('input,textarea,#svAuth .btn,#svKeyFile', body).forEach((x) => { x.addEventListener('input', () => { result = null; go.firstElementChild.textContent = 'Test and connect'; }); });
    } catch (e) { say('err', (e && e.message) || 'Could not connect.'); go.disabled = false; }
  };
}

/** A progress card for an upload or download. Returns { set(done, total), signal }. */
function xferCard(body, name) {
  const ac = new AbortController();
  body.innerHTML = '<div class="xfer"><div class="t" style="font-size:14px;overflow-wrap:anywhere">' + esc(name) + '</div><div class="bar"><div id="xBar"></div></div><div class="row2"><span id="xTxt">Starting...</span><button id="xCancel" class="btn sm" type="button"><span class="lbl">Cancel</span></button></div></div>';
  $('#xCancel').onclick = () => { ac.abort(); $('#xCancel').disabled = true; };
  return { signal: ac.signal, set: (d, t) => { const b = $('#xBar'); if (b) b.style.width = (t ? Math.min(100, Math.round(d * 100 / t)) : 0) + '%'; const x = $('#xTxt'); if (x) x.textContent = fmtBytes(d) + ' of ' + fmtBytes(t); } };
}
const XFER_MAX = 300 * 1048576;
async function downloadFromServer(p, back) {
  const fo = S.folder; const name = baseOf(p);
  const st = await fs.stat(fo.uri, p).catch(() => null); const size = (st && st.size) || 0;
  if (size > XFER_MAX) { toast(name + ' is too large to download here (limit ' + fmtBytes(XFER_MAX) + '). Zip a part of it on the server first.', { kind: 'warn' }); return; }
  if (size > BIG_FILE && !await confirmBox('Download ' + fmtBytes(size) + '?', 'This can take a while and uses your mobile data.', 'Download')) return;
  const x = xferCard(sheet(name, { back }), name);
  try {
    const bytes = await remoteRead(fo.uri, p, { signal: x.signal, onProgress: x.set });
    await saveBytes(name, bytes, 'application/octet-stream');
  } catch (e) { if (x.signal.aborted) toast('Download cancelled'); else toast((e && e.message) || 'Download failed', { kind: 'err' }); }
  back();
}
function uploadToServer(dir) {
  const fo = S.folder; const back = () => openFiles(dir);
  const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.style.display = 'none'; document.body.appendChild(inp);
  inp.addEventListener('cancel', () => inp.remove());
  inp.onchange = async () => {
    const list = Array.from(inp.files || []); inp.remove(); if (!list.length) return;
    const done = [];
    for (const f of list) {
      const dest = (dir ? dir + '/' : '') + f.name;
      if (f.size > XFER_MAX) { toast(f.name + ' is too large to upload from here (limit ' + fmtBytes(XFER_MAX) + ').', { kind: 'warn' }); continue; }
      if (f.size > BIG_FILE && !await confirmBox('Upload ' + fmtBytes(f.size) + '?', 'This can take a while and uses your mobile data.', 'Upload')) continue;
      const st = await fs.stat(fo.uri, dest).catch(() => null);
      if (st && st.exists && !await confirmBox('Replace "' + f.name + '"?', 'A file with this name is already on the server. The old one is replaced and cannot be restored from the app.', 'Replace')) continue;
      const x = xferCard(sheet('Upload', { back }), f.name);
      try { await remoteWrite(fo.uri, dest, new Uint8Array(await f.arrayBuffer()), { signal: x.signal, onProgress: x.set }); done.push(f.name); }
      catch (e) { if (x.signal.aborted) { toast('Upload cancelled'); break; } toast((e && e.message) || 'Upload failed', { kind: 'err' }); break; }
    }
    if (done.length) toast('Uploaded ' + (done.length === 1 ? done[0] : done.length + ' files'));
    back();
  };
  inp.click();
}

// ------------------------------------------------------------ HTML preview
const pvState = { name: '', load: null, text: '' };
function closePreview() { const o = $('#pv'); if (o) o.remove(); pvState.load = null; }
/** Full-screen preview of a page in a closed box. load() returns { html, notes }; text is the source used for "Save a copy". */
async function openPreview(name, first, text) { return showPreview(name, async () => first, text); }
async function showPreview(name, load, text) {
  closePreview();
  const o = document.createElement('div'); o.id = 'pv'; o.className = 'pv';
  o.innerHTML = '<div class="pv-bar"><button class="icon-btn" id="pvX" aria-label="Close preview">' + ICON('x') + '</button><div class="pv-name">' + esc(name) + '</div><button class="icon-btn" id="pvR" aria-label="Reload">' + ICON('reload') + '</button><button class="icon-btn" id="pvS" aria-label="Save a copy">' + ICON('down') + '</button></div>' +
    '<div class="pv-body"><div class="pv-load">Loading...</div></div><div class="pv-foot" id="pvF"></div>';
  document.body.appendChild(o); pvState.name = name; pvState.load = load; pvState.text = text || '';
  $('#pvX').onclick = closePreview; $('#pvR').onclick = () => pvRender(); $('#pvS').onclick = async () => { if (pvState.text) await saveOut(pvState.name.split('/').pop(), pvState.text); };
  await pvRender();
}
async function pvRender() {
  const o = $('#pv'); if (!o || !pvState.load) return;
  const body = $('.pv-body', o);
  try {
    const r = await pvState.load(); if (!$('#pv')) return;
    body.innerHTML = ''; const fr = document.createElement('iframe');
    fr.className = 'pv-frame'; fr.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals'); fr.setAttribute('title', 'Page preview'); fr.setAttribute('referrerpolicy', 'no-referrer');
    fr.srcdoc = r.html; body.appendChild(fr);
    $('#pvF').innerHTML = '<div>The page runs in a closed box inside the app. Files and pictures on the web do not load.</div>' + (r.notes || []).map((n) => '<div class="pv-note">' + esc(n) + '</div>').join('');
  } catch (e) { body.innerHTML = '<div class="err" style="margin:16px">' + esc(e.message || 'Could not open the preview.') + '</div>'; }
}
/** Preview a project file: reads the page and the local files it uses from the folder. */
async function previewFile(p) {
  const folder = curF(); if (!folder) return; let src = '';
  try { const t = await fs.readText(folder.uri, p, 1500000); src = t.text || ''; } catch (e) { /* the loader reports it */ }
  await showPreview(p.split('/').pop(), () => bundleFromFolder(folder, p), src);
}


// ------------------------------------------------------------ Scratch: private files of a chat without a folder
async function drawScratch() {
  const b = $('#chipScratch'); if (!b) return;
  const chat = S.chat; const n = chat && !S.folder ? await scratchCount(chat.id).catch(() => 0) : 0;
  if (S.chat !== chat) return;
  b.classList.toggle('hidden', !n); if (n) $('#chipScratchLbl').textContent = 'Scratch · ' + n;
  const au = $('#chipAuto'); if (au) au.classList.toggle('hidden', !(S.folder || n)); // approvals matter in Scratch too
}
/** Small menu next to a tapped row. items: [{ a, label, icon, danger }]. */
/** Shortens a long file name in the middle, so the start and the extension both stay visible. Returns '' when the name is short. */
function midName(n, max) {
  n = String(n || ''); if (n.length <= max) return '';
  const ext = (n.match(/(\.[A-Za-z0-9]{1,6}){1,2}$/) || [''])[0];
  const tail = Math.max(10, Math.min(ext.length + 4, max - 8));
  return n.slice(0, max - 1 - tail) + '\u2026' + n.slice(n.length - tail);
}
function popMenu(anchor, items, pick, title) {
  closeRowMenu();
  const sc = document.createElement('div'); sc.id = 'rowScrim'; sc.className = 'rowscrim';
  sc.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); const mm = $('#rowMenu'); if (mm) mm.remove(); setTimeout(closeRowMenu, 450); });
  sc.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeRowMenu(); });
  document.body.appendChild(sc);
  const m = document.createElement('div'); m.id = 'rowMenu'; m.className = 'rowmenu';
  const shortT = title ? (midName(title, 24) || String(title)) : ''; // small name above the menu, always
  m.innerHTML = (shortT ? '<div class="rmt" title="' + esc(title) + '">' + esc(shortT) + '</div>' : '') + items.map((i) => '<button data-a="' + i.a + '"' + (i.danger ? ' class="danger"' : '') + '>' + ICON(i.icon) + '<span>' + i.label + '</span></button>').join('');
  document.body.appendChild(m);
  markMenuRow(anchor.closest('.row-item'), anchor.closest('.row-item') && anchor.closest('.row-item').parentElement);
  const r = anchor.getBoundingClientRect(); const mh = m.offsetHeight, mw = m.offsetWidth;
  m.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(window.innerHeight - mh - 8, r.bottom - 4 + mh > window.innerHeight - 8 ? r.top - mh : r.bottom - 4)) + 'px';
  m.onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; closeRowMenu(); pick(b.dataset.a); };
}
/** Saves bytes through the phone's share sheet, like a file card does; falls back to a folder pick or a browser download. */
async function saveBytes(name, bytes, mime) {
  const file = new File([bytes], name, { type: mime });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  if (isNative) {
    try {
      const f = await fs.pickFolder();
      await fs.writeBytes(f.uri, name, bytes);
      if (!S.folders.some((x) => x.uri === f.uri)) await fs.releaseFolder(f.uri).catch(() => {});
      toast('Saved ' + name + ' in ' + (f.name || 'the folder'));
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('Could not save the file: ' + ((e && e.message) || 'unknown error'), { kind: 'err' }); }
    return;
  }
  const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000); toast('Saving ' + name);
}
/** Files the viewer can show: pictures up to 8 MB, text and code up to 1 MB. Anything else gets no "Open" in its menu. */
const isImgName = (n) => /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(String(n || ''));
function canOpenFile(name, size) {
  const sz = Number(size) || 0;
  if (isImgName(name)) return sz > 0 && sz <= 8 * 1048576;
  return !BINARY_EXT.test(name) && sz <= 1048576;
}
/** The menu of a file row, the same in the phone folder, Scratch and a server. kind: 'local' | 'scratch' | 'server'. */
async function fileMenu(row, kind, p, size, reopen) {
  const nm = baseOf(p); const fo = curF(); if (!fo) return;
  const git = kind === 'local' && isGitInternal(p);
  const prot = kind !== 'server' && isSecretPath(p) && await protectionOn(); // renaming would make a secret file look ordinary
  const open = canOpenFile(nm, size);
  const items = [];
  if (open) items.push({ a: 'open', label: 'Open', icon: 'file' });
  if (kind !== 'server' && isHtmlName(nm)) items.push({ a: 'prev', label: 'Preview', icon: 'eye' });
  if (!git && !prot) items.push({ a: 'ren', label: 'Rename', icon: 'edit' });
  if (open && !isImgName(nm)) items.push({ a: 'copy', label: 'Copy', icon: 'copy' });
  if (kind === 'server') items.push({ a: 'dl', label: 'Download', icon: 'down' });
  if (!git) items.push({ a: 'del', label: 'Delete', icon: 'trash', danger: true });
  popMenu(row, items, async (a) => {
    if (a === 'open') { const b = sheet(p, { back: reopen }); openFileView(p, b); }
    else if (a === 'prev') previewFile(p);
    else if (a === 'dl') downloadFromServer(p, reopen);
    else if (a === 'ren') await renameFile(fo, p, reopen);
    else if (a === 'copy') {
      if (prot && !await confirmBox('Copy secrets?', 'This file holds secrets. Its text goes to the clipboard, where other apps can read it.', 'Copy')) return;
      try { const t = await fs.readText(fo.uri, p, 1048576); toast(t.binary ? 'This file is not text' : (await copyText(t.text)) ? 'Copied ' + nm : 'Could not copy', { kind: t.binary ? 'warn' : undefined, result: true }); } catch (e) { toast(e.message || 'Could not copy', { kind: 'err' }); }
    } else if (a === 'del') {
      const msg = kind === 'server' ? 'It is removed from the server and cannot be restored from the app.' : kind === 'scratch' ? 'The file is removed from Scratch. This cannot be undone.' : 'The file is removed from the folder. This cannot be undone from the app.';
      if (!await confirmBox('Delete "' + nm + '"?', msg, 'Delete')) return;
      try { await fs.remove(fo.uri, p); } catch (e) { toast((e && e.message) || 'Could not delete the file', { kind: 'err' }); }
      if (kind === 'scratch') drawScratch();
      reopen();
    }
  }, nm);
}
/** Asks for a new name and renames the file in its own folder. */
async function renameFile(fo, p, after) {
  const nm = baseOf(p); const dir = p.slice(0, p.length - nm.length);
  const v = await askText('Rename file', 'File name', nm, true);
  if (!v || v === nm) return;
  if (/[\\/]/.test(v) || v === '.' || v === '..') { toast('Use a file name only, without slashes.', { kind: 'warn' }); return; }
  try {
    const st = await fs.stat(fo.uri, dir + v);
    if (st && st.exists) { toast('"' + v + '" already exists here.', { kind: 'warn' }); return; }
    await fs.rename(fo.uri, p, dir + v);
    toast('Renamed to ' + v);
  } catch (e) { toast((e && e.message) || 'Could not rename the file', { kind: 'err' }); return; }
  after();
}
async function openScratch() {
  if (!S.chat || S.folder) return;
  const chat = S.chat; const body = sheet('Scratch');
  const draw = async () => {
    const files = (await scratchFiles(chat.id)).sort((a, b) => a.path.localeCompare(b.path));
    if (!files.length) { closeSheet(); drawScratch(); return; }
    const total = files.reduce((n, f) => n + f.size, 0);
    body.innerHTML = '<div class="note" style="text-align:left">Temporary files for this chat. Only you and this app can see them. ' + fmtBytes(total) + ' of ' + fmtBytes(SCRATCH_CAP) + ' used.</div>' +
      files.map((f) => '<div class="row-item" data-p="' + esc(f.path) + '" data-s="' + f.size + '"><div class="grow"><div class="t">' + esc(f.path) + '</div></div><div class="s">' + fmtBytes(f.size) + '</div></div>').join('') +
      '<div class="sc-acts"><button id="scMove" class="btn" type="button"><span class="lbl">Move to a folder</span></button><button id="scZip" class="btn" type="button"><span class="lbl">Download all (zip)</span></button><button id="scClear" class="btn danger" type="button"><span class="lbl">Clear this scratch</span></button></div>';
    $$('[data-p]', body).forEach((row) => row.onclick = () => fileMenu(row, 'scratch', row.dataset.p, row.dataset.s, openScratch));
    $('#scZip').onclick = async () => {
      try {
        if (!window.fflate) throw new Error('The zip engine did not load.');
        const z = {}; (await scratchFiles(chat.id)).forEach((f) => { z[f.path] = f.data; });
        await saveBytes('kdex-scratch.zip', window.fflate.zipSync(z), 'application/zip');
      } catch (e) { toast(e.message || 'Could not make the zip', { kind: 'err' }); }
    };
    $('#scClear').onclick = async () => {
      if (!await confirmBox('Clear this scratch?', files.length + ' file' + (files.length === 1 ? '' : 's') + ' will be deleted. The chat and its messages stay.', 'Clear')) return;
      await scratchClear(chat.id); closeSheet(); drawScratch(); toast('Scratch cleared');
    };
    $('#scMove').onclick = () => scratchMove(chat);
  };
  await draw();
}
/** Copies the Scratch files into a folder, then empties Scratch. A file whose name already exists is kept: the copy gets "-scratch" in its name. */
async function moveScratchInto(chat, fo) {
  const files = await scratchFiles(chat.id); let renamed = 0;
  for (const f of files) {
    let dest = f.path; const st = await fs.stat(fo.uri, dest).catch(() => null);
    if (st && st.exists) { dest = dest.replace(/(\.[^./]+)?$/, (m) => '-scratch' + (m || '')); renamed++; }
    await fs.writeBytes(fo.uri, dest, f.data);
  }
  await scratchClear(chat.id); return { n: files.length, renamed };
}
function movedToast(r, name) { toast('Moved ' + r.n + ' file' + (r.n === 1 ? '' : 's') + ' to ' + name + (r.renamed ? '. ' + r.renamed + ' renamed with "-scratch" because the name already existed' : ''), r.renamed ? { kind: 'warn' } : {}); }
/** "Move to a folder" in the Scratch sheet: pick a folder, copy the files, continue the chat there. */
async function scratchMove(chat) {
  let r; try { r = await fs.pickFolder(); } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast(e.message || 'Could not open the folder', { kind: 'err' }); return; }
  if (!r || !r.uri) return;
  const n = await scratchCount(chat.id); if (!n) return;
  const name = r.name || 'the folder';
  if (!await confirmBox('Move ' + n + ' file' + (n === 1 ? '' : 's') + '?', 'It is copied into "' + name + '" and removed from Scratch. This chat then works in that folder.', 'Move')) return;
  let fo = S.folders.find((x) => x.uri === r.uri);
  if (!fo) fo = { id: uid(), name: r.name || 'Folder', uri: r.uri };
  let res; try { res = await moveScratchInto(chat, fo); } catch (e) { toast('Could not copy: ' + (e.message || 'unknown error'), { kind: 'err' }); return; }
  if (!S.folders.some((x) => x.id === fo.id)) { S.folders.push(fo); await A.saveFolders(S.folders); }
  await applyFolder(fo); drawScratch(); movedToast(res, name);
}
/** A folder was just added to a chat that has Scratch files: offer to take them along. */
async function offerScratchMove(chat, fo, n) {
  const no = $('#dlgNo').firstElementChild; const was = no.textContent; no.textContent = 'Not now';
  const ok = await confirmBox('Move ' + n + ' Scratch file' + (n === 1 ? '' : 's') + '?', 'This chat now works in "' + fo.name + '". Copy the Scratch files into it so the agent can use them.', 'Move');
  no.textContent = was; if (!ok || S.chat !== chat) return;
  try { const res = await moveScratchInto(chat, fo); drawScratch(); movedToast(res, fo.name); } catch (e) { toast('Could not copy: ' + (e.message || 'unknown error'), { kind: 'err' }); }
}
async function openFiles(path = '') {
  if (!S.folder) return;
  const body = sheet(S.folder.name + (path ? ' / ' + path : ''), { back: path ? () => openFiles(path.split('/').slice(0, -1).join('/')) : null });
  body.innerHTML = '<div class="note">Loading...</div>';
  try {
    const es = (await fs.list(S.folder.uri, path)).sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    body.innerHTML = (S.folder.remote ? '<button id="rfUp" class="btn" style="width:100%;margin-bottom:8px">' + ICON('upload') + '<span class="lbl">Upload a file...</span></button>' : '') + (es.length ? es.map((e) => '<div class="row-item" data-p="' + esc(e.path) + '" data-d="' + (e.isDir ? 1 : 0) + '" data-s="' + (e.size || 0) + '">' + ICON(e.isDir ? 'folder' : 'file') + '<div class="grow"><div class="t">' + esc(e.name) + '</div>' + (e.isDir ? '' : '<div class="s">' + fmtBytes(e.size) + '</div>') + '</div>' + (!e.isDir && isHtmlName(e.name) ? '<button class="icon-btn" data-pv="' + esc(e.path) + '" aria-label="Preview ' + esc(e.name) + '">' + ICON('eye') + '</button>' : '') + '</div>').join('') : '<div class="note">This folder is empty</div>');
    if ($('#rfUp')) $('#rfUp').onclick = () => uploadToServer(path);
    $$('[data-p]', body).forEach((r) => r.onclick = async (ev) => {
      const pv = ev.target.closest('[data-pv]'); if (pv) { ev.stopPropagation(); previewFile(pv.dataset.pv); return; }
      if (r.dataset.d === '1') return openFiles(r.dataset.p);
      fileMenu(r, S.folder.remote ? 'server' : 'local', r.dataset.p, r.dataset.s, () => openFiles(path));
    });
  } catch (e) { body.innerHTML = '<div class="err">' + esc(e.message || 'Could not read the folder') + '</div>'; }
}

/** Read-only file viewer: line numbers, syntax colours, copy. Secret files stay hidden. */
async function openFileView(p, body) {
  body.innerHTML = '<div class="note">Loading...</div>';
  const notText = (size) => { body.innerHTML = '<div class="nofile">' + ICON('file') + '<div class="t">' + esc(baseOf(p)) + '</div><div class="s">' + (size ? fmtBytes(size) + ' \u00b7 ' : '') + 'Not a text or code file</div><div class="s">It cannot be shown here. Open it with another app on your phone.</div></div>'; };
  try {
    if (/\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(p)) {
      let sz = 0; try { sz = ((await fs.stat(curF().uri, p)) || {}).size || 0; } catch (e) { /* ignore */ }
      if (sz > 0 && sz <= 8 * 1048576) {
        const bytes = await fs.readBytes(curF().uri, p);
        const ext = p.split('.').pop().toLowerCase(); const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' }[ext];
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        body.innerHTML = '<div class="imgview"><img alt="' + esc(baseOf(p)) + '" src="' + url + '"><div class="s"><span id="imgDim"></span>' + fmtBytes(sz) + '</div></div>';
        const im = body.querySelector('img'); im.onload = () => { const d = $('#imgDim'); if (d) d.textContent = im.naturalWidth + ' \u00d7 ' + im.naturalHeight + ' \u00b7 '; };
        im.onerror = () => notText(sz);
        return;
      }
    }
    if (BINARY_EXT.test(p)) { let sz = 0; try { sz = ((await fs.stat(curF().uri, p)) || {}).size || 0; } catch (e) { /* ignore */ } notText(sz); return; }
    const t = await fs.readText(curF().uri, p, 200000);
    const head = String(t.text || '').slice(0, 4000);
    if (t.binary || head.indexOf('\u0000') >= 0 || ((head.match(/\uFFFD/g) || []).length > 3)) { notText(t.size); return; }
    const hide = isSecretPath(p) && await protectionOn();
    const text = hide ? (isEnvLike(p) ? maskEnv(t.text) : '<hidden>') : t.text;
    const n = text.replace(/\n$/, '').split('\n').length;
    const gut = Array.from({ length: n }, (_, k) => k + 1).join('\n');
    const lang = langOf(p);
    body.innerHTML = '<div class="fv-bar"><span class="fv-meta">' + fmtBytes(t.size != null ? t.size : text.length) + ' · ' + n + ' line' + (n === 1 ? '' : 's') + (lang ? ' · ' + esc(lang) : '') + '</span>' + (isHtmlName(p) && !hide ? '<button id="fvPrev" class="mini" type="button">' + ICON('eye') + '<span class="lbl">Preview</span></button>' : '') + '<button id="fvCopy" class="mini" type="button"><span class="lbl">Copy</span></button></div>' +
      (hide ? '<div class="note" style="text-align:left">Protected file. Its values are hidden here and from the agent.</div>' : '') +
      '<div class="fv"><pre class="gut" aria-hidden="true">' + gut + '</pre><pre class="src"><code>' + (hide ? esc(text) : highlight(text, p)) + '</code></pre></div>' +
      (t.truncated || t.size > 200000 ? '<div class="note">Showing the first ' + fmtBytes(Math.min(200000, t.size)) + ' of ' + fmtBytes(t.size) + '.</div>' : '');
    if ($('#fvPrev')) $('#fvPrev').onclick = () => previewFile(p);
    $('#fvCopy').onclick = async () => { const ok = await copyText(text); $('#fvCopy').firstElementChild.textContent = ok ? 'Copied' : 'Failed'; setTimeout(() => { const b = $('#fvCopy'); if (b) b.firstElementChild.textContent = 'Copy'; }, 1400); };
  } catch (e) { body.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; }
}

const OPS = { move_file: ['edit', 'Moved', 'Undo'], create: ['plus', 'Created', 'Delete'], edit: ['edit', 'Edited', 'Undo'], overwrite: ['edit', 'Replaced', 'Undo'], delete: ['trash', 'Deleted', 'Restore'] };
/** Everything the agent changed in this chat, with one-tap Undo or Restore. Tap a row to see what changed. */
async function openChanges() {
  if (!S.chat) return;
  const body = sheet('Changes');
  const draw = async () => {
    const all = (await db.byIndex('backups', 'chatId', S.chat.id)).sort((a, b) => b.id - a.id);
    const live = all.filter((b) => !b.undone);
    const row = (b) => {
      const o = OPS[b.op] || OPS.edit;
      return '<div class="hrow' + (b.undone ? ' gone' : '') + '"><span class="hdot ' + (b.op === 'delete' ? 'del' : b.op === 'create' ? 'add' : '') + '">' + ICON(o[0]) + '</span>' +
        '<div class="grow" data-v="' + b.id + '"><div class="t">' + esc(baseOf(b.path)) + '</div><div class="s">' + (dirOf(b.path) ? esc(dirOf(b.path)) + ' \u00b7 ' : '') + (b.undone ? 'Undone' : o[1]) + ' \u00b7 ' + ago(b.at) + '</div></div>' +
        (b.undone ? '' : '<button class="btn sm chgbtn" data-u="' + b.id + '">' + ICON('undo') + '<span class="lbl">' + o[2] + '</span></button>') + '</div>';
    };
    body.innerHTML = (live.length > 1 ? '<button id="undoAll" class="btn danger" style="width:100%;margin-bottom:10px">' + ICON('undo') + '<span class="lbl">Undo all ' + live.length + ' changes</span></button>' : '') +
      (all.length ? all.map(row).join('') : '<div class="note">No changes in this chat yet. Files the agent edits, creates or deletes appear here.</div>') +
      '<div class="safe">' + ICON('lock') + '<span>A backup is saved before every change.</span></div>';
    $$('[data-u]', body).forEach((b) => b.onclick = async () => { await undoOne(Number(b.dataset.u)); draw(); });
    $$('[data-v]', body).forEach((r) => r.onclick = () => openChangeDiff(Number(r.dataset.v)));
    if ($('#undoAll')) $('#undoAll').onclick = async () => {
      if (!await confirmBox('Undo all changes?', 'Every change from this chat is rolled back, newest first.', 'Undo all')) return;
      for (const b of live) await undoOne(b.id); draw();
    };
  };
  draw();
}
/** What one change did: the saved copy from before against the file as it is now. */
async function openChangeDiff(id) {
  const bk = await db.get('backups', id); if (!bk) return;
  const body = sheet(bk.path, { back: openChanges });
  body.innerHTML = '<div class="busy"><span class="spin"></span>Loading...</div>';
  try {
    const f = folderFor(bk.folderId);
    if (isSecretPath(bk.path) && await protectionOn()) { body.innerHTML = '<div class="note" style="text-align:left">Protected file. Its contents are hidden here and from the agent.</div>'; return; }
    let now = ''; try { const r = await fs.readText(f.uri, bk.path, 1048576); now = r.binary ? '' : r.text; } catch (e) { now = ''; }
    body.innerHTML = diffHtml(bk.existed ? bk.content : '', bk.op === 'delete' ? '' : now);
  } catch (e) { body.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; }
}
async function undoOne(id) {
  try { const bk = await db.get('backups', id); const bf = bk && folderFor(bk.folderId); if (!bf) throw new Error('The folder of this change is no longer available.'); await A.undoChange(id, bf); toast('Undone'); } catch (e) { toast(e.message || 'Could not undo'); }
  updateChangesChip();
  const msgs = await db.byIndex('messages', 'chatId', S.chat.id);
  msgs.filter((m) => m.backupId === id).forEach((m) => { m.status = 'undone'; m.content += ' (undone by the user)'; db.put('messages', m); renderMsg(m); });
}


// ------------------------------------------------------------ Settings > Cleanup
const KEEP_MS = 30 * 86400000;
/** What takes space on the phone, and what the safe clean-up would free. */
async function storageStats() {
  const now = Date.now(); const chatIds = new Set((await db.all('chats')).map((c) => c.id));
  let backups = 0, oldBackups = []; let pics = 0, picN = 0;
  for (const b of await db.all('backups')) { const n = String(b.content || '').length; backups += n; if (now - (b.at || 0) > KEEP_MS) oldBackups.push({ id: b.id, n }); }
  for (const m of await db.all('messages')) for (const i of (m.images || [])) { pics += Math.round(String(i.data || '').length * 0.75); picN++; }
  let sc = 0; const oldScratch = [];
  for (const u of await scratchUsage()) { sc += u.bytes; if (!chatIds.has(u.chatId) || now - u.newest > KEEP_MS) oldScratch.push(u); }
  const log = JSON.stringify(await D.entries()).length;
  const oldB = oldBackups.reduce((n, x) => n + x.n, 0), oldS = oldScratch.reduce((n, x) => n + x.bytes, 0);
  return { used: backups + pics + sc + log, free: oldB + oldS + log, backups, oldBackups, oldB, pics, picN, sc, oldScratch, oldS, log };
}
function cleanupInit() {
  const fill = async () => {
    const st = await storageStats(); if (!$('#clUsed')) return st;
    $('#clUsed').textContent = fmtBytes(st.used); $('#clFree').textContent = fmtBytes(st.free); return st;
  };
  fill().catch(() => {});
  $('#clFreeBtn').onclick = async () => {
    const st = await storageStats();
    if (!st.free) { toast('Nothing to clear'); return; }
    const lines = []; if (st.oldBackups.length) lines.push('undo backups older than 30 days (' + fmtBytes(st.oldB) + ')'); if (st.log > 2) lines.push('the diagnostics log (' + fmtBytes(st.log) + ')'); if (st.oldScratch.length) lines.push('Scratch files of chats not used for 30 days (' + fmtBytes(st.oldS) + ')');
    if (!await confirmBox('Free up ' + fmtBytes(st.free) + '?', 'This deletes ' + lines.join(', ') + '. Changes older than 30 days can no longer be undone. Chats, keys and settings are not touched.', 'Free up')) return;
    for (const b of st.oldBackups) await db.del('backups', b.id);
    await D.clear();
    for (const u of st.oldScratch) await scratchClear(u.chatId);
    drawScratch(); await fill(); toast('Freed ' + fmtBytes(st.free));
  };
  $('#clPics').onclick = async () => {
    const st = await storageStats();
    if (!st.picN) { toast('No pictures in your chats'); return; }
    if (!await confirmBox('Remove ' + st.picN + ' picture' + (st.picN === 1 ? '' : 's') + '?', 'Frees ' + fmtBytes(st.pics) + '. The text of every message stays, but the pictures are gone for good and the agent can no longer see them.', 'Remove')) return;
    for (const m of await db.all('messages')) if (m.images && m.images.length) { m.imagesRemoved = (m.imagesRemoved || 0) + m.images.length; delete m.images; await db.put('messages', m); }
    if (S.chat) { const id = S.chat.id; S.els.clear(); await openChat(id); openSettings(); }
    toast('Removed ' + st.picN + ' picture' + (st.picN === 1 ? '' : 's'));
  };
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
    '<label class="field"><span>Max steps per message</span><input id="setSteps" type="number" min="1" max="150" value="' + st.maxSteps + '"><small>Stops runaway tool loops. Raise it for big reviews or builds (try 60 or more); tap Continue if it still stops.</small></label>' +
    '<label class="field"><span>Max reply length</span><input id="setOut" type="number" min="1000" max="64000" step="1000" value="' + (st.maxOut || 32000) + '"><small>Longest single reply, in tokens. You only pay for what the model actually writes. If a model allows less, the app lowers it by itself.</small></label>' +
    '<label class="field"><span>Custom instructions</span><textarea id="setInstr" placeholder="Tone, language, rules...">' + esc(st.instructions) + '</textarea></label>' +
    '<div class="h3">Images</div>' +
    '<label class="field"><span>Image provider</span><select id="setImgProv"><option value="">Off</option>' + S.providers.filter((p) => p.type !== 'anthropic').map((p) => '<option value="' + esc(p.id) + '"' + (p.id === st.imageProvider ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
    '<small id="imgOff" class="' + (st.imageProvider ? 'hidden' : '') + '" style="display:block;margin:-4px 0 8px">Pick a provider to let the agent create pictures.</small>' +
    '<div id="imgMore" class="' + (st.imageProvider ? '' : 'hidden') + '"><label class="field"><span>Image model</span><input id="setImgModel" value="' + esc(st.imageModel || '') + '" placeholder="gpt-image-1" autocapitalize="off" autocomplete="off"><small>Lets the agent create pictures such as thumbnails and backgrounds with your own key. It always asks first, because each picture uses credits. Examples: gpt-image-1 or dall-e-3 (OpenAI), imagen-3.0-generate-002 (Gemini). Anthropic models cannot make pictures.</small></label></div>' +
    '<div class="h3">Files</div>' +
    '<div class="field"><span>Approvals in new chats</span>' + seg('setAutoDef', [['0', 'Ask first'], ['1', 'Auto']], st.autoDefault ? '1' : '0') + '<small>Auto runs file changes, zip, commits and everyday commands without asking. Deleting data, sudo, force push, publishing and similar risky actions still ask. You can switch any chat with the chip above the messages. Backups and Undo always work.</small></div>' +
    '<div class="field"><span>Commands outside the start folder</span>' + seg('setOut', [['server', 'Servers'], ['all', 'Always'], ['off', 'Off']], st.outsideAsk || 'server') + '<small>Servers asks before a command goes outside the start folder, even in Auto. Always does that everywhere. Off never asks. Commands inside the folder are not affected.</small></div>' +
    '<div class="field"><span>Protect secret files</span>' + seg('setProt', [['1', 'On'], ['0', 'Off']], st.protectSecrets !== false ? '1' : '0') + '<small>.env files, keys and credentials stay hidden from the agent and the chat. The agent can still run your project with them. Secret values are removed from terminal output, and new secret files are never committed automatically.</small></div>' +
    '<div class="h3">Appearance</div>' + '<div class="field">' + seg('setTheme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], st.theme) + '</div>' +
    '<div class="field"><span>Notifications</span>' + seg('setQuiet', [['1', 'Quiet'], ['0', 'All']], st.quietToasts !== false ? '1' : '0') + '<small>Quiet shows only errors, warnings and results of long tasks like push, pull, clone and backup. All also shows short confirmations.</small></div>' +
    '<div class="h3">Memory</div><div class="field">' + seg('setLearn', [['1', 'Learn about me'], ['0', 'Off']], st.autoLearn ? '1' : '0') + '<small>Short notes saved on this phone and shared with the model so it knows you.</small></div>' +
    '<button id="memBtn" class="btn" style="width:100%"><span class="lbl">Saved notes</span><span class="lbl" id="memCount" style="color:var(--mut)"></span>' + ICON('right') + '</button>' +
    '<div class="h3">Data</div>' +
    '<button id="usageBtn" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Token usage</span></button>' +
    '<button id="expBtn" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Export this chat as text</span></button>' +
    '<button id="delAll" class="btn danger" style="width:100%;margin-bottom:8px"><span class="lbl">Delete all conversations</span></button>' +
    '<button id="bkOut" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Back up all data to a folder</span></button>' +
    '<button id="bkIn" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Restore from a backup</span></button>' +
    '<div class="h3">Terminal (Termux)</div><div class="field">' + seg('setTerm', [['0', 'Off'], ['1', 'On']], st.termux ? '1' : '0') + '<small>Lets the agent run shell commands in Termux after you approve each one. Advanced.</small></div><div id="termBox"></div>' +
    '<div class="h3">Fast file access</div><div id="afBox"></div>' +
    '<div class="h3">Git</div><button id="gitId" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Identity and access tokens</span></button>' +
    '<div class="h3">Cleanup</div><div class="kv"><span>Used by KDex Agent</span><span id="clUsed">...</span></div><div class="kv"><span>Can be cleared</span><span id="clFree">...</span></div><div class="note" style="text-align:left">Old backups, the log and unused scratch files. Chats and keys stay.</div><button id="clFreeBtn" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Free up space</span></button><button id="clPics" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Remove pictures from chats</span></button>' +
    '<div class="h3">Help</div><button id="diagBtn" class="btn" style="width:100%;margin-bottom:8px"><span class="lbl">Diagnostics log</span></button>' +
    '<div class="h3">About</div><div class="kv"><span>Version</span><span>' + APP_VERSION + '</span></div><div class="kv"><span>Storage</span><span>On this phone only</span></div><div class="kv"><span>Developer</span><span>Kamil Hussen (KDex)</span></div><div class="kv"><span>Source code</span><span><a class="link" href="' + REPO_URL + '" target="_blank" rel="noopener">GitHub</a></span></div><div class="kv"><span>Updates</span><span id="updState">Not checked</span></div>' +
    '<div id="updBox" style="margin-top:10px"></div><button id="licBtn" class="btn" style="width:100%;margin-top:8px"><span class="lbl">Licenses</span></button>';
  drawUpdate(body); $('#licBtn', body).onclick = openLicenses;
  const bindSeg = (id, fn) => $$('#' + id + ' .btn', body).forEach((b) => b.onclick = () => { $$('#' + id + ' .btn', body).forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); });
  bindSeg('setMode', (v) => { save({ mode: v }).then(() => drawRing()); }); bindSeg('setThink', (v) => save({ defaultThink: v }));
  bindSeg('setProt', (v) => save({ protectSecrets: v === '1' })); bindSeg('setOut', (v) => save({ outsideAsk: v })); bindSeg('setAutoDef', (v) => save({ autoDefault: v === '1' })); bindSeg('setLearn', (v) => save({ autoLearn: v === '1' }));
  const drawAF = async () => {
    const box = $('#afBox'); if (!box) return;
    const st2 = await AllFiles.status();
    box.innerHTML = '<div class="kv"><span>' + (st2.legacy ? 'Storage access' : 'All files access') + '</span><span>' + (st2.web ? 'Android only' : !st2.supported ? 'Not available' : st2.granted ? 'On' : 'Off') + '</span></div><div class="note" style="text-align:left">' + (st2.granted ? 'Files and Git use direct paths, like Termux does.' : st2.legacy ? 'Direct file access makes files and Git much faster. Android asks once; tap Allow.' : 'Direct file access makes files and Git much faster. You turn it on once in Android settings.') + '</div>' + (st2.supported && !st2.granted ? '<button id="afOn" class="btn primary" style="width:100%;margin-bottom:8px"><span class="lbl">Turn on fast access</span></button>' : '');
    if ($('#afOn')) $('#afOn').onclick = () => askAllFiles(drawAF);
  };
  drawAF();
  const rdTerm = () => drawTerm(rdTerm);
  bindSeg('setTerm', async (v) => { await save({ termux: v === '1' }); rdTerm(); updateTermChip(); });
  bindSeg('setTheme', (v) => { save({ theme: v }); applyTheme(); });
  bindSeg('setQuiet', (v) => save({ quietToasts: v === '1' }));
  $('#setModel').onchange = (e) => save({ defaultModel: e.target.value });
  $('#setImgProv').onchange = (e) => { save({ imageProvider: e.target.value }); $('#imgMore').classList.toggle('hidden', !e.target.value); $('#imgOff').classList.toggle('hidden', !!e.target.value); };
  $('#setImgModel').onchange = (e) => save({ imageModel: e.target.value.trim() });
  $('#setSteps').onchange = (e) => save({ maxSteps: Math.max(1, Math.min(150, Number(e.target.value) || 20)) });
  $('#setOut').onchange = (e) => save({ maxOut: Math.max(1000, Math.min(64000, Math.round(Number(e.target.value)) || 32000)) });
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
  const mem = async () => { const n = (await A.getMemory()).length; $('#memCount').textContent = n ? String(n) : ''; };
  rdTerm();
  mem();
  $('#memBtn').onclick = openMemory;
  $('#diagBtn').onclick = openDiagnostics; $('#usageBtn').onclick = openUsage; $('#expBtn').onclick = exportChat;
  $('#delAll').onclick = async () => {
    if (!await confirmBox('Delete all conversations?', 'Every chat except pinned ones, with its messages and change backups, is removed from this phone. Your folders, files, settings, memory notes and keys are not touched. This cannot be undone.', 'Delete all')) return;
    if (S.running) { stopRun(); await waitIdle(); }
    const keep = new Set((await db.all('chats')).filter((c) => c.pinned).map((c) => c.id));
    for (const row of await db.all('messages')) if (!keep.has(row.chatId)) await db.del('messages', row.id);
    for (const row of await db.all('backups')) if (!keep.has(row.chatId)) await db.del('backups', row.id);
    for (const row of await db.all('chats')) if (!keep.has(row.id)) await db.del('chats', row.id);
    for (const u of await scratchUsage()) if (!keep.has(u.chatId)) await scratchClear(u.chatId);
    for (const k of await db.all('kv')) if (String(k.key).startsWith('draft:') && !keep.has(String(k.key).slice(6))) await db.del('kv', k.key);
    if (!S.chat || !keep.has(S.chat.id)) { $('#input').value = ''; autoGrow(); }
    closeSheet(); await newChat(null); await loadChats(); toast(keep.size ? 'Conversations deleted (pinned kept)' : 'All conversations deleted');
  };
  $('#bkOut').onclick = () => exportBackup().catch((e) => toast(e.message, { kind: 'err' })); $('#bkIn').onclick = () => importBackup().catch((e) => toast(e.message, { kind: 'err' }));
  $('#gitId').onclick = () => openGitIdentity(openSettings);
  cleanupInit();
}
async function drawTerm(redraw) {
  {
    const box = $('#termBox'); if (!box) return;
    if (!S.settings.termux) { box.innerHTML = ''; return; }
    const stt = await Termux.status().catch(() => ({}));
    const path = S.folder ? await getTermuxPath(S.folder) : null;
    const custom = S.folder ? await hasCustomTermuxPath(S.folder) : false;
    box.innerHTML =
      '<div class="kv"><span>Termux app</span><span>' + (stt.installed ? 'installed' : (stt.web ? 'Android only' : 'not found')) + '</span></div>' +
      '<div class="kv"><span>Permission</span><span>' + (stt.granted ? 'granted' : 'not granted') + '</span></div>' +
      (S.folder ? (path
        ? '<div class="field"><span>Path in Termux</span><pre class="cmd wrap">' + esc(path).replace(/\//g, '/<wbr>') + '</pre><small>' + (custom ? 'Set by you' : 'Detected automatically') + ' \u00b7 <button id="tmPath" class="linkbtn" type="button">Edit</button>' + (custom ? ' \u00b7 <button id="tmReset" class="linkbtn" type="button">Reset</button>' : '') + '</small></div>'
        : '<div class="field"><span>Path in Termux</span><div class="ghint">Path not detected. Termux cannot find this folder on its own.</div><button id="tmPath" class="btn primary sm" type="button"><span class="lbl">Set path</span></button></div>')
        : '<div class="note">Open a project to see its Termux path.</div>') +
      '<div style="display:flex;gap:8px;margin:8px 0;flex-wrap:wrap">' + (stt.granted ? '' : '<button id="tmPerm" class="btn sm"><span class="lbl">Grant permission</span></button>') +
      '<button id="tmTest" class="btn sm"><span class="lbl">Test connection</span></button></div><div id="tmMsg"></div>' +
      '<div id="tmSteps"></div>';
    const SETUP = '<div class="card tmsetup"><div class="t">One-time setup</div>' +
      '<p>1. Install Termux from F-Droid or GitHub (not Google Play).</p>' +
      '<p>2. Open Termux and run these two commands, one after the other:</p>' +
      '<pre class="cmd">mkdir -p ~/.termux</pre>' +
      '<pre class="cmd">echo "allow-external-apps=true" &gt;&gt; ~/.termux/termux.properties</pre>' +
      '<p>Then close Termux completely and open it again.</p>' +
      '<p>3. Tap Grant permission here (Run commands in Termux environment).</p>' +
      '<p>4. Pick your project folder through Termux\'s own storage entry, or run this in Termux and pick a folder in shared storage:</p>' +
      '<pre class="cmd">termux-setup-storage</pre></div>';
    let verified = !!(await kvGet('termuxOk', false)) && !!stt.installed && !!stt.granted;
    const drawSteps = (show) => { $('#tmSteps').innerHTML = show ? SETUP + (verified ? '<button id="tmHide" class="linkbtn" type="button" style="margin:8px 0 0;padding:0">Hide setup steps</button>' : '') : '<button id="tmShow" class="linkbtn" type="button" style="margin:4px 0 0;padding:0">Show setup steps</button>'; if ($('#tmHide')) $('#tmHide').onclick = () => drawSteps(false); if ($('#tmShow')) $('#tmShow').onclick = () => drawSteps(true); };
    drawSteps(!verified);
    const msg = (h) => { $('#tmMsg').innerHTML = h; };
    if ($('#tmPerm')) $('#tmPerm').onclick = async () => { try { await Termux.permission(); } catch (e) { msg('<div class="err">' + esc(e.message) + '</div>'); } redraw(); };
    if ($('#tmTest')) $('#tmTest').onclick = async () => {
      msg('<div class="busy"><span class="spin"></span>Running a test command...</div>');
      try { const r = await Termux.run('echo ok; uname -m', undefined, 20000); await kvSet('termuxOk', true); verified = true; drawSteps(false); msg('<div class="ok">Works (exit ' + r.exitCode + '): ' + esc((r.stdout || '').trim().replace(/\n/g, ', ')) + '</div>'); }
      catch (e) { await kvSet('termuxOk', false); verified = false; drawSteps(true); msg('<div class="err">' + esc(e.message) + '</div>'); }
    };
    if ($('#tmReset')) $('#tmReset').onclick = async () => { await setTermuxPath(S.folder, ''); redraw(); };
    if ($('#tmPath')) $('#tmPath').onclick = async () => { const v = await askText('Path in Termux', '/data/data/com.termux/files/home/project', path || ''); if (v !== null) { await setTermuxPath(S.folder, v); redraw(); } };
  }
}
async function openTerminal() {
  const body = sheet('Terminal');
  const seg = (v) => '<div class="seg" id="tSeg">' + [['0', 'Off'], ['1', 'On']].map(([k, l]) => '<button type="button" class="btn sm' + (k === v ? ' on' : '') + '" data-v="' + k + '"><span class="lbl">' + l + '</span></button>').join('') + '</div>';
  const draw = () => {
    body.innerHTML = '<p class="note" style="text-align:left;margin-top:0">Let the agent run commands in Termux, inside this project, like on a computer. Every command asks for your approval first.</p>' +
      '<div class="field"><span>Terminal for the agent</span>' + seg(S.settings.termux ? '1' : '0') + '</div>' +
      '<div class="field"><span>Use my Git token in Termux</span><div class="seg" id="tTok">' + [['1', 'Allow'], ['0', 'Never']].map(([k, l]) => '<button type="button" class="btn sm' + ((S.settings.gitTokenTermux !== false ? '1' : '0') === k ? ' on' : '') + '" data-v="' + k + '"><span class="lbl">' + l + '</span></button>').join('') +
      '</div><small>Allow: when a git clone, pull, fetch or push runs in Termux, your saved token is lent to that one command. Never: Termux gets no token, so private repositories and pushes will fail. The token is never stored in Termux and the model never sees it.</small></div><div id="savedBox"></div><div id="termBox"></div>';
    $$('#tSeg .btn', body).forEach((b) => b.onclick = async () => { await save({ termux: b.dataset.v === '1' }); updateTermChip(); draw(); });
    $$('#tTok .btn', body).forEach((b) => b.onclick = async () => { await save({ gitTokenTermux: b.dataset.v === '1' }); draw(); });
    drawTerm(draw); drawSaved();
  };
  draw();
}
// Saved commands: your own shortcuts for this project. Run asks first, then runs in Termux without using the model.
const SC_KEY = (f) => 'saved-cmds:' + f.id;
const SECRETISH = /(token|passw(or)?d|secret|api[_-]?key)\s*[=:]\s*\S{6,}|\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{12,})\b/i;
async function drawSaved() {
  const box = $('#savedBox'); if (!box) return;
  if (!S.folder) { box.innerHTML = '<div class="h3">Saved commands</div><div class="note">Open a project to save commands for it.</div>'; return; }
  const list = await kvGet(SC_KEY(S.folder), []);
  box.innerHTML = '<div class="h3">Saved commands</div><p class="note" style="text-align:left;margin-top:0">One-tap shortcuts for this project. Run asks you first and does not use the model or any tokens. Do not put keys or passwords in a command.</p>' +
    (list.length ? list.map((c, i) => '<div class="scrow"><div class="sctx"><div class="scn">' + esc(c.name) + '</div><div class="scc">' + esc(c.cmd) + '</div></div><button class="btn sm" data-sc="run" data-i="' + i + '"><span class="lbl">Run</span></button><button class="icon-btn" data-sc="edit" data-i="' + i + '" aria-label="Edit">' + ICON('edit') + '</button><button class="icon-btn" data-sc="del" data-i="' + i + '" aria-label="Delete">' + ICON('trash') + '</button></div>').join('')
      : '<div class="ghint">Nothing saved yet. Examples: <code>npm test</code>, <code>git status</code>, or a server command like <code>ssh user@host "pm2 restart all"</code> (ssh needs openssh and your key set up in Termux).</div>') +
    '<div style="margin:10px 0"><button id="scAdd" class="btn sm">' + ICON('plus') + '<span class="lbl">Add command</span></button></div><div id="scOut"></div>';
  const save = async (l) => { await kvSet(SC_KEY(S.folder), l); drawSaved(); };
  const ask = async (name, cmd) => {
    const n = await askText('Name', 'Short name, for example Run tests', name || ''); if (n === null || !n.trim()) return null;
    const c = await askText('Command', 'The shell command to run', cmd || '', true); if (c === null || !c.trim()) return null;
    if (SECRETISH.test(c)) { toast('A saved command must not contain a key or password. Use an environment variable instead.', { kind: 'warn' }); return null; }
    return { name: n.trim().slice(0, 40), cmd: c.trim().slice(0, 500) };
  };
  $('#scAdd').onclick = async () => { const v = await ask(); if (v) { if (list.length >= 30) { toast('Up to 30 saved commands', { kind: 'warn' }); return; } list.push(v); await save(list); } };
  $$('[data-sc]', box).forEach((b) => b.onclick = async () => {
    const i = Number(b.dataset.i); const c = list[i]; if (!c) return;
    if (b.dataset.sc === 'del') { if (await confirmBox('Delete "' + c.name + '"?', c.cmd, 'Delete')) { list.splice(i, 1); await save(list); } return; }
    if (b.dataset.sc === 'edit') { const v = await ask(c.name, c.cmd); if (v) { list[i] = v; await save(list); } return; }
    if (!S.settings.termux) { toast('Turn the terminal on first (switch at the top)', { kind: 'warn' }); return; }
    const path = await getTermuxPath(S.folder);
    if (!path) { toast('The Termux path of this project is not set', { kind: 'warn' }); return; }
    const risky = isRiskyCommand(c.cmd);
    if (!await confirmBox('Run "' + c.name + '"?', c.cmd + '\n\nRuns in Termux in ' + path + '.' + (risky ? '\nWarning: this command can delete data, change the system or send data out.' : ''), 'Run')) return;
    const out = $('#scOut'); out.innerHTML = '<div class="busy"><span class="spin"></span>Running ' + esc(c.name) + '...</div>'; out.scrollIntoView({ block: 'nearest' });
    try {
      const r = await runTermux({ command: c.cmd }, S.folder);
      const ok = /Command succeeded\./.test(r); const code = /\[exit code (-?\d+)/.exec(r);
      const text = (await scrub(r, S.folder)).replace(/\n?\[exit code[^\]]*\][^\n]*$/, '').replace(/\n?\[hint\][\s\S]*$/, '').trim();
      out.innerHTML = '<div class="scst ' + (ok ? 'ok' : 'err') + '">' + ICON(ok ? 'check' : 'alert') + '<span class="scm">' + (ok ? 'Done: ' : 'Failed: ') + esc(c.name) + (!ok && code ? ' · exit ' + code[1] : '') + '</span>' + (text ? '<button class="linkbtn" data-sc-out="1" aria-expanded="false"><span class="lbl">Show output</span>' + ICON('chev') + '</button>' : '') + '</div>' +
        (text ? '<pre class="scpre hidden">' + esc(text.slice(-3000)) + '</pre>' : '') + (!ok && /^\s*(ssh|scp|rsync)\b/.test(c.cmd) ? '<div class="ghint">ssh needs openssh installed in Termux (pkg install openssh) and your key added there.</div>' : '');
      const tg = $('[data-sc-out]', out); if (tg) tg.onclick = () => { const p = $('.scpre', out); const open = p.classList.toggle('hidden') === false; tg.setAttribute('aria-expanded', open ? 'true' : 'false'); $('.lbl', tg).textContent = open ? 'Hide output' : 'Show output'; };
    } catch (e) { out.innerHTML = '<div class="err">' + esc(e.message || String(e)) + '</div>'; }
  });
}
function updateTermChip() {
  const l = $('#chipTermLbl'); if (l) l.textContent = S.settings.termux ? 'Terminal on' : 'Terminal';
  const a = $('#chipAuto'); if (a) { const on = !!(S.chat && S.chat.auto); a.classList.toggle('on', on); a.setAttribute('aria-pressed', on ? 'true' : 'false'); const u = a.querySelector('use'); if (u) u.setAttribute('href', on ? '#i-shield-check' : '#i-shield'); a.title = on ? 'Auto on: safe actions run without asking' : 'Auto off: asking before every action'; }
}
async function toggleAuto() {
  if (!S.chat) return;
  S.chat.auto = !S.chat.auto; await db.put('chats', S.chat); updateTermChip();
  if (S.chat.auto) { toast('Auto on: safe actions run without asking. Risky ones still ask.'); for (const [id, tm] of [...S.approvalTm.entries()]) { if (!(tm.plan && tm.plan.risky) && S.approvals.has(id)) decide(id, 'apply'); } }
  else toast('Auto off: asking before every action');
}
let saveChain = Promise.resolve();
/** Applies the change at once (so the UI never lags a tap behind), then writes it to storage in order. */
function save(p) {
  S.settings = { ...S.settings, ...p };
  saveChain = saveChain.then(() => A.saveSettings(p)).catch(() => {});
  return saveChain;
}

/** What the app did and what failed. Tokens and keys are masked, so the text is safe to share. */
async function openDiagnostics() {
  const body = sheet('Diagnostics log', { back: openSettings });
  const list = await D.entries();
  const info = { Version: APP_VERSION, Android: /Android ([\d.]+)/.exec(navigator.userAgent) ? /Android ([\d.]+)/.exec(navigator.userAgent)[1] : 'unknown', 'File access': (await AllFiles.status()).granted ? 'direct' : 'standard' };
  const dt = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  body.innerHTML = '<div class="row" style="display:flex;gap:8px;margin-bottom:12px"><button id="dgCopy" class="btn" style="flex:1"><span class="lbl">Copy log</span></button><button id="dgClear" class="btn danger" style="flex:1"><span class="lbl">Clear</span></button></div>' +
    (list.length ? '<div class="diag">' + list.slice(0, 120).map((e) => '<div class="dg ' + esc(e.k) + '"><span class="dt">' + esc(dt(e.t)) + '</span><span class="dm">' + esc(e.m) + '</span></div>').join('') + '</div>' : '<div class="note">Nothing logged yet. Errors and failed Git actions appear here.</div>') +
    '<div class="note" style="margin-top:12px;text-align:left">Keeps the last 7 days. Stays on this phone. Tokens and keys are masked before they are saved.</div>';
  $('#dgCopy').onclick = async () => { flashCopied($('#dgCopy'), await copyText(D.format(list, info))); };
  $('#dgClear').onclick = async () => { await D.clear(); openDiagnostics(); };
}
async function openMemory() {
  const body = sheet('Saved notes', { back: openSettings });
  body.innerHTML = '<div class="search" style="margin-top:0"><svg class="ic"><use href="#i-search"/></svg><input id="memFind" type="search" placeholder="Search notes" autocomplete="off"></div><div class="note" id="memHow" style="text-align:left;margin:4px 0 8px"></div><div id="memRows"></div>';
  const foot = $('#sheetFoot'); foot.classList.remove('hidden'); foot.innerHTML = '<button id="memAdd" class="btn" style="width:100%">' + ICON('plus') + '<span class="lbl">Add a note</span></button>';
  const draw = async () => {
    const all = await A.getMemory(); const q = $('#memFind').value.trim().toLowerCase();
    const list = q ? all.filter((m) => m.text.toLowerCase().includes(q)) : all;
    $('#memHow').textContent = !all.length ? 'No notes yet.' : q ? list.length + ' of ' + all.length + ' notes' : all.length + (all.length === 1 ? ' note' : ' notes');
    $('#memRows').innerHTML = list.map((m) => '<div class="row-item"><div class="grow s" style="white-space:normal;color:var(--fg)">' + esc(m.text) + '</div><button class="icon-btn" data-dm="' + m.id + '" aria-label="Delete note">' + ICON('x') + '</button></div>').join('') || (all.length ? '<div class="note">No note matches.</div>' : '');
    $$('[data-dm]', body).forEach((b) => b.onclick = async () => { await A.saveMemory((await A.getMemory()).filter((x) => x.id !== b.dataset.dm)); draw(); });
  };
  $('#memFind').oninput = draw;
  $('#memAdd').onclick = async () => { const v = await askText('Add a note', 'One short fact'); if (v && await A.addMemoryNote(v, 'manual')) { $('#memFind').value = ''; draw(); } };
  draw();
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
  if (redactPatterns(t) !== t && !await confirmBox('Copy chat?', 'This chat has what looks like a key or token. Its text goes to the clipboard, where other apps can read it.', 'Copy')) return;
  toast(await copyText(t) ? 'Chat copied to clipboard' : 'Could not copy');
}

// ------------------------------------------------------------ git UI
const pct = (p) => (p && p.phase ? p.phase + (p.total ? ' ' + Math.round((p.loaded / p.total) * 100) + '%' : '') : '');
const GS = { tab: 'changes', sel: new Set(), known: new Set(), keepSel: false, hist: 10, reuse: null };

const PHASES = { 'Analyzing workdir': 'Checking files', 'Updating workdir': 'Updating files', 'Counting objects': 'Counting objects', 'Compressing objects': 'Packing', 'Receiving objects': 'Downloading', 'Writing objects': 'Uploading', 'Resolving deltas': 'Finishing', 'Enumerating objects': 'Counting objects', 'Total': 'Finishing' };
const phaseOf = (p) => (p && p.phase ? (PHASES[p.phase] || p.phase) : '');
function busyLine(text, frac, onCancel) {
  const el = $('#gMsg'); if (!el) return;
  if (!text) { el.innerHTML = ''; return; }
  const w = frac == null ? 0 : Math.max(2, Math.min(100, Math.round(frac * 100)));
  el.innerHTML = '<div class="busy2"><div class="bl"><span class="spin"></span><span class="bt">' + esc(text) + '</span>' + (onCancel ? '<button class="linkbtn" id="gCancel">Cancel</button>' : '') + '</div><div class="bar' + (frac == null ? ' ind' : '') + '"><i' + (frac == null ? '' : ' style="width:' + w + '%"') + '></i></div></div>';
  if (onCancel) $('#gCancel').onclick = onCancel;
}
/** Turns a Git error into a title, a plain explanation and, where there is one, a button that fixes it. */
function explainGitError(text) {
  const t = String(text);
  if (/newer commits|Pull first/i.test(t)) return { title: 'Push rejected', body: 'The remote has newer commits. Pull them first, then push again.', fix: 'pull' };
  if (/token was rejected|needs an access token|Access denied/i.test(t)) return { title: /rejected/i.test(t) ? 'Token rejected' : /Access denied/i.test(t) ? 'Access denied' : 'Token needed', body: t, fix: 'token' };
  if (/No connection/i.test(t)) { const h = /No connection to ([\w-]+(?:\.[\w-]+)+)/i.exec(t); return { title: h ? 'No connection to ' + h[1] : 'No connection', body: 'Check the internet, then try again.', fix: 'retry' }; }
  if (/Merge conflict/i.test(t)) return { title: 'Merge conflict', body: t.replace(/^Merge conflict\.?\s*/i, '') || 'Some files changed in both places.' };
  if (/Local changes would be overwritten/i.test(t)) return { title: 'Local changes in the way', body: 'Commit or discard your changes first, then try again.' };
  if (/Push refused|Push was rejected|protected branch|secret/i.test(t)) { const m = /^(.{8,70}?[.:])\s+(.+)$/s.exec(t); return m ? { title: m[1].replace(/[.:]$/, ''), body: m[2] } : { title: 'Push refused', body: t }; }
  const m = /^(.{8,70}?[.!?])\s+(.+)$/s.exec(t);
  if (!m && t.length <= 60) return { title: t.replace(/[.]$/, ''), body: '' };
  return m ? { title: m[1].replace(/[.]$/, ''), body: m[2] } : { title: 'Git could not finish', body: t };
}
function errLine(text, opts = {}) {
  const el = $('#gMsg'); if (!el) return;
  if (!text) { el.innerHTML = ''; return; }
  const x = explainGitError(text);
  const fixBtn = x.fix === 'pull' ? '<button class="btn sm" data-fx="pull">' + ICON('down') + '<span class="lbl">Pull now</span></button>'
    : x.fix === 'retry' && opts.retry ? '<button class="btn sm" data-fx="retry">' + ICON('refresh') + '<span class="lbl">Retry</span></button>' : '';
  el.innerHTML = '<div class="gerr"><span class="gic">' + ICON('alert') + '</span><div class="gtx"><div class="gt1">' + esc(x.title) + '</div>' + (x.body ? '<div class="gt2">' + esc(midCut(x.body)).replace(/\n/g, '<br>') + '</div>' : '') +
    (fixBtn ? '<div class="erract">' + fixBtn + '</div>' : '') + '</div></div>';
  $$('[data-fx]', el).forEach((b) => b.onclick = () => {
    const f = S.folder; const k = b.dataset.fx;
    if (k === 'pull' && f) gitRun('Pulling', (pr, sg) => G.pull(f, { onProgress: pr, signal: sg }));
    else if (k === 'retry' && opts.retry) opts.retry();
  });
}
const LONG_GIT = new Set(['Pushing', 'Force pushing', 'Pulling', 'Merging']);
const DONE = { Fetching: 'Fetched', Pulling: 'Pulled', Pushing: 'Pushed', 'Force pushing': 'Force pushed', Committing: 'Committed', Discarding: 'Discarded', 'Creating branch': 'Branch created', 'Switching branch': 'Switched branch', Merging: 'Merged', 'Deleting branch': 'Branch deleted', 'Undoing commit': 'Commit undone', 'Saving remote': 'Remote saved', 'Switching to HTTPS': 'Remote switched to HTTPS' };
async function gitRun(label, fn, after, keep) {
  $$('#sheetBody .btn, #sheetBody .linkbtn, #sheetBody .icon-btn, #sheetBody .stg').forEach((b) => { b.disabled = true; });
  const t0 = Date.now(); const ac = new AbortController();
  const cancel = () => { ac.abort(); busyLine('Cancelling...'); };
  busyLine(label + '...', null, cancel);
  try {
    await fn((p) => { const ph = phaseOf(p); busyLine(label + (ph ? ' · ' + ph : '') + (p && p.total ? ' ' + Math.round((p.loaded / p.total) * 100) + '%' : ''), p && p.total ? p.loaded / p.total : null, cancel); }, ac.signal);
    if (ac.signal.aborted) { await openGit(GS.tab); toast('Cancelled'); return; }
    const secs = (Date.now() - t0) / 1000; toast((DONE[label] || 'Done') + (secs >= 2 ? ' · ' + secs.toFixed(1) + 's' : ''), { result: LONG_GIT.has(label) });
    if (keep && S.gitState && !S.gitState.pending) GS.reuse = typeof keep === 'function' ? keep(S.gitState.changes) : S.gitState.changes;
    if (after) await after(); else await openGit();
  } catch (e) {
    const m = (e && e.message) || String(e);
    if (ac.signal.aborted) { await openGit(GS.tab); toast('Cancelled'); return; }
    if (/^Set your Git name/.test(m)) { toast('Add your Git name and email first.'); openGitIdentity(() => openGit(), { repo: S.folder }); return; }
    D.log('git', label + ' failed: ' + m); await openGit(GS.tab, true); errLine(m, { retry: () => gitRun(label, fn, after, keep) });
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

/** Shortens a repository link in the middle so the owner and the repository name both stay visible. */
function shortRemote(host, path) {
  const full = host + '/' + path; if (full.length <= 40) return full;
  const parts = String(path).split('/'); const repo = parts[parts.length - 1]; const owner = parts[0];
  const a = host + '/' + owner + '/\u2026/' + repo;
  return a.length <= 44 ? a : host + '/\u2026/' + repo;
}
function gitHead(st) {
  let tags = '';
  if (st.remote && st.ab) {
    if (st.ab.noRemoteBranch) tags = '<span class="ab push">' + ICON('up') + 'Not pushed yet</span>';
    else if (st.ab.ahead != null) {
      if (st.ab.ahead) tags += '<span class="ab push">' + ICON('up') + st.ab.ahead + ' to push</span>';
      if (st.ab.behind) tags += '<span class="ab pull">' + ICON('down') + st.ab.behind + ' to pull</span>';
      if (!st.ab.ahead && !st.ab.behind) tags = '<span class="ab ok">' + ICON('check') + 'Up to date</span>';
    }
  }
  const rm = st.remote ? shortRemote(st.remote.host, st.remote.path) : 'No remote yet';
  return (
    '<div class="gsum"><div class="top2"><span class="btile">' + ICON('branch') + '</span><div class="tx"><div class="nm">' + esc(st.branch || '') + '</div><div class="rm"' + (st.remote ? ' title="' + esc(st.remote.host + '/' + st.remote.path) + '"' : '') + '>' + esc(rm) + '</div></div>' + (tags ? '<span class="abs">' + tags + '</span>' : '') + '</div>' +
    '<div class="seg"><button id="gFetch" class="btn sm">' + ICON('fetch') + '<span class="lbl">Fetch</span></button><button id="gPush" class="btn sm">' + ICON('up') + '<span class="lbl">Push</span></button><button id="gPull" class="btn sm">' + ICON('down') + '<span class="lbl">Pull</span></button></div></div><div id="gMsg"></div>' +
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
      h += '<div class="gbar"><span class="h4">Staged (' + staged.length + ')</span>' + (staged.length ? '<button id="gUnstageAll" class="gchip" type="button">' + ICON('minus') + '<span class="lbl">Unstage all</span></button>' : '') + '</div>' +
        (staged.map((c) => row(c, true)).join('') || '<div class="note" style="text-align:left">Nothing staged. Tap + on a file to include it in the next commit.</div>') +
        '<div class="gbar"><span class="h4">Changes (' + unstaged.length + ')</span><span class="gchips">' + (unstaged.length ? '<button id="gStageAll" class="gchip" type="button">' + ICON('plus') + '<span class="lbl">Stage all</span></button>' : '') + '<button id="gDiscardAll" class="gchip danger" type="button">' + ICON('trash') + '<span class="lbl">Discard all</span></button></span></div>' +
        (unstaged.map((c) => row(c, false)).join('') || '<div class="note" style="text-align:left">Everything is staged.</div>');
      foot.classList.remove('hidden');
      foot.innerHTML = '<button id="gReview" class="btn sm' + (S.models.length ? '' : ' dim') + '" type="button">' + ICON('search') + '<span class="lbl">Review my changes</span></button><div class="gbox"><textarea id="gMessage" rows="1" placeholder="Commit message"></textarea><button id="gSuggest" class="sugpill' + (S.models.length ? '' : ' dim') + '" type="button" aria-label="Suggest a message">' + ICON('sparkles') + '<span class="lbl">Suggest</span></button></div><div id="gHint" class="ghint"></div><div class="row"><button id="gCommit" class="btn primary" style="flex:1"><span class="lbl"></span></button></div>';
    }
  } else if (GS.tab === 'branches') {
    h += '<button id="gNew" class="btn" style="width:100%;margin:10px 0 8px">' + ICON('plus') + '<span class="lbl">New branch from here</span></button>' +
      st.branches.map((b) => '<div class="row-item"><div class="grow"><div class="t">' + esc(b) + '</div></div>' + (b === st.branch ? '<span class="badge cur">current</span>' :
        '<button class="btn sm" data-sw="' + esc(b) + '"><span class="lbl">Switch</span></button><button class="btn sm" data-mg="' + esc(b) + '"><span class="lbl">Merge</span></button><button class="icon-btn" data-db="' + esc(b) + '" aria-label="Delete ' + esc(b) + '" style="width:34px;height:34px">' + ICON('trash') + '</button>') + '</div>').join('') +
      '<div class="note" style="text-align:left">Merge brings the chosen branch into <b>' + esc(st.branch || '') + '</b>.</div>';
  } else if (GS.tab === 'history') {
    h += (st.history.length ? '<button id="gUndo" class="btn" style="width:100%;margin:10px 0 4px">' + ICON('undo') + '<span class="lbl">Undo last commit (keep changes)</span></button>' : '') +
      (st.history.map((x) => '<div class="hist"><div class="t">' + esc(x.commit.message.trim().split('\n')[0]) + '</div><div class="s">' + esc(x.commit.author.name) + ' · ' + x.oid.slice(0, 7) + ' · ' + ago(x.commit.author.timestamp * 1000) + '</div></div>').join('') || '<div class="note">No commits yet.</div>') +
      (st.history.length >= GS.hist && GS.hist < 30 ? '<button id="gMore" class="btn" style="width:100%;margin-top:10px"><span class="lbl">Show 10 more</span></button>' : st.history.length ? '<div class="note">' + (st.history.length >= 30 ? 'Showing the latest 30. See older ones on GitHub.' : 'End of history') + '</div>' : '');
  } else {
    h += repoCard(st);
    h += '<div class="h3">Remote</div><div class="card"><div class="t" style="word-break:break-all">' + (st.remote ? esc(st.remote.url) : 'No remote set') + '</div><div style="margin-top:10px"><button id="gRemote" class="btn sm"><span class="lbl">' + (st.remote ? 'Change URL' : 'Set remote URL') + '</span></button></div></div>';
    if (!st.remote) h += '<div class="h3">Create a new repository</div><div class="card"><p>Create a repository on GitHub or GitLab for these files and upload them.</p><button id="gPublish" class="btn primary" style="width:100%"><span class="lbl">Create and push</span></button></div>';
    h += '<div class="h3">Account</div><div class="card"><div class="kv" style="border:0;padding-bottom:2px"><span>Author</span><span id="gTag" class="badge cur" style="display:none"></span></div><div id="gAuthor" style="line-height:1.5;margin:0 0 12px;word-break:normal;overflow-wrap:anywhere"></div><button id="gIdent" class="btn sm"><span class="lbl">Identity and tokens</span></button></div>' +
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
  const kv = (k, v) => {
    if (!v) return '';
    const long = v.replace(/<[^>]*>/g, '').length > 34;
    const val = long ? v.replace(/(^|>)([^<]+)/g, (m, a, t) => a + t.replace(/\//g, '/<wbr>')) : v;
    return '<div class="kv' + (long ? ' long' : '') + '"><span>' + k + '</span><span>' + val + '</span></div>';
  };
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
    const ta = $('#gMessage'); ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'; syncCommit(st); };
    $('#gReview').onclick = () => { if (!S.models.length) { noModelNotice(); return; } closeSheet(); quickSend('Review my uncommitted changes before I commit: call review_changes, check what it spotted, then report_findings.'); };
    $('#gSuggest').onclick = async () => {
      const hint = (m) => { const h = $('#gHint'); if (!h) return; h.textContent = m; clearTimeout(h._t); h._t = setTimeout(() => { h.textContent = ''; }, 5000); };
      if (!S.models.length) { hint('Connect a model first: Settings > Add provider.'); return; }
      const b = $('#gSuggest'); b.disabled = true; const l = b.querySelector('.lbl'); l.textContent = 'Thinking...';
      try { ta.value = await A.suggestCommitMessage(currentModelId(), folder); ta.oninput(); } catch (e) { hint(e.message || 'Could not suggest a message.'); }
      b.disabled = false; l.textContent = 'Suggest';
    };
    $('#gCommit').onclick = async () => {
      let paths = st.changes.map((c) => c.path).filter((p) => GS.sel.has(p));
      if (!ta.value.trim()) { // no message yet: fill in a plain one to review, do not commit
        ta.value = draftMessage(st.changes.filter((c) => paths.includes(c.path))); ta.oninput();
        return;
      }
      const found = await G.scanSecrets(folder, st.changes.filter((c) => paths.includes(c.path)));
      const unchecked = found.skipped || 0;
      if (unchecked && !found.length) toast('Secret scan checked the first 300 files: ' + unchecked + ' more were not checked. Review them before pushing.', { kind: 'warn' });
      if (found.length) {
        const names = [...new Set(found.map((f) => f.path))];
        const detail = found.slice(0, 4).map((f) => f.path + ' (' + f.kind + ', line ' + f.line + ')').join('\n') + (found.length > 4 ? '\n+' + (found.length - 4) + ' more' : '') + (unchecked ? '\n\n' + unchecked + ' more files were not checked.' : '');
        D.log('git', 'Secret scan flagged ' + found.length + ' place(s) before commit');
        const pick = await choiceBox('Possible secret found', 'These files look like they contain a key or token. Once pushed, it is public.\n\n' + detail, ['Leave them out', 'Commit anyway'], { stack: true });
        if (pick === -1) return;
        if (pick === 0) { paths = paths.filter((p) => !names.includes(p)); if (!paths.length) { toast('Nothing left to commit.'); return; } }
      }
      run('Committing', () => G.commit(folder, ta.value, paths, st.changes), (ch) => ch.filter((c) => !paths.includes(c.path)));
    };
  }
  if ($('#gTok')) $('#gTok').onclick = async () => { const t = await askText('Access token for ' + st.remote.host, 'Paste the token'); if (t) { await G.saveToken(st.remote.host, t); await G.rememberHost(st.remote.host); toast('Token saved'); openGit(GS.tab); } };
  if ($('#gNew')) $('#gNew').onclick = async () => { const n = await askText('New branch', 'Branch name', 'feature/my-change'); if (n) run('Creating branch', () => G.createBranch(folder, n.replace(/\s+/g, '-')), true); };
  $$('[data-sw]', body).forEach((b) => b.onclick = () => run('Switching branch', () => G.checkout(folder, b.dataset.sw)));
  $$('[data-mg]', body).forEach((b) => b.onclick = async () => { if (await confirmBox('Merge branch?', 'Merge "' + b.dataset.mg + '" into "' + st.branch + '"?', 'Merge')) run('Merging', () => G.mergeBranch(folder, b.dataset.mg)); });
  $$('[data-db]', body).forEach((b) => b.onclick = async () => { if (await confirmBox('Delete branch?', 'Delete "' + b.dataset.db + '" from this phone. The remote copy is not touched.', 'Delete')) run('Deleting branch', () => G.deleteBranch(folder, b.dataset.db)); });
  if ($('#gMore')) $('#gMore').onclick = () => { GS.hist = Math.min(GS.hist + 10, 30); openGit('history'); };
  if ($('#gUndo')) $('#gUndo').onclick = async () => { if (await confirmBox('Undo last commit?', 'The commit is removed from this branch. Its changes come back as uncommitted changes. Nothing is lost.', 'Undo commit')) run('Undoing commit', () => G.undoLastCommit(folder)); };
  if ($('#gRemote')) $('#gRemote').onclick = async () => { const u = await askText(st.remote ? 'Change remote URL' : 'Set remote URL', 'https://github.com/user/repo.git', st.remote ? st.remote.url : ''); if (u) run('Saving remote', () => G.setRemote(folder, u), true); };
  if ($('#gPublish')) $('#gPublish').onclick = () => openGitStart(folder, 'new');
  if ($('#gIdent')) { G.effectiveAuthor(folder).then((a) => { const el = $('#gAuthor'); if (!el) return; if (a.source === 'none') { el.innerHTML = '<b style="font-weight:600">Not set</b><br><span style="color:var(--muted,#666)">Add your name and email</span>'; return; } const t = $('#gTag'); t.style.display = ''; t.textContent = a.source === 'repo' ? 'this repo' : 'default'; el.innerHTML = '<b style="font-weight:600">' + esc(a.name) + '</b><br><span style="color:var(--muted,#666)">' + esc(a.email).replace('@', '<wbr>@') + '</span>'; }); $('#gIdent').onclick = () => openGitIdentity(() => openGit('remote'), { repo: folder }); }
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
  const ta = $('#gMessage'); const empty = !(ta && ta.value.trim());
  b.disabled = !n; b.querySelector('.lbl').textContent = n ? 'Commit ' + n + ' staged' : 'Stage files first';
  b.classList.toggle('idle', !!n && empty); // pale until a message is written
}
/** A plain starting message from the staged files, for when the box is empty. */
function draftMessage(changes) {
  const base = (p) => String(p).split('/').pop();
  const by = { new: [], modified: [], deleted: [] };
  changes.forEach((c) => (by[c.kind] || by.modified).push(base(c.path)));
  const total = changes.length;
  const verbs = [['new', 'Add'], ['modified', 'Update'], ['deleted', 'Remove']].filter(([k]) => by[k].length);
  let msg;
  if (total <= 3) msg = verbs.map(([k, v], i) => (i ? v.toLowerCase() : v) + ' ' + by[k].join(', ')).join(', ');
  else if (verbs.length === 1) msg = verbs[0][1] + ' ' + total + ' files';
  else msg = 'Update ' + total + ' files: ' + verbs.map(([k]) => by[k].length + ' ' + ({ new: 'new', modified: 'changed', deleted: 'removed' })[k]).join(', ');
  return msg.length > 72 ? msg.slice(0, 69).trimEnd() + '...' : msg;
}
/** Private input for a secret value. Resolves with the text, or null on Skip. The value never touches the chat. */
function askSecret(info, signal) {
  return new Promise((res) => {
    $('#dlgTitle').textContent = 'Add ' + info.name + (info.step ? ' (' + info.step + ')' : '');
    $('#dlgText').innerHTML = (info.description ? '<div style="margin-bottom:8px">' + esc(info.description) + '</div>' : '') +
      '<div style="margin-bottom:8px;font-size:12.5px">Saved to <b>' + esc(info.file) + '</b> in this project. The agent never sees the value and it is not shown in the chat.</div>' +
      '<div style="display:flex;gap:6px"><input id="dlgInput" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex:1;min-width:0;height:42px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:var(--card);outline:0" placeholder="Value"><button id="dlgEye" type="button" class="icon-btn" aria-label="Show value">' + ICON('eye') + '</button></div>';
    $('#dlgText').classList.add('has-in'); $('#dlgYes').firstElementChild.textContent = 'Save'; $('#dlgNo').firstElementChild.textContent = 'Skip'; $('#dialog').classList.remove('hidden');
    setTimeout(() => { const i = $('#dlgInput'); if (i) i.focus(); }, 60);
    $('#dlgEye').onclick = () => { const i = $('#dlgInput'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#dlgEye').setAttribute('aria-label', show ? 'Hide value' : 'Show value'); $('#dlgEye').innerHTML = ICON(show ? 'eye-off' : 'eye'); };
    const done = (v) => {
      const t = $('#dlgInput') ? $('#dlgInput').value : '';
      $('#dialog').classList.add('hidden'); $('#dlgText').classList.remove('has-in'); $('#dlgText').textContent = ''; $('#dlgNo').firstElementChild.textContent = 'Cancel'; $('#dlgYes').onclick = $('#dlgNo').onclick = null;
      res(v && t.trim() ? t.trim() : null);
    };
    $('#dlgYes').onclick = () => { if (!$('#dlgInput').value.trim()) { $('#dlgInput').focus(); return; } done(true); };
    $('#dlgNo').onclick = () => done(false);
    if (signal) signal.addEventListener('abort', () => { if (!$('#dialog').classList.contains('hidden')) done(false); }, { once: true });
  });
}
/** A question from the agent with up to four answer buttons. Resolves the chosen text, or null when skipped. */
function askChoice(question, options, signal) {
  return new Promise((res) => {
    $('#dlgTitle').textContent = 'Question'; $('#dlgText').innerHTML = '<div style="margin-bottom:10px">' + esc(question) + '</div><div class="askopts">' + options.map((o, i) => '<button class="btn" data-i="' + i + '">' + esc(o) + '</button>').join('') + '</div>';
    $('#dlgYes').classList.add('hidden'); $('#dlgNo').firstElementChild.textContent = 'Skip'; $('#dialog').classList.remove('hidden');
    const done = (v) => {
      $('#dialog').classList.add('hidden'); $('#dlgText').textContent = ''; $('#dlgYes').classList.remove('hidden'); $('#dlgNo').firstElementChild.textContent = 'Cancel'; $('#dlgNo').onclick = null; res(v);
    };
    $('#dlgText').querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => done(options[+b.dataset.i]); });
    $('#dlgNo').onclick = () => done(null);
    if (signal) signal.addEventListener('abort', () => { if (!$('#dialog').classList.contains('hidden')) done(null); }, { once: true });
  });
}
function askText(title, placeholder, value = '', toEnd = false) {
  return new Promise((res) => {
    $('#dlgTitle').textContent = title; $('#dlgText').innerHTML = '<input id="dlgInput" style="width:100%;height:42px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:var(--card);outline:0" placeholder="' + esc(placeholder) + '" autocapitalize="off" autocomplete="off">';
    $('#dlgText').classList.add('has-in'); $('#dlgInput').value = value; $('#dlgYes').firstElementChild.textContent = 'OK'; $('#dialog').classList.remove('hidden');
    setTimeout(() => { const i = $('#dlgInput'); if (i) { i.focus(); if (toEnd) { const n = i.value.length; try { i.setSelectionRange(n, n); } catch (e) { /* ignore */ } } } }, 50);
    const done = (v) => { const t = $('#dlgInput') ? $('#dlgInput').value.trim() : ''; $('#dialog').classList.add('hidden'); $('#dlgText').classList.remove('has-in'); $('#dlgText').textContent = ''; $('#dlgYes').onclick = $('#dlgNo').onclick = null; res(v ? t : null); };
    $('#dlgYes').onclick = () => done(true); $('#dlgNo').onclick = () => done(false);
  });
}

/** One line about a file's size change: "120 KB → 85 KB (−35 KB)", "New · 85 KB" or "Deleted · 120 KB". */
function sizeLine(d) {
  if (d.isNew) return 'New \u00b7 ' + fmtBytes(d.size);
  if (d.deleted) return 'Deleted \u00b7 ' + fmtBytes(d.beforeSize);
  const diff = d.size - d.beforeSize;
  if (!diff) return fmtBytes(d.size) + ' \u00b7 same size';
  return fmtBytes(d.beforeSize) + ' \u2192 ' + fmtBytes(d.size) + ' (' + (diff > 0 ? '+' : '\u2212') + fmtBytes(Math.abs(diff)) + ')';
}
/** Diff screen for one changed file. */
async function openGitDiff(folder, path) {
  const body = sheet(path, { back: () => openGit() });
  body.innerHTML = '<div class="busy"><span class="spin"></span>Loading...</div>';
  try {
    const d = await G.diffTexts(folder, path);
    if (d.hidden) { body.innerHTML = '<div class="note" style="text-align:left">Protected file. Its contents are hidden here and from the agent.</div>'; return; }
    const sz = sizeLine(d);
    if (d.binary) { body.innerHTML = '<div class="note" style="text-align:left"><b>' + esc(sz) + '</b><br>Binary file. Line changes are not shown.</div>'; return; }
    body.innerHTML = '<div class="note sizeline">' + esc(sz) + '</div>' + diffHtml(d.before, d.after);
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
    await offerAllFiles().catch(() => {});
      lock(true);
      try { await runClone(folder, v, (t) => busyLine(t)); } catch (e) { fail(e); }
    };
    if ($('#nGo')) $('#nGo').onclick = async () => {
      const provider = segVal('nProv'); lock(true); busyLine('Starting...');
      try {
        if ($('#nIgn').checked) { try { await fs.stat(folder.uri, '.gitignore').then(async (s) => { if (!s || !s.exists) await fs.writeText(folder.uri, '.gitignore', 'node_modules/\n.env\n.env.*\n*.log\n.DS_Store\n__pycache__/\n*.pyc\n'); }); } catch (e) { /* optional */ } }
        const r = await G.publishNew(folder, { provider, host: $('#nHost').value.trim(), name: $('#nName').value, isPrivate: segVal('nVis') === 'private', description: $('#nDesc').value.trim(), token: $('#nTok').value.trim(), message: 'Initial commit' }, (t) => busyLine(t + '...'));
        toast('Repository created', { result: true }); GS.keepSel = false; drawCtx(); await openGit('remote'); const el = $('#gMsg'); if (el) el.innerHTML = '<div class="ok">Uploaded to ' + esc(r.webUrl || r.cloneUrl) + '</div>';
      } catch (e) { fail(e); }
    };
    if ($('#lGo')) $('#lGo').onclick = async () => { try { await G.init(folder); toast('Repository created'); GS.keepSel = false; drawCtx(); openGit('changes'); } catch (e) { fail(e); } };
  };
  draw();
}

async function openGitIdentity(back, opts = {}) {
  const body = sheet('Git identity and tokens', { back });
  const repo = opts && opts.repo && (await G.isRepo(opts.repo).catch(() => false)) ? opts.repo : null;
  const own = repo ? await G.repoAuthor(repo) : null;
  const gs = await G.getGitSettings(); const hosts = await G.listTokenHosts();
  const blank = (v) => !v || /^root(@localhost)?$/i.test(v);
  const nm = blank(gs.name) ? '' : gs.name; const em = blank(gs.email) ? '' : gs.email;
  body.innerHTML =
    '<div class="h3">Access tokens</div>' +
    (hosts.map((h) => '<div class="row-item">' + ICON('key') + '<div class="grow"><div class="t">' + esc(h) + '</div><div class="s">Token saved</div></div><button class="icon-btn" data-rh="' + esc(h) + '" aria-label="Remove token for ' + esc(h) + '">' + ICON('trash') + '</button></div>').join('') || '<div class="note" style="text-align:left">No tokens yet. Add one below.</div>') +
    '<div class="h3">Add a token</div><div class="tokcard">' +
    '<label class="field"><span>Host</span><input id="tHost" value="github.com" autocapitalize="off"></label>' +
    '<label class="field"><span id="tTokLbl">Token</span><input id="tTok" type="password" autocomplete="off" autocapitalize="off"><small>GitHub: Settings > Developer settings > Personal access tokens (needs repo access). GitLab: a token with write_repository.</small></label>' +
    '<button id="tSave" class="btn primary" style="width:100%"><span class="lbl">Save token</span></button><div id="tMsg"></div></div>' +
    (repo
      ? '<div class="h3">Default author</div><div id="gDef" class="note" style="text-align:left;line-height:1.5;margin-top:0"></div>' +
        '<div class="h3">This repository: ' + esc(repo.name || 'folder') + '</div>' +
        '<label class="field"><span>Name</span><input id="rName" value="' + esc(own ? own.name : '') + '" placeholder="Your name" autocapitalize="words"></label>' +
        '<label class="field"><span>Email</span><input id="rEmail" type="email" value="' + esc(own ? own.email : '') + '" placeholder="you@example.com" autocapitalize="off"></label>' +
        '<div class="note" style="text-align:left">Only this folder uses this author. Other repositories are not changed. Leave both empty to follow the default.</div>' +
        '<div style="display:flex;gap:10px"><button id="rSave" class="btn primary" style="flex:1"><span class="lbl">Save for this repo</span></button><button id="rDef" class="btn" style="flex:1"><span class="lbl">Use default</span></button></div><div id="rMsg"></div>'
      : '<div class="h3">Default author</div>' +
        '<label class="field"><span>Name</span><input id="gName" value="' + esc(nm) + '" placeholder="Your name"></label>' +
        '<label class="field"><span>Email</span><input id="gEmail" type="email" value="' + esc(em) + '" placeholder="you@example.com" autocapitalize="off"></label>' +
        '<div class="note" style="text-align:left">' + (nm && em ? 'Used for every repository that has no author of its own.' : 'Set your name and email so commits show you.') + '</div>' +
        '<button id="aSave" class="btn" style="width:100%"><span class="lbl">Save author</span></button><div id="aMsg"></div>');
  const say = (id, m) => { $(id).innerHTML = '<div class="ghint">' + esc(m) + '</div>'; };
  const hostIn = () => $('#tHost').value.trim().toLowerCase();
  const syncLbl = () => { $('#tSave').firstElementChild.textContent = hosts.indexOf(hostIn()) >= 0 ? 'Replace token' : 'Save token'; };
  $('#tHost').oninput = syncLbl; syncLbl();
  $('#tSave').onclick = async () => {
    const h = hostIn(); const t = $('#tTok').value.trim();
    if (!h) return say('#tMsg', 'Enter the host, for example github.com.');
    if (!t) return say('#tMsg', 'Paste the token first.');
    if (t.length < 20 || /\s/.test(t)) return say('#tMsg', 'That does not look like an access token. Copy it again from the website.');
    await G.saveToken(h, t); await G.rememberHost(h);
    openGitIdentity(back, opts);
  };
  if (repo) {
    const defA = { name: nm, email: em };
    $('#gDef').innerHTML = defA.name && defA.email ? '<b style="font-weight:600;color:var(--text,#222)">' + esc(defA.name) + '</b><br>' + esc(defA.email).replace('@', '<wbr>@') + '<br>Default for all repositories. Change it in Settings.' : 'Not set. Add it in Settings > Git.';
    $('#rDef').onclick = () => { if (!defA.name || !defA.email) return say('#rMsg', 'No default author is set yet. Add it in Settings > Git.'); $('#rName').value = defA.name; $('#rEmail').value = defA.email; say('#rMsg', 'Default filled in. Tap Save for this repo to keep it.'); };
    $('#rSave').onclick = async () => {
      const n = $('#rName').value.trim(); const e = $('#rEmail').value.trim();
      try {
        if (!n && !e) { await G.clearRepoAuthor(repo); }
        else {
          if (!n || !e) return say('#rMsg', 'Enter both a name and an email, or leave both empty.');
          if (!/^[^@\s]+@[^@\s]+$/.test(e)) return say('#rMsg', 'That email does not look right.');
          await G.setRepoAuthor(repo, n, e);
        }
      } catch (x) { return say('#rMsg', (x && x.message) || 'Could not save.'); }
      if (back) back(); else closeSheet();
    };
  }
  if ($('#aSave')) $('#aSave').onclick = async () => {
    const n = $('#gName').value.trim(); const e = $('#gEmail').value.trim();
    if (!n || !e) return say('#aMsg', 'Enter both your name and your email.');
    if (!/^[^@\s]+@[^@\s]+$/.test(e)) return say('#aMsg', 'That email does not look right.');
    await G.saveGitSettings({ name: n, email: e });
    if (back) back(); else closeSheet();
  };
  $$('[data-rh]', body).forEach((b) => b.onclick = async () => { await G.forgetHost(b.dataset.rh); openGitIdentity(back, opts); });
}

// ------------------------------------------------------------ clone from Projects
function cloneFields(hosts) {
  return '<label class="field"><span>Repository URL</span><input id="cUrl" placeholder="https://github.com/user/repo.git" autocapitalize="off" autocomplete="off"></label>' +
    '<label class="field"><span>Branch (optional)</span><input id="cBr" placeholder="Defaults to the repository\'s main branch" autocapitalize="off" autocomplete="off"></label>' +
    '<label class="field"><span>Access token</span><input id="cTok" type="password" autocomplete="off" autocapitalize="off" placeholder="' + (hosts && hosts.length ? 'Leave empty to use a saved token' : 'Private repos and pushing') + '"><small>Stored encrypted on this phone, once per host.</small></label>' +
    '<label class="field"><span>Folder name (optional)</span><input id="cName" placeholder="Defaults to the repository name" autocapitalize="off" autocomplete="off"></label>' +
    '<label class="gr" style="border:0"><input type="checkbox" class="cb" id="cFull"><span>Download full history (slower)</span></label>';
}
const readCloneFields = () => ({ url: $('#cUrl').value.trim(), token: $('#cTok').value.trim(), name: $('#cName').value.trim(), branch: ($('#cBr') ? $('#cBr').value.trim() : ''), full: $('#cFull').checked });
/** Clone into a new sub-folder of `parent` and open it as a project. */
async function runClone(parent, v, say) {
  say('Cloning...');
  const f = await G.cloneInto(parent, v.url, { token: v.token, name: v.name, branch: v.branch, depth: v.full ? 0 : 1, id: uid(), onProgress: (p) => say('Cloning ' + pct(p)) });
  S.folders.push(f); await A.saveFolders(S.folders);
  GS.keepSel = false; closeSheet(); await applyFolder(f);
  if (S.folder && S.folder.id === f.id) { toast('Cloned into ' + f.name, { result: true }); openGit('changes'); }
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
// Pictures are left out of a backup (they can be hundreds of MB); the text of every chat is kept.
function stripPictures(rows) {
  return rows.map((m) => {
    if (!m || !m.images || !m.images.length) return m;
    const c = { ...m, imagesOmitted: m.images.length }; delete c.images;
    c.text = (c.text ? c.text + '\n' : '') + '[' + c.imagesOmitted + ' picture' + (c.imagesOmitted > 1 ? 's' : '') + ' not included in the backup]';
    return c;
  });
}
const BACKUP_STORES = ['kv', 'chats', 'messages', 'backups', 'usage'];
async function exportBackup() {
  const r = await fs.pickFolder().catch(() => null); if (!r || !r.uri) return;
  const data = { app: 'kdex-agent', version: 2, at: Date.now() };
  for (const st of BACKUP_STORES) data[st] = await db.all(st);
  data.kv = data.kv.filter((x) => x.key !== 'lastChat');
  data.messages = stripPictures(data.messages);
  const name = 'kdex-agent-backup-' + dayKey() + '.json';
  const text = JSON.stringify(data);
  if (text.length > 60 * 1048576) { toast('This backup would be larger than 60 MB, too big to restore. Delete some old chats first.', { kind: 'warn' }); return; }
  await fs.writeText(r.uri, name, text);
  toast('Saved ' + name + ' (' + fmtBytes(text.length) + ') in ' + (r.name || 'the folder'));
}
/** A backup file is only used when every part has the shape the app expects. Returns an error text or ''. */
function backupProblem(d) {
  if (!d || typeof d !== 'object' || d.app !== 'kdex-agent') return 'This is not a KDex Agent backup.';
  for (const st of BACKUP_STORES) if (d[st] != null && !Array.isArray(d[st])) return 'The backup file is damaged (' + st + ').';
  if ((d.chats || []).some((c) => !c || typeof c.id !== 'string')) return 'The backup file is damaged (chats).';
  if ((d.messages || []).some((m) => !m || typeof m.chatId !== 'string' || typeof m.role !== 'string')) return 'The backup file is damaged (messages).';
  if ((d.kv || []).some((k) => !k || typeof k.key !== 'string')) return 'The backup file is damaged (settings).';
  return '';
}
async function wipeStores() {
  for (const st of ['chats', 'messages', 'backups', 'usage']) for (const row of await db.all(st)) await db.del(st, row.id);
}
async function importBackup() {
  const r = await fs.pickFolder().catch(() => null); if (!r || !r.uri) return;
  const files = (await fs.list(r.uri, '')).filter((e) => !e.isDir && /^kdex-agent-backup-.*\.json$/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name));
  if (!files.length) { toast('No backup file found in that folder.'); return; }
  const f = files[0];
  if (!await confirmBox('Restore backup?', 'Restore ' + f.name + '? Chats, notes and settings in the file replace the current ones. API keys are never in a backup; add them again if needed.', 'Restore')) return;
  let data;
  try { const t = await fs.readText(r.uri, f.path, 64 * 1024 * 1024); if (t.truncated) { toast('The backup file is too large to restore (over 64 MB).', { kind: 'warn' }); return; } data = JSON.parse(t.text); }
  catch (e) { toast('Could not read the backup file: ' + String((e && e.message) || e).slice(0, 80)); return; }
  const bad = backupProblem(data); if (bad) { toast(bad, { kind: 'warn' }); return; }
  // Keep a copy of what is on the phone now; if anything fails halfway, put it back.
  const before = {}; for (const st of BACKUP_STORES) before[st] = await db.all(st);
  try {
    await wipeStores();
    for (const st of BACKUP_STORES) for (const row of data[st] || []) await db.put(st, row);
  } catch (e) {
    try { await wipeStores(); for (const st of BACKUP_STORES) for (const row of before[st]) await db.put(st, row); } catch (e2) { /* best effort */ }
    toast('Restore failed, nothing was changed: ' + String((e && e.message) || e).slice(0, 80)); return;
  }
  // After a reinstall, Android forgets which folders the app may open. Say which ones need to be added again.
  const lost = [];
  for (const fo of (data.kv || []).filter((k) => k.key === 'folders').flatMap((k) => k.value || [])) {
    try { await fs.list(fo.uri, ''); } catch (e) { lost.push(fo.name || fo.path || 'a folder'); }
  }
  if (lost.length) await choiceBox('Add folders again', 'Restored. Android no longer lets this install open ' + lost.length + ' folder' + (lost.length > 1 ? 's' : '') + ': ' + lost.slice(0, 6).join(', ') + (lost.length > 6 ? ' ...' : '') + '. Tap the folder button, then Add folder, and pick each one again. Your chats are kept.', ['OK'], { noCancel: true });
  toast('Restored. Restarting...', { result: true }); setTimeout(() => location.reload(), 700);
}

// ------------------------------------------------------------ wiring
function wire() {
  // After startup, a failed action shows a message instead of covering the app with an error page.
  const oops = (e) => { const r = e && (e.reason || e.error) || e; const msg = String((r && r.message) || r || 'Unknown error').slice(0, 140); console.error(r); toast('Something went wrong: ' + msg); };
  window.addEventListener('unhandledrejection', (e) => { if (window.__stage !== 'ready') return; e.preventDefault(); oops(e); });
  window.addEventListener('error', (e) => { if (window.__stage !== 'ready' || (e.target && (e.target.src || e.target.href))) return; oops(e); });
  $('#menuBtn').onclick = openDrawer; $('#scrim').onclick = closeDrawer;
  $('#dNew').onclick = () => newChat(null);
  $('#dProjects').onclick = () => { closeDrawer(); openProjects(); }; $('#topFolderBtn').onclick = openProjects; $('#chipFolder').onclick = openProjects;
  $('#dSettings').onclick = () => { closeDrawer(); openSettings(); };
  $('#chipScratch').onclick = openScratch; $('#chipFiles').onclick = () => openFiles(''); $('#chipGit').onclick = () => openGit(); $('#chipChanges').onclick = openChanges; $('#chipTerm').onclick = openTerminal; $('#chipAuto').onclick = toggleAuto;
  $('#sheetClose').onclick = closeSheet; sheetDrag(); touchSwipes();
  $('#chatSearch').oninput = drawChatList;
  chatLongPress();
  $('#chatList').onclick = async (e) => {
    if (Date.now() < lpBlockUntil) { e.stopPropagation(); e.preventDefault(); return; } // the click that ends a long press must not open the chat
    const d = e.target.closest('[data-menu]');
    if (d) { e.stopPropagation(); openRowMenu(d, d.dataset.menu); return; }
    const it = e.target.closest('[data-id]'); if (it) openChat(it.dataset.id);
  };
  $('#composer').onsubmit = (e) => { e.preventDefault(); send(false); };
  $('#input').addEventListener('input', () => { autoGrow(); scheduleDraft(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); });
  window.addEventListener('pagehide', () => { flushDraft(); });
  $('#attachBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  $('#chips').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { S.attach.splice(Number(b.dataset.rm), 1); drawChips(); } };
  $('#ctxBtn').onclick = showRing;
  $('#planBtn').onclick = () => { if (!S.chat) return; S.chat.plan = !S.chat.plan; drawPlan(); persistChat(); toast(S.chat.plan ? 'Plan mode on: I only read and plan' : 'Plan mode off'); };
  $('#stopBtn').onclick = () => { if (S.running && runHere()) stopRun(); };
  $('#thinkBtn').onclick = (e) => { e.stopPropagation(); $('#thinkMenu').classList.toggle('hidden'); };
  $('#thinkMenu').onclick = (e) => { const b = e.target.closest('[data-think]'); if (!b) return; S.think = b.dataset.think; drawThink(); $('#thinkMenu').classList.add('hidden'); persistChat(); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#thinkMenu')) $('#thinkMenu').classList.add('hidden'); });
  $('#modelSelect').onchange = persistChat;
  $('#modelSelect').addEventListener('pointerdown', (e) => { if (!S.models.length) { e.preventDefault(); showSetup(false, 'Connect a model'); } });
  $('#approveAll').onclick = () => [...S.approvals.keys()].forEach((id) => { const tm = S.approvalTm.get(id); if (tm && tm.plan && tm.plan.warn) return; decide(id, 'apply'); }); // a push held back by the pre-push check is never approved in bulk
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
      if (t.dataset.tool === 'xout') { const tl = t.closest('.tool'); const pre = tl.querySelector('pre.out'); if (pre) { const on = pre.classList.toggle('open'); t.textContent = on ? 'Collapse' : 'Expand'; const fz = tl.querySelector('.fsz'); if (fz) fz.classList.toggle('hidden', !on); } return; }
      if (t.dataset.tool === 'fs-' || t.dataset.tool === 'fs+' || t.dataset.tool === 'fs0') { setOutFs(t.dataset.tool === 'fs0' ? 11 : outFs() + (t.dataset.tool === 'fs+' ? 1 : -1)); return; }
      if (t.dataset.tool === 'prevfile') {
        const fm = await db.get('messages', Number(t.dataset.id)); if (!fm || !fm.file) return;
        openPreview(fm.file.name, bundleText(fm.fileContent), fm.fileContent); return;
      }
      if (t.dataset.tool === 'getfile' || t.dataset.tool === 'copyfile') {
        const fm = await db.get('messages', Number(t.dataset.id)); if (!fm || !fm.file) return;
        if (t.dataset.tool === 'copyfile') { flashCopied(t, await copyText(fm.fileContent)); return; }
        await saveOut(fm.file.name, fm.fileContent); return;
      }
      if (t.dataset.tool === 'undo') { await undoOne(Number(t.dataset.b)); return; }
      if (t.dataset.tool === 'fixfind') {
        const fm = await db.get('messages', Number(t.dataset.id)); const it = fm && fm.findings && fm.findings.items[Number(t.dataset.i)]; if (!it) return;
        quickSend('Fix this review finding: ' + it.title + (it.path ? ' (' + it.path + (it.line ? ':' + it.line : '') + ')' : '') + '.' + (it.fix ? ' ' + it.fix : '') + ' Make the smallest change and tell me what you changed.'); return;
      }
      decide(t.dataset.id, t.dataset.tool === 'apply' ? 'apply' : t.dataset.tool === 'fix' ? 'fix' : t.dataset.tool === 'always' ? 'always' : t.dataset.tool === 'allweb' ? 'allweb' : 'reject'); return;
    }
    const a = e.target.closest('[data-act]');
    if (a) {
      if (a.dataset.act === 'regen') regenerate();
      else if (a.dataset.act === 'cont') { $$('.controw').forEach((x) => x.remove()); if (!S.running) quickSend('continue'); }
      else if (a.dataset.act === 'report') reportReply(Number(a.closest('.msg').dataset.id));
      else { const el = a.closest('.msg'); const m = await db.get('messages', Number(el.dataset.id)); flashCopied(a, await copyText(m.text || '')); }
    }
  });
  $('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(false); } });
  if (App && App.addListener) Promise.resolve(App.addListener('backButton', () => {
    if (!$('#dialog').classList.contains('hidden')) { $('#dlgNo').click(); return; }
    if ($('#pv')) { closePreview(); return; }
    if (!$('#setup').classList.contains('hidden') && $('#sCancel')) { $('#sCancel').click(); return; }
    if (!$('#sheet').classList.contains('hidden')) { const b = $('#sheetBack'); if (!b.classList.contains('hidden')) b.click(); else closeSheet(); return; }
    if ($('#drawer').classList.contains('open')) { closeDrawer(); return; }
    onBackRoot();
  })).catch(() => {});
}

boot().catch((e) => { document.documentElement.classList.add('ready'); const f = document.getElementById('fatal'); f.style.display = 'block'; f.textContent = 'Startup error: ' + (e && (e.stack || e.message)) + '\nstage=' + window.__stage; });
