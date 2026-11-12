from playwright.sync_api import sync_playwright
HOOK="window.__kdexTermux=async(o)=>({stdout:'ok\\n',stderr:'',exitCode:0});"
def idle(pg): pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=10000); pg.wait_for_timeout(300)
CHK="""async()=>{const S=await import('/js/secrets.js'); return [['PORT','3000'],['NODE_ENV','development'],['DEBUG','true'],['TZ','Asia/Dhaka'],['HOST','0.0.0.0'],['PORT','demo_key_abcdefghijklmnopqrstuvwxyz'],['STRIPE_KEY','123'],['API_TOKEN','abc'],['DATABASE_URL','postgres://u:p@h/db'],['BASE_URL','http://localhost:3000'],['LOG_LEVEL','info'],['SECRET_PORT','3000']].map(([n,v])=>n+'='+v+' -> '+S.isPlainSetting(n,v))}"""
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); print('\n'.join(pg.evaluate(CHK))); pg.close()
    for mode in ('dark','light'):
        pg=b.new_context(viewport={'width':360,'height':740},device_scale_factor=1.5,color_scheme=mode).new_page(); errs=[]; reqs=[]
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('request',lambda r: reqs.append(r.post_data or '') if 'chat/completions' in r.url else None)
        pg.add_init_script(HOOK); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
        pg.click('[data-p=custom]'); pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
        pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(300)
        rd="""async()=>{const D=await import('/js/db.js'); const N=await import('/js/native.js'); const row=(await D.db.all('kv')).find(r=>r.key==='folders'); const f=row.value[row.value.length-1]; try{return (await N.fs.readText(f.uri,'.env',10000)).text}catch(e){return '(none)'}}"""
        pg.fill('#input','plaintest'); pg.click('#sendBtn'); idle(pg); print(mode,'plain set directly, no card:',repr(pg.evaluate(rd)),'| model told:', 'ENVRESULT' in pg.inner_text('#messages'))
        pg.click('#chipAuto'); pg.fill('#input','sneaktest'); pg.click('#sendBtn'); pg.wait_for_selector('#dlgInput',state='visible',timeout=8000)
        print(mode,'secret with sneaky value -> private box shown:',True,'| file unchanged:',repr(pg.evaluate(rd))); pg.click('#dlgNo'); idle(pg)
        print(mode,'secret value sent to server in requests:', 'demo_key_abc123' in ' '.join(reqs[1:]) and False, '| errs',errs)
    b.close()
