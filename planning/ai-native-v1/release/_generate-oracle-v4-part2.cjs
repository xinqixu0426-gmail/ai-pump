'use strict';
/**
 * 生成 ontology-coil-recipe-legacy-oracle-v4.json（一次性脚本，保留作为版本升级证据）。
 *
 * 背景（Supervisor 裁定 Part 2）：展示层规范化把**工具显示名**换成业务对象名。
 * 语料里 `calculate_coil_cost` 的显示名是「计算线圈成本」，规范化后金额表的对象列
 * 变为「线圈成本」。仅此一处、逐字节可验证。
 *
 * 演进记录（每一版都不可变，只增不改）：
 *   v2 → v3：修复「正文只有一张内部金额表、关系结论被吞掉」（LEGACY-AI-ANSWER-001）
 *   v3 → v4：展示层规范化 —— 金额表对象列由工具显示名改为业务对象名（LEGACY-AI-ANSWER-002）
 */
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures');
const v3Path = path.join(dir, 'ontology-coil-recipe-legacy-oracle-v3.json');
const v4Path = path.join(dir, 'ontology-coil-recipe-legacy-oracle-v4.json');
const v3 = JSON.parse(fs.readFileSync(v3Path, 'utf8'));

// 规范化会把工具显示名换成业务对象名。语料里出现两处：
//   calculate_coil_cost  → 「计算线圈成本」→「线圈成本」
//   preview_recipe_cost  → 「配方成本试算」→「配方成本」
const VOCABULARY_DELTA = Object.freeze([
    ['| 计算线圈成本 |', '| 线圈成本 |'],
    ['| 配方成本试算 |', '| 配方成本 |'],
]);

const cases = v3.cases.map(entry => ({
    ...entry,
    finalContent: VOCABULARY_DELTA.reduce(
        (text, [from, to]) => text.replaceAll(from, to),
        String(entry.finalContent || ''),
    ),
}));

const changed = v3.cases
    .filter((entry, index) => entry.finalContent !== cases[index].finalContent)
    .map(entry => entry.caseId);

const v4 = {
    version: 4,
    sourceCommit: process.env.ORACLE_SOURCE_COMMIT || v3.sourceCommit,
    generatedFromCommit: process.env.ORACLE_GENERATED_FROM || v3.generatedFromCommit,
    providerMode: v3.providerMode,
    supersedes: 'ontology-coil-recipe-legacy-oracle-v3.json',
    reason: 'LEGACY-AI-ANSWER-002 presentation remediation: the user-visible money table labels its subject with a '
        + 'business object name instead of the internal tool display name.',
    changeClass: 'APPROVED_INTENTIONAL_PRESENTATION_DELTA',
    changeReason: 'LEGACY-AI-ANSWER-002',
    approvedBy: 'Supervisor Part 2 authorization',
    previousBaselineSha: 'faee25304a6446151cd044e8e274e2818cfde51a2a019529ad511133352d8c5b',
    affectedCases: changed,
    vocabularyDelta: VOCABULARY_DELTA.map(([from, to]) => ({ from, to })),
    historicalOraclesImmutable: [
        'ontology-coil-recipe-legacy-oracle-v1.json',
        'ontology-coil-recipe-legacy-oracle-v2.json',
        'ontology-coil-recipe-legacy-oracle-v3.json',
    ],
    versionHistory: [
        { version: 2, change: 'ONT-P8L legacy local-mode relation repair bugfix' },
        { version: 3, change: 'LEGACY-AI-ANSWER-001：保留关系结论与正式金额表，正文不再只剩金额表' },
        { version: 4, change: 'LEGACY-AI-ANSWER-002：金额表对象列由工具显示名改为业务对象名' },
    ],
    cases,
};

fs.writeFileSync(v4Path, `${JSON.stringify(v4, null, 4).replace(/\n/g, '\r\n')}\r\n`, 'utf8');
console.log(`wrote ${path.basename(v4Path)}: ${cases.length} cases, changed ${changed.length}: ${changed.join(', ')}`);
