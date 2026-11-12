from playwright.sync_api import sync_playwright
HOOK="window.__calls=[];window.__kdexTermux=(o)=>{window.__calls.push(o.command); if(/^ls/.test(o.command)) return new Promise(()=>{}); return Promise.resolve({stdout:'',stderr:'',exitCode:0});};"
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},color_scheme=mode).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append(str(e))); pg.add_init_script(HOOK)
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2600)
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(300); pg.click('#setTerm [data-v="1"]'); pg.wait_for_selector('#tmTest'); pg.click('#tmPath'); pg.fill('#dlgInput','/data/data/com.termux/files/home/demo'); pg.click('#dlgYes'); pg.wait_for_timeout(300); pg.click('#sheetClose')
        pg.click('#chipAuto')
        pg.fill('#input','allowtest'); pg.click('#sendBtn'); pg.wait_for_selector('.tool .st.running',timeout=8000)
        print(mode,'command hanging, status:',pg.inner_text('.tool .st'))
        pg.click('#sendBtn'); pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=4000)
        pg.wait_for_timeout(500)
        calls=pg.evaluate('window.__calls'); print(mode,'stopped, tool status:',pg.inner_text('.tool .st'),'| kill sent:',any('pgrep -f' in c and '[' in c for c in calls),'| errs',logs)
    b.close()
