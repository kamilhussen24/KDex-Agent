// Small, safe Markdown renderer (headings, lists, tables, code blocks, bold/italic, links).
import { esc } from './util.js';
import { highlight } from './highlight.js';

function inline(t) {
  const codes = [];
  t = t.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return t.replace(/\u0001(\d+)\u0001/g, (m, i) => '<code>' + codes[i] + '</code>');
}

const splitRow = (line) => {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
};
const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);

export function renderMarkdown(src) {
  const blocks = [];
  src = String(src || '').replace(/```([\w+-]*)[^\n]*\n?([\s\S]*?)(```|$)/g, (m, lang, code) => {
    blocks.push({ lang, code: code.replace(/\n$/, '') });
    return '\n\u0000B' + (blocks.length - 1) + '\u0000\n';
  });
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } };
  const flushList = () => {
    if (list) { out.push('<' + list.t + '>' + list.items.map((i) => '<li>' + inline(i) + '</li>').join('') + '</' + list.t + '>'); list = null; }
  };
  const lines = esc(src).split('\n');
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    let m;
    if ((m = line.trim().match(/^\u0000B(\d+)\u0000$/))) {
      flushPara(); flushList();
      const b = blocks[Number(m[1])];
      out.push('<div class="code"><div class="code-h"><span class="tag">' + esc(b.lang || 'code') + '</span>' +
        '<button type="button" class="mini" data-copy><span class="lbl">Copy</span></button></div><pre><code>' + highlight(b.code, b.lang) + '</code></pre></div>');
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (line.indexOf('|') >= 0 && k + 1 < lines.length && isSep(lines[k + 1])) {
      flushPara(); flushList();
      const head = splitRow(line);
      const rows = [];
      k += 2;
      while (k < lines.length && lines[k].trim() && lines[k].indexOf('|') >= 0) { rows.push(splitRow(lines[k])); k++; }
      k--;
      out.push('<div class="table-wrap"><table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); const l = m[1].length + 1; out.push('<h' + l + '>' + inline(m[2]) + '</h' + l + '>'); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { flushPara(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^&gt;\s?(.*)$/))) { flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('');
}
