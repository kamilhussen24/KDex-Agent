// Git tools the model can call (only offered when the folder has a Git repo).
import * as G from './git.js';

export const GIT_TOOLS = [
  { name: 'git_status', description: 'List files changed since the last commit (new, modified, deleted) and the current branch.', parameters: { type: 'object', properties: {} } },
  { name: 'git_diff', description: 'Show the line changes of one file compared with the last commit.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'git_log', description: 'Show recent commits (newest first).', parameters: { type: 'object', properties: { count: { type: 'integer', description: 'Default 10' } } } },
  { name: 'git_commit', description: 'Commit all current changes with a clear message. The user approves first. Only commit when asked or when finishing a task the user wanted committed.', parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
  { name: 'git_push', description: 'Push the current branch to the remote. The user approves first. Only when the user asked to push.', parameters: { type: 'object', properties: {} } },
  { name: 'git_pull', description: 'Pull the latest commits of the current branch from the remote. The user approves first.', parameters: { type: 'object', properties: {} } },
];
GIT_TOOLS.push(
  { name: 'git_branch', description: 'List branches, or create a new branch and switch to it, or switch to an existing branch. action: list | create | switch.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'create', 'switch'] }, name: { type: 'string', description: 'Branch name for create or switch' } }, required: ['action'] } },
  { name: 'git_fetch', description: 'Download the latest commits from the remote without changing files, and report how far ahead or behind the branch is.', parameters: { type: 'object', properties: {} } },
  { name: 'git_remote', description: 'Show the remote URL, or set it (action: set, with url). Setting needs approval.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['show', 'set'] }, url: { type: 'string' } }, required: ['action'] } },
);
GIT_TOOLS.push(
  { name: 'git_merge', description: 'Merge another local branch into the current branch. The user approves first. If there is a conflict nothing is changed and you are told so.', parameters: { type: 'object', properties: { branch: { type: 'string' } }, required: ['branch'] } },
  { name: 'git_discard', description: 'Throw away changes that are not committed yet, in one file (give path) or in every changed file (leave path out). This cannot be undone, so the user always has to approve it. Use it only when the user asked to drop or reset changes.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'One file; leave out to discard everything' } } } },
  { name: 'git_undo_commit', description: 'Undo the last commit but keep all its changes in the files (like git reset --soft). The user approves first. Only for a commit that was not pushed.', parameters: { type: 'object', properties: {} } },
);
export const GIT_READS = new Set(['git_status', 'git_diff', 'git_log']);
export const GIT_ACTIONS = new Set(['git_commit', 'git_push', 'git_pull', 'git_fetch', 'git_remote', 'git_branch', 'git_merge', 'git_discard', 'git_undo_commit']);
/** Actions that only look, so they need no approval. */
export function gitActionIsRead(name, args) {
  return name === 'git_fetch' || (name === 'git_remote' && args.action !== 'set') || (name === 'git_branch' && (args.action || 'list') === 'list');
}

export async function runGitRead(name, args, folder) {
  if (name === 'git_status') {
    const ch = await G.status(folder);
    const b = await G.currentBranch(folder);
    return 'Branch: ' + b + '\n' + (ch.length ? ch.map((c) => c.kind + ': ' + c.path).join('\n') : 'Working tree clean.');
  }
  if (name === 'git_diff') {
    const d = await G.diffFile(folder, String(args.path || ''));
    const lines = d.lines.map((l) => (l.t === 'add' ? '+ ' : l.t === 'del' ? '- ' : '  ') + (l.text || '')).join('\n');
    return lines.slice(0, 20000) + (d.more ? '\n[diff cut]' : '') + '\n(+' + d.added + ' -' + d.removed + ')';
  }
  const l = await G.log(folder, Math.min(50, Math.max(1, parseInt(args.count, 10) || 10)));
  return l.map((x) => x.oid.slice(0, 7) + ' ' + x.commit.message.trim().split('\n')[0]).join('\n') || 'No commits yet.';
}

/** Preview shown on the approval card: { op, lines:[{t,text}] } */
export async function previewGitAction(name, args, folder) {
  const b = await G.currentBranch(folder);
  if (name === 'git_commit') {
    const ch = await G.status(folder);
    if (!ch.length) throw new Error('Nothing to commit.');
    return [{ t: 'ctx', text: 'Message: ' + String(args.message || '').trim() }, { t: 'ctx', text: 'Branch: ' + b }]
      .concat(ch.map((c) => ({ t: c.kind === 'new' ? 'add' : c.kind === 'deleted' ? 'del' : 'ctx', text: c.kind + ': ' + c.path })));
  }
  if (name === 'git_merge') return [{ t: 'ctx', text: 'Merge branch ' + String(args.branch || '') + ' into ' + b }];
  if (name === 'git_undo_commit') { const l = await G.log(folder, 1); return [{ t: 'ctx', text: 'Undo the last commit on ' + b + (l[0] ? ': ' + l[0].commit.message.trim().split('\n')[0] : '') }, { t: 'ctx', text: 'Its changes stay in your files.' }]; }
  if (name === 'git_discard') {
    const ch = await G.status(folder); const p = String(args.path || '').trim();
    const list = p ? ch.filter((c) => c.path === p) : ch;
    if (!list.length) throw new Error(p ? 'No uncommitted changes in ' + p + '.' : 'Nothing to discard.');
    return [{ t: 'del', text: 'These changes are lost for good:' }].concat(list.slice(0, 40).map((c) => ({ t: 'del', text: c.kind + ': ' + c.path })));
  }
  if (name === 'git_remote') return [{ t: 'ctx', text: 'Set remote origin to ' + String(args.url || '') }];
  if (name === 'git_branch') return [{ t: 'ctx', text: (args.action === 'create' ? 'Create and switch to branch ' : 'Switch to branch ') + String(args.name || '') + ' (now on ' + b + ')' }];
  return [{ t: 'ctx', text: (name === 'git_push' ? 'Push branch ' : 'Pull into branch ') + b + ' (origin)' }];
}
export async function runGitAction(name, args, folder, signal) {
  if (name === 'git_commit') { const r = await G.commit(folder, String(args.message || '')); return 'Committed ' + r.count + ' file(s) as ' + r.oid.slice(0, 7) + '.' + (r.skipped && r.skipped.length ? ' Left out secret files: ' + r.skipped.join(', ') + ' (never committed automatically; suggest adding them to .gitignore).' : ''); }
  if (name === 'git_push') { const info = await G.remoteInfo(folder); const b = await G.currentBranch(folder); await G.push(folder, { signal }); return 'Pushed branch ' + b + ' to ' + (info ? info.host + '/' + info.path : 'origin') + '.'; }
  if (name === 'git_pull') { await G.pull(folder, { signal }); return 'Pulled the latest changes.'; }
  if (name === 'git_fetch') {
    await G.fetchRemote(folder, { signal }); const ab = await G.aheadBehind(folder);
    return 'Fetched. ' + (ab ? (ab.noRemoteBranch ? 'The remote has no such branch yet.' : 'Ahead ' + ab.ahead + ', behind ' + ab.behind + ' compared with origin.') : 'Could not compare with origin.');
  }
  if (name === 'git_remote') {
    if (args.action === 'set') { const u = String(args.url || '').trim(); if (!/^https?:\/\//i.test(u)) throw new Error('Use an https:// repository URL.'); await G.setRemote(folder, u); return 'Remote origin set to ' + u + '.'; }
    const info = await G.remoteInfo(folder); return info ? 'origin: ' + info.url : 'No remote is set.';
  }
  if (name === 'git_merge') { const n = String(args.branch || '').trim(); if (!n) throw new Error('A branch name is needed.'); await G.mergeBranch(folder, n); return 'Merged ' + n + ' into ' + (await G.currentBranch(folder)) + '.'; }
  if (name === 'git_undo_commit') { const oid = await G.undoLastCommit(folder); return 'Undid commit ' + oid.slice(0, 7) + '. Its changes are back in your files.'; }
  if (name === 'git_discard') {
    const p = String(args.path || '').trim();
    if (p) { await G.discard(folder, p); return 'Discarded the changes in ' + p + '.'; }
    const n = await G.discardAll(folder); return 'Discarded the changes in ' + n + ' file(s).';
  }
  if (name === 'git_branch') {
    const act = args.action || 'list'; const cur = await G.currentBranch(folder);
    if (act === 'list') return 'Current: ' + cur + '\nBranches: ' + (await G.branches(folder)).join(', ');
    const n = String(args.name || '').trim().replace(/\s+/g, '-'); if (!n) throw new Error('A branch name is needed.');
    if (act === 'create') { await G.createBranch(folder, n); return 'Created and switched to ' + n + '.'; }
    await G.checkout(folder, n); return 'Switched to ' + n + '.';
  }
  throw new Error('Unknown git action.');
}
