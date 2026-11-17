# v1.52.22: Settings > Images shows the model box only when a provider is chosen; the model name is kept when switched off.
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); res = {}; errs = []
    pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page()
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(15000)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(2600)
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#setImgProv')
    vis = lambda s: pg.evaluate(f"(()=>{{const e=document.querySelector('{s}');return !!e&&e.getBoundingClientRect().height>0}})()")
    res['off: model box hidden'] = not vis('#imgMore')
    res['off: hint shown'] = vis('#imgOff')
    pg.locator('#setImgProv').scroll_into_view_if_needed(); pg.screenshot(path='/tmp/kt/shots/v15222-off.png')
    val = pg.evaluate("[...document.querySelectorAll('#setImgProv option')].map(o=>o.value).filter(Boolean)[0]")
    res['has a provider to pick'] = bool(val)
    pg.select_option('#setImgProv', val)
    res['on: model box shown'] = vis('#imgMore') and not vis('#imgOff')
    pg.fill('#setImgModel', 'gpt-image-1'); pg.dispatch_event('#setImgModel', 'change')
    pg.locator('#setImgProv').scroll_into_view_if_needed(); pg.screenshot(path='/tmp/kt/shots/v15222-on.png')
    pg.select_option('#setImgProv', ''); pg.wait_for_timeout(200)
    res['off again: hidden'] = not vis('#imgMore') and vis('#imgOff')
    res['model name kept'] = pg.evaluate("import('./js/agent.js').then(m=>m.getSettings()).then(s=>s.imageModel)") == 'gpt-image-1'
    pg.select_option('#setImgProv', val)
    res['back on: name restored'] = pg.input_value('#setImgModel') == 'gpt-image-1'
    print(*[f'{k} => {v}' for k, v in res.items()], sep='\n')
    ok = all(res.values()) and not errs
    print('PASS' if ok else 'FAIL', errs); b.close(); assert ok
