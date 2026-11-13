// File tools the model can use inside the folder the user chose.
// Every path is relative to that folder; anything that could leave it is rejected.
import { isSecretPath, isEnvLike, maskEnv, protectionOn, PROTECTED_MSG, ENV_TOOL } from './secrets.js';
import { fs } from './native.js';
import { isScratchUri } from './scratch.js';
import { cleanRel, fmtBytes } from './util.js';

const GIT_INTERNAL = /(^|\/)\.git(\/|$)/;
export const isGitInternal = (p) => GIT_INTERNAL.test(String(p || '').replace(/\\/g, '/'));

export const TOOLS = [
  {
    name: 'list_dir',
    description: 'List the files and folders directly inside a folder. Use path "" for the project root.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative folder path, "" for the root' } } },
  },
  {
    name: 'find_files',
    description: 'Find files by part of their name anywhere in the project, or by a pattern such as *.test.js or src/**/*.css. Returns up to 100 paths.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Part of the file name, case-insensitive' } }, required: ['query'] },
  },
  {
    name: 'search',
    description: 'Search file contents for a regular expression (or plain text). Returns matching lines as path:line: text.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression or plain text' },
        path: { type: 'string', description: 'Optional folder to limit the search' },
        ignore_case: { type: 'boolean', description: 'Default true' },
        glob: { type: 'string', description: 'Only search files matching this pattern, for example *.js or src/**/*.ts (comma separated for several)' },
        context: { type: 'integer', description: 'Lines to show before and after each match, 0 to 5, default 0' },
        max_results: { type: 'integer', description: 'Default 60, max 200' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'find_symbol',
    description: 'Find where a function, class, variable or constant is defined and every place it is used, in one call. Returns definitions and usages as path:line grouped by file. Matches by name (not a full code index), so read the file before you change anything.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'The exact identifier, for example askChoice or UserService' }, path: { type: 'string', description: 'Optional folder to limit the search' }, glob: { type: 'string', description: 'Optional file pattern, for example *.js or src/**/*.ts' }, max_results: { type: 'number', description: 'Most usages to list (default 60, max 200)' } }, required: ['name'] },
  },
  {
    name: 'read_file',
    description: 'Read a text file with line numbers. Returns up to 2000 lines per call, so most files fit in one call. For a very large file, use search first to find the lines you need, then read only that range with offset and limit. Never re-read a part you already have.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer', description: 'Max lines, default 2000' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a file or replace it completely with new content. Parent folders are created. For small changes to an existing file prefer edit_file.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'edit_file',
    description: 'Replace exact text in an existing file. "find" must match exactly once (include enough surrounding lines), unless replace_all is true. Read the file first. To make several changes in the same file, pass them all in one call as "edits" (a list of {find, replace, replace_all}); they apply in order and the user approves them once.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, replace_all: { type: 'boolean' },
        edits: { type: 'array', description: 'Several changes to one file, applied in order', items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['find', 'replace'] } },
      },
      required: ['path'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file (any type, including binary files such as .apk; a binary file cannot be restored with Undo). The user must approve it. For a whole folder or many files at once use run_command with rm.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'move_file',
    description: 'Move or rename one file (not a folder). It fails if the destination already exists. The user must approve it. For a folder use run_command with mv.',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
  },
  {
    name: 'copy_file',
    description: 'Copy one file (any type) to a new path. It fails if the destination already exists. The user must approve it. For a folder use run_command with cp -r.',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
  },
  {
    name: 'make_folder',
    description: 'Create a folder (parent folders too). The user must approve it. Not needed before write_file, which creates its own parent folders.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  ENV_TOOL,
];

export const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'move_file', 'copy_file', 'make_folder']);

export const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|gz|tar|7z|rar|apk|aab|jar|class|so|dll|exe|bin|mp3|mp4|m4a|wav|ogg|mov|avi|mkv|ttf|otf|woff2?|db|sqlite|docx?|xlsx?|pptx?|odt|ods|iso|dmg|dex|obb|psd|heic|avif|flac|aac|webm|3gp|woff|eot)$/i;
const MAX_OUT = 40000;

/** A file pattern (* any letters in a name, ** across folders, ? one letter) as a regular expression. A pattern without a slash matches the file name only (re.base). */
export function globRe(g) {
  const src = String(g).trim().replace(/^\.\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?');
  const re = new RegExp('^' + src + '$', 'i');
  re.base = !String(g).includes('/');
  return re;
}

function clip(s) {
  return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + '\n[output cut]' : s;
}

// ------------------------------------------------------------------ read-only tools
export async function runRead(name, args, folder) {
  args = args || {};
  if (name === 'list_dir') {
    const rel = cleanRel(args.path || '');
    const entries = (await fs.list(folder.uri, rel)).filter((e) => e.name !== '.git');
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    if (!entries.length) return '(empty folder)';
    const prot = await protectionOn();
    const shown = entries.slice(0, 300).map((e) => (e.isDir ? e.name + '/' : e.name + '  (' + fmtBytes(e.size) + ')' + (prot && isSecretPath(e.name) ? '  [protected: hidden from me]' : '')));
    return clip(shown.join('\n') + (entries.length > 300 ? '\n... ' + (entries.length - 300) + ' more' : ''));
  }

  if (name === 'find_files') {
    const q = String(args.query || '').trim();
    if (!q) throw new Error('query is required');
    const re = /[*?]/.test(q) ? globRe(q) : null; // a pattern like *.js or src/**/*.test.ts, otherwise part of a name
    const lq = q.toLowerCase();
    const { files, truncated } = await fs.walk(folder.uri, '', 3000);
    const hits = files.filter((f) => !isGitInternal(f.path) && (re ? re.test(re.base ? f.path.split('/').pop() : f.path) : f.path.toLowerCase().includes(lq))).slice(0, 100).map((f) => f.path);
    return hits.length ? hits.join('\n') + (truncated ? '\n(project is large; list may be incomplete)' : '') : 'No file matches "' + args.query + '".';
  }

  if (name === 'search') {
    const base = cleanRel(args.path || '');
    let re;
    try { re = new RegExp(String(args.pattern), args.ignore_case === false ? '' : 'i'); }
    catch (e) { re = new RegExp(String(args.pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
    const globs = String(args.glob || '').split(',').map((g) => g.trim()).filter(Boolean).map(globRe);
    const ctx = Math.max(0, Math.min(5, parseInt(args.context, 10) || 0));
    const maxRes = Math.max(1, Math.min(200, parseInt(args.max_results, 10) || 60));
    const { files } = await fs.walk(folder.uri, base, 3000);
    const prot = await protectionOn();
    const results = [];
    let scanned = 0; let skippedFiles = 0;
    const started = Date.now();
    for (const f of files) {
      if (results.length >= maxRes) break;
      if (scanned >= 500 || Date.now() - started > 10000) { skippedFiles++; continue; }
      if (isGitInternal(f.path) || BINARY_EXT.test(f.path) || f.size > 200000 || (prot && isSecretPath(f.path))) continue;
      if (globs.length && !globs.some((g) => g.test(g.base ? f.path.split('/').pop() : f.path))) continue;
      scanned++;
      try {
        const r = await fs.readText(folder.uri, f.path, 200000);
        if (r.binary) continue;
        const lines = r.text.split('\n');
        for (let i = 0; i < lines.length && results.length < maxRes; i++) {
          if (!re.test(lines[i])) continue;
          if (!ctx) { results.push(f.path + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 200)); continue; }
          const blk = [];
          for (let j = Math.max(0, i - ctx); j <= Math.min(lines.length - 1, i + ctx); j++) blk.push(f.path + ':' + (j + 1) + (j === i ? ': ' : '- ') + lines[j].slice(0, 200));
          results.push(blk.join('\n') + '\n--');
        }
      } catch (e) { /* skip unreadable files */ }
    }
    const note = (skippedFiles ? '\n(Stopped early: ' + skippedFiles + ' more files were not searched. Narrow it with path or glob.)' : '') + (results.length >= maxRes ? '\n(Showing the first ' + maxRes + ' matches. Narrow it with path or glob, or raise max_results.)' : '');
    return results.length ? clip(results.join('\n')) + note : 'No matches (searched ' + scanned + ' files).' + note;
  }

  if (name === 'find_symbol') {
    const sym = String(args.name || '').trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(sym)) throw new Error('name must be one identifier such as askChoice (letters, digits, _ and $).');
    const esc = sym.replace(/\$/g, '\\$');
    const hit = new RegExp('(?<![\\w$])' + esc + '(?![\\w$])');
    const defs = [
      new RegExp('(?<![\\w$])(?:function\\*?|class|interface|type|enum|struct|trait|def|fn|func|fun|const|let|var|val|object|record|module|namespace)\\s+' + esc + '(?![\\w$])'),
      new RegExp('^\\s*(?:export\\s+)?(?:(?:public|private|protected|static|readonly)\\s+)*' + esc + '\\s*[:=]\\s*(?:async\\s*)?(?:function|\\(|[A-Za-z_$][\\w$]*\\s*=>|class\\b)'),
      new RegExp('^\\s*(?:(?:public|private|protected|static|async|override|final|abstract|get|set)\\s+)*' + esc + '\\s*\\([^)]*\\)\\s*(?::\\s*[\\w<>\\[\\]| ]+)?\\s*\\{\\s*$'),
    ];
    const base = cleanRel(args.path || '');
    const globs = String(args.glob || '').split(',').map((g) => g.trim()).filter(Boolean).map(globRe);
    const maxUse = Math.max(1, Math.min(200, parseInt(args.max_results, 10) || 60));
    const { files } = await fs.walk(folder.uri, base, 3000);
    const prot = await protectionOn();
    const defHits = []; const useHits = new Map(); let nUse = 0; let scanned = 0; let left = 0;
    const started = Date.now();
    for (const f of files) {
      if (isGitInternal(f.path) || BINARY_EXT.test(f.path) || f.size > 200000 || (prot && isSecretPath(f.path))) continue;
      if (/(^|\/)(node_modules|dist|build|\.next|vendor|coverage)\//.test(f.path) || /\.min\.(js|css)$/.test(f.path)) continue;
      if (globs.length && !globs.some((g) => g.test(g.base ? f.path.split('/').pop() : f.path))) continue;
      if (scanned >= 800 || Date.now() - started > 10000) { left++; continue; }
      scanned++;
      try {
        const r = await fs.readText(folder.uri, f.path, 200000);
        if (r.binary || !r.text.includes(sym)) continue;
        const lines = r.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!hit.test(lines[i])) continue;
          const t = lines[i].trim().slice(0, 160);
          if (defs.some((re) => re.test(lines[i])) && defHits.length < 20) { defHits.push(f.path + ':' + (i + 1) + ': ' + t); continue; }
          nUse++;
          if (nUse <= maxUse) { if (!useHits.has(f.path)) useHits.set(f.path, []); useHits.get(f.path).push('  ' + (i + 1) + ': ' + t); }
        }
      } catch (e) { /* skip unreadable files */ }
    }
    const out = [];
    out.push(defHits.length ? 'Definitions of ' + sym + ':\n' + defHits.join('\n') : 'No definition of ' + sym + ' found (it may come from a library or be built dynamically).');
    if (nUse) {
      out.push('Usages (' + nUse + ' in ' + useHits.size + ' file' + (useHits.size === 1 ? '' : 's') + (nUse > maxUse ? ', first ' + maxUse + ' shown' : '') + '):\n' + [...useHits].map(([p, ls]) => p + '\n' + ls.join('\n')).join('\n'));
    } else out.push('No other usages found.');
    out.push('(Name match in ' + scanned + ' files' + (left ? '; ' + left + ' more not scanned, narrow it with path or glob' : '') + '. Read the file to confirm before you change anything.)');
    return clip(out.join('\n\n'));
  }

  if (name === 'read_file') {
    const rel = cleanRel(args.path);
    if (!rel) throw new Error('path is required');
    if (isGitInternal(rel)) throw new Error('The .git folder is managed by Git and may hold access tokens, so it is hidden from you. Use the git tools (git_status, git_diff, git_log) instead.');
    if (BINARY_EXT.test(rel)) throw new Error('This looks like a binary file; only text files can be read.');
    if (isSecretPath(rel) && await protectionOn()) {
      if (!isEnvLike(rel)) return PROTECTED_MSG;
      const raw = await fs.readText(folder.uri, rel, 200000);
      return 'Variable names only (values are hidden):\n' + maskEnv(raw.text) + '\n[' + PROTECTED_MSG + ']';
    }
    const r = await fs.readText(folder.uri, rel, 1048576);
    if (r.binary) throw new Error('This is a binary file; only text files can be read.');
    const lines = r.text.split('\n');
    const total = lines.length;
    const offset = Math.max(1, parseInt(args.offset, 10) || 1);
    const limit = Math.min(4000, Math.max(1, parseInt(args.limit, 10) || 2000));
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    let out = slice.map((l, i) => (offset + i) + '\t' + l.replace(/\r$/, '')).join('\n');
    if (out.length > 60000) out = out.slice(0, 60000) + '\n[output cut at 60000 characters; call again with a later offset]';
    const end = offset - 1 + slice.length;
    out += '\n[lines ' + offset + '-' + end + ' of ' + total + (end < total ? '; call read_file again with offset ' + (end + 1) + ' to continue' : '') + (r.truncated ? '; file is larger than 1 MB and was cut' : '') + ']';
    return out;
  }

  throw new Error('Unknown tool: ' + name);
}

// ------------------------------------------------------------------ write tools: plan, then apply
export function lineDiff(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const midA = A.slice(pre, A.length - suf);
  const midB = B.slice(pre, B.length - suf);
  const out = [];
  const CTX = 2;
  for (let i = Math.max(0, pre - CTX); i < pre; i++) out.push({ t: 'ctx', n: i + 1, text: A[i] });

  const m = midA.length;
  const n = midB.length;
  let ops = null;
  if (m * n <= 1500000) {
    // LCS on the changed middle part
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    ops = [];
    let i = 0; let j = 0;
    while (i < m && j < n) {
      if (midA[i] === midB[j]) { ops.push({ t: 'ctx', text: midA[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', text: midA[i] }); i++; }
      else { ops.push({ t: 'add', text: midB[j] }); j++; }
    }
    while (i < m) ops.push({ t: 'del', text: midA[i++] });
    while (j < n) ops.push({ t: 'add', text: midB[j++] });
  } else {
    ops = midA.map((t) => ({ t: 'del', text: t })).concat(midB.map((t) => ({ t: 'add', text: t })));
  }
  let ln = pre;
  ops.forEach((o) => { if (o.t !== 'add') ln++; out.push({ t: o.t, n: o.t === 'add' ? undefined : ln, text: o.text }); });
  for (let i = 0; i < CTX && suf > 0 && A.length - suf + i < A.length; i++) {
    const idx = A.length - suf + i;
    out.push({ t: 'ctx', n: idx + 1, text: A[idx] });
  }
  const added = ops.filter((o) => o.t === 'add').length;
  const removed = ops.filter((o) => o.t === 'del').length;
  return { lines: out.slice(0, 400), added, removed, more: out.length > 400 };
}

/** *** in a change would replace a real hidden secret with three stars. */
function refuseStars(before, after) {
  const n = (t) => (String(t || '').match(/\*\*\*/g) || []).length;
  if (n(after) > n(before)) throw new Error('The new text contains "***", which stands for a hidden secret. Do not write it. Change only the other lines with edit_file, or tell the user to edit that line themselves.');
}

export async function planWrite(name, args, folder) {
  args = args || {};
  if (name === 'move_file' || name === 'copy_file') {
    const from = cleanRel(args.from); const to = cleanRel(args.to);
    if (!from || !to) throw new Error('from and to are required');
    for (const p of [from, to]) {
      if (isGitInternal(p)) throw new Error('The .git folder is managed by Git; use the git tools instead.');
      if (isSecretPath(p) && await protectionOn()) throw new Error('"' + p + '" is a protected secret file, so I cannot move or copy it.');
    }
    if (from === to) throw new Error('The source and the destination are the same.');
    const a = await fs.stat(folder.uri, from);
    if (!a || !a.exists) throw new Error('Not found: ' + from);
    if (a.isDir) throw new Error(from + ' is a folder. Use run_command with ' + (name === 'move_file' ? 'mv' : 'cp -r') + ' for folders.');
    if (a.size > 20971520) throw new Error('This file is larger than 20 MB. Use run_command (' + (name === 'move_file' ? 'mv' : 'cp') + ') for it.');
    const b = await fs.stat(folder.uri, to);
    if (b && b.exists) throw new Error(to + ' already exists. Choose another name, or delete it first.');
    return { path: to, from, op: name, before: null, after: null, diff: { lines: [{ t: 'ctx', text: from + '  \u2192  ' + to }], added: 0, removed: 0, more: false }, added: 0, removed: 0 };
  }
  if (name === 'make_folder') {
    const rel = cleanRel(args.path);
    if (!rel) throw new Error('path is required');
    if (isGitInternal(rel)) throw new Error('The .git folder is managed by Git; use the git tools instead.');
    if (isScratchUri(folder.uri)) throw new Error('The scratch area has no empty folders. A folder appears when you create a file inside it, for example write_file with path "' + rel + '/file.txt".');
    const st = await fs.stat(folder.uri, rel);
    if (st && st.exists) throw new Error(rel + (st.isDir ? ' already exists.' : ' is a file.'));
    return { path: rel, op: name, before: null, after: null, diff: { lines: [{ t: 'ctx', text: rel + '/' }], added: 0, removed: 0, more: false }, added: 0, removed: 0 };
  }
  const rel = cleanRel(args.path);
  if (!rel) throw new Error('path is required');
  if (rel === '.git' || rel.startsWith('.git/')) throw new Error('The .git folder is managed by Git; use the git tools instead.');
  if (BINARY_EXT.test(rel) && name !== 'delete_file') throw new Error('Binary files cannot be edited or written here. To move, copy or rename one, use run_command (mv, cp).');
  if (isSecretPath(rel) && await protectionOn()) throw new Error('"' + rel + '" is a protected secret file, so I cannot change or delete it (that would show its contents). To add a missing variable use request_env_var. ' + PROTECTED_MSG);

  let before = null;
  const st = await fs.stat(folder.uri, rel);
  if (name === 'delete_file' && BINARY_EXT.test(rel)) { // deleting needs no text copy; Undo cannot bring a binary file back
    if (!st || !st.exists) throw new Error('Not found: ' + rel);
    if (st.isDir) throw new Error(rel + ' is a folder. Use run_command with rm -r to remove a folder.');
    return { path: rel, op: 'delete', binary: true, before: null, after: null, diff: { lines: [{ t: 'warn', text: 'Binary file. Undo cannot bring it back.' }], added: 0, removed: 0, more: false }, added: 0, removed: 0 };
  }
  if (st && st.exists) {
    if (st.isDir) throw new Error(rel + ' is a folder. Use run_command with rm -r to remove a folder.');
    const r = await fs.readText(folder.uri, rel, 1048576);
    if ((r.binary || r.truncated) && name === 'delete_file') return { path: rel, op: 'delete', binary: true, before: null, after: null, diff: { lines: [{ t: 'warn', text: 'Binary file. Undo cannot bring it back.' }], added: 0, removed: 0, more: false }, added: 0, removed: 0 };
    if (r.binary) throw new Error('This is a binary file; it cannot be edited here. Use run_command for moving or copying it.');
    if (r.truncated) throw new Error('This file is larger than 1 MB; too big to change safely.');
    before = r.text;
  }

  if (name === 'delete_file') {
    if (before === null) throw new Error('Not found: ' + rel);
    const d = lineDiff(before, '');
    return { path: rel, op: 'delete', before, after: null, diff: d, added: 0, removed: before.split('\n').length };
  }

  const crlf = before !== null && before.includes('\r\n');
  const fix = (s) => (crlf ? String(s).replace(/\r?\n/g, '\r\n') : String(s));

  if (name === 'write_file') {
    const after = fix(args.content == null ? '' : args.content);
    refuseStars(before, after);
    if (after.length > 1048576) throw new Error('Content is larger than 1 MB.');
    const d = lineDiff(before || '', after);
    return { path: rel, op: before === null ? 'create' : 'overwrite', before, after, diff: d, added: d.added, removed: d.removed };
  }

  if (name === 'edit_file') {
    if (before === null) throw new Error('Not found: ' + rel + '. Use write_file to create a new file.');
    const list = Array.isArray(args.edits) && args.edits.length ? args.edits.slice(0, 40) : [{ find: args.find, replace: args.replace, replace_all: args.replace_all }];
    let after = before;
    list.forEach((e, k) => {
      const tag = list.length > 1 ? 'Change ' + (k + 1) + ' of ' + list.length + ': ' : '';
      const find = fix(e.find == null ? '' : e.find);
      const rep = fix(e.replace == null ? '' : e.replace);
      if (!find) throw new Error(tag + '"find" must not be empty.');
      const count = after.split(find).length - 1;
      if (count === 0) throw new Error(tag + 'The text to replace was not found in ' + rel + '. Read the file again and copy the exact text, including spaces and indentation.' + (k > 0 ? ' Nothing was changed.' : ''));
      if (count > 1 && !e.replace_all) throw new Error(tag + 'The text to replace appears ' + count + ' times in ' + rel + '. Add more surrounding lines to make it unique, or set replace_all.' + (k > 0 ? ' Nothing was changed.' : ''));
      after = e.replace_all ? after.split(find).join(rep) : after.replace(find, () => rep);
    });
    refuseStars(before, after);
    if (after === before) throw new Error('The change would leave ' + rel + ' exactly as it is.');
    const d = lineDiff(before, after);
    return { path: rel, op: 'edit', before, after, diff: d, added: d.added, removed: d.removed };
  }

  throw new Error('Unknown tool: ' + name);
}

export async function applyWrite(plan, folder) {
  if (plan.op === 'move_file' || plan.op === 'copy_file') {
    const data = await fs.readBytes(folder.uri, plan.from);
    await fs.writeBytes(folder.uri, plan.path, data);
    if (plan.op === 'move_file') await fs.remove(folder.uri, plan.from);
    return (plan.op === 'move_file' ? 'Moved ' : 'Copied ') + plan.from + ' to ' + plan.path;
  }
  if (plan.op === 'make_folder') { await fs.mkdir(folder.uri, plan.path); return 'Created folder ' + plan.path; }
  if (plan.op === 'delete') {
    await fs.remove(folder.uri, plan.path);
    return 'Deleted ' + plan.path;
  }
  await fs.writeText(folder.uri, plan.path, plan.after);
  const lines = plan.after.split('\n').length;
  if (plan.op === 'create') return 'Created ' + plan.path + ' (' + lines + ' lines)';
  if (plan.op === 'overwrite') return 'Replaced ' + plan.path + ' (' + lines + ' lines)';
  return 'Edited ' + plan.path + ' (+' + plan.added + ' -' + plan.removed + ')';
}

export async function undoBackup(b, folder) {
  if (b.op === 'move_file') { // put the file back where it was
    const data = await fs.readBytes(folder.uri, b.path);
    await fs.writeBytes(folder.uri, b.from, data);
    await fs.remove(folder.uri, b.path);
    return;
  }
  if (b.existed) await fs.writeText(folder.uri, b.path, b.content);
  else await fs.remove(folder.uri, b.path);
}
