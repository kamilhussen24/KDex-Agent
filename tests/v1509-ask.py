# ask_user: the question dialog shows the options, the choice goes back to the model; Skip tells it so.
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(10000)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    pg.fill('#input', 'asktest one'); pg.click('#sendBtn'); pg.wait_for_selector('#dialog:not(.hidden) .askopts'); pg.wait_for_timeout(300)
    opts = pg.locator('.askopts .btn').all_inner_texts(); title = pg.inner_text('#dlgTitle'); yes_hidden = pg.evaluate("document.querySelector('#dlgYes').classList.contains('hidden')")
    print('options:', opts, '| title:', title, '| yes hidden:', yes_hidden); pg.screenshot(path='/tmp/kt/shots/v1509-ask.png')
    pg.click('.askopts .btn >> nth=1'); pg.wait_for_function("document.body.innerText.includes('ASKRESULT')"); t1 = pg.evaluate("[...document.querySelectorAll('.msg')].map(m=>m.innerText).filter(x=>x.includes('ASKRESULT')).pop()")
    print('answer 1:', t1.replace('\n', ' ')[:120])
    pg.wait_for_function("!document.querySelector('#sendBtn').classList.contains('hidden') || true"); pg.wait_for_timeout(500)
    cleaned = pg.evaluate("!document.querySelector('#dialog').classList.contains('hidden') ? 'dialog still open' : 'closed'; ") 
    pg.fill('#input', 'asktest two'); pg.click('#sendBtn'); pg.wait_for_selector('#dialog:not(.hidden) .askopts'); pg.click('#dlgNo'); pg.wait_for_function("(document.body.innerText.match(/ASKRESULT/g)||[]).length>=2")
    t2 = pg.evaluate("[...document.querySelectorAll('.msg')].map(m=>m.innerText).filter(x=>x.includes('ASKRESULT')).pop()"); print('answer 2:', t2.replace('\n', ' ')[:140])
    yes_back = pg.evaluate("!document.querySelector('#dlgYes').classList.contains('hidden')"); no_label = pg.evaluate("document.querySelector('#dlgNo').innerText.trim()")
    ok = (opts == ['3000', '8080', 'Another'] and title == 'Question' and yes_hidden and 'The user chose: 8080' in t1 and 'skipped' in t2 and yes_back and no_label == 'Cancel' and not errs)
    print('PASS' if ok else 'FAIL', errs); b.close(); assert ok
