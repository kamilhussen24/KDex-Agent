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
        pg.click('#chipAuto'); pg.wait_for_timeout(300); print('auto chip:', pg.inner_text('#chipAuto'))
        calls = lambda: pg.evaluate('window.__calls')
        pg.fill('#input','outtest'); pg.click('#sendBtn'); idle(pg)
        ran = any(c.startswith('ls /etc/nginx') for c in calls()); print('Termux, Auto, outside folder, default (servers only) runs:', ran, '| card waiting:', pg.query_selector('[data-tool=apply]') is not None); assert ran
        pg.fill('#input','dumptest'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000)
        print('printenv asks in Auto:', True, '| ran:', any(c.startswith('printenv') for c in calls())); assert not any(c.startswith('printenv') for c in calls())
        al = pg.evaluate("[...document.querySelectorAll('[data-tool=always]')].length"); print('risky card has Always allow button:', al > 0); assert al == 0
        pg.click('[data-tool=reject]'); idle(pg)
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#setOut'); pg.click('#setOut [data-v=all]'); pg.wait_for_timeout(300); pg.keyboard.press('Escape'); pg.mouse.click(5, 5); pg.wait_for_timeout(300)
        pg.reload(); pg.wait_for_timeout(1500)
        n0 = len(calls()) if False else 0
        pg.fill('#input','outtest'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000)
        txt = pg.inner_text('#messages'); print('with Ask always: card waits:', True, '| yellow line:', 'Outside the start folder' in txt, '| footer outside:', 'outside folder' in txt); assert 'Outside the start folder' in txt
        al2 = pg.evaluate("document.querySelectorAll('[data-tool=always]').length"); print('outside-folder ask card has Always allow button:', al2 > 0); assert al2 == 0
        pg.screenshot(path='/tmp/kt/shots/v1496-outside-ask.png'); pg.click('[data-tool=reject]'); idle(pg)
        print(logs)
    b.close()
