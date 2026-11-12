from playwright.sync_api import sync_playwright
HOOK="window.__kdexTermux=async(o)=>({stdout:'ok\\n',stderr:'',exitCode:0});"
def idle(pg): pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=12000); pg.wait_for_timeout(300)
RD="""async(n)=>{const D=await import('/js/db.js'); const N=await import('/js/native.js'); const row=(await D.db.all('kv')).find(r=>r.key==='folders'); const f=row.value[row.value.length-1]; try{return (await N.fs.readText(f.uri,n,10000)).text}catch(e){return '(none)'}}"""
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('dark','light'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=1.5,color_scheme=mode).new_page(); errs=[]; reqs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('request',lambda r: reqs.append(r.post_data or '') if 'chat/completions' in r.url else None)
        pg.add_init_script(HOOK); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
        pg.fill('#input','batchtest'); pg.click('#sendBtn')
        pg.wait_for_selector('#dlgInput',state='visible',timeout=8000)
        print(mode,'first box title:',pg.inner_text('#dlgTitle'),'| approval card shown:',pg.query_selector('[data-tool=apply]') is not None)
        print(mode,'plain already written before asking:',repr(pg.evaluate(RD,'.env')))
        pg.screenshot(path=f'shots/f/{mode}-batch-1.png')
        pg.fill('#dlgInput','demo_TYPEDSECRET'); pg.click('#dlgYes')
        pg.wait_for_selector('#dlgInput',state='visible',timeout=8000); print(mode,'second box title:',pg.inner_text('#dlgTitle'))
        pg.click('#dlgNo'); idle(pg)
        print(mode,'.env:',repr(pg.evaluate(RD,'.env')))
        print(mode,'.env.example:',repr(pg.evaluate(RD,'.env.example')))
        msgs=pg.inner_text('#messages'); print(mode,'model got summary:','ENVRESULT' in msgs)
        print(mode,'secret leaked in chat/requests:','TYPEDSECRET' in msgs or 'TYPEDSECRET' in ' '.join(reqs),'| fake key in .env.example:','fakefake' in pg.evaluate(RD,'.env.example'),'| errs',errs)
        pg.screenshot(path=f'shots/f/{mode}-batch-2.png')
    b.close()
