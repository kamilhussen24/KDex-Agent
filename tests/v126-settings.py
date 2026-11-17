from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#setQuiet,[data-seg=setQuiet]',timeout=5000) if False else pg.wait_for_timeout(600)
        txt=pg.inner_text('#sheetBody'); print(mode,'Notifications row:','Notifications' in txt and 'Quiet' in txt)
        assert 'Notifications' in txt
        pg.click('#setQuiet [data-v="0"]'); pg.wait_for_timeout(200)
        pg.evaluate("window.__toast('Token saved')"); pg.wait_for_timeout(300)
        print(mode,'All mode shows Token saved:',pg.eval_on_selector('#toast','e=>e.classList.contains("show")'))
        # termux on, setup card
        pg.click('#setTerm [data-v="1"]'); pg.wait_for_selector('.card.tmsetup'); pg.wait_for_timeout(200)
        print(mode,'cmd boxes:',pg.eval_on_selector_all('pre.cmd','e=>e.map(x=>x.innerText+" | h="+x.getBoundingClientRect().height)'))
        pg.eval_on_selector('.card.tmsetup','e=>e.scrollIntoView()')
        pg.screenshot(path=f'shots/v126-set-{mode}.png')
        print(mode,errs); pg.context.close()
    b.close()
