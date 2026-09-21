# 数据库备份、恢复与联合回滚

本文是生产数据库恢复的权威操作说明。运行数据库为项目根目录
`pump.db`，不得直接复制正在运行的主文件。

## 1. 备份分层

所有新备份保存在 `backups/<type>/`，每个 `.db` 旁边都有
`.db.meta.json`：

| 类型 | 用途 | 默认保留 |
|---|---|---:|
| `daily` | 每天 03:00 BJT 自动备份 | 30 份 |
| `startup` | API 启动时的快速保护 | 5 份 |
| `release` | 发布前与 Git commit 绑定的快照 | 20 份 |
| `safety` | 正式恢复前自动保存当前数据库 | 10 份 |

备份先写入 `.partial` 文件。只有以下检查全部通过后才改为正式文件并
生成元数据：

- SQLite `integrity_check=ok`；
- `foreign_key_check` 无违规；
- Schema 版本与源数据库一致；
- 记录恢复核对所需的核心表记录数；
- 记录文件大小和 SHA-256；
- 记录 Git commit、`user_version` 和最高迁移版本。

旧版散落数据库已于 2026-09-08 移至 `backups/legacy/`，内容不变；该目录不参与新保留策略。配置旧副本保存在 `backups/config/legacy/`，不得当作运行配置加载。

生产额外保留 `/Users/dan/pump-rollback-v1/v1.0.1` 与 `v1.0.2` 两套数据库、提交标识和 Web 构建；恢复仍须执行本页的备份核验、停服与联合回滚流程，不能直接覆盖正在运行的库。2026-09-08 当前数据库备份另有 Windows 副本，位于 `C:\Users\Dan\Documents\pump-v1-release-archive\2026-09-08/current-database-backup.tar.gz`；这是本次人工副本，不等于已配置持续异机镜像。

## 2. 异机副本

在 Mac Mini 的 `.env` 配置另一个挂载点或备份设备目录：

```bash
DB_BACKUP_MIRROR_DIR=/Volumes/PumpBackup/pump-db
```

系统只复制已经完成并验证的 `.db` 和元数据；镜像复制后会再次验证。
不要把该变量指回项目内的 `backups/`。未配置时，本机备份仍正常运行，
但不能抵御 Mac Mini 磁盘损坏。异机设备短时离线时会记录告警，本机已验证
备份仍算成功且不会阻断 API 就绪；恢复异机设备后需核对下一次备份日志。

## 3. 发布前快照

必须在拉取新代码前记录当前提交并生成发布快照：

```bash
cd /Users/dan/pump-cost-accounting-system
export PATH=/opt/homebrew/bin:$PATH

PREVIOUS_COMMIT=$(git rev-parse HEAD)
npm run db:backup:release -- --git-commit "$PREVIOUS_COMMIT"
npm run db:backup:verify -- --latest --type release \
  --expect-commit "$PREVIOUS_COMMIT"
```

确认输出包含备份路径、完整 commit、Schema 版本和 SHA-256 后，才允许
执行 `git pull`、依赖安装和数据库迁移。

首次发布本备份功能时，旧提交还没有 `db:backup:release` 命令。该次
部署先记录 `PREVIOUS_COMMIT`，拉取新代码但不要重启服务，然后立即用
新脚本生成绑定 `PREVIOUS_COMMIT` 的快照；快照验证通过后才能安装依赖
和重启。旧 API 仍在运行时，`better-sqlite3 backup()` 会生成一致副本。

## 4. 查询与验证真实备份

```bash
npm run db:backup:list
npm run db:backup:list -- --type daily
npm run db:backup:verify -- --latest --type daily
npm run db:backup:verify -- --file backups/release/<file>.db
```

`knowledge:backup-check` 用于验证当前数据库新建临时副本后的知识向量。
它不能替代这里对 `backups/` 真实落盘文件的验证。

## 5. 单独恢复数据库

恢复前必须停止 API 和 Web。恢复命令会：

1. 验证源备份、元数据、SHA-256、完整性和外键；
2. 检查 API 端口未监听；
3. 在 `backups/safety/` 在线备份当前数据库；
4. 把旧 WAL/SHM 移入 safety 目录；
5. 替换主数据库并再次验证。

```bash
sudo launchctl bootout system/com.pumpfactory.api
sudo launchctl bootout system/com.pumpfactory.web

npm run db:restore -- \
  --file backups/release/<file>.db \
  --confirm RESTORE_PUMP_DB
```

恢复失败时不得手工删除 `safety` 目录或 `.failed-*` 文件。先根据命令
输出确认原数据库和 safety 快照位置。

## 6. 代码与数据库联合回滚

数据库迁移后禁止只切换旧 Git 提交。旧代码会拒绝打开比自身更高版本
的数据库。联合回滚必须使用绑定目标 commit 的 `release` 备份：

```bash
sudo /bin/zsh ./scripts/rollback-macmini-release.sh \
  <target-tag-or-commit> \
  backups/release/<matching-file>.db
```

脚本依次执行：

1. 拒绝存在未提交已跟踪改动的工作区；
2. 解析目标 commit，并验证备份元数据与其完全一致；
3. 停止两个 LaunchDaemon，确认 API 端口释放；
4. 生成当前数据库 safety 备份并恢复目标数据库；
5. 切换到目标 commit，重新安装锁定依赖并执行其发布门禁；
6. 重新安装 LaunchDaemon并检查 API、Web。

任一步失败都会停止，不会继续启动版本错配的服务。恢复结果写入
`logs/rollback-*.json`，其中包含可用于人工恢复的 safety 备份路径。
回滚后仓库处于 detached HEAD；确认稳定后再由维护者决定是否移动
`master`，不要在生产机直接强推分支。

## 7. 定期恢复演练

至少每月在临时目录执行一次：

- 验证最新 `daily` 和最新 `release` 备份；
- 从真实备份恢复到临时数据库；
- 核对完整性、外键、Schema 和核心表数量；
- 核对 release 备份与目标 Git commit 一致；
- 记录演练日期和结果。

不得为了演练替换正在使用的 `pump.db`。
