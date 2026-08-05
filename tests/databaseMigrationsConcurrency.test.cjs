const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const { MIGRATIONS } = require('../api/database/migrations.cjs');

test('数据库迁移：并发启动只应用一次相同版本', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-migrations-'));
    const databasePath = path.join(tempDir, 'concurrent.db');
    const migrationsPath = path.resolve(__dirname, '../api/database/migrations.cjs');
    const workerScript = `
        const Database = require('better-sqlite3');
        const { runMigrations } = require(${JSON.stringify(migrationsPath)});
        const db = new Database(process.argv[1], { timeout: 10000 });
        try {
            runMigrations(db, { now: '2026-08-05T00:00:00.000Z' });
        } finally {
            db.close();
        }
    `;
    const runWorker = () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', workerScript, databasePath], {
            cwd: path.resolve(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', chunk => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('exit', code => {
            if (code === 0) resolve();
            else reject(new Error(stderr || `迁移进程退出码 ${code}`));
        });
    });

    try {
        await Promise.all(Array.from({ length: 4 }, runWorker));
        const db = new Database(databasePath, { readonly: true });
        try {
            const rows = db.prepare(`
                SELECT version, COUNT(*) AS count
                FROM schema_migrations
                GROUP BY version
                ORDER BY version
            `).all();
            assert.equal(rows.length, MIGRATIONS.length);
            assert.ok(rows.every(row => row.count === 1));
            assert.equal(rows.at(-1).version, MIGRATIONS.at(-1).version);
        } finally {
            db.close();
        }
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
