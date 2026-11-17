from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(600)
    r=pg.evaluate("""async()=>{const N=await import('/js/native.js');const G=await import('/js/git.js');
      const f=await N.fs.pickFolder();
      await N.fs.writeText(f.uri,'hint.js',"const a='-----BEGIN OPENSSH PRIV"+"ATE KEY-----';\\n");
      await N.fs.writeText(f.uri,'real.pem',"-----BEGIN OPENSSH PRIV"+"ATE KEY-----\\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\\n-----END OPENSSH PRIV"+"ATE KEY-----\\n");
      await N.fs.writeText(f.uri,'real.json','{"k":"-----BEGIN PRIV'+'ATE KEY-----\\\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC"}\\n');
      const out=await G.scanSecrets(f,[{path:'hint.js',kind:'new'},{path:'real.pem',kind:'new'},{path:'real.json',kind:'new'}]);
      return out.map(x=>x.path+':'+x.kind)}""")
    print(r); assert r==['real.pem:Private key','real.json:Private key'], r; print('PASS', errs)
