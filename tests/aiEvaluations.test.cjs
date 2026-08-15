const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    createAiEvaluationRun,
    recordAiEvaluationResult,
    completeAiEvaluationRun,
    getAiEvaluationOverview,
    getLatestAiEvaluationHealth,
    evaluateRuleCase,
} = require('../api/services/aiEvaluations.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE parts (id INTEGER PRIMARY KEY, model TEXT, price REAL, deleted_at TEXT);
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY,
            spec TEXT,
            sheets INTEGER,
            scheme_status TEXT
        );
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
        CREATE TABLE quotations (id INTEGER PRIMARY KEY, customer_id INTEGER, deleted_at TEXT);
        CREATE TABLE recipes (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
        CREATE TABLE recipe_technical_files (
            id INTEGER PRIMARY KEY,
            recipe_id INTEGER,
            report_type TEXT,
            deleted_at TEXT
        );
        CREATE TABLE ai_evaluation_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            question TEXT NOT NULL,
            evaluator_type TEXT NOT NULL,
            config_json TEXT DEFAULT '{}',
            enabled INTEGER DEFAULT 1,
            release_gate_enabled INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            source_type TEXT NOT NULL DEFAULT 'system',
            source_feedback_id INTEGER UNIQUE,
            review_status TEXT NOT NULL DEFAULT 'approved',
            confidence_score INTEGER NOT NULL DEFAULT 100,
            generation_note TEXT DEFAULT '',
            proposal_hash TEXT DEFAULT '',
            review_note TEXT DEFAULT '',
            reviewed_at TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE factory_ai_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_feedback_id INTEGER UNIQUE,
            status TEXT NOT NULL DEFAULT 'active'
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
        releaseGateEnabled: Boolean(row.release_gate_enabled),
        sortOrder: row.sort_order,
        sourceType: row.source_type || 'system',
        sourceFeedbackId: row.source_feedback_id || null,
        reviewStatus: row.review_status || 'approved',
        confidenceScore: Number(row.confidence_score ?? 100),
        generationNote: row.generation_note || '',
        proposalHash: row.proposal_hash || '',
        reviewNote: row.review_note || '',
        reviewedAt: row.reviewed_at,
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

    const futureNegation = evaluateRuleCase(
        {
            config: {
                forbiddenTerms: ['全套含刀'],
            },
        },
        '知识库未记录刀片组成，系统不会回答“全套含刀”。',
        [],
        fixture.db
    );
    assert.equal(futureNegation.status, 'passed');

    const unconfirmedConclusion = evaluateRuleCase(
        {
            config: {
                forbiddenTerms: ['全套含刀'],
            },
        },
        '系统未明确记录是否随泵壳附带刀片，无法确认“全套含刀”，不能自行推断。',
        [],
        fixture.db
    );
    assert.equal(unconfirmedConclusion.status, 'passed');

    const unableToAnswer = evaluateRuleCase(
        {
            config: {
                forbiddenTerms: ['全套含刀'],
            },
        },
        '现有来源未确认是否随泵壳附带刀片，系统无法回答“是否全套含刀”。',
        [],
        fixture.db
    );
    assert.equal(unableToAnswer.status, 'passed');

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

test('AI 评测：目标测试报告不存在时核对安全说明，存在时恢复严格内容和来源检查', () => {
    const fixture = createFixture();
    const caseItem = {
        config: {
            prerequisite: {
                type: 'recipe_test_report',
                recipeName: 'V1600-3”-12-180',
            },
            unavailableTerms: ['未找到', '无法确认'],
            requiredTerms: [['性能测试报告'], ['流量'], ['扬程']],
            forbiddenTerms: ['参考图纸'],
            requiredTools: ['search_factory_knowledge'],
            requiredSourceTables: ['recipes'],
        },
    };
    const unavailable = evaluateRuleCase(
        caseItem,
        '系统未找到目标配方，因此无法确认附件内容。',
        [{ name: 'search_factory_knowledge', result: {} }],
        fixture.db
    );
    assert.equal(unavailable.status, 'passed');
    assert.equal(unavailable.checks.some(check => check.key.startsWith('required:')), false);
    assert.equal(unavailable.checks.some(check => check.key.startsWith('tool:')), false);
    assert.equal(unavailable.checks.some(check => check.key.startsWith('source:')), false);

    const naturalUnavailable = evaluateRuleCase(
        caseItem,
        '未在系统中找到目标配方，因此无法读取对应的性能测试报告。',
        [{ name: 'get_recipe_detail', result: {} }],
        fixture.db
    );
    assert.equal(naturalUnavailable.status, 'passed');

    const unsupported = evaluateRuleCase(
        caseItem,
        '附件内容已经确认。',
        [{ name: 'search_factory_knowledge', result: {} }],
        fixture.db
    );
    assert.equal(unsupported.status, 'failed');

    fixture.db.prepare(`INSERT INTO recipes VALUES (1, ?, NULL)`).run('V1600-3”-12-180');
    fixture.db.prepare(`
        INSERT INTO recipe_technical_files VALUES (1, 1, 'pump_performance_test', NULL)
    `).run();
    const available = evaluateRuleCase(
        caseItem,
        '附件是性能测试报告，测试点包含流量和扬程。',
        [{
            name: 'search_factory_knowledge',
            result: { sources: [{ sourceTable: 'recipes' }] },
        }],
        fixture.db
    );
    assert.equal(available.status, 'passed');
    fixture.db.close();
});

test('AI 评测：客户不存在时接受明确未找到结论而不要求伪造零份报价', () => {
    const fixture = createFixture();
    fixture.db.prepare('DELETE FROM quotations').run();
    fixture.db.prepare('DELETE FROM customers').run();
    const caseItem = {
        config: {
            fact: {
                type: 'customer_quotation_count',
                customerName: '邱焕',
                forbidInternalIds: true,
            },
        },
    };
    const correct = evaluateRuleCase(caseItem, '未找到客户“邱焕”。', [], fixture.db);
    assert.equal(correct.status, 'passed');
    const naturalWording = evaluateRuleCase(
        caseItem,
        '未查询到客户“邱焕”的报价记录。系统中未找到名称为“邱焕”的客户。',
        [],
        fixture.db
    );
    assert.equal(naturalWording.status, 'passed');
    const equivalentWording = evaluateRuleCase(
        caseItem,
        '未匹配到客户“邱焕”的客户档案。',
        [],
        fixture.db
    );
    assert.equal(equivalentWording.status, 'passed');
    const uncertain = evaluateRuleCase(
        caseItem,
        '客户可能不存在，需要进一步核实。',
        [],
        fixture.db
    );
    assert.equal(uncertain.status, 'failed');
    assert.equal(
        correct.checks.find(check => check.key === 'fact:customer_missing').passed,
        true
    );
    const invented = evaluateRuleCase(caseItem, '当前共有 0 份报价。', [], fixture.db);
    assert.equal(invented.status, 'failed');
    fixture.db.close();
});

test('AI 评测：零件不存在时接受明确未找到结论而不要求测试夹具', () => {
    const fixture = createFixture();
    fixture.db.prepare('DELETE FROM parts').run();
    const caseItem = {
        config: {
            expectedMode: 'live_business',
            requiredTools: ['search_parts'],
            fact: {
                type: 'part_price',
                model: '800平刀切割泵壳',
            },
        },
    };
    const toolResults = [{
        name: 'search_parts',
        result: {
            count: 0,
            provenance: { kind: 'live_business' },
        },
    }];
    const correct = evaluateRuleCase(
        caseItem,
        '未查询到“800平刀切割泵壳”的单价记录，检索零件库返回 0 条记录。',
        toolResults,
        fixture.db
    );
    assert.equal(correct.status, 'passed');
    assert.equal(
        correct.checks.find(check => check.key === 'fact:part_missing').passed,
        true
    );

    const invented = evaluateRuleCase(
        caseItem,
        '800平刀切割泵壳当前单价为 0 元。',
        toolResults,
        fixture.db
    );
    assert.equal(invented.status, 'failed');
    fixture.db.close();
});

test('AI 评测：线圈方案不存在时接受明确零结果，存在时恢复内容和来源检查', () => {
    const fixture = createFixture();
    const caseItem = {
        config: {
            prerequisite: {
                type: 'coil_variants',
                spec: '12',
                sheets: 220,
            },
            unavailableTerms: ['未找到', '没有可列出'],
            expectedMode: 'live_business',
            requiredTerms: [['钢带'], ['小眼']],
            requiredTools: ['search_coils'],
            requiredSourceTables: ['coils'],
        },
    };
    const unavailable = evaluateRuleCase(
        caseItem,
        '12-220 当前没有已登记的正式方案，本轮实时查询返回记录数为 0。',
        [{
            name: 'search_coils',
            result: { provenance: { kind: 'live_business' }, count: 0 },
        }],
        fixture.db
    );
    assert.equal(unavailable.status, 'passed');
    assert.equal(unavailable.checks.some(check => check.key.startsWith('required:')), false);
    assert.equal(unavailable.checks.some(check => check.key.startsWith('source:')), false);

    const equivalentZeroWording = evaluateRuleCase(
        caseItem,
        '系统中没有规格为 12、片数 220 的正式线圈方案，返回数量为 0。',
        [{
            name: 'search_coils',
            result: { provenance: { kind: 'live_business' }, count: 0 },
        }],
        fixture.db
    );
    assert.equal(equivalentZeroWording.status, 'passed');

    fixture.db.prepare(`
        INSERT INTO coils (id, spec, sheets, scheme_status)
        VALUES (1, '12', 220, 'official')
    `).run();
    const available = evaluateRuleCase(
        caseItem,
        '12-220 正式方案包含钢带、小眼。',
        [{
            name: 'search_coils',
            result: {
                provenance: { kind: 'live_business' },
                sources: [{ sourceTable: 'coils', sourceId: 1 }],
            },
        }],
        fixture.db
    );
    assert.equal(available.status, 'passed');
    fixture.db.close();
});

test('AI 评测：切割泵壳必须使用明确证据且不得把 SPA 语义候选当结论', () => {
    const fixture = createFixture();
    const caseItem = {
        config: {
            requiredTerms: [
                ['800平刀切割泵壳'],
                [
                    '系统未记录',
                    '系统未明确记录',
                    '没有记录',
                    '没有明确记录',
                    '没有其他明确标注',
                    '未记录',
                    '未明确记录',
                    '未明确标注',
                    '无明确记录',
                    '当前无明确',
                    '不能确认',
                    '无法确认',
                ],
                ['切边6mm长螺丝'],
                ['外六角', '外六角螺丝'],
            ],
            forbiddenTerms: [
                'SPA系列切割泵壳',
                'SPA 2叶切割泵壳',
                '专门为切割工况设计',
                '全套含刀',
            ],
            requiredTools: ['search_factory_knowledge'],
            requiredSourceTables: ['business_rules'],
        },
    };
    const toolResults = [{
        name: 'search_factory_knowledge',
        result: {
            sources: [{
                knowledgeEntryId: 13,
                title: '零件：800平刀切割泵壳',
                sourceTable: 'parts',
                sourceId: '13',
                freshness: 'fresh',
            }, {
                knowledgeEntryId: 127,
                title: '业务规则：切割泵壳与配件识别',
                sourceTable: 'business_rules',
                sourceId: 'cutting_shell_semantics',
                freshness: 'fresh',
            }],
        },
    }];

    const correct = evaluateRuleCase(
        caseItem,
        '明确记录的选择是 **800平刀切割泵壳**；系统内没有其他明确标注的切割专用配件，不能确认存在刀片。“切边6mm长螺丝”是外六角螺丝，不是刀片。',
        toolResults,
        fixture.db
    );
    const incorrect = evaluateRuleCase(
        caseItem,
        '推荐 SPA 2叶切割泵壳，它专门为切割工况设计。',
        toolResults,
        fixture.db
    );

    assert.equal(correct.status, 'passed');

    const explicitWarning = evaluateRuleCase(
        caseItem,
        '系统未确认是否附带刀片，请勿推断为全套含刀。',
        toolResults,
        fixture.db
    );
    assert.equal(
        explicitWarning.checks.find(check => check.key === 'forbidden:全套含刀').passed,
        true
    );
    assert.equal(incorrect.status, 'failed');
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

test('AI 评测：零报价接受明确无历史报价结论并拒绝含糊回答', () => {
    const fixture = createFixture();
    fixture.db.prepare('DELETE FROM quotations').run();
    const caseItem = {
        config: {
            fact: { type: 'customer_quotation_count', customerName: '邱焕', forbidInternalIds: true },
        },
    };

    for (const answer of [
        '客户邱焕目前没有任何历史报价，也没有历史订单。',
        '客户邱焕暂无报价记录。',
        '当前共有 0 份报价。',
    ]) {
        const result = evaluateRuleCase(caseItem, answer, [], fixture.db);
        assert.equal(result.status, 'passed', answer);
    }

    const vague = evaluateRuleCase(caseItem, '没有足够信息确认报价情况。', [], fixture.db);
    assert.equal(vague.status, 'failed');
    assert.equal(vague.checks.find(check => check.key === 'fact:quotation_count').passed, false);
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
    assert.equal(getLatestAiEvaluationHealth({ dbAccessors: fixture.accessors }).healthy, true);
    fixture.db.close();
});

test('AI 评测：最近失败结果形成全局发布健康信号', () => {
    const fixture = createFixture();
    fixture.db.prepare(`
        INSERT INTO ai_evaluation_cases (
            case_key, title, category, question, evaluator_type, config_json,
            enabled, sort_order, created_at, updated_at
        ) VALUES ('case-release', '发布门禁术语', '业务规则', '测试术语', 'rules', ?, 1, 10, ?, ?)
    `).run(JSON.stringify({
        requiredTerms: [['正确术语']],
    }), new Date().toISOString(), new Date().toISOString());

    const created = createAiEvaluationRun('internal', { dbAccessors: fixture.accessors });
    recordAiEvaluationResult('internal', created.run.id, {
        caseId: created.cases[0].id,
        answerText: '返回了错误术语。',
        toolResults: [],
    }, { dbAccessors: fixture.accessors });
    completeAiEvaluationRun('internal', created.run.id, { dbAccessors: fixture.accessors });

    const health = getLatestAiEvaluationHealth({ dbAccessors: fixture.accessors });
    assert.equal(health.status, 'attention');
    assert.equal(health.healthy, false);
    assert.equal(health.latestRun.failedCount, 1);
    assert.equal(health.activeFailedCount, 1);
    assert.equal(health.issues[0].caseTitle, '发布门禁术语');
    assert.equal(health.issues[0].checks[0].passed, false);
    fixture.db.close();
});

test('AI 评测：已停用用例的历史失败不再形成当前健康告警', () => {
    const fixture = createFixture();
    const now = new Date().toISOString();
    fixture.db.prepare(`
        INSERT INTO ai_evaluation_cases (
            case_key, title, category, question, evaluator_type, config_json,
            enabled, sort_order, created_at, updated_at
        ) VALUES
            ('case-disabled-failure', '旧失败用例', '业务规则', '旧问题', 'rules', ?, 1, 10, ?, ?),
            ('case-active-pass', '当前启用用例', '业务规则', '当前问题', 'rules', ?, 1, 20, ?, ?)
    `).run(
        JSON.stringify({ requiredTerms: [['正确答案']] }), now, now,
        JSON.stringify({ requiredTerms: [['当前答案']] }), now, now
    );

    const created = createAiEvaluationRun('internal', { dbAccessors: fixture.accessors });
    const oldCase = created.cases.find(item => item.caseKey === 'case-disabled-failure');
    const activeCase = created.cases.find(item => item.caseKey === 'case-active-pass');
    recordAiEvaluationResult('internal', created.run.id, {
        caseId: oldCase.id,
        answerText: '错误答案',
        toolResults: [],
    }, { dbAccessors: fixture.accessors });
    recordAiEvaluationResult('internal', created.run.id, {
        caseId: activeCase.id,
        answerText: '当前答案',
        toolResults: [],
    }, { dbAccessors: fixture.accessors });
    completeAiEvaluationRun('internal', created.run.id, { dbAccessors: fixture.accessors });
    fixture.db.prepare('UPDATE ai_evaluation_cases SET enabled = 0 WHERE id = ?').run(oldCase.id);

    const health = getLatestAiEvaluationHealth({ dbAccessors: fixture.accessors });
    assert.equal(health.status, 'healthy');
    assert.equal(health.healthy, true);
    assert.equal(health.activeCaseCount, 1);
    assert.equal(health.evaluatedActiveCaseCount, 1);
    assert.equal(health.activeFailedCount, 0);
    assert.deepEqual(health.issues, []);
    fixture.db.close();
});
