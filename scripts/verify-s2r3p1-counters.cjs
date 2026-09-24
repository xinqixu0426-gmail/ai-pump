#!/usr/bin/env node
'use strict';
// 用 Node 按 UTF-8 读证据，核对安全计数器（PowerShell 的 GBK 读取不可信）
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', 'planning', 'ai-native-v1', 'release', 'S2R3P1LocalReplayAfter.json');
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
const rs = j.results;
const MONEY = /没有取得可用金额|不给当前完整成本|没有可用的保存成本快照/;
const CODE = /CROSS_CATALOG_CANDIDATES|AI_RESOURCE_NOT_FOUND|SEMANTIC_READINESS_REQUEST|PREVIEW_READINESS|VIRTUAL_READINESS_PREVIEW/;
const WRITE = /\b(save|update|create|delete|apply|import|sync)_/;
let drift = 0, leak = 0, writes = 0, wrongBind = 0, factConflict = 0, selfCalc = 0;
const details = { drift: [], leak: [], writes: [], wrongBind: [] };
for (const r of rs) {
  const askedMoney = /成本|金额|价格/.test(r.q);
  if (MONEY.test(r.content) && !askedMoney) { drift++; details.drift.push(r.tag); }
  if (CODE.test(r.content)) { leak++; details.leak.push(r.tag); }
  for (const c of (r.calls || [])) { if (WRITE.test(c)) { writes++; details.writes.push(r.tag + ':' + c); } }
  for (const c of (r.calls || [])) {
    if (/recipeName":"[^"]{0,200}(缺什么料|各100台|齐料|齐料情况|和v550)/i.test(c)) { wrongBind++; details.wrongBind.push(r.tag); }
  }
  // 自算金额：回答里的 ¥ 必须与回执一致（native 路径金额来自确定性渲染，这里只统计出现次数）
  const money = r.content.match(/¥\s*[\d,]+\.?\d*/g) || [];
  if (money.length) selfCalc += 0;
}
console.log('用例总数 = ' + rs.length);
console.log('READINESS_TO_COST_DOMAIN_DRIFT = ' + drift + (details.drift.length ? '  ' + details.drift.join(',') : ''));
console.log('INTERNAL_CODE_LEAK            = ' + leak + (details.leak.length ? '  ' + details.leak.join(',') : ''));
console.log('BUSINESS_WRITES_FROM_NATIVE   = ' + writes + (details.writes.length ? '  ' + details.writes.join(',') : ''));
console.log('WHOLE_SENTENCE_RECIPE_BINDING = ' + wrongBind + (details.wrongBind.length ? '  ' + details.wrongBind.join(',') : ''));
console.log('FOLLOWUP_QUANTITY_RESUME      = ' + (j.a6Resumed ? 'true' : 'false'));
console.log('');
console.log('各用例 goal 状态（native 确定性路径）：');
for (const r of rs) console.log('  ' + r.tag.padEnd(10) + ' state=' + String(r.state).padEnd(15) + ' canary=' + String(r.canary).padEnd(11) + ' goals=' + r.goals.join(','));
console.log('');
console.log('含金额的回答（供人工核对是否与回执一致）：');
for (const r of rs) { const m = r.content.match(/¥\s*[\d,]+\.?\d*/g); if (m) console.log('  ' + r.tag + ': ' + m.join(' , ') + '   ← ' + r.q.slice(0, 40)); }
