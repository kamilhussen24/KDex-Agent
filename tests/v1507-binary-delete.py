# Deleting a binary file works (no Undo copy); editing/writing one gives a hint to use the terminal; folders hint rm -r.
from playwright.sync_api import sync_playwright
JS = """async()=>{
 const T=await import('./js/tools.js'); const N=await import('./js/native.js'); const out={}; const removed=[];
 N.fs.stat=async(u,p)=>p==='dir'?{exists:true,isDir:true}:p==='gone.apk'?{exists:false}:{exists:true,isDir:false,size:9};
 N.fs.readText=async(u,p)=>p==='odd.dat'?{binary:true}:{binary:false,text:'hi\\n'};
 N.fs.remove=async(u,p)=>{removed.push(p)};
 const f={uri:'x'}; const tryit=async(n,a)=>{try{return await T.planWrite(n,a,f)}catch(e){return {err:e.message}}};
 const a=await tryit('delete_file',{path:'KDex-release (19).apk'}); out.apk=[a.op,a.binary,a.diff.lines[0].text];
 out.apply=await T.applyWrite(a,f); out.removed=removed;
 const b=await tryit('delete_file',{path:'odd.dat'}); out.odd=[b.op,b.binary];
 out.txt=(await tryit('delete_file',{path:'a.txt'})).binary||false;
 out.write=(await tryit('write_file',{path:'x.apk',content:'a'})).err;
 out.dir=(await tryit('delete_file',{path:'dir'})).err; out.gone=(await tryit('delete_file',{path:'gone.apk'})).err;
 return out;}"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context().new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    r = pg.evaluate(JS); print(r)
    ok = (r['apk'] == ['delete', True, 'Binary file. Undo cannot bring it back.'] and r['removed'] == ['KDex-release (19).apk'] and r['odd'] == ['delete', True]
          and r['txt'] is False and 'run_command' in r['write'] and 'rm -r' in r['dir'] and r['gone'].startswith('Not found') and not errs)
    print('PASS' if ok else 'FAIL', errs); b.close(); assert ok
