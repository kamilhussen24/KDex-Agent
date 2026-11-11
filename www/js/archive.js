// ZIP tools: the model cannot run commands, so unzip and zip are built into the app.
// Both always ask the user first. They never overwrite existing files.
import { fs } from './native.js';
import { cleanRel, fmtBytes } from './util.js';

export const ARCHIVE_TOOLS = [
  {
    name: 'unzip',
    description: 'Extract a .zip file that is inside the project folder. Files go into "dest" (default: a folder named like the zip). Existing files are never overwritten. The user approves first. You cannot run commands, so use this tool whenever the user asks to unzip or extract.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path of the .zip file' }, dest: { type: 'string', description: 'Relative destination folder; "" extracts into the project root' } }, required: ['path'] },
  },
  {
    name: 'zip',
    description: 'Create a .zip file from files or folders in the project. The user approves first. The zip must not exist yet.',
    parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Relative files or folders to include' }, dest: { type: 'string', description: 'Relative path of the .zip to create, e.g. "backup.zip"' } }, required: ['paths', 'dest'] },
  },
];
export const ARCHIVE_ACTIONS = new Set(['unzip', 'zip']);

const MAX_ZIP = 60 * 1048576, MAX_OUT = 200 * 1048576, MAX_FILES = 3000;
const lib = () => { if (!window.fflate) throw new Error('The zip engine did not load.'); return window.fflate; };

async function readZip(folder, rel) {
  if (!/\.zip$/i.test(rel)) throw new Error(rel + ' is not a .zip file.');
  const st = await fs.stat(folder.uri, rel);
  if (!st || !st.exists || st.isDir) throw new Error('Not found: ' + rel);
  if (st.size > MAX_ZIP) throw new Error('This zip is larger than ' + fmtBytes(MAX_ZIP) + '; too big to open on a phone.');
  return fs.readBytes(folder.uri, rel);
}
function target(dest, name) {
  const parts = String(name).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  if (parts.includes('..') || /^[a-zA-Z]:/.test(parts[0] || '')) throw new Error('Unsafe path in zip: ' + name);
  return cleanRel(dest + '/' + parts.join('/'));
}
function destFor(args, rel, names) {
  if (args.dest != null) return cleanRel(args.dest);
  const tops = new Set(names.map((n) => String(n.name).replace(/\\/g, '/').split('/').filter(Boolean)[0]));
  const nested = names.every((n) => String(n.name).replace(/\\/g, '/').split('/').filter(Boolean).length > 1);
  if (tops.size === 1 && nested) return cleanRel(rel.split('/').slice(0, -1).join('/')); // the zip already has one root folder
  return rel.replace(/\.zip$/i, '');
}
function list(data) {
  const names = []; let total = 0;
  lib().unzipSync(data, { filter: (f) => { names.push({ name: f.name, size: f.originalSize }); total += f.originalSize; if (names.length > MAX_FILES) throw new Error('The zip has more than ' + MAX_FILES + ' entries.'); if (total > MAX_OUT) throw new Error('The zip would expand to more than ' + fmtBytes(MAX_OUT) + '.'); return false; } });
  return { names: names.filter((n) => !n.name.endsWith('/')), total };
}

async function walkFiles(folder, rel, out) {
  const st = await fs.stat(folder.uri, rel);
  if (!st || !st.exists) throw new Error('Not found: ' + rel);
  if (!st.isDir) { out.push({ path: rel, size: st.size }); return; }
  const { files } = await fs.walk(folder.uri, rel, MAX_FILES + 1);
  files.forEach((f) => out.push({ path: f.path, size: f.size }));
}
async function collect(folder, args) {
  const dest = cleanRel(args.dest || '');
  if (!/\.zip$/i.test(dest)) throw new Error('dest must end with .zip');
  const ex = await fs.stat(folder.uri, dest);
  if (ex && ex.exists) throw new Error(dest + ' already exists. Choose another name.');
  const out = [];
  for (const p of (args.paths || [])) await walkFiles(folder, cleanRel(p), out);
  const seen = new Set(); const files = out.filter((f) => f.path !== dest && !seen.has(f.path) && seen.add(f.path));
  if (!files.length) throw new Error('Nothing to zip.');
  if (files.length > MAX_FILES) throw new Error('More than ' + MAX_FILES + ' files; zip a smaller folder.');
  const total = files.reduce((a, f) => a + (f.size || 0), 0);
  if (total > MAX_OUT) throw new Error('Files add up to more than ' + fmtBytes(MAX_OUT) + '.');
  return { dest, files, total };
}

/** Lines for the approval card. */
export async function previewArchive(name, args, folder) {
  if (name === 'unzip') {
    const rel = cleanRel(args.path);
    const { names, total } = list(await readZip(folder, rel)); const dest = destFor(args, rel, names);
    const lines = [{ t: 'ctx', text: names.length + ' files, ' + fmtBytes(total) + ' into ' + (dest ? dest + '/' : 'the project folder') }];
    names.slice(0, 40).forEach((n) => lines.push({ t: 'add', text: target(dest, n.name) }));
    if (names.length > 40) lines.push({ t: 'ctx', text: '... and ' + (names.length - 40) + ' more' });
    return lines;
  }
  const { dest, files, total } = await collect(folder, args);
  const lines = [{ t: 'ctx', text: files.length + ' files, ' + fmtBytes(total) + ' into ' + dest }];
  files.slice(0, 40).forEach((f) => lines.push({ t: 'add', text: f.path }));
  if (files.length > 40) lines.push({ t: 'ctx', text: '... and ' + (files.length - 40) + ' more' });
  return lines;
}

export async function runArchive(name, args, folder) {
  const F = lib();
  if (name === 'unzip') {
    const rel = cleanRel(args.path);
    const data = await readZip(folder, rel);
    const { names } = list(data); const dest = destFor(args, rel, names);
    let done = 0, skipped = 0;
    for (const n of names) {
      const to = target(dest, n.name);
      const ex = await fs.stat(folder.uri, to);
      if (ex && ex.exists) { skipped++; continue; }
      const one = F.unzipSync(data, { filter: (f) => f.name === n.name });
      await fs.writeBytes(folder.uri, to, one[n.name] || new Uint8Array(0));
      done++;
    }
    return 'Extracted ' + done + ' file(s) into ' + (dest || 'the project root') + (skipped ? '; skipped ' + skipped + ' that already exist' : '') + '.';
  }
  const { dest, files } = await collect(folder, args);
  const tree = {};
  for (const f of files) tree[f.path] = await fs.readBytes(folder.uri, f.path);
  const zipped = F.zipSync(tree, { level: 6 });
  await fs.writeBytes(folder.uri, dest, zipped);
  return 'Created ' + dest + ' (' + fmtBytes(zipped.length) + ', ' + files.length + ' files).';
}
