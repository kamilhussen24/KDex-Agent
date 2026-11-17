# Saved commands show a short status with Show output; git in Termux gets the project folder added to safe.directory once.
from playwright.sync_api import sync_playwright
STDERR = "fatal: detected dubious ownership in repository at '/storage/emulated/0/Bitget/Ff'\\nTo add an exception for this directory, call:\\n\\n\\tgit config --global --add safe.directory /storage/emulated/0/Bitget/Ff"
HOOK = ("window.__calls=[];window.__kdexTermux=async(o)=>{window.__calls.push(o.command);"
        "if(/git status/.test(o.command)&&!/safe\\.directory/.test(o.command)) return {stdout:'',stderr:\"" + STDERR + "\",exitCode:128};"
        "if(/echo hello/.test(o.command)) return {stdout:'hello\\n',stderr:'',exitCode:0};"
        "return {stdout:'',stderr:'',exitCode:0};};")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.add_init_script(HOOK)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(300); pg.click('#setTerm [data-v="1"]'); pg.wait_for_selector('#tmTest'); pg.click('#tmPath'); pg.fill('#dlgInput', '/storage/emulated/0/Bitget/Ff'); pg.click('#dlgYes'); pg.wait_for_timeout(300)
    pg.click('#sheetClose'); pg.wait_for_timeout(300)
    pg.evaluate("async()=>{const D=await import('./js/db.js');const fo=await D.kvGet('folders',[]);const f=fo[fo.length-1];await D.kvSet('saved-cmds:'+f.id,[{name:'git status',cmd:'git status'},{name:'Say hello',cmd:'echo hello'}])}")
    pg.click('#chipTerm'); pg.wait_for_selector('#savedBox [data-sc=run]'); pg.wait_for_timeout(300)
    calls = lambda: pg.evaluate('window.__calls')
    run = lambda i: (pg.click('#savedBox [data-sc=run][data-i="%d"]' % i), pg.wait_for_selector('#dlgYes:visible'), pg.click('#dlgYes'), pg.wait_for_selector('#scOut .scst', timeout=10000), pg.wait_for_timeout(300))
    run(0)
    st = pg.inner_text('#scOut .scst').replace('\n', ' '); hid = pg.evaluate("document.querySelector('#scOut .scpre').classList.contains('hidden')")
    safe_calls = [c for c in calls() if 'safe.directory' in c]
    print('status:', st, '| output hidden:', hid, '| safe.directory calls:', len(safe_calls), '|', safe_calls[0][-70:] if safe_calls else '')
    pg.screenshot(path='/tmp/kt/shots/v1503-closed.png')
    pg.click('#scOut [data-sc-out]'); pg.wait_for_timeout(200)
    over = pg.evaluate("(()=>{const p=document.querySelector('#scOut .scpre');return [p.scrollWidth,p.clientWidth,getComputedStyle(p).whiteSpace]})()")
    print('opened: label =', pg.inner_text('#scOut [data-sc-out]').strip(), '| pre scrollWidth/clientWidth/whitespace:', over)
    pg.screenshot(path='/tmp/kt/shots/v1503-open.png')
    pg.click('#scOut [data-sc-out]'); hid2 = pg.evaluate("document.querySelector('#scOut .scpre').classList.contains('hidden')")
    run(0); n2 = len([c for c in calls() if 'safe.directory' in c])
    run(1); st2 = pg.inner_text('#scOut .scst').replace('\n', ' ')
    print('second git run safe calls still:', n2, '| echo status:', st2, '| non-git adds no safe call:', len([c for c in calls() if 'safe.directory' in c]) == n2)
    pg.screenshot(path='/tmp/kt/shots/v1503-done.png')
    ok = ('Failed: git status · exit 128' in st) and hid and len(safe_calls) == 1 and over[0] <= over[1] + 1 and over[2] == 'pre-wrap' and hid2 and n2 == 1 and st2.startswith('Done: Say hello') and not errs
    print('PASS' if ok else 'FAIL', errs[:2]); b.close(); raise SystemExit(0 if ok else 1)
