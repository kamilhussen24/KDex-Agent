from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ('light', 'dark'):
        pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, color_scheme=mode).new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.click('#topFolderBtn'); pg.wait_for_selector('#pPath')
        print(mode, 'buttons:', [t.strip() for t in pg.eval_on_selector_all('#sheetBody > .btn', 'els=>els.map(e=>e.innerText)')])
        pg.click('#pPath'); pg.wait_for_selector('#opPath')
        pg.fill('#opPath', '/storage/emulated/0/missing/folder'); pg.wait_for_timeout(700); m1 = pg.inner_text('#opMsg')
        pg.fill('#opPath', '/storage/emulated/0/notes.txt'); pg.wait_for_timeout(700); m2 = pg.inner_text('#opMsg')
        pg.fill('#opPath', '/storage/emulated/0/Venter/HopWeb/Projects/KDex-Agent'); pg.wait_for_timeout(700); m3 = pg.inner_text('#opMsg')
        print(mode, '| missing ->', m1, '| file ->', m2, '| good ->', m3)
        assert 'No such' in m1 and 'file, not a folder' in m2 and 'Folder found' in m3
        pg.screenshot(path=f'shots/open-path-{mode}.png')
        pg.click('#opGo'); pg.wait_for_selector('#chipFiles:not(.hidden)', timeout=6000)
        print(mode, 'opened, chip:', pg.inner_text('#chipFiles'), '| folder chip:', pg.inner_text('#topFolderBtn') if pg.query_selector('#topFolderBtn') else '')
        pg.click('#chipFiles'); pg.wait_for_selector('[data-p]'); print(mode, 'files:', pg.eval_on_selector_all('[data-p]', 'e=>e.map(x=>x.dataset.p)'))
        print(mode, errs); pg.context.close()
    b.close()
