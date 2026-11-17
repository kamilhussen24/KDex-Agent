SH = '/tmp/kt/shots/'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); cdp = ctx.new_cdp_session(pg)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
    # Auto chip: both states
    print('off:', repr(pg.inner_text('#chipAuto')), pg.get_attribute('#chipAuto use', 'href'), pg.get_attribute('#chipAuto', 'aria-pressed'))
    w0 = pg.evaluate("Math.round(document.querySelector('#chipAuto').getBoundingClientRect().width)"); x0 = pg.evaluate("Math.round(document.querySelector('#chipAuto svg').getBoundingClientRect().left-document.querySelector('#chipAuto').getBoundingClientRect().left)")
    pg.screenshot(path=SH + 'v1473-off.png', clip={'x': 0, 'y': 90, 'width': 360, 'height': 60})
    pg.tap('#chipAuto'); pg.wait_for_timeout(400)
    print('on:', repr(pg.inner_text('#chipAuto')), pg.get_attribute('#chipAuto use', 'href'), pg.get_attribute('#chipAuto', 'aria-pressed'), '| toast:', pg.inner_text('#toast').replace('\n', ' ')[:90])
    w1 = pg.evaluate("Math.round(document.querySelector('#chipAuto').getBoundingClientRect().width)"); x1 = pg.evaluate("Math.round(document.querySelector('#chipAuto svg').getBoundingClientRect().left-document.querySelector('#chipAuto').getBoundingClientRect().left)")
    print('width off/on:', w0, w1, '| icon offset off/on:', x0, x1)
    pg.screenshot(path=SH + 'v1473-on.png', clip={'x': 0, 'y': 90, 'width': 360, 'height': 60})
    # menu closes on first touch after long press
    pg.fill('#input', 'v147page'); pg.click('#sendBtn'); pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')"); pg.wait_for_timeout(300)
    pg.tap('#menuBtn'); pg.wait_for_selector('.chat-item'); pg.wait_for_timeout(500)
    bx = pg.locator('.chat-item').first.bounding_box(); x, y = bx['x'] + 80, bx['y'] + bx['height'] / 2
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]}); pg.wait_for_timeout(900)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); pg.wait_for_timeout(1000)
    print('menu open:', pg.locator('#rowMenu').count())
    pg.touchscreen.tap(300, 690); pg.wait_for_timeout(120)
    print('menu gone right after ONE touch:', pg.locator('#rowMenu').count() == 0, '| scrim left briefly:', pg.locator('#rowScrim').count()); pg.wait_for_timeout(600)
    print('scrim removed after:', pg.locator('#rowScrim').count() == 0, '| drawer still open (tap did not hit chat):', pg.evaluate("document.querySelector('#drawer').classList.contains('open')"))
    # dots menu closes with one tap too
    pg.tap('[data-menu]'); pg.wait_for_selector('#rowMenu'); pg.wait_for_timeout(300); pg.touchscreen.tap(300, 690); pg.wait_for_timeout(150); print('dots menu closes with one tap:', pg.locator('#rowMenu').count() == 0)
    pg.wait_for_timeout(600); pg.evaluate("document.querySelector('#scrim').click()"); pg.wait_for_timeout(300)
    # git tabs
    pg.evaluate("""async(f)=>{const G=await import('./js/git.js');await G.saveGitSettings({name:'T',email:'t@example.com'});await G.init(f)}""", pg.evaluate("(async()=>{const D=await import('./js/db.js');const fo=await D.kvGet('folders',[]);return fo[fo.length-1]})()"))
    pg.tap('#chipGit'); pg.wait_for_selector('#sheetTabs .tab'); pg.wait_for_timeout(500)
    print('tabs:', pg.evaluate("[...document.querySelectorAll('#sheetTabs .tab')].map(t=>[t.textContent,Math.round(t.getBoundingClientRect().left),Math.round(t.getBoundingClientRect().right)])"), '| card edges:', pg.evaluate("(()=>{const c=document.querySelector('#sheetBody .card');if(!c)return null;const r=c.getBoundingClientRect();return [Math.round(r.left),Math.round(r.right)]})()"))
    pg.screenshot(path=SH + 'v1473-tabs.png'); print('errors:', errs); b.close()
