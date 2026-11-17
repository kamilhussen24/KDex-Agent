# v1.52.7: a protected secret file (.env) in Scratch keeps Rename hidden, and Copy asks first.
from playwright.sync_api import sync_playwright
def menu(pg): return pg.evaluate("[...document.querySelectorAll('#rowMenu button')].map(b=>b.innerText.trim())")
def calm(pg): pg.wait_for_function("!document.querySelector('#toast.show')", timeout=8000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(10000)
    pg.add_init_script("window.__clip=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async(t)=>{window.__clip.push(t)},readText:async()=>''}})")
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(500)
    pg.fill('#input', 'filetest'); pg.click('#sendBtn'); pg.wait_for_selector('#stopBtn.hidden', state='attached', timeout=20000); pg.wait_for_timeout(5000)
    pg.evaluate("""(async () => { const d = await import('/js/db.js'); const n = await import('/js/native.js'); const sc = await import('/js/scratch.js');
      const id = (await d.db.get('kv', 'lastChat')).value; await n.fs.writeText(sc.scratchUri(id), '.env', 'API_KEY=sk-test-123456\\n'); })()""")
    pg.wait_for_selector('#chipScratch:not(.hidden)', timeout=15000); pg.click('#chipScratch'); pg.wait_for_selector('#sheet .row-item[data-p]'); pg.wait_for_timeout(300)
    names = pg.eval_on_selector_all('#sheet [data-p]', 'e=>e.map(x=>x.dataset.p)'); print('scratch files:', names); assert '.env' in names
    pg.click('#sheet [data-p=".env"]'); pg.wait_for_selector('#rowMenu'); m = menu(pg); print('.env menu:', m); assert 'Copy' in m and 'Rename' not in m
    pg.click('#rowMenu [data-a=copy]'); pg.wait_for_selector('#dlgYes'); print('ask:', pg.inner_text('#dlgTitle'), '|', pg.inner_text('#dlgText')); pg.screenshot(path='/tmp/kt/shots/v1527-secret-copy-ask.png')
    assert pg.evaluate('window.__clip') == []
    pg.click('#dlgNo'); pg.wait_for_timeout(400); print('after No, clipboard:', pg.evaluate('window.__clip')); assert pg.evaluate('window.__clip') == []
    calm(pg); pg.click('#sheet [data-p=".env"]'); pg.wait_for_selector('#rowMenu'); pg.click('#rowMenu [data-a=copy]'); pg.wait_for_selector('#dlgYes'); pg.click('#dlgYes'); pg.wait_for_selector('#toast.show')
    print('after Copy:', pg.inner_text('#toast'), pg.evaluate('window.__clip')); assert pg.evaluate('window.__clip') == ['API_KEY=sk-test-123456\n']
    print('errors:', errs); b.close()
