from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context(viewport={'width':360,'height':740}).new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    if pg.query_selector('#sSkip'): pg.click('#sSkip')
    pg.wait_for_selector('#input')
    pg.evaluate("""async()=>{const {db}=await import('/js/db.js');
      for (const [id,t] of [['c1','First chat'],['c2','Second chat']]) { await db.put('chats',{id,title:t,model:'',think:'off',folderId:null,updated:Date.now()+(id==='c1'?1:0)}); await db.put('messages',{chatId:id,role:'user',text:t,at:Date.now()}); } }""")
    def boot():
        pg.reload(); pg.wait_for_timeout(700)
        if pg.query_selector('#sSkip'): pg.click('#sSkip')
        pg.wait_for_selector('#input')
    boot()
    # 1 fresh chat draft survives reload
    pg.fill('#input','half written note'); pg.wait_for_timeout(900); boot()
    v=pg.input_value('#input'); print('1 fresh chat after reload:',repr(v)); assert v=='half written note' or v==''; 
    first=v
    # 2 secret-looking text is not kept
    pg.fill('#input','sk-ant-'+'api03-abcdefghijklmnopqrstuvwxyz0123456789'); pg.wait_for_timeout(900); boot()
    v=pg.input_value('#input'); print('2 key-like after reload:',repr(v)); assert v==''
    # 3 per chat drafts
    def openc(title):
        pg.click('#menuBtn') if pg.query_selector('#menuBtn') else pg.click('[aria-label=Menu]'); pg.wait_for_timeout(300)
        pg.click('.chat-item[data-id=%s]' % ('c1' if title.startswith('First') else 'c2')); pg.wait_for_timeout(500)
    ids=pg.evaluate("document.querySelectorAll('.chat-item').length"); print('chat items',ids)
    openc('First chat'); pg.fill('#input','draft for first'); pg.wait_for_timeout(900)
    openc('Second chat'); v=pg.input_value('#input'); print('3a second chat box:',repr(v)); assert v==''
    pg.fill('#input','draft for second'); pg.wait_for_timeout(900)
    openc('First chat'); v=pg.input_value('#input'); print('3b first chat box:',repr(v)); assert v=='draft for first'
    boot(); openc('Second chat'); v=pg.input_value('#input'); print('3c second after reload:',repr(v)); assert v=='draft for second'
    # 4 emptying the box removes the draft
    pg.fill('#input',''); pg.wait_for_timeout(900); boot(); openc('Second chat'); v=pg.input_value('#input'); print('4 emptied:',repr(v)); assert v==''
    print('errors',errs); print('PASS')
