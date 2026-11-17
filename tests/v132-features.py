from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(500)
        vis=lambda: not pg.eval_on_selector('#sheet','e=>e.classList.contains("hidden")')
        g=pg.locator('#sheetGrip').bounding_box(); x=g['x']+g['width']/2; y=g['y']+g['height']/2
        # short drag: comes back
        pg.mouse.move(x,y); pg.mouse.down(); pg.mouse.move(x,y+40,steps=5)
        mid=pg.eval_on_selector('.sheet-card','e=>e.style.transform'); pg.mouse.up(); pg.wait_for_timeout(500)
        print(mode,'short drag transform:',mid,'| still open:',vis()); assert vis() and 'translateY(40' in mid
        assert pg.eval_on_selector('.sheet-card','e=>e.style.transform')==''
        # drag on title bar, far: closes
        t=pg.locator('#sheetTitle').bounding_box(); tx=t['x']+20; ty=t['y']+t['height']/2
        pg.mouse.move(tx,ty); pg.mouse.down(); pg.mouse.move(tx,ty+300,steps=8); pg.mouse.up(); pg.wait_for_timeout(600)
        print(mode,'far drag -> open:',vis()); assert not vis()
        assert pg.eval_on_selector('.sheet-card','e=>e.style.transform')==''
        # buttons still work after
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(400); assert vis()
        pg.click('#sheetClose'); pg.wait_for_timeout(300); assert not vis()
        # scroll in body is unaffected: drag inside body does not close
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(400)
        bb=pg.locator('#sheetBody').bounding_box(); pg.mouse.move(bb['x']+50,bb['y']+100); pg.mouse.down(); pg.mouse.move(bb['x']+50,bb['y']+400,steps=6); pg.mouse.up(); pg.wait_for_timeout(400)
        print(mode,'body drag keeps open:',vis()); assert vis()
        print(mode,errs); pg.context.close()
    b.close()
