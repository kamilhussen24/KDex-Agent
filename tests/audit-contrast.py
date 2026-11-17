# Walks the main screens in light and dark and reports any button, chip, tab or link with weak text contrast.
from playwright.sync_api import sync_playwright
JS = """() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => { let stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; if (document.documentElement.dataset.theme === 'dark') base = { r: 18, g: 18, b: 20, a: 1 }; for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base); return base; };
  const out = [];
  document.querySelectorAll('.chip, .top button, .composer button, #sheet:not(.hidden) button, #sheet:not(.hidden) a, #dialog:not(.hidden) button, .toast button').forEach((el) => {
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return; if (el.disabled) return;
    const cs = getComputedStyle(el); if (parseFloat(cs.opacity) < 1) return;
    let fg = parse(cs.color); if (!fg) return; const bg = bgOf(el); fg = over(fg, bg);
    const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
    const t = (el.innerText || el.getAttribute('aria-label') || el.id || '').trim().slice(0, 24);
    if (ratio < 4.5) out.push(t + ' ' + ratio.toFixed(2));
  });
  return out;
}"""
bad = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for mode in ('light', 'dark'):
        pg = b.new_context(viewport={'width': 360, 'height': 740}, color_scheme=mode).new_page()
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        def chk(name):
            r = pg.evaluate(JS); print(mode, name, r)
            bad.extend([mode + ' ' + name + ': ' + x for x in r])
        chk('main'); pg.click('#topFolderBtn'); pg.wait_for_timeout(300); chk('projects')
        pg.click('#pClone'); pg.wait_for_selector('#cUrl'); pg.fill('#cUrl', 'http://127.0.0.1:4020/remote.git'); pg.fill('#cTok', 'tok'); pg.click('#cGo')
        pg.wait_for_selector('#gPull', timeout=30000); pg.wait_for_timeout(500); chk('git')
        for t in ('Branches', 'History', 'Remote'):
            pg.click('.tab:has-text("%s")' % t) if pg.locator('.tab:has-text("%s")' % t).count() else None; pg.wait_for_timeout(500); chk('git-' + t)
        pg.click('#sheetClose'); pg.wait_for_timeout(300)
        pg.click('#chipTerm'); pg.wait_for_timeout(400); pg.click('#tSeg [data-v="1"]'); pg.wait_for_timeout(400); chk('terminal')
        pg.click('#sheetClose'); pg.wait_for_timeout(300)
        pg.click('#chipFiles'); pg.wait_for_timeout(400); chk('files'); pg.click('#sheetClose'); pg.wait_for_timeout(300)
        pg.click('#menuBtn'); pg.wait_for_timeout(300); pg.click('#dSettings'); pg.wait_for_timeout(500)
        for y in (0, 500, 1000, 1500, 2200):
            pg.eval_on_selector('#sheetBody', '(e,y)=>e.scrollTop=y', y); pg.wait_for_timeout(150); chk('settings@%d' % y)
        pg.click('#gitId'); pg.wait_for_timeout(500); chk('identity')
        pg.click('#sheetBack'); pg.wait_for_timeout(400)
        pg.eval_on_selector('#sheetBody', 'e=>e.scrollTop=e.scrollHeight'); pg.wait_for_timeout(200)
        pg.click('text=Delete all conversations'); pg.wait_for_timeout(400); chk('dialog')
        pg.click('#dlgNo'); pg.wait_for_timeout(200)
        pg.click('#sheetClose'); pg.context.close()
    b.close()
print('WEAK:', sorted(set(bad)))
