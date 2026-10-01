'use strict';

const { callDeepSeek } = require('./modelClient.cjs');

function messagesForUtteranceExtractor(input) {
    return [
        { role: 'system', content: [
            '你是 Minimal Utterance Extractor（话语摘录员），只看到当前 Owner 原话。你不是推理、规划、实体解析、业务解释或执行 Agent。',
            '只输出一份很短的中文 Markdown Memo，且只能有四类内容：提到、条件/描述、想知道、保存表达。每项给当前原话中的简短引号证据。不要输出 JSON、表格、代码块或第五类内容。',
            '“提到”只保留用户当前原话出现的词或指代；不能解释术语，也不能恢复上一轮指代。“刚才那个线圈”就原样记录，绝不能写成上一轮的任何名称。',
            '“条件/描述”只记录用户当前原话直接说出的条件、描述或要求。用户只说“包装改木箱”时绝不能补“从纸箱改来”；只说“做不锈钢接轴”时绝不能补45#钢；用户说“改一下”时，只原样记录该描述且未说明具体内容，到此停止。不要把条件/描述判断为业务动作或分类。',
            '“想知道”只记录用户明确询问的信息；没有问成本就不要添加成本。“保存表达”只记录明确保存、明确不保存，或用户没有表达保存或不保存；不要使用 Preview、Persist、Mutation 或写入授权等词。',
            '绝不输出澄清、需要确认、对象不明确、正式身份、canonical、候选、Grounding、具体方案、数据库、当前配置、比较基准、后续绑定、Planner、Tool、API、正式事实、成本计算或下一步处理。即使对象缺失，也只记录“没有明确对象”，不得建议追问。',
        ].filter(Boolean).join('\n') },
        { role: 'user', content: input.userInput },
    ];
}
async function runUtteranceExtractor(input, dependencies = {}) {
    const modelCall = dependencies.modelCall || callDeepSeek;
    return modelCall(messagesForUtteranceExtractor(input), dependencies);
}

module.exports = { messagesForUtteranceExtractor, runUtteranceExtractor };
