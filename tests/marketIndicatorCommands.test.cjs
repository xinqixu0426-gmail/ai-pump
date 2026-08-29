const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    COPPER_SYNC_CAPABILITY_ID,
    INDICATOR_SYNC_CAPABILITY_ID,
    assertMarketSyncRequestBody,
    executeCopperPriceSync,
    executeMarketIndicatorsSync,
} = require('../api/services/marketIndicatorCommands.cjs');
const {
    MARKET_SOURCES,
    fetchMarketSnapshot,
} = require('../api/services/marketData.cjs');
const {
    bjtDateKey,
    systemCommandContext,
} = require('../api/services/marketSync.cjs');

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
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY,
            pricing_mode TEXT NOT NULL DEFAULT 'calculated',
            kit_price REAL NOT NULL DEFAULT 0,
            unit_price REAL,
            sheets REAL,
            wire_weight REAL,
            copper_base REAL,
            coil_fee REAL,
            rotor_fee REAL,
            cost REAL,
            updated_at TEXT
        );
        CREATE TABLE system_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT
        );
        INSERT INTO coils (
            id, pricing_mode, kit_price, unit_price, sheets, wire_weight,
            copper_base, coil_fee, rotor_fee, cost, updated_at
        ) VALUES
            (1, 'calculated', 0, 0.21, 120, 0.559, 100,
                8, 5, 90, '2026-08-03T05:00:00.000Z'),
            (2, 'kit', 66.5, 0, 140, 0, 0,
                0, 0, 66.5, '2026-08-03T05:00:00.000Z');
        INSERT INTO system_settings (key, value, updated_at) VALUES
            ('aluminum_wire_price_per_kg', '20.00', '2026-08-03T05:00:00.000Z'),
            ('usd_cny_rate', '7.1000', '2026-08-03T05:00:00.000Z');
    `);

    function audit(table, recordId, context) {
        return Number(db.prepare(`
            INSERT INTO audit_log (
                table_name, record_id, request_id,
                operation_id, capability_id, user
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            table,
            String(recordId),
            context?.requestId || null,
            context?.operationId || null,
            context?.capabilityId || null,
            context?.user || null
        ).lastInsertRowid);
    }

    function safeUpdate(table, id, values, context) {
        assert.equal(table, 'coils');
        const info = db.prepare(`
            UPDATE coils
            SET copper_base = ?, cost = ?, updated_at = ?
            WHERE id = ?
        `).run(
            values.copper_base,
            values.cost,
            '2026-08-03T05:01:00.000Z',
            id
        );
        return {
            ...info,
            auditId: audit(table, id, context),
        };
    }

    function setSetting(key, value, context) {
        const updatedAt = '2026-08-03T05:02:00.000Z';
        db.prepare(`
            INSERT OR REPLACE INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
        `).run(key, String(value), updatedAt);
        return {
            key,
            value: String(value),
            updatedAt,
            auditId: audit('system_settings', key, context),
        };
    }

    return {
        db,
        dependencies: {
            db,
            safeUpdate,
            setSetting,
        },
    };
}

function commandContext(capabilityId, suffix) {
    return {
        capabilityId,
        actorKey: 'jwt:market-sync-test',
        idempotencyKey: `market-sync:test:${suffix}`,
        operationId: `market-sync-operation-${suffix}`,
        requestId: `market-sync-request-${suffix}`,
        warnings: [],
    };
}

function marketSnapshot(overrides = {}) {
    return {
        copperPricePerTon: 105270,
        aluminumPricePerTon: 22120,
        usdCnyRate: 7.2345,
        exchangeRateSourceDate: '2026-08-03',
        fetchedAt: '2026-08-03T05:00:00.000Z',
        sources: MARKET_SOURCES,
        ...overrides,
    };
}

test('市场指标同步原子提交线圈、设置、operation 和强审计', () => {
    const fixture = createFixture();
    const context = commandContext(
        INDICATOR_SYNC_CAPABILITY_ID,
        'all'
    );
    const result = executeMarketIndicatorsSync(
        fixture.dependencies,
        marketSnapshot(),
        { trigger: 'manual' },
        context
    );
    assert.equal(result.capabilityId, INDICATOR_SYNC_CAPABILITY_ID);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.aluminumPricePerKg, '22.12');
    assert.equal(result.usdCnyRate, '7.2345');
    assert.equal(result.auditIds.length, 3);
    assert.equal(result.changes.length, 3);
    assert.deepEqual(
        fixture.db.prepare('SELECT copper_base, cost FROM coils WHERE id = 2').get(),
        { copper_base: 0, cost: 66.5 }
    );
    assert.equal(
        fixture.db.prepare(`
            SELECT value FROM system_settings
            WHERE key = 'usd_cny_rate'
        `).get().value,
        '7.2345'
    );
    assert.equal(
        fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM api_operations'
        ).get().count,
        1
    );

    const replay = executeMarketIndicatorsSync(
        fixture.dependencies,
        marketSnapshot({
            copperPricePerTon: 110000,
            aluminumPricePerTon: 23000,
        }),
        { trigger: 'manual' },
        context
    );
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.copperPricePerTon, 105270);
    assert.equal(
        fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM audit_log'
        ).get().count,
        3
    );
});

test('市场指标同步任一步缺少强审计时整体回滚', () => {
    const fixture = createFixture();
    const originalSetSetting = fixture.dependencies.setSetting;
    fixture.dependencies.setSetting = (key, value, context) => {
        const result = originalSetSetting(key, value, context);
        if (key === 'usd_cny_rate') result.auditId = null;
        return result;
    };
    assert.throws(
        () => executeMarketIndicatorsSync(
            fixture.dependencies,
            marketSnapshot(),
            { trigger: 'manual' },
            commandContext(
                INDICATOR_SYNC_CAPABILITY_ID,
                'rollback'
            )
        ),
        error => error?.code === 'strong_audit_required'
    );
    assert.equal(
        fixture.db.prepare('SELECT copper_base FROM coils').get()
            .copper_base,
        100
    );
    assert.deepEqual(
        fixture.db.prepare('SELECT copper_base, cost FROM coils WHERE id = 2').get(),
        { copper_base: 0, cost: 66.5 }
    );
    assert.equal(
        fixture.db.prepare(`
            SELECT value FROM system_settings
            WHERE key = 'aluminum_wire_price_per_kg'
        `).get().value,
        '20.00'
    );
    assert.equal(
        fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM audit_log'
        ).get().count,
        0
    );
    assert.equal(
        fixture.db.prepare(
            'SELECT COUNT(*) AS count FROM api_operations'
        ).get().count,
        0
    );
});

test('铜价同步无业务变化时仍返回可重放 operation 回执', () => {
    const fixture = createFixture();
    fixture.db.prepare(`
        UPDATE coils SET copper_base = ?, cost = ? WHERE id = 1
    `).run(105.27, 97.04593);
    const context = commandContext(
        COPPER_SYNC_CAPABILITY_ID,
        'unchanged'
    );
    const first = executeCopperPriceSync(
        fixture.dependencies,
        marketSnapshot(),
        { trigger: 'scheduled' },
        context
    );
    const replay = executeCopperPriceSync(
        fixture.dependencies,
        marketSnapshot(),
        { trigger: 'scheduled' },
        context
    );
    assert.equal(first.unchanged, true);
    assert.equal(first.auditIds.length, 0);
    assert.equal(replay.idempotentReplay, true);
});

test('外部行情抓取并行生成带来源和时间的正式快照', async () => {
    const responses = [
        { code: 0, data: [{ price: '105270' }] },
        { code: 0, data: [{ price: '22120' }] },
        { date: '2026-08-03', rates: { CNY: 7.2345 } },
    ];
    let calls = 0;
    const snapshot = await fetchMarketSnapshot(
        async () => ({
            json: async () => responses[calls++],
        }),
        new Date('2026-08-03T05:00:00.000Z')
    );
    assert.equal(snapshot.copperPricePerTon, 105270);
    assert.equal(snapshot.aluminumPricePerTon, 22120);
    assert.equal(snapshot.usdCnyRate, 7.2345);
    assert.deepEqual(snapshot.sources, MARKET_SOURCES);
    assert.equal(snapshot.fetchedAt, '2026-08-03T05:00:00.000Z');
});

test('外部行情格式异常映射为稳定 502 错误', async () => {
    await assert.rejects(
        () => fetchMarketSnapshot(async () => ({
            json: async () => ({ code: 0, data: [{ price: 'bad' }] }),
        })),
        error => (
            error?.code === 'market_data_unavailable'
            && error?.statusCode === 502
        )
    );
});

test('系统同步按北京时间日期生成启动和调度独立幂等窗口', () => {
    const now = new Date('2026-08-02T16:30:00.000Z');
    assert.equal(bjtDateKey(now), '2026-08-03');
    const startup = systemCommandContext(
        COPPER_SYNC_CAPABILITY_ID,
        'startup',
        now
    );
    const scheduled = systemCommandContext(
        COPPER_SYNC_CAPABILITY_ID,
        'scheduled',
        now
    );
    assert.match(startup.idempotencyKey, /startup:/);
    assert.doesNotMatch(startup.idempotencyKey, /startup:2026-08-03$/);
    assert.match(scheduled.idempotencyKey, /scheduled:2026-08-03$/);
    assert.notEqual(startup.idempotencyKey, scheduled.idempotencyKey);
});

test('市场同步拒绝未声明请求字段', () => {
    assert.deepEqual(assertMarketSyncRequestBody(undefined), {});
    assert.deepEqual(
        assertMarketSyncRequestBody({ idempotencyKey: 'market:test:key' }),
        { idempotencyKey: 'market:test:key' }
    );
    assert.throws(
        () => assertMarketSyncRequestBody({ copperPrice: 1 }),
        error => (
            error?.code === 'market_sync_unknown_field'
            && error?.statusCode === 400
        )
    );
});
