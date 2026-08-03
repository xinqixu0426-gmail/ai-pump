const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    UPDATE_FACTORY_PROFILE_CAPABILITY_ID,
    executeFactoryProfileUpdate,
    hashPrompt,
} = require('../api/services/factoryProfileService.cjs');

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
        CREATE TABLE config (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            table_name TEXT,
            record_id TEXT,
            request_id TEXT,
            operation_id TEXT,
            capability_id TEXT,
            user TEXT
        );
        INSERT INTO config (key, value)
        VALUES ('ai-factory-profile', '原工厂习惯');
    `);
    const dependencies = {
        db,
        getConfig(key) {
            return db.prepare('SELECT value FROM config WHERE key = ?')
                .get(key)?.value || null;
        },
        setConfig(key, value, context) {
            db.prepare(`
                INSERT OR REPLACE INTO config (key, value)
                VALUES (?, ?)
            `).run(key, String(value));
            const audit = db.prepare(`
                INSERT INTO audit_log (
                    action, table_name, record_id, request_id,
                    operation_id, capability_id, user
                ) VALUES ('CONFIG_UPDATE', 'config', ?, ?, ?, ?, ?)
            `).run(
                key,
                context?.requestId || null,
                context?.operationId || null,
                context?.capabilityId || null,
                context?.user || null
            );
            return {
                key,
                value: String(value),
                auditId: Number(audit.lastInsertRowid),
            };
        },
    };
    return { db, dependencies };
}

function commandContext(suffix) {
    return {
        capabilityId: UPDATE_FACTORY_PROFILE_CAPABILITY_ID,
        actorKey: 'jwt:factory-profile-test',
        idempotencyKey: `factory-profile:command:${suffix}`,
        operationId: `factory-profile-operation-${suffix}`,
        requestId: `factory-profile-request-${suffix}`,
        warnings: [],
    };
}

test('工厂配置命令使用内容版本、持久幂等和强审计', () => {
    const fixture = createFixture();
    try {
        const input = {
            prompt: '本厂把 12-120 简称为 12 规格 120 片。',
            expectedVersion: hashPrompt('原工厂习惯'),
        };
        const context = commandContext('update');
        const result = executeFactoryProfileUpdate(
            fixture.dependencies,
            input,
            context
        );
        assert.equal(
            result.capabilityId,
            UPDATE_FACTORY_PROFILE_CAPABILITY_ID
        );
        assert.equal(result.profile.prompt, input.prompt);
        assert.equal(result.profile.version, hashPrompt(input.prompt));
        assert.equal(result.auditIds.length, 1);

        const replay = executeFactoryProfileUpdate(
            fixture.dependencies,
            input,
            context
        );
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM config').get()
                .count,
            1
        );
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()
                .count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('工厂配置命令拒绝过期版本且缺少版本只给兼容警告', () => {
    const staleFixture = createFixture();
    try {
        assert.throws(
            () => executeFactoryProfileUpdate(
                staleFixture.dependencies,
                { prompt: '新配置', expectedVersion: hashPrompt('错误旧值') },
                commandContext('stale')
            ),
            error => error?.code === 'resource_version_conflict'
        );
        assert.equal(
            staleFixture.db.prepare(
                "SELECT value FROM config WHERE key = 'ai-factory-profile'"
            ).get().value,
            '原工厂习惯'
        );
    } finally {
        staleFixture.db.close();
    }

    const compatibilityFixture = createFixture();
    try {
        const result = executeFactoryProfileUpdate(
            compatibilityFixture.dependencies,
            { prompt: '兼容配置' },
            commandContext('compatibility')
        );
        assert.ok(result.warnings.some(
            warning => warning.code === 'resource_version_missing_compatibility'
        ));
    } finally {
        compatibilityFixture.db.close();
    }
});

test('工厂配置缺少强审计时配置和 operation 一并回滚', () => {
    const fixture = createFixture();
    try {
        fixture.dependencies.setConfig = (key, value) => {
            fixture.db.prepare(`
                INSERT OR REPLACE INTO config (key, value)
                VALUES (?, ?)
            `).run(key, String(value));
            return { key, value: String(value), auditId: null };
        };
        assert.throws(
            () => executeFactoryProfileUpdate(
                fixture.dependencies,
                {
                    prompt: '不能留下的配置',
                    expectedVersion: hashPrompt('原工厂习惯'),
                },
                commandContext('audit-rollback')
            ),
            error => error?.code === 'strong_audit_required'
        );
        assert.equal(
            fixture.db.prepare(
                "SELECT value FROM config WHERE key = 'ai-factory-profile'"
            ).get().value,
            '原工厂习惯'
        );
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) AS count FROM api_operations'
            ).get().count,
            0
        );
    } finally {
        fixture.db.close();
    }
});
