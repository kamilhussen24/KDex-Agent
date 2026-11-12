from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode,w in (('light',360),('dark',320)):
        pg=b.new_context(viewport={'width':w,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); logs=[]
        pg.on('pageerror',lambda e: logs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pr=pg.evaluate("""async()=>{const g=await import('/js/git.js');
          const a=g.parseRemote('git@github.com:kamil/app.git'), c=g.parseRemote('https://tok@github.com/kamil/app.git'), d=g.parseRemote('ssh://git@gitlab.com/x/y.git');
          const r=g.explainRefusal('GH013 Repository rule violations found for refs/heads/main. Push cannot contain secrets',['Push cannot contain secrets','Stripe API Key','path: a.py:3','https://github.com/u/r/security/secret-scanning/unblock-secret/abc']);
          return [a,c,d,r]}""")
        print(mode,'parse:',pr[0]['protocol'],pr[0]['https'],'|',pr[1]['https'],'|',pr[2]['https']); print('refusal:',pr[3])
        pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn'); pg.click('#topFolderBtn'); pg.click('#pClone'); pg.wait_for_selector('#cUrl')
        pg.fill('#cUrl','http://127.0.0.1:4020/remote.git'); pg.fill('#cTok','tok'); pg.click('#cGo')
        pg.wait_for_selector('#gPull',timeout=30000)
        pg.click('[data-tab=remote]'); pg.wait_for_selector('.card.repo',timeout=15000)
        print(mode,'repo card:',pg.inner_text('.card.repo').replace('\n',' | ')[:300])
        pg.screenshot(path=f'shots/detect-{mode}.png')
        # SSH remote -> fix
        pg.click('#gRemote'); pg.wait_for_timeout(300); pg.fill('#dlgInput','git@github.com:kamil/app.git'); pg.click('#dlgYes'); pg.wait_for_timeout(2500)
        pg.click('[data-tab=remote]'); pg.wait_for_selector('[data-fix]',timeout=15000)
        print(mode,'issues:',[e.inner_text()[:60] for e in pg.query_selector_all('.warnbar')])
        pg.click('[data-fix]'); pg.wait_for_timeout(2500); pg.click('[data-tab=remote]'); pg.wait_for_timeout(1500)
        print(mode,'after fix:',pg.inner_text('.card.repo')[:200].replace('\n',' | '), 'ssh warn left:',pg.query_selector('[data-fix]') is not None)
        print(mode,'overflow:',pg.evaluate('document.documentElement.scrollWidth>innerWidth'),logs)
        pg.context.close()
    b.close()
