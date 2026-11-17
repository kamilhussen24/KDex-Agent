from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for sysmode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},color_scheme=sysmode).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#dSettings',state='attached')
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#setTheme')
        out=[]
        for v in ('dark','light','system','dark','system','light'):
            pg.click(f'#setTheme [data-v={v}]'); pg.wait_for_timeout(60)
            out.append((v,pg.evaluate("document.documentElement.dataset.theme"),pg.evaluate("getComputedStyle(document.documentElement).colorScheme")))
        print('system',sysmode,out,logs)
        pg.context.close()
    b.close()
