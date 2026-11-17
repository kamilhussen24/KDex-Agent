# move/copy/make_folder, multi-edit, search glob/context, find_files glob, git tool definitions, ask_user answer path.
from playwright.sync_api import sync_playwright
JS = """async()=>{
 const T=await import('./js/tools.js'); const N=await import('./js/native.js'); const G=await import('./js/gittools.js'); const out={};
 const files={'src/a.js':'one\\ntwo\\nthree\\n','src/b.ts':'two\\n','README.md':'two\\nhello\\n','logo.png':'x','big/dir/x.txt':'y'};
 const bytes=(t)=>new TextEncoder().encode(t);
 N.fs.stat=async(u,p)=>files[p]!=null?{exists:true,isDir:false,size:files[p].length}:Object.keys(files).some(k=>k.startsWith(p+'/'))?{exists:true,isDir:true,size:0}:{exists:false};
 N.fs.readText=async(u,p)=>({text:files[p],binary:false,size:files[p].length});
 N.fs.readBytes=async(u,p)=>bytes(files[p]); N.fs.writeBytes=async(u,p,d)=>{files[p]=new TextDecoder().decode(d)}; N.fs.remove=async(u,p)=>{delete files[p]};
 N.fs.mkdir=async(u,p)=>{out.mk=p}; N.fs.writeText=async(u,p,t)=>{files[p]=t};
 N.fs.walk=async()=>({files:Object.keys(files).map(p=>({path:p,name:p.split('/').pop(),size:files[p].length})),truncated:false});
 const f={uri:'x'}; const plan=async(n,a)=>{try{return await T.planWrite(n,a,f)}catch(e){return {err:e.message}}};
 // multi edit
 const e1=await plan('edit_file',{path:'src/a.js',edits:[{find:'one',replace:'1'},{find:'three',replace:'3'}]}); out.multi=e1.after;
 const e2=await plan('edit_file',{path:'src/a.js',edits:[{find:'one',replace:'1'},{find:'zzz',replace:'3'}]}); out.multiErr=e2.err;
 const e3=await plan('edit_file',{path:'src/a.js',find:'two',replace:'2'}); out.single=e3.after;
 // move / copy
 const m=await plan('move_file',{from:'src/b.ts',to:'src/c.ts'}); out.move=[m.op,m.path,m.from]; await T.applyWrite(m,f); out.afterMove=[files['src/b.ts'],files['src/c.ts']];
 await T.undoBackup({op:'move_file',path:'src/c.ts',from:'src/b.ts'},f); out.afterUndo=[files['src/b.ts'],files['src/c.ts']];
 const c=await plan('copy_file',{from:'logo.png',to:'img/logo.png'}); await T.applyWrite(c,f); out.copy=files['img/logo.png'];
 out.exists=(await plan('copy_file',{from:'logo.png',to:'README.md'})).err; out.dirErr=(await plan('move_file',{from:'big',to:'big2'})).err; out.same=(await plan('move_file',{from:'logo.png',to:'logo.png'})).err;
 const mk=await plan('make_folder',{path:'new/sub'}); await T.applyWrite(mk,f); out.mkdir=out.mk;
 // search
 out.glob=await T.runRead('search',{pattern:'two',glob:'*.js'},f); out.ctx=await T.runRead('search',{pattern:'two',glob:'*.js',context:1},f); out.max=await T.runRead('search',{pattern:'two',max_results:1},f);
 out.ff=await T.runRead('find_files',{query:'*.ts'},f); out.ff2=await T.runRead('find_files',{query:'src/**/*.js'},f); out.ff3=await T.runRead('find_files',{query:'logo'},f);
 out.gt=G.GIT_TOOLS.map(t=>t.name).filter(n=>/merge|discard|undo/.test(n)); out.acts=['git_merge','git_discard','git_undo_commit'].every(n=>G.GIT_ACTIONS.has(n));
 return out;}"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context().new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    r = pg.evaluate(JS)
    for k, v in r.items(): print(k, '=>', repr(v)[:200])
    ok = (r['multi'] == '1\ntwo\n3\n' and 'Change 2 of 2' in r['multiErr'] and 'Nothing was changed' in r['multiErr'] and r['single'] == 'one\n2\nthree\n'
          and r['move'] == ['move_file', 'src/c.ts', 'src/b.ts'] and r['afterMove'] == [None, 'two\n'] and r['afterUndo'] == ['two\n', None] and r['copy'] == 'x'
          and 'already exists' in r['exists'] and 'folder' in r['dirErr'] and 'same' in r['same'] and r['mkdir'] == 'new/sub'
          and r['glob'].startswith('src/a.js:2') and 'src/b.ts' not in r['glob'] and 'src/a.js:1-' in r['ctx'] and r['max'].count('\n') >= 1 and 'max_results' in r['max']
          and r['ff'] == 'src/b.ts' and r['ff2'] == 'src/a.js' and r['ff3'] == 'logo.png\nimg/logo.png'
          and len(r['gt']) == 3 and r['acts'] and not errs)
    print('PASS' if ok else 'FAIL', errs); b.close(); assert ok
