import docx, openpyxl, pptx, os
from playwright.sync_api import sync_playwright
d = '/tmp/kt/docs'; os.makedirs(d, exist_ok=True)
D = docx.Document(); D.add_paragraph('Hello report & <tags>'); D.add_paragraph('আমার নাম কামিল'); t = D.add_table(rows=1, cols=2); t.cell(0,0).text='A1'; t.cell(0,1).text='B1'; D.save(d+'/r.docx')
W = openpyxl.Workbook(); s = W.active; s.title='Sales'; s.append(['Name','Qty']); s.append(['Pen', 12]); s.append(['Book', 3.5]); W.save(d+'/s.xlsx')
P = pptx.Presentation(); sl = P.slides.add_slide(P.slide_layouts[1]); sl.shapes.title.text='Launch plan'; sl.placeholders[1].text='Step one\nStep two'; P.save(d+'/p.pptx')
open(d+'/bad.docx','wb').write(b'not a zip')
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width':360,'height':740}).new_page(); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); pg.click('#sSkip'); pg.wait_for_selector('#topFolderBtn')
    pg.set_input_files('#fileInput', [d+'/r.docx', d+'/s.xlsx', d+'/p.pptx'])
    pg.wait_for_timeout(800)
    print('chips:', pg.locator('#chips .achip').count())
    got = pg.evaluate("""async () => { const M = await import('./js/docs.js'); const out = {};
      for (const n of ['r.docx','s.xlsx','p.pptx']) { const r = await fetch('/__f/' + n).catch(()=>null); } return 1; }""")
    assert pg.locator('#chips .achip').count() == 3
    pg.set_input_files('#fileInput', [d+'/bad.docx']); pg.wait_for_timeout(500)
    print('bad file chips:', pg.locator('#chips .achip').count(), '| toast:', pg.evaluate("document.querySelector('#toast')? document.querySelector('#toast').textContent : ''"))
    print('errors:', errs)
    b.close()
