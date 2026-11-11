// Small shared helpers.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

export function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function fmtTok(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'K';
  return (n / 1000000).toFixed(2) + 'M';
}


export function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export const dayKeyAgo = (n) => dayKey(Date.now() - n * 86400000);

/** Rough token estimate, Bengali-aware (Bengali text costs far more tokens per character). */
export function estimateTokens(s) {
  s = String(s || '');
  let t = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) t += 1 / 3.6;
    else if (c >= 0x980 && c <= 0x9ff) t += 1 / 1.1;
    else t += 1 / 1.5;
  }
  return Math.ceil(t);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Clean a relative path inside the chosen folder. Throws on anything that could escape. */
export function cleanRel(p) {
  const parts = [];
  String(p || '').replace(/\\/g, '/').split('/').forEach((seg) => {
    if (!seg || seg === '.') return;
    if (seg === '..') throw new Error('Path must stay inside the chosen folder');
    parts.push(seg);
  });
  return parts.join('/');
}

/** Copy text to the clipboard. Falls back to a hidden textarea because the Android WebView may refuse the async API. */
export async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* try the fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}
