// Diff viewer: old/new line numbers, green and red lines, changed words highlighted, unchanged parts folded.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CTX = 3;
const MAX_ROWS = 2000;
const MAX_CHARS = 600000;

/** Line operations between two texts: [{ t: 'ctx'|'add'|'del', text, a, b }] with 1-based line numbers. */
export function diffOps(before, after) {
  const lines = (t) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'));
  const A = lines(before);
  const B = lines(after);
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const midA = A.slice(pre, A.length - suf); const midB = B.slice(pre, B.length - suf);
  const out = [];
  for (let i = 0; i < pre; i++) out.push({ t: 'ctx', text: A[i], a: i + 1, b: i + 1 });
  const m = midA.length; const n = midB.length;
  let ai = pre + 1; let bi = pre + 1;
  if (m * n <= 1500000) {
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0; let j = 0;
    while (i < m && j < n) {
      if (midA[i] === midB[j]) { out.push({ t: 'ctx', text: midA[i], a: ai++, b: bi++ }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', text: midA[i++], a: ai++ }); }
      else { out.push({ t: 'add', text: midB[j++], b: bi++ }); }
    }
    while (i < m) out.push({ t: 'del', text: midA[i++], a: ai++ });
    while (j < n) out.push({ t: 'add', text: midB[j++], b: bi++ });
  } else {
    midA.forEach((t) => out.push({ t: 'del', text: t, a: ai++ }));
    midB.forEach((t) => out.push({ t: 'add', text: t, b: bi++ }));
  }
  for (let k = 0; k < suf; k++) out.push({ t: 'ctx', text: A[A.length - suf + k], a: ai++, b: bi++ });
  return out;
}

/** Marks which part of two paired lines differs: common start and end stay plain. */
function wordMark(x, y) {
  let p = 0; while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let q = 0; while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
  const cut = (s, cls) => esc(s.slice(0, p)) + (s.length - p - q > 0 ? '<mark class="' + cls + '">' + esc(s.slice(p, s.length - q)) + '</mark>' : '') + esc(s.slice(s.length - q));
  if (p + q >= Math.max(x.length, y.length) * 0.85 && p + q > 0 && x.length > 0 && y.length > 0) return [cut(x, 'wr'), cut(y, 'wa')];
  return [esc(x), esc(y)];
}

/** Returns { added, removed, rows } where rows are ready-made HTML lines and fold markers. */
export function buildDiff(before, after) {
  const ops = diffOps(before, after);
  let added = 0; let removed = 0;
  ops.forEach((o) => { if (o.t === 'add') added++; else if (o.t === 'del') removed++; });
  // paired changed lines get word highlights
  const html = new Array(ops.length);
  for (let i = 0; i < ops.length;) {
    if (ops[i].t === 'ctx') { html[i] = esc(ops[i].text); i++; continue; }
    let d = i; while (d < ops.length && ops[d].t === 'del') d++;
    let a = d; while (a < ops.length && ops[a].t === 'add') a++;
    const nd = d - i; const na = a - d;
    for (let k = i; k < a; k++) html[k] = esc(ops[k].text);
    if (nd > 0 && nd === na && nd <= 8) for (let k = 0; k < nd; k++) { const r = wordMark(ops[i + k].text, ops[d + k].text); html[i + k] = r[0]; html[d + k] = r[1]; }
    i = a;
  }
  // keep changed lines plus context, fold the rest
  const keep = new Uint8Array(ops.length);
  ops.forEach((o, i) => { if (o.t !== 'ctx') for (let k = Math.max(0, i - CTX); k <= Math.min(ops.length - 1, i + CTX); k++) keep[k] = 1; });
  const rows = []; let skipped = 0; let shown = 0; let more = 0;
  const line = (i) => {
    const o = ops[i];
    return '<div class="dr ' + o.t + '"><span class="dn">' + (o.a || '') + '</span><span class="dn">' + (o.b || '') + '</span><span class="ds">' + (o.t === 'add' ? '+' : o.t === 'del' ? '−' : '') + '</span><span class="dt">' + (html[i] || ' ') + '</span></div>';
  };
  for (let i = 0; i < ops.length; i++) {
    if (!keep[i]) { skipped++; continue; }
    if (skipped) { rows.push('<div class="dfold">' + skipped + ' unchanged line' + (skipped === 1 ? '' : 's') + '</div>'); skipped = 0; }
    if (shown >= MAX_ROWS) { more++; continue; }
    rows.push(line(i)); shown++;
  }
  if (skipped) rows.push('<div class="dfold">' + skipped + ' unchanged line' + (skipped === 1 ? '' : 's') + '</div>');
  if (more) rows.push('<div class="dfold">' + more + ' more changed lines not shown</div>');
  return { added, removed, rows: rows.join(''), same: added === 0 && removed === 0 };
}

/** Full HTML for a diff screen body. */
export function diffHtml(before, after) {
  if (before.length + after.length > MAX_CHARS) return '<div class="note">This file is large (' + Math.round((before.length + after.length) / 2048) + ' KB), so the line-by-line view is skipped.</div>';
  const d = buildDiff(before, after);
  if (d.same) return '<div class="note">No changes in the text of this file.</div>';
  return '<div class="dsum"><span class="ad">+' + d.added + '</span><span class="rm">−' + d.removed + '</span></div><div class="dv">' + d.rows + '</div>';
}
