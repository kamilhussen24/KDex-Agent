from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,has_touch=True,is_mobile=True); pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached')
    pg.evaluate("""async()=>{const D=await import('./js/db.js');const now=Date.now();
      for(const [i,t] of ['Alpha','Beta','Gamma'].entries()) await D.db.put('chats',{id:'c'+i,title:t,updated:now-i*60000,model:'',think:'off',folderId:null})}""")
    pg.reload(); pg.wait_for_timeout(700)
    pg.tap('#menuBtn'); pg.wait_for_timeout(400)
    cur=lambda: pg.evaluate("(window.__cur=document.querySelector('#chatList .on'))?document.querySelector('#chatList .on').dataset.id:''")
    print('current before:',repr(cur()))
    pg.tap('[data-id=c0] [data-menu]'); pg.wait_for_selector('#rowMenu')
    box=pg.locator('[data-id=c2] .t').bounding_box()
    pg.touchscreen.tap(box['x']+20, box['y']+8); pg.wait_for_timeout(600)
    print('after tapping chat row with menu open -> menu closed:',pg.query_selector('#rowMenu') is None,'| drawer list visible:',pg.is_visible('#chatList'),'| chat opened:',repr(cur()))
    print('errors:',errs)
    b.close()
