SH = '/tmp/kt/shots/'
from playwright.sync_api import sync_playwright
idle = "document.querySelector('#stopBtn').classList.contains('hidden')"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); cdp = ctx.new_cdp_session(pg)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    vis = lambda s: pg.locator(s + ':not(.hidden)').count() == 1
    print('Auto chip hidden, no files:', not vis('#chipAuto'))
    pg.fill('#input', 'v147page'); pg.click('#sendBtn'); pg.wait_for_function(idle); pg.wait_for_timeout(400)
    print('Scratch + Auto chips visible after file:', vis('#chipScratch'), vis('#chipAuto'))
    pg.screenshot(path=SH + 'v1481-chips.png')
    # ---- applyFolder offers to move Scratch files
    pg.tap('#chipFolder'); pg.wait_for_timeout(500)
    pg.get_by_text('Open a folder...').first.tap(); pg.wait_for_selector('#dialog:not(.hidden)', timeout=6000)
    print('offer:', pg.inner_text('#dlgTitle'), '|', pg.inner_text('#dlgNo').strip(), '|', pg.inner_text('#dlgYes').strip(), '| alt hidden:', pg.locator('#dlgAlt.hidden').count() == 1)
    pg.screenshot(path=SH + 'v1481-offer.png')
    pg.click('#dlgNo'); pg.wait_for_timeout(500)
    print('Not now keeps scratch:', pg.evaluate("(async()=>{const S=await import('./js/scratch.js');return (await S.scratchUsage()).length})()"), '| Cancel label restored:', pg.inner_text('#dlgNo').strip())
    # remove folder, add again, this time Move
    pg.tap('#chipFolder'); pg.wait_for_timeout(500)
    pg.get_by_text('New chat without a folder').first.tap(); pg.wait_for_timeout(500)
    print('no-folder new chat has no scratch chip:', pg.locator('#chipScratch.hidden').count() == 1)
    pg.wait_for_timeout(4500)  # the app ignores the same text sent twice within 4 seconds
    pg.fill('#input', 'v147page'); pg.click('#sendBtn'); pg.wait_for_function(idle); pg.wait_for_timeout(400)
    pg.tap('#chipFolder'); pg.wait_for_timeout(500); pg.get_by_text('Open a folder...').first.tap(); pg.wait_for_selector('#dialog:not(.hidden)')
    pg.click('#dlgYes'); pg.wait_for_timeout(900)
    print('after Move: scratch chip hidden:', pg.locator('#chipScratch.hidden').count() == 1, '| toast:', pg.inner_text('#toast').replace('\n', ' ')[:90])
    print('scratch left:', pg.evaluate("(async()=>{const S=await import('./js/scratch.js');return (await S.scratchUsage()).length})()"))
    # ---- toast: first touch only dismisses
    pg.wait_for_timeout(300)
    pg.evaluate("window.__hit=0;document.addEventListener('click',()=>window.__hit++)")
    pg.tap('#chipFolder'); pg.wait_for_timeout(700)
    print('projects sheet open:', pg.locator('#sheet:not(.hidden)').count() + pg.locator('#sheetBody').count() > 0)
    pg.get_by_text('Open a folder...').first.tap(); pg.wait_for_timeout(900)
    print('toast visible:', pg.locator('#toast.show').count())
    pg.touchscreen.tap(180, 400); pg.wait_for_timeout(250)
    print('1st touch: toast gone:', pg.locator('#toast.show').count() == 0)
    # ---- long press menu closes with one tap
    for hold, gap in [(600, 300), (900, 250), (2000, 100)]:
        pg.tap('#menuBtn'); pg.wait_for_selector('.chat-item'); pg.wait_for_timeout(600)
        bx = pg.locator('.chat-item').first.bounding_box(); x, y = bx['x'] + 80, bx['y'] + bx['height'] / 2
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]}); pg.wait_for_timeout(hold)
        opened = pg.locator('#rowMenu').count() == 1
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); pg.wait_for_timeout(gap)
        stay = pg.locator('#rowMenu').count() == 1
        pg.touchscreen.tap(300, 690); pg.wait_for_timeout(500)
        print('hold', hold, 'gap', gap, '| opened', opened, '| still open before tap', stay, '| open after 1 tap', pg.locator('#rowMenu').count() == 1)
        if pg.locator('#rowMenu').count(): pg.touchscreen.tap(300, 690); pg.wait_for_timeout(500)
        pg.evaluate("document.querySelector('#scrim') && document.querySelector('#scrim').click()"); pg.wait_for_timeout(400)
    print('errors:', errs)
    b.close()
