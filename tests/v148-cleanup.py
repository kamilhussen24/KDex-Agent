SH = '/tmp/kt/shots/'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    pg.fill('#input', 'hello'); pg.click('#sendBtn'); pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')"); pg.wait_for_timeout(300)
    seed = """async()=>{const D=await import('./js/db.js');const chats=await D.db.all('chats');const id=chats[0].id;const old=Date.now()-60*86400000;
      await D.db.put('backups',{chatId:id,folderId:'x',path:'a.txt',existed:true,content:'x'.repeat(40000),op:'edit',at:old,undone:false});
      await D.db.put('backups',{chatId:id,folderId:'x',path:'b.txt',existed:true,content:'y'.repeat(1000),op:'edit',at:Date.now(),undone:false});
      await D.db.put('scratch',{k:'ghost\\u0000a.txt',chatId:'ghost',path:'a.txt',data:new Uint8Array(20000),size:20000,mtime:old});
      await D.db.put('messages',{chatId:id,role:'user',text:'pic',images:[{mime:'image/png',data:'A'.repeat(60000)}],at:Date.now(),status:'done'});return id}"""
    cid = pg.evaluate(seed)
    pg.tap('#menuBtn'); pg.wait_for_timeout(600); pg.tap('#dSettings')
    pg.wait_for_selector('#clFreeBtn'); pg.wait_for_timeout(500)
    print('used/free:', pg.inner_text('#clUsed'), '/', pg.inner_text('#clFree'))
    pg.locator('#clFreeBtn').scroll_into_view_if_needed(); pg.screenshot(path=SH + 'v148-cleanup.png')
    pg.click('#clFreeBtn'); pg.wait_for_selector('#dialog:not(.hidden)'); print('dlg:', pg.inner_text('#dlgTitle'), '|', pg.inner_text('#dlgText')); pg.click('#dlgYes'); pg.wait_for_timeout(600)
    print('after:', pg.inner_text('#clUsed'), '/', pg.inner_text('#clFree'), '| toast:', pg.inner_text('#toast').replace('\n', ' '))
    print('backups left:', pg.evaluate("(async()=>{const D=await import('./js/db.js');return (await D.db.all('backups')).map(b=>b.path)})()"), '| ghost scratch left:', pg.evaluate("(async()=>{const S=await import('./js/scratch.js');return (await S.scratchUsage()).length})()"))
    pg.click('#clPics'); pg.wait_for_selector('#dialog:not(.hidden)'); print('pics dlg:', pg.inner_text('#dlgTitle'), '|', pg.inner_text('#dlgText')); pg.click('#dlgYes'); pg.wait_for_timeout(900)
    print('pictures left:', pg.evaluate("(async()=>{const D=await import('./js/db.js');return (await D.db.all('messages')).filter(m=>m.images&&m.images.length).length})()"), '| chat shows:', pg.evaluate("[...document.querySelectorAll('.gone')].map(e=>e.textContent)"))
    print('errors:', errs); b.close()
