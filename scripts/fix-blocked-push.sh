#!/data/data/com.termux/files/usr/bin/env bash
# Fixes "push declined due to repository rule violations" caused by an old local commit that contains a secret.
# Run it inside the repository, after the project files are already up to date:  bash scripts/fix-blocked-push.sh
set -e
cd "$(git rev-parse --show-toplevel)"
if grep -rnE "sk_li[v]e_" . --exclude-dir=.git --exclude-dir=node_modules >/dev/null 2>&1; then
  echo "Found text that looks like a live key in your files. Remove it first:"
  grep -rnE "sk_li[v]e_" . --exclude-dir=.git --exclude-dir=node_modules
  exit 1
fi
git fetch origin
BR=$(git rev-parse --abbrev-ref HEAD)
echo "Local commits that are not on origin/$BR:"; git log --oneline "origin/$BR..HEAD"
read -r -p "Combine them into one clean commit? (y/N) " a
[ "$a" = "y" ] || { echo "Cancelled. Nothing changed."; exit 0; }
git reset --soft "origin/$BR"
git add -A
git commit -m "Update KDex Agent"
git push origin "$BR"
