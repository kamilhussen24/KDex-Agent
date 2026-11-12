// Checks GitHub Releases for a newer version. Nothing is sent except a normal public request to api.github.com.
export const REPO = 'kamilhussen24/KDex-Agent';
export const REPO_URL = 'https://github.com/' + REPO;

/** "v1.38.0" -> [1,38,0]; anything else -> null. */
export function parseVer(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** True when `a` is newer than `b`. */
export function isNewer(a, b) {
  const x = parseVer(a); const y = parseVer(b); if (!x || !y) return false;
  for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; }
  return false;
}
/** Returns { ok, latest, newer, url, apk, notes } or { ok:false, error }. */
export async function checkUpdate(current, fetchFn) {
  const f = fetchFn || fetch;
  try {
    const r = await f('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (r.status === 404) return { ok: true, latest: null, newer: false, none: true };
    if (!r.ok) return { ok: false, error: 'GitHub answered ' + r.status };
    const j = await r.json(); const latest = String(j.tag_name || '').replace(/^v/, '');
    if (!parseVer(latest)) return { ok: false, error: 'Unreadable release' };
    const assets = Array.isArray(j.assets) ? j.assets : [];
    const apk = assets.find((a) => /\.apk$/i.test(a.name || ''));
    return { ok: true, latest, newer: isNewer(latest, current), url: j.html_url || REPO_URL + '/releases', apk: apk && String(apk.browser_download_url || '').startsWith(REPO_URL + '/') ? apk.browser_download_url : '', size: apk ? apk.size : 0, notes: String(j.body || '').slice(0, 1200) };
  } catch (e) { return { ok: false, error: 'No connection' }; }
}
