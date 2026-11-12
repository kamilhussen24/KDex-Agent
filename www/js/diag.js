// Diagnostics log: a small, private ring buffer of what the app did and what failed.
// Stays on this phone. Secrets are masked before anything is stored.
import { kvGet, kvSet } from './db.js';

const MAX = 300;
let items = [];
let loaded = false;
let timer = null;

/** Masks tokens and keys so a copied log is safe to share. */
export function scrub(text) {
  return String(text == null ? '' : text)
    .replace(/(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/g, '$1_***')
    .replace(/\bglpat-[A-Za-z0-9_-]{12,}/g, 'glpat-***')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    .replace(/\bAKIA[0-9A-Z]{12,}/g, 'AKIA***')
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 ***')
    .replace(/(token|secret|password|passwd|api[_-]?key)(["'\s:=]+)([^\s"',;]{6,})/gi, '$1$2***')
    .replace(/:\/\/[^/\s:@]+:[^/\s@]+@/g, '://***@')
    .slice(0, 1500);
}

async function load() {
  if (loaded) return;
  loaded = true;
  try { const v = await kvGet('diag.log'); if (Array.isArray(v)) items = v.concat(items).slice(-MAX); } catch (e) { /* storage unavailable */ }
}
function save() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; kvSet('diag.log', items).catch(() => {}); }, 800);
}

/** kind: 'error' | 'git' | 'run' | 'info' */
export function log(kind, message) {
  items.push({ t: Date.now(), k: kind, m: scrub(message) });
  if (items.length > MAX) items = items.slice(-MAX);
  load().then(save);
}
export async function entries() { await load(); return items.slice().reverse(); }
export async function clear() { items = []; loaded = true; await kvSet('diag.log', []); }

export function format(list, info = {}) {
  const head = ['KDex Agent diagnostics', ...Object.entries(info).map(([k, v]) => k + ': ' + v), ''];
  const pad = (n) => String(n).padStart(2, '0');
  const rows = list.slice().reverse().map((e) => {
    const d = new Date(e.t);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '  ' + e.k.padEnd(5) + ' ' + e.m;
  });
  return head.concat(rows).join('\n');
}

let installed = false;
export function install() {
  if (installed) return; installed = true;
  window.addEventListener('error', (ev) => log('error', (ev.message || 'Script error') + (ev.filename ? ' (' + String(ev.filename).split('/').pop() + ':' + ev.lineno + ')' : '')));
  window.addEventListener('unhandledrejection', (ev) => log('error', 'Unhandled: ' + ((ev.reason && ev.reason.message) || ev.reason)));
  load();
}
