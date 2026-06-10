#!/usr/bin/env bash
# Deploy websites/wvwccc to production.
#
# ⚠️ Render deploys ONLY from HeedAIConsulting/wvwccc `main` (verified 2026-06-09).
# The old overlay flow pushed to monorepo branch claude/hopeful-hellman-6f7a38,
# which Render does NOT watch — those "deploys" never went live.
#
# Flow: subtree-split websites/wvwccc from the source branch, fast-forward push
# to the standalone repo's main. Render auto-deploys (~3 min).
# Gitignored files (data/_store, *.xlsx, .env.local) are untracked → never ship.
set -euo pipefail
R=/e/Documents/GitHub/Heedbusinesssolutions
SRC_BRANCH=${1:-claude/rebuild-chamber-website-LXSM5}
DEPLOY_REPO=https://github.com/HeedAIConsulting/wvwccc.git

cd "$R"

# 1) make sure the source branch is committed + pushed
if ! git diff --quiet "$SRC_BRANCH" -- websites/wvwccc 2>/dev/null; then
  echo "NOTE: uncommitted changes under websites/wvwccc are NOT deployed — commit to $SRC_BRANCH first."
fi
git push origin "$SRC_BRANCH"

# 2) split + PII guard (nothing from data/_store or *.xlsx may be tracked)
git branch -D wvwccc-split 2>/dev/null || true
git subtree split --prefix=websites/wvwccc -b wvwccc-split "$SRC_BRANCH"
if git ls-tree -r --name-only wvwccc-split | grep -E "^data/_store/|\.xlsx$|\.env\.local$"; then
  echo "PII DETECTED in deploy tree — ABORT"; exit 1
fi
echo "no PII in deploy tree"

# 3) fast-forward push to the repo Render actually watches
git push "$DEPLOY_REPO" wvwccc-split:main
echo "DEPLOY PUSHED -> HeedAIConsulting/wvwccc main ($(git rev-parse --short wvwccc-split))"
echo "verify in ~3 min: curl -s https://wvwccc-web.onrender.com/api/members | head -c 80"
