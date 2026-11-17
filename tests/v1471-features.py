SH = '/tmp/kt/shots/'
from playwright.sync_api import sync_playwright
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')", timeout=20000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    cdp = ctx.new_cdp_session(pg)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
    pg.fill('#input', 'v145multi'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]', timeout=10000); 
    for _ in range(8):
        pg.wait_for_timeout(700)
        if pg.evaluate("document.querySelector('#stopBtn').classList.contains('hidden')"): break
        if pg.locator('#approveAll:visible').count(): pg.click('#approveAll')
        elif pg.locator('[data-tool=apply]:visible').count(): pg.click('[data-tool=apply] >> nth=-1')
    idle(pg)
    pg.fill('#input', 'v147page'); pg.click('#sendBtn'); idle(pg)
    pg.tap('#menuBtn'); pg.wait_for_selector('.chat-item'); pg.wait_for_timeout(500)
    bx = pg.locator('.chat-item').first.bounding_box(); x, y = bx['x'] + 80, bx['y'] + bx['height'] / 2
    def touch(hold, move=0, cancel_mid=False):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        pg.wait_for_timeout(hold // 2)
        if cancel_mid: pg.evaluate("document.querySelector('.chat-item').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerType:'touch'}))")
        if move: cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y + move}]})
        pg.wait_for_timeout(hold // 2)
    touch(900); print('touch hold opens menu:', pg.locator('#rowMenu').count()); pg.screenshot(path=SH + 'v1471-menu.png')
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); pg.wait_for_timeout(400)
    print('menu survives release:', pg.locator('#rowMenu').count(), '| drawer open:', pg.evaluate("document.querySelector('#drawer').classList.contains('open')"))
    pg.mouse.click(300, 700); pg.wait_for_timeout(300); print('outside tap closes:', pg.locator('#rowMenu').count() == 0)
    touch(900, cancel_mid=True); print('system pointercancel mid-press still opens:', pg.locator('#rowMenu').count())
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); pg.wait_for_timeout(300); pg.mouse.click(300, 700); pg.wait_for_timeout(300)
    touch(600, move=40); cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); pg.wait_for_timeout(300); print('moving cancels:', pg.locator('#rowMenu').count() == 0)
    pg.evaluate("document.querySelector('.chat-item').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:80}))"); pg.wait_for_timeout(200)
    print('contextmenu alone opens:', pg.locator('#rowMenu').count()); pg.wait_for_timeout(900); pg.mouse.click(300, 700); pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#scrim').click()"); pg.wait_for_timeout(300)
    # Changes screen
    print('dbg:', pg.evaluate("[document.querySelector('#chipChanges').className, document.querySelector('#drawer').className, !!document.querySelector('#rowMenu'), getComputedStyle(document.querySelector('#chipChanges')).display]"))
    pg.tap('#chipChanges'); pg.wait_for_selector('[data-u]'); pg.wait_for_timeout(300)
    print('undo btn widths:', pg.evaluate("[...document.querySelectorAll('[data-u]')].map(b=>Math.round(b.getBoundingClientRect().width))")); pg.screenshot(path=SH + 'v1471-changes.png'); pg.tap('#sheetClose'); pg.wait_for_timeout(300)
    # chip row
    w = lambda: pg.evaluate("[...document.querySelectorAll('#ctxBar .chip')].map(c=>[Math.round(c.getBoundingClientRect().left),Math.round(c.getBoundingClientRect().width),Math.round(c.querySelector('svg').getBoundingClientRect().left)])")
    a1 = w(); pg.tap('#chipAuto'); pg.wait_for_timeout(300); a2 = w(); print('auto chip label/on/icon:', pg.inner_text('#chipAuto'), pg.evaluate("[document.querySelector('#chipAuto').classList.contains('on'),document.querySelector('#chipAuto use').getAttribute('href')]"), '| toast shown in Quiet:', pg.evaluate("document.querySelector('#toast').classList.contains('show')"), pg.inner_text('#toast')[:70].replace(chr(10),' '))
    print('chip rel-x same (icon fixed, label fixed):', [c[0]-a1[0][0] for c in a1] == [c[0]-a2[0][0] for c in a2]); print('chip row before/after:', a1, a2, '| same:', [c[:2] for c in a1] == [c[:2] for c in a2], '| auto icon x same:', a1[1][2] == a2[1][2] if len(a1) > 1 else '?')
    # identity prompt
    print('identity text:', pg.evaluate("(async()=>{const A=await import('./js/agent.js');return 0})()") )
    print('errors:', errs); b.close()
