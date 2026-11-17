# v1.52.6: one file menu (Open / Preview / Rename / Copy / Download / Delete) in the phone folder, Scratch and a server; stacked buttons in the secret dialog.
from playwright.sync_api import sync_playwright
SH = '/tmp/kt/shots/'
def menu(pg): return pg.evaluate("[...document.querySelectorAll('#rowMenu button')].map(b=>b.innerText.trim())")
def title(pg): return pg.evaluate("(()=>{const e=document.querySelector('#rowMenu .rmt');return e?e.textContent:''})()")
def names(pg): return pg.eval_on_selector_all('[data-p]', 'e=>e.map(x=>x.dataset.p)')
def rename(pg, row, new):
    pg.wait_for_function("!document.querySelector('#toast.show')", timeout=8000); pg.wait_for_timeout(300); pg.click('[data-p="%s"]' % row); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=ren]'); pg.wait_for_selector('#dlgInput'); pg.fill('#dlgInput', new); pg.click('#dlgYes'); pg.wait_for_timeout(500)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(10000)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
    # ---- phone folder
    pg.click('#topFolderBtn'); pg.wait_for_selector('#pPath'); pg.click('#pPath'); pg.wait_for_selector('#opPath')
    pg.fill('#opPath', '/storage/emulated/0/Venter/HopWeb/Projects/KDex-Agent'); pg.wait_for_timeout(700); pg.click('#opGo'); pg.wait_for_selector('#chipFiles:not(.hidden)')
    pg.click('#chipFiles'); pg.wait_for_selector('[data-p="README.md"]')
    pg.click('[data-p="README.md"]'); pg.wait_for_selector('#rowMenu'); m = menu(pg); print('phone README menu:', m, '| title:', title(pg)); pg.screenshot(path=SH + 'v1526-phone-menu.png'); assert m == ['Open', 'Edit', 'Rename', 'Copy', 'Delete']
    pg.click('#rowMenu [data-a=open]'); pg.wait_for_selector('.fv'); pg.click('#sheetBack'); pg.wait_for_selector('[data-p]')
    rename(pg, 'README.md', 'a/b.md'); print('slash refused:', 'README.md' in names(pg))
    rename(pg, 'README.md', 'src'); print('same name as folder refused:', 'README.md' in names(pg))
    rename(pg, 'README.md', 'NOTES.md'); n = names(pg); print('renamed:', 'NOTES.md' in n and 'README.md' not in n); assert 'NOTES.md' in n
    pg.wait_for_function("!document.querySelector('#toast.show')", timeout=8000); pg.wait_for_timeout(300); pg.click('[data-p="NOTES.md"]'); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=del]'); pg.wait_for_selector('#dlgYes'); print('delete asks:', pg.inner_text('#dlgTitle'), '|', pg.inner_text('#dlgText')); pg.click('#dlgYes'); pg.wait_for_timeout(500)
    print('deleted:', 'NOTES.md' not in names(pg)); assert 'NOTES.md' not in names(pg)
    pg.click('[data-p="src"]'); pg.wait_for_selector('[data-p="src/app.js"]'); pg.click('[data-p="src/app.js"]'); pg.wait_for_selector('#rowMenu'); print('app.js menu:', menu(pg)); pg.mouse.click(10, 300); pg.wait_for_timeout(700)
    pg.click('#sheetClose'); pg.wait_for_timeout(300)
    # ---- stacked dialog buttons (CSS only, same markup the secret dialog uses)
    pg.evaluate("document.querySelector('#dlgTitle').textContent='Possible secret found';document.querySelector('#dlgText').textContent='These files look like they contain a key or token. Once pushed, it is public.\\n\\nconfig.py (Password in URL, line 3)';document.querySelector('#dlgYes').firstElementChild.textContent='Leave them out';document.querySelector('#dlgAlt').firstElementChild.textContent='Commit anyway';document.querySelector('#dlgAlt').classList.remove('hidden');document.querySelector('#dlgYes').parentElement.classList.add('stack');document.querySelector('#dialog').classList.remove('hidden')")
    pg.wait_for_timeout(200)
    rows = pg.evaluate("[...document.querySelectorAll('.dlg-actions .btn:not(.hidden)')].map(b=>({t:b.innerText.trim(),x:Math.round(b.getBoundingClientRect().left),y:Math.round(b.getBoundingClientRect().top),w:Math.round(b.getBoundingClientRect().width),h:Math.round(b.getBoundingClientRect().height)}))")
    rows.sort(key=lambda r: r['y']); print('dialog buttons top to bottom:', rows); pg.screenshot(path=SH + 'v1526-dialog.png')
    assert [r['t'] for r in rows] == ['Leave them out', 'Commit anyway', 'Cancel'] and len({r['w'] for r in rows}) == 1 and len({r['h'] for r in rows}) == 1
    print('errors:', errs); b.close()
