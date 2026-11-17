import json
from playwright.sync_api import sync_playwright
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=20000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]; bodies=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        def h(route):
            if 'chat/completions' in route.request.url: bodies.append(route.request.post_data or '')
            route.continue_()
        pg.route('**/*',h); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached')
        pg.click('#topFolderBtn'); pg.wait_for_selector('#pPath'); pg.click('#pPath'); pg.wait_for_selector('#opPath')
        pg.fill('#opPath','/storage/emulated/0/Venter/HopWeb/Projects/KDex-Agent'); pg.wait_for_timeout(700); pg.click('#opGo'); pg.wait_for_selector('#chipFiles:not(.hidden)',timeout=6000)
        pg.fill('#input','hello'); pg.click('#sendBtn'); pg.wait_for_function("!document.querySelector('#stopBtn').classList.contains('hidden')"); idle(pg)
        sysm=''
        for m in json.loads(bodies[-1])['messages']:
            if m['role']=='system': sysm=m['content']
        print(mode,'PLAN FIRST:','PLAN FIRST' in sysm,'| CHECK:','CHECK YOUR WORK' in sysm,'| MAP:','PROJECT MAP' in sysm)
        i=sysm.find('PROJECT MAP (made'); print(sysm[i:i+500] if i>=0 else 'no map')
        assert 'PLAN FIRST' in sysm and 'CHECK YOUR WORK' in sysm and 'PROJECT MAP (made' in sysm
        pg.evaluate("document.body.insertAdjacentHTML('beforeend','<div id=gMsg></div>')")
        pg.evaluate("window.__errLine('This needs an access token on github.com (the repository is private or the action needs login). Add one in Settings > Git > Identity and access tokens.')")
        print(mode,'token card buttons:',pg.eval_on_selector_all('#gMsg .btn','e=>e.map(x=>x.innerText)'),'| title:',pg.inner_text('#gMsg .gt1'))
        assert pg.query_selector('#gMsg .btn') is None
        pg.evaluate("window.__errLine('Push rejected: the remote has newer commits. Pull first.')")
        print(mode,'pull card buttons:',pg.eval_on_selector_all('#gMsg .btn','e=>e.map(x=>x.innerText)'))
        pg.evaluate("window.__errLine('No connection to github.com. Check the internet and try again.',{retry:()=>{}})")
        print(mode,'offline card buttons:',pg.eval_on_selector_all('#gMsg .btn','e=>e.map(x=>x.innerText)'))
        print(mode,errs); pg.context.close()
    b.close()
