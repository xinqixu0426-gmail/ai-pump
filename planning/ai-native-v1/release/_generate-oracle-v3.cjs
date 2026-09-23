'use strict';
/**
 * 生成 ontology-coil-recipe-legacy-oracle-v3.json（一次性脚本，保留作为版本升级证据）。
 *
 * 背景（Supervisor 裁定 Part 1-R1）：
 * 旧的冻结 oracle **不得原地改写**。v2 记录的是历史 baseline 上系统当时真实的预期输出，
 * 它的价值正是证明「缺陷原来真实存在、新测试确实捕获了它」。因此：
 *   - v2 恢复原样并永久保留（immutable historical evidence）；
 *   - 新增 v3 记录本次批准的展示行为变化。
 *
 * 本次变化（CHANGE_CLASS = APPROVED_INTENTIONAL_PRESENTATION_DELTA）：
 *   修复前：finalContent 只剩一张内部金额表，正确的关系结论消失。
 *   修复后：保留已验证的关系结论，同时保留原有正式金额表。
 */
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures');
const v2Path = path.join(dir, 'ontology-coil-recipe-legacy-oracle-v2.json');
const v3Path = path.join(dir, 'ontology-coil-recipe-legacy-oracle-v3.json');
const v2 = JSON.parse(fs.readFileSync(v2Path, 'utf8'));

// 受 LEGACY-AI-ANSWER-001 影响的四个成本类用例：修复前 finalContent 只有金额表。
const AFFECTED = new Set(['coil-cost', 'recipe-cost', 'cost-compare', 'mixed-cost-compare-relation']);
const VERIFIED_CONCLUSION = '已核实：Shadow配方甲使用Shadow线圈甲（12-120）。';

const cases = v2.cases.map(entry => {
    if (!AFFECTED.has(entry.caseId)) return entry;
    if (String(entry.finalContent || '').startsWith('已核实：')) return entry;
    return {
        ...entry,
        // 关系结论重新出现在金额表之前；金额表原样保留。
        finalContent: `${VERIFIED_CONCLUSION}\n\n${entry.finalContent}`,
    };
});

const v3 = {
    version: 3,
    sourceCommit: process.env.ORACLE_SOURCE_COMMIT || v2.sourceCommit,
    generatedFromCommit: process.env.ORACLE_GENERATED_FROM || v2.generatedFromCommit,
    providerMode: v2.providerMode,
    supersedes: 'ontology-coil-recipe-legacy-oracle-v2.json',
    reason: 'LEGACY-AI-ANSWER-001 presentation remediation: the answer keeps the verified relational conclusion '
        + 'together with the canonical monetary table instead of publishing only the internal money table.',
    changeClass: 'APPROVED_INTENTIONAL_PRESENTATION_DELTA',
    changeReason: 'LEGACY-AI-ANSWER-001',
    approvedBy: 'Supervisor Part 1-R1 ruling',
    previousBaselineSha: '9d98d5bab2ae9610309ca1778ce44263bc86c708586e7298747292eea680eb9b',
    affectedCases: [...AFFECTED],
    historicalOraclesImmutable: [
        'ontology-coil-recipe-legacy-oracle-v1.json',
        'ontology-coil-recipe-legacy-oracle-v2.json',
    ],
    cases,
};

// 与仓库其他 fixture 一致：4 空格缩进 + CRLF + 末尾换行。
fs.writeFileSync(v3Path, `${JSON.stringify(v3, null, 4).replace(/\n/g, '\r\n')}\r\n`, 'utf8');
console.log(`wrote ${path.basename(v3Path)}: ${cases.length} cases, ${AFFECTED.size} presentation-delta cases`);
for (const caseId of AFFECTED) {
    console.log(`  ${caseId}: ${String(v3.cases.find(c => c.caseId === caseId).finalContent).length} chars`);
}

const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures');
const v2Path = path.join(dir, 'ontology-coil-recipe-legacy-oracle-v2.json');
const v3Path = path.join(dir, 'ontology-coil-recipe-legacy-oracle-v3.json');
const v2 = JSON.parse(fs.readFileSync(v2Path, 'utf8'));

// 受 LEGACY-AI-ANSWER-001 影响的四个成本类用例：修复前 finalContent 只有金额表。
const AFFECTED = new Set(['coil-cost', 'recipe-cost', 'cost-compare', 'mixed-cost-compare-relation']);
const VERIFIED_CONCLUSION = '已核实：Shadow配方甲使用Shadow线圈甲（12-120）。';

const cases = v2.cases.map(entry => {
    if (!AFFECTED.has(entry.caseId)) return entry;
    if (String(entry.finalContent || '').startsWith('已核实：')) return entry;
    return {
        ...entry,
        // 关系结论重新出现在金额表之前；金额表原样保留。
        finalContent: `${VERIFIED_CONCLUSION}\n\n${entry.finalContent}`,
    };
});

const v3 = {
    version: 3,
    sourceCommit: process.env.ORACLE_SOURCE_COMMIT || v2.sourceCommit,
    generatedFromCommit: process.env.ORACLE_GENERATED_FROM || v2.generatedFromCommit,
    providerMode: v2.providerMode,
    supersedes: 'ontology-coil-recipe-legacy-oracle-v2.json',
    reason: 'LEGACY-AI-ANSWER-001 presentation remediation: the answer keeps the verified relational conclusion '
        + 'together with the canonical monetary table instead of publishing only the internal money table.',
    changeClass: 'APPROVED_INTENTIONAL_PRESENTATION_DELTA',
    changeReason: 'LEGACY-AI-ANSWER-001',
    approvedBy: 'Supervisor Part 1-R1 ruling',
    previousBaselineSha: '9d98d5bab2ae9610309ca1778ce44263bc86c708586e7298747292eea680eb9b',
    affectedCases: [...AFFECTED],
    historicalOraclesImmutable: [
        'ontology-coil-recipe-legacy-oracle-v1.json',
        'ontology-coil-recipe-legacy-oracle-v2.json',
    ],
    cases,
};

// 与仓库其他 fixture 一致：4 空格缩进 + CRLF + 末尾换行。
fs.writeFileSync(v3Path, `${JSON.stringify(v3, null, 4).replace(/\n/g, '\r\n')}\r\n`, 'utf8');
console.log(`wrote ${path.basename(v3Path)}: ${cases.length} cases, ${AFFECTED.size} presentation-delta cases`);
for (const caseId of AFFECTED) {
    console.log(`  ${caseId}: ${String(v3.cases.find(c => c.caseId === caseId).finalContent).length} chars`);
}
