# v1.51.2: a Continue button under the "I stopped" notes sends "continue" in one tap.
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); res = {}; errs = []
    pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page()
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(12000)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(2600)
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
    pg.fill('#input', 'v145loop'); pg.click('#sendBtn'); pg.wait_for_selector('.controw [data-act=cont]', timeout=20000)
    pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')"); pg.wait_for_timeout(300)
    res['one button'] = pg.locator('.controw').count() == 1
    res['label'] = pg.inner_text('.controw .btn').strip() == 'Continue'
    pg.screenshot(path='/tmp/kt/shots/v1512-continue.png')
    pg.click('.controw [data-act=cont]'); pg.wait_for_function("document.body.innerText.includes('Mock')", timeout=15000)
    pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')"); pg.wait_for_timeout(300)
    res['button gone after tap'] = pg.locator('.controw').count() == 0
    res['continue sent as message'] = pg.evaluate("[...document.querySelectorAll('.msg.user')].some(m=>m.innerText.trim()=='continue')")
    print(*[f'{k} => {v}' for k, v in res.items()], sep='\n')
    ok = all(res.values()) and not errs
    print('PASS' if ok else 'FAIL', errs); b.close(); assert ok
