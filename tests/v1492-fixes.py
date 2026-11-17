SH = '/tmp/kt/shots/'
from playwright.sync_api import sync_playwright
idle = "document.querySelector('#stopBtn').classList.contains('hidden')"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, has_touch=True, is_mobile=True, accept_downloads=True)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('request', lambda r: reqs.append(r.post_data or '') if 'chat/completions' in r.url else None)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(300)
    # ---- projects sheet and form
    pg.tap('#chipFolder'); pg.wait_for_selector('#pServer'); pg.wait_for_timeout(300); pg.screenshot(path=SH + 'v149-projects.png')
    pg.tap('#pServer'); pg.wait_for_selector('#svGo'); pg.wait_for_timeout(300); pg.screenshot(path=SH + 'v149-form.png')
    print('key box hidden for Password:', pg.locator('#svKeyBox.hidden').count() == 1)
    pg.tap('#svAuth [data-v=key]'); pg.wait_for_timeout(150); print('key box shown:', pg.locator('#svKeyBox.hidden').count() == 0, '| pass box hidden:', pg.locator('#svPassBox.hidden').count() == 1); pg.screenshot(path=SH + 'v149-form-key.png')
    pg.tap('#svAuth [data-v=password]')
    pg.tap('#svGo'); print('empty host ->', pg.inner_text('#svOut'))
    pg.fill('#svHost', 'bad.invalid'); pg.fill('#svUser', 'deploy'); pg.tap('#svGo'); print('no password ->', pg.inner_text('#svOut'))
    pg.fill('#svPass', 'pw'); pg.tap('#svGo'); pg.wait_for_timeout(400); print('bad host ->', pg.inner_text('#svOut'))
    pg.fill('#svHost', 'vps.kamildex.com'); pg.fill('#svPass', 'wrong'); pg.tap('#svGo'); pg.wait_for_timeout(400); print('wrong password ->', pg.inner_text('#svOut'))
    pg.fill('#svPass', 'pw'); pg.fill('#svRoot', '/nowhere/at/all'); pg.tap('#svGo'); pg.wait_for_timeout(400); print('missing folder ->', pg.inner_text('#svOut')[:70])
    pg.fill('#svName', 'My VPS'); pg.fill('#svRoot', '/var/www/site'); pg.tap('#svGo'); pg.wait_for_selector('.sv-rows'); pg.wait_for_timeout(200)
    print('test result rows:', pg.evaluate("[...document.querySelectorAll('.sv-row')].map(r=>r.innerText)"), '| button:', pg.inner_text('#svGo')); pg.screenshot(path=SH + 'v149-tested.png')
    pg.fill('#svUser', 'deploy2'); print('edit after test resets button:', pg.inner_text('#svGo')); pg.fill('#svUser', 'deploy'); pg.tap('#svGo'); pg.wait_for_selector('.sv-rows'); pg.tap('#svGo'); pg.wait_for_timeout(900)
    vis = lambda s: pg.locator(s + ':not(.hidden)').count() == 1
    print('folder chip:', pg.inner_text('#chipFolderName'), '| icon:', pg.get_attribute('#chipFolder use', 'href'), '| files/auto/changes visible:', vis('#chipFiles'), vis('#chipAuto'), vis('#chipChanges'), '| git/term hidden:', not vis('#chipGit'), not vis('#chipTerm'))
    pg.screenshot(path=SH + 'v149-chat.png')
    # ---- files
    pg.tap('#chipFiles'); pg.wait_for_selector('#rfUp'); pg.wait_for_timeout(300)
    pg.locator('[data-p="index.php"]').tap(); pg.wait_for_selector('#rowMenu'); pg.wait_for_timeout(200)
    op = pg.evaluate("(()=>{const rs=[...document.querySelectorAll('#rowMenu')]; const all=[...document.querySelectorAll('.row-item[data-p]')]; const on=all.filter(r=>r.classList.contains('menu-on')); const other=all.find(r=>!r.classList.contains('menu-on')); return {on:on.length, total:all.length, otherOp:other?getComputedStyle(other).opacity:null, onOp:on[0]?getComputedStyle(on[0]).opacity:null, onBorder:on[0]?getComputedStyle(on[0]).borderColor:null}})()")
    print('files menu dim:', op); assert op['on'] == 1 and op['otherOp'] == '0.45' and op['onOp'] == '1'
    pg.screenshot(path=SH + 'v1492-dim.png'); pg.mouse.click(5, 5); pg.wait_for_timeout(700)
    print('cleared:', pg.evaluate("document.querySelectorAll('.menu-on,.dimming').length")); assert pg.evaluate("document.querySelectorAll('.menu-on,.dimming').length") == 0
    pg.keyboard.press('Escape')

    pg.keyboard.press('Escape'); pg.mouse.click(5, 5); pg.wait_for_timeout(500)
    w = pg.evaluate("(()=>{const a=document.querySelector('#menuBtn').getBoundingClientRect(),m=document.querySelector('#modelSelect').getBoundingClientRect(),f=document.querySelector('#topFolderBtn').getBoundingClientRect();return [Math.round(m.left-a.right),Math.round(f.left-m.right)]})()")
    print('model gaps (menu, folder):', w); assert w[0] <= 10 and w[1] <= 10
    pg.screenshot(path=SH + 'v1492-top.png')

    pg.reload(); pg.wait_for_timeout(800); pg.fill('#input', 'hello there'); pg.click('#sendBtn'); pg.wait_for_function(idle, timeout=15000); pg.wait_for_timeout(600); pg.tap('#menuBtn'); pg.wait_for_timeout(500)
    print('chat rows:', pg.locator('.chat-item').count())
    if pg.locator('.chat-item').count() >= 1:
        pg.locator('.chat-item [data-menu]').first.tap(); pg.wait_for_selector('#rowMenu'); pg.wait_for_timeout(200)
        c = pg.evaluate("[document.querySelectorAll('.chat-item.menu-on').length, document.querySelector('#chatList').classList.contains('dimming')]")
        print('chat list dim:', c); assert c == [1, True]
        pg.mouse.click(350, 700); pg.wait_for_timeout(700)

    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.evaluate("""(()=>{const box=document.querySelector('#messages');const d=document.createElement('div');d.className='tool';d.id='xt';d.innerHTML='<pre class="out">'+Array.from({length:30},(_,i)=>'line '+i).join('\\n')+'</pre><div class="tf outx"><span class="fsz hidden"><button class="fbtn" data-tool="fs-" type="button">A-</button><button class="fnum" data-tool="fs0" type="button">11</button><button class="fbtn" data-tool="fs+" type="button">A+</button></span><span style="flex:1"></span><button class="linkbtn" data-tool="xout" type="button">Expand</button></div>';box.appendChild(d)})()""")
    fs = lambda: pg.evaluate("getComputedStyle(document.querySelector('#xt pre.out')).fontSize")
    hid = lambda: pg.evaluate("getComputedStyle(document.querySelector('#xt .fsz')).display")
    print('before expand:', fs(), hid()); assert hid() == 'none'
    pg.evaluate("document.querySelector('#xt [data-tool=xout]').click()"); pg.wait_for_timeout(150); print('expanded:', hid()); assert hid() != 'none'
    pg.evaluate("document.querySelector('#xt [data-tool=\"fs+\"]').click()"); pg.evaluate("document.querySelector('#xt [data-tool=\"fs+\"]').click()"); print('after A+ x2:', fs()); assert fs() == '13px'
    pg.evaluate("document.querySelector('#xt [data-tool=\"fs-\"]').click()"); print('after A-:', fs()); assert fs() == '12px'
    print('num:', pg.evaluate("[document.querySelector('#xt .fnum').textContent, document.querySelector('#xt .fnum').classList.contains('chg')]"))
    pg.evaluate("document.querySelector('#xt [data-tool=fs0]').click()"); print('reset:', fs(), pg.evaluate("[document.querySelector('#xt .fnum').textContent, document.querySelector('#xt .fnum').classList.contains('chg')]")); assert fs() == '11px'
    pg.evaluate("document.querySelectorAll('#xt .fbtn')[1].click()")
    pg.evaluate("document.querySelector('#xt').scrollIntoView()"); pg.screenshot(path=SH + 'v1493-fs.png')
    pg.reload(); pg.wait_for_timeout(600); print('kept after reload:', pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--outfs')")); assert '12px' in pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--outfs')")

    pg.evaluate("""(()=>{const box=document.querySelector('#messages');const d=document.createElement('div');d.className='tool';d.id='ow';d.innerHTML='<div class="diff"><span class="dl c">  $ ls /etc/nginx/sites-enabled</span><span class="dl c">  on VPS, in /root/kdexbot/chat</span><span class="dl w">  Outside the start folder:\\n    /etc/nginx/sites-enabled</span></div>';box.appendChild(d)})()""")
    h = pg.evaluate("(()=>{const w=document.querySelector('#ow .dl.w');const c=document.querySelector('#ow .dl.c');return [w.getBoundingClientRect().height, c.getBoundingClientRect().height, getComputedStyle(w).color]})()")
    print('warn line heights (warn, ctx), colour:', h); assert abs(h[0] - 2 * h[1]) < 3
    pg.screenshot(path=SH + 'v1495-warn.png')
    print('errs:', errs); assert not errs
    b.close()
