// KDex Agent code editor: CodeMirror 6 wrapped in a tiny factory.
// Built into www/vendor/codemirror.min.js (see build.mjs). Exposes window.KCM.
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, highlightActiveLine, highlightWhitespace } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth, indentMore } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel, searchPanelOpen, gotoLine, SearchQuery, setSearchQuery, getSearchQuery, findNext, findPrevious, replaceNext, replaceAll } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { indentUnit, indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';

// Colours come from the app's own CSS variables, so the editor follows light/dark automatically
// and matches the read-only file viewer.
const v = (n) => 'var(--' + n + ')';
const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v('tk-c'), fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string), t.regexp, t.attributeValue], color: v('tk-s') },
  { tag: [t.number, t.bool, t.null, t.atom, t.color, t.unit], color: v('tk-n') },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.tagName, t.self], color: v('tk-k') },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.macroName], color: v('tk-f') },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName), t.standard(t.tagName)], color: v('tk-t') },
  { tag: [t.propertyName, t.attributeName, t.labelName, t.definition(t.propertyName)], color: v('tk-p') },
  { tag: [t.heading, t.strong], fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: v('tk-f'), textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--bad-text, #C23535)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace', lineHeight: '1.55', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--ink)', padding: '6px 0' },
  '.cm-line': { padding: '0 8px 0 6px' },
  '.cm-gutters': { backgroundColor: 'var(--cm-gut)', color: 'var(--mut)', border: 'none', borderRight: '1px solid var(--cm-gut-line)', boxShadow: '2px 0 6px var(--cm-gut-shadow)', paddingLeft: '2px', zIndex: '2' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 4px', minWidth: '28px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--ink) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)', fontWeight: '700' },
  '&.cm-focused > .cm-scroller > .cm-cursorLayer .cm-cursor, .cm-cursor': { borderLeftColor: 'var(--ink)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--ink) 24%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--ink) 14%, transparent)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--ink) 20%, transparent)', outline: '1px solid color-mix(in srgb, var(--ink) 55%, transparent)', color: 'inherit' },
  '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'color-mix(in srgb, var(--bad-text, #C23535) 22%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, #f5b301 38%, transparent)', outline: 'none' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--ink) 40%, transparent)' },
  '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: '1px solid var(--line)', color: 'var(--mut)', padding: '0 5px', borderRadius: '6px' },
  '.cm-foldGutter span': { cursor: 'pointer', padding: '0 2px' },
  '.cm-specialChar': { color: 'var(--bad-text, #C23535)' },
  '.cm-highlightSpace': { backgroundImage: 'radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--fg) 45%, transparent) 11%, transparent 24%)' },
  '.cm-highlightTab': { backgroundSize: '1em 100%', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'20\'%3E%3Cpath stroke=\'%23888\' stroke-opacity=\'.7\' stroke-width=\'1.5\' fill=\'none\' d=\'M1 10H196L190 5M196 10L190 15\'/%3E%3C/svg%3E")' },
  '.cm-tooltip': { backgroundColor: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 6px 20px rgba(0,0,0,.18)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '170px' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'color-mix(in srgb, var(--ink) 16%, transparent)', color: 'var(--fg)' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700', color: 'var(--ink)' },
  '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--fg)', borderTop: '1px solid var(--line)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--line)', borderTop: 'none' },
});

const PHRASES = { Find: 'Find', Replace: 'Replace', next: 'Next', previous: 'Prev', all: 'All', replace: 'Replace', 'replace all': 'Replace all', 'match case': 'Match case', 'by word': 'Whole word', regexp: 'Regex', close: 'Close', 'Go to line': 'Go to line', go: 'Go', 'Selection deleted': 'Selection deleted', 'current match': 'Current match', 'on line': 'on line' };
const LANGS = { html, xml: html, svg: html, vue: html, js: () => javascript({ jsx: true }), ts: () => javascript({ jsx: true, typescript: true }), py: python, css, json };
const langExt = (l) => { const f = LANGS[l]; try { return f ? f() : []; } catch (_) { return []; } };


// ---- find and replace panel: our own markup so it matches the app (switches sit inside the search box)
const SVG = { up: '<path d="M12 19V6M6 11l6-6 6 6"/>', down: '<path d="M12 5v13M6 13l6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>' };
const svg = (n) => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SVG[n] + '</svg>';
function createFindPanel(view) {
  const dom = document.createElement('div'); dom.className = 'cm-search kfind';
  dom.innerHTML = '<div class="kf-row">' +
    '<div class="kf-box"><input class="kf-in" name="search" type="text" placeholder="Find" aria-label="Find" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" main-field="true">' +
    '<span class="kf-tg"><button type="button" name="case" class="kf-t" aria-pressed="false" aria-label="Match case" title="Match case">Aa</button>' +
    '<button type="button" name="word" class="kf-t" aria-pressed="false" aria-label="Whole word" title="Whole word">ab</button>' +
    '<button type="button" name="re" class="kf-t" aria-pressed="false" aria-label="Regular expression" title="Regular expression">.*</button></span></div>' +
    '<button type="button" name="prev" class="kf-b" aria-label="Previous match">' + svg('up') + '</button>' +
    '<button type="button" name="next" class="kf-b" aria-label="Next match">' + svg('down') + '</button>' +
    '<button type="button" name="close" class="kf-x" aria-label="Close">' + svg('x') + '</button></div><div class="kf-row">' +
    '<input class="kf-in kf-rep" name="replace" type="text" placeholder="Replace with" aria-label="Replace with" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">' +
    '<button type="button" name="replaceOne" class="kf-r">Replace</button><button type="button" name="replaceAll" class="kf-r">Replace all</button></div>';
  const $ = (n) => dom.querySelector('[name=' + n + ']');
  const inS = $('search'), inR = $('replace');
  const st = { case: false, word: false, re: false };
  const q0 = getSearchQuery(view.state); inS.value = q0.search; inR.value = q0.replace;
  st.case = q0.caseSensitive; st.word = q0.wholeWord; st.re = q0.regexp;
  const paint = () => { for (const k of ['case', 'word', 're']) { const b = $(k); b.classList.toggle('on', st[k]); b.setAttribute('aria-pressed', String(st[k])); } };
  const commit = () => view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: inS.value, replace: inR.value, caseSensitive: st.case, wholeWord: st.word, regexp: st.re })) });
  const end = (el) => { try { el.scrollLeft = el.scrollWidth; } catch (_) { /* ignore */ } };
  inS.addEventListener('input', () => { commit(); end(inS); }); inR.addEventListener('input', () => { commit(); end(inR); });
  for (const k of ['case', 'word', 're']) $(k).addEventListener('click', () => { st[k] = !st[k]; paint(); commit(); inS.focus(); });
  // mousedown on buttons would move focus out of the editor and drop the keyboard
  dom.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  $('next').addEventListener('click', () => findNext(view)); $('prev').addEventListener('click', () => findPrevious(view));
  $('replaceOne').addEventListener('click', () => replaceNext(view)); $('replaceAll').addEventListener('click', () => replaceAll(view));
  $('close').addEventListener('click', () => { closeSearchPanel(view); view.focus(); });
  dom.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearchPanel(view); view.focus(); }
    else if (e.key === 'Enter' && e.target === inS) { e.preventDefault(); (e.shiftKey ? findPrevious : findNext)(view); }
    else if (e.key === 'Enter' && e.target === inR) { e.preventDefault(); replaceNext(view); }
  });
  paint();
  return {
    dom, top: false,
    mount() { inS.focus(); inS.select(); },
    update(u) {
      const q = getSearchQuery(u.state);
      if (q.search !== inS.value && document.activeElement !== inS) inS.value = q.search;
      if (q.replace !== inR.value && document.activeElement !== inR) inR.value = q.replace;
    },
  };
}

// A final empty line (after the last newline) is not counted, like the file viewer.
const count = (d) => d.lines - (d.lines > 1 && d.line(d.lines).length === 0 ? 1 : 0);
function create(parent, doc, o = {}) {
  const C = { lang: new Compartment(), wrap: new Compartment(), ws: new Compartment(), guides: new Compartment(), nums: new Compartment(), indent: new Compartment(), size: new Compartment(), dark: new Compartment(), sug: new Compartment() };
  const cb = { change: o.onChange || (() => {}), cursor: o.onCursor || (() => {}) };
  const opts = { wrap: o.wrap !== false, spaces: !!o.spaces, guides: o.guides !== false, lines: o.lines !== false, indent: o.indent || 2, sug: o.sug !== false, size: o.size || 13, dark: !!o.dark };
  const unitOf = (n) => (n === 'tab' ? '\t' : ' '.repeat(+n || 2));
  const ext = {
    wrap: () => (opts.wrap ? EditorView.lineWrapping : []),
    ws: () => (opts.spaces ? highlightWhitespace() : []),
    guides: () => (opts.guides ? indentationMarkers({ hideFirstIndent: true, thickness: 1, activeThickness: 2, markerType: 'fullScope', colors: { light: 'var(--cm-guide)', dark: 'var(--cm-guide)', activeLight: 'var(--cm-guide-on)', activeDark: 'var(--cm-guide-on)' } }) : []),
    nums: () => (opts.lines ? [lineNumbers(), highlightActiveLineGutter(), foldGutter({ openText: '▾', closedText: '▸' })] : []),
    indent: () => [indentUnit.of(unitOf(opts.indent)), EditorState.tabSize.of(opts.indent === 'tab' ? 4 : +opts.indent || 2)],
    size: () => EditorView.theme({ '&': { fontSize: opts.size + 'px' } }),
    dark: () => EditorView.theme({}, { dark: opts.dark }),
    sug: () => (opts.sug ? autocompletion({ activateOnTyping: true, icons: false, maxRenderedOptions: 40 }) : []),
  };
  let timer = 0; let savedDoc = null;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.phrases.of(PHRASES),
        history(), drawSelection(), dropCursor(), highlightSpecialChars(), indentOnInput(), bracketMatching(), closeBrackets(),
        search({ top: false, createPanel: createFindPanel }),
        highlightActiveLine(), highlightSelectionMatches(), EditorState.allowMultipleSelections.of(true),
        syntaxHighlighting(highlight, { fallback: true }),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
        theme,
        C.lang.of(langExt(o.lang)), C.wrap.of(ext.wrap()), C.ws.of(ext.ws()), C.guides.of(ext.guides()), C.nums.of(ext.nums()), C.indent.of(ext.indent()), C.size.of(ext.size()), C.dark.of(ext.dark()), C.sug.of(ext.sug()),
        EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off', 'aria-label': o.label || 'Code editor' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.change(u);
          if (u.docChanged || u.selectionSet) { clearTimeout(timer); timer = setTimeout(() => { const s = view.state, h = s.selection.main, ln = s.doc.lineAt(h.head); cb.cursor({ line: ln.number, col: h.head - ln.from + 1, lines: count(s.doc) }); }, 30); }
        }),
      ],
    }),
  });
  const set = (k) => view.dispatch({ effects: C[k].reconfigure(ext[k]()) });
  const api = {
    view,
    get doc() { return view.state.sliceDoc(0); },
    get lines() { return view.state.doc.lines; },
    mark: () => { savedDoc = view.state.doc; },
    dirty: () => !savedDoc || !view.state.doc.eq(savedDoc),
    focus: () => view.focus(),
    undo: () => undo(view), redo: () => redo(view),
    canUndo: () => undoDepth(view.state) > 0, canRedo: () => redoDepth(view.state) > 0,
    find: () => openSearchPanel(view), closeFind: () => closeSearchPanel(view), findOpen: () => searchPanelOpen(view.state),
    goto: () => gotoLine(view),
    insert: (s) => { view.dispatch(view.state.replaceSelection(s)); },
    tab: () => { const m = view.state.selection.main; if (!m.empty && view.state.doc.lineAt(m.from).number !== view.state.doc.lineAt(m.to).number) indentMore(view); else api.insert(opts.indent === 'tab' ? '\t' : ' '.repeat(+opts.indent || 2)); },
    setLang: (l) => view.dispatch({ effects: C.lang.reconfigure(langExt(l)) }),
    opt: (k, val) => { opts[k] = val; set({ spaces: 'ws', lines: 'nums' }[k] || k); },
    // Pick the indent used by the file itself (first indented line), else the given default.
    detectIndent: (def = 2) => { const m = /^(\t+|( {2,8}))\S/m.exec(view.state.doc.toString().slice(0, 40000)); return !m ? def : m[1][0] === '\t' ? 'tab' : (m[2].length === 2 || m[2].length === 4 ? m[2].length : def); },
    destroy: () => { clearTimeout(timer); view.destroy(); },
  };
  savedDoc = view.state.doc;
  cb.cursor({ line: 1, col: 1, lines: count(view.state.doc) });
  return api;
}

window.KCM = { create, version: '6' };
