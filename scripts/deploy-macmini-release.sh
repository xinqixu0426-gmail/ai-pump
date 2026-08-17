#!/bin/zsh
set -euo pipefail

PROJECT_DIR=${PUMP_PROJECT_DIR:-/Users/dan/pump-cost-accounting-system}
BRANCH=${PUMP_DEPLOY_BRANCH:-master}
NPM_BIN=/opt/homebrew/bin/npm
NODE_BIN=/opt/homebrew/bin/node
USER_PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
PUBLIC_BASE_URL=${PUMP_PUBLIC_BASE_URL:-https://xuxinqi.xin}
STARTED_AT=$(/bin/date +%s)
CURL_HTTP_ARGS=(--http1.1)

export PATH="$USER_PATH"

show_recent_log() {
  local label=$1
  local file=$2
  local modified_at
  if [[ ! -f "$file" ]]; then
    return
  fi
  modified_at=$(/usr/bin/stat -f %m "$file" 2>/dev/null || print 0)
  if (( modified_at >= STARTED_AT )); then
    echo "本次发布期间的 $label 错误日志：" >&2
    /usr/bin/tail -n 30 "$file" >&2 2>/dev/null || true
  fi
}

show_failure_diagnostics() {
  show_recent_log "API" "$PROJECT_DIR/logs/api-launchd.error.log"
  show_recent_log "Web" "$PROJECT_DIR/logs/web-launchd.error.log"
}

on_exit() {
  local code=$?
  if (( code != 0 )); then
    echo "发布未完成。服务若已重启会保持运行，请按上方首个失败项处理。" >&2
    show_failure_diagnostics
  fi
}
trap on_exit EXIT

wait_for_daemon() {
  local label=$1
  local attempts=30
  local output
  for ((i = 1; i <= attempts; i++)); do
    output=$(/bin/launchctl print "system/$label" 2>&1 || true)
    if [[ "$output" == *"state = running"* ]]; then
      return 0
    fi
    /bin/sleep 1
  done
  echo "$label 未在 ${attempts} 秒内进入 running 状态。" >&2
  return 1
}

wait_for_http() {
  local name=$1
  local url=$2
  local attempts=${3:-45}
  for ((i = 1; i <= attempts; i++)); do
    if /usr/bin/curl "${CURL_HTTP_ARGS[@]}" --silent --show-error --fail --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    /bin/sleep 1
  done
  echo "$name 未通过 HTTP 验收：$url" >&2
  return 1
}

validate_ready_commit() {
  local url=$1
  local expected_commit=$2
  local ready_json
  ready_json=$(/usr/bin/curl "${CURL_HTTP_ARGS[@]}" --silent --show-error --fail --max-time 8 "$url")
  READY_JSON="$ready_json" EXPECTED_COMMIT="$expected_commit" "$NODE_BIN" -e '
    const payload = JSON.parse(process.env.READY_JSON || "{}");
    const expected = process.env.EXPECTED_COMMIT || "";
    const actual = String(payload?.data?.runtime?.gitCommit || "");
    if (payload?.data?.ready !== true) throw new Error("ready 不是 true");
    if (!actual || !expected.startsWith(actual)) {
      throw new Error(`运行 commit 不一致：expected=${expected.slice(0, 12)} actual=${actual}`);
    }
    if (payload?.data?.checks?.startupBackup?.ok !== true) {
      throw new Error("启动备份未通过");
    }
  '
}

if [[ "$(/usr/bin/id -un)" != "dan" ]]; then
  echo "日常发布必须由 dan 用户执行。" >&2
  exit 1
fi
if [[ ! -d "$PROJECT_DIR/.git" ]]; then
  echo "未找到生产仓库：$PROJECT_DIR" >&2
  exit 1
fi

cd "$PROJECT_DIR"
/bin/mkdir -p logs

tracked_status=$(git status --porcelain --untracked-files=no)
if [[ -n "$tracked_status" ]]; then
  echo "生产工作区存在已跟踪文件改动，拒绝覆盖：" >&2
  echo "$tracked_status" >&2
  exit 1
fi
if [[ "$(git branch --show-current)" != "$BRANCH" ]]; then
  echo "生产分支不是 $BRANCH，拒绝发布。" >&2
  exit 1
fi

old_commit=$(git rev-parse HEAD)
echo "[1/9] 验证并备份当前版本 ${old_commit[1,7]}"
"$NPM_BIN" run db:backup:release -- --git-commit "$old_commit"
"$NPM_BIN" run db:backup:verify -- --latest --type release --expect-commit "$old_commit"

echo "[2/9] 获取 origin/$BRANCH"
git fetch origin "$BRANCH"
target_commit=$(git rev-parse "origin/$BRANCH")
if [[ "$old_commit" != "$target_commit" ]] &&
   ! git merge-base --is-ancestor "$old_commit" "$target_commit"; then
  echo "远端目标不是当前生产版本的快进提交，拒绝发布。" >&2
  exit 1
fi
git pull --ff-only origin "$BRANCH"
new_commit=$(git rev-parse HEAD)

changed_files=$(git diff --name-only "$old_commit" "$new_commit")
files_changed() {
  print -r -- "$changed_files" | /usr/bin/grep --extended-regexp --quiet "$1"
}
system_service_changed=false
if files_changed '^scripts/(com\.pumpfactory\.|pumpfactory-|install-macmini-launchdaemons\.sh)'; then
  system_service_changed=true
fi
if [[ "$system_service_changed" == true ]]; then
  echo "本次修改包含 LaunchDaemon 系统文件。" >&2
  echo "请先运行一次 sudo ./scripts/install-macmini-launchdaemons.sh，再重新执行日常发布。" >&2
  exit 1
fi

echo "[3/9] 安装发生变化的依赖"
if [[ ! -d node_modules ]] ||
   files_changed '^(package\.json|package-lock\.json)$'; then
  "$NPM_BIN" ci
else
  echo "根依赖锁未变化，跳过 npm ci。"
fi
if [[ ! -d apps/web-next/node_modules ]] ||
   files_changed '^apps/web-next/(package\.json|package-lock\.json)$'; then
  "$NPM_BIN" --prefix apps/web-next ci
else
  echo "Web 依赖锁未变化，跳过 npm ci。"
fi

echo "[4/9] 执行代码发布门禁"
gate_file="$PROJECT_DIR/logs/release-code-gate-$new_commit.json"
gate_reusable=false
if [[ -f "$gate_file" ]]; then
  GATE_FILE="$gate_file" EXPECTED_COMMIT="$new_commit" "$NODE_BIN" -e '
    const fs = require("fs");
    const report = JSON.parse(fs.readFileSync(process.env.GATE_FILE, "utf8"));
    if (report.status !== "passed" || report.gitCommit !== process.env.EXPECTED_COMMIT) {
      process.exit(1);
    }
  ' && gate_reusable=true
fi
if [[ "$gate_reusable" == true ]]; then
  echo "当前 commit 已通过完整代码门禁，复用现有证据。"
else
  "$NPM_BIN" run verify:release
  GATE_FILE="$gate_file" DEPLOY_COMMIT="$new_commit" "$NODE_BIN" -e '
    const fs = require("fs");
    fs.writeFileSync(process.env.GATE_FILE, JSON.stringify({
      schemaVersion: 1,
      status: "passed",
      gitCommit: process.env.DEPLOY_COMMIT,
      verifiedAt: new Date().toISOString()
    }, null, 2) + "\n");
  '
fi

echo "[5/9] 使用现有系统级 LaunchDaemon 重启"
if ! /bin/launchctl print system/com.pumpfactory.api >/dev/null 2>&1 ||
   ! /bin/launchctl print system/com.pumpfactory.web >/dev/null 2>&1; then
  echo "系统级服务尚未安装；首次安装请运行 sudo ./scripts/install-macmini-launchdaemons.sh。" >&2
  exit 1
fi
/bin/launchctl kickstart -k system/com.pumpfactory.api
/bin/launchctl kickstart -k system/com.pumpfactory.web
wait_for_daemon com.pumpfactory.api
wait_for_daemon com.pumpfactory.web

echo "[6/9] 验证本机 ready、Web 和启动备份"
wait_for_http "API ready" "http://127.0.0.1:3002/api/health/ready"
wait_for_http "Web 登录页" "http://127.0.0.1:3000/login"
validate_ready_commit "http://127.0.0.1:3002/api/health/ready" "$new_commit"
"$NPM_BIN" run db:backup:verify -- --latest --type startup

echo "[7/9] 执行真实 AI 发布门禁"
"$NPM_BIN" run verify:ai-release

echo "[8/9] 验证公网 ready、登录页和 AI 页面"
wait_for_http "公网 API ready" "$PUBLIC_BASE_URL/api/health/ready"
wait_for_http "公网登录页" "$PUBLIC_BASE_URL/login"
wait_for_http "公网 AI 页面" "$PUBLIC_BASE_URL/ai"
validate_ready_commit "$PUBLIC_BASE_URL/api/health/ready" "$new_commit"

echo "[9/9] 执行生产 MCP 全领域只读验收"
MCP_VERIFY_URL="$PUBLIC_BASE_URL/mcp" "$NPM_BIN" run verify:mcp-prod-read

elapsed=$(( $(/bin/date +%s) - STARTED_AT ))
echo "发布完成：commit ${new_commit[1,12]}，用时 ${elapsed} 秒。"
