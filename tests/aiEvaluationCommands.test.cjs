const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    executeCompleteAiEvaluationRun,
    executeConfigureAiSystemEvaluationCase,
    executeRecordAiEvaluationResult,
    executeReviewAiEvaluationCase,
    executeStartAiEvaluationRun,
} = require('../api/services/aiEvaluationCommands.cjs');
const {
    AI_RELEASE_RUN_OWNER_KEY,
    CORE_AI_RELEASE_CASE_KEYS,
} = require('../api/services/aiEvaluationReleasePolicy.cjs');

function createFixture(overrides = {}) {
    const db = new Database(':memory:');
    runMigrations(db, { now: '2026-08-03T12:00:00.000Z' });
    db.prepare(`
        INSERT INTO ai_evaluation_cases (
            case_key, title, category, question, evaluator_type, config_json,
            enabled, sort_order, source_type, review_status, confidence_score,
            created_at, updated_at
        ) VALUES (
            'command-fixture-case', '命令测试用例', '测试', '测试问题',
            'rules', '{}', 1, 9999, 'feedback', 'approved', 100,
            '2026-08-03T12:00:00.000Z', '2026-08-03T12:00:00.000Z'
        )
    `).run();
    let tick = 0;
    const nextTime = () => (
        `2026-08-03T12:00:${String(++tick).padStart(2, '0')}.000Z`
    );
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
            const columns = Object.keys(values).filter(
                key => values[key] !== undefined
            );
            const info = db.prepare(`
                INSERT INTO ${table} (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(key => values[key]));
            return {
                ...info,
                auditId: audit(
                    'INSERT',
                    table,
                    Number(info.lastInsertRowid),
                    context
                ),
            };
        },
        safeUpdate(table, id, values, context) {
            const normalized = {
                ...values,
                updated_at: values.updated_at || nextTime(),
            };
            const columns = Object.keys(normalized).filter(
                key => normalized[key] !== undefined
            );
            const info = db.prepare(`
                UPDATE ${table}
                SET ${columns.map(key => `${key} = ?`).join(', ')}
                WHERE id = ?
            `).run(...columns.map(key => normalized[key]), id);
            return {
                ...info,
                auditId: audit('UPDATE', table, id, context),
            };
        },
        aiEvaluationCaseRow(row) {
            return row && {
                id: Number(row.id),
                caseKey: row.case_key,
                title: row.title,
                category: row.category,
                question: row.question,
                evaluatorType: row.evaluator_type,
                configJson: row.config_json || '{}',
                enabled: Boolean(row.enabled),
                releaseGateEnabled: Boolean(row.release_gate_enabled),
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
            };
        },
        aiEvaluationRunRow(row) {
            return row && {
                id: Number(row.id),
                status: row.status,
                totalCount: Number(row.total_count || 0),
                passedCount: Number(row.passed_count || 0),
                failedCount: Number(row.failed_count || 0),
                reviewCount: Number(row.review_count || 0),
                startedAt: row.started_at,
                completedAt: row.completed_at,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
        },
        aiEvaluationResultRow(row) {
            return row && {
                id: Number(row.id),
                runId: Number(row.run_id),
                caseId: Number(row.case_id),
                status: row.status,
                answerText: row.answer_text || '',
                toolResultsJson: row.tool_results_json || '[]',
                sourcesJson: row.sources_json || '[]',
                checksJson: row.checks_json || '[]',
                errorText: row.error_text || '',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
        },
        ...overrides,
    };
    return { db, dependencies };
}

function context(key) {
    return {
        actorKey: 'user:ai-evaluation-test',
        idempotencyKey: key,
        operationId: `operation:${key}`,
        requestId: `request:${key}`,
        warnings: [],
    };
}

test('AI 评测命令：启动运行持久幂等并原子结束同 owner 旧运行', () => {
    const fixture = createFixture();
    try {
        const first = executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            {},
            context('ai-evaluation-start-0001')
        );
        const replay = executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            {},
            context('ai-evaluation-start-0001')
        );
        const second = executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            {},
            context('ai-evaluation-start-0002')
        );
        assert.equal(first.capabilityId, 'ai.evaluations.runs.start');
        assert.equal(replay.idempotentReplay, true);
        assert.equal(second.supersededRunIds[0], first.run.id);
        assert.equal(second.auditIds.length, 2);
        assert.equal(
            fixture.db.prepare(
                'SELECT status FROM ai_evaluation_runs WHERE id = ?'
            ).get(first.run.id).status,
            'failed'
        );
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM ai_evaluation_runs'
            ).get().count,
            2
        );
    } finally {
        fixture.db.close();
    }
});

test('AI 评测命令：手动检查与发布门禁共享核心系统项并追加反馈项', () => {
    const fixture = createFixture();
    try {
        const manual = executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            { scope: 'manual' },
            context('ai-evaluation-scope-manual-0001')
        );
        assert.ok(manual.cases.some(item => item.sourceType === 'system'));
        assert.throws(() => executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            { scope: 'release' },
            context('ai-evaluation-scope-forbidden-0001')
        ), error => error.code === 'ai_evaluation_release_scope_forbidden');

        const release = executeStartAiEvaluationRun(
            fixture.dependencies,
            'internal',
            { scope: 'release' },
            context('ai-evaluation-scope-release-0001')
        );
        assert.equal(
            release.cases.filter(item => item.sourceType === 'system').length,
            CORE_AI_RELEASE_CASE_KEYS.length
        );
        assert.equal(release.cases.filter(item => item.sourceType === 'feedback').length, 1);
        assert.equal(
            fixture.db.prepare('SELECT owner_key FROM ai_evaluation_runs WHERE id = ?')
                .get(release.run.id).owner_key,
            AI_RELEASE_RUN_OWNER_KEY
        );

        fixture.db.prepare(`
            UPDATE ai_evaluation_cases SET release_gate_enabled = 0
            WHERE case_key = ?
        `).run(CORE_AI_RELEASE_CASE_KEYS[0]);
        assert.throws(() => executeStartAiEvaluationRun(
            fixture.dependencies,
            'internal',
            { scope: 'release' },
            context('ai-evaluation-scope-release-incomplete-0001')
        ), error => error.code === 'ai_evaluation_release_cases_incomplete'
            && error.statusCode === 409);
    } finally {
        fixture.db.close();
    }
});

test('AI 评测命令：单用例诊断仅允许普通登录身份且发布门禁拒绝筛选', () => {
    const fixture = createFixture();
    try {
        const diagnostic = executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            { scope: 'manual', caseKey: 'command-fixture-case' },
            context('ai-evaluation-diagnostic-0001')
        );
        const replay = executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            { scope: 'manual', caseKey: 'command-fixture-case' },
            context('ai-evaluation-diagnostic-0001')
        );
        assert.equal(diagnostic.cases.length, 1);
        assert.equal(diagnostic.cases[0].caseKey, 'command-fixture-case');
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.run.id, diagnostic.run.id);
        const otherCase = fixture.db.prepare(`
            SELECT case_key FROM ai_evaluation_cases
            WHERE case_key <> 'command-fixture-case' AND enabled = 1
            ORDER BY id LIMIT 1
        `).get();
        assert.throws(() => executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            { scope: 'manual', caseKey: otherCase.case_key },
            context('ai-evaluation-diagnostic-0001')
        ), error => error.code === 'idempotency_key_conflict' && error.statusCode === 409);
        assert.throws(() => executeStartAiEvaluationRun(
            fixture.dependencies,
            'internal',
            { scope: 'manual', caseKey: 'command-fixture-case' },
            context('ai-evaluation-diagnostic-internal-0001')
        ), error => error.code === 'ai_evaluation_manual_owner_forbidden');
        assert.throws(() => executeStartAiEvaluationRun(
            fixture.dependencies,
            'internal',
            { scope: 'manual' },
            context('ai-evaluation-manual-internal-0001')
        ), error => error.code === 'ai_evaluation_manual_owner_forbidden');
        assert.throws(() => executeStartAiEvaluationRun(
            fixture.dependencies,
            'internal',
            { scope: 'release', caseKey: 'command-fixture-case' },
            context('ai-evaluation-diagnostic-release-0001')
        ), error => error.code === 'ai_evaluation_release_case_filter_forbidden');
        assert.throws(() => executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            { scope: 'manual', caseKey: 123 },
            context('ai-evaluation-diagnostic-invalid-0001')
        ), error => error.code === 'ai_evaluation_case_key_invalid');
        assert.throws(() => executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            { scope: 'manual', caseKey: 'missing-case' },
            context('ai-evaluation-diagnostic-missing-0001')
        ), error => error.code === 'ai_evaluation_case_not_found');
    } finally {
        fixture.db.close();
    }
});

test('AI 评测命令：release 与 diagnostic namespace 复用同一运行访问判定', () => {
    const fixture = createFixture();
    try {
        const release = executeStartAiEvaluationRun(
            fixture.dependencies,
            'internal',
            { scope: 'release' },
            context('ai-evaluation-release-lifecycle-start')
        );
        const releaseResult = executeRecordAiEvaluationResult(
            fixture.dependencies,
            'internal',
            release.run.id,
            {
                caseId: release.cases[0].id,
                answerText: '',
                toolResults: [],
                errorText: '测试执行失败',
                expectedUpdatedAt: release.run.updatedAt,
            },
            context('ai-evaluation-release-lifecycle-result')
        );
        assert.equal(releaseResult.result.runId, release.run.id);
        assert.throws(() => executeRecordAiEvaluationResult(
            fixture.dependencies,
            'admin',
            release.run.id,
            {
                caseId: release.cases[1].id,
                answerText: '',
                toolResults: [],
                errorText: '越权请求',
                expectedUpdatedAt: release.run.updatedAt,
            },
            context('ai-evaluation-release-lifecycle-forbidden')
        ), error => error.code === 'ai_evaluation_run_not_found');
        const releaseCompleted = executeCompleteAiEvaluationRun(
            fixture.dependencies,
            'internal',
            release.run.id,
            { expectedUpdatedAt: release.run.updatedAt },
            context('ai-evaluation-release-lifecycle-complete')
        );
        assert.equal(releaseCompleted.run.status, 'failed');

        const diagnostic = executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            { scope: 'manual', caseKey: 'command-fixture-case' },
            context('ai-evaluation-diagnostic-lifecycle-start')
        );
        const diagnosticResult = executeRecordAiEvaluationResult(
            fixture.dependencies,
            'admin',
            diagnostic.run.id,
            {
                caseId: diagnostic.cases[0].id,
                answerText: '',
                toolResults: [],
                errorText: '测试执行失败',
                expectedUpdatedAt: diagnostic.run.updatedAt,
            },
            context('ai-evaluation-diagnostic-lifecycle-result')
        );
        assert.equal(diagnosticResult.result.runId, diagnostic.run.id);
        assert.throws(() => executeRecordAiEvaluationResult(
            fixture.dependencies,
            'operator',
            diagnostic.run.id,
            {
                caseId: diagnostic.cases[0].id,
                answerText: '',
                toolResults: [],
                errorText: '其他普通身份越权请求',
                expectedUpdatedAt: diagnostic.run.updatedAt,
            },
            context('ai-evaluation-diagnostic-other-owner-forbidden')
        ), error => error.code === 'ai_evaluation_run_not_found');
        assert.throws(() => executeCompleteAiEvaluationRun(
            fixture.dependencies,
            'internal',
            diagnostic.run.id,
            { expectedUpdatedAt: diagnostic.run.updatedAt },
            context('ai-evaluation-diagnostic-lifecycle-forbidden')
        ), error => error.code === 'ai_evaluation_run_not_found');
        const diagnosticCompleted = executeCompleteAiEvaluationRun(
            fixture.dependencies,
            'admin',
            diagnostic.run.id,
            { expectedUpdatedAt: diagnostic.run.updatedAt },
            context('ai-evaluation-diagnostic-lifecycle-complete')
        );
        assert.equal(diagnosticCompleted.run.status, 'completed');
    } finally {
        fixture.db.close();
    }
});

test('AI 评测命令：核心门禁不可停用，非门禁系统项仍绑定版本和强审计', () => {
    const fixture = createFixture();
    try {
        const systemCase = fixture.db.prepare(`
            SELECT * FROM ai_evaluation_cases
            WHERE source_type = 'system'
            ORDER BY id LIMIT 1
        `).get();
        assert.throws(() => executeConfigureAiSystemEvaluationCase(
            fixture.dependencies,
            systemCase.id,
            {
                enabled: false,
                expectedUpdatedAt: systemCase.updated_at,
            },
            context('ai-evaluation-system-configure-0001')
        ), error => error.code === 'AI_CORE_RELEASE_CASE_REQUIRED');
        fixture.db.prepare(`
            UPDATE ai_evaluation_cases SET release_gate_enabled = 0 WHERE id = ?
        `).run(systemCase.id);
        const configured = executeConfigureAiSystemEvaluationCase(
            fixture.dependencies,
            systemCase.id,
            { enabled: false, expectedUpdatedAt: systemCase.updated_at },
            context('ai-evaluation-system-configure-0002')
        );
        assert.equal(configured.capabilityId, 'ai.evaluations.system_cases.configure');
        assert.equal(configured.enabled, false);
        assert.equal(configured.releaseGateEnabled, false);
        assert.equal(configured.auditIds.length, 1);
        assert.throws(() => executeConfigureAiSystemEvaluationCase(
            fixture.dependencies,
            systemCase.id,
            { enabled: true, expectedUpdatedAt: systemCase.updated_at },
            context('ai-evaluation-system-configure-0003')
        ), /已被其他操作修改/);
    } finally {
        fixture.db.close();
    }
});

test('AI 评测命令：单项结果绑定运行版本、用例唯一性和幂等回执', () => {
    const fixture = createFixture();
    try {
        const created = executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            {},
            context('ai-evaluation-start-0003')
        );
        const evaluationCase = created.cases[0];
        const input = {
            caseId: evaluationCase.id,
            answerText: '',
            toolResults: [],
            errorText: '测试执行失败',
            expectedUpdatedAt: created.run.updatedAt,
        };
        const first = executeRecordAiEvaluationResult(
            fixture.dependencies,
            'admin',
            created.run.id,
            input,
            context('ai-evaluation-result-0001')
        );
        const replay = executeRecordAiEvaluationResult(
            fixture.dependencies,
            'admin',
            created.run.id,
            input,
            context('ai-evaluation-result-0001')
        );
        assert.equal(first.capabilityId, 'ai.evaluations.results.record');
        assert.equal(first.status, 'completed');
        assert.equal(first.result.status, 'review');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.throws(() => executeRecordAiEvaluationResult(
            fixture.dependencies,
            'admin',
            created.run.id,
            input,
            context('ai-evaluation-result-0002')
        ), /已经记录结果/);
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM ai_evaluation_results'
            ).get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('AI 评测命令：结束运行只允许 running 状态且旧版本拒绝覆盖', () => {
    const fixture = createFixture();
    try {
        const created = executeStartAiEvaluationRun(
            fixture.dependencies,
            'admin',
            {},
            context('ai-evaluation-start-0004')
        );
        const completed = executeCompleteAiEvaluationRun(
            fixture.dependencies,
            'admin',
            created.run.id,
            { expectedUpdatedAt: created.run.updatedAt },
            context('ai-evaluation-complete-0001')
        );
        assert.equal(completed.capabilityId, 'ai.evaluations.runs.complete');
        assert.equal(completed.auditIds.length, 1);
        assert.equal(completed.status, 'completed');
        assert.equal(completed.run.status, 'failed');
        assert.throws(() => executeCompleteAiEvaluationRun(
            fixture.dependencies,
            'admin',
            created.run.id,
            { expectedUpdatedAt: created.run.updatedAt },
            context('ai-evaluation-complete-0002')
        ), /已被其他操作修改/);
    } finally {
        fixture.db.close();
    }
});

test('AI 评测命令：纠错用例审核绑定版本且缺少强审计时整体回滚', () => {
    const fixture = createFixture();
    try {
        const inserted = fixture.db.prepare(`
            INSERT INTO ai_evaluation_cases (
                case_key, title, category, question, evaluator_type,
                config_json, enabled, sort_order, source_type,
                review_status, confidence_score, generation_note,
                proposal_hash, review_note, created_at, updated_at
            ) VALUES (
                'feedback-command-test', '纠错审核', '业务规则',
                '测试问题', 'rules', ?, 0, 2000, 'feedback',
                'pending', 50, '', 'test-hash', '', ?, ?
            )
        `).run(
            JSON.stringify({ requiredTerms: [['正确答案']] }),
            '2026-08-03T12:10:00.000Z',
            '2026-08-03T12:10:00.000Z'
        );
        const caseId = Number(inserted.lastInsertRowid);
        const withoutAudit = {
            ...fixture.dependencies,
            safeUpdate(table, id, values) {
                const columns = Object.keys(values);
                return fixture.db.prepare(`
                    UPDATE ${table}
                    SET ${columns.map(key => `${key} = ?`).join(', ')}
                    WHERE id = ?
                `).run(...columns.map(key => values[key]), id);
            },
        };
        assert.throws(() => executeReviewAiEvaluationCase(
            withoutAudit,
            caseId,
            {
                reviewStatus: 'rejected',
                reviewNote: '暂不纳入',
                expectedUpdatedAt: '2026-08-03T12:10:00.000Z',
            },
            context('ai-evaluation-review-0001')
        ), /强审计记录不完整/);
        assert.equal(
            fixture.db.prepare(
                'SELECT review_status FROM ai_evaluation_cases WHERE id = ?'
            ).get(caseId).review_status,
            'pending'
        );
        const reviewed = executeReviewAiEvaluationCase(
            fixture.dependencies,
            caseId,
            {
                reviewStatus: 'rejected',
                reviewNote: '暂不纳入',
                expectedUpdatedAt: '2026-08-03T12:10:00.000Z',
            },
            context('ai-evaluation-review-0002')
        );
        assert.equal(reviewed.reviewStatus, 'rejected');
        assert.equal(reviewed.auditIds.length, 1);
    } finally {
        fixture.db.close();
    }
});
