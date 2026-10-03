'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JudgeError, runJudge, validateJudgeOutput } = require('../api/services/ai-assistant/judge.cjs');
const { executeAgentTool, formalProfitabilityArgs } = require('../api/services/ai-assistant/agentTools.cjs');
const { MainAgentError } = require('../api/services/ai-assistant/mainAgent.cjs');
const { runAiAssistant } = require('../api/services/ai-assistant/runtime.cjs');

const INPUT = 'V550电缆改成5米，卖340元，毛利多少？先不要保存。';
const previewJudge = Object.freeze({
    mode: 'ANALYZE',
    goal: '试算 V550 电缆临时改为 5 米、售价 340 元时的毛利',
    questions: ['V550 临时方案成本和毛利是多少？'],
    constraints: ['V550', '电缆长度 5 米', '售价 340 CNY', '不保存'],
    persistentMutation: false,
    needsClarification: false,
    clarificationReason: null,
    appliedPolicyIds: ['RULE-01', 'RULE-05', 'RULE-08'],
    domains: ['recipe', 'cost'],
});

function response(message) {
    return { choices: [{ message }] };
}

function toolCall(name, args, id) {
    return response({ content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
}

function formalToolResult(name, args) {
    if (name === 'get_all_recipes') {
        assert.deepEqual(args, { keyword: 'V550' });
        return {
            success: true,
            data: [{ id: 55, name: 'V550', spec: '2-inch', updatedAt: '2026-09-29T00:00:00.000Z', partsJson: '["internal"]' }],
            executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/recipes?keyword=V550' }] },
        };
    }
    assert.equal(name, 'preview_profitability');
    assert.equal(args.basisRef.recipeId, 55);
    assert.equal(args.basisRef.comparisonInput.scenarios[0].overrides.cableLength, 5);
    assert.equal(args.unitPrice, 340);
    assert.equal(args.currency, 'CNY');
    return {
        success: true,
        data: {
            costComplete: true,
            unitCost: 281.25,
            grossProfitPerUnit: 58.75,
            grossMarginOnSales: 0.1728,
            markupOnCost: 0.2089,
            currency: 'CNY',
            costBasis: 'CURRENT_REBUILT_SCENARIO',
            scenarioKey: 'candidate',
            unitPrice: 340,
            profitabilityId: 'internal-profitability-id',
            configurationHash: 'internal-configuration-hash',
            readSetId: 'internal-read-set',
            scenarioContext: { internal: true },
            comparison: { internal: true },
        },
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'POST', path: '/api/cost/profitability-preview' }] },
    };
}

function finalEnvelope(messages, answer, status = 'COMPLETED') {
    const factIds = messages.filter(message => message.role === 'tool')
        .flatMap(message => JSON.parse(message.content).factRefs || []);
    return JSON.stringify({
        answer,
        claims: factIds.length ? [{ text: answer, factIds }] : [],
        goals: [{ questionIndex: 0, status, factIds }],
    });
}

function mainSequence(answerFactory) {
    let index = 0;
    return async (messages, options) => {
        index += 1;
        if (index === 1) return toolCall('resolve_entity', { entityType: 'recipe', mention: 'V550' }, 'tool-recipe');
        if (index === 2) return toolCall('preview_profitability', formalProfitabilityArgs({ recipeId: 55, cableLength: 5, unitPrice: 340 }), 'tool-profit');
        assert.equal(index, 3);
        return response({ content: finalEnvelope(messages, answerFactory(messages, options)) });
    };
}

async function resolveRecipe(input) {
    assert.deepEqual(input, { entityType: 'recipe', mention: 'V550', signal: undefined });
    return { entityType: 'recipe', mention: 'V550', status: 'RESOLVED', canonicalId: '55', canonicalName: 'V550', candidates: [], source: 'formal', verified: true, matchKind: 'EXACT' };
}

function judgeModel(output = previewJudge) {
    return async () => response({ content: JSON.stringify(output) });
}

test('Judge classifies the preview and persistent contrast without GoalKind', async () => {
    const preview = await runJudge({ userMessage: INPUT }, { modelCall: judgeModel() });
    assert.equal(preview.output.mode, 'ANALYZE');
    assert.equal(preview.output.persistentMutation, false);
    assert.deepEqual(preview.output.constraints, previewJudge.constraints);
    const persistent = await runJudge({ userMessage: '把V550电缆正式改成5米并保存。' }, {
        modelCall: judgeModel({
            ...previewJudge,
            mode: 'PERSIST_MUTATION',
            goal: '正式保存 V550 电缆长度为 5 米',
            constraints: ['V550', '正式保存'],
            persistentMutation: true,
            appliedPolicyIds: ['RULE-01', 'RULE-02'],
        }),
    });
    assert.equal(persistent.output.mode, 'PERSIST_MUTATION');
    assert.equal(persistent.output.persistentMutation, true);
    assert.throws(
        () => validateJudgeOutput({ ...previewJudge, mode: 'PERSIST_MUTATION', persistentMutation: false }),
        error => error instanceof JudgeError && error.code === 'JUDGE_SCHEMA_INVALID'
    );
});

test('Judge contract keeps formal identity resolution and protected confirmation out of user clarification', async () => {
    const calls = [];
    await runJudge({ userMessage: '把某正式库存增加5并保存。' }, {
        modelCall: async messages => {
            calls.push(messages);
            return response({ content: JSON.stringify({
                ...previewJudge,
                mode: 'PERSIST_MUTATION', persistentMutation: true,
                goal: '正式增加库存', questions: ['将指定正式库存增加 5 并保存'],
                constraints: ['先解析正式身份', '需 Owner 在模型外确认'],
                appliedPolicyIds: ['RULE-02', 'RULE-08'],
            }) });
        },
    });
    assert.match(calls[0][0].content, /正式身份解析、读取当前库存、形成预览，以及 Owner 在模型之外确认，都是系统后续步骤/);
    assert.match(calls[0][0].content, /needsClarification=false/);
});

test('Judge normalizes harmless false clarification metadata without a repair call', async () => {
    let calls = 0;
    const result = await runJudge({ userMessage: INPUT }, {
        modelCall: async () => {
            calls += 1;
            return response({ content: JSON.stringify({ ...previewJudge, clarificationReason: '无需进一步澄清' }) });
        },
    });
    assert.equal(calls, 1);
    assert.equal(result.repaired, false);
    assert.equal(result.output.clarificationReason, null);
});

test('Judge permits exactly one repair while genuine clarification remains strict', async () => {
    let calls = 0;
    const repaired = await runJudge({ userMessage: INPUT }, {
        modelCall: async () => {
            calls += 1;
            return response({ content: calls === 1 ? '{invalid' : JSON.stringify(previewJudge) });
        },
    });
    assert.equal(calls, 2);
    assert.equal(repaired.repaired, true);
    await assert.rejects(
        () => runJudge({ userMessage: INPUT }, { modelCall: async () => response({ content: 'not json' }) }),
        error => error instanceof JudgeError && error.code === 'JUDGE_FORMAT_INVALID'
    );
    let clarificationCalls = 0;
    await assert.rejects(
        () => runJudge({ userMessage: INPUT }, {
            modelCall: async () => {
                clarificationCalls += 1;
                return response({ content: JSON.stringify({
                    ...previewJudge, needsClarification: true, clarificationReason: null,
                }) });
            },
        }),
        error => error instanceof JudgeError && error.code === 'JUDGE_SCHEMA_INVALID'
    );
    assert.equal(clarificationCalls, 2);
});

test('Judge repair retains bounded conversation and repeats the strict contract', async () => {
    const calls = [];
    const result = await runJudge({
        userMessage: '这两个差多少？',
        recentConversation: [
            { role: 'user', content: 'V550现在成本多少？' },
            { role: 'assistant', content: 'V550 当前成本是 268.70 元。' },
            { role: 'user', content: '那V750呢？' },
            { role: 'assistant', content: 'V750 当前成本是 289.01 元。' },
        ],
    }, {
        modelCall: async messages => {
            calls.push(messages);
            return response({ content: calls.length === 1 ? 'V750 比 V550 贵 20.31 元。' : JSON.stringify({
                ...previewJudge,
                mode: 'READ', goal: '比较会话中 V550 与 V750 的当前正式成本',
                questions: ['V550 和 V750 的当前正式成本差多少？'], constraints: ['需正式比较'],
            }) });
        },
    });
    assert.equal(result.repaired, true);
    assert.equal(calls.length, 2);
    assert.match(calls[1][0].content, /必须且只能有/);
    assert.match(calls[1][1].content, /V550现在成本多少/);
});

test('M1 runs the V550 preview through isolated Judge, formal tools and Main Agent answer', async () => {
    const toolCalls = [];
    let businessWrites = 0;
    const result = await runAiAssistant({ userMessage: INPUT }, {
        judgeModelCall: async (messages, options) => {
            assert.equal(options.tools, undefined);
            assert.match(messages[0].content, /不要选择工具/);
            return response({ content: JSON.stringify(previewJudge) });
        },
        mainModelCall: mainSequence((messages, options) => {
            assert.ok(options.tools.some(tool => tool.function.name === 'resolve_entity'));
            assert.ok(options.tools.some(tool => tool.function.name === 'preview_profitability'));
            assert.match(messages[0].content, /自主选择必要工具和顺序/);
            const formal = JSON.parse(messages.at(-1).content);
            assert.equal(formal.data.costBasis, 'CURRENT_REBUILT_SCENARIO');
            assert.equal('configurationHash' in formal.data, false);
            assert.equal(formal.data.unitCost, 281.25);
            assert.equal(formal.data.grossProfitPerUnit, 58.75);
            return 'V550 电缆临时改为 5 米后，成本约 ¥281.25。按售价 ¥340，单台毛利 ¥58.75，毛利率约 17.28%。本次只是试算，没有保存。';
        }),
        executeToolCall: async (name, args, options) => {
            toolCalls.push({ name, args, options });
            assert.equal(options.allowWrite, false);
            if (options.allowWrite) businessWrites += 1;
            return formalToolResult(name, args);
        },
        resolveAgentEntity: resolveRecipe,
    });
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.judge.mode, 'ANALYZE');
    assert.equal(result.judge.persistentMutation, false);
    assert.deepEqual(toolCalls.map(call => call.name), ['preview_profitability']);
    assert.match(result.answer, /¥281\.25/);
    assert.match(result.answer, /没有保存/);
    assert.equal(result.toolResults.length, 2);
    assert.equal(businessWrites, 0);
    assert.equal(result.toolResults[0].agentToolName, 'resolve_entity');
    assert.equal(result.toolResults[0].data.canonicalId, '55');
    assert.equal(result.toolResults[1].data.unitCost, 281.25);
    assert.equal(result.toolResults[1].data.grossProfitPerUnit, 58.75);
    assert.equal('configurationHash' in result.toolResults[1].data, false);
    assert.equal('execution' in result.toolResults[0], false);
    assert.equal('provenance' in result.toolResults[1], false);
});

test('tool failures expose only bounded safe metadata', async () => {
    const result = await executeAgentTool('find_recipe', { keyword: 'V550' }, { resolvedRecipeIds: new Set() }, {
        executeToolCall: async () => ({ success: false, code: 'INTERNAL_BACKEND_PATH', error: 'stack /api/private secret' }),
    });
    assert.deepEqual(result, {
        success: false,
        agentToolName: 'find_recipe',
        verified: false,
        data: null,
        code: 'INTERNAL_BACKEND_PATH',
        category: 'TRANSPORT_UNAVAILABLE',
        recoverable: true,
        message: '正式业务服务暂不可用。',
    });
});

test('formal result mutation reaches Main Agent rather than a hardcoded amount', async () => {
    const result = await runAiAssistant({ userMessage: INPUT }, {
        judgeModelCall: judgeModel(),
        mainModelCall: mainSequence(messages => {
            const formal = JSON.parse(messages.at(-1).content);
            return `正式结果：成本 ¥${formal.data.unitCost}，毛利 ¥${formal.data.grossProfitPerUnit}，本次没有保存。`;
        }),
        executeToolCall: async (name, args) => {
            const result = formalToolResult(name, args);
            result.data.unitCost = 299.99;
            result.data.grossProfitPerUnit = 40.01;
            return result;
        },
        resolveAgentEntity: resolveRecipe,
    });
    assert.match(result.answer, /¥299\.99/);
    assert.match(result.answer, /¥40\.01/);
    assert.doesNotMatch(result.answer, /281\.25|58\.75/);
});

test('tool and Main Agent failures do not enter Task V2 or create writes', async () => {
    const toolFailure = await runAiAssistant({ userMessage: INPUT }, {
        judgeModelCall: judgeModel(),
        mainModelCall: mainSequence(() => '正式工具暂不可用，未能完成试算。'),
        executeToolCall: async (_name, _args) => (
            { success: false, code: 'FORMAL_DOWN', error: 'formal preview unavailable' }
        ),
        resolveAgentEntity: resolveRecipe,
    });
    assert.equal(toolFailure.toolResults.at(-1).success, false);
    await assert.rejects(
        () => runAiAssistant({ userMessage: INPUT }, {
            judgeModelCall: judgeModel(),
            mainModelCall: async () => { throw new Error('provider down'); },
            executeToolCall: formalToolResult,
        }),
        error => error instanceof MainAgentError && error.code === 'MAIN_AGENT_MODEL_FAILED'
    );
    for (const filename of ['judge.cjs', 'mainAgent.cjs', 'agentTools.cjs', 'runtime.cjs']) {
        const source = fs.readFileSync(path.join(__dirname, '..', 'api/services/ai-assistant', filename), 'utf8');
        assert.doesNotMatch(source, /aiTaskSemanticsV2|aiTaskControllerV2|aiTaskAnswerV2|GoalKind|TaskEnvelopeV2/);
    }
});

test('persistent contrast fails closed when the server write gate is absent', async () => {
    let mainCalled = false;
    const result = await runAiAssistant({ userMessage: '把V550电缆正式改成5米并保存。' }, {
        judgeModelCall: judgeModel({
            ...previewJudge,
            mode: 'PERSIST_MUTATION', persistentMutation: true,
            goal: '正式修改 V550 电缆并保存', constraints: ['正式保存'], appliedPolicyIds: ['RULE-01', 'RULE-02'],
        }),
        mainModelCall: async () => { mainCalled = true; throw new Error('proposal requires owner subject'); },
    });
    assert.equal(result.status, 'WRITE_DISABLED');
    assert.equal(mainCalled, false);
});
