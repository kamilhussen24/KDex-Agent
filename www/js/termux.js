// Terminal tool: runs a shell command in Termux. Off by default; every command needs the user's approval.
import { Termux } from './native.js';
import { db } from './db.js';
import { cleanRel } from './util.js';

export const TERMUX_TOOLS = [
  {
    name: 'run_command',
    description: 'Run a shell command in Termux (Linux on this phone) inside the project folder. Use it for unzip, npm/pip install, running scripts or tests, git commands, curl and similar. The user approves every command first. Commands must finish by themselves: no prompts, no editors, no servers that never exit. Prefer short commands and quiet flags; output is cut to the last part.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command (bash)' },
        cwd: { type: 'string', description: 'Optional sub-folder of the project to run in; default is the project root' },
        timeout_seconds: { type: 'integer', description: 'Default 120, max 600' },
      },
      required: ['command'],
    },
  },
];
export const TERMUX_ACTIONS = new Set(['run_command']);

/** Termux path of a folder chosen through the Android picker. */
export function deriveTermuxPath(uri) {
  const m = /\/tree\/([^/?#]+)/.exec(String(uri || ''));
  if (!m) return null;
  let id; try { id = decodeURIComponent(m[1]); } catch (e) { return null; }
  if (String(uri).includes('com.termux.documents')) return id.startsWith('/') ? id : null;
  const k = id.indexOf(':'); if (k < 0) return null;
  const vol = id.slice(0, k); const rest = id.slice(k + 1).replace(/^\/+/, '');
  const root = vol === 'primary' ? '/storage/emulated/0' : '/storage/' + vol;
  return rest ? root + '/' + rest : root;
}
export async function getTermuxPath(folder) {
  if (!folder) return null;
  const r = await db.get('kv', 'termux-path:' + folder.id);
  return (r && r.value) || deriveTermuxPath(folder.uri);
}
export async function setTermuxPath(folder, value) {
  if (value) await db.put('kv', { key: 'termux-path:' + folder.id, value }); else await db.del('kv', 'termux-path:' + folder.id);
}

const DANGER = /(^|[;&|]\s*|\s)(sudo|rm\s+(-\w*[rf]\w*\s+)+|dd\s+if=|mkfs|chmod\s+-R|chown\s+-R|shutdown|reboot|pkill|killall)\b|:\(\)\s*\{|>\s*\/dev\/|curl[^|;]*\|\s*(ba)?sh|wget[^|;]*\|\s*(ba)?sh/i;

async function workdir(args, folder) {
  const base = await getTermuxPath(folder);
  if (!base) throw new Error('The Termux path of this folder is unknown. Set it in Settings > Terminal.');
  const sub = cleanRel(args.cwd || '');
  return sub ? base.replace(/\/+$/, '') + '/' + sub : base;
}

export async function previewTermux(args, folder) {
  const command = String(args.command || '').trim();
  if (!command) throw new Error('command is required');
  const cwd = await workdir(args, folder);
  const lines = [{ t: 'ctx', text: '$ ' + command }, { t: 'ctx', text: 'in ' + cwd }];
  if (DANGER.test(command)) lines.push({ t: 'del', text: 'Warning: this command can delete data or change the system.' });
  return lines;
}

function clip(s, n) { s = String(s || ''); return s.length > n ? '[... ' + (s.length - n) + ' characters cut]\n' + s.slice(-n) : s; }

export async function runTermux(args, folder) {
  const command = String(args.command || '').trim();
  const cwd = await workdir(args, folder);
  const secs = Math.max(5, Math.min(600, parseInt(args.timeout_seconds, 10) || 120));
  const r = await Termux.run(command, cwd, secs * 1000);
  const out = clip(r.stdout, 12000); const err = clip(r.stderr, 4000);
  return (out ? out.replace(/\s+$/, '') + '\n' : '') + (err ? '[stderr]\n' + err.replace(/\s+$/, '') + '\n' : '') + '[exit code ' + r.exitCode + (r.errmsg ? '; ' + r.errmsg : '') + ']';
}
