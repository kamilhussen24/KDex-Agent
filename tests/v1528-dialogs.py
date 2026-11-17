# v1.52.8: equal space above and below the field in text dialogs, eye icon swap in the secret box, rounded file icon.
from playwright.sync_api import sync_playwright
M = """()=>{const r=s=>document.querySelector(s).getBoundingClientRect();const t=document.createRange();t.selectNodeContents(document.querySelector('#dlgTitle'));const tb=t.getBoundingClientRect();
const i=r('#dlgInput'),y=r('#dlgYes');return {above:Math.round(i.top-tb.bottom),below:Math.round(y.top-i.bottom)}}"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(10000)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(500)
    # secret box (agent asks for a key)
    pg.fill('#input', 'envtest'); pg.click('#sendBtn'); pg.wait_for_selector('#dlgEye', state='visible', timeout=20000); pg.wait_for_timeout(300)
    m = pg.evaluate(M); print('secret box gaps:', m); assert m['below'] == 10, m  # the secret box has a description above the field, so only the space below is checked
    ey = pg.evaluate("(()=>{const e=document.querySelector('#dlgEye').getBoundingClientRect(), i=document.querySelector('#dlgInput').getBoundingClientRect();return [Math.round((e.top+e.height/2)-(i.top+i.height/2))]})()"); print('eye centre minus input centre (px):', ey); assert abs(ey[0]) <= 1
    h1 = pg.evaluate("document.querySelector('#dlgEye use').getAttribute('href')"); pg.screenshot(path='/tmp/kt/shots/v1528-secret-hidden.png')
    pg.fill('#dlgInput', 'abcdefg'); pg.click('#dlgEye'); h2 = pg.evaluate("document.querySelector('#dlgEye use').getAttribute('href')"); t2 = pg.evaluate("document.querySelector('#dlgInput').type"); pg.screenshot(path='/tmp/kt/shots/v1528-secret-shown.png')
    print('icon hidden/shown:', h1, h2, '| input type when shown:', t2); assert h1 == '#i-eye' and h2 == '#i-eye-off' and t2 == 'text'
    pg.click('#dlgEye'); h3 = pg.evaluate("document.querySelector('#dlgEye use').getAttribute('href')"); assert h3 == '#i-eye'
    pg.click('#dlgNo'); pg.wait_for_timeout(600)
    # a plain confirm dialog keeps its own spacing (no has-in class left behind)
    print('has-in left behind:', pg.evaluate("document.querySelector('#dlgText').classList.contains('has-in')")); assert not pg.evaluate("document.querySelector('#dlgText').classList.contains('has-in')")
    # text dialog (rename in Scratch): same space above and below the field
    pg.fill('#input', 'filetest'); pg.click('#sendBtn'); pg.wait_for_selector('#stopBtn.hidden', state='attached', timeout=20000); pg.wait_for_timeout(5000)
    pg.wait_for_selector('#chipScratch:not(.hidden)', timeout=15000); pg.click('#chipScratch'); pg.wait_for_selector('#sheet .row-item[data-p]'); pg.wait_for_timeout(300)
    pg.click('#sheet [data-p="hello.py"]'); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=ren]'); pg.wait_for_selector('#dlgInput'); pg.wait_for_timeout(300)
    m = pg.evaluate(M); print('rename box gaps:', m); assert abs(m['above'] - m['below']) <= 1 and m['below'] == 10, m
    pg.screenshot(path='/tmp/kt/shots/v1528-rename.png'); pg.click('#dlgNo'); pg.wait_for_timeout(300)
    print('errors:', errs); b.close()
