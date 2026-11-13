// Servers over SSH: files (SFTP) and commands. A server is saved as a folder with { remote: true, host, port, user, auth, root, fingerprint };
// its password or key lives in the phone's secure storage. Folder paths look like ssh://<id>, and every fs.* call on them lands here.
// On Android the work is done by the native plugin (KdexRemote.java, JSch). In a browser a small in-memory server stands in, for tests.
import { kvGet } from './db.js';

export const isRemoteUri = (u) => String(u || '').startsWith('ssh://');
export const remoteId = (uri) => String(uri).slice('ssh://'.length).split('/')[0];
export const remoteFolderOf = (profile) => ({ id: profile.id, uri: 'ssh://' + profile.id, name: profile.name, remote: true, host: profile.host, port: profile.port, user: profile.user, auth: profile.auth, root: profile.root, fingerprint: profile.fingerprint || '' });
export const BIG_FILE = 100 * 1048576; // ask before moving more than this
const CHUNK = 524288;

let bridge = null; let store = null;
/** native.js hands over the plugin and the secure storage. Not imported here, so the two files do not depend on each other. */
export function initRemote({ plugin, secure }) { bridge = plugin ? (op, args) => plugin.remoteRun({ op, args }) : mockRun; store = secure; }

const secretKey = (id) => 'srv:' + id;
export async function saveSecret(id, secret) { await store.set(secretKey(id), JSON.stringify(secret || {})); }
export async function dropSecret(id) { try { await store.remove(secretKey(id)); } catch (e) { /* nothing saved */ } }
async function secretOf(id) { try { const v = await store.get(secretKey(id)); return v ? JSON.parse(v) : {}; } catch (e) { return {}; } }

/** The saved password or key of a server, for the edit form. */
export const getSecret = (id) => secretOf(id);

const profiles = new Map();
/** Remembers a server's details for the fs.* calls that follow (they only get the ssh:// address). */
export function rememberServer(folder) { if (folder && folder.remote) profiles.set(folder.id, folder); }
async function profileOf(uri) {
  const id = remoteId(uri); let p = profiles.get(id);
  if (!p) { p = (await kvGet('folders', [])).find((f) => f.id === id); if (p) profiles.set(id, p); }
  if (!p) throw new Error('This server is no longer saved. Add it again.');
  return p;
}
async function argsFor(uri, extra) {
  const p = await profileOf(uri); const s = await secretOf(p.id);
  return { id: p.id, host: p.host, port: String(p.port || 22), user: p.user, password: s.password || '', key: s.key || '', passphrase: s.passphrase || '', fingerprint: p.fingerprint || '', root: p.root || '/', ...extra };
}
async function call(uri, op, extra) {
  if (!bridge) throw new Error('Servers are not available here.');
  try { return await bridge(op, await argsFor(uri, extra)); }
  catch (e) { throw new Error(plain(e)); }
}
function plain(e) { const m = String((e && e.message) || e || 'Something went wrong'); return m.replace(/^(java\.\w+\.)*\w*Exception:\s*/, '').replace(/^remote-unavailable:.*$/, 'This build of the app has no server support.'); }

const b64ToBytes = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const bytesToB64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const dec = new TextDecoder(); const enc = new TextEncoder();
const looksBinary = (u) => { const n = Math.min(u.length, 4096); for (let i = 0; i < n; i++) if (u[i] === 0) return true; return false; };

/** Checks a connection before it is saved: host reachable, signed in, start folder found. Resolves { fingerprint, home, root, rootFound, rootIsDir }. */
export async function testServer(profile, secret) {
  if (!bridge) throw new Error('Servers are not available here.');
  try {
    return await bridge('test', { id: profile.id || 'test', host: profile.host, port: String(profile.port || 22), user: profile.user, password: (secret && secret.password) || '', key: (secret && secret.key) || '', passphrase: (secret && secret.passphrase) || '', fingerprint: '', root: profile.root || '' });
  } catch (e) { throw new Error(plain(e)); }
}
export async function closeServer(id) { if (bridge) { try { await bridge('close', { id }); } catch (e) { /* already closed */ } } profiles.delete(id); }

export const remoteFs = {
  async list(uri, path = '') { const r = await call(uri, 'list', { path }); return r.entries || []; },
  async walk(uri, path = '', max = 3000) { const r = await call(uri, 'walk', { path, max: String(max) }); return { files: r.files || [], truncated: !!r.truncated }; },
  async stat(uri, path) { return call(uri, 'stat', { path }); },
  async readText(uri, path, maxBytes = 1048576) {
    const r = await call(uri, 'read', { path, offset: '0', length: String(maxBytes) });
    const u = b64ToBytes(r.b64 || '');
    return { text: looksBinary(u) ? '' : dec.decode(u), size: Number(r.size) || u.length, binary: looksBinary(u), truncated: !r.eof };
  },
  async writeText(uri, path, text) { await remoteFs.writeBytes(uri, path, enc.encode(String(text))); },
  async readBytes(uri, path, opts) { return remoteRead(uri, path, opts); },
  async writeBytes(uri, path, data, opts) { return remoteWrite(uri, path, data instanceof Uint8Array ? data : new Uint8Array(data), opts); },
  async mkdir(uri, path) { await call(uri, 'mkdir', { path }); },
  async remove(uri, path) { await call(uri, 'remove', { path }); },
  async rename(uri, from, to) { await call(uri, 'rename', { path: from, to }); },
};

/** Downloads a whole file in pieces so the screen can show progress and the person can stop it. onProgress(done, total). */
export async function remoteRead(uri, path, { onProgress, signal } = {}) {
  const parts = []; let got = 0; let total = 0;
  for (;;) {
    if (signal && signal.aborted) throw new Error('Cancelled.');
    const r = await call(uri, 'read', { path, offset: String(got), length: String(CHUNK) });
    const u = b64ToBytes(r.b64 || ''); parts.push(u); got += u.length; total = Number(r.size) || got;
    if (onProgress) onProgress(got, total);
    if (r.eof || !u.length) break;
  }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** Uploads a file in pieces. The first piece replaces any old file, the rest are appended. */
export async function remoteWrite(uri, path, data, { onProgress, signal } = {}) {
  let sent = 0;
  do {
    if (signal && signal.aborted) throw new Error('Cancelled.');
    const part = data.subarray(sent, sent + CHUNK);
    await call(uri, 'write', { path, b64: bytesToB64(part), append: sent ? '1' : '0' });
    sent += part.length; if (onProgress) onProgress(sent, data.length);
  } while (sent < data.length);
}

/** Runs one command on the server, in a folder inside the start folder. Resolves { stdout, stderr, exitCode, errmsg }. */
export async function remoteExec(uri, command, cwd, secs, signal) {
  const runId = 'r' + Math.random().toString(36).slice(2, 10);
  const stop = () => { if (bridge) bridge('cancel', { runId }).catch(() => {}); };
  if (signal) { if (signal.aborted) throw new Error('Cancelled by the user.'); signal.addEventListener('abort', stop, { once: true }); }
  try {
    const r = await call(uri, 'exec', { command, cwd: cwd || '', timeout: String(secs || 120), runId });
    if (signal && signal.aborted) throw new Error('Cancelled by the user.');
    return r;
  } finally { if (signal) signal.removeEventListener('abort', stop); }
}

// ---------------------------------------------------------------- browser stand-in (tests only)
const MOCK = new Map();
function mockHost(host) {
  if (!MOCK.has(host)) {
    const t = Date.now(); const f = new Map();
    const put = (p, text) => f.set(p, { data: enc.encode(text), mtime: t });
    put('var/www/site/index.php', '<?php\necho "Hello";\n'); put('var/www/site/contact.php', '<?php\n// TODO: send mail\n');
    put('var/www/site/logs/app.log', 'started\nlistening on 3000\n'); put('var/www/site/logs/error.log', 'warn: slow query\n');
    f.set('var/www/site/backup.zip', { data: new Uint8Array(600000).fill(7), mtime: t }); put('etc/passwd', 'root:x:0:0\n');
    MOCK.set(host, f);
  }
  return MOCK.get(host);
}
const clean = (root, rel) => {
  const stack = []; let depth = 0;
  for (const s of String(rel || '').split('/')) { if (!s || s === '.') continue; if (s === '..') { depth--; if (depth < 0) throw new Error('That path is outside the server folder: ' + rel); stack.pop(); } else { depth++; stack.push(s); } }
  const r = String(root || '/').split('/').filter(Boolean);
  return r.concat(stack).join('/');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function mockRun(op, a) {
  await sleep(40);
  if (/bad/i.test(a.host) || /invalid/i.test(a.host)) throw new Error('Could not find that host. Check the address.');
  if (a.password === 'wrong') throw new Error('The server refused the sign-in. Check the user name and the password or key.');
  if (!a.password && !a.key) throw new Error('The server refused the sign-in. Check the user name and the password or key.');
  const fp = 'mock:' + a.host;
  if (a.fingerprint && a.fingerprint !== fp) throw new Error("The server's key changed since you first connected. This can mean the server was rebuilt, or someone is in the middle. Remove the saved server and add it again only if you trust the change.");
  const f = mockHost(a.host);
  if (op === 'test') { const root = (a.root || '/home/' + a.user).replace(/^\/+|\/+$/g, ''); const has = [...f.keys()].some((k) => k.startsWith(root + '/')); return { fingerprint: fp, home: '/home/' + a.user, root: '/' + root, rootFound: has || /^home\//.test(root), rootIsDir: has || /^home\//.test(root) }; }
  if (op === 'close' || op === 'cancel') return {};
  const base = clean(a.root, a.path || '');
  const dirs = (p) => { const b = p ? p + '/' : ''; const seen = new Map(); for (const [k, e] of f) { if (!k.startsWith(b)) continue; const rest = k.slice(b.length); const i = rest.indexOf('/'); if (i >= 0) seen.set(rest.slice(0, i), { name: rest.slice(0, i), isDir: true, size: 0, modified: e.mtime }); else seen.set(rest, { name: rest, isDir: false, size: e.data.length, modified: e.mtime }); } return seen; };
  const rootRel = clean(a.root, '');
  const rel = (full) => full.slice(rootRel.length).replace(/^\//, '');
  if (op === 'list') return { entries: [...dirs(base).values()].map((e) => ({ ...e, path: rel(base ? base + '/' + e.name : e.name) })) };
  if (op === 'walk') { const files = []; for (const [k, e] of f) if (k.startsWith(base ? base + '/' : '')) files.push({ name: k.split('/').pop(), path: rel(k), isDir: false, size: e.data.length, modified: e.mtime }); return { files: files.slice(0, Number(a.max) || 3000), truncated: false }; }
  if (op === 'stat') { if (f.has(base)) return { exists: true, isDir: false, size: f.get(base).data.length, modified: f.get(base).mtime }; const isDir = base === '' || [...f.keys()].some((k) => k.startsWith(base + '/')); return { exists: isDir, isDir, size: 0, modified: 0 }; }
  if (op === 'read') { const e = f.get(base); if (!e) throw new Error('Not found: ' + a.path); const off = Number(a.offset) || 0; const len = Number(a.length) || 1048576; const part = e.data.subarray(off, off + len); return { b64: bytesToB64(part), size: e.data.length, eof: off + part.length >= e.data.length }; }
  if (op === 'write') { const part = b64ToBytes(a.b64 || ''); const old = f.get(base); let data = part; if (a.append === '1' && old) { data = new Uint8Array(old.data.length + part.length); data.set(old.data); data.set(part, old.data.length); } f.set(base, { data, mtime: Date.now() }); return {}; }
  if (op === 'mkdir') return {};
  if (op === 'remove') { let any = f.delete(base); for (const k of [...f.keys()]) if (k.startsWith(base + '/')) { f.delete(k); any = true; } if (!any) throw new Error('Not found: ' + a.path); return {}; }
  if (op === 'rename') { const to = clean(a.root, a.to); const e = f.get(base); if (!e) throw new Error('Not found: ' + a.path); f.delete(base); f.set(to, e); return {}; }
  if (op === 'exec') {
    clean(a.root, a.cwd || ''); const c = String(a.command || '');
    if (/pm2 status/.test(c)) return { stdout: 'site  online  12m\n', stderr: '', exitCode: 0, errmsg: '' };
    if (/pm2 restart/.test(c)) return { stdout: '[PM2] site restarted\n', stderr: '', exitCode: 0, errmsg: '' };
    if (/unzip/.test(c)) return { stdout: 'Archive extracted\n', stderr: '', exitCode: 0, errmsg: '' };
    if (/git --version/.test(c)) return { stdout: 'git version 2.43.0\n', stderr: '', exitCode: 0, errmsg: '' };
    if (/fail/.test(c)) return { stdout: '', stderr: 'boom\n', exitCode: 2, errmsg: '' };
    return { stdout: 'ok: ' + c + '\n', stderr: '', exitCode: 0, errmsg: '' };
  }
  throw new Error('Unknown operation: ' + op);
}
