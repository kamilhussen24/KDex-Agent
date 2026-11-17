from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached')
        # seed chats and folders
        pg.evaluate("""async()=>{const D=await import('./js/db.js');const now=Date.now();
          for(const [i,t] of ['Alpha','Beta','Gamma'].entries()) await D.db.put('chats',{id:'c'+i,title:t,updated:now-i*60000,model:'',think:'off',folderId:null});
          const fo=['niloyfx','Ff','kdex-android','alpha-site','beta-bot','Gamma-ui','delta'].map((n,i)=>({id:'f'+i,name:n,uri:'content://x/'+n,used:n==='Ff'?now-86400000:(n==='delta'?now-3000:undefined)}));
          await D.kvSet('folders',fo)}""")
        pg.reload(); pg.wait_for_timeout(700)
        pg.click('#menuBtn'); pg.wait_for_timeout(400)
        print(mode,'rows:',pg.inner_text('#chatList').replace('\n',' | ')[:120])
        # pin Beta
        pg.click('[data-id=c1] [data-menu]'); pg.wait_for_selector('#rowMenu'); print(mode,'menu:',pg.inner_text('#rowMenu').replace('\n',' / '))
        pg.screenshot(path=f'shots/v143-menu-{mode}.png'); pg.click('#rowMenu [data-a=pin]'); pg.wait_for_timeout(400)
        print(mode,'after pin:',pg.inner_text('#chatList').replace('\n',' | ')[:140])
        # rename Gamma
        pg.click('[data-id=c2] [data-menu]'); pg.click('#rowMenu [data-a=rename]'); pg.wait_for_selector('#dlgInput'); print(mode,'rename prefill:',pg.input_value('#dlgInput'))
        pg.fill('#dlgInput','Renamed chat'); pg.screenshot(path=f'shots/v143-rename-{mode}.png'); pg.click('#dlgYes'); pg.wait_for_timeout(400)
        print(mode,'after rename:',pg.inner_text('#chatList').replace('\n',' | ')[:140])
        # empty rename ignored
        pg.click('[data-id=c0] [data-menu]'); pg.click('#rowMenu [data-a=rename]'); pg.wait_for_selector('#dlgInput'); pg.fill('#dlgInput','  '); pg.click('#dlgYes'); pg.wait_for_timeout(300)
        print(mode,'empty rename keeps:', 'Alpha' in pg.inner_text('#chatList'))
        # a tap on another chat while the menu is open only closes the menu
        pg.evaluate("window.__opened=0"); 
        pg.click('[data-id=c0] [data-menu]'); pg.wait_for_selector('#rowMenu')
        before=pg.evaluate("document.querySelector('#chatList .on')?.dataset.id||''")
        pg.mouse.click(150, 190); pg.wait_for_timeout(300)
        after=pg.evaluate("document.querySelector('#chatList .on')?.dataset.id||''")
        print(mode,'tap on a chat row with menu open: menu closed:',pg.query_selector('#rowMenu') is None,'| chat switched:',before!=after,'| drawer still open:',pg.is_visible('#chatList'))
        # menu closes on outside tap
        pg.click('[data-id=c0] [data-menu]'); pg.wait_for_selector('#rowMenu'); pg.mouse.click(300,700); pg.wait_for_timeout(200); print(mode,'menu closed on outside tap:', pg.query_selector('#rowMenu') is None, '| scrim gone:', pg.query_selector('#rowScrim') is None)
        # delete via menu
        pg.click('[data-id=c0] [data-menu]'); pg.click('#rowMenu [data-a=del]'); pg.wait_for_selector('#dialog:not(.hidden)'); pg.click('#dlgYes'); pg.wait_for_timeout(400)
        print(mode,'after delete:',pg.inner_text('#chatList').replace('\n',' | ')[:140])
        pg.screenshot(path=f'shots/v143-list-{mode}.png')
        # folders
        pg.keyboard.press('Escape'); pg.click('#chatSearch'); 
        pg.evaluate("document.querySelector('#sheetClose')&&0")
        # open projects sheet from drawer
        pg.click('text=Projects'); pg.wait_for_selector('#pOpen'); pg.wait_for_timeout(500)
        names=pg.evaluate("[...document.querySelectorAll('.frow .t')].map(e=>e.textContent)"); subs=pg.evaluate("[...document.querySelectorAll('.frow .s')].map(e=>e.textContent)")
        print(mode,'order:',names); print(mode,'subs:',subs)
        print(mode,'search visible:',pg.is_visible('#fQ'))
        pg.fill('#fQ','ta'); pg.wait_for_timeout(200); print(mode,'filter "ta":',pg.evaluate("[...document.querySelectorAll('.frow')].filter(e=>e.style.display!=='none').map(e=>e.querySelector('.t').textContent)"))
        pg.screenshot(path=f'shots/v143-folders-{mode}.png')
        # delete-all keeps pinned
        pg.evaluate("1"); 
        print(mode,'errors:',errs)
    # fewer than 6 folders: no search box
    pg=b.new_context(viewport={'width':360,'height':740}).new_page()
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached')
    pg.evaluate("""async()=>{const D=await import('./js/db.js');await D.kvSet('folders',[{id:'a',name:'A',uri:'content://x/a'},{id:'b',name:'B',uri:'content://x/b'}])}"""); pg.reload(); pg.wait_for_timeout(600)
    pg.click('#menuBtn'); pg.click('text=Projects'); pg.wait_for_selector('#pOpen'); print('2 folders, search box:', pg.query_selector('#fQ') is not None)
    b.close()
