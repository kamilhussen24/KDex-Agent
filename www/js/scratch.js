// Scratch: a private file desk for a chat that has no folder. Files live in the app's own database
// (not visible to other apps or the file manager) and are removed with the chat.
import { db } from './db.js';

export const SCRATCH_CAP = 50 * 1048576;
export const isScratchUri = (u) => String(u || '').startsWith('scratch://');
export const scratchUri = (chatId) => 'scratch://' + chatId;
export const scratchFolder = (chatId) => ({ id: 'scratch-' + chatId, uri: scratchUri(chatId), name: 'Scratch', scratch: true });
const idOf = (uri) => String(uri).slice('scratch://'.length);
const enc = new TextEncoder();

function clean(p) {
  const parts = String(p || '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.');
  if (parts.includes('..')) throw new Error('Paths cannot go outside the scratch folder.');
  return parts.join('/');
}
const key = (id, p) => id + '\u0000' + p;
const rows = (id) => db.byIndex('scratch', 'chatId', id);
const toBytes = (d) => (typeof d === 'string' ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));

async function put(uri, path, data) {
  const id = idOf(uri), p = clean(path); if (!p) throw new Error('Give a file name.');
  const bytes = toBytes(data);
  const all = await rows(id);
  const others = all.filter((r) => r.path !== p).reduce((n, r) => n + r.size, 0);
  if (others + bytes.length > SCRATCH_CAP) throw new Error('Scratch is full (limit 50 MB). Delete some files from Scratch first.');
  await db.put('scratch', { k: key(id, p), chatId: id, path: p, data: bytes, size: bytes.length, mtime: Date.now() });
}
async function get(uri, path) {
  const p = clean(path); const r = await db.get('scratch', key(idOf(uri), p));
  if (!r) throw new Error('Not found: ' + p);
  return r;
}

export const scratchFs = {
  async list(uri, path = '') {
    const base = clean(path) ? clean(path) + '/' : ''; const seen = new Map();
    for (const r of await rows(idOf(uri))) {
      if (!r.path.startsWith(base)) continue;
      const rest = r.path.slice(base.length), i = rest.indexOf('/');
      if (i >= 0) seen.set(rest.slice(0, i), { name: rest.slice(0, i), path: base + rest.slice(0, i), isDir: true, size: 0, modified: r.mtime });
      else seen.set(rest, { name: rest, path: base + rest, isDir: false, size: r.size, modified: r.mtime });
    }
    return Array.from(seen.values());
  },
  async walk(uri, path = '', max = 3000) {
    const base = clean(path) ? clean(path) + '/' : '';
    const files = (await rows(idOf(uri))).filter((r) => r.path.startsWith(base)).map((r) => ({ name: r.path.split('/').pop(), path: r.path, isDir: false, size: r.size }));
    return { files: files.slice(0, max), truncated: files.length > max };
  },
  async stat(uri, path) {
    const p = clean(path); const id = idOf(uri);
    if (!p) return { exists: true, isDir: true, size: 0, modified: 0 };
    const r = await db.get('scratch', key(id, p));
    if (r) return { exists: true, isDir: false, size: r.size, modified: r.mtime };
    const base = p + '/';
    for (const x of await rows(id)) if (x.path.startsWith(base)) return { exists: true, isDir: true, size: 0, modified: 0 };
    return { exists: false, isDir: false, size: 0, modified: 0 };
  },
  async readText(uri, path, maxBytes = 1048576) {
    const r = await get(uri, path);
    const head = r.data.subarray(0, 4000);
    if (head.indexOf(0) >= 0) return { text: '', size: r.size, binary: true, truncated: false };
    const t = new TextDecoder().decode(r.data);
    return { text: t.slice(0, maxBytes), size: r.size, binary: false, truncated: r.size > maxBytes };
  },
  async writeText(uri, path, text) { await put(uri, path, String(text)); },
  async readBytes(uri, path) { return (await get(uri, path)).data; },
  async writeBytes(uri, path, data) { await put(uri, path, data); },
  async mkdir() { /* folders exist only as part of file paths */ },
  async remove(uri, path) {
    const id = idOf(uri), p = clean(path);
    if (await db.get('scratch', key(id, p))) { await db.del('scratch', key(id, p)); return; }
    const base = p + '/'; const hit = (await rows(id)).filter((r) => r.path.startsWith(base));
    if (!hit.length) throw new Error('Not found: ' + p);
    for (const r of hit) await db.del('scratch', r.k);
  },
};

/** Files of one chat's scratch, newest first. */
export async function scratchFiles(chatId) { return (await rows(chatId)).sort((a, b) => b.mtime - a.mtime); }
export async function scratchCount(chatId) { return (await rows(chatId)).length; }
export async function scratchClear(chatId) { await db.delByIndex('scratch', 'chatId', chatId); }
/** Per chat: { chatId, files, bytes, newest } across all scratch folders. */
export async function scratchUsage() {
  const by = new Map();
  for (const r of await db.all('scratch')) {
    const u = by.get(r.chatId) || { chatId: r.chatId, files: 0, bytes: 0, newest: 0 };
    u.files++; u.bytes += r.size; u.newest = Math.max(u.newest, r.mtime); by.set(r.chatId, u);
  }
  return Array.from(by.values());
}
