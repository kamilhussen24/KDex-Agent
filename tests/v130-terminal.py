from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
        pg.click('#chipTerm'); pg.wait_for_timeout(500)
        if pg.query_selector('#tSeg [data-v="1"]'): pg.click('#tSeg [data-v="1"]'); pg.wait_for_timeout(500)
        t=pg.inner_text('#sheetBody'); print(mode,'Allow/Never:', 'Allow' in t and 'Never' in t and 'Use my Git token in Termux' in t, '| Lend gone:', 'Lend' not in t)
        assert 'Allow' in t and 'Lend' not in t
        pg.eval_on_selector('#sheetBody','e=>e.scrollTop=e.scrollHeight*0.2'); pg.wait_for_timeout(200)
        pg.screenshot(path=f'shots/v130-term-{mode}.png'); print(mode,errs); pg.context.close()
    b.close()
