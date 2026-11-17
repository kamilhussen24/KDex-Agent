from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.click('#topFolderBtn'); pg.click('#pClone'); pg.wait_for_selector('#cUrl'); pg.fill('#cUrl','http://127.0.0.1:4020/remote.git'); pg.fill('#cTok','tok'); pg.click('#cGo')
        pg.wait_for_selector('#gPull',timeout=30000); pg.click('#sheetClose'); pg.wait_for_timeout(300)
        pg.click('#chipTerm'); pg.wait_for_timeout(500)
        pg.click('#tSeg [data-v="1"]'); pg.wait_for_selector('#tmTest'); pg.wait_for_timeout(300)
        t=pg.inner_text('#termBox'); print(mode,'auto ->','Detected automatically' in t or 'not detected' in t.lower(), '| Change path gone:', 'Change path' not in t)
        assert 'Change path' not in t
        pg.screenshot(path=f'shots/v132-term-{mode}.png')
        pg.click('#tmPath'); pg.wait_for_timeout(300)
        pg.fill('#dlgInput','/storage/emulated/0/Demo/App'); pg.click('#dlgYes'); pg.wait_for_timeout(500)
        t=pg.inner_text('#termBox'); print(mode,'custom ->','Set by you' in t, 'Reset' in t); assert 'Set by you' in t and 'Reset' in t
        pg.screenshot(path=f'shots/v132-term2-{mode}.png')
        pg.click('#tmReset'); pg.wait_for_timeout(500); t=pg.inner_text('#termBox'); print(mode,'reset ->','Set by you' not in t); assert 'Set by you' not in t
        print(mode,errs); pg.context.close()
    b.close()
