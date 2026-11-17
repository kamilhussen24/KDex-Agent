from playwright.sync_api import sync_playwright
import sys
ok=True
def chk(c,m):
    global ok; print(('PASS ' if c else 'FAIL ')+m); ok=ok and c
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context().new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(600)
    r=pg.evaluate("""async()=>{const U=await import('/js/util.js'); const out={};
      out.jgitReject=U.netText(new Error('TransportException: https://gitlab.com/a/b.git: cannot open git-receive-pack | caused by HttpServerException: 403'));
      out.jgitDns=U.netText(new Error('TransportException: https://gitlab.com/a/b.git: cannot open git-upload-pack | caused by UnknownHostException: Unable to resolve host "gitlab.com"'));
      out.enet=U.netText(new Error('connect failed: ENETUNREACH (Network is unreachable)'));
      return out;}""")
    chk(r['jgitReject']=='','JGit rejection is not shown as no internet')
    chk(r['jgitDns']!='','real DNS failure still shown as no internet')
    chk(r['enet']!='','network unreachable still no internet')
    chk(not errs,'no page errors %s'%errs)
print('ALL PASS' if ok else 'SOME FAIL'); sys.exit(0 if ok else 1)
