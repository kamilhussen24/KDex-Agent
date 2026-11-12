// Git for a project folder. The working tree lives in the folder you picked (through Android's folder
// access). New repositories keep a real .git folder inside the project, so Termux and other tools see the same
// repository. Older repositories created by earlier versions keep their data inside the app.
import { fs as safFs, httpRaw, secure, subUri } from './native.js';
import { kvGet, kvSet } from './db.js';
import { lineDiff } from './tools.js';
import { isSecretPath, protectionOn } from './secrets.js';

const git = () => window.git;
const EMPTY = new Set();
const DIR = '/w';
const ge = (code, msg) => Object.assign(new Error(msg || code), { code });
let lfs = null;
function lightning() {
  if (!lfs) lfs = new window.LightningFS('kdex-git');
  return lfs.promises;
}

// ---------------------------------------------------------------- file system adapter
function makeFs(folder) {
  const uri = folder.uri;
  const L = lightning();
  const cache = new Map(); // path -> { st, t }
  const mk = (isDir, size, mtime, rel) => ({
    type: isDir ? 'dir' : 'file', mode: isDir ? 0o40000 : (rel && (execSets.get(folder.id) || EMPTY).has(rel) ? 0o100755 : 0o100644), size: size || 0, ino: 0, uid: 1, gid: 1, dev: 1,
    mtimeMs: mtime || 0, ctimeMs: mtime || 0, mtime: new Date(mtime || 0), ctime: new Date(mtime || 0),
    isFile: () => !isDir, isDirectory: () => isDir, isSymbolicLink: () => false,
  });
  const mkLink = (size, mtime) => ({ ...mk(false, size, mtime), mode: 0o120000, isFile: () => false, isSymbolicLink: () => true });
  const saf = (p) => (p === DIR ? '' : p.slice(DIR.length + 1)).split('/').filter((x) => x && x !== '.').join('/');
  const isSaf = (p) => p === DIR || p.startsWith(DIR + '/');
  // Android folders cannot hold symlinks. A link is stored as a small file holding its target and remembered here.
  const linkKey = 'symlinks:' + folder.id; let links = null;
  const loadLinks = async () => { if (!links) links = new Set(await kvGet(linkKey, [])); return links; };
  const saveLinks = () => kvSet(linkKey, [...links]);
  const forget = (rel) => { cache.delete(rel); const i = rel.lastIndexOf('/'); cache.delete(i < 0 ? '' : rel.slice(0, i)); };

  const api = {
    async readFile(p, opts) {
      if (!isSaf(p)) return L.readFile(p, opts);
      let data;
      try { data = await safFs.readBytes(uri, saf(p)); } catch (e) { throw ge('ENOENT', 'ENOENT: ' + p); }
      const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
      return enc ? new TextDecoder().decode(data) : data;
    },
    async writeFile(p, data, opts) {
      if (!isSaf(p)) return L.writeFile(p, data, opts);
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      await safFs.writeBytes(uri, saf(p), bytes); forget(saf(p));
    },
    async unlink(p) {
      if (!isSaf(p)) return L.unlink(p);
      try { await safFs.remove(uri, saf(p)); } catch (e) { throw ge('ENOENT', 'ENOENT: ' + p); }
      if (links && links.delete(saf(p))) saveLinks();
      forget(saf(p));
    },
    async readdir(p) {
      if (!isSaf(p)) return L.readdir(p);
      let list;
      try { list = await safFs.list(uri, saf(p)); } catch (e) { throw ge('ENOENT', 'ENOENT: ' + p); }
      const t = Date.now();
      await loadLinks();
      list.forEach((e) => cache.set(e.path, { st: !e.isDir && links.has(e.path) ? mkLink(e.size, e.modified) : mk(e.isDir, e.size, e.modified, e.path), t }));
      return list.map((e) => e.name);
    },
    async mkdir(p, opts) {
      if (!isSaf(p)) return L.mkdir(p, opts);
      await safFs.mkdir(uri, saf(p)); forget(saf(p));
    },
    async rmdir(p) {
      if (!isSaf(p)) return L.rmdir(p);
      await safFs.remove(uri, saf(p)); forget(saf(p));
    },
    async stat(p) {
      if (!isSaf(p)) return L.stat(p);
      const rel = saf(p);
      if (rel === '') return mk(true, 0, 0);
      const c = cache.get(rel);
      if (c && Date.now() - c.t < 15000) return c.st;
      let r;
      try { r = await safFs.stat(uri, rel); } catch (e) { throw ge('ENOENT', 'ENOENT: ' + p); }
      if (!r || !r.exists) throw ge('ENOENT', 'ENOENT: ' + p);
      await loadLinks();
      const st = !r.isDir && links.has(rel) ? mkLink(r.size, r.modified) : mk(r.isDir, r.size, r.modified, rel);
      cache.set(rel, { st, t: Date.now() });
      return st;
    },
    async readlink(p) {
      if (!isSaf(p)) return L.readlink(p);
      if (!(await loadLinks()).has(saf(p))) throw ge('EINVAL', 'not a link: ' + p);
      return new TextDecoder().decode(await safFs.readBytes(uri, saf(p)));
    },
    async symlink(target, p) {
      if (!isSaf(p)) return L.symlink(target, p);
      const rel = saf(p); await loadLinks(); links.add(rel); await saveLinks();
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (dir) { try { await safFs.mkdir(uri, dir); } catch (e) { /* exists */ } }
      await safFs.writeBytes(uri, rel, new TextEncoder().encode(String(target))); forget(rel);
    },
    async chmod() { /* not needed */ },
  };
  api.lstat = api.stat;
  return { promises: api };
}

// ---------------------------------------------------------------- http client
const makeHttp = (outer) => ({
  async request({ url, method, headers, body, signal }) {
    signal = outer || signal;
    let payload = null;
    if (body) {
      const parts = []; let n = 0;
      for await (const c of body) { parts.push(c); n += c.length; }
      payload = new Uint8Array(n); let o = 0;
      parts.forEach((c) => { payload.set(c, o); o += c.length; });
    }
    const r = await httpRaw({ url, method: method || 'GET', headers: headers || {}, body: payload, signal });
    return { url, method, statusCode: r.status, statusMessage: String(r.status), headers: r.headers, body: r.chunks };
  },
});
const http = makeHttp(null);

// ---------------------------------------------------------------- settings, tokens
export async function getGitSettings() { return { name: '', email: '', ...(await kvGet('git', {})) }; }
export async function saveGitSettings(p) { const v = { ...(await getGitSettings()), ...p }; await kvSet('git', v); return v; }
const hostOf = (url) => { try { return new URL(url).host; } catch (e) { return ''; } };
export const tokenKey = (host) => 'git-token:' + host;
export async function saveToken(host, token) { if (token) await secure.set(tokenKey(host), token); else await secure.remove(tokenKey(host)); }
export async function getToken(host) { return secure.get(tokenKey(host)); }
export async function listTokenHosts() { return kvGet('git-hosts', []); }
export async function rememberHost(host) { const l = await listTokenHosts(); if (!l.includes(host)) { l.push(host); await kvSet('git-hosts', l); } }
export async function forgetHost(host) { await saveToken(host, null); await kvSet('git-hosts', (await listTokenHosts()).filter((h) => h !== host)); }
function userFor(host) { return /gitlab/.test(host) ? 'oauth2' : /bitbucket/.test(host) ? 'x-token-auth' : 'git'; }
function authFor(token) {
  return (url) => { const h = hostOf(url); return token ? { username: userFor(h), password: token } : undefined; };
}
async function author() {
  const s = await getGitSettings();
  if (!s.name || !s.email) throw new Error('Set your Git name and email first (Git > Identity).');
  return { name: s.name, email: s.email };
}

// ---------------------------------------------------------------- context
const modes = new Map(); // folder id -> 'native' (.git inside the project) | 'app' (kept inside the app)
const execSets = new Map(); // folder id -> Set of paths that are executable in HEAD (Android folders do not carry the executable bit)
const caches = new Map(); // folder id -> isomorphic-git object cache (packfiles are read once, not on every call)
/** Forget cached Git objects, for example after Termux ran git in the same folder. */
export function resetGitCache(folder) { if (folder) { caches.delete(folder.id); execSets.delete(folder.id); } else { caches.clear(); execSets.clear(); } }
const ctx = (folder) => {
  if (!caches.has(folder.id)) caches.set(folder.id, {});
  return { fs: makeFs(folder), dir: DIR, cache: caches.get(folder.id), gitdir: modes.get(folder.id) === 'native' ? DIR + '/.git' : '/g-' + folder.id };
};
/** True when the folder is a Git repository. Detects a .git folder made by Termux or any other tool. */
export async function isRepo(folder) {
  try { const st = await safFs.stat(folder.uri, '.git/HEAD'); if (st && st.exists) { modes.set(folder.id, 'native'); return true; } } catch (e) { /* no .git */ }
  try { await lightning().stat('/g-' + folder.id + '/HEAD'); modes.set(folder.id, 'app'); return true; } catch (e) { /* none */ }
  modes.delete(folder.id); return false;
}
const gitdirExists = isRepo;

async function remoteUrl(folder) {
  try { return await git().getConfig({ ...ctx(folder), path: 'remote.origin.url' }); } catch (e) { return null; }
}
async function tokenFor(folder, url) {
  return getToken(hostOf(url || (await remoteUrl(folder)) || ''));
}
const TOKEN_HELP = 'Add one in Settings > Git > Identity and access tokens. GitHub: a classic token with the "repo" scope, or a fine-grained token with Contents: Read and write.';
/** Turns Git and network failures into a message that says what is wrong and what to do. */
function nice(e, { host = '', hasToken = false, action = '' } = {}) {
  let m = String((e && e.message) || e);
  const sub = e && Array.isArray(e.errors) ? e.errors.map((x) => String((x && x.message) || x)).join('; ') : '';
  if (sub) m = sub;
  const status = (e && e.data && e.data.statusCode) || (/\b(401|403|404|429|5\d\d)\b/.exec(m) || [])[1];
  const st = Number(status) || 0;
  const where = host ? ' on ' + host : '';
  if (/aborted|cancel/i.test(m)) return new Error('Cancelled.');
  if (st === 401 || /Authentication|HTTP Error: 401|could not read Username/i.test(m)) {
    return new Error(hasToken ? 'The token was rejected' + where + ': it is wrong, expired or revoked. Make a new token and save it. ' + TOKEN_HELP
      : 'This needs an access token' + where + ' (the repository is private or the action needs login). ' + TOKEN_HELP);
  }
  if (st === 403) {
    return new Error(hasToken ? 'Access denied' + where + '. The token has no permission for this' + (action === 'push' ? ' (it cannot write; give it the "repo" scope or Contents: Read and write)' : ' repository') + ', or the branch is protected. If the repository belongs to an organization, authorize the token for it.'
      : 'Access denied' + where + '. ' + TOKEN_HELP);
  }
  if (st === 404) return new Error('Repository not found' + where + '. Check the URL. If it is private, save a token that can see it. ' + TOKEN_HELP);
  if (st === 429) return new Error('Too many requests' + where + '. Wait a minute and try again.');
  if (st >= 500) return new Error('The server' + where + ' had a problem (HTTP ' + st + '). Try again later.');
  if (/exceeds.*file size limit|GH001|large files detected|too large/i.test(m)) return new Error('Push refused: a file is larger than the host allows (GitHub: 100 MB). Remove it from the commit or use Git LFS on a computer. ' + m.slice(0, 200));
  if (/protected branch|GH006|pre-receive hook declined|hook declined/i.test(m)) return new Error('Push refused by the server: the branch is protected or a rule blocked it. Push to another branch and open a pull request. ' + m.slice(0, 200));
  if (/Failed to fetch|NetworkError|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timed? ?out|offline|Load failed/i.test(m)) return new Error('No connection to ' + (host || 'the server') + '. Check the internet and try again.');
  if (/ENOSPC|quota|no space/i.test(m)) return new Error('The phone is out of storage space.');
  if (/permission|EACCES|SecurityException/i.test(m)) return new Error('Android denied access to the folder. Open the folder again from the folder chip to grant access.');
  return e instanceof Error && !sub ? e : new Error(m);
}
/** The saved token for a remote. A missing token is reported by nice() when the server answers 401 or 403. */
async function needToken(url) { const host = hostOf(url); return { host, token: await getToken(host) }; }

// ---------------------------------------------------------------- operations
export async function clone(folder, url, { token, depth = 1, branch, onProgress, signal } = {}) {
  const host = hostOf(url);
  if (!host) throw new Error('Enter a valid https:// repository URL.');
  const entries = await safFs.list(folder.uri, '');
  if (entries.length) throw new Error('The folder is not empty. Pick an empty folder to clone into.');
  if (token) { await saveToken(host, token); await rememberHost(host); }
  const t = token || await getToken(host);
  modes.set(folder.id, 'native');
  try {
    await git().clone({
      ...ctx(folder), http: makeHttp(signal), url, singleBranch: true, ...(depth ? { depth } : {}), ...(branch ? { ref: branch } : {}),
      onAuth: authFor(t), onProgress: (p) => onProgress && onProgress(p),
    });
  } catch (e) {
    try { await safFs.remove(folder.uri, '.git'); } catch (x) { /* ignore */ }
    modes.delete(folder.id); resetGitCache(folder);
    throw nice(e, { host, hasToken: !!t, action: 'clone' });
  }
}
/** Clone into a new sub-folder named after the repository. Returns the new project folder. */
export async function cloneInto(parent, url, opts = {}) {
  const raw = String(url || '').trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const base = slug(opts.name || raw.split('/').pop() || 'repo') || 'repo';
  let name = base; let n = 2;
  const exists = async (nm) => { try { const st = await safFs.stat(parent.uri, nm); return !!(st && st.exists); } catch (e) { return false; } };
  while (await exists(name)) { name = base + '-' + n; n++; if (n > 50) throw new Error('Too many folders named ' + base + '.'); }
  await safFs.mkdir(parent.uri, name);
  const folder = { id: opts.id || Math.random().toString(36).slice(2, 10), name, uri: subUri(parent.uri, name) };
  try { await clone(folder, url, opts); }
  catch (e) { try { await safFs.remove(parent.uri, name); } catch (x) { /* ignore */ } throw e; }
  return folder;
}
export async function init(folder, url) {
  modes.set(folder.id, 'native');
  await git().init({ ...ctx(folder), defaultBranch: 'main' });
  if (url) await git().addRemote({ ...ctx(folder), remote: 'origin', url, force: true });
}
export async function setRemote(folder, url) { await git().addRemote({ ...ctx(folder), remote: 'origin', url, force: true }); }
export async function currentBranch(folder) {
  try { return (await git().currentBranch({ ...ctx(folder), fullname: false })) || 'HEAD (detached)'; } catch (e) { return null; }
}
export async function branches(folder) { return git().listBranches({ ...ctx(folder) }); }

/** Working-tree changes: [{ path, kind: 'new'|'modified'|'deleted' }] */
export async function status(folder) {
  const rows = await git().statusMatrix({ ...ctx(folder) });
  const out = [];
  for (const [path, head, work, stage] of rows) {
    if (head === 1 && work === 1 && stage === 1) continue;
    if (head === 0 && work === 0) continue;
    out.push({ path, kind: head === 0 ? 'new' : work === 0 ? 'deleted' : 'modified' });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function headText(folder, path) {
  try {
    const oid = await git().resolveRef({ ...ctx(folder), ref: 'HEAD' });
    const { blob } = await git().readBlob({ ...ctx(folder), oid, filepath: path });
    return new TextDecoder().decode(blob);
  } catch (e) { return null; }
}
export async function diffFile(folder, path) {
  if (isSecretPath(path) && await protectionOn()) return { lines: [{ t: 'ctx', text: 'Protected file: contents are hidden.' }], added: 0, removed: 0, more: 0 };
  const before = await headText(folder, path);
  let after = null;
  try { const r = await safFs.readText(folder.uri, path, 1048576); after = r.binary ? null : r.text; } catch (e) { after = null; }
  return lineDiff(before == null ? '' : before, after == null ? '' : after);
}
export async function discard(folder, path) {
  const before = await headText(folder, path);
  if (before === null) { await safFs.remove(folder.uri, path); return; }
  await safFs.writeText(folder.uri, path, before);
}

/** Remember which files are executable in HEAD so editing them does not silently drop the executable bit. */
async function loadExecs(folder) {
  if (execSets.has(folder.id)) return;
  const set = new Set();
  try {
    const c = ctx(folder);
    await git().resolveRef({ ...c, ref: 'HEAD' });
    const found = await git().walk({ ...c, trees: [git().TREE({ ref: 'HEAD' })], map: async (fp, [e]) => ((e && fp !== '.' && (await e.type()) === 'blob' && (await e.mode()) === 0o100755) ? fp : undefined) });
    (function flat(x) { if (Array.isArray(x)) x.forEach(flat); else if (typeof x === 'string') set.add(x); })(found);
  } catch (e) { /* no commits yet */ }
  execSets.set(folder.id, set);
}
export async function commit(folder, message, paths) {
  await loadExecs(folder);
  const c = ctx(folder); const au = await author();
  if (!message || !message.trim()) throw new Error('Write a commit message.');
  const ch = await status(folder);
  const prot = await protectionOn();
  let list = paths ? ch.filter((x) => paths.includes(x.path)) : ch;
  // New secret files are never added to a commit by accident (they would be published on push).
  const skipped = prot ? list.filter((x) => x.kind === 'new' && isSecretPath(x.path)).map((x) => x.path) : [];
  if (skipped.length) list = list.filter((x) => !skipped.includes(x.path));
  if (!list.length) throw new Error(skipped.length ? 'Only secret files changed (' + skipped.join(', ') + '). They are never committed automatically. Add them to .gitignore.' : 'Nothing to commit.');
  for (const f of list) {
    if (f.kind === 'deleted') await git().remove({ ...c, filepath: f.path });
    else await git().add({ ...c, filepath: f.path });
  }
  const oid = await git().commit({ ...c, message: message.trim(), author: au });
  execSets.delete(folder.id);
  return { oid, count: list.length, skipped };
}
export async function push(folder, { force = false, onProgress, signal } = {}) {
  const c = ctx(folder);
  const url = await remoteUrl(folder);
  if (!url) throw new Error('No remote set. Add a remote URL in Git > Remote.');
  const { host, token } = await needToken(url);
  const branch = await currentBranch(folder);
  try {
    const r = await git().push({ ...c, http: makeHttp(signal), remote: 'origin', ref: branch, remoteRef: branch, force, onAuth: authFor(token), onProgress: (p) => onProgress && onProgress(p) });
    if (r && r.ok === false) {
      const refErr = r.refs && Object.values(r.refs).map((x) => x && x.error).filter(Boolean).join('; ');
      throw new Error(refErr || r.error || 'Push was rejected.');
    }
    return r;
  } catch (e) {
    if (/not a simple fast-forward|non-fast-forward|fetch first|stale info/i.test(String(e.message))) throw new Error('Push rejected: the remote has newer commits. Pull first.');
    throw nice(e, { host, hasToken: !!token, action: 'push' });
  }
}
export async function pull(folder, { onProgress, signal } = {}) {
  const c = ctx(folder); const au = await author();
  const url = await remoteUrl(folder);
  if (!url) throw new Error('No remote set. Add a remote URL in Git > Remote.');
  const branch = await currentBranch(folder);
  try {
    await git().pull({ ...c, http: makeHttp(signal), remote: 'origin', ref: branch, singleBranch: true, author: au, committer: au, onAuth: authFor(await tokenFor(folder, url)), onProgress: (p) => onProgress && onProgress(p) });
  } catch (e) {
    const n = (e && e.code) || '';
    if (/MergeConflict|MergeNotSupported/i.test(n) || /conflict/i.test(String(e.message))) throw new Error('Merge conflict. Resolve it by asking the agent to fix the conflicting files, or discard your local change and pull again.');
    if (/CheckoutConflict/i.test(n)) throw new Error('Local changes would be overwritten. Commit or discard them first.');
    throw nice(e, { host: hostOf(url), hasToken: !!(await tokenFor(folder, url)), action: 'pull' });
  }
}
export async function checkout(folder, ref) { await git().checkout({ ...ctx(folder), ref }); }
export async function createBranch(folder, name) {
  await git().branch({ ...ctx(folder), ref: name, checkout: true });
}
export async function log(folder, depth = 25) {
  try { return await git().log({ ...ctx(folder), depth }); } catch (e) { return []; }
}
export async function remove(folder) {
  if (modes.get(folder.id) === 'native') { await safFs.remove(folder.uri, '.git'); modes.delete(folder.id); return; }
  const id = '/g-' + folder.id;
  const L = lightning();
  const rm = async (p) => {
    let names = []; try { names = await L.readdir(p); } catch (e) { return; }
    for (const n of names) { const q = p + '/' + n; const st = await L.stat(q); if (st.isDirectory()) await rm(q); else await L.unlink(q); }
    await L.rmdir(p);
  };
  await rm(id);
}

// ---------------------------------------------------------------- more operations
export async function remoteInfo(folder) {
  const url = await remoteUrl(folder);
  if (!url) return null;
  let host = hostOf(url); let path = '';
  try { path = new URL(url).pathname.replace(/^\/|\.git$/g, ''); } catch (e) { /* ignore */ }
  return { url, host, path };
}
export async function fetchRemote(folder, { onProgress, signal } = {}) {
  const url = await remoteUrl(folder);
  if (!url) throw new Error('No remote set. Add one in the Remote tab.');
  const branch = await currentBranch(folder);
  try {
    await git().fetch({ ...ctx(folder), http: makeHttp(signal), remote: 'origin', ref: branch, singleBranch: true, tags: false, onAuth: authFor(await tokenFor(folder, url)), onProgress: (p) => onProgress && onProgress(p) });
  } catch (e) { throw nice(e, { host: hostOf(url), hasToken: !!(await tokenFor(folder, url)), action: 'fetch' }); }
}
/** { ahead, behind } against origin/<branch> as of the last fetch, or null when unknown. */
export async function aheadBehind(folder) {
  try {
    const c = ctx(folder); const b = await currentBranch(folder);
    const local = await git().resolveRef({ ...c, ref: 'refs/heads/' + b });
    let remote; try { remote = await git().resolveRef({ ...c, ref: 'refs/remotes/origin/' + b }); } catch (e) { return { ahead: null, behind: 0, noRemoteBranch: true }; }
    if (local === remote) return { ahead: 0, behind: 0 };
    const walk = async (tip) => new Set((await git().log({ ...c, ref: tip, depth: 200 })).map((x) => x.oid));
    const L = await walk(local); const R = await walk(remote);
    return { ahead: [...L].filter((x) => !R.has(x)).length, behind: [...R].filter((x) => !L.has(x)).length };
  } catch (e) { return null; }
}
export async function deleteBranch(folder, name) {
  if (name === (await currentBranch(folder))) throw new Error('Switch to another branch before deleting this one.');
  await git().deleteBranch({ ...ctx(folder), ref: name });
}
export async function mergeBranch(folder, theirs) {
  const au = await author(); const c = ctx(folder);
  const ours = await currentBranch(folder);
  if (ours === theirs) throw new Error('Pick a different branch to merge.');
  try { return await git().merge({ ...c, ours, theirs, author: au, committer: au, abortOnConflict: true }); }
  catch (e) {
    if (/Conflict/i.test((e && e.code) || '') || /conflict/i.test(String(e.message))) throw new Error('Merge conflict. Nothing was changed. Merge on a computer, or ask the agent to align the branches first.');
    throw e;
  }
}
/** Undo the last commit but keep all its changes in the working tree. */
export async function undoLastCommit(folder) {
  const c = ctx(folder); const b = await currentBranch(folder);
  const oid = await git().resolveRef({ ...c, ref: 'HEAD' });
  const { commit } = await git().readCommit({ ...c, oid });
  if (!commit.parent.length) throw new Error('This is the first commit, there is nothing before it.');
  await git().writeRef({ ...c, ref: 'refs/heads/' + b, value: commit.parent[0], force: true });
  return oid;
}
export async function discardAll(folder) {
  const ch = await status(folder);
  for (const f of ch) await discard(folder, f.path);
  return ch.length;
}

// ---------------------------------------------------------------- create a new repository on GitHub or GitLab
const slug = (s) => String(s || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
export const repoSlug = slug;
async function jsonRequest(url, method, headers, payload) {
  const r = await httpRaw({ url, method, headers: { 'content-type': 'application/json', 'user-agent': 'KDex-Agent', ...headers }, body: JSON.stringify(payload) });
  let text = ''; const dec = new TextDecoder();
  for await (const c of r.chunks) text += dec.decode(c, { stream: true });
  let j = {}; try { j = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: r.status, json: j, text };
}
export async function createRemoteRepo({ provider, host, token, name, isPrivate, description }) {
  if (!token) throw new Error('A token is needed to create a repository. Add one in Identity and tokens.');
  const n = slug(name); if (!n) throw new Error('Enter a repository name.');
  let override = ''; try { override = localStorage.getItem('kdexApiBase') || ''; } catch (e) { /* ignore */ }
  let res;
  if (provider === 'gitlab') {
    const base = override || 'https://' + (host || 'gitlab.com');
    res = await jsonRequest(base + '/api/v4/projects', 'POST', { 'PRIVATE-TOKEN': token }, { name: n, path: n, visibility: isPrivate ? 'private' : 'public', description: description || '' });
    if (res.status === 201 || res.status === 200) return { cloneUrl: res.json.http_url_to_repo, webUrl: res.json.web_url, host: hostOf(res.json.http_url_to_repo) };
  } else {
    const base = override || 'https://api.github.com';
    res = await jsonRequest(base + '/user/repos', 'POST', { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json' }, { name: n, private: !!isPrivate, description: description || '', auto_init: false });
    if (res.status === 201 || res.status === 200) return { cloneUrl: res.json.clone_url, webUrl: res.json.html_url, host: hostOf(res.json.clone_url) };
  }
  if (res.status === 401 || res.status === 403) throw new Error('The token was rejected. It needs permission to create repositories (GitHub: "repo" scope).');
  if (res.status === 422 || res.status === 400) throw new Error('Could not create it. A repository named "' + n + '" may already exist.');
  throw new Error('Could not create the repository (HTTP ' + res.status + ').');
}

/** New project flow: init if needed, first commit, create the remote repo, push. */
export async function publishNew(folder, opts, step = () => {}) {
  const host = opts.provider === 'gitlab' ? (opts.host || 'gitlab.com') : 'github.com';
  if (opts.token) { await saveToken(host, opts.token); await rememberHost(host); }
  const token = opts.token || await getToken(host);
  if (!(await gitdirExists(folder))) { step('Preparing repository'); await init(folder); }
  let hasCommit = true; try { await git().resolveRef({ ...ctx(folder), ref: 'HEAD' }); } catch (e) { hasCommit = false; }
  if (!hasCommit || (await status(folder)).length) { step('Saving files'); await commit(folder, opts.message || (hasCommit ? 'Update' : 'Initial commit')); }
  step('Creating repository');
  const r = await createRemoteRepo({ provider: opts.provider, host, token, name: opts.name, isPrivate: opts.isPrivate, description: opts.description });
  await git().addRemote({ ...ctx(folder), remote: 'origin', url: r.cloneUrl, force: true });
  await saveToken(r.host, token); await rememberHost(r.host);
  step('Uploading');
  await push(folder, { onProgress: (p) => step('Uploading ' + (p && p.phase ? p.phase : '')) });
  return r;
}

export const hostFromUrl = hostOf;
