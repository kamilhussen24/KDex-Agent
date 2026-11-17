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

    import tempfile, os
    d = tempfile.mkdtemp(); nm = 'a-very-long-file-name-for-the-production-database-backup-before-migration-2026-11-13-final-v2.sql.gz'
    fp = os.path.join(d, nm); open(fp, 'wb').write(b'hello')
    with pg.expect_file_chooser() as fc: pg.tap('#rfUp')
    fc.value.set_files(fp); pg.wait_for_selector('#rfUp', timeout=8000); pg.wait_for_timeout(500)
    pg.locator('[data-p="' + nm + '"]').tap(); pg.wait_for_selector('#rowMenu'); pg.wait_for_timeout(200)
    t = pg.evaluate("(()=>{const e=document.querySelector('#rowMenu .rmt');return e?[e.innerText,e.title]:null})()")
    print('long name header:', t); assert t and '\u2026' in t[0] and t[0].endswith('.sql.gz') and t[1] == nm and len(t[0]) <= 24
    pg.screenshot(path=SH + 'v1491-menu-long.png'); pg.mouse.click(5, 5); pg.wait_for_timeout(700)
    pg.wait_for_selector('#rowMenu', state='detached', timeout=3000)
    pg.locator('[data-p="index.php"]').tap(); pg.wait_for_selector('#rowMenu'); print('short name header:', pg.locator('#rowMenu .rmt').inner_text()); assert pg.locator('#rowMenu .rmt').inner_text() == 'index.php'
    pg.mouse.click(5, 5); pg.wait_for_timeout(700)
    pg.tap('#sheetClose') if pg.locator('#sheetClose').count() else pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    # top plus gone
    print('top plus:', pg.locator('#topNewBtn').count(), '| folder icon:', pg.locator('#topFolderBtn').count()); assert pg.locator('#topNewBtn').count() == 0 and pg.locator('#topFolderBtn').count() == 1
    # terminal chip width does not change
    w = pg.evaluate("""(()=>{const c=document.querySelector('#chipTerm');c.classList.remove('hidden');c.style.display='inline-flex';const l=document.querySelector('#chipTermLbl');l.textContent='Terminal';const a=c.getBoundingClientRect().width;l.textContent='Terminal on';const b=c.getBoundingClientRect().width;return [a,b]})()""")
    print('terminal chip widths off/on:', w); assert abs(w[0] - w[1]) < 0.6 and w[0] < 125
    pg.screenshot(path=SH + 'v1491-chips.png')
    # risky rules
    r = pg.evaluate("""(async()=>{const m=await import('/js/termux.js');const t=(c,rm)=>m.isRiskyCommand(c,rm);return {
      devnull:t('node --check a.js 2>/dev/null | head -5; pm2 status',true), devsda:t('echo x > /dev/sda',true), rm:t('rm -rf build',true),
      env:t('cat .env',true), envex:t('cat .env.example',true), pem:t('cat server.pem',false), plain:t('cat app.js | grep key',true), idrsa:t('tail ~/.ssh/id_rsa',true), stop:t('systemctl stop nginx',true), pm2:t('pm2 status',true)}})()""")
    print('risk:', r)
    assert r['devnull'] is False and r['devsda'] is True and r['rm'] is True and r['env'] is True and r['envex'] is False and r['pem'] is True and r['plain'] is False and r['idrsa'] is True and r['stop'] is True and r['pm2'] is False
    # expand button
    pg.evaluate("""(()=>{const box=document.querySelector('#messages');const d=document.createElement('div');d.className='tool';d.id='xt';d.innerHTML='<pre class="out">'+Array.from({length:30},(_,i)=>'line '+i).join('\\n')+'</pre><div class="tf outx"><button class="linkbtn" data-tool="xout" type="button">Expand</button></div>';box.appendChild(d)})()""")
    pg.evaluate("document.querySelector('#xt [data-tool=xout]').click()"); pg.wait_for_timeout(200)
    st = pg.evaluate("[document.querySelector('#xt pre.out').classList.contains('open'), document.querySelector('#xt [data-tool=xout]').textContent]"); print('expand:', st); assert st == [True, 'Collapse']
    # send ghost text
    pg.evaluate("document.querySelector('#xt').remove()")
    pg.fill('#input', 'hello ghost'); pg.tap('#sendBtn'); pg.evaluate("document.querySelector('#input').value='hello ghost'"); pg.wait_for_timeout(400)
    v = pg.evaluate("document.querySelector('#input').value"); print('input after send + keyboard echo:', repr(v)); assert v == ''
    pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')", timeout=30000)
    pg.fill('#input', 'new text'); pg.wait_for_timeout(1200); v2 = pg.evaluate("document.querySelector('#input').value"); print('new typing kept:', repr(v2)); assert v2 == 'new text'
    print('errors:', errs); assert not errs
    b.close()
