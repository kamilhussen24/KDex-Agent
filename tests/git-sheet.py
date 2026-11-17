from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn'); pg.click('#topFolderBtn'); pg.click('#pClone'); pg.wait_for_selector('#cUrl')
        pg.fill('#cUrl','http://127.0.0.1:4020/remote.git'); pg.fill('#cTok','tok'); pg.click('#cGo')
        pg.wait_for_selector('#gPull',timeout=30000); pg.wait_for_timeout(400)
        for b_ in ('#gFetch','#gPush','#gFetch'):
            pg.click(b_); pg.wait_for_timeout(2500); print(pg.inner_text('#sheet')[:200].replace('\n',' | ')); pg.wait_for_selector('#gPull',timeout=20000)
            print(mode,b_,'close disabled:',pg.eval_on_selector('#sheetClose','e=>e.disabled'))
        pg.click('[data-tab=history]'); pg.wait_for_timeout(300)
        pg.click('#sheetClose'); pg.wait_for_timeout(300)
        print(mode,'sheet hidden:',pg.eval_on_selector('#sheet','e=>e.classList.contains("hidden")'),logs)
        pg.screenshot(path=f'shots/x-{mode}.png',clip={'x':0,'y':560,'width':360,'height':180})
        pg.context.close()
    b.close()
