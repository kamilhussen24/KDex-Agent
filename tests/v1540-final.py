# v1.54.0: editor menu + find panel, new file/folder, folder menu, startup restore. Needs: cd www && python3 -m http.server 4011 ; python3 tests/v15220-mock.py (port 4010)
from playwright.sync_api import sync_playwright
SH = '/tmp/kt/shots/'
res = {}; errs = []
def ok(k, v): res[k] = bool(v); print(('PASS ' if v else 'FAIL ') + k)
def menu(pg): return pg.evaluate("[...document.querySelectorAll('#rowMenu button')].map(b=>b.innerText.trim())")
def names(pg): return pg.eval_on_selector_all('#sheetBody [data-p]', 'e=>e.map(x=>x.dataset.p)')
def calm(pg): pg.wait_for_function("!document.querySelector('#toast.show')", timeout=8000); pg.wait_for_timeout(250)
def press(pg, sel):
    box = pg.locator(sel).bounding_box(); pg.mouse.move(box['x'] + 60, box['y'] + box['height'] / 2); pg.mouse.down(); pg.wait_for_timeout(650); pg.mouse.up(); pg.wait_for_timeout(250)
def newfile(pg, name, via='#sheetNew'):
    pg.click(via)
    if via == '#sheetNew': pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=nf]')
    pg.wait_for_selector('#nfDlg'); pg.fill('#nfName', name); pg.wait_for_timeout(150)

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(12000)
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' and 'favicon' not in m.text else None)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
    pg.click('#topFolderBtn'); pg.wait_for_selector('#pPath'); pg.click('#pPath'); pg.wait_for_selector('#opPath')
    pg.fill('#opPath', '/storage/emulated/0/Venter/HopWeb/Projects/KDex-Agent'); pg.wait_for_timeout(700); pg.click('#opGo'); pg.wait_for_selector('#chipFiles:not(.hidden)')
    pg.click('#chipFiles'); pg.wait_for_selector('[data-p="src"]')

    # ---- + New in the title row
    ok('+ New button in title row', pg.locator('#sheetNew').count() == 1)
    pg.click('#sheetNew'); pg.wait_for_selector('#rowMenu'); ok('+ New menu: New file, New folder', menu(pg) == ['New file', 'New folder']); pg.screenshot(path=SH + 'v154-new-menu.png')
    pg.keyboard.press('Escape'); pg.mouse.click(10, 300); pg.wait_for_timeout(600)

    # ---- new file dialog
    newfile(pg, 'a/b.md'); ok('slash blocked', not pg.locator('#nfErr').is_hidden() and pg.locator('#nfGo').is_disabled())
    pg.fill('#nfName', 'README.md'); pg.wait_for_timeout(250); ok('duplicate name: inline error, no overwrite', 'already exists' in pg.inner_text('#nfErr') and pg.locator('#nfGo').is_disabled())
    pg.fill('#nfName', ''); pg.click('.nf-chip[data-x=".html"]'); ok('empty name + .html chip = index.html', pg.input_value('#nfName') == 'index.html')
    pg.click('.nf-chip[data-x=".css"]'); ok('then .css chip = style.css', pg.input_value('#nfName') == 'style.css')
    pg.click('.nf-chip[data-x=".md"]'); ok('.md chip = README.md', pg.input_value('#nfName') == 'README.md')
    pg.fill('#nfName', 'page'); pg.click('.nf-chip[data-x=".html"]'); ok('chip adds extension', pg.input_value('#nfName') == 'page.html')
    ok('template label', 'Add basic HTML template' in pg.inner_text('#nfStartRow')); ok('starter checkbox shown for html, on', pg.locator('#nfStartRow').is_visible() and pg.is_checked('#nfStart'))
    ok('preview text', pg.inner_text('#nfPrev') == 'Creates page.html')
    pg.click('.nf-chip[data-x=".css"]'); ok('chip swaps extension', pg.input_value('#nfName') == 'page.css' and not pg.locator('#nfStartRow').is_visible())
    pg.click('.nf-chip[data-x=".html"]'); pg.screenshot(path=SH + 'v154-newfile.png')
    pg.click('#nfGo'); pg.wait_for_selector('.cm-editor'); pg.wait_for_timeout(300)
    ok('created and opened in editor with starter', '<title>page</title>' in pg.evaluate("document.querySelector('.ed').editor.doc"))
    pg.click('#sheetBack'); pg.wait_for_selector('[data-p="page.html"]'); ok('Back returns to the folder list', 'page.html' in names(pg))
    newfile(pg, 'Makefile'); pg.click('#nfGo'); pg.wait_for_selector('#dialog:not(.hidden)'); ok('no extension asks', 'No file extension' in pg.inner_text('#dlgTitle'))
    pg.click('#dlgNo'); pg.wait_for_timeout(200); ok('cancel stays in dialog', pg.locator('#nfDlg').count() == 1); pg.click('#nfNo'); pg.wait_for_timeout(200)
    newfile(pg, 'x.png'); ok('binary extension refused', not pg.locator('#nfErr').is_hidden()); pg.click('#nfNo'); pg.wait_for_timeout(200)

    # ---- folder long-press menu
    press(pg, '[data-p="src"]'); pg.wait_for_selector('#rowMenu')
    ok('folder menu items', menu(pg) == ['New file here', 'Rename', 'Copy path', 'Delete'])
    ok('folder menu title', pg.inner_text('#rowMenu .rmt') == 'src'); pg.screenshot(path=SH + 'v154-folder-menu.png')
    ok('long press did not open the folder', 'src/app.js' not in names(pg))
    pg.click('#rowMenu [data-a=nf]'); pg.wait_for_selector('#nfDlg'); ok('New file here shows the folder', 'src' in pg.inner_text('#nfPrev'))
    pg.fill('#nfName', 'util.js'); pg.wait_for_timeout(150); pg.click('#nfGo'); pg.wait_for_selector('.cm-editor'); pg.click('#sheetBack'); pg.wait_for_selector('[data-p="src/util.js"]')
    ok('file made inside folder', 'src/util.js' in names(pg)); pg.click('#sheetBack'); pg.wait_for_selector('[data-p="src"]')
    # rename
    press(pg, '[data-p="src"]'); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=ren]'); pg.wait_for_selector('#dlgInput'); pg.fill('#dlgInput', 'lib'); pg.click('#dlgYes'); pg.wait_for_selector('[data-p="lib"]')
    calm(pg); pg.click('[data-p="lib"]'); pg.wait_for_selector('[data-p="lib/app.js"]'); ok('folder renamed with its files', set(names(pg)) >= {'lib/app.js', 'lib/util.js'}); pg.click('#sheetBack'); pg.wait_for_selector('[data-p="lib"]')
    ok('old folder gone', 'src' not in names(pg))
    press(pg, '[data-p="lib"]'); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=ren]'); pg.wait_for_selector('#dlgInput'); pg.fill('#dlgInput', 'page.html'); pg.click('#dlgYes'); pg.wait_for_timeout(500)
    ok('rename onto existing name refused', 'lib' in names(pg))
    # delete
    calm(pg); press(pg, '[data-p="lib"]'); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=del]'); pg.wait_for_selector('#dialog:not(.hidden)')
    ok('delete confirm names folder and count', 'Delete folder "lib"?' == pg.inner_text('#dlgTitle') and 'files inside it' in pg.inner_text('#dlgText')); pg.screenshot(path=SH + 'v154-folder-delete.png')
    pg.click('#dlgYes'); pg.wait_for_timeout(500); ok('folder deleted with contents', 'lib' not in names(pg) and 'lib/app.js' not in names(pg))
    # new folder
    pg.click('#sheetNew'); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=nd]'); pg.wait_for_selector('#dlgInput'); pg.fill('#dlgInput', 'a/b'); pg.click('#dlgYes'); pg.wait_for_timeout(300)
    ok('folder name with slash refused', pg.locator('#toast.show').count() == 1)

    # ---- empty folder
    pg.evaluate("""async()=>{const {fs}=await import('./js/native.js');const S=window.__S;}""")
    ents = names(pg)
    for n in ents:
        calm(pg); pg.click(f'[data-p="{n}"]'); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=del]'); pg.wait_for_selector('#dlgYes'); pg.click('#dlgYes'); pg.wait_for_timeout(250)
    pg.wait_for_selector('#efFile'); ok('empty folder: New file + New folder', pg.locator('#efDir').count() == 1 and pg.locator('#sheetNew').count() == 0); pg.screenshot(path=SH + 'v154-empty.png')
    pg.click('#efFile'); pg.wait_for_selector('#nfDlg'); pg.fill('#nfName', 'index.html'); pg.wait_for_timeout(150); pg.click('#nfGo'); pg.wait_for_selector('.cm-editor'); pg.wait_for_timeout(300)

    # ---- editor menu
    pg.click('#edAa'); pg.wait_for_selector('.ed-pop')
    labels = pg.evaluate("[...document.querySelectorAll('.ed-pop .ed-row > span, .ed-pop .ed-sw > span, .ed-pop .ed-act > span')].map(e=>e.textContent)")
    ok('menu has the 8 items', labels == ['Font size', 'Indent', 'Wrap long lines', 'Line numbers', 'Show spaces', 'Suggestions', 'Extra keys', 'Go to line'])
    pg.screenshot(path=SH + 'v154-ed-menu.png')
    ok('no Aa label', pg.inner_text('#edAa').strip() == '')
    ok('Suggestions off and Extra keys on by default', (not pg.is_checked('#swSug')) and pg.is_checked('#swKeys'))
    pg.locator('#swKeys').evaluate("e=>e.click()"); ok('Extra keys off hides the row', not pg.locator('#edKeys').is_visible())
    pg.locator('#swSug').evaluate("e=>e.click()"); pg.locator('#swSug').evaluate("e=>e.click()")
    kv = pg.evaluate("import('./js/db.js').then(m=>m.kvGet('editor',{}))"); ok('menu choices remembered', kv.get('keys') is False and kv.get('sug') is False and kv.get('mig2') == 1)
    pg.locator('#swKeys').evaluate("e=>e.click()"); ok('Extra keys back', pg.locator('#edKeys').is_visible())
    pg.click('#edGoto'); pg.wait_for_selector('.cm-goto-line'); ok('Go to line opens its box, menu closes', pg.locator('.ed-pop').count() == 0)
    print(pg.evaluate("(()=>{const q=s=>document.querySelector('.cm-goto-line '+s);const r=e=>{const b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.right),Math.round(b.top)]};return [r(q('.cm-dialog-close')),r(q('.cm-button')),getComputedStyle(q('.cm-dialog-close')).position]})()")); ok('goto x is in the row, not over Go', pg.evaluate("(()=>{const x=document.querySelector('.cm-goto-line .cm-dialog-close').getBoundingClientRect(),g=document.querySelector('.cm-goto-line .cm-button').getBoundingClientRect();return getComputedStyle(document.querySelector('.cm-goto-line .cm-dialog-close')).position==='static'&&x.left>=g.right-1})()")); pg.screenshot(path=SH + 'v154-goto.png'); pg.keyboard.press('Escape')
    # keyboard-open class
    pg.click('.cm-content'); pg.wait_for_timeout(150); ok('keyboard class while typing', pg.evaluate("document.querySelector('#sheet').classList.contains('ed-kb')") and pg.evaluate("getComputedStyle(document.querySelector('#sheet .sheet-card')).paddingBottom") == '0px')
    pg.screenshot(path=SH + 'v154-ed-kb.png')
    pg.evaluate("document.activeElement.blur()"); pg.wait_for_timeout(200); ok('blur: class off', not pg.evaluate("document.querySelector('#sheet').classList.contains('ed-kb')"))
    pg.set_viewport_size({'width': 360, 'height': 420}); pg.wait_for_timeout(300)
    ok('screen shrinks: keyboard class without focus', pg.evaluate("document.querySelector('#sheet').classList.contains('ed-kb')"))
    gap = pg.evaluate("innerHeight - document.querySelector('#edKeys').getBoundingClientRect().bottom"); ok('gap under extra keys is 2px', abs(gap - 2) < 1.5)
    pg.set_viewport_size({'width': 360, 'height': 740}); pg.wait_for_timeout(300)
    ok('screen back: class off', not pg.evaluate("document.querySelector('#sheet').classList.contains('ed-kb')"))

    gb = pg.evaluate("getComputedStyle(document.querySelector('.cm-gutters')).backgroundColor"); ok('line numbers have a solid background', gb not in ('rgba(0, 0, 0, 0)', 'transparent'))
    pg.evaluate("document.querySelector('.cm-scroller').scrollLeft=60"); pg.wait_for_timeout(150); pg.screenshot(path=SH + 'v154-gutter.png'); pg.evaluate("document.querySelector('.cm-scroller').scrollLeft=0")
    # ---- find panel
    pg.click('#edFind'); pg.wait_for_selector('.kfind'); pg.fill('.kfind [name=search]', 'hello'); pg.wait_for_timeout(150)
    ok('find finds ignoring case', pg.locator('.cm-searchMatch').count() > 0)
    pg.click('.kfind [name=case]'); pg.wait_for_timeout(150); ok('Aa switch: match case', pg.get_attribute('.kfind [name=case]', 'aria-pressed') == 'true' and pg.locator('.cm-searchMatch').count() == 0)
    pg.click('.kfind [name=case]'); pg.click('.kfind [name=word]'); pg.fill('.kfind [name=search]', 'Hell'); pg.wait_for_timeout(150); ok('ab switch: whole word', pg.locator('.cm-searchMatch').count() == 0)
    pg.click('.kfind [name=word]'); pg.click('.kfind [name=re]'); pg.fill('.kfind [name=search]', 'H.llo'); pg.wait_for_timeout(150); ok('.* switch: regex', pg.locator('.cm-searchMatch').count() > 0)
    pg.click('.kfind [name=re]')
    ws = pg.evaluate("[...document.querySelectorAll('.kfind .kf-r')].map(b=>Math.round(b.getBoundingClientRect().width))"); ok('Replace buttons 84px each', ws == [84, 84])
    bx = pg.evaluate("['prev','next'].map(n=>Math.round(document.querySelector('.kfind [name='+n+']').getBoundingClientRect().width))"); ok('prev/next 32px', bx == [32, 32])
    ok('close x present', pg.locator('.kfind [name=close]').count() == 1)
    pg.fill('.kfind [name=search]', 'a' * 120); ok('long text keeps the end visible', pg.evaluate("(()=>{const i=document.querySelector('.kfind [name=search]');return i.scrollLeft>0})()"))
    pg.fill('.kfind [name=search]', 'Hello'); pg.fill('.kfind [name=replace]', 'Howdy'); pg.click('.kfind [name=search]'); pg.screenshot(path=SH + 'v154-find.png')
    pg.click('.kfind [name=replaceAll]'); pg.wait_for_timeout(120); ok('Replace all', 'Howdy' in pg.evaluate("document.querySelector('.ed').editor.doc"))
    pg.click('.kfind [name=close]'); ok('x closes find', pg.locator('.kfind').count() == 0)
    pg.click('#edSave'); pg.wait_for_timeout(300)

    # dark
    pg.evaluate("document.documentElement.dataset.theme='dark'"); pg.click('#edFind'); pg.wait_for_selector('.kfind'); pg.fill('.kfind [name=search]', 'Howdy'); pg.screenshot(path=SH + 'v154-find-dark.png')
    pg.click('#edAa'); pg.wait_for_selector('.ed-pop'); pg.screenshot(path=SH + 'v154-ed-menu-dark.png'); pg.click('#edAa')
    pg.evaluate("document.documentElement.dataset.theme='light'")
    pg.click('#sheetClose'); pg.wait_for_timeout(500)

    # ---- Scratch: New file only
    pg.reload(); pg.wait_for_selector('#modelSelect', state='attached'); pg.wait_for_timeout(300)
    print('errors:', errs); b.close()
bad = [k for k, v in res.items() if not v]
print('PASS' if not bad and not errs else 'FAIL', bad, errs)
