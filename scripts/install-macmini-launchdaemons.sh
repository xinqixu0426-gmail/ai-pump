#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
PROJECT_DIR=/Users/dan/Documents/pump-cost-accounting-system
USER_ID=$(/usr/bin/id -u dan)

if [[ $EUID -ne 0 ]]; then
  echo "请使用 sudo 运行此脚本。" >&2
  exit 1
fi

/bin/mkdir -p "$PROJECT_DIR/logs"
/usr/sbin/chown dan:staff "$PROJECT_DIR/logs"

cd "$PROJECT_DIR"
/opt/homebrew/bin/node scripts/verify-production-env.cjs

/bin/launchctl bootout "gui/$USER_ID/com.pumpfactory.api" 2>/dev/null || true
/bin/launchctl bootout "gui/$USER_ID/com.pumpfactory.web" 2>/dev/null || true
/bin/rm -f /Users/dan/Library/LaunchAgents/com.pumpfactory.api.plist
/bin/rm -f /Users/dan/Library/LaunchAgents/com.pumpfactory.web.plist

/bin/launchctl bootout system/com.pumpfactory.api 2>/dev/null || true
/bin/launchctl bootout system/com.pumpfactory.web 2>/dev/null || true

/usr/bin/install -o root -g wheel -m 644 \
  "$SCRIPT_DIR/com.pumpfactory.api.daemon.plist" \
  /Library/LaunchDaemons/com.pumpfactory.api.plist
/usr/bin/install -o root -g wheel -m 644 \
  "$SCRIPT_DIR/com.pumpfactory.web.daemon.plist" \
  /Library/LaunchDaemons/com.pumpfactory.web.plist

/bin/launchctl bootstrap system /Library/LaunchDaemons/com.pumpfactory.api.plist
/bin/launchctl bootstrap system /Library/LaunchDaemons/com.pumpfactory.web.plist
/bin/launchctl enable system/com.pumpfactory.api
/bin/launchctl enable system/com.pumpfactory.web
/bin/launchctl kickstart -k system/com.pumpfactory.api
/bin/launchctl kickstart -k system/com.pumpfactory.web

echo "系统级水泵服务已安装并启动。"
