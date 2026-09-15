const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('直接 node --test 导入数据库时，遗漏 NODE_ENV 也只能打开隔离库', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-db-isolation-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, ['-e', `
        const deps = require('./api/db.cjs');
        const file = deps.db.pragma('database_list').find(row => row.name === 'main').file;
        console.log(file);
        if (!file.startsWith(require('fs').realpathSync(process.env.ISOLATION_EXPECTED_DIR) + require('path').sep)) process.exitCode = 1;
        deps.stopBackupScheduler(); deps.db.close();
    `], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'development', NODE_TEST_CONTEXT: 'child-v8', PUMP_TEST_DATABASE_PATH: path.join(dir, 'pump-{pid}.db'), ISOLATION_EXPECTED_DIR: dir },
        encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(fs.readdirSync(dir).some(name => /^pump-\d+\.db$/.test(name)));
});
