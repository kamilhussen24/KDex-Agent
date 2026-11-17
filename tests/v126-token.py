from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(500); pg.click('#gitId'); pg.wait_for_selector('#tSave')
        pg.fill('#tTok','abc'); pg.click('#tSave'); pg.wait_for_timeout(300)
        print(mode,'short token ->',pg.inner_text('#tMsg'),'| still on identity:',pg.inner_text('#sheetTitle'))
        assert 'does not look' in pg.inner_text('#tMsg')
        pg.fill('#tTok','ghp_'+'demo_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); pg.click('#tSave'); pg.wait_for_timeout(500)
        print(mode,'valid token -> now on:',pg.inner_text('#sheetTitle'))
        assert pg.inner_text('#sheetTitle')=='Git identity and tokens' and 'github.com' in pg.inner_text('#sheetBody')
        assert pg.inner_text('#tSave')=='Replace token'
        pg.screenshot(path=f'shots/v131-ident-{mode}.png')
        pg.fill('#gName','Kam'); pg.fill('#gEmail','bad'); pg.click('#aSave'); assert 'does not look' in pg.inner_text('#aMsg')
        pg.fill('#gEmail','k@example.com'); pg.click('#aSave'); pg.wait_for_timeout(400); assert pg.inner_text('#sheetTitle')=='Settings'
        pg.click('#gitId'); pg.wait_for_selector('#tSave'); print(mode,'saved host listed:','github.com' in pg.inner_text('#sheetBody'),'Token saved' in pg.inner_text('#sheetBody'))
        print(mode,errs); pg.context.close()
    b.close()
