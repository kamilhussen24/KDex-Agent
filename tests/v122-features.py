# Secret scan, syntax colours, file viewer and Diagnostics log.
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ('light', 'dark'):
        pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, color_scheme=mode).new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        fake = 'gh' + 'p_' + 'a1B2' * 9  # built at run time, never a literal secret in this file
        r = pg.evaluate("""async (fake) => {
          const N = await import('./js/native.js'); const G = await import('./js/git.js');
          const f = await N.fs.pickFolder();
          await N.fs.writeText(f.uri, 'deploy.sh', 'TOKEN=' + fake + '\\necho hi\\n');
          await N.fs.writeText(f.uri, 'ok.js', 'const a = 1;\\n');
          const found = await G.scanSecrets(f, [{ path: 'deploy.sh', kind: 'new' }, { path: 'ok.js', kind: 'new' }]);
          return { found, leak: JSON.stringify(found).includes(fake) };
        }""", fake)
        print(mode, 'scan:', r['found'], '| value leaked:', r['leak'])
        assert len(r['found']) == 1 and r['found'][0]['path'] == 'deploy.sh' and not r['leak']
        h = pg.evaluate("""async () => { const H = await import('./js/highlight.js'); return H.highlight('const x = "a<b"; // hi', 'js'); }""")
        print(mode, 'highlight:', h)
        assert 'tk-k' in h and 'tk-s' in h and 'tk-c' in h and '&lt;' in h
        # file viewer
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipFiles:not(.hidden)'); pg.click('#chipFiles'); pg.wait_for_selector('[data-p="app"]'); pg.click('[data-p="app"]'); pg.wait_for_selector('[data-p="app/main.py"]'); pg.click('[data-p="app/main.py"]')
        pg.wait_for_selector('.fv', timeout=8000)
        print(mode, 'viewer:', pg.inner_text('.fv-meta'), '| keywords coloured:', pg.locator('.fv .tk-k').count())
        assert pg.locator('.fv .tk-k').count() >= 2
        pg.screenshot(path=f'shots/v122-viewer-{mode}.png')
        pg.click('#sheetClose')
        # diagnostics
        pg.evaluate("""async () => { const D = await import('./js/diag.js'); D.log('git', 'Push failed: token ' + 'gh' + 'p_' + 'Zz9'.repeat(12)); D.log('error', 'boom'); }""")
        pg.wait_for_timeout(200)
        pg.click('#menuBtn') if pg.query_selector('#menuBtn') else None
        pg.evaluate("""async () => { const m = await import('./js/diag.js'); window.__d = await m.entries(); }""")
        d = pg.evaluate('window.__d')
        print(mode, 'diag entries:', [(e['k'], e['m'][:40]) for e in d[:2]])
        assert not any('Zz9Zz9' in e['m'] for e in d)
        print(mode, 'errs', errs)
        pg.context.close()
    b.close()
