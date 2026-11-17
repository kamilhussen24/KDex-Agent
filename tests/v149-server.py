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
    pg.tap('#chipFiles'); pg.wait_for_selector('#rfUp'); pg.wait_for_timeout(300); print('rows:', pg.evaluate("[...document.querySelectorAll('#sheetBody .row-item')].map(r=>r.innerText.replace(/\\n/g,' | '))")); pg.screenshot(path=SH + 'v149-files.png')
    pg.locator('[data-p="index.php"]').tap(); pg.wait_for_selector('#rowMenu'); print('menu:', pg.evaluate("[...document.querySelectorAll('#rowMenu button')].map(b=>b.innerText)")); pg.screenshot(path=SH + 'v149-filemenu.png')
    pg.tap('#rowMenu [data-a=view]'); pg.wait_for_selector('.fv'); print('view has php:', 'echo' in pg.inner_text('.fv')); pg.tap('#sheetBack'); pg.wait_for_selector('#rfUp'); pg.wait_for_timeout(300)
    pg.locator('[data-p="backup.zip"]').tap(); pg.wait_for_selector('#rowMenu')
    with pg.expect_download(timeout=8000) as dl: pg.tap('#rowMenu [data-a=dl]')
    print('download:', dl.value.suggested_filename, len(open(dl.value.path(), 'rb').read()), 'bytes (600000 expected)'); pg.wait_for_selector('#rfUp'); pg.wait_for_timeout(300)
    # upload
    import tempfile, os
    d = tempfile.mkdtemp(); fp = os.path.join(d, 'update-v2.zip'); open(fp, 'wb').write(os.urandom(1300000))
    with pg.expect_file_chooser() as fc: pg.tap('#rfUp')
    fc.value.set_files(fp); pg.wait_for_selector('#rfUp', timeout=8000); pg.wait_for_timeout(500)
    print('after upload rows include file:', 'update-v2.zip' in pg.inner_text('#sheetBody'), '| toast:', pg.locator('#toast.show').count())
    with pg.expect_file_chooser() as fc: pg.tap('#rfUp')
    fc.value.set_files(fp); pg.wait_for_selector('#dialog:not(.hidden)'); print('replace prompt:', pg.inner_text('#dlgTitle'), '|', pg.inner_text('#dlgYes')); pg.screenshot(path=SH + 'v149-replace.png'); pg.click('#dlgNo'); pg.wait_for_selector('#rfUp'); pg.wait_for_timeout(300)
    pg.locator('[data-p="update-v2.zip"]').tap(); pg.wait_for_selector('#rowMenu'); pg.tap('#rowMenu [data-a=del]'); pg.wait_for_selector('#dialog:not(.hidden)'); print('delete prompt:', pg.inner_text('#dlgTitle')); pg.click('#dlgYes'); pg.wait_for_selector('#rfUp'); pg.wait_for_timeout(400)
    print('after delete file gone:', 'update-v2.zip' not in pg.inner_text('#sheetBody'))
    pg.locator('[data-p="logs"]').tap(); pg.wait_for_timeout(500); print('inside logs:', pg.evaluate("[...document.querySelectorAll('#sheetBody .row-item .t')].map(r=>r.innerText)"))
    pg.evaluate("document.querySelector('#sheetClose').click()"); pg.wait_for_timeout(300)
    # ---- agent: tools, commands, approvals
    pg.fill('#input', 'srvtest'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]', timeout=8000); pg.wait_for_timeout(300)
    print('approval card text:', pg.inner_text('.tool:last-of-type').replace('\n', ' | ')[:160]); pg.screenshot(path=SH + 'v149-approve.png')
    pg.locator('[data-tool=apply]').first.click(); pg.wait_for_function(idle, timeout=10000); pg.wait_for_timeout(300)
    print('command result in chat:', 'The command finished' in pg.inner_text('#messages'))
    sent = reqs[-3] if len(reqs) >= 3 else reqs[-1]
    import json
    names = []
    for r in reqs:
        try: names = [t['function']['name'] for t in json.loads(r).get('tools', [])]; break
        except Exception: pass
    print('tools sent has run_command:', 'run_command' in names, '| no git/zip/start_job/project_map:', not any(n in names for n in ['git_status', 'zip', 'unzip', 'start_job', 'project_map', 'check_tools']), '| has write_file/read_file:', 'write_file' in names and 'read_file' in names)
    sys_txt = ''
    for r in reqs:
        try:
            m = json.loads(r)['messages'][0]['content']; sys_txt = m if isinstance(m, str) else str(m); break
        except Exception: pass
    print('system prompt says SERVER and ON THE SERVER:', 'SERVER: you work on the remote server' in sys_txt and 'ON THE SERVER' in sys_txt)
    pg.fill('#input', 'srvrisk'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]', timeout=8000); pg.wait_for_timeout(300)
    print('risky command warning shown:', 'Warning' in pg.inner_text('#messages') or pg.locator('.tool.risky,.risky').count() > 0); pg.screenshot(path=SH + 'v149-risky.png')
    pg.locator('[data-tool=reject]').first.click(); pg.wait_for_function(idle, timeout=10000)
    # ---- auto: off for servers; risky still asks in Auto
    print('Auto pressed:', pg.get_attribute('#chipAuto', 'aria-pressed'))
    # ---- manage: projects sheet lists server with edit/remove, copy-path hidden
    pg.tap('#chipFolder'); pg.wait_for_selector('#pServer'); pg.wait_for_timeout(300)
    print('server row:', pg.evaluate("[...document.querySelectorAll('.frow')].map(r=>r.innerText.replace(/\\n/g,' | '))"), '| edit btn:', pg.locator('[data-es]').count(), '| copy btn:', pg.locator('[data-cp]').count()); pg.screenshot(path=SH + 'v149-manage.png')
    pg.tap('[data-es]'); pg.wait_for_selector('#svGo'); print('edit form prefilled:', pg.input_value('#svHost'), pg.input_value('#svUser'), pg.input_value('#svRoot'), '| pass placeholder:', pg.get_attribute('#svPass', 'placeholder')); pg.screenshot(path=SH + 'v149-edit.png')
    pg.tap('#sheetBack'); pg.wait_for_selector('#pServer'); pg.wait_for_timeout(200)
    pg.tap('[data-rmf]'); pg.wait_for_selector('#dialog:not(.hidden)'); print('remove prompt:', pg.inner_text('#dlgTitle'), '|', pg.inner_text('#dlgText')[:90]); pg.click('#dlgYes'); pg.wait_for_timeout(500)
    print('after remove: rows', pg.locator('.frow').count(), '| secret gone:', pg.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('sec:srv:')).length"))
    print('errors:', errs); b.close()
