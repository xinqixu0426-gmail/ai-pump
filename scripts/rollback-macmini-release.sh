#!/bin/zsh
set -euo pipefail

PROJECT_DIR=/Users/dan/pump-cost-accounting-system
NODE_BIN=/opt/homebrew/bin/node
NPM_BIN=/opt/homebrew/bin/npm
USER_PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

as_dan() {
  /usr/bin/sudo -u dan /usr/bin/env \
    HOME=/Users/dan \
    PATH="$USER_PATH" \
    "$@"
}

if [[ $EUID -ne 0 ]]; then
  echo "请使用 sudo 运行联合回滚脚本。" >&2
  exit 1
fi

if [[ $# -ne 2 ]]; then
  echo "用法: sudo ./scripts/rollback-macmini-release.sh <git-ref> <backup.db>" >&2
  exit 1
fi

TARGET_REF=$1
BACKUP_FILE=$2
cd "$PROJECT_DIR"

if [[ -n "$(as_dan /usr/bin/git status --porcelain --untracked-files=no)" ]]; then
  echo "存在未提交的已跟踪改动，拒绝回滚。" >&2
  exit 1
fi

TARGET_COMMIT=$(as_dan /usr/bin/git rev-parse --verify "${TARGET_REF}^{commit}")
CURRENT_COMMIT=$(as_dan /usr/bin/git rev-parse HEAD)
ROLLBACK_STAMP=$(/bin/date -u +%Y-%m-%dT%H-%M-%SZ)
ROLLBACK_LOG="$PROJECT_DIR/logs/rollback-$ROLLBACK_STAMP.json"
SERVICES_STOPPED=false

on_error() {
  local exit_code=$?
  if [[ "$SERVICES_STOPPED" == true ]]; then
    echo "联合回滚失败，服务保持停止以避免代码与数据库版本错配。" >&2
  else
    echo "联合回滚预检失败，现有服务未停止。" >&2
  fi
  echo "原提交: $CURRENT_COMMIT" >&2
  echo "目标提交: $TARGET_COMMIT" >&2
  if [[ -f "$ROLLBACK_LOG" ]]; then
    echo "恢复结果及 safety 备份位置: $ROLLBACK_LOG" >&2
  fi
  exit "$exit_code"
}
trap on_error ERR

as_dan "$NODE_BIN" scripts/manage-database-backups.cjs verify \
  --file "$BACKUP_FILE" \
  --expect-commit "$TARGET_COMMIT"

/bin/launchctl bootout system/com.pumpfactory.api 2>/dev/null || true
/bin/launchctl bootout system/com.pumpfactory.web 2>/dev/null || true
SERVICES_STOPPED=true

for _attempt in {1..20}; do
  if ! /usr/bin/nc -z 127.0.0.1 3002 2>/dev/null; then
    break
  fi
  /bin/sleep 1
done
if /usr/bin/nc -z 127.0.0.1 3002 2>/dev/null; then
  echo "API 端口 3002 未停止，拒绝替换数据库。" >&2
  exit 1
fi

RESTORE_RESULT=$(as_dan "$NODE_BIN" scripts/manage-database-backups.cjs restore \
  --file "$BACKUP_FILE" \
  --confirm RESTORE_PUMP_DB \
  --expect-commit "$TARGET_COMMIT" \
  --current-commit "$CURRENT_COMMIT" \
  --skip-port-check)
/usr/bin/printf '%s\n' "$RESTORE_RESULT" > "$ROLLBACK_LOG"
/usr/sbin/chown dan:staff "$ROLLBACK_LOG"

as_dan /usr/bin/git switch --detach "$TARGET_COMMIT"
as_dan "$NPM_BIN" ci
as_dan "$NPM_BIN" --prefix apps/web-next ci
as_dan "$NPM_BIN" run verify:release
./scripts/install-macmini-launchdaemons.sh

/usr/bin/curl --fail --silent --show-error http://127.0.0.1:3002/api/health >/dev/null
/usr/bin/curl --fail --silent --show-error http://127.0.0.1:3000/login >/dev/null

trap - ERR
echo "联合回滚完成。"
echo "当前提交: $TARGET_COMMIT"
echo "数据库恢复记录: $ROLLBACK_LOG"
