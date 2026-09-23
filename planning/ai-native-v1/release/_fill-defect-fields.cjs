'use strict';
// 为五份缺陷记录补齐 Supervisor 要求的字段：defectId / abProof / regressionTestRequirement。
// 只新增字段，不改动已有内容；键顺序保持可读。
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(process.cwd(), 'planning/ai-native-v1/release');
const identity = JSON.parse(fs.readFileSync(path.join(DIR, '_ab-code-identity.json'), 'utf8'));

const CODE_IDENTITY = {
    method: identity.method,
    productionBase: identity.productionBase,
    candidate: identity.candidate,
    filesVerified: identity.files.map(f => ({ path: f.path, identical: f.identical, blob: f.productionBaseBlob })),
    allIdentical: identity.allIdentical,
    conclusion: identity.conclusion,
};

const RUNTIME_AB = {
    method: '把同一段用户历史（会话 42 该轮之前的 7 条消息）原样复制到新会话，同一问题分别打到候选实例（ecc2b27, :3002）与从生产基线代码启动的隔离实例（e244bd75, :3003），两者使用同一份数据（用户 pump.db 的副本）',
    candidateResult: '复现：回答长度 1336，金额表出现 2 次，工具序列 search_coils→preview_recipe_cost×2→build_recipe_bom_draft→preview_recipe_cost→get_recipe_detail×2',
    productionBaseResult: '复现：回答长度 1258，金额表出现 2 次；与用户库中 msg 230 逐字一致（同为 1258 字、同两处重复）',
    conclusion: '两端行为一致，属既有缺陷',
};

const SPECS = [
    {
        file: 'LegacyAiMoneyGuardDropsNonMonetaryAnswerDefectV1.json',
        defectId: 'LEGACY-AI-ANSWER-001',
        defectClass: 'FUNCTIONAL_ANSWER_DEFECT',
        title: '金额守卫整段替换掉正确的非金额结论（用户问规格差异，答案被换成核对表）',
        abProof: {
            runtimeBehavioural: '未对生产基线复跑同一轮（该轮依赖模型当次工具选择，属模型输出波动）',
            codeIdentity: CODE_IDENTITY,
            whyCodeIdentityIsTheStrongerProof: '替换逻辑是纯确定性代码路径（aiAssistantRuntime.cjs:883 → aiMoneyGuard.cjs:52-70 → :886）。四个相关源文件在两分支逐字节相同，因此相同输入必然产生相同替换行为，无需依赖模型可复现性。',
            candidateReproduction: '会话 42：用户 msg 243「这两项产品规格有什么不同」→ 候选 AI msg 244 输出「本轮正式查询金额如下…读取订单知识包 | 总成本 | 32225…」，全文不含「浮球」「8.50」；工具仅调 get_all_recipes + get_order_knowledge_package',
            productionBaseReproduction: '由 codeIdentity 证明：守卫与运行时文件在 e244bd75 上完全相同，故生产基线上同样的正文同样会被替换',
            independentFactVerification: '正确结论经正式数据核实：订单 #1 两明细 partsJson 差集 → 明细1 独有『浮球-新界式 / 浮球-线径1 ×1 @ ¥8.50』；326.50−318.00 = 8.50；359.15−349.80 = 9.35 = 8.50×1.1'
        },
        regressionTestRequirement: [
            '非金额问题（规格/配置/差异/清单）的正文不得因「正文没有 ¥ 或元」被整段替换',
            '金额问题且正文金额有据 → 追加核对表，不替换正文',
            '金额问题且正文金额无据 → 替换或要求重写（保留 tests/aiMoneyGuard.test.cjs:36 的原意）',
            '正文泄漏内部指令（仅修正文案/请再修正等）→ 仍整段替换',
            '必须同时改 tests/aiMoneyGuard.test.cjs:48 那条现有断言所固化的意图，否则修复与测试互相矛盾',
            '回归需证明：同一条「规格差异」问题在修复后必须包含配置差异结论，且金额仍可逐项回溯到工具事实'
        ]
    },
    {
        file: 'LegacyAiMachineVocabularyInsteadOfBusinessLanguageDefectV1.json',
        defectId: 'LEGACY-AI-ANSWER-002',
        defectClass: 'PRESENTATION_DEFECT',
        title: '内部工具名 / 内部 ID / 方案编码泄漏为用户回答的对象主体',
        abProof: {
            runtimeBehavioural: RUNTIME_AB,
            codeIdentity: CODE_IDENTITY,
            candidateReproduction: '会话 42 的 11 条 AI 回答中：工具显示名出现 5 条（msg 224/230/234/236/244），内部表头「对象|项目|金额」2 条，方案编码 COIL-0004 1 条，内部 ID 代号多轮（msg 228/234/236/238/240/242）',
            productionBaseReproduction: '工具显示名与方案编码来自 registry.displayName 与 aiAssistantAnswer.cjs:43/68 的取值逻辑；两文件在两分支逐字节相同 → 生产基线同样泄漏'
        },
        regressionTestRequirement: [
            '断言对象位置不得出现以「读取/生成/查询/试算」开头的字符串',
            '断言方案编码 COIL-xxxx 不作为对象主体（应表达为规格-片数 + 材质 + 槽眼，编码仅副标注）',
            '断言内部 ID 以业务身份承载（「配方 #7」不得单独作为对象名出现）',
            '断言字段名硬映射不产生业务不存在的词（如「档案成本」应表达为「线圈成本」）'
        ]
    },
    {
        file: 'LegacyAiAnswerDuplicateMoneyTableDefectV1.json',
        defectId: 'LEGACY-AI-ANSWER-003',
        defectClass: 'PRESENTATION_DEFECT',
        title: '同一张正式金额表被渲染两次',
        abProof: {
            runtimeBehavioural: RUNTIME_AB,
            codeIdentity: CODE_IDENTITY,
            note: '本条是五条中唯一已取得「运行时 A/B 双复现」的缺陷：两端都产生 2 次金额表，且生产基线输出与用户库中 msg 230 逐字一致'
        },
        regressionTestRequirement: [
            '模型写完整金额表 → 不得追加（当前失败）',
            '模型写少一行的变体 → 不得追加（当前失败，即本次缺陷）',
            '模型写多一行的变体 → 不得追加',
            '模型完全没写表 → 仍应追加',
            '正文引用本轮正式金额之外的非正式金额 → 仍应整段替换',
            '判据不得放宽为「正文出现过 ¥ 或元」'
        ]
    },
    {
        file: 'LegacyAiMoneyTableReadabilityDefectV1.json',
        defectId: 'LEGACY-AI-ANSWER-004',
        defectClass: 'PRESENTATION_DEFECT',
        title: '金额核对表对用户不可读（同一量两种精度、工具名当对象、无口径表头）',
        abProof: {
            runtimeBehavioural: RUNTIME_AB,
            codeIdentity: CODE_IDENTITY,
            candidateReproduction: 'msg 230：同一线圈同时出现「总成本 140.43」与「档案成本 140.43062」；「生成 BOM 草稿」作为对象出现 3 次；表头固定为「对象|项目|金额」无单位口径',
            productionBaseReproduction: '生成逻辑在 aiAssistantAnswer.cjs:28-81（labels 映射于 :30，对象取值于 :43，表头于 :80），该文件在两分支逐字节相同 → 生产基线同样不可读',
            independentFactVerification: '实测 COIL-0004 档案：cost = 140.43062、spec=12、sheets=180、material=钢带、slotType=小眼、isDefault=true；证明 140.43 与 140.43062 是同一量不同精度'
        },
        regressionTestRequirement: [
            '断言同一对象同一量在答案内只出现一次，且精度一致',
            '断言表头含单位与口径（如「单位：元/台；口径：按当日正式价当前重算」）',
            '断言对象列优先业务身份，不出现动作名',
            '断言长清单按 N 项截断并给出「其余 M 项见明细」'
        ]
    },
    {
        file: 'LegacyAiAnswerReadabilityAndNoiseDefectV1.json',
        defectId: 'LEGACY-AI-ANSWER-005',
        defectClass: 'PRESENTATION_DEFECT',
        title: '回答可读性不足：结论不突出、零件清单噪音、主动追加延伸邀约、远端无长度预算',
        abProof: {
            runtimeBehavioural: RUNTIME_AB,
            codeIdentity: CODE_IDENTITY,
            candidateReproduction: '会话 42+41 共 18 条 AI 回答：中位 340 字 / 最长 1258 字；44%（8/18）以「我可以继续…」类延伸邀约收尾；msg 230 含 20+ 项零件整段罗列',
            productionBaseReproduction: 'LOCAL_RESPONSE_PROMPT（含 300 字预算与「不要主动追加下一步」）位于 aiAssistantRuntime.cjs:63，仅 isLocalAssistantMode 为真时生效，远端路径未生效；该文件在两分支逐字节相同 → 生产基线远端路径同样无长度预算'
        },
        regressionTestRequirement: [
            '断言超长回答受长度预算约束（远端路径同样受限）',
            '断言默认不追加延伸邀约（用户问「建议/还能做什么」时才给）',
            '断言长清单默认压缩为 N 项 + 余项提示，仅用户明确要求完整清单时展开',
            '断言首句即结论，且金额核对表不得出现在结论之前'
        ]
    },
];

function orderKeys(obj, first) {
    const out = {};
    for (const k of first) if (k in obj) out[k] = obj[k];
    for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
    return out;
}

for (const spec of SPECS) {
    const file = path.join(DIR, spec.file);
    const original = JSON.parse(fs.readFileSync(file, 'utf8'));
    const merged = { ...original, defectId: spec.defectId, defectClass: spec.defectClass, title: spec.title, abProof: spec.abProof, regressionTestRequirement: spec.regressionTestRequirement };
    const ordered = orderKeys(merged, ['version', 'artifact', 'defectId', 'defectClass', 'title', 'type', 'status', 'severity']);
    fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
    console.log('updated ' + spec.file + '  -> ' + spec.defectId + ' (' + spec.defectClass + ')');
}
