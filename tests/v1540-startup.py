# v1.54.0: Scratch "New file" and the app reopening in the last place (chat or folder). Needs the same two servers as v1540-final.py.
from playwright.sync_api import sync_playwright
exec(open('/home/claude/kdex-android/tests/v1530-editor.py').read().split("with sync_playwright() as p:")[0])
res = {}; errs = []
def ok(k, v): res[k] = bool(v); print(('PASS ' if v else 'FAIL ') + k)
def where(pg):
    pg.wait_for_selector('#modelSelect', state='attached'); pg.wait_for_timeout(700)
    return pg.evaluate("({files: !document.querySelector('#chipFiles').classList.contains('hidden'), msg: document.querySelector('#messages').innerText, top: document.querySelector('#topFolderBtn').innerText})")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); pg.set_default_timeout(12000)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    boot(pg)  # chat 1: "hi", no folder
    # scratch: New file
    pg.evaluate(JS_PUT, [[['a.txt', 'x']]]); open_scratch(pg)
    ok('Scratch has New file', pg.locator('#scNew').count() == 1)
    pg.click('#scNew'); pg.wait_for_selector('#nfDlg'); pg.fill('#nfName', 'notes.md'); pg.wait_for_timeout(150); pg.click('#nfGo'); pg.wait_for_selector('.cm-editor')
    ok('Scratch: file created and opened', pg.evaluate("document.querySelector('.ed').editor.doc") == '')
    pg.click('#sheetBack'); pg.wait_for_selector('#scNew'); ok('Back returns to Scratch', pg.locator('[data-p="notes.md"]').count() == 1); pg.screenshot(path=SHOTS + 'v154-scratch.png'); pg.click('#sheetClose')
    # chat 1 gets a folder
    pg.click('#topFolderBtn'); pg.wait_for_selector('#pPath'); pg.click('#pPath'); pg.wait_for_selector('#opPath')
    pg.fill('#opPath', '/storage/emulated/0/Venter/HopWeb/Projects/KDex-Agent'); pg.wait_for_timeout(700); pg.click('#opGo'); pg.wait_for_selector('#dialog:not(.hidden)'); pg.click('#dlgNo'); pg.wait_for_selector('#chipFiles:not(.hidden)'); pg.wait_for_timeout(400)
    # chat 2: no folder, last chat
    pg.click('#menuBtn') if pg.locator('#menuBtn').count() else None
    pg.evaluate("document.querySelector('#dNew').click()"); pg.wait_for_timeout(400)
    pg.fill('#input', 'second chat'); pg.click('#sendBtn'); pg.wait_for_timeout(1500)
    pg.reload(); w = where(pg); ok('last place = chat: opens the last chat', 'second chat' in w['msg'] and not w['files'])
    fid = pg.evaluate("import('./js/db.js').then(async m=>{const r=await m.db.get('kv','folders');return null})")
    folders = pg.evaluate("import('./js/agent.js').then(a=>a.getFolders()).then(f=>f.map(x=>x.id))"); fid = folders[0]
    pg.evaluate("id=>import('./js/db.js').then(m=>m.kvSet('lastPlace',{kind:'folder',id,at:Date.now()}))", fid)
    pg.reload(); w = where(pg); ok('last place = folder: opens that folder chat', w['files'] and 'hi' in w['msg'] and 'second chat' not in w['msg'])
    # no chat for the folder: a fresh chat linked to it
    pg.evaluate("""async id=>{const m=await import('./js/db.js');for(const c of await m.db.all('chats')) if(c.folderId===id){await m.db.del('chats',c.id);}}""", fid)
    pg.evaluate("id=>import('./js/db.js').then(m=>m.kvSet('lastPlace',{kind:'folder',id,at:Date.now()}))", fid)
    pg.reload(); w = where(pg); print(w, pg.evaluate("import('./js/db.js').then(async m=>({place:await m.kvGet('lastPlace',null),draft:await m.kvGet('draft:new',''),chats:(await m.db.all('chats')).map(c=>[c.title,c.folderId])}))"), fid); ok('folder without chat: new empty chat in that folder', w['files'] and 'second chat' not in w['msg'] and 'hi' not in w['msg'])
    pg.screenshot(path=SHOTS + 'v154-restore.png')
    # folder removed: falls back to the last chat
    pg.evaluate("import('./js/db.js').then(m=>m.kvSet('lastPlace',{kind:'folder',id:'gone',at:1}))")
    pg.reload(); w = where(pg); print(w); ok('missing folder: old behaviour, no folder, no crash', not w['files'])
    print('errors:', errs); b.close()
bad = [k for k, v in res.items() if not v]; print('PASS' if not bad and not errs else 'FAIL', bad, errs)
