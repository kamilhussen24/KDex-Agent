SH = '/tmp/kt/shots/'
from playwright.sync_api import sync_playwright
SAMPLES = [  # text, opts, expected in Quiet
 ('Could not copy', {}, True), ('Something went wrong: x', {}, True), ('Open a folder first.', {}, True), ('Wait for the current task to finish', {'kind':'warn'}, True),
 ('Pictures may not work. This model...', {'kind':'warn'}, True), ('Pushed · 3.1s', {'result':True}, True), ('Cloned into demo', {'result':True}, True), ('Restored. Restarting...', {'result':True}, True),
 ('Update 1.50.0 is available. See Settings > About.', {'result':True}, True), ('Saved backup.json in Docs', {'result':True}, True), ('This model does not support thinking. Answering without it.', {'kind':'warn'}, True),
 ('Pinned', {}, False), ('Unpinned', {}, False), ('Saving a.txt', {}, False), ('Chat copied to clipboard', {}, False), ('Reported. Thank you.', {}, False), ('Conversations deleted (pinned kept)', {}, False),
 ('Remembered: likes tea', {}, False), ('Fast file access is on', {}, False), ('Committed', {}, False), ('Discarded', {}, False), ('Asking before every action', {}, False), ('Auto: risky actions still ask', {}, False),
 ('Provider saved', {}, False), ('Key updated', {}, False), ('Git removed', {}, False), ('Branch created', {}, False), ('Repository created', {}, False),
]
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'deepseek-chat'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    def shown(t, o):
        pg.evaluate("(a)=>{const e=document.querySelector('#toast');e.className='toast hidden';e.innerHTML='';window.__toast(a[0],a[1])}", [t, o]); pg.wait_for_timeout(60)
        return pg.evaluate("document.querySelector('#toast').classList.contains('show')")
    for mode in ('quiet', 'all'):
        pg.evaluate("async(m)=>{const D=await import('./js/db.js');const s=await D.kvGet('settings',{});s.quietToasts=(m==='quiet');await D.kvSet('settings',s);}", mode)
        pg.reload(); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(500)
        bad = []
        for t, o, q in SAMPLES:
            got = shown(t, o); exp = q if mode == 'quiet' else True
            if got != exp: bad.append((t, got, exp))
        print(mode, 'mismatches:', bad)
    # vision warning once per model: attach image twice on a non-vision model
    pg.evaluate("async()=>{const D=await import('./js/db.js');const s=await D.kvGet('settings',{});s.quietToasts=true;await D.kvSet('settings',s);}"); pg.reload(); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(500)
    png = '/tmp/kt/small.png'
    cnt = 0
    for i in range(2):
        pg.evaluate("document.querySelector('#toast').className='toast hidden'")
        pg.set_input_files('#fileInput', png); pg.wait_for_timeout(700)
        cnt += 1 if pg.evaluate("document.querySelector('#toast').classList.contains('show')") else 0
    print('vision warning shown count over 2 attaches (expect 1):', cnt)
    print('errors:', errs); b.close()
