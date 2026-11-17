import json
from playwright.sync_api import sync_playwright
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=15000); pg.wait_for_timeout(300)
def last_asst(pg): return pg.evaluate("(()=>{const a=[...document.querySelectorAll('.msg.assistant, .msg.bot, .msg:not(.user)')];return a.length?a[a.length-1].innerText:''})()")
_last=[None]
def say(pg,t,wait_apply=False):
    if _last[0]==t: pg.wait_for_timeout(4500)  # the app ignores the same text sent twice within 4 seconds
    _last[0]=t
    pg.fill('#input',t); pg.click('#sendBtn')
    if wait_apply: pg.wait_for_selector('[data-tool=apply]',timeout=8000)
def alltext(pg): return pg.inner_text('#messages')
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2); ctx.grant_permissions(['clipboard-read','clipboard-write'],origin='http://127.0.0.1:4011')
    pg=ctx.new_page(); errs=[]; gh_hdrs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
    def gh(route):
        r=route.request; u=r.url
        if r.method=='OPTIONS': return route.fulfill(status=204,headers=CORS)
        gh_hdrs.append((u,r.headers.get('authorization')))
        J=lambda o: route.fulfill(status=200,headers={**CORS,'content-type':'application/json'},body=json.dumps(o))
        if '/actions/runs?per_page=1&status=failure' in u: return J({'workflow_runs':[{'id':77,'name':'Build APK','display_title':'Fix menu','head_branch':'main','head_sha':'abcdef123456','status':'completed','conclusion':'failure','created_at':'2026-11-13T00:00:00Z'}]})
        if '/actions/runs?per_page=' in u: return J({'workflow_runs':[{'id':77,'name':'Build APK','display_title':'Fix menu','head_branch':'main','head_sha':'abcdef123456','status':'completed','conclusion':'failure','created_at':'2026-11-13T00:00:00Z'},{'id':76,'name':'Build APK','display_title':'Add logo','head_branch':'main','head_sha':'1234567890ab','status':'completed','conclusion':'success','created_at':'2026-11-12T00:00:00Z'}]})
        if u.endswith('/actions/runs/77'): return J({'id':77,'name':'Build APK','display_title':'Fix menu','head_branch':'main','head_sha':'abcdef123456','status':'completed','conclusion':'failure','created_at':'2026-11-13T00:00:00Z'})
        if '/actions/runs/77/jobs' in u: return J({'jobs':[{'id':9,'name':'build','conclusion':'failure','steps':[{'name':'Set up','conclusion':'success'},{'name':'Gradle build','conclusion':'failure'}]}]})
        if u.endswith('/actions/jobs/9/logs'): return route.fulfill(status=200,headers={**CORS,'content-type':'text/plain'},body='2026-11-13T00:00:01Z Starting\n2026-11-13T00:00:02Z > Task :app:compileDebugJavaWithJavac\n2026-11-13T00:00:03Z error: cannot find symbol Foo\n2026-11-13T00:00:04Z BUILD FAILED in 40s\n')
        if '/issues?state=' in u: return J([{'number':5,'title':'Menu bug','user':{'login':'kamil'},'created_at':'2026-11-12T00:00:00Z'}])
        return route.fulfill(status=404,headers=CORS,body='{}')
    pg.route('https://api.github.com/**',gh)
    def blob(route):
        r=route.request
        if r.method=='OPTIONS': return route.fulfill(status=204,headers=CORS)
        gh_hdrs.append((r.url,r.headers.get('authorization')))
        route.fulfill(status=200,headers={**CORS,'content-type':'text/plain'},body='2026-11-13T00:00:01Z Starting\n2026-11-13T00:00:02Z > Task :app:compileDebugJavaWithJavac\n2026-11-13T00:00:03Z error: cannot find symbol Foo\n2026-11-13T00:00:04Z BUILD FAILED in 40s\n')
    pg.route('https://blob.example.com/**',blob)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(300)
    # ---- no-folder chat: calculator, converter, remember, timer error, clipboard
    say(pg,'v145calc'); idle(pg); print('calc:',[l for l in alltext(pg).split('\n') if l.startswith('CALC')])
    say(pg,'v145conv'); idle(pg); print('convert:',[l for l in alltext(pg).split('\n') if l.startswith('CONV')])
    say(pg,'v145rem'); idle(pg); print('remember:',[l for l in alltext(pg).split('\n') if l.startswith('REM')])
    mem=pg.evaluate("(async()=>{const D=await import('./js/db.js');return (await D.kvGet('memory',[])).map(m=>m.text)})()"); print('memory notes:',mem)
    say(pg,'v145clip',True); print('clip card:',pg.inner_text('.tool .tf .lbl')); pg.click('[data-tool=apply]'); idle(pg)
    print('clip result:',[l for l in alltext(pg).split('\n') if l.startswith('CLIP')], '| clipboard:',pg.evaluate("navigator.clipboard.readText()"))
    say(pg,'v145tim',True); print('timer card:',pg.inner_text('.tool .diff').strip()); pg.click('[data-tool=apply]'); idle(pg)
    print('timer in browser:',[l for l in alltext(pg).split('\n') if l.startswith('TIMER') or 'Android app' in l][:2])
    # ---- open a folder
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
    f=pg.evaluate("(async()=>{const D=await import('./js/db.js');const fo=await D.kvGet('folders',[]);return fo[fo.length-1]})()")
    pg.evaluate("""async(f)=>{const N=await import('./js/native.js');
      await N.fs.writeText(f.uri,'package.json',JSON.stringify({name:'demo',scripts:{test:'node t.js',lint:'eslint .'}}));
      await N.fs.writeText(f.uri,'src/util.js','export function add(a,b){return a+b}\\nexport const mul = (a,b) => a*b;\\nclass Box {}\\n');
      await N.fs.writeText(f.uri,'tools/run.py','def main():\\n    pass\\nclass Runner:\\n    pass\\n');
      await N.fs.writeText(f.uri,'KDEX.md','Always answer in English.\\nRun tests with npm test.\\n')}""",f)
    say(pg,'v145map'); idle(pg); t=[l for l in alltext(pg).split('\n') if l.startswith('MAP')]; print('map:',t[0][:420] if t else 'NONE')
    say(pg,'v145chk'); idle(pg); t=[l for l in alltext(pg).split('\n') if l.startswith('CHK')]; print('checks:',t[0][:330] if t else 'NONE')
    say(pg,'v145kdex'); idle(pg); print('kdex:',[l for l in alltext(pg).split('\n') if l.startswith('SYS')])
    # ---- loop guard
    say(pg,'v145loop'); idle(pg); lt=alltext(pg); print('loop stopped:', 'going in circles' in lt, '| calc cards:',pg.locator('.tool .nm',has_text='calculate').count())
    # ---- two changes -> undo-all bar
    say(pg,'v145multi',True); pg.click('[data-tool=apply]'); pg.wait_for_function("document.querySelectorAll('[data-tool=apply]').length>=1",timeout=8000); pg.click('[data-tool=apply]'); idle(pg)
    pg.wait_for_selector('#turnUndo'); print('undo bar:',pg.inner_text('#turnUndo').replace('\n',' '))
    pg.screenshot(path='shots/v145-undobar.png')
    pg.click('#turnUndo [data-a=undo]'); pg.wait_for_selector('#dlgYes'); pg.click('#dlgYes'); pg.wait_for_timeout(500)
    ex=pg.evaluate("""async(f)=>{const N=await import('./js/native.js');return [(await N.fs.stat(f.uri,'m1.txt')).exists,(await N.fs.stat(f.uri,'m2.txt')).exists]}""",f)
    print('after undo all, files exist:',ex,'| bar gone:',pg.query_selector('#turnUndo') is None)
    # ---- image generation (set up through Settings, then run)
    say(pg,'v145gen'); idle(pg); print('gen without setup:',[l for l in alltext(pg).split('\n') if l.startswith('GEN')][-1:])
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#setImgProv'); pg.select_option('#setImgProv',index=1); pg.fill('#setImgModel','gpt-image-1'); pg.press('#setImgModel','Tab'); pg.wait_for_timeout(300)
    pg.click('#sheetClose') if pg.query_selector('#sheetClose') else pg.click('#sheet .sheet-head button:last-child'); pg.wait_for_timeout(300)
    pg.wait_for_timeout(4500)  # the app ignores the same text sent twice within 4 seconds
    say(pg,'v145gen',True); print('image card:',pg.inner_text('.tool .tf .lbl'),'|',pg.inner_text('.tool .diff').replace('\n',' / ')[:160]); pg.click('[data-tool=apply]'); idle(pg)
    print('gen result:',[l for l in alltext(pg).split('\n') if l.startswith('GEN')][-1:])
    ex=pg.evaluate("""async(f)=>{const N=await import('./js/native.js');const s=await N.fs.stat(f.uri,'images/cube.png');return [s.exists,s.size]}""",f); print('file saved:',ex)
    print('preview shown:',pg.locator('.tool .genimg img').count(),'| request body:',pg.evaluate("fetch('http://127.0.0.1:4010/__imgbody').then(r=>r.text())"))
    print('undo button on image card:',pg.locator('[data-tool=undo]').count())
    pg.screenshot(path='shots/v145-image.png')
    pg.locator('[data-tool=undo]').last.click(); pg.wait_for_timeout(500)
    print('after undo exists:',pg.evaluate("""async(f)=>{const N=await import('./js/native.js');return (await N.fs.stat(f.uri,'images/cube.png')).exists}""",f))
    # reject path
    say(pg,'v145gen',True); pg.click('[data-tool=reject]'); idle(pg); print('rejected, file:',pg.evaluate("""async(f)=>{const N=await import('./js/native.js');return (await N.fs.stat(f.uri,'images/cube.png')).exists}""",f))
    # ---- GitHub tools
    pg.evaluate("""async(f)=>{const G=await import('./js/git.js');await G.init(f);await G.setRemote(f,'https://github.com/kamilhussen24/demo.git');await G.saveToken('github.com','demo_token_123')}""",f)
    say(pg,'v145gh'); idle(pg); print('runs:',[l for l in alltext(pg).split('\n') if l.startswith('GH ')][-1:])
    print('direct log:',pg.evaluate("""async(f)=>{const M=await import('./js/github.js');try{return (await M.runGithub('github_run_log',{},f,undefined)).slice(0,500)}catch(e){return 'ERR '+e.message}}""",f))
    say(pg,'v145ghlog'); idle(pg); print('TAIL:',alltext(pg)[-500:].replace('\\n',' / '))
    # print('log:',[l for l in alltext(pg).split('\n') if l.startswith('GHLOG') or 'rror' in l][-2:])
    say(pg,'v145ghi'); idle(pg); print('issues:',[l for l in alltext(pg).split('\n') if l.startswith('GHI') or 'rror' in l][-2:])
    print('auth to api.github.com sent:',any(h and 'demo_token' in h for u,h in gh_hdrs if 'api.github.com' in u),'| auth to blob host:',[h for u,h in gh_hdrs if 'blob.example' in u])
    b.close()
print('errors:',errs)
