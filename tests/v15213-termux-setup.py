from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2).new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.add_init_script("window.__kdexTermux=async()=>{ if(window.__fail) throw new Error('Termux did not answer'); return {exitCode:0,stdout:'ok\\naarch64',stderr:''}; }")
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
    def opent():
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300); pg.click('#chipTerm'); pg.wait_for_timeout(500)
        if pg.query_selector('#tSeg [data-v="1"]:not(.on)'): pg.click('#tSeg [data-v="1"]'); pg.wait_for_timeout(500)
    vis=lambda: pg.locator('.tmsetup').count()>0
    opent(); print('fresh: steps visible', vis()); assert vis()
    pg.click('#tmTest'); pg.wait_for_selector('#tmMsg .ok'); print('after OK: steps visible', vis(), '| link', pg.locator('#tmShow').count()); assert not vis() and pg.locator('#tmShow').count()==1
    pg.click('#tmShow'); print('Show clicked: visible', vis(), '| hide link', pg.locator('#tmHide').count()); assert vis() and pg.locator('#tmHide').count()==1
    pg.click('#tmHide'); assert not vis()
    pg.keyboard.press('Escape'); pg.evaluate("document.querySelector('#sheetClose')&&document.querySelector('#sheetClose').click()"); pg.wait_for_timeout(400)
    pg.reload(); pg.wait_for_timeout(600); 
    if pg.query_selector('#sSkip'): pg.click('#sSkip')
    pg.wait_for_selector('#topFolderBtn'); opent(); print('reopen after OK: visible', vis()); assert not vis()
    pg.evaluate("window.__fail=true"); pg.click('#tmTest'); pg.wait_for_selector('#tmMsg .err'); print('after failure: visible', vis()); assert vis()
    pg.screenshot(path='shots/v15213-termux-fail.png'); print('errors', errs); print('PASS')
