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
export const GIT_READS = new Set(['git_status', 'git_diff', 'git_log']);
export const GIT_ACTIONS = new Set(['git_commit', 'git_push', 'git_pull']);

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
  return [{ t: 'ctx', text: (name === 'git_push' ? 'Push branch ' : 'Pull into branch ') + b + ' (origin)' }];
}
export async function runGitAction(name, args, folder) {
  if (name === 'git_commit') { const r = await G.commit(folder, String(args.message || '')); return 'Committed ' + r.count + ' file(s) as ' + r.oid.slice(0, 7) + '.'; }
  if (name === 'git_push') { await G.push(folder); return 'Pushed.'; }
  await G.pull(folder); return 'Pulled the latest changes.';
}
