import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,color_scheme=mode).new_page(); errs=[]
        pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
        # diag prune
        r=pg.evaluate("""async()=>{const D=await import('./js/diag.js');const now=Date.now();
          const l=[];for(let i=0;i<250;i++)l.push({t:now-i*1000,k:i%50===0?'error':'run',m:'x'+i});
          l.push({t:now-9*86400000,k:'error',m:'old'});
          const o=D.prune(l,now);return {n:o.length,errs:o.filter(e=>e.k==='error').length,old:o.some(e=>e.m==='old')}}""")
        print(mode,'prune',r); assert r['n']==200 and r['old'] is False and r['errs']==5
        errs2=pg.evaluate("""async()=>{const G=await import('./js/main.js').catch(()=>null);return 1}""")
        print(mode,errs); pg.context.close()
    b.close()
