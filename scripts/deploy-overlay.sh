#!/usr/bin/env bash
# Overlay websites/wvwccc onto the Render deploy branch root and push.
set -euo pipefail
R=/e/Documents/GitHub/Heedbusinesssolutions
SRC="$R/websites/wvwccc"
DEPLOY_BRANCH=claude/hopeful-hellman-6f7a38
SRC_BRANCH=claude/rebuild-chamber-website-LXSM5
WT="$R/.claude/worktrees/deploy-hh"

cd "$R"

# 1) commit + push the working branch (only the two changed backend files)
git add websites/wvwccc/backend/email.js websites/wvwccc/backend/chamber-routes.js websites/wvwccc/scripts/deploy-overlay.sh
git commit -m "WVWCCC: email via Microsoft Graph (app creds) with SMTP fallback + admin email-test diagnostic

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "(nothing to commit on source)"
git push origin "$SRC_BRANCH"

# 2) refresh a clean deploy worktree at the remote deploy head
git worktree remove --force "$R/.claude/worktrees/hopeful-hellman-6f7a38" 2>/dev/null || true
git worktree remove --force "$WT" 2>/dev/null || true
rm -rf "$WT"
git fetch origin "$DEPLOY_BRANCH"
git worktree add "$WT" "$DEPLOY_BRANCH"
git -C "$WT" reset --hard "origin/$DEPLOY_BRANCH"

# 3) overlay source onto deploy root (exclude bulk/PII)
echo "=== overlay to deploy branch ==="
tar -C "$SRC" --exclude=node_modules --exclude=.env.local --exclude=.env.local.example --exclude='data/_store' --exclude='*.xlsx' -cf - . | tar -C "$WT" -xf -

# 4) PII guard
if git -C "$WT" status --porcelain | grep -E "_store/|\.env\.local$|\.xlsx$"; then
  echo "PII DETECTED — ABORT"; exit 1
else
  echo "no PII"
fi
echo "Wendy in backend: $(grep -c 'You are Wendy' "$WT/backend/chamber-routes.js")"
[ -f "$WT/backend/email.js" ] && echo "email.js present"
grep -q "graph sendMail" "$WT/backend/email.js" && echo "graph send present"
grep -q "/admin/email-test" "$WT/backend/chamber-routes.js" && echo "email-test route present"

# 5) commit + push deploy
git -C "$WT" add -A
git -C "$WT" commit -m "Deploy: Microsoft Graph email + SMTP fallback + admin email-test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "(nothing to commit on deploy)"
git -C "$WT" push origin "HEAD:$DEPLOY_BRANCH"

# 6) cleanup
cd "$R"
git worktree remove --force "$WT"
echo "DEPLOY DONE -> $(git ls-remote origin $DEPLOY_BRANCH | cut -c1-12)"
