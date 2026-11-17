// Built-in code editor (CodeMirror 6, loaded on first use). Opens a text file from the phone folder, Scratch or a server,
// and saves it back to the same path. main.js passes in everything the editor needs; nothing here touches app state.
const SRC = 'vendor/codemirror.min.js';
const MAX = 1048576;
const KEYS = ['{', '}', '(', ')', '[', ']', '<', '>', ';', ':', '=', '"', "'", '/'];
const SIZES = [11, 12, 13, 14, 15, 16, 18];
const DEF = { size: 13, indent: 'auto', wrap: true, lines: true, spaces: false, sug: false, keys: true };
const LANG_BY_EXT = { html: 'html', htm: 'html', xhtml: 'html', xml: 'html', svg: 'html', vue: 'html', js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', py: 'py', css: 'css', scss: 'css', json: 'json', jsonc: 'json' };
const LANG_NAME = { html: 'HTML', js: 'JavaScript', ts: 'TypeScript', py: 'Python', css: 'CSS', json: 'JSON' };

let loading = null;
/** Loads the editor bundle once. */
export function loadEditor() {
  if (window.KCM) return Promise.resolve(window.KCM);
  if (loading) return loading;
  loading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = SRC;
    s.onload = () => (window.KCM ? res(window.KCM) : rej(new Error('The editor did not load.')));
    s.onerror = () => rej(new Error('The editor did not load.'));
    document.head.appendChild(s);
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

const extOf = (p) => { const b = String(p).split('/').pop().toLowerCase(); return b.includes('.') ? b.split('.').pop() : b; };
export const editorLang = (p) => LANG_BY_EXT[extOf(p)] || '';

/** Looks at a text and says how its lines end, whether it starts with a BOM, and the text with plain "\n" line ends. */
export function splitEol(raw) {
  let t = String(raw == null ? '' : raw); let bom = false;
  if (t.charCodeAt(0) === 0xFEFF) { bom = true; t = t.slice(1); }
  const crlf = (t.match(/\r\n/g) || []).length; const lf = (t.match(/\n/g) || []).length - crlf; const cr = (t.match(/\r(?!\n)/g) || []).length;
  const eol = crlf > lf && crlf >= cr ? '\r\n' : cr > lf && cr > crlf ? '\r' : '\n';
  return { bom, eol, text: t.replace(/\r\n|\r/g, '\n') };
}
export const joinEol = (text, eol, bom) => (bom ? '﻿' : '') + (eol === '\n' ? text : text.replace(/\n/g, eol));

/**
 * Opens the editor in `x.body` and `x.foot`.
 * x: { body, foot, path, uri, kind, fs, ICON, esc, toast, choiceBox, protectedFile, kv:{get,set}, setGuard, setBack, leave, notEditable, close }
 * Returns when the editor is on screen.
 */
export async function openEditor(x) {
  const { body, foot, path, uri, fs, ICON, esc, toast, choiceBox } = x;
  const name = path.split('/').pop();
  body.innerHTML = '<div class="note">Loading...</div>';
  let t; let KCM;
  try {
    [t, KCM] = await Promise.all([fs.readText(uri, path, MAX), loadEditor()]);
  } catch (e) { if (x.stale && x.stale()) return; body.innerHTML = '<div class="err">' + esc((e && e.message) || 'Could not open the file') + '</div>'; return; }
  if (x.stale && x.stale()) return;
  const head = String(t.text || '').slice(0, 4000);
  if (t.binary || t.truncated || (t.size || 0) > MAX || head.indexOf('\u0000') >= 0 || ((head.match(/�/g) || []).length > 3)) { x.notEditable(t.truncated || (t.size || 0) > MAX ? 'This file is larger than 1 MB' : 'This is not a text file'); return; }

  let raw = String(t.text || ''); // exactly what is on disk now, for the "changed since you opened it" check
  const sp = splitEol(raw); const { eol, text } = sp; let bom = sp.bom;
  if (!bom) { try { const bytes = await fs.readBytes(uri, path); bom = !!bytes && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF; } catch (e) { /* keep as is */ } } // text readers drop a BOM; the bytes still show it
  const lang = editorLang(path);
  const saved = Object.assign({}, DEF, (await x.kv.get('editor', {})) || {});
  if (!saved.mig2) { saved.sug = false; saved.mig2 = 1; x.kv.set('editor', Object.assign({}, saved)); } // v1.54.1: Suggestions start off, once for everyone
  const dark = () => document.documentElement.dataset.theme === 'dark';
  const unitOf = (v) => (v === 'auto' ? ed.detectIndent(2) : v);
  let ed = null; let busy = false; let pop = null; let alive = true;

  body.innerHTML = '<div class="ed">' +
    '<div class="ed-bar"><span class="ed-meta" id="edMeta"></span><span class="ed-tools">' +
    '<button id="edUndo" class="ed-ib" type="button" aria-label="Undo" disabled>' + ICON('undo') + '</button>' +
    '<button id="edRedo" class="ed-ib" type="button" aria-label="Redo" disabled>' + ICON('redo') + '</button>' +
    '<button id="edFind" class="ed-ib" type="button" aria-label="Find and replace">' + ICON('search') + '</button>' +
    '<button id="edAa" class="ed-ib ed-more" type="button" aria-label="Editor options" aria-haspopup="true">' + ICON('dots') + '</button>' +
    '<button id="edSave" class="ed-save" type="button" disabled>' + ICON('check') + '<span class="lbl">Save</span></button></span></div>' +
    (x.kind === 'server' ? '<div class="ed-note">Saving writes straight to the server. It cannot be undone from the app.</div>' : '') +
    '<div class="ed-host" id="edHost"></div></div>';
  foot.className = 'sheet-foot edfoot'; foot.classList.remove('hidden');
  foot.innerHTML = '<div class="ed-st"><span id="edState" class="ed-state">Saved</span><span id="edPos" class="ed-pos"></span></div>' +
    '<div class="ed-keys" id="edKeys"><button type="button" class="ed-k ed-tab" data-k="TAB" aria-label="Tab">Tab</button>' + KEYS.map((k) => '<button type="button" class="ed-k" data-k="' + esc(k) + '">' + esc(k) + '</button>').join('') + '</div>';
  const $b = (id) => body.querySelector('#' + id); const $f = (id) => foot.querySelector('#' + id);
  const showKeys = () => { $f('edKeys').style.display = saved.keys === false ? 'none' : ''; };
  showKeys();
  // While the keyboard is up, the bottom safe-area padding is wasted space: the extra keys should sit right on the keyboard.
  const sheetEl = body.closest('#sheet');
  // The keyboard counts as open when the screen got clearly shorter than it was, or while a text box has focus.
  const vh = () => (window.visualViewport ? window.visualViewport.height : window.innerHeight);
  let base = vh(); let baseW = window.innerWidth; let focused = false;
  const sync = () => {
    if (window.innerWidth !== baseW) { baseW = window.innerWidth; base = vh(); } // turned the phone: measure again
    if (vh() > base) base = vh();
    const shrunk = base - vh() > 150;
    if (sheetEl) sheetEl.classList.toggle('ed-kb', shrunk || focused);
  };
  const kbOff = () => { focused = false; if (sheetEl) sheetEl.classList.remove('ed-kb'); };
  const isBox = (a) => !!(a && a.matches && a.matches('.cm-content,input,textarea') && body.contains(a));
  const onIn = (e) => { if (isBox(e.target)) { focused = true; sync(); } };
  const onOut = () => setTimeout(() => { focused = isBox(document.activeElement); sync(); }, 60);
  const onSize = () => sync();
  window.addEventListener('resize', onSize); if (window.visualViewport) window.visualViewport.addEventListener('resize', onSize);
  body.addEventListener('focusin', onIn); body.addEventListener('focusout', onOut);

  const label = lang ? (LANG_NAME[lang] || lang) : 'Text';
  let pos = { line: 1, col: 1, lines: 1 };
  const drawPos = () => { $f('edPos').textContent = label + ' · Ln ' + pos.line + ', Col ' + pos.col; $b('edMeta').textContent = pos.lines + ' line' + (pos.lines === 1 ? '' : 's'); };
  const refresh = () => {
    const d = ed.dirty();
    $b('edSave').disabled = busy || !d; $b('edSave').classList.toggle('on', d && !busy);
    const st = $f('edState'); st.textContent = d ? 'Unsaved changes' : 'Saved'; st.classList.toggle('dirty', d);
    $b('edUndo').disabled = !ed.canUndo(); $b('edRedo').disabled = !ed.canRedo();
  };

  ed = KCM.create($b('edHost'), text, {
    lang, dark: dark(), size: saved.size, wrap: saved.wrap, spaces: saved.spaces, guides: true, lines: saved.lines, sug: saved.sug, label: 'Editing ' + name,
    onChange: refresh, onCursor: (p) => { pos = p; drawPos(); },
  });
  body.querySelector('.ed').editor = ed; // handle for tests and debugging
  ed.opt('indent', unitOf(saved.indent)); drawPos(); refresh();
  const themeWatch = new MutationObserver(() => ed.opt('dark', dark())); themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---- save
  async function save() {
    if (busy || !ed.dirty()) return true;
    busy = true; refresh();
    try {
      let cur = null; try { cur = await fs.readText(uri, path, MAX + 1); } catch (e) { cur = null; }
      if (cur && !cur.binary && String(cur.text || '') !== raw) {
        const r = await choiceBox('File changed', name + ' changed after you opened it, by another app or by the agent. Replace it with your version?', ['Replace']);
        if (r !== 0) { busy = false; refresh(); return false; }
      }
      const out = joinEol(ed.doc, eol, bom);
      await fs.writeText(uri, path, out);
      raw = out; ed.mark();
      busy = false; refresh();
      return true;
    } catch (e) {
      busy = false; refresh();
      toast((e && e.message) || 'Could not save the file', { kind: 'err' });
      return false;
    }
  }

  // ---- leaving: Save / Discard / Cancel
  const guard = async () => {
    closePop();
    if (!ed.dirty()) return true;
    const r = await choiceBox('Save changes?', 'You changed ' + name + ' but did not save it.', ['Save', 'Discard'], { stack: true });
    if (r === 0) return save();
    return r === 1;
  };
  const cleanup = () => { alive = false; kbOff(); window.removeEventListener('resize', onSize); if (window.visualViewport) window.visualViewport.removeEventListener('resize', onSize); body.removeEventListener('focusin', onIn); body.removeEventListener('focusout', onOut); themeWatch.disconnect(); closePop(); try { ed.destroy(); } catch (e) { /* ignore */ } foot.className = 'sheet-foot hidden'; foot.innerHTML = ''; };
  x.setGuard(guard, cleanup);
  x.setBack(() => { if (pop) { closePop(); return true; } if (ed.findOpen()) { ed.closeFind(); ed.focus(); return true; } return false; });

  // ---- bar buttons (mousedown keeps the editor focused, so the keyboard stays open)
  const keep = (el, fn) => { el.addEventListener('mousedown', (e) => e.preventDefault()); el.addEventListener('click', fn); };
  keep($b('edUndo'), () => { ed.undo(); refresh(); ed.focus(); });
  keep($b('edRedo'), () => { ed.redo(); refresh(); ed.focus(); });
  keep($b('edFind'), () => { closePop(); if (ed.findOpen()) { ed.closeFind(); ed.focus(); } else ed.find(); });
  $b('edSave').onclick = () => { save(); };
  $b('edAa').onclick = () => { if (pop) closePop(); else openPop(); };
  foot.querySelectorAll('.ed-k').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { if (b.dataset.k === 'TAB') ed.tab(); else ed.insert(b.dataset.k); ed.focus(); });
  });

  // ---- options popover
  function closePop() { if (pop) { pop.remove(); pop = null; $b('edAa') && $b('edAa').classList.remove('on'); } }
  function openPop() {
    pop = document.createElement('div'); pop.className = 'ed-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Editor options');
    const seg = (id, items, cur) => '<div class="ed-seg" id="' + id + '">' + items.map((i) => '<button type="button" data-v="' + i[0] + '" class="' + (String(i[0]) === String(cur) ? 'on' : '') + '">' + i[1] + '</button>').join('') + '</div>';
    const sw = (id, label, on) => '<label class="ed-sw"><span>' + label + '</span><input id="' + id + '" type="checkbox"' + (on ? ' checked' : '') + '><i></i></label>';
    const detected = ed.detectIndent(2);
    const act = (id, label) => '<button type="button" class="ed-act" id="' + id + '"><span>' + label + '</span></button>';
    pop.innerHTML = '<div class="ed-row"><span>Font size</span><div class="ed-step"><button type="button" id="szDn" aria-label="Smaller">A−</button><b id="szV">' + saved.size + '</b><button type="button" id="szUp" aria-label="Larger">A+</button></div></div>' +
      '<div class="ed-row"><span>Indent</span>' + seg('edInd', [['auto', 'Auto'], [2, '2'], [4, '4'], ['tab', 'Tab']], saved.indent) + '</div>' +
      '<div class="ed-hint" id="edIndHint"></div>' +
      sw('swWrap', 'Wrap long lines', saved.wrap) + sw('swNum', 'Line numbers', saved.lines) + sw('swSp', 'Show spaces', saved.spaces) +
      sw('swSug', 'Suggestions', saved.sug) + sw('swKeys', 'Extra keys', saved.keys !== false) + act('edGoto', 'Go to line');
    body.querySelector('.ed').appendChild(pop); $b('edAa').classList.add('on');
    const hint = () => { const h = pop && pop.querySelector('#edIndHint'); if (h) h.textContent = saved.indent === 'auto' ? 'This file uses ' + (detected === 'tab' ? 'tabs' : detected + ' spaces') + '.' : ''; if (h) h.style.display = saved.indent === 'auto' ? '' : 'none'; };
    hint();
    const store = () => x.kv.set('editor', Object.assign({}, saved));
    const size = (d) => { const i = Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(saved.size) + d)); saved.size = SIZES[i]; pop.querySelector('#szV').textContent = saved.size; ed.opt('size', saved.size); store(); };
    pop.querySelector('#szDn').onclick = () => size(-1); pop.querySelector('#szUp').onclick = () => size(1);
    pop.querySelectorAll('#edInd button').forEach((b) => { b.onclick = () => { saved.indent = b.dataset.v === 'auto' || b.dataset.v === 'tab' ? b.dataset.v : Number(b.dataset.v); pop.querySelectorAll('#edInd button').forEach((o) => o.classList.toggle('on', o === b)); ed.opt('indent', unitOf(saved.indent)); hint(); store(); }; });
    const tog = (id, key, apply) => { pop.querySelector('#' + id).onchange = (e) => { saved[key] = e.target.checked; apply(saved[key]); store(); }; };
    tog('swWrap', 'wrap', (v) => ed.opt('wrap', v)); tog('swNum', 'lines', (v) => ed.opt('lines', v)); tog('swSp', 'spaces', (v) => ed.opt('spaces', v));
    tog('swSug', 'sug', (v) => ed.opt('sug', v)); tog('swKeys', 'keys', () => showKeys());
    pop.querySelector('#edGoto').onclick = () => { closePop(); ed.goto(); };
    pop.addEventListener('mousedown', (e) => e.stopPropagation());
    setTimeout(() => { const off = (e) => { if (!alive) { document.removeEventListener('pointerdown', off, true); return; } if (pop && !pop.contains(e.target) && e.target !== $b('edAa') && !$b('edAa').contains(e.target)) { closePop(); document.removeEventListener('pointerdown', off, true); } if (!pop) document.removeEventListener('pointerdown', off, true); }; document.addEventListener('pointerdown', off, true); }, 0);
  }
  return { save, guard, ed };
}
