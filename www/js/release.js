// Release tools: pre-push check, safe version bump, one-tap release, and the "review my changes" helpers.
// Version files are edited with exact, verified replacements (never a broad search-and-replace).
import { fs } from './native.js';
import * as G from './git.js';
import { lineDiff } from './tools.js';
import { isSecretPath, protectionOn } from './secrets.js';

// ---------------------------------------------------------------- tool definitions
export const RELEASE_TOOLS = [
  {
    name: 'pre_push_check',
    description: 'Check the project before it is pushed: package.json is valid JSON, the version is the same in package.json, package-lock.json and the app\'s version constant, every dependency range is valid and matches package-lock.json (the usual reason for a failed "npm ci"), and the changed files hold no merge-conflict marks or keys. It runs nothing and changes nothing. git_push also runs it by itself. After it passes, you may still run the project\'s own lint or test command (project_checks) and "npm ci --dry-run" in the terminal.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'bump_version',
    description: 'Raise the project version safely in package.json, package-lock.json and the app\'s version constant (APP_VERSION), with exact edits and a check that nothing else changed. Give either version ("1.2.3") or part ("patch", "minor" or "major"; default patch). The user approves the change first. Never edit version numbers with sed or a broad replace; use this tool.',
    parameters: { type: 'object', properties: { version: { type: 'string', description: 'Exact new version, for example 1.46.0' }, part: { type: 'string', enum: ['patch', 'minor', 'major'] } } },
  },
  {
    name: 'release_info',
    description: 'Prepare a release: shows the current version, the suggested next version, the branch, how this project\'s GitHub workflow publishes (so you know whether pushing is enough), the commits since the last release, and the current CHANGELOG "Unreleased" text. Read-only. Call it first, then write the release notes and call release.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'release',
    description: 'Publish a new version in one step: raise the version (package.json, package-lock.json, APP_VERSION), add the notes to CHANGELOG.md, run the pre-push check, commit as "Release vX.Y.Z" and push the branch, so the project\'s GitHub workflow builds and publishes it. The user approves one card that lists everything; it always asks, even in Auto mode. Call release_info first and write good notes from the commits. Do not use it when the user only wants a normal commit or push.',
    parameters: {
      type: 'object',
      properties: {
        part: { type: 'string', enum: ['patch', 'minor', 'major'], description: 'Default patch' },
        version: { type: 'string', description: 'Exact version instead of part' },
        notes: { type: 'string', description: 'Release notes in Markdown: "### Added", "### Changed" or "### Fixed" headings with short "- " bullets written for the user, not commit messages' },
      },
      required: ['notes'],
    },
  },
  {
    name: 'review_changes',
    description: 'Read all uncommitted changes (what is new, changed and removed, with line numbers) plus leftovers the app spotted (debug prints, TODO marks, merge-conflict marks, possible keys), so you can review them before a commit. Read-only. Check each spotted item against the code, look for real mistakes in the diff (broken logic, a renamed function whose callers still use the old name: use search to confirm), then call report_findings once.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'report_findings',
    description: 'Show the result of a review as a list the user can act on. severity: "risk" (could break the app, leak a secret or lose data), "leftover" (debug code, TODO, stray file) or "note" (worth knowing, not wrong). Give each finding a short title (under 60 characters), the file path and the line number. Only list real problems you checked; do not pad the list. If you found nothing, call this with an empty list: the user then sees an honest "No problems found".',
    parameters: {
      type: 'object',
      properties: {
        findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['risk', 'leftover', 'note'] }, title: { type: 'string' }, path: { type: 'string' }, line: { type: 'integer' }, fix: { type: 'string', description: 'One sentence: what to change' } }, required: ['severity', 'title'] } },
        summary: { type: 'string', description: 'One short sentence about what was reviewed' },
      },
      required: ['findings'],
    },
  },
];
export const RELEASE_READS = new Set(['pre_push_check', 'release_info', 'review_changes']);
export const RELEASE_NAMES = new Set(RELEASE_TOOLS.map((t) => t.name));

// ---------------------------------------------------------------- helpers
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const VERSION_FILES = ['www/js/config.js', 'src/config.js', 'src/version.js', 'src/config/version.js', 'config.js', 'version.js', 'lib/version.js'];
const CONST_RE = /(\b(?:APP_VERSION|VERSION)\s*=\s*['"])(\d+\.\d+\.\d+[^'"]*)(['"])/g;

async function rd(folder, rel, overlay) {
  if (overlay && Object.prototype.hasOwnProperty.call(overlay, rel)) return overlay[rel];
  try {
    const r = await fs.readText(folder.uri, rel, 6000000);
    return r && !r.binary && typeof r.text === 'string' ? r.text : null;
  } catch (e) { return null; }
}
function parseJson(text) { try { return { ok: true, v: JSON.parse(text) }; } catch (e) { return { ok: false, err: String(e.message || e) }; } }
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function nextVersion(from, args) {
  args = args || {};
  if (args.version) {
    const v = String(args.version).trim().replace(/^v/i, '');
    if (!SEMVER.test(v)) throw new Error('"' + args.version + '" is not a valid version. Use three numbers like 1.2.3.');
    return v;
  }
  const m = SEMVER.exec(String(from || ''));
  if (!m) throw new Error('The current version "' + from + '" is not three numbers like 1.2.3, so give the new version explicitly.');
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const part = args.part || 'patch';
  if (part === 'major') { maj++; min = 0; pat = 0; } else if (part === 'minor') { min++; pat = 0; } else pat++;
  return maj + '.' + min + '.' + pat;
}

/** Dependency range with a number that has a leading zero (like 1.45.02) is not valid for npm. */
function badRange(range) {
  const s = String(range);
  if (!/^[\s^~<>=v]*\d/.test(s)) return false; // tags, urls, workspace: and similar are left alone
  if (/^(git|github|file|link|npm|workspace|https?):/.test(s)) return false;
  const nums = s.match(/\d+/g) || [];
  return nums.some((n) => n.length > 1 && n[0] === '0');
}

// ---------------------------------------------------------------- the check
/** Static checks of the project. `overlay` lets the release check the files as they will be after the version bump. */
export async function checkProject(folder, overlay) {
  const problems = []; const notes = [];
  const add = (kind, text, path) => problems.push({ kind, text, path });
  let version = null;
  const pkgText = await rd(folder, 'package.json', overlay);
  if (pkgText === null) notes.push('No package.json: the JavaScript checks were skipped.');
  else {
    const pj = parseJson(pkgText);
    if (!pj.ok) add('json', 'package.json is not valid JSON: ' + pj.err, 'package.json');
    else {
      const pkg = pj.v; version = pkg.version || null;
      if (version && !SEMVER.test(version)) add('version', 'package.json version "' + version + '" is not three numbers like 1.2.3.', 'package.json');
      const groups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
      for (const g of groups) for (const [name, range] of Object.entries(pkg[g] || {})) if (badRange(range)) add('range', 'Dependency ' + name + ' has an invalid version range "' + range + '" (a number with a leading zero). npm ci will fail.', 'package.json');
      const lockText = await rd(folder, 'package-lock.json', overlay);
      if (lockText === null) { if (['dependencies', 'devDependencies'].some((g) => Object.keys(pkg[g] || {}).length)) notes.push('No package-lock.json: "npm ci" needs one. Run "npm install" to create it.'); }
      else {
        const lj = parseJson(lockText);
        if (!lj.ok) add('json', 'package-lock.json is not valid JSON: ' + lj.err, 'package-lock.json');
        else {
          const lock = lj.v; const root = (lock.packages && lock.packages['']) || null;
          if (version && lock.version && lock.version !== version) add('version', 'package-lock.json says version ' + lock.version + ' but package.json says ' + version + '.', 'package-lock.json');
          if (version && root && root.version && root.version !== version) add('version', 'package-lock.json (root package) says version ' + root.version + ' but package.json says ' + version + '.', 'package-lock.json');
          if (root) {
            let shown = 0;
            for (const g of ['dependencies', 'devDependencies', 'optionalDependencies']) {
              const want = pkg[g] || {}; const have = root[g] || {};
              const names = new Set([...Object.keys(want), ...Object.keys(have)]);
              for (const n of names) {
                if (want[n] !== have[n] && shown < 5) { shown++; add('lock', 'package.json and package-lock.json disagree on ' + n + ' (' + (want[n] || 'missing') + ' vs ' + (have[n] || 'missing') + '). "npm ci" will fail; run "npm install" to sync them.', 'package-lock.json'); }
              }
            }
          } else notes.push('package-lock.json has no root entry (old lockfile format), so dependencies were not compared.');
        }
      }
      if (version) {
        for (const rel of VERSION_FILES) {
          const t = await rd(folder, rel, overlay); if (t === null) continue;
          CONST_RE.lastIndex = 0; const found = [...t.matchAll(CONST_RE)].map((m) => m[2]);
          if (found.length && !found.includes(version)) add('version', rel + ' says version ' + found[0] + ' but package.json says ' + version + '.', rel);
        }
      }
    }
  }
  // changed files: conflict marks and keys
  let changes = [];
  try { changes = await G.status(folder); } catch (e) { notes.push('Could not read the changed files.'); }
  const live = changes.filter((c) => c.kind !== 'deleted').slice(0, 200);
  for (const c of live) {
    if (isSecretPath(c.path) && await protectionOn()) continue;
    const t = await rd(folder, c.path);
    if (t === null) continue;
    const m = /^(<{7} |>{7} )/m.exec(t);
    if (m) { const line = t.slice(0, m.index).split('\n').length; add('conflict', 'Unresolved merge-conflict mark in ' + c.path + ' at line ' + line + '.', c.path); }
  }
  try { for (const h of (await G.scanSecrets(folder, changes)).slice(0, 5)) add('secret', 'Possible ' + h.kind + ' in ' + h.path + ' at line ' + h.line + '. Pushing would publish it.', h.path); } catch (e) { /* the scan is best effort */ }
  return { problems, notes, version, changed: changes.length };
}
export function formatCheck(r) {
  if (!r.problems.length) return 'Pre-push check passed' + (r.version ? ' (version ' + r.version + ')' : '') + '. ' + r.notes.join(' ') + (r.changed ? '' : ' Nothing is changed in the working tree.') + '\nNot checked here: lint, tests and "npm ci --dry-run". Run them with project_checks and run_command if the terminal is on.';
  return 'Pre-push check found ' + r.problems.length + ' problem(s):\n' + r.problems.map((p, i) => (i + 1) + '. ' + p.text).join('\n') + (r.notes.length ? '\n' + r.notes.join(' ') : '');
}

// ---------------------------------------------------------------- version bump
/** The exact file edits for a version bump. Throws with a clear message when a file cannot be edited safely. */
export async function planBump(folder, args, overlay) {
  const pkgText = await rd(folder, 'package.json', overlay);
  if (pkgText === null) throw new Error('There is no package.json in this project, so there is no version to raise.');
  const pj = parseJson(pkgText);
  if (!pj.ok) throw new Error('package.json is not valid JSON (' + pj.err + '). Fix it first.');
  const from = pj.v.version;
  if (!from) throw new Error('package.json has no "version" field.');
  const to = nextVersion(from, args);
  if (to === from) throw new Error('The version is already ' + from + '.');
  const edits = [];
  // package.json: one exact line edit, then verify the rest of the file is unchanged
  const vre = /^(\s{0,4}"version"\s*:\s*")([^"]*)(")/m;
  if (!vre.test(pkgText)) throw new Error('Could not find the version line in package.json.');
  const pkgAfter = pkgText.replace(vre, (m, a, b, c) => a + to + c);
  const pa = parseJson(pkgAfter);
  if (!pa.ok || pa.v.version !== to || !sameJson({ ...pj.v, version: to }, pa.v)) throw new Error('The version edit in package.json did not check out, so nothing was changed.');
  edits.push({ path: 'package.json', before: pkgText, after: pkgAfter });
  // package-lock.json: rewritten only when the file round-trips unchanged, so nothing else moves
  const lockText = await rd(folder, 'package-lock.json', overlay);
  if (lockText !== null) {
    const lj = parseJson(lockText);
    if (!lj.ok) throw new Error('package-lock.json is not valid JSON (' + lj.err + '). Run "npm install" to rebuild it.');
    const lock = lj.v; const nl = lockText.endsWith('\n') ? '\n' : '';
    const indent = /^\{\r?\n( +)"/.exec(lockText) ? /^\{\r?\n( +)"/.exec(lockText)[1].length : 2;
    if (JSON.stringify(lock, null, indent) + nl !== lockText.replace(/\r\n/g, '\n')) throw new Error('package-lock.json is formatted in an unusual way, so it was not touched. Run "npm version ' + to + ' --no-git-tag-version" in the terminal instead.');
    if (lock.version !== undefined) lock.version = to;
    if (lock.packages && lock.packages['']) lock.packages[''].version = to;
    const lockAfter = JSON.stringify(lock, null, indent) + nl;
    edits.push({ path: 'package-lock.json', before: lockText, after: lockText.includes('\r\n') ? lockAfter.replace(/\n/g, '\r\n') : lockAfter });
  }
  // the app's own version constant
  for (const rel of VERSION_FILES) {
    const t = await rd(folder, rel, overlay); if (t === null) continue;
    CONST_RE.lastIndex = 0; const hits = [...t.matchAll(CONST_RE)];
    if (!hits.length) continue;
    if (hits.length > 1) throw new Error(rel + ' sets the version more than once, so it was not touched. Edit it by hand.');
    CONST_RE.lastIndex = 0;
    edits.push({ path: rel, before: t, after: t.replace(CONST_RE, (m, a, b, c) => a + to + c) });
  }
  for (const e of edits) e.diff = lineDiff(e.before, e.after);
  return { from, to, edits };
}
export function bumpPreview(p) {
  const lines = [{ t: 'ctx', text: 'Version ' + p.from + ' → ' + p.to }];
  for (const e of p.edits) {
    lines.push({ t: 'ctx', text: e.path });
    for (const l of e.diff.lines) if (l.t !== 'ctx') lines.push({ t: l.t, text: (l.text || '').trim().slice(0, 120) });
  }
  return lines;
}

// ---------------------------------------------------------------- changelog
function entryBody(notes) {
  return String(notes || '').replace(/\r/g, '').split('\n').filter((l, i, a) => !/^##\s*\[/.test(l) && !(i === 0 && /^\s*$/.test(l))).join('\n').trim();
}
export function planChangelog(text, version, notes) {
  const unrel = /^## \[Unreleased\][^\n]*\n/im.exec(text);
  let body = entryBody(notes);
  let rest;
  let head;
  if (unrel) {
    const after = text.slice(unrel.index + unrel[0].length);
    const nx = /^## \[/m.exec(after);
    const oldUnrel = (nx ? after.slice(0, nx.index) : after).trim();
    if (!body) body = oldUnrel;
    head = text.slice(0, unrel.index + unrel[0].length);
    rest = nx ? after.slice(nx.index) : '';
  } else {
    const nx = /^## \[/m.exec(text);
    head = nx ? text.slice(0, nx.index) : text.replace(/\s*$/, '\n\n');
    rest = nx ? text.slice(nx.index) : '';
  }
  if (!body) throw new Error('The release notes are empty. Write what changed in this version.');
  if (new RegExp('^## \\[' + version.replace(/\./g, '\\.') + '\\]', 'm').test(text)) throw new Error('CHANGELOG.md already has an entry for ' + version + '.');
  const out = head.replace(/\s*$/, '\n') + (unrel ? '\n' : '') + '## [' + version + ']\n\n' + body + '\n\n' + rest;
  return { after: out.replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n'), body };
}

// ---------------------------------------------------------------- release info
async function workflowMode(folder) {
  let files = [];
  try { files = (await fs.list(folder.uri, '.github/workflows')).filter((e) => /\.ya?ml$/i.test(e.name)); } catch (e) { return { mode: 'none', branches: [], note: 'No GitHub workflow was found in .github/workflows.' }; }
  for (const f of files) {
    const t = await rd(folder, '.github/workflows/' + f.name); if (!t) continue;
    const auto = /branches:\s*\[([^\]]*)\][\s\S]{0,120}paths:\s*\[[^\]]*package\.json/.exec(t);
    if (auto) return { mode: 'auto', branches: auto[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean), file: f.name, note: 'Pushing a raised version in package.json to the branch publishes the release (the workflow creates the tag).' };
  }
  for (const f of files) {
    const t = await rd(folder, '.github/workflows/' + f.name); if (!t) continue;
    if (/tags:\s*\[[^\]]*v/.test(t) || /tags:\s*\n\s*-\s*['"]?v/.test(t)) return { mode: 'tag', branches: [], file: f.name, note: 'The workflow publishes when a tag like vX.Y.Z is pushed. This app cannot create tags yet.' };
  }
  return { mode: 'none', branches: [], note: 'No workflow that publishes a release was found.' };
}
async function commitsSinceRelease(folder) {
  const l = await G.log(folder, 60);
  const out = [];
  for (const x of l) { const s = String(x.commit.message || '').trim().split('\n')[0]; if (/^Release v?\d+\.\d+\.\d+/i.test(s)) break; out.push(x.oid.slice(0, 7) + ' ' + s); }
  return { list: out.slice(0, 40), hitRelease: out.length < l.length };
}
export async function releaseInfo(folder) {
  const pj = parseJson((await rd(folder, 'package.json')) || '');
  if (!pj.ok) throw new Error('There is no valid package.json, so the version cannot be read.');
  const from = pj.v.version; const branch = await G.currentBranch(folder); const wf = await workflowMode(folder);
  const cl = await rd(folder, 'CHANGELOG.md');
  let unrel = '';
  if (cl) { const m = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|$(?![\s\S]))/im.exec(cl); unrel = m ? m[1].trim() : ''; }
  const cs = await commitsSinceRelease(folder);
  const ch = await G.status(folder);
  return 'Project version: ' + from + ' (next patch ' + nextVersion(from, { part: 'patch' }) + ', minor ' + nextVersion(from, { part: 'minor' }) + ')\nBranch: ' + branch + '\nPublishing: ' + wf.note + (wf.branches.length ? ' Branches: ' + wf.branches.join(', ') + '.' : '') +
    '\nCHANGELOG.md: ' + (cl ? 'exists' + (unrel ? '; Unreleased text:\n' + unrel : '; the Unreleased section is empty') : 'missing (the release will not write a changelog entry)') +
    '\nUncommitted files that the release commit will include: ' + (ch.length ? ch.length + ' (' + ch.slice(0, 8).map((c) => c.path).join(', ') + (ch.length > 8 ? ', ...' : '') + ')' : 'none') +
    '\nCommits since ' + (cs.hitRelease ? 'the last release' : 'the start of the history shown') + ' (' + cs.list.length + '):\n' + (cs.list.join('\n') || '(none)') +
    '\n\nNext: write release notes for the user (### Added / ### Changed / ### Fixed, short bullets) and call release.';
}

/** Everything the release will do, computed without touching the disk. Throws when the release must not go ahead. */
export async function planRelease(folder, args) {
  const wf = await workflowMode(folder);
  if (wf.mode === 'tag') throw new Error('This project publishes releases from a pushed tag (vX.Y.Z), and this app cannot create tags yet. Raise the version with bump_version, commit and push, then run "git tag vX.Y.Z && git push origin vX.Y.Z" in the terminal.');
  if (wf.mode !== 'auto') throw new Error(wf.note + ' Use bump_version, git_commit and git_push instead.');
  const branch = await G.currentBranch(folder);
  if (wf.branches.length && !wf.branches.includes(branch)) throw new Error('The workflow publishes only from ' + wf.branches.join(' or ') + ', but this chat is on branch "' + branch + '". Switch branches (git_branch) or merge first.');
  const bump = await planBump(folder, args);
  const overlay = {}; for (const e of bump.edits) overlay[e.path] = e.after;
  const edits = bump.edits.slice();
  const clText = await rd(folder, 'CHANGELOG.md');
  let changelog = null;
  if (clText !== null) {
    changelog = planChangelog(clText, bump.to, args.notes);
    overlay['CHANGELOG.md'] = changelog.after;
    edits.push({ path: 'CHANGELOG.md', before: clText, after: changelog.after, diff: lineDiff(clText, changelog.after) });
  } else if (!String(args.notes || '').trim()) throw new Error('The release notes are empty. Write what changed in this version.');
  const check = await checkProject(folder, overlay);
  if (check.problems.length) throw new Error('The release was stopped by the pre-push check:\n' + check.problems.map((p, i) => (i + 1) + '. ' + p.text).join('\n') + '\nFix these and try again.');
  const others = (await G.status(folder)).map((c) => c.path).filter((p) => !edits.some((e) => e.path === p));
  return { from: bump.from, to: bump.to, branch, edits, changelog, others, notes: check.notes };
}
export function releasePreview(p) {
  const lines = [{ t: 'ctx', text: 'Release v' + p.to + ' (now ' + p.from + ') on ' + p.branch }];
  lines.push({ t: 'ctx', text: 'Files edited: ' + p.edits.map((e) => e.path).join(', ') });
  if (p.changelog) for (const l of p.changelog.body.split('\n').slice(0, 14)) lines.push({ t: 'add', text: l });
  if (p.others.length) lines.push({ t: 'ctx', text: 'Also committed (' + p.others.length + '): ' + p.others.slice(0, 6).join(', ') + (p.others.length > 6 ? ', ...' : '') });
  lines.push({ t: 'ctx', text: 'Commit "Release v' + p.to + '", then push ' + p.branch + '. GitHub then builds and publishes v' + p.to + '.' });
  lines.push({ t: 'ctx', text: 'Pre-push check passed.' });
  return lines;
}

// ---------------------------------------------------------------- review of changes
const SECRET_NOTE = 'Possible key or password';
const LEFTOVERS = [
  [/\bconsole\.(log|debug)\s*\(/, 'leftover', 'console.log left in', /\.(m?[jt]sx?|vue|svelte)$/i],
  [/^\s*debugger\s*;?\s*$/, 'leftover', 'debugger statement left in', /\.(m?[jt]sx?|vue|svelte)$/i],
  [/\b(TODO|FIXME|XXX|HACK)\b/, 'leftover', 'TODO mark added', null],
  [/^(<{7} |>{7} |={7}$)/, 'risk', 'Merge-conflict mark', null],
  [/\b(describe|it|test)\.only\s*\(|\b(fit|fdescribe)\s*\(/, 'leftover', 'Test limited with .only', /\.(m?[jt]sx?)$/i],
];
function addedWithNumbers(before, after) {
  const d = lineDiff(before, after); const adds = new Map();
  for (const l of d.lines) if (l.t === 'add') adds.set(l.text, (adds.get(l.text) || 0) + 1);
  const out = []; const lines = after.split('\n');
  for (let i = 0; i < lines.length && adds.size; i++) { const c = adds.get(lines[i]); if (c) { out.push({ n: i + 1, text: lines[i] }); if (c === 1) adds.delete(lines[i]); else adds.set(lines[i], c - 1); } }
  return { added: out, removed: d.removed, cut: d.more };
}
export async function reviewChanges(folder) {
  const ch = await G.status(folder);
  if (!ch.length) return 'There are no uncommitted changes to review. Call report_findings with an empty list and say so.';
  let out = 'Uncommitted changes: ' + ch.length + ' file(s).\n'; const spotted = []; let budget = 1600;
  for (const c of ch.slice(0, 40)) {
    out += '\n=== ' + c.kind.toUpperCase() + ' ' + c.path;
    if (isSecretPath(c.path) && await protectionOn()) { out += ' (protected secret file: contents hidden; it must not be committed)\n'; spotted.push({ sev: 'risk', title: 'Secret file in the changes', path: c.path, line: 0 }); continue; }
    if (c.kind === 'deleted') { out += ' (file removed)\n'; continue; }
    const d = await G.diffTexts(folder, c.path);
    if (d.hidden) { out += ' (hidden)\n'; continue; }
    if (d.binary) { out += ' (binary file, ' + d.size + ' bytes)\n'; continue; }
    const a = addedWithNumbers(d.before, d.after);
    out += ' (+' + a.added.length + ' -' + a.removed + (a.cut ? ', diff cut' : '') + ')\n';
    for (const l of a.added) {
      for (const [re, sev, title, ext] of LEFTOVERS) if ((!ext || ext.test(c.path)) && re.test(l.text)) { spotted.push({ sev, title, path: c.path, line: l.n }); break; }
      if (budget > 0) { out += 'L' + l.n + ': ' + l.text.slice(0, 200) + '\n'; budget--; }
    }
    if (budget <= 0 && a.added.length) out += '(further added lines not shown)\n';
  }
  if (ch.length > 40) out += '\n(' + (ch.length - 40) + ' more changed files not shown)\n';
  try { for (const h of await G.scanSecrets(folder, ch)) spotted.push({ sev: 'risk', title: SECRET_NOTE + ' (' + h.kind + ')', path: h.path, line: h.line }); } catch (e) { /* best effort */ }
  out += '\nSpotted by the app (check each against the code; drop false alarms):\n' + (spotted.length ? spotted.slice(0, 40).map((s) => '- [' + s.sev + '] ' + s.title + ' · ' + s.path + (s.line ? ':' + s.line : '')).join('\n') : '(nothing)');
  out += '\n\nNow look for real mistakes in the added lines (broken logic, a renamed or removed function whose callers still use the old name: confirm with search), then call report_findings once.';
  return out;
}

/** Cleans the findings the model sends so the card can show them safely. */
export function cleanFindings(args) {
  const list = Array.isArray(args && args.findings) ? args.findings : [];
  const items = list.slice(0, 20).map((f) => ({
    severity: ['risk', 'leftover', 'note'].includes(f && f.severity) ? f.severity : 'note',
    title: String((f && f.title) || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    path: String((f && f.path) || '').slice(0, 120),
    line: Number.isInteger(f && f.line) && f.line > 0 ? f.line : 0,
    fix: String((f && f.fix) || '').slice(0, 200),
  })).filter((f) => f.title);
  const order = { risk: 0, leftover: 1, note: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  return { items, summary: String((args && args.summary) || '').slice(0, 160) };
}
