const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
    createDatabaseBackup,
    defaultBackupRoot,
    resolveWithin,
    verifyBackupArtifact,
    verifyDatabaseFile,
} = require('./databaseBackup.cjs');

const RESTORE_CONFIRMATION = 'RESTORE_PUMP_DB';

function portIsOpen(port, host = '127.0.0.1', timeoutMs = 500) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ port, host });
        const finish = (value) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(value);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
    });
}

function moveSidecars(targetPath, safetyDirectory, stamp) {
    const moved = [];
    for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${targetPath}${suffix}`;
        if (!fs.existsSync(sidecar)) continue;
        const destination = path.join(
            safetyDirectory,
            `${path.basename(targetPath)}.${stamp}${suffix}`
        );
        fs.renameSync(sidecar, destination);
        moved.push({ from: sidecar, to: destination });
    }
    return moved;
}

async function restoreDatabaseBackup(options = {}) {
    if (options.confirmation !== RESTORE_CONFIRMATION) {
        throw new Error(`恢复必须提供确认字符串 ${RESTORE_CONFIRMATION}`);
    }
    const root = path.resolve(options.root || defaultBackupRoot());
    const sourcePath = resolveWithin(root, options.backupPath, '恢复源');
    const targetPath = path.resolve(options.targetPath || path.join(root, '..', 'pump.db'));
    const sourceVerification = verifyBackupArtifact(sourcePath, {
        expectedGitCommit: options.expectedGitCommit,
    });
    const port = Number(options.port || process.env.PORT || 3002);
    if (!options.skipPortCheck && await portIsOpen(port)) {
        throw new Error(`检测到 API 端口 ${port} 正在监听，请先停止 API/Web 服务再恢复数据库`);
    }

    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    let safetyBackup = null;
    if (fs.existsSync(targetPath)) {
        const current = new Database(targetPath, { readonly: true, fileMustExist: true });
        try {
            safetyBackup = await createDatabaseBackup(current, {
                type: 'safety',
                root,
                now,
                sourcePath: targetPath,
                gitCommit: options.currentGitCommit,
            });
        } finally {
            current.close();
        }
    }

    const safetyDirectory = path.join(root, 'safety');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.mkdirSync(safetyDirectory, { recursive: true });
    const stagedPath = `${targetPath}.restore-${process.pid}.tmp`;
    const previousPath = `${targetPath}.bak.restore-${stamp}`;
    fs.copyFileSync(sourcePath, stagedPath);
    verifyDatabaseFile(stagedPath, { cleanupSidecars: true });

    let previousMoved = false;
    let sidecars = [];
    try {
        sidecars = moveSidecars(targetPath, safetyDirectory, stamp);
        if (fs.existsSync(targetPath)) {
            fs.renameSync(targetPath, previousPath);
            previousMoved = true;
        }
        fs.renameSync(stagedPath, targetPath);
        const restored = verifyDatabaseFile(targetPath, { cleanupSidecars: true });
        if (previousMoved && fs.existsSync(previousPath)) {
            const rawSafetyPath = path.join(
                safetyDirectory,
                `${path.basename(targetPath)}.${stamp}.raw.db`
            );
            fs.renameSync(previousPath, rawSafetyPath);
        }
        return {
            restored,
            source: sourceVerification,
            safetyBackup: safetyBackup?.path || null,
            movedSidecars: sidecars,
        };
    } catch (error) {
        if (fs.existsSync(targetPath)) {
            fs.renameSync(targetPath, `${targetPath}.failed-${stamp}`);
        }
        if (previousMoved && fs.existsSync(previousPath)) fs.renameSync(previousPath, targetPath);
        throw error;
    } finally {
        if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
    }
}

module.exports = {
    RESTORE_CONFIRMATION,
    portIsOpen,
    restoreDatabaseBackup,
};
