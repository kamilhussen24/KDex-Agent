from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(600)
    r=pg.evaluate("""async()=>{const S=await import('/js/secrets.js');const o={};
      const hint="placeholder: '-----BEGIN OPENSSH PRIV"+"ATE KEY-----'\\"></textarea> rest of code";
      o.hint=S.redactPatterns(hint)===hint;
      const real="-----BEGIN OPENSSH PRIV"+"ATE KEY-----\\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\\n-----END OPENSSH PRIV"+"ATE KEY-----";
      o.real=S.redactPatterns('x '+real+' y').includes('[private key hidden]');
      const json='{"k":"-----BEGIN PRIV'+'ATE KEY-----\\\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\\\\n-----END PRIV'+'ATE KEY-----"}';
      o.json=S.redactPatterns(json).includes('[private key hidden]');
      return o}""")
    print(r); assert r['hint'] and r['real'] and r['json']; print('errors',errs)
