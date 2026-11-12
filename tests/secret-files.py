from playwright.sync_api import sync_playwright
JS="""async()=>{const o=[]; const N=await import('/js/native.js'); const T=await import('/js/tools.js'); const S=await import('/js/secrets.js'); const G=await import('/js/git.js'); const TX=await import('/js/termux.js');
 const f={id:'env1',name:'p',uri:'mem://env1'};
 await N.fs.writeText(f.uri,'.env','# keys\\nOPENAI_API_KEY=sk-live-abcdef123456\\nDEBUG=true\\nDB_URL="postgres://u:p4ssw0rd@h/db"\\n');
 await N.fs.writeText(f.uri,'.env.example','OPENAI_API_KEY=\\n'); await N.fs.writeText(f.uri,'app.py','print(1)\\n'); await N.fs.writeText(f.uri,'server.pem','-----BEGIN KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\\n-----END KEY-----\\n');
 o.push('list_dir:\\n'+await T.runRead('list_dir',{},f));
 o.push('read .env:\\n'+await T.runRead('read_file',{path:'.env'},f));
 o.push('read .env.example: '+(await T.runRead('read_file',{path:'.env.example'},f)).slice(0,40).replace(/\\n/g,' '));
 o.push('read pem: '+(await T.runRead('read_file',{path:'server.pem'},f)).slice(0,60));
 o.push('search sk-live: '+await T.runRead('search',{pattern:'sk-live'},f));
 try{await T.planWrite('edit_file',{path:'.env',find:'a',replace:'b'},f)}catch(e){o.push('edit .env -> '+e.message.slice(0,80))}
 try{await T.planWrite('delete_file',{path:'server.pem'},f)}catch(e){o.push('delete pem -> '+e.message.slice(0,60))}
 o.push('scrub: '+await S.scrub('out sk-live-abcdef123456 and p4ssw0rd and MIIEvQIBADANBgkqhkiG9w0BAQEFAASC ok DEBUG=true',f));
 window.__kdexTermux=async()=>({stdout:'OPENAI_API_KEY=sk-live-abcdef123456\\n',stderr:'',exitCode:0}); await TX.setTermuxPath(f,'/x');
 o.push('terminal cat: '+(await S.scrub(await TX.runTermux({command:'cat .env'},f),f)).split('\\n')[0]);
 await kv('settings'); return o;}
"""
JS=JS.replace("await kv('settings'); ","")
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); print('\n'.join(pg.evaluate(JS))); print(errs); b.close()
