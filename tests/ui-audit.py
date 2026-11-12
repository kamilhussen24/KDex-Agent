from playwright.sync_api import sync_playwright
import json,sys
HOOK="window.__kdexTermux=async(o)=>({stdout:'ok\\n',stderr:'',exitCode:0});"
AUD="""(vw)=>{
 const res=[]; const vis=e=>{const r=e.getBoundingClientRect(); const cs=getComputedStyle(e); return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&e.closest('.hidden')==null && r.bottom>0 && r.top<innerHeight+2000};
 const sel='button,a,input,select,textarea,[role=button],.row-item,.chip,.icon-btn,.seg .btn,.btn';
 const seen=new Set();
 // consider only elements in the top-most open layer: sheet if open, else app
 const sheetOpen=!document.querySelector('#sheet').classList.contains('hidden'); const dlg=!document.querySelector('#dialog').classList.contains('hidden');
 const root=dlg?document.querySelector('#dialog'):sheetOpen?document.querySelector('#sheet'):document.body;
 root.querySelectorAll(sel).forEach(e=>{ if(seen.has(e)||!vis(e)) return; seen.add(e);
  if(!dlg&&!sheetOpen&&e.closest('#sheet,#dialog')) return; if(e.closest('#drawer')&&!document.body.classList.contains('drawer-open')&&getComputedStyle(document.querySelector('#drawer')).transform!=='none'&&document.querySelector('#drawer').getBoundingClientRect().right<=0) return;
  const r=e.getBoundingClientRect(); const name=(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).slice(0,2).join('.'):'')+' "'+(e.innerText||e.getAttribute('aria-label')||e.placeholder||'').trim().slice(0,24)+'"';
  const isInput=/^(input|textarea|select)$/i.test(e.tagName);
  if((r.height<32||r.width<32)&&!isInput&&!e.matches('.seg .btn,.tab')) res.push(['small',name,Math.round(r.width)+'x'+Math.round(r.height)]);
  if((r.right>vw+0.5||r.left<-0.5)&&!e.closest('.ctxbar')&&!e.closest('#drawer')) res.push(['offscreen',name,Math.round(r.left)+'..'+Math.round(r.right)]);
  const lbl=e.querySelector(':scope > .lbl, :scope > span.lbl');
  if(lbl && lbl.scrollWidth>lbl.clientWidth+1 && getComputedStyle(lbl).textOverflow!=='ellipsis') res.push(['clipped',name,lbl.scrollWidth+'>'+lbl.clientWidth]);
  const ic=e.querySelector(':scope > svg.ic');
  if(ic&&lbl&&lbl.textContent.trim()){ const a=ic.getBoundingClientRect(), b=lbl.getBoundingClientRect(); const d=(a.top+a.height/2)-(b.top+b.height/2); if(Math.abs(d)>1.6) res.push(['icon-misaligned',name,d.toFixed(1)+'px']); }
 });
 // text clipping anywhere (non-ellipsis)
 root.querySelectorAll('div,span,p,b,small,h2,h3,label,code,pre').forEach(e=>{ if(!vis(e)) return; const cs=getComputedStyle(e); if(e.scrollWidth>e.clientWidth+2 && (cs.overflowX==='hidden'||cs.overflowX==='clip') && cs.textOverflow!=='ellipsis' && e.clientWidth>0 && e.children.length===0) res.push(['text-clipped',(e.id||e.className||e.tagName)+' "'+e.textContent.trim().slice(0,24)+'"',e.scrollWidth+'>'+e.clientWidth]); });
 if(document.documentElement.scrollWidth>vw+1) res.push(['page-hscroll','document',document.documentElement.scrollWidth]);
 return res;}"""
def run(vw,mode,b):
    pg=b.new_context(viewport={'width':vw,'height':740},color_scheme=mode).new_page(); out=[]
    pg.add_init_script(HOOK); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500)
    A=lambda label: [out.append((label,)+tuple(x)) for x in pg.evaluate(AUD,vw)]
    A('setup'); pg.click('[data-p=custom]'); pg.wait_for_timeout(100); A('setup-custom')
    pg.fill('#sUrl','http://127.0.0.1:4010'); pg.fill('#sKey','k'); pg.fill('#mpMan','mock-a'); pg.click('#mpAdd'); pg.click('#sGo'); pg.wait_for_selector('#modelSelect option',state='attached'); pg.wait_for_timeout(2700)
    A('empty-chat'); pg.click('#menuBtn'); pg.wait_for_timeout(450); A('drawer'); pg.mouse.click(vw-8,400); pg.wait_for_timeout(300)
    pg.click('#topFolderBtn'); pg.wait_for_timeout(300); A('projects'); pg.click('#pOpen'); pg.wait_for_selector('#chipGit'); pg.wait_for_timeout(400)
    A('folder-chat')
    pg.click('#chipFolder'); pg.wait_for_timeout(250); A('projects-with-folder'); pg.click('#sheetClose')
    pg.click('#chipFiles'); pg.wait_for_timeout(300); A('files'); pg.click('#sheetClose')
    pg.click('#chipGit'); pg.wait_for_timeout(600); A('git-start'); pg.click('[data-m=new]'); pg.wait_for_timeout(150); A('git-new'); pg.click('[data-m=clone]') if pg.query_selector('[data-m=clone]') else None; pg.wait_for_timeout(150); A('git-clone'); pg.click('#sheetClose')
    pg.click('#thinkBtn'); pg.wait_for_timeout(150); A('think-menu'); pg.click('[data-think=off]')
    pg.click('#chipTerm'); pg.wait_for_selector('#tSeg'); pg.click('#tSeg [data-v="1"]'); pg.wait_for_selector('#tmTest'); A('terminal'); pg.click('#sheetClose')
    pg.click('#menuBtn'); pg.click('#dSettings'); pg.wait_for_timeout(400)
    for i,y in enumerate((0,500,1000,1500,2000,2500)):
        pg.evaluate(f"document.querySelector('#sheetBody').scrollTop={y}"); pg.wait_for_timeout(100); A(f'settings-{i}')
    pg.click('#usageBtn'); pg.wait_for_timeout(200); A('usage'); pg.click('#sheetBack'); pg.click('#sheetClose')
    pg.fill('#input','plantest'); pg.click('#sendBtn'); pg.wait_for_selector('[data-tool=apply]',timeout=8000); pg.wait_for_timeout(200); A('approval')
    pg.click('[data-tool=apply]'); pg.wait_for_function("document.querySelector('#sendBtn').getAttribute('aria-label')=='Send'",timeout=10000); pg.wait_for_timeout(300); A('plan-done')
    pg.click('#chipChanges'); pg.wait_for_timeout(250); A('changes'); pg.click('#sheetClose')
    pg.click('#menuBtn'); pg.wait_for_timeout(400); A('drawer-with-chats'); pg.mouse.click(vw-8,400); pg.wait_for_timeout(250)
    pg.click('#topFolderBtn'); pg.click('#pOpen'); pg.wait_for_selector('#dlgAlt:not(.hidden)'); A('choice-dialog'); pg.click('#dlgNo')
    return out
with sync_playwright() as p:
    b=p.chromium.launch(); allr={}
    for vw in (320,360,412):
        for mode in ('light','dark'):
            for r in run(vw,mode,b): allr.setdefault(r[1:],set()).add(f'{vw}{mode[0]}@{r[0]}')
    for k,v in sorted(allr.items()): print(k, sorted(v)[:4], len(v))
    print("findings:",len(allr)); b.close()
