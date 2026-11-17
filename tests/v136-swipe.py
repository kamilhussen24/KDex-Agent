from playwright.sync_api import sync_playwright
def swipe(pg, cdp, x0, y0, x1, y1, steps=8, dt=12):
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}]})
    for i in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + (x1 - x0) * i / steps, 'y': y0 + (y1 - y0) * i / steps}]}); pg.wait_for_timeout(dt)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); pg.wait_for_timeout(450)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 360, 'height': 740}, has_touch=True, is_mobile=True, device_scale_factor=2)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    cdp = ctx.new_cdp_session(pg)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
    op = lambda: pg.eval_on_selector('#drawer', 'e=>e.classList.contains("open")')
    # drawer: swipe left from the middle of the list area closes it
    pg.click('#menuBtn'); pg.wait_for_timeout(400); assert op()
    swipe(pg, cdp, 200, 300, 60, 310); print('drawer after left swipe open:', op()); assert not op()
    # short swipe springs back
    pg.click('#menuBtn'); pg.wait_for_timeout(400)
    swipe(pg, cdp, 200, 300, 170, 305); print('short swipe stays open:', op()); assert op()
    # vertical swipe does not close
    swipe(pg, cdp, 200, 300, 200, 500); assert op()
    swipe(pg, cdp, 200, 500, 40, 500); assert not op()
    # sheet: swipe down from the body closes it
    pg.click('#menuBtn'); pg.wait_for_timeout(300); pg.click('#dSettings'); pg.wait_for_selector('#sheet:not(.hidden)'); pg.wait_for_timeout(300)
    swipe(pg, cdp, 180, 400, 180, 640); hid = pg.eval_on_selector('#sheet', 'e=>e.classList.contains("hidden")'); print('sheet closed by body swipe down:', hid); assert hid
    print('errors:', errs); assert not errs
    b.close()
