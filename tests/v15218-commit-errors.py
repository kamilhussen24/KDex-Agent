from playwright.sync_api import sync_playwright
import sys, subprocess, shutil, time, os
ok=True
def chk(c,m):
    global ok; print(('PASS ' if c else 'FAIL ')+m); ok=ok and c
shutil.rmtree('/tmp/wwwt',ignore_errors=True); shutil.copytree('/home/claude/kdex-android/www','/tmp/wwwt')
with open('/tmp/wwwt/js/main.js','a') as f: f.write("\nwindow.__t={draftMessage,explainGitError};\n")
with open('/tmp/wwwt/js/git.js','a') as f: f.write("\nexport { nice as __nice };\n")
srv=subprocess.Popen(['python3','-m','http.server','4013'],cwd='/tmp/wwwt',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://127.0.0.1:4013/'); pg.wait_for_timeout(700)
    r=pg.evaluate("""async()=>{const T=window.__t,U=await import('/js/util.js'),G=await import('/js/git.js');
      const c=(p,k)=>({path:p,kind:k}); const o={};
      o.one=T.draftMessage([c('a/b/index.html','modified')]);
      o.mix=T.draftMessage([c('index.html','new'),c('indexh.html','deleted')]);
      o.many=T.draftMessage([1,2,3,4,5].map(i=>c('f'+i,'modified')));
      o.manyMix=T.draftMessage([c('a','new'),c('b','new'),c('c','modified'),c('d','deleted'),c('e','deleted')]);
      o.card=T.explainGitError('Write a commit message.');
      o.cardLong=T.explainGitError('Something odd happened with no punctuation and a very long text that goes past sixty characters easily');
      o.conn=U.connText(new Error('Failed to connect to /1.2.3.4:443'),'https://api.example.com/v1');
      o.connNet=U.netText(new Error('Failed to connect to /1.2.3.4:443'));
      o.dns=U.netText(new Error('Unable to resolve host "x"'));
      o.gitRefused=G.__nice(new Error('TransportException: https://gitlab.com/a.git: ConnectException: Connection refused'),{host:'gitlab.com',action:'push'}).message;
      o.offlineConn=G.__nice(new Error('TransportException: https://gitlab.com/a.git: failed to connect to gitlab.com/2606:4700::1 (port 443) after 10000ms: connect failed: ENETUNREACH (Network is unreachable)'),{host:'gitlab.com',action:'push'}).message;
      return o;}""")
    chk(r['one']=='Update index.html','one file: '+r['one'])
    chk(r['mix']=='Add index.html, remove indexh.html','add+remove: '+r['mix'])
    chk(r['many']=='Update 5 files','many same kind: '+r['many'])
    chk(r['manyMix']=='Update 5 files: 2 new, 1 changed, 2 removed','many mixed: '+r['manyMix'])
    chk(r['card']['title']=='Write a commit message' and r['card']['body']=='','short notice keeps plain title')
    chk(r['cardLong']['title']=='Git could not finish','long unknown still generic')
    chk(r['conn'].startswith('Could not connect to api.example.com'),'connect failed names the host')
    chk(r['connNet']=='','connect failed is not "no internet"')
    chk(r['dns']!='','DNS failure is still "no internet"')
    chk(r['gitRefused'].startswith('Could not connect to gitlab.com'),'git refused: '+r['gitRefused'])
    chk(r['offlineConn'].startswith('No connection to gitlab.com'),'no network with failed-to-connect text is still no connection: '+r['offlineConn'])
    chk(not errs,'no page errors %s'%errs)
finally: srv.terminate()
print('ALL PASS' if ok else 'SOME FAIL'); sys.exit(0 if ok else 1)
