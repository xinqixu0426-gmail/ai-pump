const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');

const BACKUP_TYPES = new Set(['daily', 'startup', 'release', 'safety']);
const DEFAULT_RETENTION = Object.freeze({
    daily: { count: 30 },
    startup: { count: 5 },
    release: { count: 20 },
    safety: { count: 10 },
});
const CORE_COUNT_TABLES = Object.freeze([
    'parts',
    'recipes',
    'orders',
    'coils',
    'customers',
    'quotations',
    'factory_files',
    'knowledge_entries',
    'knowledge_embeddings',
    'api_operations',
    'audit_log',
    'business_change_events',
    'business_change_event_entities',
]);

function projectRoot() {
    return path.resolve(__dirname, '..', '..');
}

function defaultBackupRoot() {
    return path.resolve(process.env.DB_BACKUP_DIR || path.join(projectRoot(), 'backups'));
}

function normalizeBackupType(value) {
    const type = String(value || '').trim().toLowerCase();
    if (!BACKUP_TYPES.has(type)) {
        throw new Error(`不支持的备份类型 "${value}"`);
    }
    return type;
}

function resolveWithin(root, candidate, label = '路径') {
    const rootPath = path.resolve(root);
    const candidatePath = path.resolve(candidate);
    if (candidatePath !== rootPath && !candidatePath.startsWith(`${rootPath}${path.sep}`)) {
        throw new Error(`${label}必须位于 ${rootPath} 内`);
    }
    return candidatePath;
}

function backupTypeDirectory(root, type) {
    return path.join(path.resolve(root), normalizeBackupType(type));
}

function backupMetadataPath(databasePath) {
    return `${databasePath}.meta.json`;
}

function formatTimestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('备份时间无效');
    return date.toISOString().replace(/[:.]/g, '-');
}

function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    const handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let bytesRead = 0;
        do {
            bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
            if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
    } finally {
        fs.closeSync(handle);
    }
    return hash.digest('hex');
}

function tableExists(db, table) {
    return Boolean(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table));
}

function schemaState(db) {
    const userVersion = Number(db.pragma('user_version', { simple: true }) || 0);
    let migrationVersion = 0;
    let migrationCount = 0;
    if (tableExists(db, 'schema_migrations')) {
        const row = db.prepare(
            'SELECT COALESCE(MAX(version), 0) AS version, COUNT(*) AS count FROM schema_migrations'
        ).get();
        migrationVersion = Number(row?.version || 0);
        migrationCount = Number(row?.count || 0);
    }
    return { userVersion, migrationVersion, migrationCount };
}

function coreTableCounts(db) {
    const counts = {};
    for (const table of CORE_COUNT_TABLES) {
        if (!tableExists(db, table)) continue;
        counts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count);
    }
    return counts;
}

function cleanupDatabaseSidecars(databasePath, preserve = new Set()) {
    for (const suffix of ['-wal', '-shm']) {
        const sidecarPath = `${databasePath}${suffix}`;
        if (preserve.has(sidecarPath)) continue;
        if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);
    }
}

function verifyDatabaseFile(databasePath, options = {}) {
    const resolved = path.resolve(databasePath);
    if (!fs.existsSync(resolved)) throw new Error(`数据库文件不存在: ${resolved}`);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size === 0) throw new Error(`数据库文件无效: ${resolved}`);
    const existingSidecars = new Set(
        ['-wal', '-shm']
            .map(suffix => `${resolved}${suffix}`)
            .filter(sidecarPath => fs.existsSync(sidecarPath))
    );

    let db;
    try {
        db = new Database(resolved, { readonly: true, fileMustExist: true });
        const integrity = db.pragma('integrity_check', { simple: true });
        const foreignKeyRows = db.pragma('foreign_key_check');
        if (integrity !== 'ok') throw new Error(`数据库完整性异常: ${integrity}`);
        if (foreignKeyRows.length > 0) {
            throw new Error(`数据库存在 ${foreignKeyRows.length} 条外键异常`);
        }
        return {
            path: resolved,
            bytes: stat.size,
            integrity,
            foreignKeyViolations: foreignKeyRows.length,
            schema: schemaState(db),
            tableCounts: coreTableCounts(db),
        };
    } finally {
        if (db?.open) db.close();
        if (options.cleanupSidecars) cleanupDatabaseSidecars(resolved, existingSidecars);
    }
}

function currentGitCommit(options = {}) {
    const explicit = String(options.gitCommit || '').trim();
    if (explicit) return explicit;
    const environmentCommit = String(
        process.env.RELEASE_COMMIT || process.env.GIT_COMMIT || ''
    ).trim();
    if (environmentCommit) return environmentCommit;
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: options.cwd || projectRoot(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 3000,
        }).trim();
    } catch {
        return '';
    }
}

function readBackupMetadata(databasePath, options = {}) {
    const metadataPath = options.metadataPath || backupMetadataPath(databasePath);
    if (!fs.existsSync(metadataPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    } catch (error) {
        throw new Error(`备份元数据无效: ${error.message}`);
    }
}

function writeJsonAtomic(targetPath, value) {
    const temporaryPath = `${targetPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, targetPath);
}

function compareTableCounts(expected = {}, actual = {}) {
    const differences = [];
    for (const [table, count] of Object.entries(expected)) {
        if (Number(actual[table]) !== Number(count)) {
            differences.push(`${table}: 预期 ${count}，实际 ${actual[table] ?? '不存在'}`);
        }
    }
    return differences;
}

function verifyBackupArtifact(databasePath, options = {}) {
    const verification = verifyDatabaseFile(databasePath, { cleanupSidecars: true });
    const metadata = readBackupMetadata(databasePath, options);
    if (options.requireMetadata !== false && !metadata) {
        throw new Error(`备份缺少元数据: ${backupMetadataPath(databasePath)}`);
    }
    if (!metadata) return { ...verification, metadata: null };

    const checksum = sha256File(databasePath);
    if (metadata.sha256 !== checksum) throw new Error('备份 SHA-256 与元数据不一致');
    if (Number(metadata.bytes) !== verification.bytes) throw new Error('备份文件大小与元数据不一致');
    if (
        Number(metadata.schema?.userVersion || 0) !== verification.schema.userVersion
        || Number(metadata.schema?.migrationVersion || 0) !== verification.schema.migrationVersion
    ) {
        throw new Error('备份 Schema 版本与元数据不一致');
    }
    const countDifferences = compareTableCounts(metadata.tableCounts, verification.tableCounts);
    if (countDifferences.length > 0) {
        throw new Error(`备份表计数与元数据不一致: ${countDifferences.join('; ')}`);
    }
    const expectedCommit = String(options.expectedGitCommit || '').trim();
    if (expectedCommit && metadata.gitCommit !== expectedCommit) {
        throw new Error(
            `备份绑定提交 ${metadata.gitCommit || '未记录'}，与目标提交 ${expectedCommit} 不一致`
        );
    }
    return { ...verification, metadata, sha256: checksum };
}

function backupCreatedAt(databasePath) {
    const metadata = readBackupMetadata(databasePath);
    const parsed = metadata?.createdAt ? new Date(metadata.createdAt) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
    return fs.statSync(databasePath).mtime;
}

function listBackups(root = defaultBackupRoot(), options = {}) {
    const types = options.type ? [normalizeBackupType(options.type)] : [...BACKUP_TYPES];
    const rows = [];
    for (const type of types) {
        const directory = backupTypeDirectory(root, type);
        if (!fs.existsSync(directory)) continue;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.db')) continue;
            const databasePath = path.join(directory, entry.name);
            const metadata = readBackupMetadata(databasePath);
            rows.push({
                type,
                path: databasePath,
                metadataPath: backupMetadataPath(databasePath),
                createdAt: (metadata?.createdAt || fs.statSync(databasePath).mtime.toISOString()),
                bytes: fs.statSync(databasePath).size,
                gitCommit: metadata?.gitCommit || '',
                schemaVersion: Number(metadata?.schema?.migrationVersion || 0),
                verified: Boolean(metadata?.verified),
            });
        }
    }
    return rows.sort((left, right) => (
        right.createdAt.localeCompare(left.createdAt) || right.path.localeCompare(left.path)
    ));
}

function removeBackupArtifact(databasePath) {
    fs.unlinkSync(databasePath);
    const metadataPath = backupMetadataPath(databasePath);
    if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath);
}

function pruneBackupType(root, type, options = {}) {
    const normalizedType = normalizeBackupType(type);
    const policy = options.policy || DEFAULT_RETENTION[normalizedType];
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const backups = listBackups(root, { type: normalizedType });
    const removed = [];

    if (Number.isInteger(policy.count)) {
        for (const backup of backups.slice(Math.max(0, policy.count))) {
            removeBackupArtifact(backup.path);
            removed.push(backup.path);
        }
        return removed;
    }

    const days = Number(policy.days);
    const minCount = Math.max(0, Number(policy.minCount || 0));
    const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
    backups.forEach((backup, index) => {
        if (index < minCount || backupCreatedAt(backup.path).getTime() >= cutoff) return;
        removeBackupArtifact(backup.path);
        removed.push(backup.path);
    });
    return removed;
}

function mirrorBackupArtifact(databasePath, metadata, mirrorRoot, localRoot = defaultBackupRoot()) {
    if (!mirrorRoot) return null;
    const sourceRoot = path.resolve(localRoot);
    const resolvedMirrorRoot = path.resolve(mirrorRoot);
    if (resolvedMirrorRoot === sourceRoot) throw new Error('异机备份目录不能与本地备份目录相同');
    const type = normalizeBackupType(metadata.type);
    const targetDirectory = backupTypeDirectory(resolvedMirrorRoot, type);
    fs.mkdirSync(targetDirectory, { recursive: true });
    const targetPath = path.join(targetDirectory, path.basename(databasePath));
    fs.copyFileSync(databasePath, targetPath);
    writeJsonAtomic(backupMetadataPath(targetPath), {
        ...metadata,
        mirroredAt: new Date().toISOString(),
        mirroredFrom: databasePath,
    });
    verifyBackupArtifact(targetPath);
    pruneBackupType(resolvedMirrorRoot, type);
    return targetPath;
}

async function createDatabaseBackup(db, options = {}) {
    if (!db?.open) throw new Error('备份需要已打开的 SQLite 数据库连接');
    const type = normalizeBackupType(options.type || 'release');
    const root = path.resolve(options.root || defaultBackupRoot());
    const directory = backupTypeDirectory(root, type);
    const createdAt = options.now instanceof Date
        ? options.now
        : new Date(options.now || Date.now());
    const filename = `pump-${type}-${formatTimestamp(createdAt)}.db`;
    const finalPath = path.join(directory, filename);
    const partialPath = `${finalPath}.${process.pid}.partial`;
    fs.mkdirSync(directory, { recursive: true });

    try {
        await db.backup(partialPath);
        const verification = verifyDatabaseFile(partialPath, { cleanupSidecars: true });
        const sourceSchema = schemaState(db);
        if (
            sourceSchema.userVersion !== verification.schema.userVersion
            || sourceSchema.migrationVersion !== verification.schema.migrationVersion
        ) {
            throw new Error('备份与源数据库的 Schema 版本不一致');
        }

        const checksum = sha256File(partialPath);
        fs.renameSync(partialPath, finalPath);
        const metadata = {
            formatVersion: 1,
            type,
            createdAt: createdAt.toISOString(),
            sourcePath: options.sourcePath || '',
            gitCommit: currentGitCommit({ gitCommit: options.gitCommit, cwd: options.cwd }),
            schema: verification.schema,
            tableCounts: verification.tableCounts,
            bytes: verification.bytes,
            sha256: checksum,
            integrity: verification.integrity,
            foreignKeyViolations: verification.foreignKeyViolations,
            verified: true,
        };
        writeJsonAtomic(backupMetadataPath(finalPath), metadata);
        verifyBackupArtifact(finalPath);
        const removed = options.prune === false ? [] : pruneBackupType(root, type, {
            now: createdAt,
            policy: options.retentionPolicy,
        });
        let mirrorPath = null;
        let mirrorError = null;
        try {
            mirrorPath = mirrorBackupArtifact(
                finalPath,
                metadata,
                options.mirrorRoot ?? process.env.DB_BACKUP_MIRROR_DIR,
                root
            );
        } catch (error) {
            // 本机备份已经完成并验证。异机设备短时离线应告警，但不能让 API 永久未就绪。
            mirrorError = error.message;
        }
        return {
            path: finalPath,
            metadataPath: backupMetadataPath(finalPath),
            metadata,
            removed,
            mirrorPath,
            mirrorError,
        };
    } catch (error) {
        if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
        throw error;
    }
}

module.exports = {
    BACKUP_TYPES,
    CORE_COUNT_TABLES,
    DEFAULT_RETENTION,
    backupMetadataPath,
    backupTypeDirectory,
    cleanupDatabaseSidecars,
    coreTableCounts,
    createDatabaseBackup,
    currentGitCommit,
    defaultBackupRoot,
    listBackups,
    normalizeBackupType,
    pruneBackupType,
    readBackupMetadata,
    resolveWithin,
    schemaState,
    sha256File,
    verifyBackupArtifact,
    verifyDatabaseFile,
};
