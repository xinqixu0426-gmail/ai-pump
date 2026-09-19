#!/bin/zsh
# Install only the existing login compatibility process; never restart API/Web.
set -euo pipefail
BUNDLE=/Users/dan/pump-owner-auth-p16ir2
PROJECT=/Users/dan/pump-cost-accounting-system
LABEL=org.pump.owner-authentication
TARGET=/Library/LaunchDaemons/$LABEL.plist
AGENT=/Users/dan/Library/LaunchAgents/$LABEL.plist
BACKUP=$BUNDLE/daemon-migration-backup
SOURCE=${0:A:h}/../ops/owner-auth-daemon.plist
if [[ $EUID -ne 0 ]]; then
  echo "Run this installer with sudo; the service itself runs as dan."
  exit 1
fi
/usr/bin/plutil -lint "$SOURCE"
test -f "$BUNDLE/scripts/start-owner-authentication.cjs"
test -d "$PROJECT/node_modules/express"
/bin/mkdir -p "$BACKUP"
/bin/chmod 700 "$BACKUP"
start_previous() {
  /usr/bin/sudo -u dan /bin/sh -c 'cd /Users/dan/pump-owner-auth-p16ir2 && nohup env NODE_PATH=/Users/dan/pump-cost-accounting-system/node_modules /opt/homebrew/bin/node scripts/start-owner-authentication.cjs /Users/dan/pump-cost-accounting-system/.env >/dev/null 2>&1 </dev/null &'
}
if [[ ${1:-} == --rollback ]]; then
  /bin/launchctl bootout "system/$LABEL" 2>/dev/null || true
  if [[ -f "$TARGET" ]]; then /bin/mv "$TARGET" "$BACKUP/disabled-daemon.plist"; fi
  if [[ -f "$BACKUP/original-agent.plist" ]]; then
    /usr/bin/install -o dan -g staff -m 644 "$BACKUP/original-agent.plist" "$AGENT"
  fi
  start_previous
  echo "Restored original login process; API/Web unchanged."
  exit 0
fi
if [[ -e "$TARGET" ]] && ! /usr/bin/cmp -s "$SOURCE" "$TARGET"; then
  echo "Existing system service differs; refusing to replace it."
  exit 1
fi
# Refuse to stop an unrelated process that happens to occupy the port.
PIDS=(${(f)$(/usr/sbin/lsof -nP -t -iTCP:3104 -sTCP:LISTEN || true)})
for PID in $PIDS; do
  COMMAND=$(/bin/ps -p "$PID" -o command=)
  CWD=$(/usr/sbin/lsof -a -p "$PID" -d cwd -Fn | /usr/bin/tail -1)
  if [[ "$COMMAND" != *start-owner-authentication.cjs* || "$CWD" != n$BUNDLE ]]; then
    echo "Port 3104 is owned by an unexpected process; stopped."
    exit 1
  fi
done
if [[ -f "$AGENT" ]]; then
  if [[ ! -e "$BACKUP/original-agent.plist" ]]; then /bin/cp -p "$AGENT" "$BACKUP/original-agent.plist"; fi
  /bin/launchctl bootout gui/501/$LABEL 2>/dev/null || true
  /bin/launchctl bootout user/501/$LABEL 2>/dev/null || true
  /bin/mv "$AGENT" "$BACKUP/retired-agent.plist"
fi
/bin/launchctl bootout "system/$LABEL" 2>/dev/null || true
for PID in $PIDS; do /bin/kill -TERM "$PID" 2>/dev/null || true; done
/usr/bin/install -o root -g wheel -m 644 "$SOURCE" "$TARGET"
rollback_failure() {
  /bin/launchctl bootout "system/$LABEL" 2>/dev/null || true
  /bin/mv "$TARGET" "$BACKUP/failed-daemon.plist" 2>/dev/null || true
  if [[ -f "$BACKUP/original-agent.plist" ]]; then /usr/bin/install -o dan -g staff -m 644 "$BACKUP/original-agent.plist" "$AGENT"; fi
  start_previous
  echo "Daemon installation failed; original login process restored." >&2
}
if ! /bin/launchctl bootstrap system "$TARGET"; then rollback_failure; exit 1; fi
for i in {1..30}; do
  CODE=$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:3104/api/auth/check || true)
  if [[ "$CODE" == 200 || "$CODE" == 401 ]]; then
    echo "Login system service installed and reachable; runs as dan before GUI login."
    exit 0
  fi
  /bin/sleep 1
done
rollback_failure
exit 1
