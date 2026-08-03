const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    UPDATE_RUNTIME_CAPABILITY_ID,
    executeRuntimeSettingsUpdate,
} = require('../api/services/runtimeSettingCommands.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE api_operations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_id TEXT NOT NULL,
            capability_id TEXT NOT NULL,
            actor_key TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            request_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            response_json TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            expires_at TEXT NOT NULL,
            UNIQUE(actor_key, capability_id, idempotency_key)
        );
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT,
            record_id TEXT,
            request_id TEXT,
            operation_id TEXT,
            capability_id TEXT,
            user TEXT
        );
        CREATE TABLE runtime_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT NOT NULL UNIQUE,
            setting_value TEXT NOT NULL,
            is_secret INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        INSERT INTO runtime_settings (
            setting_key, setting_value, is_secret, created_at, updated_at
        ) VALUES (
            'deepseekModel', 'deepseek-old', 0,
            '2026-08-03T06:00:00.000Z', '2026-08-03T06:00:00.000Z'
        );
    `);
    let sequence = 0;
    function audit(table, id, context) {
        return Number(db.prepare(`
            INSERT INTO audit_log (
                table_name, record_id, request_id,
                operation_id, capability_id, user
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            table,
            String(id),
            context?.requestId || null,
            context?.operationId || null,
            context?.capabilityId || null,
            context?.user || null
        ).lastInsertRowid);
    }
    const dbAccessors = {
        db,
        safeInsert(table, values, context) {
            assert.equal(table, 'runtime_settings');
            sequence += 1;
            const info = db.prepare(`
                INSERT INTO runtime_settings (
                    setting_key, setting_value, is_secret,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
            `).run(
                values.setting_key,
                values.setting_value,
                values.is_secret,
                values.created_at,
                `2026-08-03T06:00:0${sequence}.000Z`
            );
            return {
                ...info,
                auditId: audit(
                    table,
                    Number(info.lastInsertRowid),
                    context
                ),
            };
        },
        safeUpdate(table, id, values, context) {
            assert.equal(table, 'runtime_settings');
            sequence += 1;
            const info = db.prepare(`
                UPDATE runtime_settings
                SET setting_value = ?, is_secret = ?, updated_at = ?
                WHERE id = ?
            `).run(
                values.setting_value,
                values.is_secret,
                `2026-08-03T06:00:0${sequence}.000Z`,
                id
            );
            return {
                ...info,
                auditId: audit(table, id, context),
            };
        },
    };
    const env = {
        NODE_ENV: 'test',
        JWT_SECRET: 'runtime-command-test-secret',
        DEEPSEEK_API_KEY: 'environment-deepseek-key',
    };
    return { db, dbAccessors, env };
}

function context(suffix) {
    return {
        capabilityId: UPDATE_RUNTIME_CAPABILITY_ID,
        actorKey: 'jwt:runtime-setting-test',
        idempotencyKey: `runtime-setting:test:${suffix}`,
        operationId: `runtime-setting-operation-${suffix}`,
        requestId: `runtime-setting-request-${suffix}`,
        warnings: [],
    };
}

test('运行配置命令原子保存密文、强审计和回执后更新进程环境', () => {
    const fixture = createFixture();
    const input = {
        deepseekModel: 'deepseek-v4-flash',
        deepseekApiKey: 'sk-runtime-command-secret',
        expectedUpdatedAt: '2026-08-03T06:00:00.000Z',
    };
    const commandContext = context('save');
    const result = executeRuntimeSettingsUpdate(
        fixture,
        input,
        commandContext
    );
    assert.equal(result.capabilityId, UPDATE_RUNTIME_CAPABILITY_ID);
    assert.deepEqual(
        result.changed.sort(),
        ['deepseekApiKey', 'deepseekModel']
    );
    assert.equal(result.auditIds.length, 2);
    assert.equal(
        JSON.stringify(result).includes('sk-runtime-command-secret'),
        false
    );
    assert.equal(
        fixture.db.prepare(`
            SELECT setting_value FROM runtime_settings
            WHERE setting_key = 'deepseekApiKey'
        `).get().setting_value.includes('sk-runtime-command-secret'),
        false
    );
    assert.equal(
        fixture.env.DEEPSEEK_API_KEY,
        'sk-runtime-command-secret'
    );

    const replay = executeRuntimeSettingsUpdate(
        fixture,
        input,
        commandContext
    );
    assert.equal(replay.idempotentReplay, true);
    assert.equal(
        fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM audit_log'
        ).get().count,
        2
    );
});

test('运行配置命令拒绝过期整体版本且不写 operation', () => {
    const fixture = createFixture();
    assert.throws(
        () => executeRuntimeSettingsUpdate(
            fixture,
            {
                deepseekModel: 'deepseek-v4-flash',
                expectedUpdatedAt: '2026-08-03T05:59:59.000Z',
            },
            context('version')
        ),
        error => error?.code === 'resource_version_conflict'
    );
    assert.equal(
        fixture.db.prepare(`
            SELECT setting_value FROM runtime_settings
            WHERE setting_key = 'deepseekModel'
        `).get().setting_value,
        'deepseek-old'
    );
    assert.equal(
        fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM api_operations'
        ).get().count,
        0
    );
});

test('运行配置强审计缺失时数据库、operation 和进程环境均不改变', () => {
    const fixture = createFixture();
    fixture.dbAccessors.safeUpdate = (
        table,
        id,
        values
    ) => {
        fixture.db.prepare(`
            UPDATE runtime_settings
            SET setting_value = ?, is_secret = ?, updated_at = ?
            WHERE id = ?
        `).run(
            values.setting_value,
            values.is_secret,
            '2026-08-03T06:01:00.000Z',
            id
        );
        return { changes: 1, auditId: null };
    };
    assert.throws(
        () => executeRuntimeSettingsUpdate(
            fixture,
            {
                deepseekModel: 'deepseek-v4-flash',
                expectedUpdatedAt: '2026-08-03T06:00:00.000Z',
            },
            context('audit')
        ),
        error => error?.code === 'strong_audit_required'
    );
    assert.equal(
        fixture.db.prepare(`
            SELECT setting_value FROM runtime_settings
            WHERE setting_key = 'deepseekModel'
        `).get().setting_value,
        'deepseek-old'
    );
    assert.equal(fixture.env.DEEPSEEK_MODEL, undefined);
    assert.equal(
        fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM api_operations'
        ).get().count,
        0
    );
});
