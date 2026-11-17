# v1.51.0: Plan mode, message while the task runs, checks after edits, find_symbol.
from playwright.sync_api import sync_playwright
HOOK = ("window.__calls=[];window.__kdexTermux=(o)=>{window.__calls.push(o.command);"
        "if(/node --check/.test(o.command)) return Promise.resolve({stdout:'',stderr:\"chk.js:1 SyntaxError: bad\",exitCode:1});"
        "return Promise.resolve({stdout:'',stderr:'',exitCode:0});};")
SYM = """async()=>{
 const T=await import('./js/tools.js'); const N=await import('./js/native.js');
 const files={'src/a.js':'function greet(n){return n}\\nconst x = greet(1)\\n','src/b.js':"import {greet} from './a.js'\\ngreet(2)\\n// say greet here\\n",'node_modules/z/i.js':'greet(9)\\n','src/c.js':'export const greet2 = (x) => x\\n','logo.png':'greet'};
 N.fs.readText=async(u,p)=>({text:files[p],binary:false,size:files[p].length});
 N.fs.walk=async()=>({files:Object.keys(files).map(p=>({path:p,name:p.split('/').pop(),size:files[p].length})),truncated:false});
 const f={uri:'x'}; const out={};
 out.a=await T.runRead('find_symbol',{name:'greet'},f);
 out.b=await T.runRead('find_symbol',{name:'greet2'},f);
 out.c=await T.runRead('find_symbol',{name:'nothingHere'},f);
 try{await T.runRead('find_symbol',{name:'a b'},f)}catch(e){out.bad=e.message}
 return out;}"""
with sync_playwright() as p:
    b = p.chromium.launch(); res = {}; errs = []
    pg = b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2).new_page()
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.add_init_script(HOOK); pg.set_default_timeout(12000)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    # ---- find_symbol (unit)
    sy = pg.evaluate(SYM)
    res['sym defs'] = 'src/a.js:1' in sy['a'] and 'Definitions of greet' in sy['a']
    res['sym usages'] = 'src/b.js' in sy['a'] and 'src/a.js' in sy['a'] and 'node_modules' not in sy['a'] and 'logo.png' not in sy['a']
    res['sym arrow def'] = 'src/c.js:1' in sy['b']
    res['sym none'] = 'No definition' in sy['c'] and 'No other usages' in sy['c']
    res['sym bad name'] = 'one identifier' in (sy.get('bad') or '')
    pg.click('[data-p=custom]'); pg.fill('#sUrl', 'http://127.0.0.1:4010'); pg.fill('#sKey', 'k'); pg.fill('#mpMan', 'mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option', state='attached'); pg.wait_for_timeout(2600)
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
    # ---- the three buttons are the same size and on one line
    bx = {k: pg.locator('#' + k).bounding_box() for k in ('attachBtn', 'thinkBtn', 'planBtn')}
    res['same height'] = len({round(v['height']) for v in bx.values()}) == 1 and round(bx['planBtn']['height']) == 40
    res['same centre line'] = len({round(v['y'] + v['height'] / 2) for v in bx.values()}) == 1
    pg.screenshot(path='/tmp/kt/shots/v1510-composer.png')
    # ---- Plan mode
    pg.click('#planBtn'); pg.wait_for_timeout(200)
    res['hint shown'] = pg.evaluate("!document.querySelector('#planHint').classList.contains('hidden')")
    res['planBtn on'] = pg.evaluate("document.querySelector('#planBtn').classList.contains('on') && document.querySelector('#composer .box').classList.contains('plan')")
    pg.screenshot(path='/tmp/kt/shots/v1510-plan-on.png')
    pg.fill('#input', 'v1510plan please'); pg.click('#sendBtn'); pg.wait_for_selector('#planDone', timeout=12000)
    t = pg.evaluate("[...document.querySelectorAll('.msg')].map(m=>m.innerText).filter(x=>x.includes('PLANTOOLS')).pop()")
    res['plan tools'] = 'write=false' in t and 'cmd=false' in t and 'read=true' in t and 'sym=true' in t and 'sys=true' in t
    res['plan card buttons'] = pg.locator('#planDone .btn').all_inner_texts() == ['Revise', 'Build this plan']
    pg.screenshot(path='/tmp/kt/shots/v1510-plan-card.png')
    pg.click('#planDone [data-a=rev]'); res['revise focus'] = pg.evaluate("document.activeElement.id=='input' && document.querySelector('#input').placeholder.includes('plan')")
    pg.click('#planDone [data-a=go]'); pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')"); pg.wait_for_timeout(600)
    res['build turns plan off'] = pg.evaluate("!document.querySelector('#planBtn').classList.contains('on') && document.querySelector('#planHint').classList.contains('hidden')")
    res['build sent text'] = pg.evaluate("document.body.innerText.includes('Build the plan above now')")
    pg.fill('#input', 'v1510plan again'); pg.click('#sendBtn'); pg.wait_for_function("document.body.innerText.includes('PLANTOOLS write=true')")
    res['normal mode has write tools'] = True
    pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')")
    # ---- message while the task runs
    pg.fill('#input', 'v1510steer start'); pg.click('#sendBtn'); pg.wait_for_function("!document.querySelector('#stopBtn').classList.contains('hidden')")
    res['stop and send both shown'] = pg.evaluate("!document.querySelector('#stopBtn').classList.contains('hidden') && !document.querySelector('#sendBtn').classList.contains('hidden')")
    pg.fill('#input', 'Skip the tests'); pg.click('#sendBtn'); pg.wait_for_timeout(200)
    res['chip shown'] = pg.evaluate("!document.querySelector('#queueBar').classList.contains('hidden') && document.querySelector('#queueBar').innerText.includes('Skip the tests')")
    res['input cleared'] = pg.evaluate("document.querySelector('#input').value===''")
    pg.screenshot(path='/tmp/kt/shots/v1510-queue.png')
    pg.wait_for_function("document.body.innerText.includes('STEER SEEN')", timeout=15000)
    res['steer reached model'] = True
    pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')"); pg.wait_for_timeout(300)
    res['chip gone'] = pg.evaluate("document.querySelector('#queueBar').classList.contains('hidden')")
    res['sent-while-working label'] = pg.evaluate("document.body.innerText.includes('Sent while working')")
    # a message that arrives while the model is answering with no tools still gets its own turn
    pg.fill('#input', 'v1510late go'); pg.click('#sendBtn'); pg.wait_for_function("!document.querySelector('#stopBtn').classList.contains('hidden')")
    pg.fill('#input', 'one more thing'); pg.click('#sendBtn'); pg.wait_for_function("document.body.innerText.includes('SECOND n=')", timeout=15000)
    res['late message gets a turn'] = True
    pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')")
    # chip can be removed; Stop gives the text back
    pg.fill('#input', 'v1510late again'); pg.click('#sendBtn'); pg.wait_for_function("!document.querySelector('#stopBtn').classList.contains('hidden')")
    pg.fill('#input', 'drop me'); pg.click('#sendBtn'); pg.click('#queueBar [data-q]'); pg.wait_for_timeout(200)
    res['chip removed'] = pg.evaluate("document.querySelector('#queueBar').classList.contains('hidden')")
    pg.fill('#input', 'keep me'); pg.click('#sendBtn'); pg.click('#stopBtn'); pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')"); pg.wait_for_timeout(500)
    res['stop returns queued text'] = pg.evaluate("document.querySelector('#input').value.includes('keep me')")
    pg.fill('#input', '')
    # ---- checks after edits
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(300); pg.click('#setTerm [data-v="1"]'); pg.wait_for_selector('#tmTest'); pg.click('#tmPath'); pg.fill('#dlgInput', '/data/data/com.termux/files/home/demo'); pg.click('#dlgYes'); pg.wait_for_timeout(300); pg.click('#sheetClose')
    pg.click('#topFolderBtn'); pg.wait_for_selector('[data-ck]'); pg.click('[data-ck] >> nth=0'); pg.wait_for_selector('#ckCmd')
    pg.fill('#ckCmd', 'node --check {files}'); pg.dispatch_event('#ckCmd', 'change'); pg.fill('#ckGlob', '*.js'); pg.dispatch_event('#ckGlob', 'change'); pg.wait_for_timeout(300)
    res['auto turned on by typing a command'] = pg.evaluate("document.querySelector('#ckOn').checked")
    pg.screenshot(path='/tmp/kt/shots/v1510-checks-sheet.png')
    pg.click('#sheetBack'); pg.wait_for_timeout(300); pg.click('[data-ck] >> nth=0'); pg.wait_for_selector('#ckCmd')
    res['saved and reloaded'] = pg.input_value('#ckCmd') == 'node --check {files}' and pg.input_value('#ckGlob') == '*.js' and pg.evaluate("document.querySelector('#ckOn').checked")
    pg.click('#sheetClose'); pg.wait_for_timeout(300)
    pg.click('#chipAuto'); pg.fill('#input', 'v1510chk now'); pg.click('#sendBtn'); pg.wait_for_function("document.body.innerText.includes('Automatic check after your edit')", timeout=15000)
    pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')"); pg.wait_for_timeout(300)
    res['check ran with the file'] = pg.evaluate("window.__calls.some(c=>c.startsWith(\"node --check 'chk.js'\"))")
    res['model sees failure'] = pg.evaluate("document.body.innerText.includes('CHK') && document.body.innerText.includes('FAILED')")
    res['card shows real file name, not {files}'] = pg.evaluate("document.body.innerText.includes('node --check chk.js') && !document.querySelector('.tf.chk').innerText.includes('{files}')")
    res['card shows failed check'] = pg.evaluate("document.body.innerText.includes('Check failed') && document.body.innerText.includes('SyntaxError')")
    pg.screenshot(path='/tmp/kt/shots/v1510-check-card.png')
    print(*[f'{k} => {v}' for k, v in res.items()], sep='\n')
    ok = all(res.values()) and not errs
    print('PASS' if ok else 'FAIL', errs); b.close(); assert ok
