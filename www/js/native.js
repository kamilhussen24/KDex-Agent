// Bridge to the native Android plugin, with a browser fallback so the UI can be developed and tested
// in a normal browser (in-memory folder, fetch for HTTP).
import { uid } from './util.js';
import { isScratchUri, scratchFs } from './scratch.js';
import { isRemoteUri, remoteFs, initRemote } from './remote.js';

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

initRemote({ plugin, secure });

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


const enc = new TextEncoder();
function bytesToB64(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Low-level request. Returns { status, headers, chunks } where chunks is an async iterable of Uint8Array.
 * `body` may be a string or a Uint8Array. `signal` (AbortSignal) cancels the request.
 */
export async function httpRaw({ url, method = 'POST', headers = {}, body = null, signal, noRedirect = false }) {
  if (!plugin) {
    const res = await fetch(url, { method, headers, body, signal });
    const hdrs = {}; res.headers.forEach((v, k) => { hdrs[k] = v; });
    const reader = res.body ? res.body.getReader() : null;
    return {
      status: res.status, headers: hdrs,
      chunks: (async function* () {
        if (!reader) return;
        for (;;) { const r = await reader.read(); if (r.done) break; yield r.value; }
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
  let respHeaders = {};
  let headResolve;
  const headReady = new Promise((r) => { headResolve = r; });

  waiters.set(id, (ev) => {
    if (ev.type === 'head') { status = ev.status; respHeaders = ev.headers || {}; headResolve(); return; }
    if (ev.type === 'chunk') queue.push(b64ToBytes(ev.b64));
    else if (ev.type === 'end') { finished = true; headResolve(); }
    else if (ev.type === 'error') { failure = new Error(ev.message || 'Network error'); finished = true; headResolve(); }
    if (wake) { const w = wake; wake = null; w(); }
  });

  const cancel = () => { plugin.httpCancel({ id }).catch(() => {}); };
  if (signal) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    signal.addEventListener('abort', () => { finished = true; failure = failure || new DOMException('Aborted', 'AbortError'); cancel(); if (wake) { const w = wake; wake = null; w(); } headResolve(); });
  }

  const req = { id, url, method, headers, noRedirect: !!noRedirect };
  if (body instanceof Uint8Array) req.bodyB64 = bytesToB64(body); else if (body != null) req.body = body;
  await plugin.httpStart(req);
  await headReady;
  if (failure && !status) { waiters.delete(id); throw failure; }

  return {
    status, headers: respHeaders,
    chunks: (async function* () {
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

/** Text streaming request (used for chat providers). Returns { status, body } where body yields strings. */
export async function httpStream(opts) {
  const r = await httpRaw(opts);
  const dec = new TextDecoder('utf-8');
  return {
    status: r.status,
    body: (async function* () {
      for await (const c of r.chunks) { const t = dec.decode(c, { stream: true }); if (t) yield t; }
      const tail = dec.decode(); if (tail) yield tail;
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
const memPut = (m, p, data) => m.set(p, { data: typeof data === 'string' ? enc.encode(data) : data, mtime: Date.now() });
const memText = (e) => new TextDecoder().decode(e.data);

// A project can live in a sub-folder of a picked tree. Its uri is "<tree uri>|<relative path>".
const treeOf = (uri) => { const i = String(uri).indexOf('|'); return i < 0 ? String(uri) : String(uri).slice(0, i); };
const baseOf = (uri) => { const i = String(uri).indexOf('|'); return i < 0 ? '' : String(uri).slice(i + 1); };
const jn = (b, p) => [b, p].filter(Boolean).join('/');
export const subUri = (uri, name) => treeOf(uri) + '|' + jn(baseOf(uri), name);
const rel = (uri, entries) => { const b = baseOf(uri); return b ? entries.map((e) => ({ ...e, path: String(e.path).slice(b.length + 1) })) : entries; };

export const fs = {
  async pickFolder() {
    if (plugin) return plugin.pickFolder();
    const uri = 'mem://demo-' + Math.random().toString(36).slice(2, 6);
    const m = memFolder(uri);
    if (typeof localStorage !== 'undefined' && localStorage.getItem('kdexEmptyDemo') === '1') return { uri, name: 'cloned', path: 'cloned' };
    memPut(m, 'README.md', '# Demo folder\n\nThis folder lives in memory (browser test mode).\n');
    memPut(m, 'app/main.py', 'def is_admin(user_id):\n    admins = load_admins()\n    return user_id in admins\n');
    memPut(m, 'app/config.py', 'ADMIN_IDS = [\n]\n');
    return { uri, name: 'demo', path: 'demo' };
  },
  /** Finds a folder by its typed path. Resolves { uri, name, path, full, items, writable, root } or rejects with a plain message. */
  async openPath(path) {
    if (plugin) return plugin.openPath({ path });
    const p = String(path || '').trim();
    if (!p) throw new Error('Type a folder path.');
    if (/missing|nothere/i.test(p)) throw new Error('No such folder: ' + p);
    if (/\.[a-z0-9]{1,4}$/i.test(p)) throw new Error('This is a file, not a folder: ' + p);
    const uri = 'mem://path-' + p.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const m = memFolder(uri); memPut(m, 'README.md', '# ' + p + '\n'); memPut(m, 'src/app.js', 'console.log(1);\n');
    return { uri, name: p.replace(/\/+$/, '').split('/').pop() || 'Storage', path: p, full: p, items: 2, writable: true, root: false };
  },
  async releaseFolder(uri) { if (isScratchUri(uri) || isRemoteUri(uri)) return; if (plugin && !baseOf(uri)) await plugin.releaseFolder({ uri }); },
  async list(uri, path = '') {
    if (isRemoteUri(uri)) return remoteFs.list(uri, path);
    if (isScratchUri(uri)) return scratchFs.list(uri, path);
    if (plugin) return rel(uri, (await plugin.list({ uri: treeOf(uri), path: jn(baseOf(uri), path) })).entries);
    const m = memFolder(uri);
    const base = path ? path.replace(/\/+$/, '') + '/' : '';
    const seen = new Map();
    for (const [p, e] of m) {
      if (!p.startsWith(base)) continue;
      const rest = p.slice(base.length);
      const i = rest.indexOf('/');
      if (i >= 0) seen.set(rest.slice(0, i), { name: rest.slice(0, i), path: base + rest.slice(0, i), isDir: true, size: 0, modified: e.mtime });
      else seen.set(rest, { name: rest, path: base + rest, isDir: false, size: e.data.length, modified: e.mtime });
    }
    return Array.from(seen.values());
  },
  async walk(uri, path = '', max = 3000) {
    if (isRemoteUri(uri)) return remoteFs.walk(uri, path, max);
    if (isScratchUri(uri)) return scratchFs.walk(uri, path, max);
    if (plugin) { const w = await plugin.walk({ uri: treeOf(uri), path: jn(baseOf(uri), path), max }); return { ...w, files: rel(uri, w.files) }; }
    const m = memFolder(uri);
    const base = path ? path.replace(/\/+$/, '') + '/' : '';
    const files = [];
    for (const [p, e] of m) if (p.startsWith(base)) files.push({ name: p.split('/').pop(), path: p, isDir: false, size: e.data.length });
    return { files, truncated: false };
  },
  async stat(uri, path) {
    if (isRemoteUri(uri)) return remoteFs.stat(uri, path);
    if (isScratchUri(uri)) return scratchFs.stat(uri, path);
    if (plugin) return plugin.stat({ uri: treeOf(uri), path: jn(baseOf(uri), path) });
    const m = memFolder(uri);
    if (m.has(path)) return { exists: true, isDir: false, size: m.get(path).data.length, modified: m.get(path).mtime };
    const base = path.replace(/\/+$/, '') + '/';
    for (const p of m.keys()) if (p.startsWith(base)) return { exists: true, isDir: true, size: 0, modified: 0 };
    return { exists: path === '', isDir: path === '', size: 0, modified: 0 };
  },
  async readText(uri, path, maxBytes = 1048576) {
    if (isRemoteUri(uri)) return remoteFs.readText(uri, path, maxBytes);
    if (isScratchUri(uri)) return scratchFs.readText(uri, path, maxBytes);
    if (plugin) return plugin.readText({ uri: treeOf(uri), path: jn(baseOf(uri), path), maxBytes });
    const m = memFolder(uri);
    if (!m.has(path)) throw new Error('Not found: ' + path);
    const e = m.get(path); const t = memText(e);
    return { text: t.slice(0, maxBytes), size: e.data.length, binary: false, truncated: e.data.length > maxBytes };
  },
  async writeText(uri, path, text) {
    if (isRemoteUri(uri)) return remoteFs.writeText(uri, path, text);
    if (isScratchUri(uri)) return scratchFs.writeText(uri, path, text);
    if (plugin) { await plugin.writeText({ uri: treeOf(uri), path: jn(baseOf(uri), path), text }); return; }
    memPut(memFolder(uri), path, text);
  },
  async readBytes(uri, path) {
    if (isRemoteUri(uri)) return remoteFs.readBytes(uri, path);
    if (isScratchUri(uri)) return scratchFs.readBytes(uri, path);
    if (plugin) return b64ToBytes((await plugin.readB64({ uri: treeOf(uri), path: jn(baseOf(uri), path) })).b64);
    const m = memFolder(uri);
    if (!m.has(path)) throw new Error('ENOENT: ' + path);
    return m.get(path).data;
  },
  async writeBytes(uri, path, data) {
    if (isRemoteUri(uri)) return remoteFs.writeBytes(uri, path, data);
    if (isScratchUri(uri)) return scratchFs.writeBytes(uri, path, data);
    if (plugin) { await plugin.writeB64({ uri: treeOf(uri), path: jn(baseOf(uri), path), b64: bytesToB64(data) }); return; }
    memPut(memFolder(uri), path, data);
  },
  async mkdir(uri, path) { if (isRemoteUri(uri)) return remoteFs.mkdir(uri, path); if (isScratchUri(uri)) return; if (plugin) await plugin.mkdir({ uri: treeOf(uri), path: jn(baseOf(uri), path) }); },
  async remove(uri, path) {
    if (isRemoteUri(uri)) return remoteFs.remove(uri, path);
    if (isScratchUri(uri)) return scratchFs.remove(uri, path);
    if (plugin) { await plugin.remove({ uri: treeOf(uri), path: jn(baseOf(uri), path) }); return; }
    const m = memFolder(uri);
    if (m.delete(path)) return;
    const base = path.replace(/\/+$/, '') + '/'; let any = false;
    for (const p of [...m.keys()]) if (p.startsWith(base)) { m.delete(p); any = true; }
    if (!any) throw new Error('Not found: ' + path);
  },
};

// ---------------------------------------------------------------- misc
export const App = isNative ? cap.registerPlugin('App') : null;

/** Colours the Android status and navigation bars to match the theme. */
/** Android's Color.parseColor does not accept "#fff", so short hex colours are widened to "#ffffff". */
export const fullHex = (c) => { const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(String(c || '').trim()); return m ? '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3] : c; };
export async function setBars(dark, color) { if (plugin) { try { await plugin.setBars({ dark, color: fullHex(color) }); } catch (e) { /* older build */ } } }

// ---------------------------------------------------------------- native Git (JGit) and background work
const gitWaiters = new Map(); let gitListener = null;
/** Runs one Git operation in the native JGit library. Rejects with "native-git-unavailable..." when it cannot (the caller falls back to JavaScript Git). */
export async function gitNative(uri, op, args = {}, { onProgress, signal } = {}) {
  if (!plugin) throw new Error('native-git-unavailable: not running on Android');
  if (!gitListener) gitListener = plugin.addListener('gitProgress', (ev) => { const f = gitWaiters.get(ev.id); if (f) f(ev); });
  const id = 'g' + Math.random().toString(36).slice(2, 10);
  if (onProgress) gitWaiters.set(id, (ev) => onProgress({ phase: String(ev.phase || '').replace(/^remote:\s*/, ''), loaded: ev.done, total: ev.total }));
  const stop = () => { plugin.gitCancel({ id }).catch(() => {}); };
  if (signal) { if (signal.aborted) stop(); signal.addEventListener('abort', stop); }
  try { return await plugin.gitNative({ op, id, uri: treeOf(uri), path: baseOf(uri), args }); }
  finally { gitWaiters.delete(id); if (signal) signal.removeEventListener('abort', stop); }
}
/** Keeps the app running (with a notification) while the agent works, so Android does not stop it when the screen turns off. */
export const Launch = {
  /** What the app was opened for: a chat to show (notification tap) and/or content shared from another app. Returned once. */
  async take() { if (plugin) { try { return await plugin.takeLaunch(); } catch (e) { return {}; } } return {}; },
  onLaunch(cb) { if (plugin) { try { plugin.addListener('launch', cb); } catch (e) { /* optional */ } } },
};
export const Work = {
  /** A notification (only while the app is in the background) saying the agent waits for approval. */
  async needs(text, chatId) { if (plugin) { try { await plugin.workNeeds({ text, chatId: chatId || '' }); } catch (e) { /* optional */ } } },
  async start(text) { if (plugin) { try { await plugin.workStart({ text }); } catch (e) { /* optional */ } } },
  async stop() { if (plugin) { try { await plugin.workStop(); } catch (e) { /* optional */ } } },
  /** A light vibration, and a notification when the app is in the background. */
  async done(ok, text, chatId) { if (plugin) { try { await plugin.workDone({ ok: ok !== false, text: text || '', chatId: chatId || '' }); } catch (e) { /* optional */ } } else if (navigator.vibrate) { try { navigator.vibrate(ok === false ? [60, 70, 60] : 35); } catch (e) { /* ignore */ } } },
};

/** "All files access": lets the app use normal file paths, which is much faster than Android's folder access. */
export const AllFiles = {
  async status() { if (plugin) { try { return await plugin.allFilesStatus(); } catch (e) { return { supported: false, granted: false }; } } return { supported: false, granted: false, web: true }; },
  async request() { if (plugin) await plugin.requestAllFiles(); },
};

/** Optional bridge to the Termux app (Android only). Lets the agent run shell commands after the user approves. */
export const Termux = {
  async status() {
    if (window.__kdexTermux) return { installed: true, granted: true };
    if (plugin) return plugin.termuxStatus();
    return { installed: false, granted: false, web: true };
  },
  async permission() { if (plugin) return plugin.termuxPermission(); return this.status(); },
  async run(command, cwd, timeoutMs) {
    if (window.__kdexTermux) return window.__kdexTermux({ command, cwd, timeoutMs });
    if (!plugin) throw new Error('The terminal works only in the Android app.');
    return plugin.termuxRun({ command, cwd, timeoutMs });
  },
};

/** Clipboard and Clock app (alarms and timers). On Android these go through the native plugin; in a browser they fall back where possible. */
export const Device = {
  async clipRead() {
    if (plugin) { const r = await plugin.clipboardRead(); return String((r && r.text) || ''); }
    if (navigator.clipboard && navigator.clipboard.readText) return navigator.clipboard.readText();
    throw new Error('The clipboard cannot be read here.');
  },
  async clipWrite(text) {
    if (plugin) { await plugin.clipboardWrite({ text: String(text) }); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(String(text)); return; }
    throw new Error('The clipboard cannot be written here.');
  },
  async alarm(hour, minute, message) {
    if (!plugin) throw new Error('Alarms work only in the Android app.');
    await plugin.setAlarm({ hour, minute, message });
  },
  async timer(seconds, message) {
    if (!plugin) throw new Error('Timers work only in the Android app.');
    await plugin.setTimer({ seconds, message });
  },
};
