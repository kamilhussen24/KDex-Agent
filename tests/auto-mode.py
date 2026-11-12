from playwright.sync_api import sync_playwright
HOOK="window.__calls=[];window.__kdexTermux=async(o)=>{window.__calls.push(o.command);return {stdout:'a.txt\\n',stderr:'',exitCode:0};};"
def idle(pg): pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=10000); pg.wait_for_timeout(250)
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append(str(e))); pg.add_init_script(HOOK)
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2600)
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(300); pg.click('#setTerm [data-v="1"]'); pg.wait_for_selector('#tmTest'); pg.click('#tmPath'); pg.fill('#dlgInput','/data/data/com.termux/files/home/demo'); pg.click('#dlgYes'); pg.wait_for_timeout(300); pg.click('#sheetClose')
        print(mode,'chip:',pg.inner_text('#chipAuto'))
        # ask mode: asks
        pg.fill('#input','allowtest'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000); print(mode,'ask mode asks: True'); pg.click('[data-tool=apply]'); idle(pg)
        # turn on Auto while a command waits
        pg.click('#topFolderBtn'); pg.wait_for_selector('[data-nf]'); pg.click('[data-nf]'); pg.wait_for_timeout(400)
        pg.fill('#input','allowtest 2'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000)
        pg.click('#chipAuto'); idle(pg); print(mode,'pending auto-approved on toggle; chip:',pg.inner_text('#chipAuto'),'| calls ls:',sum(1 for c in pg.evaluate('window.__calls') if c.split('\n')[0]=='ls'))
        pg.fill('#input','allowtest 3'); pg.click('#sendBtn'); idle(pg); print(mode,'auto runs without asking:',pg.query_selector('[data-tool=apply]') is None,'| ls calls:',sum(1 for c in pg.evaluate('window.__calls') if c.split('\n')[0]=='ls'))
        pg.fill('#input','risktest'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000); print(mode,'risky still asks:',pg.inner_text('.tool .tf .lbl'),'| rm run?',any('rm' in c for c in pg.evaluate('window.__calls')))
        pg.screenshot(path=f'shots/a-{mode}-risky.png'); pg.click('[data-tool=reject]'); idle(pg)
        print(mode,logs)
    b.close()
