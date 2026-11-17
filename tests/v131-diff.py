import base64
PNG=base64.b64encode(bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0000003010100c9fe92ef0000000049454e44ae426082')).decode()
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ('light', 'dark'):
        pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, color_scheme=mode).new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn'); pg.click('#topFolderBtn'); pg.click('#pClone'); pg.wait_for_selector('#cUrl')
        pg.fill('#cUrl', 'http://127.0.0.1:4020/remote.git'); pg.fill('#cTok', 'tok'); pg.click('#cGo')
        pg.wait_for_selector('#gPull', timeout=30000); pg.wait_for_timeout(400); pg.click('#sheetClose'); pg.wait_for_timeout(300)
        pg.evaluate("""async (b64) => {
          const db = await import('./js/db.js'); const N = await import('./js/native.js');
          const folders = await db.kvGet('folders', []); const f = folders[folders.length - 1];
          const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          await N.fs.writeBytes(f.uri, 'logo.png', bin);
        }""", PNG)
        pg.click('#chipGit'); pg.wait_for_selector('[data-gf]', timeout=15000); pg.wait_for_timeout(800)
        pg.click('[data-gf="logo.png"]'); pg.wait_for_timeout(1000)
        t = pg.inner_text('#sheetBody'); print(mode, 'binary diff ->', t.replace('\n', ' | '))
        assert 'New' in t and 'Binary file' in t
        pg.screenshot(path=f'shots/v131-bindiff-{mode}.png')
        pg.click('#sheetClose'); pg.wait_for_timeout(300)
        pg.click('#chipFiles'); pg.wait_for_selector('[data-p="logo.png"]', timeout=8000); pg.click('[data-p="logo.png"]')
        pg.wait_for_selector('.imgview img', timeout=8000); pg.wait_for_timeout(500)
        t = pg.inner_text('#sheetBody'); print(mode, 'image view ->', t.replace('\n', ' | '))
        assert '1 \u00d7 1' in t and '70 B' in t
        pg.screenshot(path=f'shots/v131-img-{mode}.png')
        print(mode, errs); pg.context.close()
    b.close()
