'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dbAccessors = require('../api/db.cjs');
const policyStore = require('../api/services/ai-assistant/domainPolicyStore.cjs');
const { attachmentContext, buildInvestigationContext, renderInvestigationContext } = require('../api/services/ai-assistant/context.cjs');
const { runAiAssistant } = require('../api/services/ai-assistant/runtime.cjs');

function resetPolicy() {
    dbAccessors.db.exec('DELETE FROM domain_policy_audit; DELETE FROM domain_policy_drafts; DELETE FROM domain_policy_versions;');
}
function judgeOutput() { return JSON.stringify({ mode: 'GENERAL', goal: '说明', questions: ['说明'], constraints: [], persistentMutation: false, needsClarification: false, clarificationReason: null, appliedPolicyIds: ['RULE-01'], domains: ['general'] }); }
function mainAnswer() { return { choices: [{ message: { content: '已依据正式工具核验。' } }] }; }

test('Domain Policy draft, publish, immutable history, diff, rollback, audit and stale protection are deterministic', () => {
    resetPolicy();
    const initial = policyStore.getCurrentPolicy();
    assert.equal(initial.published.version, 1);
    const firstSnapshot = policyStore.getPublishedPolicySnapshot();
    const saved = policyStore.saveDraft({ content: `${initial.draft.content}\n- 回答先给结论。`, expectedVersion: initial.draft.version }, { actor: 'owner-test' });
    assert.equal(policyStore.getPublishedPolicySnapshot().policyContent, firstSnapshot.policyContent, 'draft cannot affect runtime');
    assert.throws(() => policyStore.saveDraft({ content: 'x', expectedVersion: initial.draft.version }, { actor: 'owner-test' }), error => error.code === 'DOMAIN_POLICY_CONFLICT');
    const diff = policyStore.getDiff({ from: initial.published.id, to: 'draft' });
    assert.ok(diff.changes.length > 0);
    assert.throws(() => policyStore.publishDraft({ expectedDraftVersion: saved.version, expectedPublishedVersion: 999 }, { actor: 'owner-test' }), error => error.code === 'DOMAIN_POLICY_CONFLICT');
    const published = policyStore.publishDraft({ expectedDraftVersion: saved.version, expectedPublishedVersion: initial.published.version, reason: 'policy test' }, { actor: 'owner-test' });
    assert.equal(published.version, 2);
    assert.match(policyStore.getPublishedPolicySnapshot().policyContent, /回答先给结论/);
    const history = policyStore.listVersions();
    assert.deepEqual(history.map(item => [item.version, item.status]), [[2, 'PUBLISHED'], [1, 'SUPERSEDED']]);
    const rollback = policyStore.rollbackPolicy({ versionId: initial.published.id, expectedPublishedVersion: published.version, reason: 'restore test' }, { actor: 'owner-test' });
    assert.equal(rollback.version, 3);
    assert.equal(policyStore.listVersions().length, 3);
    assert.equal(policyStore.getPublishedPolicySnapshot().policyContent, initial.published.content);
    assert.ok(policyStore.listAudit().some(item => item.action === 'PUBLISHED'));
    assert.ok(policyStore.listAudit().some(item => item.action === 'ROLLED_BACK'));
    assert.throws(() => policyStore.saveDraft({ content: ' ', expectedVersion: policyStore.getCurrentPolicy().draft.version }, { actor: 'owner-test' }), error => error.code === 'DOMAIN_POLICY_EMPTY');
});

test('attachment context is bounded, parser failures are explicit, and page context remains non-formal investigation context', () => {
    const files = new Map([
        [1, { id: 1, originalName: 'report.pdf', detectedType: 'pdf', parserStatus: 'parsed', parserSummary: '报告摘要' }],
        [2, { id: 2, originalName: 'sheet.xlsx', detectedType: 'spreadsheet', parserStatus: 'parsed', parserSummary: '表格摘要' }],
        [3, { id: 3, originalName: 'note.txt', detectedType: 'text', parserStatus: 'parsed', parserSummary: '文字摘要' }],
        [4, { id: 4, originalName: 'image.png', detectedType: 'image', parserStatus: 'parsed', parserSummary: 'OCR 摘要' }],
        [5, { id: 5, originalName: 'failed.pdf', detectedType: 'pdf', parserStatus: 'failed', parserSummary: '' }],
    ]);
    const content = new Map([
        [1, { parserStatus: 'parsed', parsedText: 'x'.repeat(4_000) }],
        [2, { parserStatus: 'parsed', parsedText: '电子表格正式内容' }],
        [3, { parserStatus: 'parsed', parsedText: '纯文本正式内容' }],
        [4, { parserStatus: 'parsed', parsedText: '图片 OCR 内容' }],
        [5, { parserStatus: 'failed', parsedText: '', parserError: 'parser unavailable' }],
    ]);
    const attachments = attachmentContext([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }], { getFactoryFile: id => files.get(id), getFactoryFileContent: id => content.get(id) });
    assert.equal(attachments[0].contentExcerpt.length, 2_000);
    assert.equal(attachments.length, 4, 'attachment count remains bounded');
    assert.equal(attachments[1].detectedType, 'spreadsheet');
    assert.equal(attachments[2].detectedType, 'text');
    assert.equal(attachments[3].detectedType, 'image');
    const failed = attachmentContext([{ id: 5 }], { getFactoryFile: id => files.get(id), getFactoryFileContent: id => content.get(id) });
    assert.match(failed[0].availability, /解析失败/);
    const context = buildInvestigationContext({ pageContext: { resourceType: 'recipe', resourceId: 12, path: '/recipes/12', view: 'detail' } }, { getFactoryFile: () => null, getFactoryFileContent: () => null });
    assert.deepEqual(context.pageContext, { resourceType: 'recipe', resourceId: 12, path: '/recipes/12', view: 'detail' });
    assert.match(renderInvestigationContext({ attachments, pageContext: context.pageContext }), /不是正式业务事实/);
});

test('runtime freezes one published policy snapshot and gives the same versioned context to Judge and Main Agent', async () => {
    const seen = [];
    const response = await runAiAssistant({ userMessage: '这个现在成本多少？', pageContext: { resourceType: 'recipe', resourceId: 12, path: '/recipes/12', view: 'detail' } }, {
        policySnapshot: { policyVersion: 42, policyContent: '规则：先结论。' },
        contextBuilder: () => ({ attachments: [{ fileId: 1, filename: 'report.pdf', availability: 'parsed', contentExcerpt: '附件内容' }], pageContext: { resourceType: 'recipe', resourceId: 12, path: '/recipes/12', view: 'detail' } }),
        judgeModelCall: async messages => { seen.push({ stage: 'judge', messages }); return { choices: [{ message: { content: judgeOutput() } }] }; },
        mainModelCall: async messages => { seen.push({ stage: 'main', messages }); return mainAnswer(); },
    });
    assert.equal(response.policyVersion, 42);
    assert.equal(seen.length, 2);
    for (const call of seen) {
        assert.match(call.messages[0].content, /版本：42/);
        assert.ok(call.messages.some(message => /调查上下文/.test(message.content)));
        assert.ok(call.messages.some(message => /不是正式业务事实/.test(message.content)));
    }
});
