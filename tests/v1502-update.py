# Update check rules (release tags are far ahead or behind the app version, so the test does not break when the version changes): quiet refresh when About opens (1 h), no repeat requests, 304 reuse, rate-limit backoff, manual check always.
import json
from playwright.sync_api import sync_playwright
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'etag'}
def rel(tag): return {'tag_name': tag, 'html_url': 'https://github.com/kamilhussen24/KDex-Agent/releases', 'assets': [{'name': 'a.apk', 'size': 41000000, 'browser_download_url': 'https://github.com/kamilhussen24/KDex-Agent/releases/download/%s/a.apk' % tag}]}
S = {'mode': 'tag', 'tag': 'v1.99.1', 'n': 0, 'inm': []}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    def gh(route):
        r = route.request
        if r.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
        S['n'] += 1; S['inm'].append(r.headers.get('if-none-match'))
        if S['mode'] == '304' and r.headers.get('if-none-match'): return route.fulfill(status=304, headers=CORS)
        if S['mode'] == 'limit': return route.fulfill(status=403, headers=CORS, body='{}')
        route.fulfill(status=200, headers={**CORS, 'content-type': 'application/json', 'etag': 'W/"abc"'}, body=json.dumps(rel(S['tag'])))
    pg.route('https://api.github.com/**', gh)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    def about():
        pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#updState'); pg.wait_for_timeout(700); t = pg.inner_text('#updState'); pg.click('#sheetClose'); pg.wait_for_timeout(250); return t
    res = []
    # 1. nothing saved: opening About checks by itself
    t = about(); print('1 first open:', t, '| requests:', S['n']); res.append(t == '1.99.1 available' and S['n'] == 1)
    # 2. opened again within the hour: no new request
    t = about(); t = about(); print('2 reopen x2:', t, '| requests:', S['n']); res.append(S['n'] == 1)
    # 3. saved result older than 1 hour: checks again, picks up a newer release
    pg.evaluate("async()=>{const D=await import('./js/db.js');const l=await D.kvGet('updLast',null);l.at=Date.now()-2*3600e3;await D.kvSet('updLast',l)}")
    S['tag'] = 'v1.99.2'; t = about(); print('3 after 2 h:', t, '| requests:', S['n']); res.append(t == '1.99.2 available' and S['n'] == 2)
    # 4. old result + 304: the saved answer is reused and the request carried the etag
    pg.evaluate("async()=>{const D=await import('./js/db.js');const l=await D.kvGet('updLast',null);l.at=Date.now()-2*3600e3;await D.kvSet('updLast',l)}")
    S['mode'] = '304'; t = about(); print('4 304:', t, '| if-none-match sent:', S['inm'][-1], '| requests:', S['n']); res.append(t == '1.99.2 available' and S['inm'][-1] == 'W/"abc"' and S['n'] == 3)
    # 5. rate limited: old result stays on screen, and the next open within 15 minutes sends nothing
    pg.evaluate("async()=>{const D=await import('./js/db.js');const l=await D.kvGet('updLast',null);l.at=Date.now()-2*3600e3;await D.kvSet('updLast',l)}")
    S['mode'] = 'limit'; t = about(); n1 = S['n']; t2 = about(); print('5 limited:', t, '| again:', t2, '| requests:', n1, S['n']); res.append(t == '1.99.2 available' and S['n'] == n1 == 4)
    # 6. manual button always asks, and shows the busy message when limited (the button exists when no newer version is saved)
    S['mode'] = 'tag'; S['tag'] = 'v1.0.1'; pg.evaluate("async()=>{const D=await import('./js/db.js');const l=await D.kvGet('updLast',null);l.r.latest='1.0.1';l.r.newer=false;l.at=Date.now();await D.kvSet('updLast',l)}"); S['mode'] = 'limit'
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#updGo'); pg.click('#updGo'); pg.wait_for_timeout(700); t = pg.inner_text('#updState'); print('6 manual while limited:', t, '| requests:', S['n']); res.append('busy' in t and S['n'] == 5)
    S['mode'] = 'tag'; S['tag'] = 'v1.0.1'; pg.click('#updGo'); pg.wait_for_timeout(700); t = pg.inner_text('#updState'); print('6b manual ok:', t, '| requests:', S['n']); res.append(t == 'Up to date' and S['n'] == 6)
    ok = all(res) and not errs; print(res, errs[:2]); print('PASS' if ok else 'FAIL'); b.close(); raise SystemExit(0 if ok else 1)
