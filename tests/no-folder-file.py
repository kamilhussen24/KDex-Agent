from playwright.sync_api import sync_playwright
HOOK="window.__kdexTermux=async(o)=>({stdout:'ok\\n',stderr:'',exitCode:0});"
def idle(pg): pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=12000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('dark','light'):
        ctx=b.new_context(viewport={'width':360,'height':740},device_scale_factor=1.5,color_scheme=mode,accept_downloads=True); pg=ctx.new_page(); errs=[]; reqs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('request',lambda r: reqs.append(r.post_data or '') if 'chat/completions' in r.url else None)
        pg.add_init_script(HOOK); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
        pg.click('#topNewBtn'); pg.wait_for_timeout(300)
        print(mode,'folder chip:',pg.inner_text('#chipFolderName'))
        pg.fill('#input','filetest'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=getfile]',timeout=8000); idle(pg)
        print(mode,'model told file ready:','FILEDONE' in pg.inner_text('#messages'))
        pg.screenshot(path=f'shots/f/{mode}-file-card.png')
        try:
            with pg.expect_download(timeout=5000) as d: pg.click('[data-tool=getfile]')
            print(mode,'download:',d.value.suggested_filename, open(d.value.path()).read().strip())
        except Exception as e: print(mode,'download FAILED',str(e)[:80])
        sys_ok=any('built by Kamil Hussen from KDex' in r and 'make_file' in r for r in reqs); print(mode,'system prompt has identity + make_file:',sys_ok,'| tools sent:', 'make_file' in ' '.join(reqs),'| errs',errs)
    b.close()
