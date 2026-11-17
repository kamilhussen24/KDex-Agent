// Every tool the app knows must have a friendly name, and no name may look like code.
import fs from 'node:fs';
import { TOOL_LABEL, toolLabel, opLabel } from '../www/js/toollabels.js';
const root = new URL('../www/js/', import.meta.url).pathname;
const names = new Set();
const icon = fs.readFileSync(root + 'main.js', 'utf8').match(/const TOOL_ICON = \{([^}]*)\}/)[1];
for (const m of icon.matchAll(/(\w+):/g)) names.add(m[1]);
for (const f of ['tools.js', 'extras.js', 'gittools.js', 'device.js', 'web.js', 'release.js', 'termux.js', 'imagegen.js', 'agent.js', 'github.js']) {
  const t = fs.readFileSync(root + f, 'utf8');
  for (const m of t.matchAll(/\bname: '([a-z]+(?:_[a-z]+)*)',\s*\n?\s*description:/g)) names.add(m[1]);
}
let bad = 0;
for (const n of [...names].sort()) { if (!TOOL_LABEL[n]) { console.log('NO LABEL:', n); bad++; } }
for (const [k, v] of Object.entries(TOOL_LABEL)) { if (/_/.test(v) || v !== v.charAt(0).toUpperCase() + v.slice(1)) { console.log('BAD LABEL', k, v); bad++; } }
const eq = (a, b) => { if (a !== b) { console.log('EXPECTED', b, 'GOT', a); bad++; } };
eq(toolLabel('git_stash'), 'Git stash'); eq(toolLabel('read_file'), 'Read file'); eq(opLabel('git_push'), 'Push to GitHub');
eq(opLabel('edit'), 'Edit file'); eq(opLabel('runs in Termux'), 'Runs in Termux'); eq(opLabel('reads this page'), 'Reads this page');
console.log(names.size + ' tool names checked,', Object.keys(TOOL_LABEL).length + ' labels,', bad ? bad + ' problems' : 'all ok');
process.exit(bad ? 1 : 0);
