# v1.54.0: create-repository and token messages name the real service (GitHub, GitLab, other host). Needs: cd www && python3 -m http.server 4011
from playwright.sync_api import sync_playwright
JS = """async ([provider, host, status, body]) => {
  const g = await import('./js/git.js'); const real = window.fetch;
  window.fetch = async () => new Response(JSON.stringify(body), { status });
  try { await g.createRemoteRepo({ provider, host, token: 't', name: 'demo', isPrivate: true }); return 'ok'; } catch (e) { return e.message; } finally { window.fetch = real; }
}"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.goto('http://127.0.0.1:4011/'); pg.wait_for_timeout(500); bad = []
    def chk(args, must, mustnot=()):
        m = pg.evaluate(JS, args); good = all(x in m for x in must) and not any(x in m for x in mustnot); print(('PASS ' if good else 'FAIL ') + str(args[:3]) + ' -> ' + m)
        if not good: bad.append(args)
    chk(['gitlab', 'gitlab.com', 403, {'message': 'insufficient_scope'}], ['GitLab', '"api"'], ['GitHub', '"repo"'])
    chk(['gitlab', 'git.corp.io', 401, {}], ['GitLab (git.corp.io)', 'did not accept'], ['GitHub'])
    chk(['github', 'github.com', 403, {}], ['GitHub', '"repo"', 'Administration'], ['GitLab'])
    chk(['gitlab', 'gitlab.com', 400, {'message': {'name': ['has already been taken']}}], ['GitLab', 'demo'], ['GitHub'])
    chk(['github', 'github.com', 500, {}], ['GitHub', 'HTTP 500'])
    b.close()
print('PASS' if not bad else 'FAIL', bad)
