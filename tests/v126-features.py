from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        # quiet toasts
        pg.evaluate("window.__toast('Token saved')"); pg.wait_for_timeout(300)
        quiet=pg.eval_on_selector('#toast','e=>e.classList.contains("hidden")||!e.classList.contains("show")')
        pg.evaluate("window.__toast('Could not open the folder')"); pg.wait_for_timeout(400)
        err_shown=pg.eval_on_selector('#toast','e=>e.classList.contains("show")')
        print(mode,'quiet hides Token saved:',quiet,'| error still shown:',err_shown); assert quiet and err_shown
        # clone repo -> git sheet
        pg.click('#topFolderBtn'); pg.click('#pClone'); pg.wait_for_selector('#cUrl')
        pg.fill('#cUrl','http://127.0.0.1:4020/remote.git'); pg.fill('#cTok','tok'); pg.click('#cGo')
        pg.wait_for_selector('#gPull',timeout=30000); pg.wait_for_timeout(500)
        # suggest with no model
        pg.click('[data-tab=changes]') if pg.query_selector('[data-tab=changes]') else None
        pg.evaluate("document.querySelector('#gMessage')||0")
        if pg.query_selector('#gSuggest'):
            dim=pg.eval_on_selector('#gSuggest','e=>e.classList.contains("dim")'); pg.click('#gSuggest'); pg.wait_for_timeout(300)
            print(mode,'suggest dim:',dim,'| hint:',pg.inner_text('#gHint')); assert dim and 'Connect a model' in pg.inner_text('#gHint')
        else: print(mode,'(no changes, suggest not shown)')
        # history
        pg.click('[data-tab=history]'); pg.wait_for_timeout(400)
        print(mode,'history tail:',pg.inner_text('#sheetBody')[-120:].replace('\n',' | '))
        pg.screenshot(path=f'shots/v126-hist-{mode}.png')
        pg.click('#sheetClose'); pg.wait_for_timeout(200)
        # settings: notifications seg + termux setup
        pg.click('#menuBtn') if pg.query_selector('#menuBtn') else None
        print(mode,errs); pg.context.close()
    b.close()
