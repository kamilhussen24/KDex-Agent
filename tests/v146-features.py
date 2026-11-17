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
    # ---- project: package.json + lock + version constant + changelog + workflow, committed in a repo
    pg.evaluate("""async(f)=>{const N=await import('./js/native.js');const G=await import('./js/git.js');
      const pkg={name:'demo',version:'1.0.0',scripts:{test:'node t.js'},dependencies:{left:'^1.2.3'}};
      const lock={name:'demo',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'demo',version:'1.0.0',dependencies:{left:'^1.2.3'}}}};
      await N.fs.writeText(f.uri,'package.json',JSON.stringify(pkg,null,2)+'\\n');
      await N.fs.writeText(f.uri,'package-lock.json',JSON.stringify(lock,null,2)+'\\n');
      await N.fs.writeText(f.uri,'www/js/config.js',"export const APP_VERSION = '1.0.0';\\n");
      await N.fs.writeText(f.uri,'CHANGELOG.md','# Changelog\\n\\n## [Unreleased]\\n\\n## [1.0.0]\\n\\n### Added\\n- First version\\n');
      await N.fs.writeText(f.uri,'.github/workflows/build.yml','name: Build\\non:\\n  push:\\n    tags: ["v*"]\\n    branches: [main]\\n    paths: [package.json]\\n');
      await G.setGitSettings?.({});
      await G.saveGitSettings({name:'Tester',email:'t@example.com'});
      await G.init(f,'http://127.0.0.1:4020/v146.git');
      const ch=await G.status(f); await G.commit(f,'Initial commit',undefined,ch);}""", f)
    print('branch:', pg.evaluate("(async()=>{const G=await import('./js/git.js');return G.currentBranch(%s)})()" % json.dumps(f)))
    # ---- 1. pre_push_check passes on a good project
    say(pg, 'v146check'); idle(pg); print('check ok:', [l[:110] for l in lines(pg, 'CHECK')])
    # ---- 2. bad range + lock mismatch + version mismatch are caught
    pg.evaluate("""async(f)=>{const N=await import('./js/native.js');
      const pkg={name:'demo',version:'1.0.1',scripts:{test:'node t.js'},dependencies:{left:'^1.02.3',right:'^2.0.0'}};
      await N.fs.writeText(f.uri,'package.json',JSON.stringify(pkg,null,2)+'\\n')}""", f)
    say(pg, 'v146check'); idle(pg); t = lines(pg, 'CHECK')[-1]; print('check bad:', t[:700])
    # ---- 3. git_push with problems: warn card with Fix it / Push anyway, Fix it hands the problems to the agent
    say(pg, 'v146push', '[data-tool=fix]'); pg.wait_for_timeout(300)
    card = pg.inner_text('.tool .diff'); print('push card has problems:', 'pre-push check found' in card, '|', [x.inner_text() for x in pg.query_selector_all('.tool .tf .lbl')][-4:])
    pg.locator('.tool .warnrow').last.scroll_into_view_if_needed(); pg.screenshot(path=SH + 'v146-pushwarn.png'); pg.click('[data-tool=fix]'); idle(pg)
    print('fix it result:', [l[:160] for l in lines(pg, 'PUSH')])
    # restore good package.json
    pg.evaluate("""async(f)=>{const N=await import('./js/native.js');
      const pkg={name:'demo',version:'1.0.0',scripts:{test:'node t.js'},dependencies:{left:'^1.2.3'}};
      await N.fs.writeText(f.uri,'package.json',JSON.stringify(pkg,null,2)+'\\n')}""", f)
    # ---- 4. bump_version: approval card, exact edits, only version lines change
    say(pg, 'v146bump', '[data-tool=apply]'); print('bump card:', pg.locator('.tool .diff').last.inner_text().replace('\n', ' | ')[:300]); pg.click('[data-tool=apply]'); idle(pg)
    got = pg.evaluate("""async(f)=>{const N=await import('./js/native.js');const r={};for(const p of ['package.json','package-lock.json','www/js/config.js']){r[p]=(await N.fs.readText(f.uri,p,100000)).text}return r}""", f)
    print('bumped:', json.loads(got['package.json'])['version'], json.loads(got['package-lock.json'])['version'], json.loads(got['package-lock.json'])['packages']['']['version'], got['www/js/config.js'].strip())
    print('bump result:', lines(pg, 'BUMP')[-1][:160])
    # ---- 5. release_info + release (one risky card)
    say(pg, 'v146info'); idle(pg); print('info:', lines(pg, 'INFO')[-1][:600])
    pg.evaluate("""async(f)=>{const N=await import('./js/native.js');await N.fs.writeText(f.uri,'src/feature.js','export const x = 1;\\n')}""", f)
    say(pg, 'v146rel', '[data-tool=apply]'); card = pg.locator('.tool').last.inner_text(); print('release card:', card.replace('\n', ' | ')[:700])
    risky = 'risky' in pg.locator('.tool .tf').last.inner_text(); print('release marked risky:', risky, '| apply label:', pg.inner_text('[data-tool=apply]'))
    pg.locator('.tool .tf').last.scroll_into_view_if_needed(); pg.screenshot(path=SH + 'v146-release.png'); pg.click('[data-tool=apply]'); idle(pg)
    print('release result:', lines(pg, 'REL')[-1][:500])
    cl = pg.evaluate("""async(f)=>{const N=await import('./js/native.js');return (await N.fs.readText(f.uri,'CHANGELOG.md',100000)).text}""", f); print('changelog head:', cl.split('\n')[:14])
    log = pg.evaluate("""async(f)=>{const G=await import('./js/git.js');return (await G.log(f,3)).map(x=>x.commit.message.trim())}""", f); print('git log:', log)
    # ---- 6. review: findings card (design A) and clean result
    pg.evaluate("""async(f)=>{const N=await import('./js/native.js');await N.fs.writeText(f.uri,'src/app.js','console.log("x");\\n// TODO later\\nconst key = "sk-'+'abcdefghijklmnopqrstuvwxyz0123456789ABCD";\\n')}""", f)
    say(pg, 'v146review'); idle(pg); pg.wait_for_selector('.rvcard .rvrow'); rows = pg.query_selector_all('.rvcard .rvrow')
    print('findings rows:', len(rows), '|', [r.inner_text().replace('\n', ' / ') for r in rows])
    print('order (risk first):', [pg.eval_on_selector_all('.rvcard .rvic', 'e=>e.map(x=>x.className)')])
    boxes = pg.evaluate("""[...document.querySelectorAll('.rvcard .rvrow')].map(r=>{const i=r.querySelector('.rvic').getBoundingClientRect(),t=r.querySelector('.rvtx').getBoundingClientRect();return Math.abs((i.top+i.height/2)-(t.top+t.height/2))})"""); print('icon vs text centre offset px:', [round(x, 2) for x in boxes])
    print('row rects:', pg.evaluate("""[...document.querySelectorAll('.rvcard .rvrow')].map(r=>{const q=(s)=>{const b=r.querySelector(s).getBoundingClientRect();return [Math.round(b.top),Math.round(b.height)]};return {row:[Math.round(r.getBoundingClientRect().top),Math.round(r.getBoundingClientRect().height)],ic:q('.rvic'),tx:q('.rvtx'),btn:q('.btn')}})"""))
    print('spotted in tool result:', pg.evaluate("(async()=>{const D=await import('./js/db.js');const m=(await D.db.all('messages')).filter(x=>x.name==='review_changes').pop();return m.content.split('Spotted')[1].slice(0,400)})()"))
    pg.locator('.rvcard').last.scroll_into_view_if_needed(); pg.screenshot(path=SH + 'v146-findings.png')
    pg.locator('.rvcard [data-tool=fixfind]').first.click(); pg.wait_for_timeout(500); idle(pg)
    print('fix button sent request:', 'GOT-FIX-REQUEST' in alltext(pg) or 'Fix this review finding' in alltext(pg), '|', [l[:120] for l in alltext(pg).split('\n') if l.startswith('Fix this review finding')][:1])
    say(pg, 'v146clean'); idle(pg); print('clean card:', pg.inner_text('.rvcard .rvok') if pg.query_selector('.rvcard .rvok') else 'NONE')
    # ---- 7. CI bar: waiting -> running -> failed with Fix it (max 3 tries)
    pg.evaluate("""async(f)=>{const G=await import('./js/git.js');await G.setRemote(f,'https://github.com/kdex/demo.git');const C=await import('./js/ci.js');await C.resetFixTries(f.id);window.__ci=C;window.__f=f;C.watchBuild(f,'abc1234','')}""", f)
    pg.wait_for_selector('#ciBar'); print('ci bar 1:', pg.inner_text('#ciBar').replace('\n', ' '))
    pg.wait_for_function("document.querySelector('#ciBar') && /failed/.test(document.querySelector('#ciBar').innerText)", timeout=60000)
    print('ci bar 2:', pg.inner_text('#ciBar').replace('\n', ' ')); pg.screenshot(path=SH + 'v146-cibar.png')
    pg.click('#ciBar [data-a=fix]'); pg.wait_for_timeout(600); idle(pg)
    print('fix try counter:', pg.evaluate("window.__ci.fixTries(window.__f.id)"), '| request sent:', 'The GitHub build for my last push failed' in alltext(pg))
    pg.evaluate("window.__ci.addFixTry(window.__f.id).then(()=>window.__ci.addFixTry(window.__f.id))"); runs_state['n'] = 2
    pg.evaluate("window.__ci.watchBuild(window.__f,'abc1234','')"); pg.wait_for_function("document.querySelector('#ciBar') && /failed/.test(document.querySelector('#ciBar').innerText)", timeout=60000)
    print('after 3 tries:', pg.inner_text('#ciBar').replace('\n', ' '), '| fix button:', pg.query_selector('#ciBar [data-a=fix]') is not None)
    # ---- 8. saved commands in the Terminal sheet
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(300); pg.click('#setTerm [data-v="1"]'); pg.wait_for_selector('#tmTest'); pg.click('#tmPath'); pg.fill('#dlgInput', '/data/data/com.termux/files/home/demo'); pg.click('#dlgYes'); pg.wait_for_timeout(300); pg.click('#sheetClose'); pg.wait_for_timeout(300)
    pg.click('#chipTerm'); pg.wait_for_selector('#scAdd'); print('empty hint:', pg.inner_text('#savedBox .ghint')[:80])
    pg.click('#scAdd'); pg.fill('#dlgInput', 'Run tests'); pg.click('#dlgYes'); pg.wait_for_timeout(200); pg.fill('#dlgInput', 'npm test'); pg.click('#dlgYes'); pg.wait_for_selector('.scrow')
    pg.click('#scAdd'); pg.fill('#dlgInput', 'Leak'); pg.click('#dlgYes'); pg.wait_for_timeout(200); pg.fill('#dlgInput', 'curl -H "token=abcdefghijkl123456" x'); pg.click('#dlgYes'); pg.wait_for_timeout(400)
    print('rows after secret attempt:', pg.locator('.scrow').count(), '| toast:', pg.evaluate("(document.querySelector('.toast')||{}).innerText||''")[:90])
    pg.mouse.click(5, 5); pg.wait_for_timeout(300)  # first tap only dismisses the warning toast (v1.48.1)
    pg.click('#scAdd'); pg.fill('#dlgInput', 'Restart server'); pg.click('#dlgYes'); pg.wait_for_timeout(200); pg.fill('#dlgInput', 'rm -rf build && npm run build'); pg.click('#dlgYes'); pg.wait_for_timeout(300)
    pg.evaluate("window.__calls=[];window.__kdexTermux=async(o)=>{window.__calls.push(o.command);return {stdout:'all good\\n',stderr:'',exitCode:0}};0")
    pg.screenshot(path=SH + 'v146-saved.png')
    pg.locator('[data-sc=run]').first.click(); pg.wait_for_timeout(300); print('run dialog:', pg.inner_text('#dlgText').replace('\n', ' | ')[:200]); pg.click('#dlgYes'); pg.wait_for_selector('#scOut .ok', timeout=10000)
    print('ran:', pg.evaluate("window.__calls"), '| out:', pg.inner_text('#scOut').replace('\n', ' ')[:80])
    pg.locator('[data-sc=run]').nth(1).click(); pg.wait_for_timeout(300); print('risky dialog warns:', 'Warning' in pg.inner_text('#dlgText')); pg.click('#dlgNo'); pg.wait_for_timeout(200)
    print('risky not run:', len(pg.evaluate("window.__calls")) == 1)
    pg.click('#sheetClose'); pg.wait_for_timeout(300)
    # ---- 9. git sheet Review button
    pg.evaluate("(async()=>{const N=await import('./js/native.js');const D=await import('./js/db.js');const fo=await D.kvGet('folders',[]);await N.fs.writeText(fo[fo.length-1].uri,'src/more.js','x\\n')})()")
    pg.click('#chipGit'); pg.wait_for_selector('#gReview', timeout=8000); pg.screenshot(path=SH + 'v146-gitsheet.png')
    pg.click('#gReview'); pg.wait_for_timeout(500); idle(pg)
    print('review button sent:', 'Review my uncommitted changes' in alltext(pg), '| cards:', pg.locator('.rvcard').count())
    print('errors:', errs)
    b.close()
