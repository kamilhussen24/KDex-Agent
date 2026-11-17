from playwright.sync_api import sync_playwright
INIT = """
window.__seen = [];
const tick = () => { const a = document.getElementById('app'); const s = document.getElementById('setup'); if (a && s) window.__seen.push([document.documentElement.classList.contains('ready'), getComputedStyle(a).visibility, s.classList.contains('hidden')]); };
setInterval(tick, 4);
"""
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ('light', 'dark'):
        for first in (True, False):
            pg = b.new_context(viewport={'width': 360, 'height': 740}, color_scheme=mode).new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.add_init_script(INIT)
            pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(1200)
            if not first:
                pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn'); pg.evaluate("window.__seen = []"); pg.reload(); pg.wait_for_timeout(1500)
            seen = pg.evaluate('window.__seen')
            flash = [x for x in seen if x[1] == 'visible' and x[2] is True and not x[0]]
            ready = pg.evaluate("document.documentElement.classList.contains('ready')")
            vis = pg.eval_on_selector('#app', 'e=>getComputedStyle(e).visibility') if not first else 'n/a'
            print(mode, 'first run' if first else 'returning', '| samples', len(seen), '| chat shown before ready:', len(flash), '| ready:', ready, '| app visibility:', vis, errs)
            assert not flash and ready
            pg.context.close()
    b.close()
