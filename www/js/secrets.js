// Secret files (.env, keys, credentials): the agent may run projects that use them, but never reads them.
// Their contents are hidden from the model and from the chat. Values are also removed from terminal output.
import { fs } from './native.js';
import { kvGet } from './db.js';

const SAFE_ENV = /^\.env\.(example|sample|template|dist|defaults)$/i;
const SECRET_NAME = [
  /^\.env(\..+)?$/i, /\.(pem|key|p12|pfx|jks|keystore|asc|gpg)$/i, /^id_(rsa|dsa|ecdsa|ed25519)$/i, /^\.netrc$/i, /^\.git-credentials$/i,
  /^\.npmrc$/i, /^\.pypirc$/i, /^\.htpasswd$/i, /^credentials(\..+)?$/i, /^secrets?(\..+)?$/i, /service[-_]?account.*\.json$/i, /\.tfvars$/i, /^google-services\.json$/i,
];
const ENV_LIKE = /^(\.env(\..+)?|\.npmrc|\.pypirc|\.netrc|secrets?\.(env|ya?ml|toml|ini)|.*\.tfvars)$/i;

export async function protectionOn() { const s = await kvGet('settings', {}); return s.protectSecrets !== false; }
const base = (rel) => String(rel || '').replace(/\\/g, '/').split('/').pop();
/** True for files whose contents must stay hidden. */
export function isSecretPath(rel) { const b = base(rel); return !!b && !SAFE_ENV.test(b) && SECRET_NAME.some((r) => r.test(b)); }
export const isEnvLike = (rel) => ENV_LIKE.test(base(rel));

/** Hide the values of an env-style file but keep the variable names, so the model knows what exists. */
export function maskEnv(text) {
  return String(text || '').split('\n').map((l) => {
    const m = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*[=:])\s*(.*)$/.exec(l);
    return m && !/^\s*#/.test(l) ? m[1] + (m[2] ? '<hidden>' : '') : (/^\s*#/.test(l) ? l : l.trim() ? '<hidden>' : l);
  }).join('\n');
}

function valuesOf(rel, text) {
  const out = new Set();
  if (isEnvLike(rel)) {
    for (const l of String(text).split('\n')) {
      const m = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*[=:]\s*(.*)$/.exec(l); if (!m || /^\s*#/.test(l)) continue;
      let v = m[1].trim().replace(/\s+#.*$/, ''); v = v.replace(/^(['"])(.*)\1$/, '$2');
      if (v.length >= 6 && !/^(true|false|null|none|localhost|development|production|\d+)$/i.test(v)) out.add(v);
    }
  } else {
    for (const m of String(text).matchAll(/"([^"\\]{12,})"|^([A-Za-z0-9+/=_-]{20,})$/gm)) out.add(m[1] || m[2]);
    for (const l of String(text).split('\n')) { const t = l.trim(); if (t.length >= 20 && !/^-----/.test(t) && !/\s/.test(t)) out.add(t); }
  }
  return [...out];
}

const cache = new Map(); // folder id -> { t, values }
/** All secret values found in the project's secret files (cached briefly). */
export async function secretValues(folder) {
  if (!folder || !(await protectionOn())) return [];
  const c = cache.get(folder.id); if (c && Date.now() - c.t < 20000) return c.values;
  const values = new Set();
  try {
    const { files } = await fs.walk(folder.uri, '', 3000);
    for (const f of files.filter((x) => isSecretPath(x.path) && x.size < 200000).slice(0, 40)) {
      try { const r = await fs.readText(folder.uri, f.path, 200000); if (!r.binary) valuesOf(f.path, r.text).forEach((v) => values.add(v)); } catch (e) { /* unreadable */ }
    }
  } catch (e) { /* ignore */ }
  const list = [...values].sort((a, b) => b.length - a.length);
  cache.set(folder.id, { t: Date.now(), values: list });
  return list;
}
export function forgetSecrets(folder) { if (folder) cache.delete(folder.id); else cache.clear(); }
/** Replace every secret value in `text` with ***. Longest values first. */
export async function scrub(text, folder) {
  let s = String(text == null ? '' : text); if (!s) return s;
  for (const v of await secretValues(folder)) if (s.includes(v)) s = s.split(v).join('***');
  return s;
}
export const PROTECTED_MSG = 'This file is protected. Its contents are hidden from me and from the chat on purpose. Programs you run in the terminal can still use it. Do not ask the user to paste secret values. If a variable is missing, call request_env_var: the user types the value in a private box and you never see it.';

export const ENV_TOOL = {
  name: 'request_env_var',
  description: 'Ask the user to add a missing environment variable (for example an API key) to the project\'s .env file. The user types the value in a private box; you never see it and it never appears in the chat. Existing variables are never changed. Use it only when the project needs a variable that is not set yet.',
  parameters: { type: 'object', properties: { name: { type: 'string', description: 'Variable name in UPPER_SNAKE_CASE, for example STRIPE_SECRET_KEY' }, description: { type: 'string', description: 'One short line telling the user what this value is and where to get it' }, file: { type: 'string', description: 'Default .env. Another name such as .env.local is allowed.' } }, required: ['name'] },
};
export const VALID_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function envFileName(f) { const n = String(f || '.env').trim().replace(/\\/g, '/'); if (n.includes('/') || !/^\.env(\.[A-Za-z0-9_-]+)?$/.test(n) || SAFE_ENV.test(n)) throw new Error('The file must be .env or a name like .env.local in the project root.'); return n; }
/** 'missing' | 'empty' | 'set' for a variable in an env file, without exposing the value. */
export async function envStatus(folder, file, name) {
  let text = '';
  try { const st = await fs.stat(folder.uri, file); if (!st || !st.exists) return { state: 'missing', exists: false }; text = (await fs.readText(folder.uri, file, 200000)).text; } catch (e) { return { state: 'missing', exists: false }; }
  const re = new RegExp('^\\s*(?:export\\s+)?' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(.*)$', 'm');
  const m = re.exec(text); if (!m) return { state: 'missing', exists: true };
  return { state: m[1].replace(/^(['"])(.*)\1$/, '$2').trim() ? 'set' : 'empty', exists: true };
}
const quoteEnv = (v) => (/^[A-Za-z0-9_@%+=:,./-]*$/.test(v) ? v : '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"');
/** Write NAME=value into the env file (add, or fill an empty one). Never overwrites an existing value. Returns notes. */
export async function writeEnvVar(folder, file, name, value) {
  const st = await envStatus(folder, file, name);
  if (st.state === 'set') throw new Error(name + ' is already set in ' + file + '. It was not changed.');
  let text = '';
  if (st.exists) text = (await fs.readText(folder.uri, file, 200000)).text;
  const line = name + '=' + quoteEnv(String(value));
  if (st.state === 'empty') text = text.replace(new RegExp('^(\\s*(?:export\\s+)?' + name + '\\s*=).*$', 'm'), () => line);
  else text = text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n';
  await fs.writeText(folder.uri, file, text);
  forgetSecrets(folder);
  const notes = [];
  // keep the file out of Git, and list the name (without a value) in .env.example
  try {
    const gi = await fs.stat(folder.uri, '.gitignore'); const hasGit = (await fs.stat(folder.uri, '.git').catch(() => null));
    if ((gi && gi.exists) || (hasGit && hasGit.exists)) {
      const cur = gi && gi.exists ? (await fs.readText(folder.uri, '.gitignore', 100000)).text : '';
      if (!/^\/?\.env(\*|\.\*)?\s*$/m.test(cur)) { await fs.writeText(folder.uri, '.gitignore', cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '.env\n.env.*\n!.env.example\n'); notes.push('Added .env to .gitignore so it is not committed.'); }
    }
  } catch (e) { /* optional */ }
  try {
    const ex = await fs.stat(folder.uri, '.env.example');
    if (ex && ex.exists) { const t = (await fs.readText(folder.uri, '.env.example', 100000)).text; if (!new RegExp('^\\s*' + name + '\\s*=', 'm').test(t)) { await fs.writeText(folder.uri, '.env.example', t + (t && !t.endsWith('\n') ? '\n' : '') + name + '=\n'); notes.push('Listed ' + name + ' in .env.example.'); } }
  } catch (e) { /* optional */ }
  return notes;
}
