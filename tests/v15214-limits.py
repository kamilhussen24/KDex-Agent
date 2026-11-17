from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    src=pg.evaluate("fetch('/js/agent.js').then(r=>r.text())")
    for needle in ['up to 6000 characters, read fresh','t.length > 6000','at most 650 words','maxTokens: 1300']:
        print(needle, needle in src); assert needle in src
    assert 'at most 450 words' not in src and 't.length > 4000' not in src
    r=None
    print(r, errs); print('PASS')
