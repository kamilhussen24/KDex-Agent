from playwright.sync_api import sync_playwright
idle = "document.querySelector('#stopBtn').classList.contains('hidden')"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    pg.fill('#input', 'v147page'); pg.click('#sendBtn'); pg.wait_for_function(idle); pg.wait_for_timeout(400)
    # Quiet: Auto toggle is silent
    pg.tap('#chipAuto'); pg.wait_for_timeout(700); print('Quiet: toast after chip tap:', pg.locator('#toast.show').count())
    # switch to All
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(300); pg.click('#setQuiet [data-v="0"]'); pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#sheetClose') && document.querySelector('#sheetClose').click()"); pg.wait_for_timeout(400)
    pg.tap('#chipAuto'); pg.wait_for_timeout(500)
    print('All: toast shown:', pg.locator('#toast.show').count(), repr(pg.inner_text('#toast')[:40]))
    pg.evaluate("window.__hit=0;document.addEventListener('click',()=>window.__hit++,true)")
    # tap the chip again: first touch should only dismiss the toast
    bx = pg.locator('#chipAuto').bounding_box()
    pg.touchscreen.tap(bx['x'] + 10, bx['y'] + 10); pg.wait_for_timeout(300)
    print('1st touch: toast gone', pg.locator('#toast.show').count() == 0, '| app clicks seen', pg.evaluate('window.__hit'))
    pg.touchscreen.tap(bx['x'] + 10, bx['y'] + 10); pg.wait_for_timeout(500)
    print('2nd touch works: toast again', pg.locator('#toast.show').count())
    pg.screenshot(path='/tmp/kt/shots/v1481-toast.png')
    print('errors:', errs); b.close()
