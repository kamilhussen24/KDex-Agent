import base64
from playwright.sync_api import sync_playwright
def idle(pg): pg.wait_for_function("document.querySelector('#stopBtn').classList.contains('hidden')",timeout=12000); pg.wait_for_timeout(300)
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC')
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_context(viewport={'width':360,'height':740}).new_page(); errs=[]; reqs=[]
    pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('request',lambda r: reqs.append(r.post_data or '') if 'chat/completions' in r.url else None)
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
    pg.evaluate("""async(b64)=>{const A=await import('./js/agent.js');const N=await import('./js/native.js');const fl=await A.getFolders();const f=fl[fl.length-1];
      const bin=atob(b64);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);await N.fs.writeBytes(f.uri,'pic.png',u);}""", base64.b64encode(PNG).decode())
    pg.fill('#input','imgtest'); pg.click('#sendBtn'); idle(pg)
    t=pg.inner_text('#messages'); print('view_image card:', 'view_image' in t, '| model saw picture message:', 'IMGSEEN' in t)
    last=[r for r in reqs if 'IMGSEEN' not in r][-1]
    import json; j=json.loads(last); roles=[m['role'] for m in j['messages']]; print('roles order:',roles[-4:], '| image part present:', 'image_url' in last, '| tool names:', 'view_image' in last)
    pg.fill('#input','imgtest again'); pg.click('#sendBtn'); idle(pg)
    print('errors:',errs); b.close()
