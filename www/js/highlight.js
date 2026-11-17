// Small syntax highlighter: comments, strings, numbers, keywords. Output is escaped HTML.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const KW = {
  js: 'break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await null true false undefined interface type enum implements public private protected readonly as',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return try while with yield True False self',
  sh: 'if then else elif fi for while do done case esac function in return export local echo cd exit set unset source alias until select',
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch synchronized this throw throws try void volatile while true false var val fun when object override suspend data sealed companion',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while #include #define NULL true false class namespace template typename public private protected new delete using',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  sql: 'select from where insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset and or not null as distinct union primary key foreign references default unique',
  css: '',
  json: 'true false null',
  yaml: 'true false null yes no',
  md: '',
};
const ALIAS = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', typescript: 'js', node: 'js',
  python: 'py', py: 'py', bash: 'sh', shell: 'sh', zsh: 'sh', sh: 'sh', console: 'sh',
  java: 'java', kotlin: 'java', kt: 'java', gradle: 'java', scala: 'java', groovy: 'java', dart: 'java', swift: 'java', cs: 'java', csharp: 'java', php: 'java',
  dockerfile: 'sh', makefile: 'sh', c: 'c', cpp: 'c', 'c++': 'c', h: 'c', hpp: 'c', cc: 'c', go: 'go', rust: 'rust', rs: 'rust',
  sql: 'sql', css: 'css', scss: 'css', less: 'css', json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml', env: 'sh',
  html: 'html', xml: 'html', svg: 'html', vue: 'html', md: 'md', markdown: 'md',
};
const HASH_COMMENT = new Set(['py', 'sh', 'yaml']);

export function langOf(nameOrLang) {
  const s = String(nameOrLang || '').toLowerCase();
  const ext = s.includes('.') ? s.split('.').pop() : s;
  return ALIAS[ext] || ALIAS[s] || '';
}

const wrap = (cls, t) => '<span class="tk-' + cls + '">' + esc(t) + '</span>';

function html(code) {
  const re = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w:-]*)|("[^"]*"|'[^']*')|(\/?>)/g;
  let out = ''; let last = 0; let m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    out += m[1] ? wrap('c', m[1]) : m[2] ? wrap('k', m[2]) : m[3] ? wrap('s', m[3]) : wrap('k', m[4]);
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}

/** Returns highlighted HTML for `code`. Unknown languages are returned escaped. Large inputs are not coloured. */
export function highlight(code, lang) {
  const L = langOf(lang);
  code = String(code == null ? '' : code);
  if (!L || code.length > 60000) return esc(code);
  if (L === 'html') return html(code);
  if (L === 'md') return esc(code);
  const kws = new Set((KW[L] || '').split(/\s+/).filter(Boolean));
  const parts = [];
  parts.push('(\\/\\*[\\s\\S]*?\\*\\/)'); // 1 block comment
  const line = L === 'css' ? null : (HASH_COMMENT.has(L) ? '(#[^\\n]*)' : L === 'sql' ? '(--[^\\n]*)' : '(\\/\\/[^\\n]*)');
  parts.push(line || '(?!)'); // 2 line comment
  parts.push('("""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|`(?:\\\\[\\s\\S]|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')'); // 3 string
  parts.push('(\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?\\b)'); // 4 number
  parts.push('(#?[A-Za-z_$][\\w$]*)'); // 5 word
  const re = new RegExp(parts.join('|'), 'g');
  let out = ''; let last = 0; let m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index)); last = re.lastIndex;
    if (m[1] || m[2]) out += wrap('c', m[0]);
    else if (m[3]) out += wrap(L === 'json' && /^\s*:/.test(code.slice(last, last + 4)) ? 'p' : 's', m[0]);
    else if (m[4]) out += wrap('n', m[0]);
    else if (m[5]) {
      const w = m[5];
      if (kws.has(w) || (L === 'sql' && kws.has(w.toLowerCase()))) out += wrap('k', w);
      else if (L === 'css' && /^[a-z-]+$/i.test(w) && /^\s*:/.test(code.slice(last, last + 3))) out += wrap('p', w);
      else if (/^[A-Z][A-Za-z0-9_]*$/.test(w) && L !== 'sh') out += wrap('t', w);
      else if (code[last] === '(' && L !== 'sh') out += wrap('f', w);
      else out += esc(w);
    } else out += esc(m[0]);
  }
  return out + esc(code.slice(last));
}
