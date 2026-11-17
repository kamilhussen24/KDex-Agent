const SECRET_PARTS = [
  '(?:^|[\\s/"\'=:<>(])\\.env(?!\\.(?:example|sample|template|dist|defaults)\\b)(?:\\.[\\w-]+)?(?=$|[\\s"\';|&)<>:,])',
  '\\.(?:pem|p12|pfx|jks|keystore|asc|gpg|key)(?=$|[\\s"\';|&)<>:,])',
  '\\b(?:id|[\\w-]+)_(?:rsa|ecdsa|ed25519|dsa)\\b',
  '\\.(?:netrc|git-credentials|npmrc|pypirc|pgpass|htpasswd)\\b',
  '(?:^|[\\s/"\'=:])\\.(?:ssh|aws|kube|gnupg)(?:/|\\s|$|["\'])',
  '\\.docker/config|\\.config/(?:gh|gcloud)\\b',
  '\\b(?:bash|zsh|sh|fish)_history\\b|\\.(?:python|mysql|psql)_history',
  '/etc/g?shadow\\b|/proc/[^\\s]*/environ',
  'service[-_]?account[\\w.-]*\\.json|google-services\\.json|\\.tfvars\\b',
  '(?:^|[\\s/"\'])(?:secrets?\\.(?:env|ya?ml|json|toml|ini)|credentials(?:\\.\\w+)?)(?=$|[\\s"\';|&)])',
  '\\bprintenv\\b|(?:^|[;&|\\n(]\\s*|\\s)(?:env|set|export\\s+-p|declare\\s+-x)(?=\\s*(?:$|[;&|)]))',
  '\\bpm2\\s+(?:env|show|describe|info|jlist|prettylist)\\b',
  '\\bdocker\\s+(?:inspect|compose\\s+config)\\b|\\bdocker-compose\\s+config\\b|\\bdocker\\s+exec\\b[^\\n;|&]*\\b(?:env|printenv)\\b',
  '\\bsystemctl\\s+(?:show|cat|show-environment)\\b',
  '(?:^|[;&|\\n]\\s*)history\\b',
  '\\bkubectl\\s+(?:get\\s+secrets?|describe\\s+secrets?|config\\s+view)\\b',
];
const SECRET_READ = new RegExp(SECRET_PARTS.join('|'), 'i');
export function redactPatterns(text) {
  return String(text)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, '[private key hidden]')
    .replace(/\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g, '***')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{20,}=*/g, 'Bearer ***')
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|PRIVATE|CREDENTIALS?|AUTH(?!OR))[A-Z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"']{6,})\3/g, '$1$2$3***$3')
    .replace(/"([\w.-]*(?:key|secret|token|passw(?:or)?d|pwd|credentials?|authorization)|pass)"(\s*:\s*)"([^"]{6,})"/gi, '"$1"$2"***"');
}

const bad=['cat .env','cat /root/app/.env.production','rev .env','tr a-z A-Z < .env','cut -c1-80 .env','sort .env','source .env && echo $KEY','while read l; do echo $l; done < .env','printenv','env','pm2 show kdex-chat','pm2 env 11','pm2 jlist','cat ~/.ssh/id_rsa','cat ~/amnezia_ed25519','cat ~/.aws/credentials','cat /proc/1/environ','docker inspect web','tac .env','cat /etc/shadow','python3 -c "print(open(\'.env\').read())"','cat ~/.docker/config.json','cat ~/.config/gh/hosts.yml','cat ~/.bash_history','history','ls ~/.ssh','systemctl show nginx','env | sort','export -p'];
const good=['ls -la','cat package.json','pm2 status','pm2 restart kdex-chat --update-env','pm2 logs kdex-chat --lines 20','npm install','node server.js','git status','env FOO=1 node x.js','set -e','grep -rn "box-shadow" src','cat .env.example','cp .env.example x','ls /etc/nginx/sites-enabled','tail -n 50 /var/log/nginx/error.log','curl -sI https://kamildex.com','systemctl restart nginx','systemctl status nginx','docker ps','cat README.md','echo $HOME','python3 -m venv .venv','source .venv/bin/activate','df -h','free -m','nginx -t','cat /etc/hostname'];
let ok=true;
for (const c of bad) if(!SECRET_READ.test(c)){ok=false;console.log('MISSED  ',c);}
for (const c of good) if(SECRET_READ.test(c)){ok=false;console.log('FALSEPOS',c);}
console.log(ok?'rules ok':'rules FAIL');
const r=redactPatterns(`BOT_TOKEN=12345:ABCdefGhIJKlmNoPQRsTUVwxyz
DB_PASSWORD="hunter2hunter2"
PORT=3100
"apiKey": "abcdef123456", "name": "kdex-chat"
Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456
sk-ant-${''}api03-abcdefghijklmnopqrstuvwx
-----BEGIN OPENSSH PRIV${''}ATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAA
-----END OPENSSH PRIV${''}ATE KEY-----
box-shadow: 0 0 4px; keyboard=short`);
console.log(r);

// v1.49.9: harmless words must not be masked
for (const s of ['{"author": "Kamil Hussen", "passport": "^0.6.0", "name": "kdex-chat"}','"password-validator": "^1.2.3", "bypass": "yes-please"','GIT_AUTHOR_NAME=Kamil Hussen']) {
  if (redactPatterns(s)!==s) { console.log('FALSE POSITIVE', s); process.exitCode=1; }
}
if (redactPatterns('"apiKey": "abcdef123456"')==='"apiKey": "abcdef123456"') { console.log('MISSED apiKey'); process.exitCode=1; }
