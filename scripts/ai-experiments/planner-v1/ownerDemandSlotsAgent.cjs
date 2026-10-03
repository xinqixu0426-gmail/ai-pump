'use strict';

const { callDeepSeek } = require('../business-policy-intent/modelClient.cjs');

function messagesForDemandSlots(input) {
    const targets = (input.finalGroundedTargets || []).map(target => `${target.mention || 'NONE'} | ${target.status} | ${target.entityType}`).join('\n') || 'NONE';
    return [
        { role: 'system', content: [
            '你只提取老板最终交付需求的五种槽位。正式对象已由上游确定；不要重新定位对象，也不要规划能力、工具或步骤。',
            'RESULT_SHAPE 只能是 VALUE（具体值，可为多个分别的值）、LIST（清单）、COUNT（数量）、DELTA（差值/增减额）、DETAIL（解释/详情）、NONE（只要求执行写动作，无返回业务结果）。',
            'METRIC 只能是 COST 或 NONE。只有老板要求返回成本数值或成本差额才用 COST；仅出现可能影响成本的配置词、但未要求返回成本结果时用 NONE。',
            'RELATION_REQUEST：查询某对象当前关联的其它对象或包含的关联项时，复制老板原话中实际连续片段；否则 NONE。一个具体关联值也属于关系查询。',
            'SCENARIO_OVERRIDE：每个独立变化各输出一行，严格格式为“SCENARIO_OVERRIDE: 老板原话连续片段 | 类别代码”。竖线右侧必须且只能有一个类别代码；不得省略类别、追加第三段、改写、补词或同义转述。无变化时输出“SCENARIO_OVERRIDE: NONE”。类别仅限 PACKAGING（包装）、CABLE（电缆）、FLOAT（浮球）、SURFACE_TREATMENT（表面处理）、ROTOR_PROCESS（转子/接轴/转轴制造加工）、COIL（线圈/绕组）、BARREL（机筒/筒体）、OTHER（确实无法归类）。根据老板原话及业务备忘录分类。',
            'WRITE_REQUIRED 仅在老板要求正式保存/写入时为 YES；读取、预览、不保存为 NO。',
            '输出行协议：RESULT_SHAPE: 具体枚举值。METRIC: COST 或 NONE。有关系需求时，RELATION_REQUEST: 老板原话连续片段；没有时，RELATION_REQUEST: NONE。不要把“|NONE”追加到关系片段后。每个变化各写 SCENARIO_OVERRIDE: 老板原话连续片段 | 类别代码；没有变化时写 SCENARIO_OVERRIDE: NONE。WRITE_REQUIRED: YES 或 NO。只输出这五种行，不输出其它字段、解释或输入回显。',
            `RAW_OWNER_INPUT:\n${input.rawOwnerInput}`,
            `BUSINESS_MEMO:\n${input.businessMemo}`,
            `POLICY_MEMO:\n${input.policyMemo}`,
            `GROUNDING_RESULT:\n${input.groundingResult}`,
            `FINAL_GROUNDED_TARGETS:\n${targets}`,
            `GROUNDING_AMBIGUITY:\n${input.groundingAmbiguity || 'NONE'}`,
            `CANDIDATE_SET_COMPLETE:\n${input.candidateSetComplete || 'UNKNOWN'}`,
        ].join('\n\n') },
        { role: 'user', content: '只按五种 Owner Demand Slots 行协议输出。' },
    ];
}

async function runOwnerDemandSlotsAgent(input, dependencies = {}) { return (dependencies.modelCall || callDeepSeek)(messagesForDemandSlots(input), dependencies); }
module.exports = { messagesForDemandSlots, runOwnerDemandSlotsAgent };
