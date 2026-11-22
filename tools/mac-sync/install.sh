#!/bin/bash
# 在這台 Mac 安裝每日同步排程（launchd）。重複執行會覆蓋舊設定。
#   bash tools/mac-sync/install.sh            安裝
#   bash tools/mac-sync/install.sh uninstall  移除
#
# 排程：每天 05:00 與 13:00 各跑一次。Mac 睡眠時錯過的話，醒來後會補跑一次；關機時錯過則等下一個時間。
set -euo pipefail

LABEL="com.topa-store.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HOME_DIR="$HOME/Library/Application Support/topa-store-sync"
SCRIPT="$HOME_DIR/sync.sh"
LOG="$HOME/Library/Logs/topa-store-sync.log"
SRC="$(cd "$(dirname "$0")" && pwd)/sync.sh"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

if [ "${1:-}" = "uninstall" ]; then
  rm -f "$PLIST"
  echo "已移除排程（同步資料夾 $HOME_DIR 保留，可自行刪除）"
  exit 0
fi

mkdir -p "$HOME_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$SRC" "$SCRIPT"
chmod +x "$SCRIPT"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>5</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "已安裝排程：每天 05:00、13:00"
echo "立即執行一次：launchctl kickstart gui/$(id -u)/$LABEL"
echo "記錄檔：$LOG"
