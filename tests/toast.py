from playwright.sync_api import sync_playwright
msgs = ['Copied', 'Cannot push: no connection', 'Nothing left to commit.', 'Git repository found · main · github.com/kamilhussen24/KDex-Agent', 'Using KDex-Agent in this chat', 'Could not save the file: permission denied by Android', 'Remote added: https://github.com/kamilhussen24/some-very-long-repository-name-for-testing-purposes/tree/main/folder/file.txt']
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ('light', 'dark'):
        pg = b.new_context(viewport={'width': 360, 'height': 640}, device_scale_factor=2, color_scheme=mode).new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        for i, m in enumerate(msgs):
            pg.evaluate("m => window.__toast(m)", m)
            pg.wait_for_timeout(450)
            cls = pg.get_attribute('#toast', 'class')
            box = pg.eval_on_selector('#toast', 'e=>{const r=e.getBoundingClientRect();return [Math.round(r.left),Math.round(r.right),Math.round(r.height)]}')
            print(mode, i, cls, box, pg.inner_text('#toast').replace('\n', ' | '))
            assert box[0] >= 0 and box[1] <= 360, 'overflow'
            pg.screenshot(path=f'shots/toast-{mode}-{i}.png', clip={'x': 0, 'y': 0, 'width': 360, 'height': 110})
        long = pg.inner_text('#toast')
        print(mode, 'long url shown:', long.replace('\n', ' | '))
        assert '\u2026' in long
        pg.click('#toast'); pg.wait_for_timeout(350)
        full = pg.inner_text('#toast'); print(mode, 'after tap has full url + Copy:', 'file.txt' in full and 'Copy' in full)
        assert 'folder/file.txt' in full and 'Copy' not in full
        box = pg.eval_on_selector('#toast', 'e=>{const r=e.getBoundingClientRect();return [r.left,r.right]}'); assert box[0] >= 0 and box[1] <= 360
        pg.screenshot(path=f'shots/toast-long-{mode}.png', clip={'x': 0, 'y': 0, 'width': 360, 'height': 200})
        print(mode, errs)
        pg.context.close()
    b.close()
