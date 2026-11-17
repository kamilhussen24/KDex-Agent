# Saved notes: one button in Settings, a sheet with search, delete and add.
from playwright.sync_api import sync_playwright
NOTES = ["নাম: কামিল হোসেন", "Lives in Moulvibazar, Sylhet", "Prefers Bengali explanations, English for UI and files", "Builds Telegram bots and payment systems", "Uses a Hetzner VPS with pm2", "Wants compact, minimal UI that matches the app"] + ['Extra note %d about the project' % i for i in range(14)]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    pg.evaluate("async(n)=>{const D=await import('./js/db.js');await D.kvSet('memory',n.map((t,i)=>({id:'n'+i,text:t,src:'manual',at:Date.now()+i})))}", NOTES)
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#memBtn'); pg.wait_for_timeout(400)
    rows = pg.evaluate("[...document.querySelectorAll('#sheetBody .row-item')].filter(e=>/Hetzner|Extra note|Moulvibazar/.test(e.textContent)).length")
    print('button text:', pg.inner_text('#memBtn').replace('\n', ' '), '| note rows in Settings:', rows)
    pg.evaluate("document.querySelector('#memBtn').scrollIntoView({block:'center'})"); pg.wait_for_timeout(200); pg.screenshot(path='/tmp/kt/shots/v1501-notes-settings.png')
    pg.click('#memBtn'); pg.wait_for_selector('#memFind'); pg.wait_for_timeout(300)
    print('sheet:', pg.inner_text('#memHow'), '| rows:', pg.evaluate("document.querySelectorAll('#memRows .row-item').length"))
    pg.screenshot(path='/tmp/kt/shots/v1501-notes-sheet.png')
    pg.fill('#memFind', 'hetzner'); pg.wait_for_timeout(200)
    print('search hetzner:', pg.inner_text('#memHow'), '|', pg.evaluate("document.querySelectorAll('#memRows .row-item').length"), 'row')
    pg.screenshot(path='/tmp/kt/shots/v1501-notes-search.png')
    pg.click('#memRows [data-dm]'); pg.wait_for_timeout(300)
    print('after delete:', pg.inner_text('#memHow'))
    pg.fill('#memFind', ''); pg.wait_for_timeout(200); print('cleared:', pg.inner_text('#memHow'))
    pg.click('#memAdd'); pg.fill('#dlgInput', 'Likes short answers on the phone'); pg.click('#dlgYes'); pg.wait_for_timeout(400)
    print('after add:', pg.inner_text('#memHow'))
    pg.click('#sheetBack'); pg.wait_for_selector('#memBtn'); pg.wait_for_timeout(300)
    cnt = pg.inner_text('#memCount'); print('count back in Settings:', cnt)
    ok = rows == 0 and cnt == '20' and not errs
    print('PASS' if ok else 'FAIL', errs[:2]); b.close(); raise SystemExit(0 if ok else 1)
