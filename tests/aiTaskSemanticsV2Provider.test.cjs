'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXTRACTION_TOOL, parseProviderCandidate, rebindCandidate, extractTaskSemanticsV2, admitGoalsV1 } = require('../api/services/aiTaskSemanticsV2.cjs');

const candidate = { proposal: { version: 1, goalSummary: 'V550成本和库存', subjects: [{ subjectKey: 'subject_1', mention: 'V550', typeHints: ['recipe'], sources: [{ sourceQuote: 'V550' }] }], scenarios: [], goals: [{ goalKey: 'goal_1', kind: 'CURRENT_COST', description: '当前成本', subjectKeys: ['subject_1'], scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [{ sourceQuote: 'V550' }], quantity: null, unitPrice: null }, { goalKey: 'goal_2', kind: 'INVENTORY_QUERY', description: '库存', subjectKeys: ['subject_1'], scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [{ sourceQuote: '库存' }], quantity: null, unitPrice: null }], unparsedSpans: [] } };

test('provider protocol accepts one function call or a fenced JSON object and rejects other output forms', () => {
    assert.deepEqual(parseProviderCandidate({ choices: [{ message: { tool_calls: [{ function: { name: EXTRACTION_TOOL.function.name, arguments: JSON.stringify(candidate) } }] } }] }), candidate);
    assert.deepEqual(parseProviderCandidate({ content: `\`\`\`json\n${JSON.stringify(candidate)}\n\`\`\`` }), candidate);
    assert.throws(() => parseProviderCandidate({ content: 'plain prose { }' }), /Unexpected token/);
    assert.throws(() => parseProviderCandidate({ tool_calls: [{ function: { name: 'search_parts', arguments: '{}' } }] }), /PROVIDER_TOOL_NAME/);
    assert.throws(() => parseProviderCandidate({ content: '' }), /PROVIDER_EMPTY/);
});

test('provider protocol unwraps the documented function-argument parameters envelope', () => {
    const wrapped = { parameters: candidate };
    assert.deepEqual(parseProviderCandidate({
        tool_calls: [{ function: { name: EXTRACTION_TOOL.function.name, arguments: JSON.stringify(wrapped) } }],
    }), candidate);
});

test('server rebinds provider quotes with the authoritative JS UTF-16 source and refuses ambiguous quotes', () => {
    const text = '😊 V550成本和库存';
    const rebound = rebindCandidate(candidate, 'm-1', text);
    assert.equal(rebound.subjects[0].sources[0].start, text.indexOf('V550'));
    assert.equal(text.slice(rebound.subjects[0].sources[0].start, rebound.subjects[0].sources[0].end), 'V550');
    const ambiguous = rebindCandidate(candidate, 'm-1', 'V550 和 V550 成本和库存');
    assert.deepEqual(ambiguous.subjects[0].sources, []);
});

test('unknown fields, source binding loss, provider errors and timeouts remain partial without format retries', async () => {
    const bad = structuredClone(candidate); bad.proposal.goals[0].canonicalId = 12;
    for (const response of [{ content: JSON.stringify(bad) }, { content: JSON.stringify(candidate) }]) {
        const text = response === undefined ? 'V550成本和库存' : 'V550 和 V550 成本和库存';
        const result = await extractTaskSemanticsV2({ messageRef: 'm-1', text, provider: async () => response });
        assert.equal(result.status, 'PARTIAL');
        assert.equal(result.telemetry.modelCalls, 1);
        assert.equal(result.telemetry.formatRepairCalls, 1);
    }
    for (const error of [new Error('provider 500'), new Error('timeout')]) {
        const result = await extractTaskSemanticsV2({ messageRef: 'm-1', text: 'V550成本和库存', provider: async () => { throw error; } });
        assert.equal(result.status, 'PARTIAL');
        assert.equal(result.telemetry.modelCalls, 0);
        assert.equal(result.telemetry.formatRepairCalls, 0);
    }
});


test('Goal Admission rejects a model-extra profitability candidate without user profitability intent', () => {
    const proposal = { goals: [{ goalKey: 'goal_profit', kind: 'PROFITABILITY', sources: [] }] };
    const admissions = admitGoalsV1(proposal, { messageRef: 'm-1', text: 'V550成本多少，卖340元一台', fallbackProposal: { goals: [{ goalKey: 'other', kind: 'OTHER' }] } });
    assert.equal(proposal.goals.some(goal => goal.kind === 'PROFITABILITY'), false);
    assert.equal(admissions[0].admissionCode, 'REJECTED_UNGROUNDED_MODEL_EXTRA');
});

test('Goal Admission retains explicit profitability intent without price as an admitted candidate', async () => {
    const explicit = structuredClone(candidate); explicit.proposal.goals = [{ goalKey: 'goal_profit', kind: 'PROFITABILITY', description: 'profit', subjectKeys: ['subject_1'], scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [{ sourceQuote: 'V550' }], quantity: null, unitPrice: null }];
    const result = await extractTaskSemanticsV2({ messageRef: 'm-1', text: 'V550利润怎么样？', provider: async () => ({ tool_calls: [{ function: { name: EXTRACTION_TOOL.function.name, arguments: JSON.stringify(explicit) } }] }) });
    assert.equal(result.proposal.goals[0].kind, 'PROFITABILITY');
    assert.equal(result.goalAdmissions[0].admissionCode, 'ADMITTED_EXPLICIT_USER_INTENT');
});
