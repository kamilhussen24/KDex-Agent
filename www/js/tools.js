// File tools the model can use inside the folder the user chose.
// Every path is relative to that folder; anything that could leave it is rejected.
import { fs } from './native.js';
import { cleanRel, fmtBytes } from './util.js';

export const TOOLS = [
  {
    name: 'list_dir',
    description: 'List the files and folders directly inside a folder. Use path "" for the project root.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative folder path, "" for the root' } } },
  },
  {
    name: 'find_files',
    description: 'Find files by part of their name anywhere in the project. Returns up to 100 paths.',
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
      },
      required: ['pattern'],
    },
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
    description: 'Replace exact text in an existing file. "find" must match exactly once (include enough surrounding lines), unless replace_all is true. Read the file first.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, replace_all: { type: 'boolean' } },
      required: ['path', 'find', 'replace'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file. The user must approve it.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

export const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file']);

const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|gz|tar|7z|rar|apk|aab|jar|class|so|dll|exe|bin|mp3|mp4|m4a|wav|ogg|mov|avi|mkv|ttf|otf|woff2?|db|sqlite)$/i;
const MAX_OUT = 40000;

function clip(s) {
  return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + '\n[output cut]' : s;
}

// ------------------------------------------------------------------ read-only tools
export async function runRead(name, args, folder) {
  args = args || {};
  if (name === 'list_dir') {
    const rel = cleanRel(args.path || '');
    const entries = await fs.list(folder.uri, rel);
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    if (!entries.length) return '(empty folder)';
    const shown = entries.slice(0, 300).map((e) => (e.isDir ? e.name + '/' : e.name + '  (' + fmtBytes(e.size) + ')'));
    return clip(shown.join('\n') + (entries.length > 300 ? '\n... ' + (entries.length - 300) + ' more' : ''));
  }

  if (name === 'find_files') {
    const q = String(args.query || '').toLowerCase();
    if (!q) throw new Error('query is required');
    const { files, truncated } = await fs.walk(folder.uri, '', 3000);
    const hits = files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 100).map((f) => f.path);
    return hits.length ? hits.join('\n') + (truncated ? '\n(project is large; list may be incomplete)' : '') : 'No file matches "' + args.query + '".';
  }

  if (name === 'search') {
    const base = cleanRel(args.path || '');
    let re;
    try { re = new RegExp(String(args.pattern), args.ignore_case === false ? '' : 'i'); }
    catch (e) { re = new RegExp(String(args.pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
    const { files } = await fs.walk(folder.uri, base, 3000);
    const results = [];
    let scanned = 0;
    const started = Date.now();
    for (const f of files) {
      if (results.length >= 60 || scanned >= 150 || Date.now() - started > 8000) break;
      if (BINARY_EXT.test(f.path) || f.size > 200000) continue;
      scanned++;
      try {
        const r = await fs.readText(folder.uri, f.path, 200000);
        if (r.binary) continue;
        const lines = r.text.split('\n');
        for (let i = 0; i < lines.length && results.length < 60; i++) {
          if (re.test(lines[i])) results.push(f.path + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 200));
        }
      } catch (e) { /* skip unreadable files */ }
    }
    return results.length ? results.join('\n') : 'No matches (searched ' + scanned + ' files).';
  }

  if (name === 'read_file') {
    const rel = cleanRel(args.path);
    if (!rel) throw new Error('path is required');
    if (BINARY_EXT.test(rel)) throw new Error('This looks like a binary file; only text files can be read.');
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

export async function planWrite(name, args, folder) {
  args = args || {};
  const rel = cleanRel(args.path);
  if (!rel) throw new Error('path is required');
  if (BINARY_EXT.test(rel)) throw new Error('Binary files cannot be changed here.');

  let before = null;
  const st = await fs.stat(folder.uri, rel);
  if (st && st.exists) {
    if (st.isDir) throw new Error(rel + ' is a folder.');
    const r = await fs.readText(folder.uri, rel, 1048576);
    if (r.binary) throw new Error('This is a binary file; it cannot be changed here.');
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
    if (after.length > 1048576) throw new Error('Content is larger than 1 MB.');
    const d = lineDiff(before || '', after);
    return { path: rel, op: before === null ? 'create' : 'overwrite', before, after, diff: d, added: d.added, removed: d.removed };
  }

  if (name === 'edit_file') {
    if (before === null) throw new Error('Not found: ' + rel + '. Use write_file to create a new file.');
    const find = fix(args.find == null ? '' : args.find);
    const rep = fix(args.replace == null ? '' : args.replace);
    if (!find) throw new Error('"find" must not be empty.');
    const count = before.split(find).length - 1;
    if (count === 0) throw new Error('The text to replace was not found in ' + rel + '. Read the file again and copy the exact text, including spaces and indentation.');
    if (count > 1 && !args.replace_all) throw new Error('The text to replace appears ' + count + ' times in ' + rel + '. Add more surrounding lines to make it unique, or set replace_all.');
    const after = args.replace_all ? before.split(find).join(rep) : before.replace(find, () => rep);
    const d = lineDiff(before, after);
    return { path: rel, op: 'edit', before, after, diff: d, added: d.added, removed: d.removed };
  }

  throw new Error('Unknown tool: ' + name);
}

export async function applyWrite(plan, folder) {
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
  if (b.existed) await fs.writeText(folder.uri, b.path, b.content);
  else await fs.remove(folder.uri, b.path);
}
