from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={'width': 360, 'height': 740}).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.set_default_timeout(8000)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(1200)
    pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2600)
    # 1. share into an empty chat: no dialog, text in composer, ok file attached, bad file toasted
    pg.evaluate("window.__kdexLaunch({share:{subject:'Title',text:'https://example.com',files:[{name:'a.txt',size:5,status:'ok',text:'hello'},{name:'b.zip',size:9,status:'binary'}]}})")
    pg.wait_for_timeout(500)
    v = pg.input_value('#input'); chips = pg.locator('#chips .achip').count()
    print('composer:', repr(v), '| chips:', chips, '| dialog hidden:', pg.eval_on_selector('#dialog', 'e=>e.classList.contains("hidden")'))
    assert 'Title' in v and 'example.com' in v and chips == 1
    assert pg.eval_on_selector('#dialog', 'e=>e.classList.contains("hidden")')
    # 2. unknown chat id is ignored
    pg.evaluate("window.__kdexLaunch({chat:'nope'})"); pg.wait_for_timeout(200)
    # 3. used chat -> dialog; "New chat" gives a clean composer
    pg.fill('#input', 'hi'); pg.click('#sendBtn'); pg.wait_for_timeout(2500)
    pg.evaluate("void window.__kdexLaunch({share:{text:'second'}})"); pg.wait_for_selector('#dialog:not(.hidden)')
    assert pg.eval_on_selector('#dlgNo', 'e=>getComputedStyle(e).display') == 'none'
    print('dialog:', pg.inner_text('#dlgTitle'), '|', pg.inner_text('#dlgYes'), '/', pg.inner_text('#dlgAlt'))
    pg.click('#dlgAlt'); pg.wait_for_timeout(400)
    print('this chat ->', repr(pg.input_value('#input')))
    assert pg.input_value('#input').strip().endswith('second')
    pg.fill('#input', '')
    pg.evaluate("void window.__kdexLaunch({share:{text:'third'}})"); pg.wait_for_selector('#dialog:not(.hidden)'); pg.click('#dlgYes'); pg.wait_for_timeout(500)
    print('new chat ->', repr(pg.input_value('#input')), '| messages:', pg.locator('#messages .msg').count())
    assert pg.input_value('#input') == 'third'
    # 4. cancel does nothing
    pg.fill('#input', ''); pg.fill('#input', 'x'); pg.click('#sendBtn'); pg.wait_for_timeout(2500)
    pg.evaluate("void window.__kdexLaunch({share:{text:'zzz'}})"); pg.wait_for_selector('#dialog:not(.hidden)'); pg.mouse.click(6, 6); pg.wait_for_timeout(300)
    assert pg.input_value('#input') == ''
    print('errors:', errs); assert not errs
    b.close()
