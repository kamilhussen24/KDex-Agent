from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.click('#topFolderBtn'); pg.click('#pClone'); pg.wait_for_selector('#cUrl'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'shots/v127-clone-{mode}.png')
        print(mode,'primary h:',pg.eval_on_selector('#cGo','e=>e.getBoundingClientRect().height'),'| seg on color:',pg.eval_on_selector_all('.seg .btn.on','e=>e.map(x=>getComputedStyle(x).color)'))
        print(mode,errs); pg.context.close()
    b.close()
