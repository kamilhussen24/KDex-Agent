import base64, struct, zlib
from playwright.sync_api import sync_playwright
HTML = """<html><head><title>Guide – Demo Docs</title><style>.x{}</style><script>alert(1)</script></head><body>
<nav>Home | Products | Login</nav><header>Site banner</header>
<main><h1>Install guide</h1><p>Run <code>npm i demo</code> to install version 4.2.</p><ul><li>Step one</li><li>Step two</li></ul>
<pre>const a = 1;\nconsole.log(a);</pre><table><tr><td>Name</td><td>Qty</td></tr><tr><td>Pen</td><td>3</td></tr></table>
<p>%s</p><a href="/next">Next page</a></main><footer>Copyright junk</footer></body></html>""" % ("Long filler sentence. " * 600)
def png(w,h,rgb):
    raw=b''.join(b'\x00'+bytes(rgb)*w for _ in range(h))
    ch=lambda t,d: struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=12000); pg.wait_for_timeout(300)
open('/tmp/kt/small.png','wb').write(png(40,30,(200,60,60)))
open('/tmp/kt/big.png','wb').write(png(2400,1800,(30,120,200)))
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode in ('light','dark'):
        ctx=b.new_context(viewport={'width':360,'height':740},device_scale_factor=1.5,color_scheme=mode); pg=ctx.new_page(); errs=[]; reqs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('request',lambda r: reqs.append(r.post_data or '') if 'chat/completions' in r.url else None)
        pg.route('https://docs.example.com/**', lambda r: r.fulfill(status=200, headers={'content-type':'text/html; charset=utf-8','access-control-allow-origin':'*'}, body=HTML))
        pg.route('https://gone.example.com/**', lambda r: r.fulfill(status=404, headers={'access-control-allow-origin':'*'}, body='nope'))
        pg.add_init_script("window.__kdexTermux=async(o)=>({stdout:'ok\\n',stderr:'',exitCode:0});")
        pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
        # --- images: small sent as-is, big resized, vision warning for text-only models
        pg.set_input_files('#fileInput','/tmp/kt/small.png'); pg.wait_for_timeout(500)
        a=pg.evaluate("S0=null")
        info=pg.evaluate("""async()=>{const M=await import('./js/image.js');const r1=await fetch('/__none').catch(()=>null);
          const mk=async(u)=>{const bl=await (await fetch(u)).blob();return new File([bl],'x.png',{type:'image/png'})};return 1}""")
        print(mode,'chips after small png:',pg.locator('#chips .achip').count())
        res=pg.evaluate("""async()=>{const M=await import('./js/image.js');
          const mkpng=(w,h,col)=>new Promise(r=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=col;g.fillRect(0,0,w,h);c.toBlob(b=>r(new File([b],'a.png',{type:'image/png'})),'image/png')});
          const small=await mkpng(40,30,'#c83c3c'); const rs=await M.prepareImage(small);
          const nz=document.createElement('canvas');nz.width=2600;nz.height=2000;const ng=nz.getContext('2d');const id=ng.createImageData(2600,2000);for(let i=0;i<id.data.length;i++)id.data[i]=(i%4==3)?255:Math.random()*255;ng.putImageData(id,0,0);
          const big=await new Promise(r=>nz.toBlob(b=>r(new File([b],'n.png',{type:'image/png'})),'image/png')); const rb=await M.prepareImage(big);
          const im=await new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='data:'+rb.mime+';base64,'+rb.data});
          return {smallMime:rs.mime,smallSame:rs.data.length>50, bigMime:rb.mime,bigW:im.width,bigH:im.height,bigKB:Math.round(rb.data.length*0.75/1024), bigSize:big.size}}""")
        print(mode,'prepareImage:',res)
        # black-canvas simulation: force blank resize -> must fall back to original
        fb=pg.evaluate("""async()=>{const M=await import('./js/image.js');
          const orig=HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext=function(t,o){const g=orig.call(this,t,o);if(g&&g.drawImage){const d=g.drawImage.bind(g);g.drawImage=function(){ /* draw nothing: simulates a black canvas */ };g.fillRect=function(){};}return g};
          const mk=()=>new Promise(r=>{const c=document.createElement('canvas');c.width=2400;c.height=1800;HTMLCanvasElement.prototype.getContext=orig;const g=c.getContext('2d');g.fillStyle='#3a8';g.fillRect(0,0,2400,1800);c.toBlob(b=>r(new File([b],'s.png',{type:'image/png'})),'image/png')});
          const f=await mk();
          HTMLCanvasElement.prototype.getContext=function(t,o){const g=orig.call(this,t,o);if(g&&g.drawImage){g.drawImage=function(){};g.fillRect=function(){};}return g};
          const r=await M.prepareImage(f); HTMLCanvasElement.prototype.getContext=orig;
          return {mime:r.mime,len:r.data.length,origSize:f.size,usedOriginal:Math.abs(r.data.length*0.75-f.size)<f.size*0.05}}""")
        print(mode,'blank canvas fallback:',fb)
        # vision heuristic
        vh=pg.evaluate("""async()=>{const P=await import('./js/providers.js');return ['gpt-4o','claude-sonnet-4','gemini-2.5-flash','deepseek-chat','deepseek-reasoner','gpt-3.5-turbo','qwen2.5-coder','llama-3.1-70b','mock-a','qwen2-vl-7b'].map(m=>m+':'+P.likelySeesImages(m)).join(', ')}""")
        print(mode,'vision guess:',vh)
        # attach under a text-only model name => warning
        pg.evaluate("""async()=>{const A=await import('./js/agent.js');const ms=await A.getModels();ms[0].apiModel='deepseek-chat';await A.saveModels(ms)}""")
        pg.reload(); pg.wait_for_timeout(1200)
        pg.set_input_files('#fileInput','/tmp/kt/small.png'); pg.wait_for_timeout(700)
        t=pg.evaluate("document.querySelector('#toast')?document.querySelector('#toast').textContent:''"); print(mode,'warn toast:',t[:100]); pg.screenshot(path=f'shots/v141-{mode}-warn.png')
        pg.evaluate("""async()=>{const A=await import('./js/agent.js');const ms=await A.getModels();ms[0].apiModel='mock-a';await A.saveModels(ms)}""")
        pg.reload(); pg.wait_for_timeout(1200)
        # --- web_fetch unit
        u=pg.evaluate("""async()=>{const W=await import('./js/web.js');const bad=[];
          for(const x of ['http://localhost/a','http://127.0.0.1/','http://192.168.1.5/','http://10.0.0.1/','http://172.20.1.1/','http://[::1]/','http://intranet/','ftp://x.com/','file:///etc/passwd','http://a.local/','http://2130706433/','https://u:p@x.com/']){try{W.checkUrl(x);bad.push('ALLOWED '+x)}catch(e){}}
          let ok=true;try{W.checkUrl('https://example.com/a?b=1')}catch(e){ok=false}
          const r=W.htmlToText(document.implementation.createHTMLDocument('x').documentElement.outerHTML,'https://x.com',false);
          return {bad,ok}}""")
        print(mode,'checkUrl:',u)
        # --- web_fetch end to end (approval, Always allow, output shape)
        pg.evaluate("document.querySelector('#dNew').click()"); pg.wait_for_timeout(300)
        pg.fill('#input','webtest https://docs.example.com/guide'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000)
        print(mode,'card:',pg.inner_text('.tool').replace('\n',' / ')[:200]); pg.screenshot(path=f'shots/v141-{mode}-web-approve.png')
        print(mode,'always label:',pg.inner_text('[data-tool=always]'))
        pg.click('[data-tool=apply]'); idle(pg)
        txt=pg.inner_text('#messages'); i=txt.find('WEBDONE'); print(mode,'result:',txt[i:i+560].replace('\n',' '))
        full=pg.evaluate("""async()=>{const W=await import('./js/web.js');return await W.fetchPage({url:'https://docs.example.com/guide',links:true})}""")
        print(mode,'junk removed:', all(x not in full for x in ['Site banner','Copyright junk','alert(1)','Login']), '| has main text:', 'npm i demo' in full and '- Step one' in full and 'Pen | 3' in full.replace('Pen | 3 |','Pen | 3'), '| len',len(full))
        more=pg.evaluate("""async()=>{const W=await import('./js/web.js');const a=await W.fetchPage({url:'https://docs.example.com/guide'});const m=a.match(/offset (\\d+)\\.\\]/);const b=await W.fetchPage({url:'https://docs.example.com/guide',offset:+m[1]});return {a:a.length,b:b.length,off:m[1],tail:b.slice(-90)}}""")
        print(mode,'continue:',more)
        # always allow then second fetch needs no approval
        pg.fill('#input','webtest https://docs.example.com/other'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=always]',timeout=8000); pg.click('[data-tool=always]'); idle(pg)
        pg.fill('#input','webtest https://docs.example.com/third'); pg.click('#sendBtn'); idle(pg); print(mode,'third fetch auto, approvals pending:',pg.locator('[data-tool=apply]').count())
        # reject
        pg.fill('#input','webtest https://news.example.org/x'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=reject]',timeout=8000); pg.click('[data-tool=reject]'); idle(pg); print(mode,'reject ->','WEBREJECT' in pg.inner_text('#messages'))
        # blocked + 404
        pg.fill('#input','webtest http://192.168.1.1/admin'); pg.click('#sendBtn'); idle(pg); print(mode,'private blocked ->',pg.inner_text('#messages')[-160:].replace('\n',' '))
        pg.evaluate("document.querySelector('#dNew').click()"); pg.wait_for_timeout(300)
        pg.fill('#input','webtest https://gone.example.com/zzz'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]'); pg.click('[data-tool=apply]'); idle(pg); print(mode,'404 ->',pg.inner_text('#messages')[-170:].replace('\n',' '))
        # --- tool lists
        ws=' '.join(reqs); print(mode,'web_fetch in tools:','"web_fetch"' in ws,'| prompt WEB rule:','LIVE INFORMATION' in ws and 'open.er-api.com' in ws)
        print(mode,'errors:',errs)
    b.close()
