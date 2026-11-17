# v1.52.20: cut-off and empty replies continue by themselves; clear message + Continue when they cannot; Settings > Max reply length.
import json, urllib.request
from playwright.sync_api import sync_playwright
def stats(): return json.loads(urllib.request.urlopen('http://127.0.0.1:4010/stats').read())
def reset(): urllib.request.urlopen('http://127.0.0.1:4010/reset').read()
with sync_playwright() as p:
    b = p.chromium.launch(); res = {}; errs = []
    pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page()
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.set_default_timeout(15000)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(2600)
    def run(word):
        reset(); pg.click('#menuBtn'); pg.click('#dNew'); pg.wait_for_timeout(400)
        pg.fill('#input', word); pg.click('#sendBtn')
        pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')", timeout=30000); pg.wait_for_timeout(500)
        return pg.evaluate("document.querySelector('#messages').innerText"), stats()
    t, h = run('cutloop')
    res['cutloop: parts then final'] = 'Part 1' in t and 'Part 2' in t and 'DONE final report' in t
    res['cutloop: 3 requests'] = len(h) == 3
    res['cutloop: no Continue button'] = pg.locator('.controw').count() == 0
    res['cutloop: note hidden'] = 'Automatic note' not in t
    pg.screenshot(path='/tmp/kt/shots/v15220-cutloop.png')
    t, h = run('emptyonce')
    res['emptyonce: final text'] = 'Final report text' in t and len(h) == 2
    res['emptyonce: no blank gap/note'] = 'Automatic note' not in t and 'no answer text' not in t.split('Final report text')[0]
    t, h = run('cutforever')
    res['cutforever: clear message'] = 'hit its reply limit again' in t and len(h) == 4
    res['cutforever: Continue button'] = pg.locator('.controw [data-act=cont]').count() == 1
    pg.screenshot(path='/tmp/kt/shots/v15220-cutforever.png')
    t, h = run('emptyforever')
    res['emptyforever: clear message'] = 'no answer text' in t and 'Max reply length' in t and len(h) == 2
    res['emptyforever: Continue button'] = pg.locator('.controw [data-act=cont]').count() == 1
    res['old fallback gone'] = 'The steps above are finished' not in t
    t, h = run('smallcap')
    res['smallcap: retried with model limit'] = 'Answer within the model limit' in t and [x['max'] for x in h] == [32000, 8192]
    t, h = run('notesrun')
    res['notes saved and shown to the model again'] = 'NOTES_IN_PROMPT' in t and 'Save notes' in t
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#setOut')
    res['setting default 32000'] = pg.input_value('#setOut') == '32000'
    pg.fill('#setOut', '12000'); pg.dispatch_event('#setOut', 'change'); pg.wait_for_timeout(300)
    res['setting saved'] = pg.evaluate("import('./js/agent.js').then(m=>m.getSettings()).then(s=>s.maxOut)") == 12000
    pg.screenshot(path='/tmp/kt/shots/v15220-settings.png')
    print(*[f'{k} => {v}' for k, v in res.items()], sep='\n')
    ok = all(res.values()) and not errs
    print('PASS' if ok else 'FAIL', errs); b.close(); assert ok
