const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    UPDATE_CAPABILITY_ID,
    executeBusinessSettingUpdate,
    normalizeBusinessSettingValue,
} = require('../api/services/businessSettingCommands.cjs');

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
        CREATE TABLE system_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT
        );
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('management_fee', '5', '2026-08-03T04:00:00.000Z');
    `);
    let sequence = 0;
    function setSetting(key, value, context) {
        sequence += 1;
        const nextUpdatedAt = new Date(
            Date.UTC(2026, 7, 3, 4, 0, sequence)
        ).toISOString();
        db.prepare(`
            INSERT OR REPLACE INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
        `).run(key, String(value), nextUpdatedAt);
        const audit = db.prepare(`
            INSERT INTO audit_log (
                table_name, record_id, request_id,
                operation_id, capability_id, user
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            'system_settings',
            key,
            context?.requestId || null,
            context?.operationId || null,
            context?.capabilityId || null,
            context?.user || null
        );
        return {
            key,
            value: String(value),
            updatedAt: nextUpdatedAt,
            auditId: Number(audit.lastInsertRowid),
        };
    }
    return {
        db,
        dependencies: { db, setSetting },
    };
}

function commandContext(suffix) {
    return {
        capabilityId: UPDATE_CAPABILITY_ID,
        actorKey: 'jwt:business-setting-test',
        idempotencyKey: `business-setting:command:${suffix}`,
        operationId: `business-setting-operation-${suffix}`,
        requestId: `business-setting-request-${suffix}`,
        warnings: [],
    };
}

test('业务设置使用版本、持久幂等、operation 和强审计', () => {
    const fixture = createFixture();
    const input = {
        value: '6.5',
        expectedUpdatedAt: '2026-08-03T04:00:00.000Z',
    };
    const context = commandContext('management-fee');
    const result = executeBusinessSettingUpdate(
        fixture.dependencies,
        'management_fee',
        input,
        context
    );
    assert.equal(result.capabilityId, UPDATE_CAPABILITY_ID);
    assert.equal(result.setting.value, '6.5');
    assert.equal(result.auditIds.length, 1);
    assert.equal(
        fixture.db.prepare(`
            SELECT value FROM system_settings WHERE key = 'management_fee'
        `).get().value,
        '6.5'
    );

    const replay = executeBusinessSettingUpdate(
        fixture.dependencies,
        'management_fee',
        input,
        context
    );
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.setting.updatedAt, result.setting.updatedAt);
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()
            .count,
        1
    );
});

test('业务设置拒绝过期版本和非法成本基础值', () => {
    const fixture = createFixture();
    assert.throws(
        () => executeBusinessSettingUpdate(
            fixture.dependencies,
            'management_fee',
            {
                value: '7',
                expectedUpdatedAt: '2026-08-03T03:59:59.000Z',
            },
            commandContext('stale')
        ),
        error => error?.code === 'resource_version_conflict'
    );
    assert.throws(
        () => normalizeBusinessSettingValue(
            'cable_accessories',
            JSON.stringify({
                standard: { name: '', fee: 1 },
                xinjie: { name: '新界', fee: 2 },
            })
        ),
        error => error?.code === 'cable_accessories_name_required'
    );
    assert.throws(
        () => normalizeBusinessSettingValue('usd_cny_rate', -1),
        error => error?.code === 'business_setting_number_invalid'
    );
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations')
            .get().count,
        0
    );
});

test('业务设置缺少强审计时设置值和 operation 一并回滚', () => {
    const fixture = createFixture();
    fixture.dependencies.setSetting = (key, value) => {
        fixture.db.prepare(`
            UPDATE system_settings
            SET value = ?, updated_at = ?
            WHERE key = ?
        `).run(
            String(value),
            '2026-08-03T04:01:00.000Z',
            key
        );
        return {
            key,
            value: String(value),
            updatedAt: '2026-08-03T04:01:00.000Z',
            auditId: null,
        };
    };
    assert.throws(
        () => executeBusinessSettingUpdate(
            fixture.dependencies,
            'management_fee',
            {
                value: '8',
                expectedUpdatedAt: '2026-08-03T04:00:00.000Z',
            },
            commandContext('audit-rollback')
        ),
        error => error?.code === 'strong_audit_required'
    );
    assert.equal(
        fixture.db.prepare(`
            SELECT value FROM system_settings WHERE key = 'management_fee'
        `).get().value,
        '5'
    );
    assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations')
            .get().count,
        0
    );
});
