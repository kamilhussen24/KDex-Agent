from playwright.sync_api import sync_playwright
HOOK="window.__calls=[];window.__kdexTermux=async(o)=>{window.__calls.push(o.command);if(o.command.includes('command -v'))return {stdout:'OK git\\nOK node\\nOK npm\\nOK python3\\nMISSING pip\\nOK curl\\nOK unzip\\nOK zip\\nMISSING convert\\nMISSING pdftotext\\nMISSING ffmpeg\\nOK sqlite3\\nMISSING jq\\nMISSING php\\nMISSING go\\nMISSING rustc\\nVERSIONS\\ngit version 2.45\\nv20.1\\nPython 3.12\\nSPACE\\n/dev/x 50G 20G 30G 40% /\\n Mem: 5000 2000 1000\\n',stderr:'',exitCode:0};return {stdout:'ok\\n',stderr:'',exitCode:0};};"
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=15000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context(viewport={'width':360,'height':740}).new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e))); pg.add_init_script(HOOK)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(300)
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
    pg.fill('#input','v145tools'); pg.click('#sendBtn'); idle(pg)
    print('terminal off ->',[l for l in pg.inner_text('#messages').split('\n') if l.startswith('TOOLS') or 'terminal is off' in l][:1])
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(300); pg.click('#setTerm [data-v="1"]'); pg.wait_for_selector('#tmTest'); pg.click('#tmPath'); pg.fill('#dlgInput','/data/data/com.termux/files/home/demo'); pg.click('#dlgYes'); pg.wait_for_timeout(300); pg.click('#sheetClose'); pg.wait_for_timeout(300)
    pg.fill('#input','v145tools 2'); pg.click('#sendBtn'); idle(pg)
    print('terminal on ->',[l for l in pg.inner_text('#messages').split('\n') if l.startswith('TOOLS')][-1:])
    print('approval asked:',pg.query_selector('[data-tool=apply]') is not None,'| errors:',errs)
    b.close()
