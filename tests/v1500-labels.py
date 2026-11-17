from playwright.sync_api import sync_playwright
HOOK="window.__calls=[];window.__kdexTermux=async(o)=>{window.__calls.push(o.command);return {stdout:'a.txt\\n',stderr:'',exitCode:0};};"
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=10000); pg.wait_for_timeout(250)
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light',):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append(str(e))); pg.add_init_script(HOOK)
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2600)
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(300); pg.click('#setTerm [data-v="1"]'); pg.wait_for_selector('#tmTest'); pg.click('#tmPath'); pg.fill('#dlgInput','/data/data/com.termux/files/home/demo'); pg.click('#dlgYes'); pg.wait_for_timeout(300); pg.click('#sheetClose')
        print(mode,'chip:',pg.inner_text('#chipAuto'))
        import re
        pg.fill('#input','outtest'); pg.click('#sendBtn'); idle(pg)
        pg.fill('#input','v145gen'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000)
        names=[x.inner_text() for x in pg.query_selector_all('.tool .th .nm')]
        foots=[x.inner_text() for x in pg.query_selector_all('.tool .tf .lbl')]
        print('card names:',names); print('footers:',foots)
        txt=pg.inner_text('#messages'); snake=re.findall(r'\b[a-z]+_[a-z_]+\b',txt); print('snake_case words on screen:',snake)
        assert 'Run command' in names and all('_' not in n for n in names) and not snake
        assert any(f.startswith('Runs in Termux') for f in foots), foots
        pg.screenshot(path='/tmp/kt/shots/v1500-labels.png'); print('PASS', logs)
    b.close()
