#!/bin/bash
# 每日同步（在 Mac 上由 launchd 執行）：爬買動漫 → 產生網站資料 → 測試 → 有變動就推送到 GitHub。
# 買動漫擋海外機房 IP，GitHub Actions 連不上，所以爬蟲改在台灣的電腦跑。
#
# 使用獨立的 clone（~/Library/Application Support/topa-store-sync/repo），不會動到你平常開發的資料夾。
# 記錄檔：~/Library/Logs/topa-store-sync.log
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
REPO_URL="https://github.com/samoyedtopa1120-cmd/topa-store.git"
HOME_DIR="$HOME/Library/Application Support/topa-store-sync"
REPO="$HOME_DIR/repo"
GIT=(git -c credential.helper= -c 'credential.helper=!gh auth git-credential')

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

mkdir -p "$HOME_DIR"
# 同一時間只跑一個（超過 1 小時的鎖視為上次異常中斷）
LOCK="$HOME_DIR/lock.d"
if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60)" ]; then rmdir "$LOCK"; fi
if ! mkdir "$LOCK" 2>/dev/null; then log "已有同步在執行，略過"; exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

log "開始同步"
if [ ! -d "$REPO/.git" ]; then
  "${GIT[@]}" clone -q "$REPO_URL" "$REPO"
fi
cd "$REPO"
git config user.name "samoyedtopa1120-cmd"
git config user.email "293879392+samoyedtopa1120-cmd@users.noreply.github.com"

# 永遠以 GitHub 上的最新版本為準（這個資料夾只給同步用）
"${GIT[@]}" fetch -q origin main
git reset -q --hard origin/main
git clean -qfd

# 同步腳本本身也跟著 GitHub 更新（下次執行生效）
if ! cmp -s tools/mac-sync/sync.sh "$HOME_DIR/sync.sh"; then
  # 用 mv 換檔（新 inode），避免覆蓋到正在執行中的這個腳本
  cp tools/mac-sync/sync.sh "$HOME_DIR/sync.sh.new" && mv -f "$HOME_DIR/sync.sh.new" "$HOME_DIR/sync.sh"
  log "同步腳本已更新"
fi

set +e
node tools/crawl-myacg.mjs
code=$?
set -e
if [ "$code" -ne 0 ] && [ "$code" -ne 2 ]; then
  log "爬蟲失敗（結束碼 $code），不更新網站"
  exit "$code"
fi

node tools/build-site.mjs
npm test --silent > /dev/null

git add docs/data docs/assets/myacg
if git diff --cached --quiet; then
  log "沒有變動"
  exit 0
fi
git commit -q -m "同步買動漫商品 $(date '+%Y-%m-%d %H:%M')"
"${GIT[@]}" push -q origin HEAD:main
log "已推送：$(git log -1 --format='%h %s')"
