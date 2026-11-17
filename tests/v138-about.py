import json
from playwright.sync_api import sync_playwright
REL = {'tag_name': 'v9.9.9', 'html_url': 'https://github.com/kamilhussen24/KDex-Agent/releases/tag/v9.9.9', 'body': 'notes', 'assets': [{'name': 'KDex-Agent-release.apk', 'browser_download_url': 'https://github.com/kamilhussen24/KDex-Agent/releases/download/v9.9.9/KDex-Agent-release.apk', 'size': 5242880}]}
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ('light', 'dark'):
        ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, color_scheme=mode); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        state = {'mode': 'newer'}
        def h(route):
            m = state['mode']
            if m == 'newer': route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(REL))
            elif m == 'same': route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(dict(REL, tag_name='v1.38.0')))
            elif m == '404': route.fulfill(status=404, headers={'access-control-allow-origin': '*'}, body='{}')
            else: route.abort()
        ctx.route('https://api.github.com/**', h)
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#licBtn'); pg.evaluate("document.querySelector('#licBtn').scrollIntoView()")
        print(mode, 'about:', pg.inner_text('.sheet-body').split('About')[-1].replace('\n', ' | ')[:200])
        assert 'Kamil Hussen' in pg.inner_text('.sheet-body') and pg.get_attribute('a.link', 'href') == 'https://github.com/kamilhussen24/KDex-Agent'
        pg.click('#updGo'); pg.wait_for_function("document.querySelector('#updState').textContent.includes('available')"); pg.wait_for_timeout(200)
        print(mode, 'newer:', pg.inner_text('#updState'), '|', pg.inner_text('#updBox a'), '|', pg.get_attribute('#updBox a', 'href'))
        assert '9.9.9' in pg.inner_text('#updState') and pg.get_attribute('#updBox a', 'href').endswith('.apk')
        pg.evaluate("document.querySelector('#updBox').scrollIntoView()"); pg.screenshot(path=f'shots/about-{mode}.png')
        state['mode'] = 'same'; pg.evaluate("document.querySelector('#updBox').innerHTML=''")
        pg.click('#sheetClose'); pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#updState'); pg.wait_for_timeout(300)
        print(mode, 'reopen shows cached:', pg.inner_text('#updState'))
        pg.evaluate("window.scrollTo(0,0)")
        pg.click('#licBtn'); pg.wait_for_selector('text=Eclipse JGit'); print(mode, 'licenses:', 'KDex Agent License' in pg.inner_text('.sheet-body') and 'SIL OFL' in pg.inner_text('.sheet-body'))
        pg.screenshot(path=f'shots/lic-{mode}.png'); pg.click('#sheetBack'); pg.wait_for_selector('#licBtn')
        assert not errs, errs
        ctx.close()
    # unit: version compare
    pg = b.new_context().new_page(); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(300)
    r = pg.evaluate("""async () => { const U = await import('./js/update.js'); return [U.isNewer('1.38.0','1.37.0'), U.isNewer('1.37.0','1.37.0'), U.isNewer('1.10.0','1.9.9'), U.isNewer('1.9.9','1.10.0'), U.isNewer('x','1.0.0'), U.parseVer('v2.0.1'),
      (await U.checkUpdate('1.0.0', async () => ({ status: 404, ok: false }))).none, (await U.checkUpdate('1.0.0', async () => { throw new Error('x'); })).error]; }""")
    print('unit:', r); assert r[:4] == [True, False, True, False] and r[4] is False and r[6] is True and r[7] == 'No connection'
    b.close()
