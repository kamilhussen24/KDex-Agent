# v1.53.0: built-in code editor (CodeMirror 6). Needs: cd www && python3 -m http.server 4011 ; python3 tests/v15220-mock.py (port 4010)
import json, sys
from playwright.sync_api import sync_playwright

SHOTS = '/tmp/kt/shots'
HTML = '<!DOCTYPE html>\n<html>\n<head>\n  <title>Hi</title>\n</head>\n<body>\n  <p>Hello</p>\n</body>\n</html>\n'
res = {}; errs = []

def boot(pg):
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo')
    pg.wait_for_selector('#modelSelect'); pg.wait_for_timeout(400)
    pg.fill('#input', 'hi'); pg.click('#sendBtn'); pg.wait_for_timeout(1500)

JS_PUT = """async ([files]) => {
  const { db } = await import('./js/db.js'); const { fs } = await import('./js/native.js'); const { scratchUri } = await import('./js/scratch.js');
  const chats = await db.all('chats'); const id = chats.sort((a,b)=>(b.updated||0)-(a.updated||0))[0].id;
  for (const [n, t] of files) await fs.writeText(scratchUri(id), n, t);
  window.__cid = id; return id;
}"""
JS_GET = """async (n) => { const { fs } = await import('./js/native.js'); const { scratchUri } = await import('./js/scratch.js');
  const r = await fs.readText(scratchUri(window.__cid), n, 2000000); return r.text; }"""
JS_HEAD = """async (n) => { const { fs } = await import('./js/native.js'); const { scratchUri } = await import('./js/scratch.js');
  return Array.from((await fs.readBytes(scratchUri(window.__cid), n)).slice(0, 3)); }"""
JS_SET = """async ([n, t]) => { const { fs } = await import('./js/native.js'); const { scratchUri } = await import('./js/scratch.js');
  await fs.writeText(scratchUri(window.__cid), n, t); }"""

def open_scratch(pg):
    pg.reload(); pg.wait_for_selector('#modelSelect'); pg.wait_for_timeout(500)
    pg.wait_for_selector('#chipScratch:not(.hidden)'); pg.click('#chipScratch'); pg.wait_for_selector('[data-p]')

def edit_file(pg, name):
    pg.click(f'[data-p="{name}"]'); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=edit]'); pg.wait_for_selector('.cm-editor'); pg.wait_for_timeout(250)

def st(pg): return pg.inner_text('#edState')
def doc(pg): return pg.evaluate("document.querySelector('.ed').editor.doc")
def typed(pg, s):
    pg.click('.cm-content'); pg.keyboard.press('Control+End'); pg.keyboard.type(s); pg.wait_for_timeout(80)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(15000)
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' and 'favicon' not in m.text else None)
    boot(pg)
    cid = pg.evaluate(JS_PUT, [[['index.html', HTML], ['crlf.txt', '﻿one\r\ntwo\r\n'], ['logo.png', 'x'], ['app.py', 'def f():\n    return 1\n'], ['data.bin', 'abc\u0000def']]])
    open_scratch(pg); pg.evaluate('c=>{window.__cid=c}', cid)

    # menu: Edit is offered for text, not for pictures
    pg.click('[data-p="logo.png"]'); pg.wait_for_selector('#rowMenu')
    res['png: no Edit item'] = pg.locator('#rowMenu [data-a=edit]').count() == 0
    pg.keyboard.press('Escape'); pg.mouse.click(5, 5); pg.wait_for_timeout(600)
    pg.click('[data-p="index.html"]'); pg.wait_for_selector('#rowMenu')
    res['html: Edit item after Open'] = pg.evaluate("[...document.querySelectorAll('#rowMenu [data-a]')].map(e=>e.dataset.a).slice(0,2)") == ['open', 'edit']
    pg.screenshot(path=SHOTS + '/ed-menu.png')
    pg.click('#rowMenu [data-a=edit]'); pg.wait_for_selector('.cm-editor'); pg.wait_for_timeout(300)

    res['editor shown'] = pg.locator('.cm-editor').count() == 1
    res['meta: 9 lines'] = pg.inner_text('#edMeta') == '9 lines'
    res['status: Saved'] = st(pg) == 'Saved'
    res['save disabled when unchanged'] = pg.locator('#edSave').is_disabled()
    res['position row'] = 'HTML' in pg.inner_text('#edPos') and 'Ln 1' in pg.inner_text('#edPos')
    res['undo/redo disabled at start'] = pg.locator('#edUndo').is_disabled() and pg.locator('#edRedo').is_disabled()
    res['autocorrect off'] = pg.evaluate("document.querySelector('.cm-content').getAttribute('autocorrect')") == 'off'
    pg.screenshot(path=SHOTS + '/ed-light.png')

    typed(pg, '<!-- end -->')
    res['typing marks unsaved'] = st(pg) == 'Unsaved changes' and not pg.locator('#edSave').is_disabled()
    res['undo enabled'] = not pg.locator('#edUndo').is_disabled()
    pg.click('#edUndo'); res['undo restores saved state'] = st(pg) == 'Saved' and doc(pg) == HTML.rstrip('\n') + '\n' or doc(pg) == HTML
    res['redo enabled'] = not pg.locator('#edRedo').is_disabled()
    pg.click('#edRedo'); res['redo brings text back'] = '<!-- end -->' in doc(pg) and st(pg) == 'Unsaved changes'

    # extra keys + Tab
    pg.click('.cm-content'); pg.keyboard.press('Control+Home')
    pg.click('.ed-k[data-k="{"]'); res['extra key inserts'] = doc(pg).startswith('{')
    pg.click('.ed-k[data-k="TAB"]'); res['Tab key indents'] = doc(pg).startswith('{  ')

    # save
    pg.click('#edSave'); pg.wait_for_timeout(300)
    saved = pg.evaluate(JS_GET, 'index.html')
    res['save writes to same path'] = saved.startswith('{  <!DOCTYPE') and '<!-- end -->' in saved
    res['status Saved after save'] = st(pg) == 'Saved' and pg.locator('#edSave').is_disabled()

    # overwrite check
    pg.evaluate(JS_SET, ['index.html', 'changed elsewhere\n'])
    typed(pg, 'Z'); pg.click('#edSave'); pg.wait_for_selector('#dialog:not(.hidden)')
    res['changed-on-disk asks'] = 'File changed' in pg.inner_text('#dlgTitle')
    pg.click('#dlgNo'); pg.wait_for_timeout(200)
    res['cancel keeps disk text'] = pg.evaluate(JS_GET, 'index.html') == 'changed elsewhere\n' and st(pg) == 'Unsaved changes'
    pg.click('#edSave'); pg.wait_for_selector('#dialog:not(.hidden)'); pg.click('#dlgYes'); pg.wait_for_timeout(300)
    res['Replace overwrites'] = 'Z' in pg.evaluate(JS_GET, 'index.html') and st(pg) == 'Saved'

    # options popover
    pg.click('#edAa'); pg.wait_for_selector('.ed-pop')
    pg.screenshot(path=SHOTS + '/ed-options.png')
    f0 = pg.evaluate("getComputedStyle(document.querySelector('.cm-editor')).fontSize")
    pg.click('#szUp'); f1 = pg.evaluate("getComputedStyle(document.querySelector('.cm-editor')).fontSize")
    res['font size A+'] = float(f1[:-2]) > float(f0[:-2])
    pg.click('#edInd button[data-v="4"]'); pg.click('#edAa'); typed(pg, '\n'); pg.click('.ed-k[data-k="TAB"]')
    res['indent 4 respected by Tab'] = doc(pg).endswith('    ')
    pg.click('#edAa'); pg.wait_for_selector('.ed-pop')
    pg.locator('#swNum').evaluate("e=>e.click()"); res['line numbers toggle'] = pg.locator('.cm-lineNumbers').count() == 0
    pg.locator('#swNum').evaluate("e=>e.click()"); res['line numbers back'] = pg.locator('.cm-lineNumbers').count() == 1
    pg.locator('#swSp').evaluate("e=>e.click()"); pg.wait_for_timeout(100)
    res['show spaces adds marks'] = pg.locator('.cm-highlightSpace').count() > 0
    pg.locator('#swSp').evaluate("e=>e.click()")
    pg.locator('#swWrap').evaluate("e=>e.click()"); res['wrap off'] = pg.locator('.cm-lineWrapping').count() == 0
    pg.locator('#swWrap').evaluate("e=>e.click()")
    kv = pg.evaluate("import('./js/db.js').then(m=>m.kvGet('editor',{}))")
    res['options remembered'] = kv.get('size') == 14 and kv.get('indent') == 4
    pg.mouse.click(30, 650); pg.wait_for_timeout(150)
    res['popover closes on outside tap'] = pg.locator('.ed-pop').count() == 0
    pg.click('#edUndo')

    # find and replace
    pg.click('#edFind'); pg.wait_for_selector('.cm-search')
    res['find panel app style'] = pg.evaluate("getComputedStyle(document.querySelector('.cm-search .kf-r')).borderRadius") == '10px'
    pg.fill('.cm-search [name=search]', 'Hello'); pg.fill('.cm-search [name=replace]', 'Howdy')
    pg.screenshot(path=SHOTS + '/ed-find.png')
    pg.click('.cm-search [name=replaceAll]'); pg.wait_for_timeout(100)
    res['replace all'] = 'Howdy' in doc(pg) and 'Hello' not in doc(pg)
    pg.click('#edFind'); res['find closes'] = pg.locator('.cm-search').count() == 0

    # leaving with unsaved changes: Cancel / Discard / Save
    pg.click('#sheetClose'); pg.wait_for_selector('#dialog:not(.hidden)')
    res['close asks Save changes?'] = pg.inner_text('#dlgTitle') == 'Save changes?' and pg.locator('#dlgAlt').is_visible()
    pg.screenshot(path=SHOTS + '/ed-unsaved.png')
    pg.click('#dlgNo'); pg.wait_for_timeout(150)
    res['Cancel stays in editor'] = pg.locator('.cm-editor').count() == 1
    pg.click('#sheetBack'); pg.wait_for_selector('#dialog:not(.hidden)'); pg.click('#dlgAlt'); pg.wait_for_timeout(300)
    res['Discard leaves, file unchanged'] = pg.locator('.cm-editor').count() == 0 and 'Howdy' not in pg.evaluate(JS_GET, 'index.html')
    # reopen; the viewer back button chain and Save from the dialog
    pg.click('[data-p="index.html"]'); pg.click('#rowMenu [data-a=edit]'); pg.wait_for_selector('.cm-editor'); pg.wait_for_timeout(200)
    typed(pg, 'Q'); pg.click('#sheetBack'); pg.wait_for_selector('#dialog:not(.hidden)'); pg.click('#dlgYes'); pg.wait_for_timeout(400)
    res['Save from dialog saves and leaves'] = pg.evaluate(JS_GET, 'index.html').endswith('Q') and pg.locator('.cm-editor').count() == 0

    # CRLF and BOM kept
    pg.click('[data-p="crlf.txt"]'); pg.click('#rowMenu [data-a=edit]'); pg.wait_for_selector('.cm-editor'); pg.wait_for_timeout(200)
    res['crlf: lines counted right'] = pg.inner_text('#edMeta') == '2 lines'
    typed(pg, 'three'); pg.click('#edSave'); pg.wait_for_timeout(300)
    out = pg.evaluate(JS_GET, 'crlf.txt')

    res['crlf and BOM preserved'] = out == 'one\r\ntwo\r\nthree' and pg.evaluate(JS_HEAD, 'crlf.txt') == [239, 187, 191]
    pg.click('#sheetBack'); pg.wait_for_timeout(300)

    # python: indent auto-detect + viewer Edit button
    pg.click('[data-p="app.py"]'); pg.click('#rowMenu [data-a=open]'); pg.wait_for_selector('#fvEdit')
    res['viewer has Edit button'] = True
    pg.click('#fvEdit'); pg.wait_for_selector('.cm-editor'); pg.wait_for_timeout(200)
    res['python label'] = 'Python' in pg.inner_text('#edPos')
    pg.click('#sheetBack'); pg.wait_for_selector('#fvEdit'); res['back goes to viewer'] = True
    pg.click('#sheetBack'); pg.wait_for_selector('[data-p]')

    # binary-looking text
    pg.click('[data-p="data.bin"]'); pg.wait_for_selector('#rowMenu')
    res['.bin: no Edit item'] = pg.locator('#rowMenu [data-a=edit]').count() == 0
    pg.mouse.click(5, 5); pg.wait_for_timeout(600)

    # dark theme
    pg.click('[data-p="index.html"]'); pg.click('#rowMenu [data-a=edit]'); pg.wait_for_selector('.cm-editor'); pg.wait_for_timeout(200)
    pg.evaluate("document.documentElement.dataset.theme='dark'"); pg.wait_for_timeout(250)
    pg.screenshot(path=SHOTS + '/ed-dark.png')
    res['dark: text readable'] = pg.evaluate("getComputedStyle(document.querySelector('.cm-line')).color") != 'rgb(28, 28, 30)'

    print(*[f'{k} => {v}' for k, v in res.items()], sep='\n')
    ok = all(res.values()) and not errs
    print('PASS' if ok else 'FAIL', errs); b.close(); sys.exit(0 if ok else 1)
