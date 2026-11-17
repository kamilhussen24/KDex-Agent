# v1.50.5: a running task keeps going when you open another chat; one task at a time; Back never stops a task.
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script("window.__exited=0;")
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    res = {}
    pg.set_default_timeout(8000)
    # chat A: slow task
    pg.fill('#input', 'slowtest first chat'); pg.click('#sendBtn'); pg.wait_for_timeout(1800)
    res['A running, button is Stop'] = pg.evaluate("!document.querySelector('#stopBtn').classList.contains('hidden')")
    # open a second chat while A runs
    pg.click('#menuBtn'); pg.click('#dNew'); pg.wait_for_timeout(500)
    res['task not stopped by New chat'] = pg.evaluate("document.querySelector('#stopBtn').classList.contains('hidden') && !document.querySelector('#runStrip').classList.contains('hidden')")
    strip = pg.inner_text('#runStrip').replace('\n', ' ')
    res['strip text'] = strip
    pg.screenshot(path='/tmp/kt/shots/v1505-strip.png')
    res['no tick text on B screen'] = 'tick' not in pg.inner_text('#messages')
    # send in B while A runs -> dialog, choose Wait
    pg.fill('#input', 'hello second'); pg.click('#sendBtn'); pg.wait_for_selector('#dialog:not(.hidden)')
    res['dialog title'] = pg.inner_text('#dlgTitle')
    pg.screenshot(path='/tmp/kt/shots/v1505-another.png')
    pg.click('#dlgYes'); pg.wait_for_timeout(300)
    res['Wait keeps text'] = pg.input_value('#input') == 'hello second'
    # Back while running asks, Stay keeps running
    pg.evaluate("(()=>{window.__kdexBack();})()"); pg.wait_for_selector('#dialog:not(.hidden)')
    res['back dialog'] = pg.inner_text('#dlgTitle')
    pg.screenshot(path='/tmp/kt/shots/v1505-back.png')
    pg.click('#dlgYes'); pg.wait_for_timeout(300)
    # View -> return to chat A, live text has kept coming
    pg.click('#runStrip [data-a=view]'); pg.wait_for_timeout(700)
    res['back in A, stop button'] = pg.evaluate("!document.querySelector('#stopBtn').classList.contains('hidden')")
    res['A strip hidden'] = pg.evaluate("document.querySelector('#runStrip').classList.contains('hidden')")
    txt = pg.inner_text('#messages'); res['A shows ticks'] = 'tick' in txt
    pg.wait_for_selector('#stopBtn.hidden', state='attached', timeout=15000); pg.wait_for_timeout(300)
    txt = pg.inner_text('#messages'); res['A finished with tick10'] = 'tick10' in txt
    # idle Back: first press hint, second press would exit
    pg.evaluate("(()=>{window.__kdexBack();})()"); pg.wait_for_timeout(250)
    res['hint shown'] = pg.evaluate("document.querySelector('#exitHint').classList.contains('show')")
    pg.screenshot(path='/tmp/kt/shots/v1505-hint.png')
    # finish in other chat: start task in A, switch away, wait for toast
    pg.fill('#input', 'slowtest again'); pg.click('#sendBtn'); pg.wait_for_timeout(1200)
    pg.click('#menuBtn'); pg.click('#dNew'); pg.wait_for_timeout(300)
    pg.wait_for_selector('#runStrip.hidden', state='attached', timeout=15000); pg.wait_for_timeout(500)
    res['task finished away; B send is normal'] = pg.evaluate("document.querySelector('#stopBtn').classList.contains('hidden')")
    res['toast shown'] = 'Task finished' in pg.inner_text('#toast')
    pg.screenshot(path='/tmp/kt/shots/v1505-toast.png')
    for k, v in res.items(): print(k, '=>', v)
    ok = (res['A running, button is Stop'] and res['task not stopped by New chat'] and res['strip text'].startswith('Working in') and res['no tick text on B screen']
          and res['dialog title'] == 'Another task is running' and res['Wait keeps text'] and res['back dialog'] == 'A task is running' and res['back in A, stop button']
          and res['A strip hidden'] and res['A shows ticks'] and res['A finished with tick10'] and res['hint shown'] and res['task finished away; B send is normal'] and res['toast shown'] and not errs)
    print('PASS' if ok else 'FAIL', errs[:2]); b.close(); raise SystemExit(0 if ok else 1)
