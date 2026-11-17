from playwright.sync_api import sync_playwright
import time
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]; n={'c':0}; seen=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        def h(route):
            if 'chat/completions' in route.request.url:
                n['c']+=1
                if n['c']<=2: return route.abort('failed')
            route.continue_()
        pg.route('**/*',h); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached')
        n['c']=0
        pg.fill('#input','hello'); pg.click('#sendBtn')
        for i in range(40):
            t=pg.eval_on_selector('#netLine','e=>e.classList.contains("hidden")?"":e.innerText')
            if t: seen.append(t); 
            if t and 'Offline' in t: pg.screenshot(path=f'shots/v128-net-{mode}.png'); break
            pg.wait_for_timeout(150)
        print(mode,'during drop:',seen[:1])
        assert seen and 'Offline' in seen[0]
        pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=30000); pg.wait_for_timeout(300)
        print(mode,'after reply: line hidden:',pg.eval_on_selector('#netLine','e=>e.classList.contains("hidden")'),'| reply:','Mock' in pg.inner_text('#messages'))
        # toast open has no Copy
        pg.evaluate("window.__toast('Push refused: the branch is protected. Ask an admin or push to another branch.')"); pg.wait_for_timeout(400); pg.click('#toast'); pg.wait_for_timeout(300)
        print(mode,'open toast buttons:',pg.eval_on_selector_all('#toast button','e=>e.map(x=>x.innerText)'))
        assert pg.query_selector('#toast [data-c]') is None
        # git sheet
        pg.click('#topFolderBtn'); pg.click('#pClone'); pg.wait_for_selector('#cUrl')
        pg.fill('#cUrl','http://127.0.0.1:4020/remote.git'); pg.fill('#cTok','tok'); pg.click('#cGo')
        pg.wait_for_selector('#gPull',timeout=30000); pg.wait_for_timeout(900)
        print(mode,'tags:',pg.eval_on_selector_all('.gsum .ab','e=>e.map(x=>x.innerText)'),'| tile h:',pg.eval_on_selector('.gsum .btile','e=>e.getBoundingClientRect().height'))
        pg.screenshot(path=f'shots/v128-git-{mode}.png')
        print(mode,errs); pg.context.close()
    b.close()
