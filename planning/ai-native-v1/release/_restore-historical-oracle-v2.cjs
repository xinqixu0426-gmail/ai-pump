'use strict';
/**
 * 一次性恢复脚本（保留作为证据）：把冻结 oracle v2 恢复成 fa639ed 上的历史内容。
 *
 * 为什么必须做：08bb566 里我把 v2 就地改成了「结论 + 金额表」。Supervisor Part 1-R1 明确：
 * 冻结 oracle 的旧版本只增不改 —— 否则以后无法证明 LEGACY-AI-ANSWER-001 曾经真实存在。
 * 由于该改写已经在 08bb566 里，这里用「基于历史内容的新提交」恢复，不改写历史。
 *
 * 用 execFileSync 直接取 blob 字节，避免 PowerShell 重定向改成 UTF-16。
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');

const BASELINE = 'fa639ed9420ac89e41e0cab223ef172a9b2e0b55';
const rel = 'tests/fixtures/ontology-coil-recipe-legacy-oracle-v2.json';
const sha256Normalized = value => crypto.createHash('sha256').update(String(value).replace(/\r\n/g, '\n')).digest('hex');

const original = execFileSync('git', ['show', `${BASELINE}:${rel}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const oracle = JSON.parse(original);
const manifest = JSON.parse(execFileSync('git', ['show', `${BASELINE}:tests/fixtures/frozen-history/manifest-v1.json`], { encoding: 'utf8' }));

fs.writeFileSync(rel, original, 'utf8');

const coilCost = oracle.cases.find(entry => entry.caseId === 'coil-cost');
console.log('restored v2 from', BASELINE);
console.log('  version:', oracle.version);
console.log('  coil-cost starts with money table:', coilCost.finalContent.startsWith('本轮正式查询金额如下'));
console.log('  coil-cost contains 已核实:', coilCost.finalContent.includes('已核实'));
console.log('  coil-cost length:', coilCost.finalContent.length);
console.log('  case count:', oracle.cases.length);
for (const artifact of manifest.artifacts) {
    console.log(`  frozen sha ${artifact.path}: ${artifact.sha256.slice(0, 12)}...`);
}
console.log('  manifest sha256Normalized(blob):', sha256Normalized(original).slice(0, 12) + '...');
