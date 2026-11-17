from playwright.sync_api import sync_playwright
W=360
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':W,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append('PAGEERR '+str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.screenshot(path=f'shots/n-{mode}-1-setup.png')
        print(mode,'presets:',[x.inner_text() for x in pg.query_selector_all('.pgrid .btn')])
        pg.click('[data-p=custom]'); pg.wait_for_timeout(150); pg.screenshot(path=f'shots/n-{mode}-2-custom.png')
        pg.evaluate("document.querySelector('#sSkip').scrollIntoView()"); pg.wait_for_timeout(100); pg.screenshot(path=f'shots/n-{mode}-3-skip.png')
        pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn'); pg.wait_for_timeout(300)
        # git without a model: open folder, clone flow
        pg.click('#topFolderBtn'); pg.click('#pClone'); pg.wait_for_selector('#cUrl'); pg.screenshot(path=f'shots/n-{mode}-4-clone.png')
        pg.fill('#cUrl','http://127.0.0.1:4020/remote.git'); pg.fill('#cTok','tok'); pg.click('#cGo')
        pg.wait_for_selector('#chipGit',timeout=30000); pg.wait_for_selector('[data-tab=changes]',timeout=30000); pg.wait_for_timeout(500)
        print(mode,'folder chip:',pg.inner_text('#chipFolderName'),'| branch chip:',pg.inner_text('#chipGitLbl'))
        pg.screenshot(path=f'shots/n-{mode}-5-cloned.png')
        pg.click('[data-tab=remote]'); pg.wait_for_selector('#gRemote'); print(mode,'remote tab:',pg.inner_text('#sheetBody')[:160].replace('\n',' | '))
        pg.click('#sheetClose')
        # chat with no model
        pg.fill('#input','hi'); pg.click('#sendBtn'); pg.wait_for_selector('#nmNotice'); pg.screenshot(path=f'shots/n-{mode}-6-nomodel.png')
        # terminal chip
        pg.click('#chipTerm'); pg.wait_for_selector('#tSeg'); pg.screenshot(path=f'shots/n-{mode}-7-term-off.png')
        print(mode,logs); pg.context.close()
    b.close()
