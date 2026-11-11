// Bridge to the native Android plugin, with a browser fallback so the UI can be developed and tested
// in a normal browser (in-memory folder, fetch for HTTP).
import { uid } from './util.js';

const cap = typeof window !== 'undefined' ? window.Capacitor : null;
export const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
const plugin = isNative ? cap.registerPlugin('KdexNative') : null;

// ---------------------------------------------------------------- secure storage
export const secure = {
  async get(key) {
    if (plugin) { const r = await plugin.secureGet({ key }); return r && r.value != null ? r.value : null; }
    try { const v = localStorage.getItem('sec:' + key); return v === null ? null : v; } catch (e) { return null; }
  },
  async set(key, value) {
    if (plugin) { await plugin.secureSet({ key, value }); return; }
    try { localStorage.setItem('sec:' + key, value); } catch (e) { /* ignore */ }
  },
  async remove(key) {
    if (plugin) { await plugin.secureRemove({ key }); return; }
    try { localStorage.removeItem('sec:' + key); } catch (e) { /* ignore */ }
  },
};

// ---------------------------------------------------------------- streaming HTTP
const waiters = new Map();
let listenerReady = null;
function ensureListener() {
  if (!plugin) return Promise.resolve();
  if (!listenerReady) {
    listenerReady = plugin.addListener('http', (ev) => {
      const w = waiters.get(ev.id);
      if (w) w(ev);
    });
  }
  return listenerReady;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Open a streaming request. Returns { status, body } where body is an async iterable of text chunks.
 * `signal` (AbortSignal) cancels the request.
 */
export async function httpStream({ url, method = 'POST', headers = {}, body = null, signal }) {
  if (!plugin) {
    const res = await fetch(url, { method, headers, body, signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    return {
      status: res.status,
      body: (async function* () {
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          yield dec.decode(r.value, { stream: true });
        }
      })(),
    };
  }

  await ensureListener();
  const id = uid();
  const queue = [];
  let wake = null;
  let finished = false;
  let failure = null;
  let status = 0;
  let headResolve;
  const headReady = new Promise((r) => { headResolve = r; });
  const dec = new TextDecoder('utf-8');

  waiters.set(id, (ev) => {
    if (ev.type === 'head') { status = ev.status; headResolve(); return; }
    if (ev.type === 'chunk') queue.push(dec.decode(b64ToBytes(ev.b64), { stream: true }));
    else if (ev.type === 'end') { finished = true; headResolve(); }
    else if (ev.type === 'error') { failure = new Error(ev.message || 'Network error'); finished = true; headResolve(); }
    if (wake) { const w = wake; wake = null; w(); }
  });

  const cancel = () => { plugin.httpCancel({ id }).catch(() => {}); };
  if (signal) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    signal.addEventListener('abort', () => { finished = true; failure = failure || new DOMException('Aborted', 'AbortError'); cancel(); if (wake) { const w = wake; wake = null; w(); } headResolve(); });
  }

  await plugin.httpStart({ id, url, method, headers, body });
  await headReady;
  if (failure && !status) { waiters.delete(id); throw failure; }

  return {
    status,
    body: (async function* () {
      try {
        for (;;) {
          while (queue.length) yield queue.shift();
          if (finished) break;
          await new Promise((r) => { wake = r; });
        }
        if (failure) throw failure;
      } finally {
        waiters.delete(id);
      }
    })(),
  };
}

// ---------------------------------------------------------------- folder access
// Browser fallback: a small in-memory demo folder so the UI works without a phone.
const memFolders = new Map();
function memFolder(uri) {
  if (!memFolders.has(uri)) memFolders.set(uri, new Map());
  return memFolders.get(uri);
}

export const fs = {
  async pickFolder() {
    if (plugin) return plugin.pickFolder();
    const uri = 'mem://demo-' + Math.random().toString(36).slice(2, 6);
    const m = memFolder(uri);
    m.set('README.md', '# Demo folder\n\nThis folder lives in memory (browser test mode).\n');
    m.set('app/main.py', 'def is_admin(user_id):\n    admins = load_admins()\n    return user_id in admins\n');
    m.set('app/config.py', 'ADMIN_IDS = [\n]\n');
    return { uri, name: 'demo', path: 'demo' };
  },
  async releaseFolder(uri) { if (plugin) await plugin.releaseFolder({ uri }); },
  async list(uri, path = '') {
    if (plugin) return (await plugin.list({ uri, path })).entries;
    const m = memFolder(uri);
    const base = path ? path.replace(/\/+$/, '') + '/' : '';
    const seen = new Map();
    for (const [p, t] of m) {
      if (!p.startsWith(base)) continue;
      const rest = p.slice(base.length);
      const i = rest.indexOf('/');
      if (i >= 0) seen.set(rest.slice(0, i), { name: rest.slice(0, i), path: base + rest.slice(0, i), isDir: true, size: 0 });
      else seen.set(rest, { name: rest, path: base + rest, isDir: false, size: t.length });
    }
    return Array.from(seen.values());
  },
  async walk(uri, path = '', max = 3000) {
    if (plugin) return plugin.walk({ uri, path, max });
    const m = memFolder(uri);
    const base = path ? path.replace(/\/+$/, '') + '/' : '';
    const files = [];
    for (const [p, t] of m) if (p.startsWith(base)) files.push({ name: p.split('/').pop(), path: p, isDir: false, size: t.length });
    return { files, truncated: false };
  },
  async stat(uri, path) {
    if (plugin) return plugin.stat({ uri, path });
    const m = memFolder(uri);
    if (m.has(path)) return { exists: true, isDir: false, size: m.get(path).length };
    const base = path.replace(/\/+$/, '') + '/';
    for (const p of m.keys()) if (p.startsWith(base)) return { exists: true, isDir: true, size: 0 };
    return { exists: false };
  },
  async readText(uri, path, maxBytes = 1048576) {
    if (plugin) return plugin.readText({ uri, path, maxBytes });
    const m = memFolder(uri);
    if (!m.has(path)) throw new Error('Not found: ' + path);
    const t = m.get(path);
    return { text: t.slice(0, maxBytes), size: t.length, binary: false, truncated: t.length > maxBytes };
  },
  async writeText(uri, path, text) {
    if (plugin) { await plugin.writeText({ uri, path, text }); return; }
    memFolder(uri).set(path, text);
  },
  async remove(uri, path) {
    if (plugin) { await plugin.remove({ uri, path }); return; }
    if (!memFolder(uri).delete(path)) throw new Error('Not found: ' + path);
  },
};

// ---------------------------------------------------------------- misc
export const App = cap && cap.Plugins && cap.Plugins.App ? cap.Plugins.App : null;
