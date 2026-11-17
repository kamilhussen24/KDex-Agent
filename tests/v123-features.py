# Git diff, change counts, change history with diff, and the Git error card.
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ('light', 'dark'):
        pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, color_scheme=mode).new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn'); pg.click('#topFolderBtn'); pg.click('#pClone'); pg.wait_for_selector('#cUrl')
        pg.fill('#cUrl', 'http://127.0.0.1:4020/remote.git'); pg.fill('#cTok', 'tok'); pg.click('#cGo')
        pg.wait_for_selector('#gPull', timeout=30000); pg.wait_for_timeout(400)
        pg.click('#sheetClose'); pg.wait_for_timeout(300)
        # change a file in the cloned folder
        pg.evaluate("""async () => {
          const db = await import('./js/db.js'); const N = await import('./js/native.js');
          const folders = await db.kvGet('folders', []); const f = folders[folders.length - 1];
          const files = await N.fs.list(f.uri, '');
          const first = files.find((x) => !x.isDir && !x.name.startsWith('.'));
          const r = await N.fs.readText(f.uri, first.path, 100000);
          await N.fs.writeText(f.uri, first.path, r.text.replace(/\\n$/, '') + '\\nadded line one\\nadded line two\\n');
          await N.fs.writeText(f.uri, 'brand-new.txt', 'hello\\nworld\\n');
          window.__first = first.path;
        }""")
        pg.click('#chipGit'); pg.wait_for_selector('[data-gf]', timeout=15000); pg.wait_for_timeout(1500)
        hs = pg.eval_on_selector_all('.gr', 'els=>els.map(e=>Math.round(e.getBoundingClientRect().height))')
        print(mode, 'row heights:', hs, '| counts in list:', pg.locator('[data-cnt]').count())
        assert pg.locator('[data-cnt]').count() == 0 and min(hs) >= 55
        pg.click('[data-gf]'); pg.wait_for_selector('.dv', timeout=8000)
        n_add = pg.locator('.dr.add').count()
        print(mode, 'diff add rows:', n_add, '| summary:', pg.inner_text('.dsum') if pg.locator('.dsum').count() else 'none')
        assert n_add >= 1
        pg.screenshot(path=f'shots/v123-diff-{mode}.png')
        pg.click('#sheetBack'); pg.wait_for_timeout(400)
        # error card
        d = pg.evaluate("window.__errTest('Push rejected: the remote has newer commits. Pull first.')")
        d2 = pg.evaluate("window.__errTest('The token was rejected on github.com: it is wrong, expired or revoked.')")
        d3 = pg.evaluate("window.__errTest('No connection to github.com. Check the internet and try again.')")
        print(mode, 'errors ->', d['title'], d['fix'], '|', d2['title'], d2['fix'], '|', d3['title'], d3['fix'])
        assert d['fix'] == 'pull' and d2['fix'] == 'token' and d3['fix'] == 'retry'
        print(mode, errs)
        pg.context.close()
    b.close()
