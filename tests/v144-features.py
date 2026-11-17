from playwright.sync_api import sync_playwright
HTML="<html><head><title>T</title></head><body><main><h1>Hello</h1><p>page text</p></main></body></html>"
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=12000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        ctx=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode); pg=ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        def h(route):
            u=route.request.url
            if 'gone.example.com' in u: return route.fulfill(status=404,body='nope')
            return route.fulfill(status=200,content_type='text/html',body=HTML)
        ctx.route('https://*.example.com/**',h); ctx.route('https://*.example.org/**',h)
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached')
        pg.fill('#input','webtest https://a.example.com/one'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000)
        print(mode,'pending card:',pg.inner_text('.wcard').replace('\n',' / '),'| bar:',pg.inner_text('#approveBar').replace('\n',' / '))
        pg.screenshot(path=f'shots/v144-{mode}-pending.png'); pg.click('[data-tool=apply]'); idle(pg)
        print(mode,'done card:',pg.inner_text('.wcard').replace('\n',' / ')[:120])
        pg.fill('#input','webtest https://b.example.com/two'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000)
        print(mode,'2nd ask has tip:',pg.locator('[data-tool=allweb]').count()); pg.click('[data-tool=apply]'); idle(pg)
        pg.fill('#input','webtest https://c.example.com/three'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000)
        print(mode,'3rd ask tip:',pg.locator('.wtip').inner_text().replace('\n',' '),'| button:',pg.inner_text('[data-tool=allweb]'))
        pg.screenshot(path=f'shots/v144-{mode}-tip.png'); pg.click('[data-tool=allweb]'); idle(pg)
        pg.fill('#input','webtest https://d.example.org/four'); pg.click('#sendBtn'); idle(pg)
        print(mode,'4th (other host) pending approvals:',pg.locator('[data-tool=apply]').count(),'| last card:',pg.locator('.wcard').last.inner_text().replace('\n',' / ')[:90])
        pg.fill('#input','webtest https://gone.example.com/zzz'); pg.click('#sendBtn'); idle(pg)
        print(mode,'failed card:',pg.locator('.wcard').last.inner_text().replace('\n',' / ')[:140]); pg.screenshot(path=f'shots/v144-{mode}-fail.png')
        # new chat: counter starts again
        pg.evaluate("document.querySelector('#dNew').click()"); pg.wait_for_timeout(300); pg.fill('#input','webtest https://e.example.com/a'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000)
        print(mode,'new chat asks again, no tip:',pg.locator('.wtip').count()==0); pg.click('[data-tool=reject]'); idle(pg)
        print(mode,'rejected card:',pg.locator('.wcard').last.inner_text().replace('\n',' / ')[:80])
        # ring dialog text
        pg.fill('#input','filetest'); pg.click('#sendBtn'); idle(pg); pg.click('#ctxBtn'); pg.wait_for_selector('#dialog:not(.hidden)')
        print(mode,'ring dialog:',pg.inner_text('#dlgTitle'),'|',pg.inner_text('#dlgText')); pg.screenshot(path=f'shots/v144-{mode}-ring.png')
        print(mode,'errors:',errs)
    b.close()
