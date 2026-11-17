# v1.52.6: the same file menu in Scratch and on a server.
from playwright.sync_api import sync_playwright
def menu(pg): return pg.evaluate("[...document.querySelectorAll('#rowMenu button')].map(b=>b.innerText.trim())")
def title(pg): return pg.evaluate("(()=>{const e=document.querySelector('#rowMenu .rmt');return e?e.textContent:''})()")
def names(pg): return pg.eval_on_selector_all('#sheet [data-p]', 'e=>e.map(x=>x.dataset.p)')
def calm(pg): pg.wait_for_function("!document.querySelector('#toast.show')", timeout=8000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, permissions=['clipboard-read', 'clipboard-write']).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(10000)
    pg.add_init_script("window.__clip=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async(t)=>{window.__clip.push(t)},readText:async()=>''}})")
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(500)
    for t in ['filetest', 'longfile']:
        pg.fill('#input', t); pg.click('#sendBtn'); pg.wait_for_selector('#stopBtn.hidden', state='attached', timeout=20000); pg.wait_for_timeout(5000)
    pg.wait_for_selector('#chipScratch:not(.hidden)', timeout=15000); pg.click('#chipScratch'); pg.wait_for_selector('#sheet .row-item[data-p]'); pg.wait_for_timeout(300)
    n = names(pg); print('scratch files:', n)
    f = [x for x in n if len(x) < 20][0]
    pg.click('#sheet [data-p="%s"]' % f); pg.wait_for_selector('#rowMenu'); m = menu(pg); print('scratch menu:', m, '| title:', title(pg)); pg.screenshot(path='/tmp/kt/shots/v1526-scratch-menu.png')
    assert m[0] == 'Open' and 'Rename' in m and m[-1] == 'Delete', m
    pg.click('#rowMenu [data-a=ren]'); pg.wait_for_selector('#dlgInput'); pg.fill('#dlgInput', 'renamed-' + f.split('/')[-1]); pg.click('#dlgYes'); pg.wait_for_selector('#sheet [data-p]'); pg.wait_for_timeout(600)
    n2 = names(pg); print('after rename:', n2); assert any('renamed-' in x for x in n2) and f not in n2
    calm(pg); r = [x for x in n2 if 'renamed-' in x][0]
    pg.click('#sheet [data-p="%s"]' % r); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=open]'); pg.wait_for_selector('.fv'); print('open works:', True); pg.click('#sheetBack'); pg.wait_for_selector('#sheet [data-p]')
    calm(pg); pg.click('#sheet [data-p="%s"]' % r); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=del]'); pg.wait_for_selector('#dlgYes'); pg.click('#dlgYes'); pg.wait_for_timeout(800)
    n3 = names(pg) if pg.query_selector('#sheet [data-p]') else []; print('after delete:', n3); assert r not in n3
    # ---- server
    pg.click('#sheetClose'); pg.wait_for_timeout(300); pg.click('#menuBtn'); pg.click('#dNew'); pg.wait_for_timeout(500)
    calm(pg); pg.click('#chipFolder'); pg.wait_for_selector('#pServer'); pg.click('#pServer'); pg.wait_for_selector('#svGo')
    pg.fill('#svHost', 'vps.kamildex.com'); pg.fill('#svUser', 'deploy'); pg.fill('#svPass', 'pw'); pg.fill('#svName', 'My VPS'); pg.fill('#svRoot', '/var/www/site'); pg.click('#svGo'); pg.wait_for_selector('.sv-rows'); pg.click('#svGo'); pg.wait_for_timeout(900)
    pg.click('#chipFiles'); pg.wait_for_selector('#rfUp'); pg.wait_for_timeout(300); print('server rows:', names(pg))
    calm(pg); pg.click('#sheet [data-p="index.php"]'); pg.wait_for_selector('#rowMenu'); m = menu(pg); print('server menu:', m, '| title:', title(pg)); pg.screenshot(path='/tmp/kt/shots/v1526-server-menu.png')
    assert m == ['Open', 'Edit', 'Rename', 'Copy', 'Download', 'Delete'], m
    pg.click('#rowMenu [data-a=copy]'); pg.wait_for_selector('#toast.show'); print('server copy toast:', pg.inner_text('#toast')); assert 'Copied' in pg.inner_text('#toast'); print('clipboard got:', pg.evaluate('window.__clip')); calm(pg); pg.click('#sheet [data-p="index.php"]'); pg.wait_for_selector('#rowMenu')
    pg.click('#rowMenu [data-a=ren]'); pg.wait_for_selector('#dlgInput'); pg.fill('#dlgInput', 'home.php'); pg.click('#dlgYes'); pg.wait_for_timeout(700)
    n = names(pg); print('server after rename:', n); assert 'home.php' in n and 'index.php' not in n
    calm(pg); pg.click('#sheet [data-p="home.php"]'); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=open]'); pg.wait_for_selector('.fv'); print('server open shows code:', 'echo' in pg.inner_text('.fv'))
    pg.click('#sheetBack') if pg.query_selector('#sheetBack') else None
    pg.wait_for_selector('#sheet [data-p="backup.zip"]'); calm(pg); pg.click('#sheet [data-p="backup.zip"]'); pg.wait_for_selector('#rowMenu'); m = menu(pg); print('zip menu (no Open):', m); assert 'Open' not in m and 'Rename' in m
    print('errors:', errs); b.close()
