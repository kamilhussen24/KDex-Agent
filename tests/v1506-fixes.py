# v1.50.6: menu title only when the row cuts the name; warnings for folder change / chat delete while a task runs; run strip above the message box.
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(10000)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    res = {}
    # Scratch: one short and one long file name
    for t in ['filetest', 'longfile']:
        pg.fill('#input', t); pg.click('#sendBtn'); pg.wait_for_selector('#stopBtn.hidden', state='attached', timeout=20000); pg.wait_for_timeout(5000)
    pg.wait_for_selector('#chipScratch:not(.hidden)', timeout=15000); pg.click('#chipScratch'); pg.wait_for_selector('#sheet .row-item[data-p]'); pg.wait_for_timeout(300)
    names = pg.evaluate("[...document.querySelectorAll('#sheet .row-item[data-p]')].map(r=>r.dataset.p)"); res['scratch files'] = names
    def menu_title(path):
        pg.click('#sheet .row-item[data-p="%s"]' % path); pg.wait_for_selector('#rowMenu'); pg.wait_for_timeout(200)
        t = pg.evaluate("(()=>{const e=document.querySelector('#rowMenu .rmt');return e?e.textContent:''})()")
        pg.screenshot(path='/tmp/kt/shots/v1506-menu-%s.png' % ('long' if len(path) > 30 else 'short'))
        pg.mouse.click(10, 300); pg.wait_for_timeout(700); return t
    short = [n for n in names if len(n) < 20][0]; long = [n for n in names if len(n) > 30][0]
    res['short name title'] = menu_title(short); res['long name title'] = menu_title(long)
    pg.click('#sheetClose'); pg.wait_for_timeout(300)
    # running task: strip position, folder change warning, delete warning
    pg.fill('#input', 'slowtest again'); pg.click('#sendBtn'); pg.wait_for_timeout(1000)
    pg.click('#menuBtn'); pg.click('#dNew'); pg.wait_for_timeout(500)
    pos = pg.evaluate("(()=>{const s=document.querySelector('#runStrip').getBoundingClientRect(), c=document.querySelector('#input').getBoundingClientRect(), m=document.querySelector('#messages').getBoundingClientRect();return [Math.round(s.top),Math.round(s.bottom),Math.round(c.top),Math.round(m.bottom)]})()")
    res['strip [top,bottom] vs composer top / messages bottom'] = pos
    res['strip above composer, below messages'] = pos[0] >= pos[3] - 1 and pos[1] <= pos[2] + 1
    pg.screenshot(path='/tmp/kt/shots/v1506-strip.png')
    pg.click('#runStrip [data-a=view]'); pg.wait_for_timeout(600)
    # delete this chat from the drawer menu while it runs
    pg.click('#menuBtn'); pg.wait_for_timeout(300)
    pg.click('.chat-item.on [data-menu]'); pg.wait_for_timeout(300)
    pg.click('#chatMenu [data-a=del], [data-a=del]'); pg.wait_for_selector('#dialog:not(.hidden)')
    res['delete dialog text'] = pg.inner_text('#dlgText'); pg.screenshot(path='/tmp/kt/shots/v1506-delete.png')
    pg.click('#dlgNo'); pg.wait_for_timeout(300)
    res['task still running after Cancel'] = pg.evaluate("!document.querySelector('#stopBtn').classList.contains('hidden')")
    for k, v in res.items(): print(k, '=>', v)
    ok = (res['short name title'] != '' and res['long name title'] != '' and res['strip above composer, below messages'] and 'running task stops too' in res['delete dialog text'] and res['task still running after Cancel'] and not errs)
    print('PASS' if ok else 'FAIL', errs[:2]); b.close(); raise SystemExit(0 if ok else 1)
