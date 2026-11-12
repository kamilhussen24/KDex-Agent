from playwright.sync_api import sync_playwright
import json
HOOK="window.__kdexTermux=async(o)=>({stdout:'ok\\n',stderr:'',exitCode:0});"
def idle(pg): pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=10000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('dark','light'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=1.5,color_scheme=mode).new_page(); errs=[]; reqs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('request',lambda r: reqs.append(r.post_data or '') if 'chat/completions' in r.url else None)
        pg.add_init_script(HOOK); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
        pg.fill('#input','envtest'); pg.click('#sendBtn'); pg.wait_for_selector('#dlgInput',state='visible',timeout=8000); pg.wait_for_timeout(300)
        pg.screenshot(path=f'shots/f/{mode}-secret.png')
        print(mode,'input type:',pg.get_attribute('#dlgInput','type'))
        pg.click('#dlgEye'); print(mode,'after eye:',pg.get_attribute('#dlgInput','type')); pg.click('#dlgEye')
        pg.click('#dlgYes'); pg.wait_for_timeout(150); print(mode,'empty save keeps dialog:', pg.is_visible('#dlgInput'))
        pg.fill('#dlgInput','sk_live_SUPERSECRET99'); pg.click('#dlgYes'); idle(pg)
        txt=pg.inner_text('#messages'); alls=' '.join(reqs)
        print(mode,'chat shows secret:', 'SUPERSECRET99' in txt, '| sent to model:', 'SUPERSECRET99' in alls, '| model got:', 'ENVRESULT' in txt)
        pg.screenshot(path=f'shots/f/{mode}-secret-done.png')
        ev=pg.evaluate("""async()=>{const N=await import('/js/native.js'); const f=JSON.parse(JSON.stringify((await (await import('/js/db.js')).kvGet('folders',[]))||[])); return f}""")
        # file content check via fs of the current folder
        res=pg.evaluate("""async()=>{const D=await import('/js/db.js'); const N=await import('/js/native.js'); const fs=await D.db.all('kv'); const row=fs.find(r=>r.key==='folders'); const f=row.value[row.value.length-1]; const t=await N.fs.readText(f.uri,'.env',10000); return t.text}""")
        print(mode,'.env file:', repr(res))
        # second request: already set
        pg.fill('#input','envtest again'); pg.click('#sendBtn'); idle(pg)
        print(mode,'second ask dialog shown:', pg.is_visible('#dlgInput'), '| result mentions already set:', 'already set' in pg.inner_text('#messages'))
        # skip path: new var via direct? covered by abort: skip
        print(mode,'errs',errs)
    b.close()
