SH = '/tmp/kt/shots/'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect')
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#setOut'); pg.wait_for_timeout(300)
    act = lambda: pg.evaluate("[...document.querySelectorAll('#setOut button')].map(b=>[b.dataset.v,b.className.includes('on')||b.getAttribute('aria-pressed')==='true'])")
    print('options:', act())
    hh = pg.evaluate("[...document.querySelectorAll('#setOut button')].map(b=>[b.innerText.trim(), Math.round(b.getBoundingClientRect().height), Math.round(b.getBoundingClientRect().width)])")
    print('buttons (label, height, width):', hh); assert len(set(x[1] for x in hh)) == 1 and hh[0][1] <= 48 and max(x[2] for x in hh) - min(x[2] for x in hh) <= 2
    pg.locator('#setOut [data-v=off]').scroll_into_view_if_needed(); pg.screenshot(path=SH + 'v1496-setting.png')
    pg.click('#setOut [data-v=all]'); pg.wait_for_timeout(300)
    v = pg.evaluate("import('/js/db.js').then(m=>m.kvGet('settings',{})).then(x=>x.outsideAsk)")
    print('saved outsideAsk:', v); assert v == 'all'
    print('errs:', errs); assert not errs
    b.close()
