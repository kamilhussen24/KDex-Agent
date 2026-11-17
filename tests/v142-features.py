import json
from playwright.sync_api import sync_playwright
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=15000); pg.wait_for_timeout(400)
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_context(viewport={'width':360,'height':740}).new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
    # ---- .git internals hidden
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
    r=pg.evaluate("""async()=>{const A=await import('./js/agent.js');const T=await import('./js/tools.js');const N=await import('./js/native.js');
      const fl=await A.getFolders();const f=fl[fl.length-1];
      await N.fs.writeText(f.uri,'.git/config','[remote "origin"]\\n url = https:/'+'/me:gh'+'p_ABCDEF1234567890abcdef1234567890ABCD@github.com/me/r.git\\n');
      await N.fs.writeText(f.uri,'app/notes.txt','hello needle\\n');
      const out={};
      try{ out.read=await T.runRead('read_file',{path:'.git/config'},f)}catch(e){out.read='ERR '+e.message}
      try{ out.read2=await T.runRead('read_file',{path:'sub/.git/HEAD'},f)}catch(e){out.read2='ERR '+e.message}
      out.search=await T.runRead('search',{pattern:'ghp_'},f);
      out.find=await T.runRead('find_files',{query:'config'},f);
      out.normal=(await T.runRead('read_file',{path:'app/notes.txt'},f)).slice(0,40);
      out.isGit=['.git/config','a/.git/x','.github/x.yml','.gitignore','git/x'].map(x=>x+':'+T.isGitInternal(x)).join(' ');
      const S=await import('./js/secrets.js');
      out.scrub=await S.scrub('origin https:/'+'/me:gh'+'p_ABCDEF1234567890abcdef1234567890ABCD@github.com/me/r.git (fetch)\\nplain https://github.com/me/r.git',f);
      return out}""")
    for k,v in r.items(): print(k,'=>',str(v)[:160].replace('\n',' / '))
    # ---- backup: pictures omitted, restore validation + rollback
    res=pg.evaluate("""async()=>{const A=await import('./js/agent.js');const D=await import('./js/db.js');
      const id='chat-bk';await D.db.put('chats',{id,title:'Backup test',updated:Date.now()});
      await D.db.put('messages',{chatId:id,role:'user',text:'see this',images:[{mime:'image/png',data:'A'.repeat(5000)}],at:Date.now()});
      await D.db.put('messages',{chatId:id,role:'assistant',text:'ok',at:Date.now()});
      return (await D.db.all('messages')).length}""")
    print('messages seeded:',res)
    # share one folder between export and restore (the browser demo folder is new each time)
    pg.evaluate("""async()=>{const N=await import('./js/native.js');const f=await N.fs.pickFolder();window.__bk=f;N.fs.pickFolder=async()=>f;window.__fsRef=N.fs}""")
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_selector('#bkOut'); pg.click('#bkOut'); pg.wait_for_timeout(800)
    info=pg.evaluate("""async()=>{const N=await import('./js/native.js');const l=await N.fs.list(window.__bk.uri,'');const f=l.find(x=>/^kdex-agent-backup/.test(x.name));
      const t=(await N.fs.readText(window.__bk.uri,f.path,64*1048576)).text;const d=JSON.parse(t);
      const um=d.messages.find(m=>m.chatId==='chat-bk'&&m.role==='user');
      return {name:f.name,size:t.length,version:d.version,hasImgData:t.includes('AAAAAAAAAAAAAAAA'),userText:um.text,omitted:um.imagesOmitted,noImages:!('images' in um)}}""")
    print('backup:',info)
    # restore: bad file leaves data untouched
    pg.evaluate("""async()=>{const N=await import('./js/native.js');await N.fs.writeText(window.__bk.uri,'kdex-agent-backup-9999-12-31.json',JSON.stringify({app:'kdex-agent',chats:[{id:5}],messages:[]}))}""")
    n0=pg.evaluate("""async()=>{const D=await import('./js/db.js');return (await D.db.all('chats')).length+'/'+(await D.db.all('messages')).length}""")
    pg.click('#bkIn'); pg.wait_for_selector('#dialog:not(.hidden)'); pg.click('#dlgYes'); pg.wait_for_timeout(800)
    n1=pg.evaluate("""async()=>{const D=await import('./js/db.js');return (await D.db.all('chats')).length+'/'+(await D.db.all('messages')).length}""")
    print('bad backup: before',n0,'after',n1,'| toast:',pg.evaluate("document.querySelector('#toast')?document.querySelector('#toast').textContent:''")[:70])
    # restore: good file (the real one) round-trips; then lost-folder dialog
    pg.evaluate("""async()=>{const N=await import('./js/native.js');await N.fs.remove(window.__bk.uri,'kdex-agent-backup-9999-12-31.json')}""")
    pg.evaluate("""async()=>{const D=await import('./js/db.js');await D.db.del('chats','chat-bk')}""")
    pg.evaluate("""async()=>{const N=await import('./js/native.js');const o=N.fs.list;N.fs.list=async(u,p)=>{if(String(u).includes('LOSTFOLDER'))throw new Error('permission denied');return o.call(N.fs,u,p)}}""")
    # add a folder record whose access is gone to the backup file
    pg.evaluate("""async()=>{const N=await import('./js/native.js');const l=await N.fs.list(window.__bk.uri,'');const f=l.find(x=>/^kdex-agent-backup/.test(x.name));
      const d=JSON.parse((await N.fs.readText(window.__bk.uri,f.path,64*1048576)).text);
      const fr=d.kv.find(k=>k.key==='folders');if(fr)fr.value.push({id:'lost1',name:'OldProject',uri:'content://LOSTFOLDER/tree/x'});else d.kv.push({key:'folders',value:[{id:'lost1',name:'OldProject',uri:'content://LOSTFOLDER/tree/x'}]});
      await N.fs.writeText(window.__bk.uri,f.path,JSON.stringify(d))}""")
    pg.click('#bkIn'); pg.wait_for_selector('#dialog:not(.hidden)'); pg.click('#dlgYes'); pg.wait_for_selector('#dlgTitle:has-text("Add folders again")',timeout=6000)
    print('lost-folder dialog:',pg.inner_text('#dlgText')[:150],'| buttons: yes=',pg.inner_text('#dlgYes'),'alt visible=',pg.is_visible('#dlgAlt'),'no visible=',pg.is_visible('#dlgNo'))
    pg.screenshot(path='shots/v142-lost-folder.png')
    print('restored chat back:',pg.evaluate("""async()=>{const D=await import('./js/db.js');return !!(await D.db.get('chats','chat-bk'))}"""))
    b.close()
print('errors:',errs)
