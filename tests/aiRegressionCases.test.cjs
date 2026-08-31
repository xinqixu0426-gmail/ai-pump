const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildFeedbackEvaluationProposal,
    extractCorrectionTerms,
    listFeedbackEvaluationCases,
    reviewFeedbackEvaluationCase,
    synchronizeAiEvaluationCaseFromFeedback,
    synchronizeEvaluationCaseForRuleStatus,
} = require('../api/services/aiRegressionCases.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE ai_evaluation_cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            question TEXT NOT NULL,
            evaluator_type TEXT NOT NULL DEFAULT 'rules',
            config_json TEXT DEFAULT '{}',
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
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
    `);
    const now = new Date().toISOString();
    const safeInsert = (table, values) => {
        const columns = Object.keys(values);
        return db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
    };
    const safeUpdate = (table, id, values) => {
        const entries = Object.entries(values);
        db.prepare(`
            UPDATE ${table}
            SET ${entries.map(([column]) => `${column} = ?`).join(', ')}, updated_at = ?
            WHERE id = ?
        `).run(...entries.map(([, value]) => value), now, id);
    };
    const aiEvaluationCaseRow = row => row && ({
        id: row.id,
        caseKey: row.case_key,
        title: row.title,
        category: row.category,
        question: row.question,
        evaluatorType: row.evaluator_type,
        configJson: row.config_json || '{}',
        enabled: Boolean(row.enabled),
        sortOrder: Number(row.sort_order || 0),
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
    return {
        db,
        accessors: { db, safeInsert, safeUpdate, aiEvaluationCaseRow },
    };
}

test('纠错回归：从术语、型号和明确否定中提取稳定检查项', () => {
    assert.deepEqual(
        extractCorrectionTerms('12-120代表12规格的定子、120片，不是120规格。'),
        {
            required: ['12-120', '120片', '12规格的定子'],
            forbidden: ['120规格'],
            explicitRelation: true,
        }
    );
    const proposal = buildFeedbackEvaluationProposal({
        id: 7,
        question_text: '12-120是什么意思？',
        note: '12-120代表12规格的定子、120片，不是120规格。',
    });
    assert.equal(proposal.reviewStatus, 'pending');
    assert.equal(proposal.enabled, false);
    assert.equal(proposal.category, '线圈');
});

test('纠错回归：抽不出正确答案锚点时只生成待确认候选', () => {
    const proposal = buildFeedbackEvaluationProposal({
        id: 8,
        question_text: '这个问题以后怎么回答？',
        note: '以后必须先核对业务数据，不要复述历史回答。',
    });
    assert.equal(proposal.reviewStatus, 'pending');
    assert.equal(proposal.enabled, false);
    assert.equal(proposal.config.requiredTerms.length, 0);
    assert.deepEqual(proposal.config.forbiddenTerms, ['复述历史回答']);
});

test('纠错回归：同步幂等、人工审核和规则停用保持一致', () => {
    const fixture = createFixture();
    fixture.db.prepare(
        "INSERT INTO factory_ai_rules (source_feedback_id, status) VALUES (9, 'active')"
    ).run();
    const feedback = {
        id: 9,
        rating: 'incorrect',
        question_text: '附件是什么资料？',
        note: '附件不是参考图纸，正确分类是性能测试报告。',
    };
    const first = synchronizeAiEvaluationCaseFromFeedback(
        { feedback, learnFromCorrection: true },
        { dbAccessors: fixture.accessors }
    );
    const second = synchronizeAiEvaluationCaseFromFeedback(
        { feedback, learnFromCorrection: true },
        { dbAccessors: fixture.accessors }
    );
    assert.equal(second.id, first.id);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM ai_evaluation_cases').get().count, 1);

    const rejected = reviewFeedbackEvaluationCase(
        first.id,
        { reviewStatus: 'rejected', reviewNote: '当前不纳入发布门禁' },
        { dbAccessors: fixture.accessors }
    );
    assert.equal(rejected.enabled, false);
    assert.equal(rejected.reviewStatus, 'rejected');

    const approved = reviewFeedbackEvaluationCase(
        first.id,
        { reviewStatus: 'approved' },
        { dbAccessors: fixture.accessors }
    );
    assert.equal(approved.enabled, true);
    synchronizeEvaluationCaseForRuleStatus(9, 'disabled', { dbAccessors: fixture.accessors });
    assert.equal(listFeedbackEvaluationCases({ dbAccessors: fixture.accessors })[0].enabled, false);
    fixture.db.close();
});
