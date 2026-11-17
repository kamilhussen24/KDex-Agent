from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(400)
        w=lambda s: pg.eval_on_selector(s,'e=>Math.round(e.getBoundingClientRect().width*10)/10')
        a1=w('#chipAuto'); t1=w('#chipTerm'); l1=pg.inner_text('#chipAutoLbl')
        pg.click('#chipAuto'); pg.wait_for_timeout(300)
        a2=w('#chipAuto'); l2=pg.inner_text('#chipAutoLbl')
        print(mode,'Auto chip widths:',l1,a1,'->',l2,a2,'| Terminal chip:',t1); assert a1==a2
        # terminal chip both labels
        pg.evaluate("document.querySelector('#chipTermLbl').textContent='Terminal on'"); t2=w('#chipTerm'); pg.evaluate("document.querySelector('#chipTermLbl').textContent='Terminal'"); t3=w('#chipTerm')
        print(mode,'terminal widths on/off:',t2,t3); assert t2==t3
        pg.screenshot(path=f'shots/v129-chips-{mode}.png',clip={'x':0,'y':0,'width':360,'height':140})
        print(mode,errs); pg.context.close()
    b.close()
