const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildFactoryRuleCompliance,
    buildFactoryRuleImpact,
    buildRuleCandidateGroups,
    confidenceForEvidence,
    factoryRuleApprovalGate,
    listFactoryRuleEvents,
    refreshFactoryRuleCandidates,
    restoreFactoryRuleEvent,
    reviewFactoryRuleCandidate,
} = require('../api/services/factoryRuleCandidates.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT,
            spec TEXT,
            template_id INTEGER,
            parts_json TEXT DEFAULT '[]',
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE pump_shell_templates (
            id INTEGER PRIMARY KEY,
            shell_model TEXT
        );
        CREATE TABLE recipe_analysis_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id INTEGER NOT NULL,
            finding_key TEXT NOT NULL,
            finding_type TEXT NOT NULL,
            decision TEXT NOT NULL,
            note TEXT DEFAULT '',
            finding_snapshot_json TEXT DEFAULT '{}',
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE factory_rule_candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            scope_ref TEXT NOT NULL,
            finding_key TEXT NOT NULL,
            finding_type TEXT NOT NULL,
            evidence_count INTEGER NOT NULL DEFAULT 0,
            evidence_json TEXT DEFAULT '[]',
            support_count INTEGER NOT NULL DEFAULT 0,
            special_case_count INTEGER NOT NULL DEFAULT 0,
            ignored_count INTEGER NOT NULL DEFAULT 0,
            confidence_score REAL NOT NULL DEFAULT 0,
            learning_evidence_json TEXT DEFAULT '{}',
            learning_hash TEXT DEFAULT '',
            reviewed_learning_hash TEXT DEFAULT '',
            learning_updated_at TEXT,
            status TEXT NOT NULL DEFAULT 'candidate',
            review_note TEXT DEFAULT '',
            approved_at TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE factory_rule_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id INTEGER NOT NULL,
            rule_key TEXT NOT NULL,
            event_type TEXT NOT NULL,
            previous_status TEXT,
            new_status TEXT,
            actor TEXT NOT NULL DEFAULT 'system',
            note TEXT DEFAULT '',
            snapshot_json TEXT DEFAULT '{}',
            created_at TEXT NOT NULL
        );
        CREATE TABLE knowledge_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_type TEXT NOT NULL,
            source_table TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_updated_at TEXT,
            title TEXT NOT NULL,
            summary TEXT DEFAULT '',
            content TEXT DEFAULT '',
            tags_json TEXT DEFAULT '[]',
            metadata_json TEXT DEFAULT '{}',
            search_text TEXT DEFAULT '',
            content_hash TEXT DEFAULT '',
            synced_at TEXT,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(source_table, source_id)
        );
        INSERT INTO pump_shell_templates(id, shell_model) VALUES (7, 'V750 大脚板 2寸');
        INSERT INTO recipes(id, name, spec, template_id, parts_json, updated_at, deleted_at) VALUES
            (1, 'V750 菲律宾', '50Hz', 7, '[]', '2026-01-01', NULL),
            (2, 'V750 越南', '60Hz', 7, '[{"name":"说明书","packingRole":"fixed"}]', '2026-01-01', NULL),
            (3, 'V750 删除', '', 7, '[]', '2026-01-01', '2026-01-01'),
            (4, 'V750 特殊', '', 7, '[]', '2026-01-01', NULL),
            (5, 'V750 忽略', '', 7, '[]', '2026-01-01', NULL);
    `);
    const safeInsert = (table, values) => {
        const columns = Object.keys(values);
        return db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
    };
    const safeUpdate = (table, id, values) => {
        const columns = Object.keys(values);
        db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ?
            WHERE id = ?
        `).run(...columns.map(column => values[column]), new Date().toISOString(), id);
    };
    const hardDelete = (table, id) => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return { db, safeInsert, safeUpdate, hardDelete };
}

function insertFeedback(db, recipeId, overrides = {}) {
    db.prepare(`
        INSERT INTO recipe_analysis_feedback(
            recipe_id, finding_key, finding_type, decision, note,
            finding_snapshot_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        recipeId,
        overrides.findingKey || 'peer_pattern:包装:fixed',
        overrides.findingType || 'peer_pattern',
        overrides.decision || 'confirmed',
        overrides.note || '',
        JSON.stringify({ title: overrides.title || '同类配方通常包含「说明书」' }),
        '2026-01-01',
        '2026-01-02'
    );
}

test('候选规则只归纳同模板至少两个配方确认的同类高频项', () => {
    const rows = [
        { id: 1, recipe_id: 1, recipe_name: 'A', template_id: 7, template_name: 'V750', finding_key: 'peer_pattern:包装:fixed', finding_type: 'peer_pattern', decision: 'confirmed', finding_snapshot_json: '{"title":"通常有说明书"}' },
        { id: 2, recipe_id: 2, recipe_name: 'B', template_id: 7, template_name: 'V750', finding_key: 'peer_pattern:包装:fixed', finding_type: 'peer_pattern', decision: 'confirmed', finding_snapshot_json: '{"title":"通常有说明书"}' },
        { id: 3, recipe_id: 3, recipe_name: 'C', template_id: 7, template_name: 'V750', finding_key: 'catalog:202', finding_type: 'catalog_price_difference', decision: 'confirmed' },
    ];
    const groups = buildRuleCandidateGroups(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].evidenceCount, 2);
    assert.equal(groups[0].scopeRef, '7');
    assert.match(groups[0].content, /2 个不同配方/);
});

test('候选规则同时统计确认、特殊情况和忽略证据并计算置信度', () => {
    const rows = [
        { id: 1, recipe_id: 1, recipe_name: 'A', template_id: 7, template_name: 'V750', finding_key: 'peer_pattern:包装:fixed', finding_type: 'peer_pattern', decision: 'confirmed', finding_snapshot_json: '{"title":"通常有说明书"}' },
        { id: 2, recipe_id: 2, recipe_name: 'B', template_id: 7, template_name: 'V750', finding_key: 'peer_pattern:包装:fixed', finding_type: 'peer_pattern', decision: 'confirmed', finding_snapshot_json: '{"title":"通常有说明书"}' },
        { id: 3, recipe_id: 4, recipe_name: 'C', template_id: 7, template_name: 'V750', finding_key: 'peer_pattern:包装:fixed', finding_type: 'peer_pattern', decision: 'special_case', finding_snapshot_json: '{"title":"通常有说明书"}' },
        { id: 4, recipe_id: 5, recipe_name: 'D', template_id: 7, template_name: 'V750', finding_key: 'peer_pattern:包装:fixed', finding_type: 'peer_pattern', decision: 'ignored', finding_snapshot_json: '{"title":"通常有说明书"}' },
    ];
    const groups = buildRuleCandidateGroups(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].supportCount, 2);
    assert.equal(groups[0].specialCaseCount, 1);
    assert.equal(groups[0].ignoredCount, 1);
    assert.equal(groups[0].confidenceScore, 0.571);
    assert.equal(groups[0].confidenceLevel, 'low');
    assert.equal(groups[0].learningEvidence.specialCases[0].recipeId, 4);
    assert.match(groups[0].content, /置信度 57%/);
    assert.deepEqual(confidenceForEvidence(3, 0, 0), { score: 1, level: 'high' });
    assert.equal(factoryRuleApprovalGate(2, 0.65).eligible, true);
    assert.deepEqual(factoryRuleApprovalGate(1, 0.5).blockers, [
        '至少需要 2 个不同配方确认',
        '当前置信度 50%，低于 65%',
    ]);
});

test('候选规则可刷新、批准且保留证据', () => {
    const fixture = createFixture();
    try {
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2, { note: '已补说明书' });
        insertFeedback(fixture.db, 3);
        const refreshed = refreshFactoryRuleCandidates(fixture);
        assert.equal(refreshed.stats.created, 1);
        assert.equal(refreshed.candidates[0].evidenceCount, 2);
        assert.equal(refreshed.candidates[0].supportCount, 2);
        assert.equal(refreshed.candidates[0].confidenceScore, 1);
        assert.equal(refreshed.candidates[0].confidenceLevel, 'medium');
        assert.deepEqual(refreshed.candidates[0].evidence.map(item => item.recipeId).sort(), [1, 2]);

        const approved = reviewFactoryRuleCandidate(refreshed.candidates[0].id, {
            status: 'approved',
            reviewNote: '作为 V750 默认复核规则',
        }, fixture);
        assert.equal(approved.status, 'approved');
        assert.ok(approved.approvedAt);
        assert.equal(approved.reviewNote, '作为 V750 默认复核规则');
        assert.equal(approved.knowledgeSync.action, 'inserted');
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) AS count FROM knowledge_entries
                WHERE source_table = 'factory_rule_candidates' AND source_id = ?
            `).get(String(approved.id)).count,
            1
        );
        fixture.db.prepare(`
            DELETE FROM knowledge_entries
            WHERE source_table = 'factory_rule_candidates' AND source_id = ?
        `).run(String(approved.id));
        refreshFactoryRuleCandidates(fixture);
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) AS count FROM knowledge_entries
                WHERE source_table = 'factory_rule_candidates' AND source_id = ?
            `).get(String(approved.id)).count,
            1,
            '重新核对规则应补齐历史已批准规则的知识条目'
        );
        assert.deepEqual(
            listFactoryRuleEvents({ ...fixture, candidateId: approved.id }).map(event => event.eventType),
            ['approved', 'created']
        );
    } finally {
        fixture.db.close();
    }
});

test('规则生命周期只记录真实证据变化并支持按规则过滤', () => {
    const fixture = createFixture();
    try {
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2);
        const first = refreshFactoryRuleCandidates({ ...fixture, actor: 'admin' });
        const candidateId = first.candidates[0].id;
        refreshFactoryRuleCandidates({ ...fixture, actor: 'admin' });
        assert.deepEqual(
            listFactoryRuleEvents({ ...fixture, candidateId }).map(event => event.eventType),
            ['created']
        );

        insertFeedback(fixture.db, 4, {
            decision: 'special_case',
            note: '客户不需要说明书',
        });
        refreshFactoryRuleCandidates({ ...fixture, actor: 'admin' });
        const events = listFactoryRuleEvents({ ...fixture, candidateId, limit: 10 });
        assert.deepEqual(events.map(event => event.eventType), ['evidence_changed', 'created']);
        assert.equal(events[0].actor, 'admin');
        assert.equal(events[0].snapshot.specialCaseCount, 1);
        assert.equal(listFactoryRuleEvents({ ...fixture, candidateId: 999 }).length, 0);
        assert.throws(
            () => listFactoryRuleEvents({ ...fixture, candidateId: 'bad' }),
            /必须是正整数/
        );
    } finally {
        fixture.db.close();
    }
});

test('规则可恢复历史审核状态但保留当前学习证据', () => {
    const fixture = createFixture();
    try {
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2);
        const refreshed = refreshFactoryRuleCandidates(fixture);
        const approved = reviewFactoryRuleCandidate(refreshed.candidates[0].id, {
            status: 'approved',
            reviewNote: '初次批准',
        }, fixture);
        const approvedEvent = listFactoryRuleEvents({
            ...fixture,
            candidateId: approved.id,
        }).find(event => event.eventType === 'approved');

        insertFeedback(fixture.db, 5, {
            decision: 'ignored',
            note: '当前客户不放说明书',
        });
        const relearned = refreshFactoryRuleCandidates(fixture).candidates
            .find(candidate => candidate.id === approved.id);
        const currentLearningHash = relearned.learningHash;
        reviewFactoryRuleCandidate(approved.id, {
            status: 'rejected',
            reviewNote: '误操作驳回',
        }, fixture);

        const restored = restoreFactoryRuleEvent(approvedEvent.id, {
            restoreNote: '恢复误驳前的批准状态',
        }, fixture);
        assert.equal(restored.candidate.status, 'approved');
        assert.equal(restored.candidate.reviewNote, '恢复误驳前的批准状态');
        assert.equal(restored.candidate.ignoredCount, 1);
        assert.equal(restored.candidate.learningHash, currentLearningHash);
        assert.equal(restored.candidate.reviewedLearningHash, currentLearningHash);
        assert.equal(restored.knowledgeSync.action, 'inserted');
        assert.match(
            fixture.db.prepare(`
                SELECT content FROM knowledge_entries
                WHERE source_table = 'factory_rule_candidates' AND source_id = ?
            `).get(String(approved.id)).content,
            /忽略 1/
        );
        assert.deepEqual(
            listFactoryRuleEvents({ ...fixture, candidateId: approved.id })
                .slice(0, 3)
                .map(event => event.eventType),
            ['restored', 'rejected', 'evidence_changed']
        );
        assert.throws(
            () => restoreFactoryRuleEvent(approvedEvent.id, {}, fixture),
            /当前已经是 approved 状态/
        );
    } finally {
        fixture.db.close();
    }
});

test('规则历史恢复重新校验证据且失败时整体回滚', () => {
    const fixture = createFixture();
    try {
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2);
        const refreshed = refreshFactoryRuleCandidates(fixture);
        const approved = reviewFactoryRuleCandidate(refreshed.candidates[0].id, {
            status: 'approved',
        }, fixture);
        const approvedEvent = listFactoryRuleEvents({
            ...fixture,
            candidateId: approved.id,
        }).find(event => event.eventType === 'approved');
        reviewFactoryRuleCandidate(approved.id, { status: 'rejected' }, fixture);
        const eventCountBeforeFailure = listFactoryRuleEvents({
            ...fixture,
            candidateId: approved.id,
        }).length;

        assert.throws(
            () => restoreFactoryRuleEvent(approvedEvent.id, {}, {
                ...fixture,
                syncFactoryRuleKnowledgeEntry: () => {
                    throw new Error('恢复知识同步失败');
                },
            }),
            /恢复知识同步失败/
        );
        assert.equal(
            fixture.db.prepare('SELECT status FROM factory_rule_candidates WHERE id = ?')
                .get(approved.id).status,
            'rejected'
        );
        assert.equal(
            listFactoryRuleEvents({ ...fixture, candidateId: approved.id }).length,
            eventCountBeforeFailure
        );

        fixture.db.prepare(`
            UPDATE recipe_analysis_feedback
            SET decision = 'review', updated_at = '2026-02-01'
            WHERE recipe_id = 2
        `).run();
        refreshFactoryRuleCandidates(fixture);
        assert.throws(
            () => restoreFactoryRuleEvent(approvedEvent.id, {}, fixture),
            /不满足批准门槛/
        );
        assert.equal(
            fixture.db.prepare('SELECT status FROM factory_rule_candidates WHERE id = ?')
                .get(approved.id).status,
            'rejected'
        );
    } finally {
        fixture.db.close();
    }
});

test('规则状态与生命周期事件在写入失败时整体回滚', () => {
    const fixture = createFixture();
    try {
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2);
        const failingInsert = (table, values) => {
            if (table === 'factory_rule_events') throw new Error('事件写入失败');
            return fixture.safeInsert(table, values);
        };
        assert.throws(
            () => refreshFactoryRuleCandidates({ ...fixture, safeInsert: failingInsert }),
            /事件写入失败/
        );
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM factory_rule_candidates').get().count,
            0
        );

        const refreshed = refreshFactoryRuleCandidates(fixture);
        assert.throws(
            () => reviewFactoryRuleCandidate(
                refreshed.candidates[0].id,
                { status: 'approved' },
                { ...fixture, safeInsert: failingInsert }
            ),
            /事件写入失败/
        );
        assert.equal(
            fixture.db.prepare('SELECT status FROM factory_rule_candidates WHERE id = ?')
                .get(refreshed.candidates[0].id).status,
            'candidate'
        );
        assert.throws(
            () => reviewFactoryRuleCandidate(
                refreshed.candidates[0].id,
                { status: 'approved' },
                {
                    ...fixture,
                    syncFactoryRuleKnowledgeEntry: () => {
                        throw new Error('规则知识同步失败');
                    },
                }
            ),
            /规则知识同步失败/
        );
        assert.equal(
            fixture.db.prepare('SELECT status FROM factory_rule_candidates WHERE id = ?')
                .get(refreshed.candidates[0].id).status,
            'candidate'
        );
        assert.deepEqual(
            listFactoryRuleEvents({ ...fixture, candidateId: refreshed.candidates[0].id })
                .map(event => event.eventType),
            ['created']
        );
    } finally {
        fixture.db.close();
    }
});

test('规则影响分析区分已符合、待复核、特殊情况和忽略配方', () => {
    const fixture = createFixture();
    try {
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2);
        insertFeedback(fixture.db, 4, { decision: 'special_case', note: '出口客户不放说明书' });
        insertFeedback(fixture.db, 5, { decision: 'ignored', note: '暂不处理' });
        const refreshed = refreshFactoryRuleCandidates(fixture);
        const impact = buildFactoryRuleImpact(refreshed.candidates[0].id, fixture);

        assert.equal(impact.scope.templateId, 7);
        assert.equal(impact.scope.requiredRole, '包装:fixed');
        assert.deepEqual(impact.summary, {
            totalRecipes: 4,
            compliantCount: 1,
            needsReviewCount: 1,
            specialCaseCount: 1,
            ignoredCount: 1,
            attentionRate: 0.25,
        });
        assert.equal(impact.groups.compliant[0].recipeName, 'V750 越南');
        assert.equal(impact.groups.needsReview[0].recipeName, 'V750 菲律宾');
        assert.equal(impact.groups.specialCases[0].recipeName, 'V750 特殊');
        assert.equal(impact.groups.ignored[0].recipeName, 'V750 忽略');
        assert.match(impact.guidance, /1 个现有配方需要复核/);
    } finally {
        fixture.db.close();
    }
});

test('规则执行监控汇总全部已批准规则和受影响配方', () => {
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            INSERT INTO recipes(id, name, spec, template_id, parts_json, updated_at, deleted_at)
            VALUES (6, 'V750 支持', '', 7, '[{"name":"说明书","packingRole":"fixed"}]', '2026-01-01', NULL)
        `).run();
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2);
        insertFeedback(fixture.db, 6);
        insertFeedback(fixture.db, 4, { decision: 'special_case' });
        insertFeedback(fixture.db, 5, { decision: 'ignored' });
        const refreshed = refreshFactoryRuleCandidates(fixture);
        reviewFactoryRuleCandidate(refreshed.candidates[0].id, { status: 'approved' }, fixture);

        const compliance = buildFactoryRuleCompliance(fixture);
        assert.deepEqual(compliance.summary, {
            approvedRuleCount: 1,
            rulesWithViolations: 1,
            rulesNeedingEvidenceReview: 0,
            affectedRecipeCount: 1,
            ruleViolationCount: 1,
            exceptionCount: 2,
            checkedRecipeRulePairs: 5,
        });
        assert.equal(compliance.rules[0].status, 'attention');
        assert.equal(compliance.affectedRecipes[0].recipeName, 'V750 菲律宾');
        assert.deepEqual(compliance.affectedRecipes[0].ruleIds, [refreshed.candidates[0].id]);
        assert.match(compliance.guidance, /1 个配方涉及 1 条已批准规则/);
    } finally {
        fixture.db.close();
    }
});

test('已批准规则失去最低支持证据后自动转为失效', () => {
    const fixture = createFixture();
    try {
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2);
        const refreshed = refreshFactoryRuleCandidates(fixture);
        const approved = reviewFactoryRuleCandidate(refreshed.candidates[0].id, { status: 'approved' }, fixture);
        assert.equal(approved.status, 'approved');

        fixture.db.prepare(`
            UPDATE recipe_analysis_feedback
            SET decision = 'review', updated_at = '2026-02-01'
            WHERE recipe_id = 2
        `).run();
        const relearned = refreshFactoryRuleCandidates(fixture);
        const stale = relearned.candidates.find(item => item.id === approved.id);
        assert.equal(stale.status, 'stale');
        assert.equal(stale.supportCount, 0);
        assert.equal(relearned.stats.stale, 1);
        assert.equal(
            listFactoryRuleEvents({ ...fixture, candidateId: approved.id })[0].eventType,
            'stale'
        );
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) AS count FROM knowledge_entries
                WHERE source_table = 'factory_rule_candidates' AND source_id = ?
            `).get(String(approved.id)).count,
            0
        );
    } finally {
        fixture.db.close();
    }
});

test('已批准规则出现新反例时进入复核队列，重新批准后完成确认', () => {
    const fixture = createFixture();
    try {
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2);
        const refreshed = refreshFactoryRuleCandidates(fixture);
        const approved = reviewFactoryRuleCandidate(refreshed.candidates[0].id, { status: 'approved' }, fixture);
        assert.equal(approved.needsReview, false);

        insertFeedback(fixture.db, 5, { decision: 'ignored', note: '该客户不需要说明书' });
        const relearned = refreshFactoryRuleCandidates(fixture);
        const needsReview = relearned.candidates.find(item => item.id === approved.id);
        assert.equal(needsReview.status, 'approved');
        assert.equal(needsReview.ignoredCount, 1);
        assert.equal(needsReview.needsReview, true);
        assert.match(
            fixture.db.prepare(`
                SELECT content FROM knowledge_entries
                WHERE source_table = 'factory_rule_candidates' AND source_id = ?
            `).get(String(approved.id)).content,
            /忽略 1/
        );

        const reviewed = reviewFactoryRuleCandidate(approved.id, {
            status: 'approved',
            reviewNote: '已确认该规则允许客户例外',
        }, fixture);
        assert.equal(reviewed.needsReview, false);
    } finally {
        fixture.db.close();
    }
});

test('低置信度候选不能批准，已批准规则跌破门槛后自动撤回', () => {
    const fixture = createFixture();
    try {
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2);
        const refreshed = refreshFactoryRuleCandidates(fixture);
        const approved = reviewFactoryRuleCandidate(refreshed.candidates[0].id, {
            status: 'approved',
        }, fixture);
        assert.equal(approved.approvalEligible, true);

        insertFeedback(fixture.db, 4, { decision: 'ignored', note: '特殊订单不放说明书' });
        insertFeedback(fixture.db, 5, { decision: 'ignored', note: '客户明确不需要' });
        assert.throws(
            () => refreshFactoryRuleCandidates({
                ...fixture,
                syncFactoryRuleKnowledgeEntry: () => {
                    throw new Error('自动撤回知识同步失败');
                },
            }),
            /自动撤回知识同步失败/
        );
        assert.equal(
            fixture.db.prepare('SELECT status FROM factory_rule_candidates WHERE id = ?')
                .get(approved.id).status,
            'approved'
        );
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) AS count FROM knowledge_entries
                WHERE source_table = 'factory_rule_candidates' AND source_id = ?
            `).get(String(approved.id)).count,
            1
        );
        assert.equal(
            listFactoryRuleEvents({ ...fixture, candidateId: approved.id })[0].eventType,
            'approved'
        );

        const relearned = refreshFactoryRuleCandidates(fixture);
        const suspended = relearned.candidates.find(candidate => candidate.id === approved.id);
        assert.equal(relearned.stats.suspended, 1);
        assert.equal(suspended.status, 'candidate');
        assert.equal(suspended.confidenceScore, 0.5);
        assert.equal(suspended.approvalEligible, false);
        assert.match(suspended.approvalBlockers[0], /低于 65%/);
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) AS count FROM knowledge_entries
                WHERE source_table = 'factory_rule_candidates' AND source_id = ?
            `).get(String(approved.id)).count,
            0
        );
        assert.equal(
            listFactoryRuleEvents({ ...fixture, candidateId: approved.id })[0].eventType,
            'approval_suspended'
        );
        assert.throws(
            () => reviewFactoryRuleCandidate(approved.id, { status: 'approved' }, fixture),
            /置信度 50%，低于 65%/
        );
    } finally {
        fixture.db.close();
    }
});

test('证据不足的候选规则不能批准', () => {
    const fixture = createFixture();
    try {
        fixture.safeInsert('factory_rule_candidates', {
            rule_key: 'template:7:peer_pattern:测试',
            title: '测试',
            content: '测试',
            scope_type: 'pump_shell_template',
            scope_ref: '7',
            finding_key: 'peer_pattern:测试',
            finding_type: 'peer_pattern',
            evidence_count: 1,
            evidence_json: '[]',
            support_count: 1,
            special_case_count: 0,
            ignored_count: 0,
            confidence_score: 1,
            learning_evidence_json: '{}',
            learning_hash: '',
            reviewed_learning_hash: '',
            status: 'candidate',
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
        });
        assert.throws(
            () => reviewFactoryRuleCandidate(1, { status: 'approved' }, fixture),
            /至少需要 2 个不同配方/
        );
    } finally {
        fixture.db.close();
    }
});
