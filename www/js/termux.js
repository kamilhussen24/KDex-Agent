// Terminal tool: runs a shell command in Termux. Off by default; every command needs the user's approval.
import { Termux } from './native.js';
import { db, kvGet } from './db.js';
import { getToken, getGitSettings, remoteInfo, resetGitCache, listTokenHosts } from './git.js';
import { cleanRel } from './util.js';
import { remoteExec } from './remote.js';

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
  {
    name: 'start_job',
    description: 'Start a long-running command in the background (a dev server, a watcher, a bot) and return at once. Use this instead of run_command for anything that does not exit by itself. Output goes to a log you can read with check_job. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short job name: letters, digits, - and _ (for example web)' },
        command: { type: 'string', description: 'The shell command, for example: python3 -m http.server 8080' },
        cwd: { type: 'string', description: 'Optional sub-folder of the project; default is the project root' },
      },
      required: ['name', 'command'],
    },
  },
  {
    name: 'check_job',
    description: 'Show whether a background job is still running and the last lines of its log. Use it after start_job to confirm the server is up, and to read errors.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, lines: { type: 'integer', description: 'Log lines to show, default 30, max 200' } }, required: ['name'] },
  },
  {
    name: 'stop_job',
    description: 'Stop a background job that was started with start_job.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'list_jobs',
    description: 'List background jobs and whether each is running.',
    parameters: { type: 'object', properties: {} },
  },
];
/** The one command tool of a chat that works on a server. Same name as the Termux one, so approvals, "Always allow" and the risk check work the same way. */
export const SERVER_TOOLS = [{
  name: 'run_command',
  description: 'Run a shell command ON THE SERVER over SSH (not on the phone), starting in the server folder of this chat. Use it to restart services (pm2 restart), read logs, unzip an upload, check disk space, run git on the server, curl the site and similar. The user approves every command first. Commands must finish by themselves: no prompts, no editors, no programs that never exit; add -y flags. Returns stdout, stderr and the exit code.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command (bash)' },
      cwd: { type: 'string', description: 'Optional sub-folder of the server folder to run in; default is the server folder itself' },
      timeout_seconds: { type: 'number', description: 'Optional, 5 to 600, default 120' },
    },
    required: ['command'],
  },
}];
export const TERMUX_ACTIONS = new Set(['run_command', 'start_job']); // need approval
export const TERMUX_READS = new Set(['check_job', 'stop_job', 'list_jobs']); // only touch jobs the app started

/** Termux path of a folder chosen through the Android picker. */
export function deriveTermuxPath(full) {
  const bar = String(full || '').indexOf('|'); const uri = bar < 0 ? String(full || '') : String(full).slice(0, bar); const sub = bar < 0 ? '' : String(full).slice(bar + 1);
  const p = deriveTree(uri); return p && sub ? p.replace(/\/+$/, '') + '/' + sub : p;
}
function deriveTree(uri) {
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
export async function hasCustomTermuxPath(folder) { if (!folder) return false; const r = await db.get('kv', 'termux-path:' + folder.id); return !!(r && r.value); }
export async function setTermuxPath(folder, value) {
  if (value) await db.put('kv', { key: 'termux-path:' + folder.id, value }); else await db.del('kv', 'termux-path:' + folder.id);
}

const DANGER = /(^|[;&|]\s*|\s)(sudo|rm\s+(-\w*[rf]\w*\s+)+|dd\s+if=|mkfs|chmod\s+-R|chown\s+-R|shutdown|reboot|pkill|killall)\b|:\(\)\s*\{|>\s*\/dev\/(?!null\b)|curl[^|;]*\|\s*(ba)?sh|wget[^|;]*\|\s*(ba)?sh/i;

// On a live server a few more things always ask, even in Auto mode: stopping services, deleting processes, databases, users, firewall, removing packages.
const SERVER_RISKY = /\b(systemctl|service)\b[^\n;|&]*\b(stop|disable|mask|kill)\b|\bpm2\s+(delete|kill|flush|unstartup)\b|\b(mysql|mysqldump|mariadb|psql|pg_dump|mongo\w*|redis-cli)\b|\bdrop\s+(table|database)\b|\b(useradd|userdel|usermod|passwd|visudo|crontab\s+-r|iptables|ufw|firewall-cmd|mount|umount|fdisk|parted)\b|\b(apt|apt-get|yum|dnf|apk)\s+(remove|purge|upgrade|dist-upgrade|autoremove)\b/i;
// Commands that print a secret file. The output goes to the AI provider, so these always ask.
const SECRET_READ = /\b(cat|less|more|head|tail|grep|egrep|sed|awk|strings|xxd|od|base64|nl|bat)\b[^\n;|&]*(\.env(?!\.(example|sample|template)\b)(\.\w+)?(?=$|[\s"';|&)])|\.pem\b|\.p12\b|\.pfx\b|\bid_(rsa|ecdsa|ed25519|dsa)\b|\.netrc\b|\.git-credentials|\.npmrc\b|\.pgpass\b|\bshadow\b)/i;
export function readsSecret(command) { return SECRET_READ.test(String(command || '')); }

async function workdir(args, folder) {
  const base = await getTermuxPath(folder);
  if (!base) throw new Error('The Termux path of this folder is unknown. Set it in Settings > Terminal.');
  const sub = cleanRel(args.cwd || '');
  return sub ? base.replace(/\/+$/, '') + '/' + sub : base;
}

/** Absolute or home paths in a command that lie outside the start folder (informational only). */
export function outsidePaths(command, root) {
  const base = String(root || '').replace(/\/+$/, '');
  const out = [];
  for (let tok of String(command || '').split(/[\s"'|;&<>()`=]+/)) {
    if (!tok) continue;
    if (tok === '~' || tok.startsWith('~/')) { out.push(tok); continue; }
    if (/(^|\/)\.\.(\/|$)/.test(tok) && /^[\w.\/~-]+$/.test(tok)) { out.push(tok); continue; }
    if (!/^\/[\w.@%+\/-]*$/.test(tok) || tok === '/' || tok.startsWith('//')) continue;
    if (/^\/(tmp|dev\/(null|stdout|stderr|stdin|fd))(\/|$)/.test(tok)) continue;
    if (base && (tok === base || tok.startsWith(base + '/'))) continue;
    out.push(tok);
  }
  return [...new Set(out)];
}
function outsideLine(command, root) {
  const o = outsidePaths(command, root); if (!o.length) return null;
  return { t: 'warn', text: 'Outside the start folder: ' + o.slice(0, 2).join(', ') + (o.length > 2 ? ' +' + (o.length - 2) : '') };
}

export async function previewTermux(args, folder) {
  const command = String(args.command || '').trim();
  if (!command) throw new Error('command is required');
  if (folder && folder.remote) {
    const sub = cleanRel(args.cwd || '');
    const lines = [{ t: 'ctx', text: '$ ' + command }, { t: 'ctx', text: 'on ' + folder.name + ', in ' + (folder.root || '/').replace(/\/+$/, '') + (sub ? '/' + sub : '') }];
    if (DANGER.test(command) || SERVER_RISKY.test(command)) lines.push({ t: 'del', text: 'Warning: this command can delete data, stop a service or change the server.' });
    if (SECRET_READ.test(command)) lines.push({ t: 'del', text: 'Warning: this command prints a secret file. Its output is sent to your AI provider.' });
    const ow = outsideLine(command, folder.root); if (ow) lines.push(ow);
    return lines;
  }
  const cwd = await workdir(args, folder);
  const lines = [{ t: 'ctx', text: '$ ' + command }, { t: 'ctx', text: 'in ' + cwd }];
  if (DANGER.test(command)) lines.push({ t: 'del', text: 'Warning: this command can delete data or change the system.' });
  if (SECRET_READ.test(command)) lines.push({ t: 'del', text: 'Warning: this command prints a secret file. Its output is sent to your AI provider.' });
  const ow = outsideLine(command, await getTermuxPath(folder)); if (ow) lines.push(ow);
  return lines;
}

function clip(s, n) { s = String(s || ''); return s.length > n ? '[... ' + (s.length - n) + ' characters cut]\n' + s.slice(-n) : s; }

const GIT_NET = /(^|[\s;&|(])git\s+(?:-[^\s]+\s+)*(clone|push|pull|fetch|ls-remote|submodule|remote\s+update)\b/;
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
/**
 * For git commands that talk to a server, lend the saved access token to this one command through GIT_ASKPASS.
 * The token is never written into Termux files, never shown to the model, and is scrubbed from the output.
 */
async function withGitToken(command, folder) {
  const s = await kvGet('settings', {});
  if (s.gitTokenTermux === false || !GIT_NET.test(command)) return { command, secret: null, host: '' };
  let host = ''; const m = /https?:\/\/([^\/\s'"]+)/i.exec(command);
  if (m) host = m[1].replace(/^[^@]*@/, '');
  else { const info = folder ? await remoteInfo(folder).catch(() => null) : null; host = info ? info.host : ''; }
  if (!host) { const hs = await listTokenHosts(); if (hs.length === 1) host = hs[0]; } // only one account saved: unambiguous
  const token = host ? await getToken(host) : null;
  const id = await getGitSettings().catch(() => ({}));
  const env = [];
  if (id.name) env.push('GIT_AUTHOR_NAME=' + shq(id.name), 'GIT_COMMITTER_NAME=' + shq(id.name));
  if (id.email) env.push('GIT_AUTHOR_EMAIL=' + shq(id.email), 'GIT_COMMITTER_EMAIL=' + shq(id.email));
  if (!token) return { command: (env.length ? 'export ' + env.join(' ') + '; ' : '') + command, secret: null, host };
  const user = /gitlab/.test(host) ? 'oauth2' : /bitbucket/.test(host) ? 'x-token-auth' : 'git';
  const pre = 'mkdir -p "$HOME/.kdex" && printf \'%s\\n\' \'#!/bin/sh\' \'case "$1" in Username*) echo "$KDEX_GIT_USER";; *) echo "$KDEX_GIT_TOKEN";; esac\' > "$HOME/.kdex/askpass" && chmod 700 "$HOME/.kdex/askpass"; ' +
    'export GIT_ASKPASS="$HOME/.kdex/askpass" GIT_TERMINAL_PROMPT=0 KDEX_GIT_USER=' + shq(user) + ' KDEX_GIT_TOKEN=' + shq(token) + (env.length ? ' ' + env.join(' ') : '') + '; ';
  return { command: pre + command, secret: token, host };
}

/** Stop a command started by runTermux: kills it and everything it started (best effort). */
function killTagged(tag) {
  const pat = tag.replace(/^(kdex-run-)(.)/, '$1[$2]'); // the bracket keeps this very command from matching itself
  const script = 'kt(){ for c in $(pgrep -P "$1"); do kt "$c"; done; kill -TERM "$1" 2>/dev/null; }; for p in $(pgrep -f ' + shq(pat) + '); do kt "$p"; done; true';
  return Termux.run(script, undefined, 15000).catch(() => {});
}

/** Runs a command on a server and words the result the same way as a Termux command. */
async function runServer(args, folder, signal) {
  const command = String(args.command || '').trim();
  const secs = Math.max(5, Math.min(600, parseInt(args.timeout_seconds, 10) || 120));
  const r = await remoteExec(folder.uri, command, cleanRel(args.cwd || ''), secs, signal);
  const out = clip(r.stdout, 12000); const err = clip(r.stderr, 4000);
  const ok = Number(r.exitCode) === 0;
  return (out ? out.replace(/\s+$/, '') + '\n' : '') + (err ? '[stderr]\n' + err.replace(/\s+$/, '') + '\n' : '') + (!out && !err ? '[no output]\n' : '') +
    '[exit code ' + r.exitCode + (r.errmsg ? '; ' + r.errmsg : '') + '] ' + (ok ? 'Command succeeded.' : 'Command FAILED. Read the output above before answering.');
}

export async function runTermux(args, folder, signal) {
  if (folder && folder.remote) return runServer(args, folder, signal);
  const original = String(args.command || '').trim();
  const cwd = await workdir(args, folder);
  const secs = Math.max(5, Math.min(600, parseInt(args.timeout_seconds, 10) || 120));
  const w = await withGitToken(original, folder);
  const tag = 'kdex-run-' + Math.random().toString(36).slice(2, 10);
  let onAbort;
  const stopped = new Promise((_, rej) => {
    if (!signal) return;
    onAbort = () => { killTagged(tag); rej(new Error('Cancelled by the user.')); };
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
  });
  let r;
  try { r = await Promise.race([Termux.run(w.command + '\n# ' + tag, cwd, secs * 1000), stopped]); } finally { if (signal && onAbort) signal.removeEventListener('abort', onAbort); }
  if (GIT_NET.test(original) && folder) resetGitCache(folder); // the repository may have changed behind the app's back
  if (w.secret) { const hide = (x) => String(x || '').split(w.secret).join('***'); r.stdout = hide(r.stdout); r.stderr = hide(r.stderr); r.errmsg = hide(r.errmsg); }
  let hint = '';
  if (GIT_NET.test(original) && Number(r.exitCode) !== 0 && /Authentication failed|could not read (Username|Password)|403|401|Permission denied|not found/i.test(String(r.stderr) + String(r.stdout))) {
    hint = w.secret ? '\n[hint] The saved token for ' + w.host + ' was used and the server refused it: it may be expired, or lack write permission (GitHub: repo scope, or Contents: Read and write). Tell the user to fix it in Settings > Git > Identity and access tokens.'
      : '\n[hint] No access token is saved' + (w.host ? ' for ' + w.host : ' (the host could not be told)') + ', or the setting that lends it to Termux is off. Tell the user to add one in Settings > Git > Identity and access tokens.';
  }
  const out = clip(r.stdout, 12000); const err = clip(r.stderr, 4000);
  const ok = Number(r.exitCode) === 0;
  return (out ? out.replace(/\s+$/, '') + '\n' : '') + (err ? '[stderr]\n' + err.replace(/\s+$/, '') + '\n' : '') + (!out && !err ? '[no output]\n' : '') +
    '[exit code ' + r.exitCode + (r.errmsg ? '; ' + r.errmsg : '') + '] ' + (ok ? 'Command succeeded.' : 'Command FAILED. Read the output above before answering.') + hint;
}

// ---------------------------------------------------------------- always allow
const NEVER_ALLOW = new Set(['rm', 'rmdir', 'sudo', 'su', 'sh', 'bash', 'zsh', 'dash', 'eval', 'exec', 'source', 'dd', 'mkfs', 'chmod', 'chown', 'kill', 'pkill', 'killall', 'shutdown', 'reboot', 'xargs', 'curl', 'wget', 'nc', 'ncat', 'ssh', 'scp', 'sftp', 'ftp', 'telnet', 'mv', 'cp', 'tee', 'termux-open', 'termux-open-url', 'am']);
const NEVER_KEYS = new Set(['git push', 'git reset', 'git clean', 'git rebase', 'git checkout', 'npm publish', 'pnpm publish', 'yarn publish', 'cargo publish']);
const WRAPPERS = new Set(['nohup', 'time', 'env', 'timeout', 'nice', 'command']);
const TWO_WORD = new Set(['git', 'npm', 'pnpm', 'yarn', 'pkg', 'pip', 'pip3', 'npx', 'cargo', 'go']);

/** The words of each simple command in a line, or null when the line uses substitutions we cannot judge safely. */
function segments(command) {
  const c = String(command || '');
  if (/`|\$\(|<\(|>\(/.test(c)) return null;
  return c.split(/&&|\|\||[;|&\n]/).map((x) => x.trim()).filter(Boolean).map((seg) => {
    const w = seg.split(/\s+/);
    while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || WRAPPERS.has(w[0]))) { const was = w.shift(); if (was === 'timeout' && w.length) w.shift(); }
    return w;
  }).filter((w) => w.length);
}
function keyOf(w) { return TWO_WORD.has(w[0]) && w[1] && !w[1].startsWith('-') ? w[0] + ' ' + w[1] : w[0]; }

/** Which prefixes would be remembered by "Always allow" for this command (empty when it must always ask). */
export function allowKeys(command) {
  if (DANGER.test(String(command || ''))) return [];
  const segs = segments(command); if (!segs || !segs.length) return [];
  const keys = [];
  for (const w of segs) { if (NEVER_ALLOW.has(w[0]) || /^\.{0,2}\//.test(w[0])) return []; const k = keyOf(w); if (NEVER_KEYS.has(k)) return []; if (!keys.includes(k)) keys.push(k); }
  return keys;
}
/** True when every part of the command was allowed earlier in this chat. */
export function isAllowed(command, allow) {
  if (!allow || !allow.length) return false;
  const keys = allowKeys(command); return !!keys.length && keys.every((k) => allow.includes(k));
}

// ---------------------------------------------------------------- background jobs
const sq = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
const jobName = (n) => { const v = String(n || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40); if (!v) throw new Error('A job name (letters, digits, - and _) is required.'); return v; };
const JOBDIR = '"$HOME/.kdex/jobs"';
const ALIVE = 'alive() { kill -0 "$1" 2>/dev/null && ! grep -q "^State:[[:space:]]*Z" "/proc/$1/status" 2>/dev/null; }; ';

export async function previewJob(args, folder) {
  const command = String(args.command || '').trim(); if (!command) throw new Error('command is required');
  const cwd = await workdir(args, folder);
  const lines = [{ t: 'ctx', text: 'background job "' + jobName(args.name) + '"' }, { t: 'ctx', text: '$ ' + command }, { t: 'ctx', text: 'in ' + cwd }];
  if (DANGER.test(command)) lines.push({ t: 'del', text: 'Warning: this command can delete data or change the system.' });
  if (SECRET_READ.test(command)) lines.push({ t: 'del', text: 'Warning: this command prints a secret file. Its output is sent to your AI provider.' });
  const ow = outsideLine(command, await getTermuxPath(folder)); if (ow) lines.push(ow);
  return lines;
}
async function sh(script, secs) { const r = await Termux.run(script, undefined, (secs || 30) * 1000); return { out: (String(r.stdout || '') + (r.stderr ? '\n' + r.stderr : '')).trim(), code: Number(r.exitCode) }; }

export async function runJob(name, args, folder) {
  if (name === 'list_jobs') {
    const r = await sh(ALIVE + 'J=' + JOBDIR + '; mkdir -p "$J"; n=0; for f in "$J"/*.pid; do [ -e "$f" ] || continue; n=1; b=$(basename "$f" .pid); p=$(cat "$f"); if alive "$p"; then echo "$b  RUNNING  pid $p"; else echo "$b  stopped"; fi; done; [ $n = 0 ] && echo "No jobs."; true');
    return r.out || 'No jobs.';
  }
  const n = jobName(args.name);
  if (name === 'start_job') {
    const command = String(args.command || '').trim(); const cwd = await workdir(args, folder);
    const script = ALIVE + 'J=' + JOBDIR + '; mkdir -p "$J"; N=' + sq(n) + '; ' +
      'if [ -f "$J/$N.pid" ] && alive "$(cat "$J/$N.pid")"; then echo "Job $N is already running (pid $(cat "$J/$N.pid")). Stop it first with stop_job."; exit 3; fi; ' +
      'command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock; cd ' + sq(cwd) + ' || exit 2; ' +
      'nohup bash -c ' + sq(command) + ' > "$J/$N.log" 2>&1 < /dev/null & P=$!; echo $P > "$J/$N.pid"; sleep 2; ' +
      'if alive $P; then echo "Started job $N (pid $P). Check it with check_job."; else echo "Job $N ended within 2 seconds, so it is not long-running. Output:"; tail -n 25 "$J/$N.log"; fi';
    const r = await sh(script, 40);
    return r.out + (r.code ? '\n[exit code ' + r.code + '] The job did not start.' : '');
  }
  if (name === 'check_job') {
    const lines = Math.max(1, Math.min(200, parseInt(args.lines, 10) || 30));
    const r = await sh(ALIVE + 'J=' + JOBDIR + '; N=' + sq(n) + '; [ -f "$J/$N.pid" ] || { echo "No job named $N."; exit 4; }; P=$(cat "$J/$N.pid"); if alive "$P"; then echo "[RUNNING pid $P]"; else echo "[STOPPED]"; fi; tail -n ' + lines + ' "$J/$N.log" 2>/dev/null');
    return clip(r.out, 8000);
  }
  if (name === 'stop_job') {
    const r = await sh(ALIVE + 'J=' + JOBDIR + '; N=' + sq(n) + '; [ -f "$J/$N.pid" ] || { echo "No job named $N."; exit 4; }; P=$(cat "$J/$N.pid"); pkill -P "$P" 2>/dev/null; kill "$P" 2>/dev/null; sleep 1; alive "$P" && kill -9 "$P" 2>/dev/null; sleep 0.3; if alive "$P"; then echo "Could not stop job $N."; exit 1; else echo "Stopped job $N."; fi');
    return r.out;
  }
  throw new Error('Unknown job tool');
}

/** Commands that can destroy data, change the system or publish work. They always ask, even in Auto mode. */
const RISKY = /(^|[;&|\n]\s*|\s)(sudo|su|rm|rmdir|dd|mkfs\S*|chmod|chown|kill|pkill|killall|shutdown|reboot|ssh|scp|sftp|mkfs)(\s|$)|\bgit\s+(push|reset|clean|rebase)\b|\b(npm|pnpm|yarn|cargo)\s+publish\b|>\s*\/dev\/(?!null\b)|\b(curl|wget)\b[^|;]*\|\s*(ba|z)?sh\b|:\(\)\s*\{/i;
// Commands that can send data out of the phone. A web page or file may carry hidden instructions, so these always ask,
// even in Auto mode. Plain downloads (curl URL, wget URL, pip, npm, git) keep running without a prompt.
const EGRESS = new RegExp([
  '\\b(curl|wget|http|httpie)\\b[^\\n;|&]*(\\s-d\\b|\\s-F\\b|\\s-T\\b|--data\\S*|--form\\b|--upload-file|--post-\\S+|--body-\\S+|\\s-X\\s*(POST|PUT|PATCH|DELETE)|--method|\\s-H\\s*["\']?Authorization)',
  '\\b(curl|wget)\\b[^\\n;|&]*(\\$\\(|`)',
  '\\b(nc|ncat|netcat|socat|telnet|ftp|sftp|rsync|scp)\\b',
  'KDEX_GIT|\\.kdex/askpass|\\.git-credentials|\\.netrc',
  '\\b(requests|httpx|aiohttp)\\.(post|put|patch|delete|request)\\b|urllib\\.request|http\\.client|\\bsocket\\.|net\\.connect|fetch\\([^)]*method',
].join('|'), 'i');
export function isRiskyCommand(command, remote) { const c = String(command || ''); return DANGER.test(c) || RISKY.test(c) || EGRESS.test(c) || SECRET_READ.test(c) || !!(remote && SERVER_RISKY.test(c)); }

// ------------------------------------------------------------------ setup checker
export const CHECK_TOOLS_TOOL = {
  name: 'check_tools',
  description: 'Check which common programs are installed in Termux (git, node, python, curl, zip, ImageMagick, poppler for PDF text, ffmpeg, sqlite, jq and more) and how much storage and memory are free. It changes nothing. Use it before a task that needs a program, or when a command fails with "not found".',
  parameters: { type: 'object', properties: {} },
};
const CHECK_LIST = [
  ['git', 'git'], ['node', 'nodejs'], ['npm', 'nodejs'], ['python3', 'python'], ['pip', 'python-pip'], ['curl', 'curl'], ['unzip', 'unzip'], ['zip', 'zip'],
  ['convert', 'imagemagick'], ['pdftotext', 'poppler'], ['ffmpeg', 'ffmpeg'], ['sqlite3', 'sqlite'], ['jq', 'jq'], ['php', 'php', 1], ['go', 'golang', 1], ['rustc', 'rust', 1],
];
export async function checkTools(folder) {
  const base = await getTermuxPath(folder);
  if (!base) throw new Error('The Termux path of this folder is unknown. Set it in Settings > Terminal.');
  const names = CHECK_LIST.map((x) => x[0]).join(' ');
  const cmd = 'for t in ' + names + '; do if command -v "$t" >/dev/null 2>&1; then echo "OK $t"; else echo "MISSING $t"; fi; done; ' +
    'echo "VERSIONS"; git --version 2>&1 | head -1; node --version 2>&1 | head -1; python3 --version 2>&1 | head -1; ' +
    'echo "SPACE"; df -h . 2>/dev/null | tail -1; free -m 2>/dev/null | sed -n 2p';
  const r = await Termux.run(cmd, base, 30000);
  if (Number(r.exitCode) !== 0 && !String(r.stdout || '').includes('OK ') && !String(r.stdout || '').includes('MISSING ')) {
    throw new Error('Could not reach Termux: ' + String(r.errmsg || r.stderr || 'no answer').slice(0, 200) + '. Check Settings > Terminal (permission, allow-external-apps, Termux open).');
  }
  const out = String(r.stdout || '');
  const ok = []; const missing = [];
  for (const l of out.split('\n')) { const m = /^(OK|MISSING) (\S+)/.exec(l); if (m) (m[1] === 'OK' ? ok : missing).push(m[2]); }
  const pkgs = [...new Set(missing.filter((n) => !(CHECK_LIST.find((x) => x[0] === n) || [])[2]).map((n) => (CHECK_LIST.find((x) => x[0] === n) || [])[1]).filter(Boolean))];
  const heavy = missing.filter((n) => (CHECK_LIST.find((x) => x[0] === n) || [])[2]);
  const tail = out.split('VERSIONS')[1] || '';
  return 'Installed: ' + (ok.join(', ') || 'none') + '\nMissing: ' + (missing.join(', ') || 'none') +
    (pkgs.length ? '\nInstall with: pkg install -y ' + pkgs.join(' ') + '  (install only what the task needs; run it with run_command after the user agrees)' : '') +
    (heavy.length ? '\nBig installs (only if the task truly needs them; ' + heavy.join(', ') + ' are 40 to 600 MB): php, golang, rust.' : '') +
    '\n' + tail.replace('SPACE', 'Storage and memory:').trim();
}
