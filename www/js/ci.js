// Build status after a push: watches the GitHub Actions run for the pushed commit and reports pass or fail.
// It only reads (the saved token stays inside the app). "Fix it" is handled by the chat screen, at most 3 tries in a row.
import { repoOf, api } from './github.js';
import { getToken } from './git.js';
import { kvGet, kvSet } from './db.js';
import { fs } from './native.js';

export const MAX_FIX_TRIES = 3;
const POLL_MS = 15000;
const NO_RUN_MS = 4 * 60000;
const GIVE_UP_MS = 45 * 60000;

const state = { watch: null, listeners: new Set(), timer: null };
export const getBuild = () => state.watch;
export function onBuild(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
const emit = () => state.listeners.forEach((fn) => { try { fn(state.watch); } catch (e) { /* a screen may be gone */ } });

const triesKey = (folderId) => 'ci-fix:' + folderId;
export async function fixTries(folderId) { return (await kvGet(triesKey(folderId), { n: 0 })).n || 0; }
export async function addFixTry(folderId) { const n = (await fixTries(folderId)) + 1; await kvSet(triesKey(folderId), { n }); return n; }
export async function resetFixTries(folderId) { await kvSet(triesKey(folderId), { n: 0 }); }

export function stopWatch() { if (state.timer) clearTimeout(state.timer); state.timer = null; state.watch = null; emit(); }

/** Starts watching the build of one commit. A new push replaces the previous watch. */
async function hasWorkflows(folder) {
  try { return (await fs.list(folder.uri, '.github/workflows')).some((e) => /\.ya?ml$/i.test(e.name)); } catch (e) { return false; }
}

export async function watchBuild(folder, sha, label) {
  if (state.timer) clearTimeout(state.timer);
  // No GitHub Actions workflow in the project: no build will ever start, so show no waiting bar.
  if (!(await hasWorkflows(folder))) { stopWatch(); return; }
  const w = { folderId: folder.id, folderName: folder.name, sha, label: label || '', phase: 'waiting', run: null, started: Date.now(), msg: '' };
  state.watch = w; emit();
  let rp;
  try { rp = await repoOf(folder); } catch (e) { w.phase = 'off'; w.msg = ''; emit(); return; } // not a GitHub project: nothing to watch, no bar
  const tick = async () => {
    if (state.watch !== w) return;
    try {
      const token = await getToken('github.com');
      const d = await api(rp.base + '/actions/runs?head_sha=' + encodeURIComponent(sha) + '&per_page=10', token);
      const runs = (d.workflow_runs || []).sort((a, b) => b.id - a.id);
      const r = runs[0];
      if (!r) {
        if (Date.now() - w.started > NO_RUN_MS) { w.phase = 'none'; emit(); return; }
        w.phase = 'waiting';
      } else {
        w.run = { id: r.id, name: r.name || r.display_title || 'Build', status: r.status, conclusion: r.conclusion };
        if (r.status === 'completed') {
          w.phase = r.conclusion === 'success' ? 'passed' : r.conclusion === 'cancelled' ? 'cancelled' : r.conclusion === 'skipped' ? 'skipped' : 'failed';
          if (w.phase === 'passed') await resetFixTries(folder.id);
          emit(); return;
        }
        w.phase = 'running';
      }
      emit();
      if (Date.now() - w.started > GIVE_UP_MS) { w.phase = 'stale'; emit(); return; }
    } catch (e) {
      w.phase = 'off'; w.msg = String(e.message || e); emit(); return;
    }
    state.timer = setTimeout(tick, POLL_MS);
  };
  state.timer = setTimeout(tick, 6000);
}

export function describe(w, tries) {
  const nm = w.run ? '#' + w.run.id : '';
  switch (w.phase) {
    case 'waiting': return 'Waiting for the build to start...';
    case 'running': return 'Build ' + nm + ' is running...';
    case 'passed': return 'Build ' + nm + ' passed' + (w.label ? ' · ' + w.label + ' published' : '');
    case 'failed': return 'Build ' + nm + ' failed' + (tries >= MAX_FIX_TRIES ? '. Stopped after ' + MAX_FIX_TRIES + ' fix tries' : '');
    case 'cancelled': return 'Build ' + nm + ' was cancelled';
    case 'skipped': return 'Build ' + nm + ' was skipped';
    case 'none': return 'No build started for this push';
    case 'stale': return 'Build ' + nm + ' is taking very long. Check GitHub';
    default: return w.msg ? w.msg.slice(0, 140) : 'Build status is not available';
  }
}
