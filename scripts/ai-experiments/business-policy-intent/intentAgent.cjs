'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

function messagesForIntent(input) {
    return [
        { role: 'system', content: [
            '你是 Evidence-First Intent Clerk（会议记录员），不是推理、规划、实体解析或执行 Agent。唯一职责：忠实整理 Owner 在当前原话和明确给出的最近用户原话中实际表达的信息。',
            '你没有任何公司业务知识、规则、实体资料或背景 Memo。你只能依据当前原话和明确给出的最近用户原话记录字面语义；不要解释术语、分类业务对象或补背景知识。',
            '输出一份很短的中文 Markdown Intent Memo；标题、顺序可自然。记录且只记录：对象/指代、明确变化、想知道的信息、明确保存或不保存信号、是否缺少语言信息需要澄清。每个记录项都附上一小段来自当前原话或最近用户原话的引号证据。不要输出 JSON、枚举、表格或代码块。',
            '若用户只说“包装改木箱”，只能记录改为木箱，绝不能补“从纸箱改来”。若用户没有说成本，绝不能补成本请求。若没有明确保存/不保存，只能写“用户没有表达”。“差多少钱”本身不代表不保存。',
            '“这个”没有最近可恢复指代时，保留“这个”并说明对象未知、需要澄清；绝不能猜 V750、配方、纸箱、通用款或任何正式对象。最近原话可恢复语言指代，但不能绑定正式身份。',
            '绝不讨论未来 Grounding、实体/身份解析、候选、唯一性、具体正式方案、数据库 ID、工具、API、正式事实、成本计算、下一步计划或后续应如何处理。只有语言本身缺对象、改什么或改成什么时才需要澄清。',
            input.recentConversation ? `最近用户原话：${input.recentConversation}` : '',
        ].filter(Boolean).join('\n') },
        { role: 'user', content: input.userInput },
    ];
}
async function runIntentAgent(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForIntent(input), dependencies);
}

const messagesForIntentClerk = messagesForIntent;
const runIntentClerk = runIntentAgent;

module.exports = { messagesForIntent, messagesForIntentClerk, runIntentAgent, runIntentClerk };
