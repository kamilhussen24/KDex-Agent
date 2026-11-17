from playwright.sync_api import sync_playwright
SH = '/tmp/kt/shots/'
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')", timeout=20000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    # ---- 1. chat file card: eye button for html only
    pg.fill('#input', 'v147page'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=prevfile]', timeout=10000); idle(pg)
    print('card buttons:', [x.get_attribute('data-tool') for x in pg.query_selector_all('.tool .tf button')])
    r = pg.evaluate("(()=>{const b=document.querySelector('[data-tool=prevfile]').getBoundingClientRect();const d=document.querySelector('[data-tool=getfile]').getBoundingClientRect();return [Math.round(b.width),Math.round(d.right),innerWidth]})()")
    print('eye width / download right / viewport:', r)
    pg.locator('[data-tool=prevfile]').scroll_into_view_if_needed(); pg.screenshot(path=SH + 'v147-card.png')
    pg.click('[data-tool=prevfile]'); pg.wait_for_selector('#pv iframe'); pg.wait_for_timeout(600)
    fr = pg.frame_locator('#pv iframe')
    print('script ran:', fr.locator('#h').inner_text(), '| sandbox:', pg.get_attribute('#pv iframe', 'sandbox'))
    print('footer:', pg.inner_text('#pvF').replace('\n', ' | '))
    pg.screenshot(path=SH + 'v147-preview.png')
    pg.click('#pvR'); pg.wait_for_timeout(500); print('reload ok:', pg.locator('#pv iframe').count())
    pg.click('#pvX'); print('closed:', pg.locator('#pv').count() == 0)
    # non-html has no eye
    # ---- 2. Files screen: eye on html rows, viewer Preview button
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_timeout(600)
    if pg.locator('#dialog:not(.hidden)').count(): pg.click('#dlgNo'); pg.wait_for_timeout(300)  # v1.48.1: Move Scratch files? offer
    pg.wait_for_selector('#chipFiles'); pg.wait_for_timeout(300)
    f = pg.evaluate("(async()=>{const D=await import('./js/db.js');const fo=await D.kvGet('folders',[]);return fo[fo.length-1]})()")
    pg.evaluate("""async(f)=>{const N=await import('./js/native.js');
      await N.fs.writeText(f.uri,'site/index.html','<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1 id="t">Site</h1><img src="logo.png" alt="logo"><script src="app.js"></script></body></html>');
      await N.fs.writeText(f.uri,'site/style.css','h1{color:rgb(255,0,0)}');
      await N.fs.writeText(f.uri,'site/app.js','document.getElementById("t").textContent="Local JS ok"');
      await N.fs.writeBytes(f.uri,'site/logo.png',Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0)))}""", f)
    pg.click('#chipFiles'); pg.wait_for_selector('.row-item'); pg.click('[data-p=site]'); pg.wait_for_selector('[data-p="site/index.html"]')
    print('eye rows:', pg.locator('[data-pv]').count(), '| css/js rows have none:', pg.locator('[data-p="site/style.css"] [data-pv]').count() == 0)
    pg.click('[data-pv="site/index.html"]'); pg.wait_for_selector('#pv iframe'); pg.wait_for_timeout(700)
    fr = pg.frame_locator('#pv iframe')
    print('local js:', fr.locator('#t').inner_text(), '| css color:', fr.locator('#t').evaluate("e=>getComputedStyle(e).color"), '| img src data:', fr.locator('img').get_attribute('src')[:22])
    print('notes:', pg.inner_text('#pvF').replace('\n', ' | ')); pg.screenshot(path=SH + 'v147-site.png')
    print('sheet still open under:', pg.locator('#sheet:not(.hidden)').count()); pg.click('#pvX')
    pg.click('[data-p="site/index.html"]'); pg.wait_for_selector('#fvPrev'); pg.click('#fvPrev'); pg.wait_for_selector('#pv iframe'); print('viewer preview ok'); pg.click('#pvX')
    pg.click('#sheetClose'); pg.wait_for_timeout(300)
    # ---- 3. long press on chat row
    pg.click('#menuBtn'); pg.wait_for_selector('.chat-item'); pg.wait_for_timeout(400)
    n_before = pg.locator('.chat-item').count(); title = pg.locator('.chat-item .t').first.inner_text().split('\n')[0]
    box = pg.locator('.chat-item').first.bounding_box(); x, y = box['x'] + 80, box['y'] + box['height'] / 2
    def lp(x, y, hold=700, move=0):
        pg.mouse.move(x, y); pg.mouse.down(); pg.wait_for_timeout(hold // 2)
        if move: pg.mouse.move(x, y + move, steps=4)
        pg.wait_for_timeout(hold // 2)
    lp(x, y); pg.wait_for_selector('#rowMenu'); m = pg.locator('#rowMenu').bounding_box()
    print('menu near finger:', abs(m['x'] + m['width'] / 2 - x) < 120 or m['x'] < 20, round(m['y'] - y), '| texts:', pg.inner_text('#rowMenu').replace('\n', ' '))
    pg.screenshot(path=SH + 'v147-longpress.png'); pg.mouse.up(); pg.wait_for_timeout(200)
    print('menu stays after release:', pg.locator('#rowMenu').count(), '| drawer open:', pg.evaluate("document.querySelector('#drawer').classList.contains('open')"))
    pg.wait_for_timeout(900); pg.mouse.click(300, 700); pg.wait_for_timeout(300); print('closed by outside tap:', pg.locator('#rowMenu').count() == 0)
    lp(x, y, 700, 40); pg.mouse.up(); pg.wait_for_timeout(200); print('moving cancels:', pg.locator('#rowMenu').count() == 0)
    pg.mouse.click(x, y); pg.wait_for_timeout(400); print('short tap opens chat (drawer closes):', not pg.evaluate("document.querySelector('#drawer').classList.contains('open')"))
    # three dots still work
    pg.click('#menuBtn'); pg.wait_for_selector('[data-menu]'); pg.click('[data-menu]'); pg.wait_for_selector('#rowMenu'); print('dots menu ok'); pg.mouse.click(300, 700); pg.wait_for_timeout(300)
    # long press then Pin
    pg.evaluate("document.querySelector('#scrim').click()")
    pg.wait_for_timeout(300)
    if not pg.evaluate("document.querySelector('#drawer').classList.contains('open')"): pg.click('#menuBtn'); pg.wait_for_selector('.chat-item'); pg.wait_for_timeout(400)
    box = pg.locator('.chat-item').first.bounding_box(); x, y = box['x'] + 80, box['y'] + box['height'] / 2
    lp(x, y); pg.wait_for_selector('#rowMenu'); pg.mouse.up(); pg.click('#rowMenu [data-a=pin]'); pg.wait_for_timeout(400)
    print('pinned via long press:', pg.locator('.chat-head', has_text='Pinned').count(), '| chats:', n_before, pg.locator('.chat-item').count())
    pg.evaluate("document.querySelector('#scrim').click()")
    # ---- 4. Git foot
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#scrim') && document.querySelector('#scrim').click()"); pg.wait_for_timeout(300)
    pg.evaluate("""async(f)=>{const N=await import('./js/native.js');const G=await import('./js/git.js');
      await G.saveGitSettings({name:'T',email:'t@example.com'}); await G.init(f,'http://127.0.0.1:4020/v147.git'); const ch=await G.status(f); await G.commit(f,'Initial',undefined,ch);
      await N.fs.writeText(f.uri,'a.txt','1'); await N.fs.writeText(f.uri,'b.txt','2')}""", f)
    pg.click('#chipGit'); pg.wait_for_selector('#gCommit'); pg.wait_for_timeout(500)
    pg.click('[data-sel="a.txt"]'); pg.click('[data-sel="b.txt"]') if pg.locator('[data-sel="b.txt"]').count() else None; pg.wait_for_timeout(300)
    print('commit label:', pg.inner_text('#gCommit'), '| lines:', pg.evaluate("(()=>{const b=document.querySelector('#gCommit');return Math.round(b.getBoundingClientRect().height)})()"),
          '| commit width / sheet foot:', pg.evaluate("[Math.round(document.querySelector('#gCommit').getBoundingClientRect().width),Math.round(document.querySelector('.sheet-foot').getBoundingClientRect().width)]"))
    print('suggest inside box:', pg.evaluate("document.querySelector('.gbox').contains(document.querySelector('#gSuggest'))"), '| pill text:', pg.inner_text('#gSuggest'))
    pg.screenshot(path=SH + 'v147-gitfoot.png')
    pg.click('#gSuggest'); pg.wait_for_timeout(1500); print('suggest fills box:', repr(pg.input_value('#gMessage')[:60]), '| label back:', pg.inner_text('#gSuggest'))
    pg.fill('#gMessage', 'x'*200); pg.wait_for_timeout(200); pg.fill('#gMessage', 'a\nb\nc\nd\ne')
    pg.wait_for_timeout(200); pg.screenshot(path=SH + 'v147-gitfoot2.png')
    print('errors:', errs)
    b.close()
