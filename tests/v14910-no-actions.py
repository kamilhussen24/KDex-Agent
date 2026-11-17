import json
from playwright.sync_api import sync_playwright
SH = '/tmp/kt/shots/'
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')", timeout=20000); pg.wait_for_timeout(300)
def say(pg, t, wait_sel=None):
    pg.fill('#input', t); pg.click('#sendBtn')
    if wait_sel: pg.wait_for_selector(wait_sel, timeout=10000)
def alltext(pg): return pg.inner_text('#messages')
def lines(pg, pre): return [l for l in alltext(pg).split('\n') if l.startswith(pre)]
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2)
    pg = ctx.new_page(); errs = []; runs_state = {'n': 0}
    pg.on('pageerror', lambda e: errs.append(str(e)))
    def gh(route):
        r = route.request; u = r.url
        if r.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
        J = lambda o: route.fulfill(status=200, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps(o))
        if '/actions/runs?head_sha=' in u:
            runs_state['n'] += 1
            if runs_state['n'] == 1: return J({'workflow_runs': []})
            if runs_state['n'] == 2: return J({'workflow_runs': [{'id': 501, 'name': 'Build', 'status': 'in_progress', 'conclusion': None}]})
            return J({'workflow_runs': [{'id': 501, 'name': 'Build', 'status': 'completed', 'conclusion': 'failure'}]})
        return route.fulfill(status=404, headers=CORS, body='{}')
    pg.route('https://api.github.com/**', gh)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
    f = pg.evaluate("(async()=>{const D=await import('./js/db.js');const fo=await D.kvGet('folders',[]);return fo[fo.length-1]})()")
    f = pg.evaluate("(async()=>{const D=await import('./js/db.js');const fo=await D.kvGet('folders',[]);return fo[fo.length-1]})()")
    pg.evaluate("""async(f)=>{const N=await import('./js/native.js');const G=await import('./js/git.js');
      await N.fs.writeText(f.uri,'a.txt','x\\n');
      await G.saveGitSettings({name:'T',email:'t@example.com'});
      await G.init(f,'https://github.com/kamil/demo.git');
      const ch=await G.status(f); await G.commit(f,'init',undefined,ch);}""", f)
    r1 = pg.evaluate("""async(f)=>{const C=await import('./js/ci.js');await C.watchBuild(f,'abc123','');return C.getBuild()}""", f)
    print('no workflow ->', r1)
    pg.evaluate("""async(f)=>{const N=await import('./js/native.js');await N.fs.writeText(f.uri,'.github/workflows/build.yml','name: Build\\non: push\\n')}""", f)
    r2 = pg.evaluate("""async(f)=>{const C=await import('./js/ci.js');await C.watchBuild(f,'abc123','');const w=C.getBuild();C.stopWatch();return w&&w.phase}""", f)
    print('with workflow ->', r2)
    ok = r1 is None and r2 == 'waiting' and not errs
    print('PASS' if ok else 'FAIL', errs[:2])
    raise SystemExit(0 if ok else 1)
