# v1.52.9: the chat row menu opens below (or above) the row and never covers it, for long press and for the three dots.
from playwright.sync_api import sync_playwright
def rects(pg):
    return pg.evaluate("""()=>{const m=document.querySelector('#rowMenu').getBoundingClientRect();const r=document.querySelector('.chat-item.menu-on').getBoundingClientRect();return {mt:m.top,mb:m.bottom,ml:m.left,mr:m.right,rt:r.top,rb:r.bottom,vh:innerHeight}}""")
def ok(q): return q['mt'] >= q['rb'] - 0.5 or q['mb'] <= q['rt'] + 0.5
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    for h in (740, 330):
        pg = b.new_context(viewport={'width': 360, 'height': h}, device_scale_factor=2, has_touch=False).new_page()
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(10000)
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        pg.evaluate("""(async()=>{const d=await import('/js/db.js');for(const [i,t] of ['First chat','Second chat','Third chat'].entries()){await d.db.put('chats',{id:'c'+i,title:t,folderName:'proj',created:Date.now()-i*60000,updated:Date.now()-i*60000,messages:[]})}})()""")
        pg.reload(); pg.wait_for_timeout(600)
        try: pg.click('#sSkip', timeout=1500)
        except Exception: pass
        pg.click('#menuBtn'); pg.wait_for_selector('.chat-item[data-id]'); pg.wait_for_timeout(300)
        items = pg.eval_on_selector_all('.chat-item[data-id]', 'e=>e.map(x=>x.dataset.id)'); print('viewport', h, 'chats:', items)
        for idx in range(min(3 if h == 740 else 2, len(items))):
            row = pg.locator('.chat-item[data-id]').nth(idx); bb = row.bounding_box()
            # long press on the row text (left part), like a finger
            pg.mouse.move(bb['x'] + 60, bb['y'] + bb['height'] * 0.35); pg.mouse.down(); pg.wait_for_timeout(650); pg.wait_for_selector('#rowMenu')
            q = rects(pg); print(' long press row', idx, {k: round(v) for k, v in q.items()}, 'clear:', ok(q)); assert ok(q), q
            pg.mouse.up(); pg.click('#rowScrim', position={'x': 5, 'y': 5}) if pg.query_selector('#rowScrim') else None; pg.wait_for_timeout(700)
            pg.wait_for_function("!document.querySelector('#rowMenu')")
            row.locator('[data-menu]').click(); pg.wait_for_selector('#rowMenu'); q = rects(pg); print(' three dots row', idx, {k: round(v) for k, v in q.items()}, 'clear:', ok(q)); assert ok(q), q
            if h == 740 and idx == 0: pg.screenshot(path='/tmp/kt/shots/v1529-chatmenu.png')
            pg.click('#rowScrim', position={'x': 5, 'y': 5}); pg.wait_for_timeout(700); pg.wait_for_function("!document.querySelector('#rowMenu')")
        pg.context.close()
    print('errors:', errs); b.close()
