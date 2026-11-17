from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(600)
    r=pg.evaluate("""async()=>{const o={};
      const d=await import('/js/diag.js');
      o.scrub=d.scrub('send failed bot 12345'+'67890:AAH_abcdefghijklmnopqrstuvwxyz0123456 ok sha 1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c');
      const n=await import('/js/native.js');
      o.unread=n.secure.wasUnreadable('apikey:x');
      return o}""")
    print(r); assert '1234567890:AAH' not in r['scrub'] and '1f2e3d4c' in r['scrub'] and r['unread'] is False
    # duplicate provider: add via UI twice
    pg.evaluate("localStorage.clear()")
    pg.reload(); pg.wait_for_timeout(600)
    def add(key):
        pg.click('[data-p=custom]'); pg.fill('#sName','Mine'); pg.fill('#sUrl','http://127.0.0.1:4010/v1'); pg.fill('#sKey',key); pg.fill('#mpMan','m1'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_timeout(800)
    add('k1')
    print('providers after 1:', pg.evaluate("(async()=>{const a=await import('/js/agent.js');return (await a.getProviders()).map(x=>x.name)})()"))
    pg.evaluate("document.querySelector('#setup') && document.querySelector('#setup').classList.remove('hidden')")
    print('setup visible?', pg.is_visible('#sGo'))
    add('k1')
    print('msg dup:', pg.inner_text('#sMsg'))
    names=lambda: pg.evaluate("(async()=>{const a=await import('/js/agent.js');return (await a.getProviders()).map(x=>x.name)})()")
    assert names()==['Mine']
    add('k2'); print('after other key:', names()); assert names()==['Mine','Mine (2)']
    print('errors:', errs); print('PASS')
