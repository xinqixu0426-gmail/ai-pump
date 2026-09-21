const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    executeConfirmRequirement,
    executeRevokeRequirement,
    executeSaveRequirementDraft,
} = require('../api/services/orderRequirementCommands.cjs');

function createFixture() {
    const db = new Database(':memory:');
    runMigrations(db, { now: '2026-08-03T08:00:00.000Z' });
    let tick = 0;
    const nextTime = () => `2026-08-03T08:00:${String(++tick).padStart(2, '0')}.000Z`;
    const audit = (action, table, id, context) => Number(db.prepare(`
        INSERT INTO audit_log (
            action, table_name, record_id, user, request_id,
            operation_id, capability_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        action,
        table,
        id,
        context?.user || 'test',
        context?.requestId || null,
        context?.operationId || null,
        context?.capabilityId || null,
        nextTime()
    ).lastInsertRowid);
    const dependencies = {
        db,
        safeInsert(table, values, context) {
            const columns = Object.keys(values).filter(key => values[key] !== undefined);
            const info = db.prepare(`
                INSERT INTO ${table} (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(key => values[key]));
            return {
                ...info,
                auditId: audit('INSERT', table, Number(info.lastInsertRowid), context),
            };
        },
        safeUpdate(table, id, values, context) {
            const columns = Object.keys(values).filter(key => values[key] !== undefined);
            const info = db.prepare(`
                UPDATE ${table}
                SET ${columns.map(key => `${key} = ?`).join(', ')}, updated_at = ?
                WHERE id = ?
            `).run(...columns.map(key => values[key]), nextTime(), id);
            return { ...info, auditId: audit('UPDATE', table, id, context) };
        },
    };
    const orderId = Number(db.prepare(`
        INSERT INTO orders (
            customer_name, contract_no, status, items_json,
            purchase_list_json, todos_json, created_at, updated_at
        ) VALUES ('客户A', 'HT-31', '待确认', '[]', '[]', '[]', ?, ?)
    `).run('2026-08-03T08:00:00.000Z', '2026-08-03T08:00:00.000Z').lastInsertRowid);
    return { db, dependencies, orderId };
}

function context(key) {
    return {
        actorKey: 'user:test',
        idempotencyKey: key,
        requestId: `request-${key}`,
    };
}

test('客户要求命令：保存草稿持久幂等且强审计与 operation 原子提交', () => {
    const fixture = createFixture();
    try {
        const input = {
            summaryText: '客户确认使用 380V 电机。',
            sourceFileIds: [],
            expectedUpdatedAt: null,
        };
        const first = executeSaveRequirementDraft(
            fixture.dependencies,
            fixture.orderId,
            input,
            context('requirement-save-0001')
        );
        const replay = executeSaveRequirementDraft(
            fixture.dependencies,
            fixture.orderId,
            input,
            context('requirement-save-0001')
        );
        assert.equal(first.capabilityId, 'orders.requirements.save_draft');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) count FROM order_requirement_summaries').get().count,
            1
        );
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) count FROM api_operations').get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('客户要求命令：过期版本拒绝覆盖且不创建 operation', () => {
    const fixture = createFixture();
    try {
        const created = executeSaveRequirementDraft(
            fixture.dependencies,
            fixture.orderId,
            { summaryText: '第一版', sourceFileIds: [], expectedUpdatedAt: null },
            context('requirement-save-0002')
        );
        assert.throws(() => executeSaveRequirementDraft(
            fixture.dependencies,
            fixture.orderId,
            {
                summaryText: '过期覆盖',
                sourceFileIds: [],
                expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
            },
            context('requirement-save-0003')
        ), /已被其他操作修改/);
        assert.equal(
            fixture.db.prepare('SELECT draft_text FROM order_requirement_summaries').get().draft_text,
            created.draftText
        );
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) count FROM api_operations').get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('客户要求命令：确认与撤销都返回版本化强审计回执', () => {
    const fixture = createFixture();
    try {
        const draft = executeSaveRequirementDraft(
            fixture.dependencies,
            fixture.orderId,
            { summaryText: '客户确认木箱包装。', sourceFileIds: [] },
            context('requirement-save-0004')
        );
        const confirmed = executeConfirmRequirement(
            fixture.dependencies,
            fixture.orderId,
            { expectedUpdatedAt: draft.updatedAt },
            context('requirement-confirm-0001')
        );
        assert.equal(confirmed.knowledgeStatus, 'confirmed');
        assert.equal(confirmed.auditIds.length, 1);
        const revoked = executeRevokeRequirement(
            fixture.dependencies,
            fixture.orderId,
            { expectedUpdatedAt: confirmed.updatedAt },
            context('requirement-revoke-0001')
        );
        assert.equal(revoked.knowledgeStatus, 'not_confirmed');
        assert.equal(revoked.auditIds.length, 1);
    } finally {
        fixture.db.close();
    }
});
