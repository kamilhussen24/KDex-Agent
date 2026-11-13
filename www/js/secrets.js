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
  s = s.replace(/(https?:\/\/)[^\/\s:@'"]+:[^\/\s@'"]+@/g, '$1***@'); // user:token@host in remote URLs
  if (await protectionOn()) s = redactPatterns(s);
  return s;
}
/** Hides things that look like secrets wherever they appear: private keys, well-known token shapes, and NAME=value lines with a secret-like name. */
export function redactPatterns(text) {
  return String(text)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, '[private key hidden]')
    .replace(/\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g, '***')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{20,}=*/g, 'Bearer ***')
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|PRIVATE|CREDENTIALS?|AUTH)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"']{6,})\3/g, '$1$2$3***$3')
    .replace(/"([\w.-]*(?:key|secret|token|passw(?:or)?d|pass|pwd|credential|auth)[\w.-]*)"(\s*:\s*)"([^"]{6,})"/gi, '"$1"$2"***"');
}
export const PROTECTED_MSG = 'This file is protected. Its contents are hidden from me and from the chat on purpose. Programs you run in the terminal can still use it. Do not ask the user to paste secret values. If a variable is missing, call request_env_var: the user types the value in a private box and you never see it.';

export const ENV_TOOL = {
  name: 'request_env_var',
  description: 'Add missing environment variables to the project\'s .env file. Pass vars: a list of { name, value?, description? }. PLAIN settings (PORT, HOST, NODE_ENV, APP_NAME, APP_URL on localhost, DEBUG, LOG_LEVEL, TZ, a sqlite path...) are set by the app itself: give each a sensible example value and do not ask the user. SECRETS (API keys, tokens, passwords, anything with KEY, SECRET, TOKEN, PASSWORD in the name) are asked from the user one by one in a private box where they can type the value or skip; you never see it, and you must not give a value for them. Existing variables are never changed, and every name is also listed in .env.example. Use one call for all missing variables. Single form { name, value, description } also works.',
  parameters: { type: 'object', properties: {
    vars: { type: 'array', description: 'Variables to add', items: { type: 'object', properties: { name: { type: 'string', description: 'UPPER_SNAKE_CASE' }, value: { type: 'string', description: 'Example value, only for plain settings' }, description: { type: 'string', description: 'One short line: what it is and where to get it (for secrets)' } }, required: ['name'] } },
    name: { type: 'string' }, value: { type: 'string' }, description: { type: 'string' },
    file: { type: 'string', description: 'Default .env. Another name such as .env.local is allowed.' } } },
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
export async function writeEnvVar(folder, file, name, value, example = '') {
  const st = await envStatus(folder, file, name);
  if (st.state === 'set') throw new Error(name + ' is already set in ' + file + '. It was not changed.');
  if (value == null) return addExample(folder, name, example);
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
  notes.push(...await addExample(folder, name, example));
  return notes;
}

const PLAIN_NAMES = /^(PORT|HOST|HOSTNAME|BIND(_ADDR(ESS)?)?|APP_PORT|SERVER_PORT|APP_HOST|NODE_ENV|APP_ENV|ENV|ENVIRONMENT|FLASK_ENV|FLASK_DEBUG|DJANGO_DEBUG|DEBUG|LOG_LEVEL|LOG_FORMAT|TZ|TIMEZONE|LANG|LANGUAGE|LOCALE|DEFAULT_LANGUAGE|DEFAULT_LOCALE|PYTHONUNBUFFERED|WORKERS|WEB_CONCURRENCY|NEXT_TELEMETRY_DISABLED|CI|HEADLESS|DB_HOST|DB_PORT|DB_NAME|DB_PATH|DATABASE_PATH|SQLITE_PATH|TIMEOUT|REQUEST_TIMEOUT|MAX_UPLOAD_SIZE|RATE_LIMIT|CACHE_TTL|SESSION_LIFETIME|APP_URL|BASE_URL|SITE_URL|PUBLIC_URL|API_URL|FRONTEND_URL|BACKEND_URL|CORS_ORIGIN|DATABASE_URL|(NEXT_PUBLIC|VITE|REACT_APP)_[A-Z0-9_]+)$/;
const TEXT_NAMES = /^(APP_NAME|SITE_NAME|APP_TITLE|PROJECT_NAME)$/;
const SECRETISH = /(KEY|SECRET|TOKEN|PASS|PWD|PRIVATE|CREDENTIAL|AUTH|SALT|SIGN|CERT|DSN)/i;
/** True only for ordinary settings with an ordinary value; everything else goes through the private box. */
export function isPlainSetting(name, value) {
  const v = String(value == null ? '' : value).trim();
  if (!v || v.length > 60 || SECRETISH.test(name) || /["'`$\\]/.test(v)) return false;
  if (/^[A-Za-z0-9+/=_-]{24,}$/.test(v)) return false; // looks like a token
  if (TEXT_NAMES.test(name)) return /^[\w .&-]{1,40}$/.test(v);
  if (!PLAIN_NAMES.test(name) || /\s/.test(v) || !/^[A-Za-z0-9_@%+=:,./-]+$/.test(v)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^(file|sqlite):/i.test(v)) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/[\w./-]*)?$/.test(v)) return true;
    return /^(sqlite:\/\/\/?|file:)[\w./-]+$/.test(v) && name !== 'PORT';
  }
  return true;
}

/** List a variable in .env.example (never with a real secret). Returns notes. */
export async function addExample(folder, name, example = '') {
  try {
    const ex = await fs.stat(folder.uri, '.env.example');
    const t = ex && ex.exists ? (await fs.readText(folder.uri, '.env.example', 100000)).text : '';
    if (new RegExp('^\\s*' + name + '\\s*=', 'm').test(t)) return [];
    await fs.writeText(folder.uri, '.env.example', t + (t && !t.endsWith('\n') ? '\n' : '') + name + '=' + quoteEnv(String(example)) + '\n');
    return ['Listed ' + name + ' in .env.example.'];
  } catch (e) { return []; }
}
