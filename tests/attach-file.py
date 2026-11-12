from playwright.sync_api import sync_playwright
import os
HOOK="window.__kdexTermux=async(o)=>({stdout:'ok\\n',stderr:'',exitCode:0});"
def idle(pg): pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=12000); pg.wait_for_timeout(300)
open('/tmp/BSC.py','w').write('#!/usr/bin/env python3\n'+'print("long line of code")\n'*200)
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('dark','light'):
        ctx=b.new_context(viewport={'width':360,'height':740},device_scale_factor=1.5,color_scheme=mode,accept_downloads=True); pg=ctx.new_page(); errs=[]; reqs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('request',lambda r: reqs.append(r.post_data or '') if 'chat/completions' in r.url else None)
        pg.add_init_script(HOOK); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
        pg.set_input_files('#fileInput','/tmp/BSC.py'); pg.fill('#input','check this please'); pg.click('#sendBtn'); idle(pg)
        h=pg.evaluate("document.querySelector('.msg.user').getBoundingClientRect().height")
        print(mode,'user message height px:',round(h),'| bubble text:',pg.inner_text('.msg.user .bubble'),'| file card:',pg.inner_text('.msg.user .ufile').replace('\n',' '))
        print(mode,'model got file content:', any('long line of code' in r for r in reqs))
        pg.screenshot(path=f'shots/f/{mode}-attach.png')
        with pg.expect_download(timeout=5000) as d: pg.click('.msg.user .ufile')
        print(mode,'saved back:',d.value.suggested_filename,'| errs',errs)
    b.close()
