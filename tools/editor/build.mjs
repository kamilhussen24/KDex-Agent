// Rebuild: cd tools/editor && npm install && npm run build
import { build } from 'esbuild';
import { statSync } from 'node:fs';
const out = '../../www/vendor/codemirror.min.js';
await build({
  entryPoints: ['entry.js'], bundle: true, minify: true, format: 'iife', target: 'es2020', outfile: out, legalComments: 'none',
  banner: { js: '/* CodeMirror 6 (MIT) bundled for KDex Agent. See LICENSE-codemirror.md. Rebuild: tools/editor */' },
});
console.log(out, (statSync(out).size / 1024).toFixed(0) + ' KB');
