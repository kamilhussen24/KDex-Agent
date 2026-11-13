// Reads text out of Word, Excel and PowerPoint files (they are zip files with XML inside), so they can be attached to a chat.
// PDF files with real text are read with pdf.js (loaded only when a PDF is attached). Scanned PDFs have no text, and old binary formats (.doc, .xls, .ppt) are not supported.
const lib = () => { if (!window.fflate) throw new Error('The zip engine did not load.'); return window.fflate; };
const dec = (u8) => new TextDecoder('utf-8').decode(u8);
const unent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const OFFICE = /\.(docx|xlsx|pptx|odt|ods|odp)$/i;
export const isOffice = (name) => OFFICE.test(name || '');

function files(buf, want) {
  const out = lib().unzipSync(new Uint8Array(buf), { filter: (f) => want(f.name) && f.originalSize < 8 * 1048576 });
  return out;
}
function docx(buf) {
  const z = files(buf, (n) => n === 'word/document.xml'); const x = z['word/document.xml']; if (!x) throw new Error('No text found in this Word file.');
  const xml = dec(x).replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, '\t');
  return unent(xml.replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}
function pptx(buf) {
  const z = files(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const names = Object.keys(z).sort((a, b) => Number(a.match(/(\d+)\.xml/)[1]) - Number(b.match(/(\d+)\.xml/)[1]));
  if (!names.length) throw new Error('No slides found.');
  return names.map((n, i) => 'Slide ' + (i + 1) + ':\n' + unent(dec(z[n]).replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')).replace(/\n{2,}/g, '\n').trim()).join('\n\n');
}
function xlsx(buf) {
  const z = files(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = z['xl/sharedStrings.xml'] ? [...dec(z['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unent([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))) : [];
  const sheetNames = z['xl/workbook.xml'] ? [...dec(z['xl/workbook.xml']).matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => unent(m[1])) : [];
  const names = Object.keys(z).filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => Number(a.match(/(\d+)\.xml/)[1]) - Number(b.match(/(\d+)\.xml/)[1]));
  if (!names.length) throw new Error('No sheets found.');
  return names.map((n, i) => {
    const rows = [...dec(z[n]).matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const attrs = c[1]; const inner = c[2] || ''; const v = /<v>([\s\S]*?)<\/v>/.exec(inner); const is = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
      if (/t="s"/.test(attrs) && v) return shared[Number(v[1])] || '';
      if (is) return unent(is[1]);
      return v ? unent(v[1]) : '';
    }).join('\t'));
    return 'Sheet: ' + (sheetNames[i] || 'Sheet' + (i + 1)) + '\n' + rows.join('\n');
  }).join('\n\n');
}
function odf(buf) {
  const z = files(buf, (n) => n === 'content.xml'); const x = z['content.xml']; if (!x) throw new Error('No text found.');
  return unent(dec(x).replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n').replace(/<\/(text:p|text:h|table:table-row)>/g, '\n').replace(/<\/table:table-cell>/g, '\t').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}
/** Returns the plain text of an Office file, or throws an Error with a short reason. */
export async function officeText(file) {
  const buf = await file.arrayBuffer(); const n = file.name.toLowerCase();
  let t; try { t = n.endsWith('.docx') ? docx(buf) : n.endsWith('.pptx') ? pptx(buf) : n.endsWith('.xlsx') ? xlsx(buf) : odf(buf); } catch (e) { throw new Error(file.name + ' could not be read (damaged, protected or not a real Office file).'); }
  if (!t.trim()) throw new Error('No readable text in ' + file.name + '.');
  return t;
}

// ---------------------------------------------------------------- PDF
export const isPdf = (name) => /\.pdf$/i.test(name || '');
export const PDF_MAX_BYTES = 15 * 1048576;
const PDF_MAX_PAGES = 150;
const PDF_MAX_CHARS = 400 * 1024;
let pdfLoad = null;
function loadPdfLib() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfLoad) {
    pdfLoad = new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = 'vendor/pdf.min.js';
      s.onload = () => { if (!window.pdfjsLib) { pdfLoad = null; no(new Error('The PDF reader did not load.')); return; } window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = () => { pdfLoad = null; no(new Error('The PDF reader did not load.')); };
      document.head.appendChild(s);
    });
  }
  return pdfLoad;
}
/** Reads the text of a PDF. Returns { text, pages, read, cut }. Throws a plain message for scans, protected and damaged files. */
export async function pdfText(file) {
  const lib = await loadPdfLib();
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try { doc = await lib.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise; }
  catch (e) {
    if (e && e.name === 'PasswordException') throw new Error(file.name + ' is password protected.');
    throw new Error(file.name + ' could not be read (damaged or not a real PDF).');
  }
  const pages = doc.numPages; let out = ''; let read = 0; let cut = false;
  try {
    for (let i = 1; i <= Math.min(pages, PDF_MAX_PAGES); i++) {
      const page = await doc.getPage(i); const tc = await page.getTextContent(); let line = '';
      for (const it of tc.items) { if (typeof it.str !== 'string') continue; line += it.str; line += it.hasEOL ? '\n' : ' '; }
      page.cleanup(); read = i;
      const body = line.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      out += 'Page ' + i + ':\n' + body + '\n\n';
      if (out.length > PDF_MAX_CHARS) { cut = true; break; }
    }
  } finally { try { doc.destroy(); } catch (e) { /* already closed */ } }
  if (!cut && pages > PDF_MAX_PAGES) cut = true;
  const plain = out.replace(/Page \d+:\n/g, '').trim();
  if (plain.length < 20) throw new Error(file.name + ' is a scan, so it has no text to read. Attach photos of the pages instead.');
  if (out.length > PDF_MAX_CHARS) out = out.slice(0, PDF_MAX_CHARS);
  return { text: out.trim(), pages, read, cut };
}
