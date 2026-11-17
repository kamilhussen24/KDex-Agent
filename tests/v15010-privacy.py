# Secrets in ordinary files are hidden from the model (read_file output, diffs, search) while normal code stays readable.
from playwright.sync_api import sync_playwright
JS = """async()=>{
 const S=await import('./js/secrets.js'); const T=await import('./js/tools.js'); const N=await import('./js/native.js'); const out={};
 const hide={
  tg_bare:"bot = Bot('73456"+"78901:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')", tg_lower:"bot_token = '73456"+"78901:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'",
  js_camel:"const apiKey = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';", js_obj:"{ apiKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4', host: 'x' }",
  py_lower:"api_secret = 'Xk39sLmQp82nVb7TrYcW0aZd5fGhJk1M'", eth:"wallet = Account.from_key('0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318')",
  sol:"keypair = Keypair.from_base58_string('5MaiiCavjCmn9Hs1o3eznqDEhRwxo7pXiAYez7keQUviUkau"+"RiTMD8DrESdrNjN8zd9mTmVhRvBJeg5vhyvgrAhG')",
  stripe:"stripe.api_key = 'sk_li"+"ve_51H8abcDEFghiJKLmnoPQRstuVWxyz0123456789'", db:"DATABASE_URL=postgres:/"+"/user:SuperSecretPw@db.example.com:5432/app",
  mnemonic:"MNEMONIC='witch collapse practice feed shame open despair creek road again ice least'", binance:"api_secret='NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3U"+"zSEh1fTqyZkXHnZRgEMTOpq8cPlv'",
 };
 const secretBits={tg_bare:'AAHdqTcvCH1v',tg_lower:'AAHdqTcvCH1v',js_camel:'a1b2c3d4e5f6a7b8c9d0',js_obj:'a1b2c3d4e5f6',py_lower:'Xk39sLmQp82n',eth:'4c0883a69102',sol:'5MaiiCavjCmn',stripe:'51H8abcDEF',db:'SuperSecretPw',mnemonic:'witch collapse',binance:'NhqPtmdSJYdK'};
 out.leaks=[]; for (const [k,v] of Object.entries(hide)) { const r=await S.shield(v,{id:'t1',uri:'x'}); if (r.includes(secretBits[k])) out.leaks.push(k); }
 const keep=[ "tx = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'", "sig = '5MaiiCavjCmn9Hs1o3eznqDEhRwxo7pXiAYez7keQUviUkau"+"RiTMD8DrESdrNjN8zd9mTmVhRvBJeg5vhyvgrAhG'",
   '"integrity": "sha512-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKl=="', "token_url = 'https://api.example.com/oauth/token'", "const path = require('path');", "password_field = 'password'", "function getToken() { return cache.token; }", "BASE = '/var/lib/app2/token-store-123'" ];
 out.changed=[]; for (const v of keep) { const r=await S.shield(v,{id:'t1',uri:'x'}); if (r!==v) out.changed.push(v.slice(0,40)); }
 // read_file path through the same shield
 N.fs.stat=async()=>({exists:true,isDir:false,size:50}); N.fs.readText=async()=>({text:hide.tg_bare+'\\nprint("hi")\\n',binary:false,size:50});
 const rf=await S.shield(await T.runRead('read_file',{path:'bot.py'},{uri:'x',id:'t2'}),{id:'t2',uri:'x'}); out.read=rf.includes('AAHdq')?'LEAK':'hidden'; out.keepsCode=rf.includes('print("hi")'); out.note=rf.includes('Never write ***');
 // write guard
 const f={uri:'x',id:'t3'}; N.fs.readText=async()=>({text:"k = 'real'\\n",binary:false,size:9});
 const w=async(n,a)=>{try{await T.planWrite(n,a,f);return 'ok'}catch(e){return e.message}};
 out.guard1=await w('write_file',{path:'a.py',content:"k = '***'\\n"}); out.guard2=await w('edit_file',{path:'a.py',find:"'real'",replace:"'***'"}); out.guardOk=await w('edit_file',{path:'a.py',find:"'real'",replace:"'new'"});
 return out;}"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context().new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    r = pg.evaluate(JS)
    for k, v in r.items(): print(k, '=>', repr(v)[:170])
    ok = (r['leaks'] == [] and r['changed'] == [] and r['read'] == 'hidden' and r['keepsCode'] and r['note'] and 'contains "***"' in r['guard1'] and 'contains "***"' in r['guard2'] and r['guardOk'] == 'ok' and not errs)
    print('PASS' if ok else 'FAIL', errs); b.close(); assert ok
