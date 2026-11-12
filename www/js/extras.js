// Extra tools the model can call: project map, project checks, calculator, unit converter and notes.
// Everything here is read-only or touches only the app's own memory notes, so no approval card is needed.
import { fs } from './native.js';
import { isSecretPath } from './secrets.js';
import { BINARY_EXT, isGitInternal } from './tools.js';
import { addMemoryNote } from './agent.js';

export const EXTRA_FOLDER_TOOLS = [
  {
    name: 'project_map',
    description: 'Show the structure of the project in one call: folders, and the functions, classes and routes defined in each source file (names and line numbers only). Use it once at the start of work on an unfamiliar or large project, then read_file only the parts you need. Optionally limit it to a sub-folder.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Optional sub-folder, default the whole project' } } },
  },
  {
    name: 'project_checks',
    description: 'Detect which lint, test, type-check and build commands this project has (from package.json, requirements, Makefile and similar files) and return them lightest first. It runs nothing. After changing code, call it once, then run the lightest suitable command with run_command (when the terminal is available) and fix any errors it shows.',
    parameters: { type: 'object', properties: {} },
  },
];

export const EXTRA_ANY_TOOLS = [
  {
    name: 'calculate',
    description: 'Calculate a math expression exactly. Supports + - * / ^ % ( ), constants pi and e, and functions sqrt, abs, round, floor, ceil, min, max, pow, log (base 10), ln, sin, cos, tan. Use it for any sum, percentage, split, conversion rate or margin so the result is not guessed. Example: "1250 * 1.15 / 3".',
    parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
  },
  {
    name: 'convert_units',
    description: 'Convert a value between units of length, weight, volume, temperature, area, speed, data size or time. Not for money: for currency rates read a live rate with web_fetch (or curl in the terminal) and then use calculate.',
    parameters: { type: 'object', properties: { value: { type: 'number' }, from: { type: 'string', description: 'For example km, mile, kg, lb, c, f, gb, mb, hour' }, to: { type: 'string' } }, required: ['value', 'from', 'to'] },
  },
  {
    name: 'remember',
    description: 'Save one short lasting fact about the user as a note on this phone, so it is available in all future chats. Use it when the user says "remember this" or tells you a stable preference or fact. One short line, never secrets, passwords, card numbers or health details.',
    parameters: { type: 'object', properties: { note: { type: 'string', description: 'One short line, for example "Prefers answers in Bengali"' } }, required: ['note'] },
  },
];

export const EXTRA_FOLDER_NAMES = new Set(EXTRA_FOLDER_TOOLS.map((t) => t.name));
export const EXTRA_ANY_NAMES = new Set(EXTRA_ANY_TOOLS.map((t) => t.name));

// ------------------------------------------------------------------ project map
const SKIP = /(^|\/)(node_modules|\.git|dist|build|out|target|__pycache__|\.venv|venv|\.next|\.gradle|\.idea|coverage|vendor|android\/app\/build)(\/|$)/;
const SRC = /\.(js|mjs|cjs|jsx|ts|tsx|py|java|kt|go|rs|php|rb|c|h|cpp|cs|swift|dart|sh)$/i;
const PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^\s*class\s+([A-Za-z_]\w*)/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
  /^\s*(?:public|private|protected|static|final|abstract|\s)+[\w<>\[\],.? ]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:throws [\w, .]+)?\{?\s*$/,
  /^\s*(?:app|router|server)\.(get|post|put|delete|patch|use)\(\s*['"`]([^'"`]+)/,
  /^\s*@(?:app|router|bp)\.(?:route|get|post|put|delete)\(\s*['"]([^'"]+)/,
];
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'new', 'function', 'constructor']);

function symbolsOf(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < 40; i++) {
    const l = lines[i];
    if (l.length > 240 || /^\s*(\/\/|#|\*|\/\*)/.test(l)) continue;
    for (const re of PATTERNS) {
      const m = re.exec(l);
      if (!m) continue;
      const name = m[2] ? m[1].toUpperCase() + ' ' + m[2] : m[1];
      if (NOT_NAMES.has(name)) break;
      out.push(name + ':' + (i + 1));
      break;
    }
  }
  return out;
}

export async function projectMapTool(args, folder) {
  const base = String((args && args.path) || '').replace(/^\/+|\/+$/g, '');
  const { files, truncated } = await fs.walk(folder.uri, base, 3000);
  const list = files.filter((f) => !SKIP.test(f.path) && !isGitInternal(f.path) && !isSecretPath(f.path));
  const srcFiles = list.filter((f) => SRC.test(f.path) && !BINARY_EXT.test(f.path) && f.size < 200000);
  const lines = ['Project: ' + folder.name + (base ? ' / ' + base : '') + ' · ' + list.length + (truncated ? '+' : '') + ' files'];
  const byDir = {};
  list.forEach((f) => { const i = f.path.lastIndexOf('/'); const d = i < 0 ? '(root)' : f.path.slice(0, i); (byDir[d] = byDir[d] || []).push(f); });
  const dirs = Object.keys(byDir).sort();
  let budget = 14000; let readFiles = 0; const started = Date.now();
  for (const d of dirs) {
    if (budget < 300) { lines.push('... map cut here; run it again with a path to see more'); break; }
    const here = byDir[d].sort((a, b) => a.path.localeCompare(b.path));
    lines.push('\n' + d + '/');
    for (const f of here) {
      const nm = f.path.slice(f.path.lastIndexOf('/') + 1);
      let row = '  ' + nm;
      if (srcFiles.includes(f) && readFiles < 120 && Date.now() - started < 9000) {
        readFiles++;
        try {
          const r = await fs.readText(folder.uri, f.path, 200000);
          if (!r.binary) {
            const sy = symbolsOf(r.text);
            row += '  (' + r.text.split('\n').length + ' lines)' + (sy.length ? ': ' + sy.join(', ') : '');
          }
        } catch (e) { /* unreadable, list the name only */ }
      }
      if (row.length > 600) row = row.slice(0, 600) + ' ...';
      lines.push(row); budget -= row.length;
      if (budget < 0) break;
    }
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ project checks
async function readJson(folder, rel) {
  try { const r = await fs.readText(folder.uri, rel, 200000); return JSON.parse(r.text); } catch (e) { return null; }
}
async function readTxt(folder, rel) {
  try { const r = await fs.readText(folder.uri, rel, 100000); return r.binary ? '' : r.text; } catch (e) { return ''; }
}

export async function projectChecksTool(args, folder) {
  const rootNames = new Set((await fs.list(folder.uri, '')).map((e) => e.name));
  const found = [];
  const add = (kind, cmd, why) => found.push({ kind, cmd, why });
  const has = (n) => rootNames.has(n);

  if (has('package.json')) {
    const pkg = await readJson(folder, 'package.json') || {};
    const sc = pkg.scripts || {};
    const run = has('pnpm-lock.yaml') ? 'pnpm run' : has('yarn.lock') ? 'yarn' : 'npm run';
    const missing = !has('node_modules') ? ' (run the install command first: npm install)' : '';
    for (const k of ['lint', 'typecheck', 'type-check', 'check', 'test', 'build']) {
      if (sc[k]) add(k === 'test' ? 'test' : k === 'build' ? 'build' : 'lint', run + ' ' + k, 'package.json script "' + k + '": ' + String(sc[k]).slice(0, 80) + missing);
    }
    if (!sc.lint && (has('.eslintrc') || has('.eslintrc.json') || has('.eslintrc.js') || has('eslint.config.js') || has('eslint.config.mjs'))) add('lint', 'npx eslint .', 'ESLint config found');
    if (has('tsconfig.json') && !sc.typecheck && !sc['type-check']) add('lint', 'npx tsc --noEmit', 'tsconfig.json found');
    if (!found.length) add('syntax', 'node --check <file.js>', 'no scripts in package.json; check a changed file directly');
  }
  if (has('requirements.txt') || has('pyproject.toml') || has('setup.py') || has('Pipfile') || [...rootNames].some((n) => /\.py$/.test(n))) {
    const py = await readTxt(folder, 'pyproject.toml');
    const req = await readTxt(folder, 'requirements.txt');
    if (/ruff/.test(py + req) || has('ruff.toml')) add('lint', 'ruff check .', 'ruff configured');
    if (/flake8/.test(py + req) || has('.flake8')) add('lint', 'flake8', 'flake8 configured');
    if (/pytest/.test(py + req) || has('pytest.ini') || has('tests') || has('test')) add('test', 'python3 -m pytest -x -q', 'tests folder or pytest found');
    add('syntax', 'python3 -m py_compile <file.py>', 'quick syntax check of a changed file (always available)');
  }
  if (has('go.mod')) { add('lint', 'go vet ./...', 'Go module'); add('test', 'go test ./...', 'Go module'); }
  if (has('Cargo.toml')) { add('lint', 'cargo check', 'Rust crate'); add('test', 'cargo test', 'Rust crate'); }
  if (has('Makefile')) {
    const mk = await readTxt(folder, 'Makefile');
    ['lint', 'test', 'check', 'build'].forEach((t) => { if (new RegExp('^' + t + ':', 'm').test(mk)) add(t === 'build' ? 'build' : t === 'test' ? 'test' : 'lint', 'make ' + t, 'Makefile target'); });
  }
  if (has('composer.json')) add('test', 'vendor/bin/phpunit', 'composer project (if phpunit is installed)');
  if (has('gradlew') || has('build.gradle') || has('pom.xml')) add('build', '(heavy) gradle/maven build', 'JVM project: too heavy for a phone; leave builds to CI and only read the code');
  if ([...rootNames].some((n) => /\.sh$/.test(n))) add('syntax', 'bash -n <script.sh>', 'shell syntax check');

  if (!found.length) return 'No standard lint or test setup was found in the project root. Check changed files another way: read them back, run the program with a small input, or use a syntax check for the language (node --check, python3 -m py_compile, bash -n).';
  const order = { syntax: 0, lint: 1, test: 2, build: 3 };
  found.sort((a, b) => order[a.kind] - order[b.kind]);
  return 'Checks found, lightest first (nothing was run):\n' + found.map((f) => '- [' + f.kind + '] ' + f.cmd + '  — ' + f.why).join('\n') +
    '\nRun the lightest one that fits with run_command, read the output, fix real errors, and run it again (at most 3 rounds). Say plainly which check you ran and its result.';
}

// ------------------------------------------------------------------ calculator (no eval)
const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, ln: Math.log, log: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS = { pi: Math.PI, e: Math.E };

export function calc(expr) {
  const s = String(expr || '').replace(/[,](?=\d{3}(\D|$))/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^');
  if (!s.trim()) throw new Error('The expression is empty.');
  if (s.length > 400) throw new Error('The expression is too long.');
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = () => { ws(); return s[i]; };
  function number() {
    ws(); const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) throw new Error('Unexpected "' + (s[i] || 'end') + '" at position ' + (i + 1) + '.');
    i += m[0].length; return parseFloat(m[0]);
  }
  function primary() {
    const c = peek();
    if (c === '(') { i++; const v = add(); if (peek() !== ')') throw new Error('Missing ")".'); i++; return v; }
    if (c === '-') { i++; return -unary(); }
    if (c === '+') { i++; return unary(); }
    if (/[a-z]/i.test(c || '')) {
      const m = /^[a-z]+/i.exec(s.slice(i)); const name = m[0].toLowerCase(); i += name.length;
      if (name in CONSTS) return CONSTS[name];
      if (!(name in FUNCS)) throw new Error('Unknown name "' + name + '".');
      if (peek() !== '(') throw new Error('Use ' + name + '(...) with brackets.');
      i++; const args = [];
      if (peek() !== ')') { for (;;) { args.push(add()); if (peek() === ',') { i++; continue; } break; } }
      if (peek() !== ')') throw new Error('Missing ")".'); i++;
      return FUNCS[name](...args);
    }
    return number();
  }
  function postfix() { let v = primary(); while (peek() === '%') { i++; v /= 100; } return v; }
  function unary() { return power(); }
  function power() { const b = postfix(); if (peek() === '^') { i++; return Math.pow(b, powerRhs()); } return b; }
  function powerRhs() { if (peek() === '-') { i++; return -powerRhs(); } return power(); }
  function mul() {
    let v = unary();
    for (;;) {
      const c = peek();
      if (c === '*') { i++; v *= unary(); } else if (c === '/') { i++; const d = unary(); if (d === 0) throw new Error('Division by zero.'); v /= d; } else break;
    }
    return v;
  }
  function add() {
    let v = mul();
    for (;;) { const c = peek(); if (c === '+') { i++; v += mul(); } else if (c === '-') { i++; v -= mul(); } else break; }
    return v;
  }
  const v = add();
  if (peek() !== undefined) throw new Error('Unexpected "' + s[i] + '" at position ' + (i + 1) + '.');
  if (!Number.isFinite(v)) throw new Error('The result is not a finite number.');
  return v;
}

function fmtNum(v) {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const r = Math.abs(v) >= 1e-6 && Math.abs(v) < 1e15 ? Number(v.toPrecision(12)) : v;
  return String(r);
}

// ------------------------------------------------------------------ units
const UNITS = {
  length: { m: 1, meter: 1, metre: 1, km: 1000, kilometer: 1000, cm: 0.01, mm: 0.001, mile: 1609.344, mi: 1609.344, yard: 0.9144, yd: 0.9144, foot: 0.3048, ft: 0.3048, feet: 0.3048, inch: 0.0254, in: 0.0254 },
  mass: { kg: 1, kilogram: 1, g: 0.001, gram: 0.001, mg: 1e-6, lb: 0.45359237, pound: 0.45359237, oz: 0.028349523125, ounce: 0.028349523125, ton: 1000, tonne: 1000 },
  volume: { l: 1, liter: 1, litre: 1, ml: 0.001, gallon: 3.785411784, gal: 3.785411784, cup: 0.2365882365, tbsp: 0.01478676478, tsp: 0.004928921594, floz: 0.0295735295625 },
  area: { sqm: 1, m2: 1, sqkm: 1e6, km2: 1e6, sqft: 0.09290304, ft2: 0.09290304, acre: 4046.8564224, hectare: 10000, ha: 10000, katha: 66.89, bigha: 1337.8 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, kmh: 1 / 3.6, mph: 0.44704, knot: 0.514444 },
  data: { b: 1, byte: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 },
  time: { s: 1, sec: 1, second: 1, min: 60, minute: 60, h: 3600, hour: 3600, day: 86400, week: 604800 },
};
const TEMP = new Set(['c', 'f', 'k', 'celsius', 'fahrenheit', 'kelvin']);
function findUnit(u) {
  const raw = String(u || '').toLowerCase().trim().replace(/[°.]/g, '');
  const cands = [raw, raw.replace(/s$/, ''), raw.replace(/es$/, ''), raw.replace(/\s+/g, '')];
  for (const c of cands) { if (TEMP.has(c)) return { kind: 'temp', key: c[0] }; for (const k of Object.keys(UNITS)) if (c in UNITS[k]) return { kind: k, key: c }; }
  return null;
}
export function convert(value, from, to) {
  const a = findUnit(from); const b = findUnit(to);
  if (!a) throw new Error('Unknown unit "' + from + '".');
  if (!b) throw new Error('Unknown unit "' + to + '".');
  if (a.kind !== b.kind) throw new Error('Cannot convert ' + a.kind + ' to ' + b.kind + '.');
  if (a.kind === 'temp') {
    const c = a.key === 'c' ? value : a.key === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
    return b.key === 'c' ? c : b.key === 'f' ? c * 9 / 5 + 32 : c + 273.15;
  }
  return value * UNITS[a.kind][a.key] / UNITS[b.kind][b.key];
}

// ------------------------------------------------------------------ dispatcher
export async function runExtra(name, args, folder) {
  args = args || {};
  if (name === 'project_map') return projectMapTool(args, folder);
  if (name === 'project_checks') return projectChecksTool(args, folder);
  if (name === 'calculate') { const v = calc(args.expression); return String(args.expression).trim() + ' = ' + fmtNum(v); }
  if (name === 'convert_units') {
    const val = Number(args.value);
    if (!Number.isFinite(val)) throw new Error('"value" must be a number.');
    const r = convert(val, args.from, args.to);
    return val + ' ' + args.from + ' = ' + fmtNum(r) + ' ' + args.to;
  }
  if (name === 'remember') {
    const note = String(args.note || '').trim();
    if (!note) throw new Error('"note" is empty.');
    if (/(password|passwd|api[_ -]?key|secret|token|\b\d{12,19}\b|sk-[A-Za-z0-9]{10,})/i.test(note)) throw new Error('Secrets and card or ID numbers are never saved as notes.');
    const ok = await addMemoryNote(note, 'model');
    return ok ? 'Saved the note: ' + note.slice(0, 240) : 'That note is already saved.';
  }
  throw new Error('Unknown tool: ' + name);
}
