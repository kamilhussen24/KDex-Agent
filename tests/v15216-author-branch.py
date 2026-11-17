from playwright.sync_api import sync_playwright
import sys
ok=True
def chk(c,m):
    global ok
    print(('PASS ' if c else 'FAIL ')+m)
    ok = ok and c
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context(viewport={'width':360,'height':800}).new_page()
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(600)
    if pg.query_selector('#sSkip'): pg.click('#sSkip')
    pg.wait_for_selector('#topFolderBtn'); pg.click('#topFolderBtn'); pg.click('#pClone'); pg.wait_for_selector('#cUrl')
    order=pg.evaluate("[...document.querySelectorAll('#sheet input')].map(i=>i.id)")
    chk(order[:2]==['cUrl','cBr'],'branch field directly under URL: %s'%order)
    pg.fill('#cUrl','x'); pg.fill('#cBr','dev')
    # module-level tests of git.js helpers
    r=pg.evaluate("""async()=>{const G=await import('/js/git.js');
      return {has:['repoAuthor','effectiveAuthor','setRepoAuthor','clearRepoAuthor'].every(k=>typeof G[k]==='function')};}""")
    chk(r['has'],'author helpers exported')
    r=pg.evaluate("""async()=>{const G=await import('/js/git.js'); const store={};
      window.git={getConfig:async({path})=>store[path],setConfig:async({path,value})=>{if(value===undefined)delete store[path];else store[path]=value;}};
      const f={id:'t1',name:'t1',uri:'x'}; const out={};
      await G.saveGitSettings({name:'root',email:'root@localhost'});
      out.none=(await G.effectiveAuthor(f)).source;
      await G.saveGitSettings({name:'Def',email:'def@gh.com'});
      out.def=await G.effectiveAuthor(f);
      await G.setRepoAuthor(f,'Own','own@gl.com');
      out.own=await G.effectiveAuthor(f);
      await G.clearRepoAuthor(f);
      out.back=(await G.effectiveAuthor(f)).source;
      store['user.name']='root';store['user.email']='root@localhost';
      out.rootIgnored=(await G.effectiveAuthor(f)).source;
      await G.saveGitSettings({name:'',email:''});return out;}""")
    chk(r['none']=='none','root@localhost default counts as not set')
    chk(r['def']['source']=='default' and r['def']['email']=='def@gh.com','default used when repo has none')
    chk(r['own']['source']=='repo' and r['own']['email']=='own@gl.com','repo author wins')
    chk(r['back']=='default','clearing falls back to default')
    chk(r['rootIgnored']=='default','root@localhost in repo config ignored')
    chk(not errs,'no page errors %s'%errs)
b.close() if False else None
print('ALL PASS' if ok else 'SOME FAIL'); sys.exit(0 if ok else 1)
