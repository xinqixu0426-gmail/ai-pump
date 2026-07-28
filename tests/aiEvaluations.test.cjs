const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    createAiEvaluationRun,
    recordAiEvaluationResult,
    completeAiEvaluationRun,
    getAiEvaluationOverview,
    evaluateRuleCase,
} = require('../api/services/aiEvaluations.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE parts (id INTEGER PRIMARY KEY, model TEXT, price REAL, deleted_at TEXT);
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
        CREATE TABLE quotations (id INTEGER PRIMARY KEY, customer_id INTEGER, deleted_at TEXT);
        CREATE TABLE ai_evaluation_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            question TEXT NOT NULL,
            evaluator_type TEXT NOT NULL,
            config_json TEXT DEFAULT '{}',
            enabled INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE ai_evaluation_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_key TEXT NOT NULL,
            status TEXT NOT NULL,
            total_count INTEGER DEFAULT 0,
            passed_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            review_count INTEGER DEFAULT 0,
            started_at TEXT,
            completed_at TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE ai_evaluation_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            case_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            answer_text TEXT DEFAULT '',
            tool_results_json TEXT DEFAULT '[]',
            sources_json TEXT DEFAULT '[]',
            checks_json TEXT DEFAULT '[]',
            error_text TEXT DEFAULT '',
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(run_id, case_id)
        );
    `);
    const now = new Date().toISOString();
    const safeInsert = (table, values) => {
        const columns = Object.keys(values);
        return db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
            .run(...columns.map(column => values[column]));
    };
    const safeUpdate = (table, id, values) => {
        const entries = Object.entries(values);
        db.prepare(`UPDATE ${table} SET ${entries.map(([column]) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
            .run(...entries.map(([, value]) => value), now, id);
    };
    const aiEvaluationCaseRow = row => row && ({
        id: row.id,
        caseKey: row.case_key,
        title: row.title,
        category: row.category,
        question: row.question,
        evaluatorType: row.evaluator_type,
        configJson: row.config_json,
        enabled: Boolean(row.enabled),
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    });
    const aiEvaluationRunRow = row => row && ({
        id: row.id,
        status: row.status,
        totalCount: row.total_count,
        passedCount: row.passed_count,
        failedCount: row.failed_count,
        reviewCount: row.review_count,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    });
    const aiEvaluationResultRow = row => row && ({
        id: row.id,
        runId: row.run_id,
        caseId: row.case_id,
        status: row.status,
        answerText: row.answer_text,
        toolResultsJson: row.tool_results_json,
        sourcesJson: row.sources_json,
        checksJson: row.checks_json,
        errorText: row.error_text,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    });
    const accessors = {
        db, safeInsert, safeUpdate,
        aiEvaluationCaseRow, aiEvaluationRunRow, aiEvaluationResultRow,
    };
    db.prepare('INSERT INTO parts VALUES (1, ?, ?, NULL)').run('800平刀切割泵壳', 95);
    db.prepare('INSERT INTO customers VALUES (1, ?, NULL)').run('邱焕');
    db.prepare('INSERT INTO quotations VALUES (3, 1, NULL)').run();
    db.prepare('INSERT INTO quotations VALUES (5, 1, NULL)').run();
    return { db, accessors };
}

test('AI 评测：规则检查当前零件价格、工具和实时来源', () => {
    const fixture = createFixture();
    const result = evaluateRuleCase({
        config: {
            expectedMode: 'live_business',
            requiredTools: ['search_parts'],
            fact: { type: 'part_price', model: '800平刀切割泵壳' },
        },
    }, '当前单价为 95 元。', [{
        name: 'search_parts',
        result: { provenance: { kind: 'live_business' } },
    }], fixture.db);

    assert.equal(result.status, 'passed');
    assert.ok(result.checks.every(check => check.passed));
    fixture.db.close();
});

test('AI 评测：禁用词允许明确否定，但拒绝反转后的肯定结论', () => {
    const fixture = createFixture();
    const caseItem = {
        config: {
            requiredTerms: [['性能测试报告']],
            forbiddenTerms: ['参考图纸'],
        },
    };
    const correct = evaluateRuleCase(
        caseItem,
        '附件是性能测试报告，不是工程图纸或参考图纸。',
        [],
        fixture.db
    );
    assert.equal(correct.status, 'passed');

    const wrong = evaluateRuleCase(
        caseItem,
        '附件不是性能测试报告，而是参考图纸。',
        [],
        fixture.db
    );
    assert.equal(wrong.status, 'failed');
    assert.equal(wrong.checks.find(check => check.key === 'forbidden:参考图纸').passed, false);
    fixture.db.close();
});

test('AI 评测：客户报价检查识别错误数量和内部数据库编号', () => {
    const fixture = createFixture();
    const result = evaluateRuleCase({
        config: {
            fact: { type: 'customer_quotation_count', customerName: '邱焕', forbidInternalIds: true },
        },
    }, '客户共有 2 份报价，分别是 #3 和 #5。', [], fixture.db);

    assert.equal(result.status, 'failed');
    assert.equal(result.checks.find(check => check.key === 'fact:quotation_count').passed, true);
    assert.equal(result.checks.find(check => check.key === 'fact:no_internal_ids').passed, false);
    fixture.db.close();
});

test('AI 评测：运行生命周期保存结果、汇总并按 owner 隔离', () => {
    const fixture = createFixture();
    fixture.db.prepare(`
        INSERT INTO ai_evaluation_cases (
            case_key, title, category, question, evaluator_type, config_json,
            enabled, sort_order, created_at, updated_at
        ) VALUES ('case-1', '测试报告类型', '技术档案', '附件是什么', 'rules', ?, 1, 10, ?, ?)
    `).run(JSON.stringify({
        requiredTerms: [['性能测试报告']],
        forbiddenTerms: ['参考图纸'],
    }), new Date().toISOString(), new Date().toISOString());

    const created = createAiEvaluationRun('admin', { dbAccessors: fixture.accessors });
    assert.equal(created.cases.length, 1);
    assert.equal(getAiEvaluationOverview('operator', { dbAccessors: fixture.accessors }).latestRun, null);

    const result = recordAiEvaluationResult('admin', created.run.id, {
        caseId: created.cases[0].id,
        answerText: '附件是性能测试报告。',
        toolResults: [],
    }, { dbAccessors: fixture.accessors });
    assert.equal(result.status, 'passed');

    const completed = completeAiEvaluationRun('admin', created.run.id, { dbAccessors: fixture.accessors });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.passedCount, 1);
    assert.equal(getAiEvaluationOverview('admin', { dbAccessors: fixture.accessors }).results.length, 1);
    fixture.db.close();
});
