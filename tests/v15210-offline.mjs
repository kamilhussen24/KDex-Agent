import { netText, NO_NET } from '../www/js/util.js';
const cases = [
 'TransportException: https://github.com/k/Dex-Agent.git: cannot open git-receive-pack',
 'failed to connect to /192.67.63.120 (port 22) from /:: (port 0) after 15000ms: connect failed: ENETUNREACH (Network is unreachable)',
 'Unable to resolve host "api.anthropic.com": No address associated with hostname',
 'Failed to fetch', 'java.net.UnknownHostException: x'];
let ok = true;
for (const c of cases) { const r = netText(new Error(c)); if (r !== NO_NET) { ok = false; console.log('MISS', c); } }
for (const c of ['Provider error 401: bad key', 'Permission denied', 'Auth fail']) if (netText(c)) { ok = false; console.log('FALSE', c); }
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
