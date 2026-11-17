// HTML preview: builds one self-contained page that is shown in a closed box (sandboxed iframe) inside the app.
// The page cannot reach the network, the app's storage, chats or keys. Local CSS, JavaScript and pictures of a
// project folder are inlined so a normal small site shows up as it would in a browser.
import { fs } from './native.js';
import { isSecretPath, protectionOn } from './secrets.js';

export const isHtmlName = (n) => /\.html?$/i.test(String(n || ''));

const CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; media-src data: blob:; form-action 'none'";
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' };
const MAX_ASSET = 1500000; const MAX_TOTAL = 8000000; const MAX_TEXT = 1500000;

const bytesToB64 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const isRemote = (u) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(u) && !/^(data|blob):/i.test(u);

/** Adds the security rule and basic page settings to the document. */
export function wrapHtml(html) {
  const meta = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">';
  let h = String(html || '');
  if (/<head[^>]*>/i.test(h)) h = h.replace(/<head[^>]*>/i, (m) => m + meta);
  else if (/<html[^>]*>/i.test(h)) h = h.replace(/<html[^>]*>/i, (m) => m + '<head>' + meta + '</head>');
  else h = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + meta + '</head><body>' + h + '</body></html>';
  if (!/<meta[^>]+viewport/i.test(h)) h = h.replace(/<head[^>]*>/i, (m) => m + '<meta name="viewport" content="width=device-width,initial-scale=1">');
  return h;
}

/** Counts what the closed box will not load (web addresses). */
export function externalRefs(html) {
  const found = new Set();
  const re = /<(?:script|link|img|iframe|source|video|audio)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi; let m;
  while ((m = re.exec(html))) if (/^(https?:)?\/\//i.test(m[1]) && !/rel\s*=\s*["']?(?:canonical|alternate)/i.test(m[0])) found.add(m[1]);
  const css = /url\(\s*["']?(https?:\/\/[^)"']+)/gi; while ((m = css.exec(html))) found.add(m[1]);
  return [...found];
}

function dirOf(p) { const i = String(p).lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function resolvePath(dir, ref) {
  let r = String(ref).split('#')[0].split('?')[0];
  try { r = decodeURIComponent(r); } catch (e) { /* keep as is */ }
  const parts = (r.startsWith('/') ? [] : dir.split('/').filter(Boolean)).concat(r.split('/'));
  const out = [];
  for (const s of parts) { if (!s || s === '.') continue; if (s === '..') { if (!out.length) return null; out.pop(); } else out.push(s); }
  return out.join('/');
}

/** Reads the HTML file from a project folder and inlines its local stylesheets, scripts and pictures. */
export async function bundleFromFolder(folder, path) {
  const prot = await protectionOn();
  const notes = []; let budget = MAX_TOTAL;
  const text = async (p) => {
    if (!p || isSecretPath(p) && prot) return null;
    try { const r = await fs.readText(folder.uri, p, MAX_TEXT); return r && !r.binary && typeof r.text === 'string' ? r.text : null; } catch (e) { return null; }
  };
  const dataUrl = async (p) => {
    const ext = (p.split('.').pop() || '').toLowerCase(); const mime = MIME[ext];
    if (!mime || isSecretPath(p) && prot) return null;
    try {
      const st = await fs.stat(folder.uri, p); if (!st || !st.exists || st.isDir || st.size > MAX_ASSET || st.size > budget) return null;
      const b = await fs.readBytes(folder.uri, p); budget -= b.length;
      return 'data:' + mime + ';base64,' + bytesToB64(b);
    } catch (e) { return null; }
  };
  const base = await text(path);
  if (base === null) throw new Error('Could not read ' + path + '.');
  const missing = new Set();
  const cssUrls = async (css, dir) => {
    const re = /url\(\s*(["']?)([^)"']+)\1\s*\)/gi; const parts = []; let last = 0; let m;
    while ((m = re.exec(css))) {
      parts.push(css.slice(last, m.index)); last = re.lastIndex;
      const u = m[2].trim(); let out = m[0];
      if (u && !isRemote(u) && !u.startsWith('#') && !/^(data|blob):/i.test(u)) { const p = resolvePath(dir, u); const d = p ? await dataUrl(p) : null; if (d) out = 'url("' + d + '")'; else missing.add(u); }
      parts.push(out);
    }
    parts.push(css.slice(last)); return parts.join('');
  };
  const dir = dirOf(path);
  let html = base; const jobs = [];
  const swap = (re, fn) => { html.replace(re, (...a) => { jobs.push({ whole: a[0], fn: () => fn(...a) }); return a[0]; }); };
  swap(/<link\b[^>]*>/gi, async (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return null;
    const h = /href\s*=\s*["']([^"']+)["']/i.exec(tag); if (!h || isRemote(h[1])) return null;
    const p = resolvePath(dir, h[1]); const css = p ? await text(p) : null;
    if (css === null) { missing.add(h[1]); return null; }
    return '<style>' + (await cssUrls(css, dirOf(p))).replace(/<\/style/gi, '<\\/style') + '</style>';
  });
  swap(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, async (whole, a, src, b) => {
    if (isRemote(src)) return null;
    const p = resolvePath(dir, src); const js = p ? await text(p) : null;
    if (js === null) { missing.add(src); return null; }
    const attrs = (a + ' ' + b).replace(/\s+/g, ' ').trim();
    if (/type\s*=\s*["']module["']/i.test(attrs) && /^\s*import\s|\bfrom\s+["']\./m.test(js)) notes.push('A module script that imports other files (' + src + ') may not run in the preview.');
    return '<script' + (attrs ? ' ' + attrs : '') + '>' + js.replace(/<\/script/gi, '<\\/script') + '</script>';
  });
  swap(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, async (tag, src) => {
    if (isRemote(src) || /^(data|blob):/i.test(src)) return null;
    const p = resolvePath(dir, src); const d = p ? await dataUrl(p) : null;
    if (!d) { missing.add(src); return null; }
    return tag.replace(src, d);
  });
  swap(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, async (whole, css) => (/url\(/i.test(css) ? whole.replace(css, await cssUrls(css, dir)) : null));
  for (const j of jobs) { const out = await j.fn(); if (out !== null && out !== undefined) html = html.replace(j.whole, () => out); }
  if (missing.size) notes.push(missing.size + ' local file' + (missing.size === 1 ? '' : 's') + ' could not be loaded (missing, too big or not a supported type).');
  const ext = externalRefs(html); if (ext.length) notes.push(ext.length + ' web address' + (ext.length === 1 ? '' : 'es') + ' (fonts, libraries or pictures online) will not load in the preview.');
  return { html: wrapHtml(html), notes };
}

/** A page that came from the chat (no folder): only the web-address note applies. */
export function bundleText(html) {
  const notes = []; const ext = externalRefs(html);
  if (ext.length) notes.push(ext.length + ' web address' + (ext.length === 1 ? '' : 'es') + ' (fonts, libraries or pictures online) will not load in the preview.');
  return { html: wrapHtml(html), notes };
}
