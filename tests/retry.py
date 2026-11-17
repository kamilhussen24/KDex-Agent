from playwright.sync_api import sync_playwright
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=20000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},color_scheme=mode).new_page(); errs=[]; n={'c':0,'fail':2}
        pg.on('pageerror',lambda e: errs.append(str(e)))
        def h(route):
            if 'chat/completions' in route.request.url:
                n['c']+=1
                if n['c']<=n['fail']: return (route.abort('failed') if n.get('net') else route.fulfill(status=503,body='{"error":{"message":"busy"}}',headers={'content-type':'application/json','access-control-allow-origin':'*'}))
            route.continue_()
        pg.route('**/*',h); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
        n['c']=0
        pg.fill('#input','hello'); pg.click('#sendBtn'); pg.wait_for_function("!document.querySelector('#stopBtn').classList.contains('hidden')"); idle(pg)
        print(mode,'503 twice then ok -> reply shown:','Mock' in pg.inner_text('#messages'),'| requests:',n['c'],'| errs',errs)
        n['c']=0; n['fail']=99; pg.fill('#input','again'); pg.click('#sendBtn'); pg.wait_for_function("!document.querySelector('#stopBtn').classList.contains('hidden')"); idle(pg)
        print(mode,'always 503 -> error shown:','Error' in pg.inner_text('#messages'),'| requests:',n['c'])
        n['c']=0; n['fail']=2; n['net']=True; pg.fill('#input','offline'); pg.click('#sendBtn'); pg.wait_for_function("!document.querySelector('#stopBtn').classList.contains('hidden')"); idle(pg)
        txt=pg.inner_text('#messages'); print(mode,'network drops twice then ok -> reply shown:',txt.count('Mock')>=2,'| error shown:','Error' in txt.split('offline')[-1],'| requests:',n['c'])
        n['net']=False
    b.close()
