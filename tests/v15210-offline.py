from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.route('http://x.invalid/**', lambda r: r.abort('failed'))
    r=pg.evaluate("""async()=>{const m=await import('/js/native.js');const o={};
      try{await m.httpRaw({url:'http://x.invalid/a',method:'GET'});}catch(e){o.msg=e.message}
      const pr=await import('/js/providers.js');
      try{await pr.listModels({baseUrl:'http://x.invalid/v1',type:'openai'},'k');}catch(e){o.list=e.message}
      return o}""")
    print(r); assert r['msg']=='No internet connection. Connect and try again.' and r['list']==r['msg']; print('PASS')
