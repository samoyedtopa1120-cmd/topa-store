#!/bin/bash
# 手動同步買動漫：拉最新程式 → 爬買動漫 → 產生網站資料 → 測試 → 有變動就推送到 GitHub。
#   npm run sync
#
# 買動漫只開放台灣一般網路連線（GitHub、Google 的機器都會被擋），所以要在自己的電腦上執行。
# 只會 commit 商品資料與圖片（docs/data、docs/assets/myacg），不會動到你其他還沒 commit 的修改。
set -euo pipefail
cd "$(dirname "$0")/.."

GIT=(git -c credential.helper= -c 'credential.helper=!gh auth git-credential')
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

step "取得 GitHub 上的最新版本"
"${GIT[@]}" pull -q --rebase --autostash origin main

step "爬買動漫（約 3 分鐘，請求間隔 5 秒）"
set +e
node tools/crawl-myacg.mjs
code=$?
set -e
if [ "$code" -ne 0 ] && [ "$code" -ne 2 ]; then
  echo "爬蟲失敗（結束碼 $code），網站沒有更新。請確認網路，或稍後再試。"
  exit "$code"
fi
[ "$code" -eq 2 ] && echo "注意：有部分商品抓取失敗，其餘商品照常更新。"

step "產生網站資料"
node tools/build-site.mjs

step "測試"
if npm test --silent > /dev/null 2>&1; then echo "測試通過"; else echo "測試失敗，網站沒有更新："; npm test; exit 1; fi

step "推送到 GitHub"
git add docs/data docs/assets/myacg
if git diff --cached --quiet -- docs/data docs/assets/myacg; then
  echo "買動漫沒有變動，不需要推送。"
  exit 0
fi
git diff --cached --stat -- docs/data docs/assets/myacg | tail -1
git -c user.name="samoyedtopa1120-cmd" -c user.email="293879392+samoyedtopa1120-cmd@users.noreply.github.com" \
  commit -q -m "同步買動漫商品 $(date '+%Y-%m-%d %H:%M')" -- docs/data docs/assets/myacg
"${GIT[@]}" push -q origin HEAD:main
echo "已推送：$(git log -1 --format='%h %s')，約 1 分鐘後網站更新。"
