// Friendly names for the tool cards. The code names (read_file, git_push ...) are never shown to the person.
export const TOOL_LABEL = {
  read_file: 'Read file', write_file: 'Write file', edit_file: 'Edit file', delete_file: 'Delete file', make_file: 'Create file', move_file: 'Move file', copy_file: 'Copy file', make_folder: 'New folder', ask_user: 'Question',
  list_dir: 'List folder', find_files: 'Find files', search: 'Search', find_symbol: 'Find symbol', view_image: 'View image', zip: 'Zip', unzip: 'Unzip',
  git_status: 'Git status', git_diff: 'Compare changes', git_log: 'Git history', git_commit: 'Commit', git_push: 'Push to GitHub',
  git_pull: 'Pull', git_fetch: 'Fetch', git_branch: 'Branch', git_remote: 'Remote', git_merge: 'Merge', git_discard: 'Discard changes', git_undo_commit: 'Undo commit',
  github_runs: 'Build runs', github_run_log: 'Build log', github_issues: 'Issues', release_info: 'Release info', release: 'Release',
  bump_version: 'Bump version', pre_push_check: 'Check before push',
  run_command: 'Run command', start_job: 'Start job', stop_job: 'Stop job', list_jobs: 'List jobs', check_job: 'Check job',
  check_tools: 'Check tools', request_env_var: 'Ask for secret',
  web_fetch: 'Open page', generate_image: 'Generate image',
  project_checks: 'Project checks', project_map: 'Project map', review_changes: 'Review changes', report_findings: 'Report findings', update_plan: 'Update plan',
  calculate: 'Calculate', convert_units: 'Convert units', clipboard_read: 'Read clipboard', clipboard_write: 'Copy to clipboard',
  set_alarm: 'Set alarm', set_timer: 'Set timer', remember: 'Remember',
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** A name that is not in the list yet still looks fine: "git_stash" becomes "Git stash". */
export function toolLabel(name) {
  const n = String(name || '');
  return TOOL_LABEL[n] || cap(n.replace(/_+/g, ' ').trim());
}
/** The small line under a card: a tool name, a file action (edit, create, delete) or a short phrase. */
export function opLabel(op) {
  const o = String(op || '');
  if (TOOL_LABEL[o]) return TOOL_LABEL[o];
  if (o === 'edit' || o === 'create' || o === 'delete' || o === 'overwrite') return { edit: 'Edit file', create: 'Create file', delete: 'Delete file', overwrite: 'Replace file' }[o];
  return cap(o.replace(/_+/g, ' '));
}
