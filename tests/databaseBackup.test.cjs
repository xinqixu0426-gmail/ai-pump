const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
    backupMetadataPath,
    createDatabaseBackup,
    listBackups,
    pruneBackupType,
    verifyBackupArtifact,
} = require('../api/services/databaseBackup.cjs');
const {
    RESTORE_CONFIRMATION,
    restoreDatabaseBackup,
} = require('../api/services/databaseRestore.cjs');
const { spawnSync } = require('node:child_process');

function temporaryDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pump-backup-test-'));
}

function createFixture(databasePath, value, version = 40) {
    const db = new Database(databasePath);
    db.exec(`
        CREATE TABLE schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );
        CREATE TABLE parts (
            id INTEGER PRIMARY KEY,
            model TEXT NOT NULL
        );
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY,
            created_at TEXT
        );
        INSERT INTO schema_migrations(version, name, checksum, applied_at)
        VALUES (${version}, 'fixture', 'fixture', '2026-08-01T00:00:00.000Z');
        INSERT INTO parts(id, model) VALUES (1, '${value}');
        PRAGMA user_version = ${version};
    `);
    return db;
}

test('数据库备份：写入分层目录、校验元数据并复制异机副本', async () => {
    const temp = temporaryDirectory();
    const root = path.join(temp, 'backups');
    const mirror = path.join(temp, 'mirror');
    const sourcePath = path.join(temp, 'source.db');
    const db = createFixture(sourcePath, 'V750');
    try {
        const result = await createDatabaseBackup(db, {
            type: 'release',
            root,
            mirrorRoot: mirror,
            gitCommit: 'abc123',
            sourcePath,
            now: new Date('2026-08-01T01:02:03.000Z'),
        });
        assert.equal(path.dirname(result.path), path.join(root, 'release'));
        assert.ok(fs.existsSync(result.path));
        assert.ok(fs.existsSync(result.metadataPath));
        assert.ok(fs.existsSync(result.mirrorPath));
        assert.equal(fs.existsSync(`${result.path}-wal`), false);
        assert.equal(fs.existsSync(`${result.path}-shm`), false);

        const verified = verifyBackupArtifact(result.path, {
            expectedGitCommit: 'abc123',
        });
        assert.equal(verified.schema.userVersion, 40);
        assert.equal(verified.tableCounts.parts, 1);
        assert.equal(verified.metadata.type, 'release');
        assert.equal(verified.metadata.verified, true);
        assert.match(verified.sha256, /^[a-f0-9]{64}$/);

        const mirrored = verifyBackupArtifact(result.mirrorPath, {
            expectedGitCommit: 'abc123',
        });
        assert.equal(mirrored.sha256, verified.sha256);
    } finally {
        db.close();
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test('数据库备份：异机目录异常不破坏已验证的本机备份', async () => {
    const temp = temporaryDirectory();
    const root = path.join(temp, 'backups');
    const sourcePath = path.join(temp, 'source.db');
    const db = createFixture(sourcePath, 'V750');
    try {
        const result = await createDatabaseBackup(db, {
            type: 'startup',
            root,
            mirrorRoot: root,
            sourcePath,
        });
        assert.ok(fs.existsSync(result.path));
        assert.match(result.mirrorError, /不能与本地备份目录相同/);
        assert.equal(verifyBackupArtifact(result.path).integrity, 'ok');
    } finally {
        db.close();
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test('数据库备份：启动备份不会挤掉每日备份且各自按策略保留', () => {
    const temp = temporaryDirectory();
    const root = path.join(temp, 'backups');
    try {
        for (const type of ['daily', 'startup']) {
            const directory = path.join(root, type);
            fs.mkdirSync(directory, { recursive: true });
            for (let index = 0; index < 35; index += 1) {
                const databasePath = path.join(directory, `${type}-${String(index).padStart(2, '0')}.db`);
                fs.writeFileSync(databasePath, 'fixture');
                fs.writeFileSync(backupMetadataPath(databasePath), JSON.stringify({
                    type,
                    createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString(),
                }));
            }
        }

        const removedStartup = pruneBackupType(root, 'startup');
        assert.equal(removedStartup.length, 30);
        assert.equal(listBackups(root, { type: 'startup' }).length, 5);
        assert.equal(listBackups(root, { type: 'daily' }).length, 35);

        const removedDaily = pruneBackupType(root, 'daily');
        assert.equal(removedDaily.length, 5);
        assert.equal(listBackups(root, { type: 'daily' }).length, 30);
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test('数据库备份：篡改文件或使用错误提交时拒绝验收', async () => {
    const temp = temporaryDirectory();
    const root = path.join(temp, 'backups');
    const sourcePath = path.join(temp, 'source.db');
    const db = createFixture(sourcePath, '原始');
    try {
        const result = await createDatabaseBackup(db, {
            type: 'release',
            root,
            gitCommit: 'expected',
        });
        assert.throws(
            () => verifyBackupArtifact(result.path, { expectedGitCommit: 'other' }),
            /与目标提交 other 不一致/
        );
        fs.appendFileSync(result.path, 'tampered');
        assert.throws(
            () => verifyBackupArtifact(result.path),
            /SHA-256|数据库|文件大小/
        );
    } finally {
        db.close();
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test('数据库恢复：先生成 safety 备份、移动 sidecar，再替换并复核目标库', async () => {
    const temp = temporaryDirectory();
    const root = path.join(temp, 'backups');
    const backupSourcePath = path.join(temp, 'old.db');
    const targetPath = path.join(temp, 'pump.db');
    const backupSource = createFixture(backupSourcePath, '旧版本');
    let releaseBackup;
    try {
        releaseBackup = await createDatabaseBackup(backupSource, {
            type: 'release',
            root,
            gitCommit: 'old-commit',
        });
    } finally {
        backupSource.close();
    }
    const current = createFixture(targetPath, '新版本');
    current.close();
    fs.writeFileSync(`${targetPath}-wal`, '');
    fs.writeFileSync(`${targetPath}-shm`, '');

    try {
        await assert.rejects(
            restoreDatabaseBackup({
                root,
                backupPath: releaseBackup.path,
                targetPath,
                confirmation: 'wrong',
                skipPortCheck: true,
            }),
            new RegExp(RESTORE_CONFIRMATION)
        );

        const restored = await restoreDatabaseBackup({
            root,
            backupPath: releaseBackup.path,
            targetPath,
            confirmation: RESTORE_CONFIRMATION,
            expectedGitCommit: 'old-commit',
            currentGitCommit: 'new-commit',
            skipPortCheck: true,
            now: new Date('2026-08-01T02:00:00.000Z'),
        });
        assert.ok(restored.safetyBackup);
        assert.ok(fs.existsSync(restored.safetyBackup));
        assert.equal(restored.movedSidecars.length, 2);
        assert.equal(fs.existsSync(`${targetPath}-wal`), false);
        assert.equal(fs.existsSync(`${targetPath}-shm`), false);

        const opened = new Database(targetPath, { readonly: true });
        try {
            assert.equal(opened.prepare('SELECT model FROM parts WHERE id = 1').get().model, '旧版本');
        } finally {
            opened.close();
        }

        const safety = verifyBackupArtifact(restored.safetyBackup, {
            expectedGitCommit: 'new-commit',
        });
        const safetyDb = new Database(safety.path, { readonly: true });
        try {
            assert.equal(safetyDb.prepare('SELECT model FROM parts WHERE id = 1').get().model, '新版本');
        } finally {
            safetyDb.close();
        }
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test('数据库备份 CLI：版本绑定参数缺少值时拒绝创建', () => {
    const result = spawnSync(
        process.execPath,
        ['scripts/manage-database-backups.cjs', 'create', '--type', 'release', '--git-commit'],
        {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8',
            env: { ...process.env, DB_BACKUP_MIRROR_DIR: '' },
        }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--git-commit 必须提供值/);
});
