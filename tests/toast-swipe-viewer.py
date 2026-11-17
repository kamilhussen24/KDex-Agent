from playwright.sync_api import sync_playwright
def lum(c):
    r,g,b=[int(x) for x in c.replace('rgba(','').replace('rgb(','').replace(')','').split(',')[:3]]; return (r*299+g*587+b*114)/1000
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ('light', 'dark'):
        pg = b.new_context(viewport={'width': 360, 'height': 640}, device_scale_factor=2, color_scheme=mode).new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.evaluate("m => window.__toast(m)", 'Reported. Thank you.'); pg.wait_for_timeout(450)
        bg = pg.eval_on_selector('#toast', 'e=>getComputedStyle(e).backgroundColor'); l = lum(bg)
        print(mode, 'pill background', bg, 'lum', round(l)); assert (l > 150) if mode == 'light' else (l < 100)
        pg.screenshot(path=f'shots/toast-theme-{mode}.png', clip={'x':0,'y':0,'width':360,'height':100})
        for name, dx, dy in (('right', 160, 0), ('left', -160, 0), ('up', 0, -80)):
            pg.evaluate("m => window.__toast(m)", 'Swipe test ' + name); pg.wait_for_timeout(450)
            box = pg.eval_on_selector('#toast', 'e=>{const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}')
            pg.mouse.move(box[0], box[1]); pg.mouse.down(); pg.mouse.move(box[0]+dx/2, box[1]+dy/2, steps=4); pg.mouse.move(box[0]+dx, box[1]+dy, steps=4); pg.mouse.up(); pg.wait_for_timeout(500)
            hidden = pg.eval_on_selector('#toast', 'e=>e.classList.contains("hidden")')
            print(mode, 'swipe', name, 'dismissed:', hidden); assert hidden
        pg.evaluate("m => window.__toast(m)", 'Short drag stays'); pg.wait_for_timeout(450)
        box = pg.eval_on_selector('#toast', 'e=>{const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}')
        pg.mouse.move(box[0], box[1]); pg.mouse.down(); pg.mouse.move(box[0]+20, box[1], steps=3); pg.mouse.up(); pg.wait_for_timeout(400)
        print(mode, 'small drag stays:', not pg.eval_on_selector('#toast', 'e=>e.classList.contains("hidden")'))
        # viewer: pdf is not shown as text
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipFiles:not(.hidden)')
        pg.evaluate("""async () => { const db = await import('./js/db.js'); const N = await import('./js/native.js');
          const f = (await db.kvGet('folders', [])).slice(-1)[0];
          await N.fs.writeText(f.uri, 'report.pdf', '%PDF-1.4\\n%\\ufffd\\ufffd\\ufffd\\ufffd\\n1 0 obj\\n'); }""")
        pg.click('#chipFiles'); pg.wait_for_selector('[data-p="report.pdf"]'); pg.click('[data-p="report.pdf"]'); pg.wait_for_selector('.nofile', timeout=6000)
        print(mode, 'pdf viewer:', pg.inner_text('.nofile').replace('\n', ' | '), '| code lines shown:', pg.locator('.fv').count())
        assert pg.locator('.fv').count() == 0
        pg.screenshot(path=f'shots/viewer-pdf-{mode}.png')
        print(mode, errs); pg.context.close()
    b.close()
