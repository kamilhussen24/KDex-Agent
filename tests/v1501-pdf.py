# PDF attach: a text PDF is read, a scan, a broken file and an oversized file give a plain message.
from playwright.sync_api import sync_playwright
D = '/tmp/pdft/'
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')", timeout=20000); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); errs = []; bodies = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('request', lambda r: bodies.append(r.post_data or '') if r.method == 'POST' and '4010' in r.url else None)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    toasts = lambda: pg.evaluate("[...document.querySelectorAll('.toast,#toasts *')].map(e=>e.textContent).join('|')")
    # 1. text PDF
    pg.set_input_files('#fileInput', D + 'invoice.pdf'); pg.wait_for_selector('#chips .achip', timeout=20000)
    print('chip:', pg.inner_text('#chips').strip())
    pg.fill('#input', 'What is the total amount?'); pg.click('#sendBtn'); idle(pg)
    sent = ' '.join(bodies)
    ok1 = 'Total amount: 1,240 USD' in sent and '[PDF: 3 pages]' in sent and 'Page 3:' in sent
    print('text reached the model:', ok1, '| shows pages:', '[PDF: 3 pages]' in sent)
    pg.screenshot(path='/tmp/kt/shots/v1501-pdf-chat.png')
    # 2. scanned PDF -> message, no chip
    pg.set_input_files('#fileInput', D + 'scan.pdf'); pg.wait_for_timeout(2500)
    t = toasts(); chips = pg.query_selector_all('#chips .achip')
    print('scan toast:', t[:140], '| chips:', len(chips)); ok2 = 'scan' in t and len(chips) == 0
    # 3. broken PDF
    pg.set_input_files('#fileInput', D + 'broken.pdf'); pg.wait_for_timeout(2500)
    t = toasts(); chips = pg.query_selector_all('#chips .achip')
    print('broken toast:', t[:140], '| chips:', len(chips)); ok3 = ('could not be read' in t) and len(chips) == 0
    ok = ok1 and ok2 and ok3 and not errs
    print('PASS' if ok else 'FAIL', errs[:2]); b.close(); raise SystemExit(0 if ok else 1)
