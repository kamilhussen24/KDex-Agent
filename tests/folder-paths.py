from playwright.sync_api import sync_playwright
HOOK="window.__kdexTermux=async(o)=>({stdout:'ok\\n',stderr:'',exitCode:0});"
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        for w in (320,360):
            ctx=b.new_context(viewport={'width':w,'height':740},device_scale_factor=1.5,color_scheme=mode); pg=ctx.new_page(); errs=[]
            pg.on('pageerror',lambda e: errs.append(str(e))); pg.add_init_script(HOOK); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
            pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
            pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
            pg.evaluate("""async()=>{const D=await import('/js/db.js'); const row=(await D.db.all('kv')).find(r=>r.key==='folders'); const f=row.value[row.value.length-1]; await D.db.put('kv',{key:'termux-path:'+f.id,value:'/storage/emulated/0/Documents/Projects/telegram-bot-v3-final'});}""")
            pg.click('#topFolderBtn'); pg.wait_for_selector('.fpath'); pg.wait_for_timeout(300)
            print(mode,w,'path shown:',pg.inner_text('.fpath'),'| copy buttons:',len(pg.query_selector_all('[data-cp]')))
            pg.screenshot(path=f'shots/f/{mode}-{w}-folders.png')
            ov=pg.evaluate("[...document.querySelectorAll('.row-item')].some(r=>r.scrollWidth>r.clientWidth+1)"); print('  overflow:',ov,'errs',errs)
            ctx.close()
    b.close()
