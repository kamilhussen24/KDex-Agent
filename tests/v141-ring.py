from playwright.sync_api import sync_playwright
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=15000); pg.wait_for_timeout(400)
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]; reqs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('request',lambda r: reqs.append(r.post_data or '') if 'chat/completions' in r.url else None)
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
        print(mode,'ring hidden on empty chat:', pg.evaluate("document.querySelector('#ctxBtn').classList.contains('hidden')"))
        pg.fill('#input','filetest'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=getfile]',timeout=8000); idle(pg)
        print(mode,'ring after reply:', not pg.evaluate("document.querySelector('#ctxBtn').classList.contains('hidden')"), '|', pg.get_attribute('#ctxBtn','aria-label'))
        # geometry: same size and vertical centre as the bulb button
        g=pg.evaluate("""()=>{const r=(s)=>{const e=document.querySelector(s).getBoundingClientRect();return [Math.round(e.width),Math.round(e.height),Math.round((e.top+e.bottom)/2*10)/10]};
          const ic=(s)=>{const e=document.querySelector(s+' svg').getBoundingClientRect();return [Math.round(e.width),Math.round((e.top+e.bottom)/2*10)/10]};
          return {bulb:r('#thinkBtn'),ring:r('#ctxBtn'),bulbIc:ic('#thinkBtn'),ringIc:ic('#ctxBtn')}}""")
        print(mode,'geometry',g)
        pg.screenshot(path=f'shots/ring-{mode}.png',clip={'x':0,'y':560,'width':360,'height':180})
        pg.click('#ctxBtn'); pg.wait_for_selector('#dialog:not(.hidden)'); print(mode,'dialog:',pg.inner_text('#dlgTitle'),'|',pg.inner_text('#dlgText')[:70],'|',pg.inner_text('#dlgYes'),'/',pg.inner_text('#dlgAlt'))
        pg.screenshot(path=f'shots/ring-{mode}-dlg.png')
        pg.click('#dlgAlt'); pg.wait_for_timeout(400)
        print(mode,'new chat hides ring:', pg.evaluate("document.querySelector('#ctxBtn').classList.contains('hidden')"))
        # context-full retry
        n0=len(reqs); pg.fill('#input','ctxtest hello'); pg.click('#sendBtn'); idle(pg)
        t=pg.inner_text('#messages'); print(mode,'requests for ctxtest:',len(reqs)-n0,'| error shown:', 'Error:' in t, '| got a reply:', 'ctxtest hello' in t and len(t)>30)
        print(mode,'errors:',errs)
    b.close()
