from playwright.sync_api import sync_playwright
HOOK="""window.__calls=[];window.__kdexTermux=async(o)=>{window.__calls.push(o.command);
 if(/nohup/.test(o.command)) return {stdout:'Started job web (pid 123). Check it with check_job.',stderr:'',exitCode:0};
 if(/tail -n/.test(o.command)&&/RUNNING/.test(o.command)) return {stdout:'[RUNNING pid 123]\\nServing HTTP on 0.0.0.0 port 8080',stderr:'',exitCode:0};
 return {stdout:'a.txt\\nb.txt\\n',stderr:'',exitCode:0};};"""
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append(str(e))); pg.add_init_script(HOOK)
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2600)
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(300); pg.click('#setTerm [data-v="1"]'); pg.wait_for_selector('#tmTest'); pg.click('#tmPath'); pg.fill('#dlgInput','/data/data/com.termux/files/home/demo'); pg.click('#dlgYes'); pg.wait_for_timeout(300); pg.click('#sheetClose')
        # 1) plan + background job
        pg.fill('#input','plantest'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000); pg.screenshot(path=f'shots/j-{mode}-1-approve.png')
        print(mode,'start_job card has Always?',pg.query_selector('[data-tool=always]') is not None)
        pg.click('[data-tool=apply]'); pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=10000); pg.wait_for_timeout(300)
        print(mode,'plan cards:',len(pg.query_selector_all('.plan')),'|',pg.inner_text('.plan').replace('\n',' / '))
        pg.screenshot(path=f'shots/j-{mode}-2-done.png'); print(mode,'calls:',[c[:40] for c in pg.evaluate('window.__calls')])
        # 2) always allow
        pg.click('#topNewBtn'); pg.wait_for_timeout(300)
        pg.fill('#input','allowtest'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=always]',timeout=8000); print(mode,'always label:',pg.inner_text('[data-tool=always]'))
        pg.click('[data-tool=always]'); pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=10000)
        pg.fill('#input','allowtest again'); pg.click('#sendBtn'); pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=10000); pg.wait_for_timeout(300)
        print(mode,'second run asked?',pg.query_selector('[data-tool=apply]') is not None,'| allowed tag:',any('allowed' in e.inner_text() for e in pg.query_selector_all('.tf')),'| ls calls:',sum(1 for c in pg.evaluate('window.__calls') if c=='ls'))
        pg.screenshot(path=f'shots/j-{mode}-3-allow.png'); print(mode,logs)
    b.close()
