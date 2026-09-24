#!/usr/bin/env node
'use strict';
/**
 * S2-R3-P1 修复后独立复跑 —— 验收侧（本地 owner 模式）
 * 覆盖：A 数量语序无关 / A6 多轮续跑 / B 同族准入 / C 无数量不落成本域 / D 多配方有界澄清
 *       + 已验收 Owner 场景回归
 * 本地真实名：v550-tokoy（唯一匹配）。本地库无库存。
 */
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const token = fs.readFileSync(path.join(ROOT, '_owner-token.local'), 'utf8').trim();

function chat(text, conversationId) {
  const out = execFileSync('curl', ['-s', '-m', '200', '-X', 'POST', 'http://127.0.0.1:3002/api/ai/chat',
    '-H', 'content-type: application/json', '-H', 'cookie: token=' + token,
    '-d', JSON.stringify({ messages: [{ role: 'user', content: text }], conversationId: conversationId || ('r-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)) })],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const evs = [];
  for (const l of out.split(/\r?\n/)) if (l.startsWith('data: ')) { try { evs.push(JSON.parse(l.slice(6))); } catch (e) {} }
  let content = '', state = '', canary = 'eligible', planRevision = null;
  const calls = []; const goals = [];
  for (const e of evs) {
    if (e.type === 'content') content += e.content;
    if (e.type === 'detail') { if (e.state && !state) state = e.state; if (e.planRevision) planRevision = e.planRevision; if (Array.isArray(e.goals)) for (const g of e.goals) goals.push(g); }
    if (e.type === 'status' && e.stage === 'canary_ineligible') canary = 'INELIGIBLE';
    if (e.type === 'status' && e.stage === 'task_v2' && /canary/i.test(e.message || '')) canary = e.message;
    if (e.type === 'tool_call') calls.push(e.name + '(' + JSON.stringify(e.args || {}).slice(0, 60) + ')');
  }
  return { content, state, canary, planRevision, calls, goals };
}

const MONEY_TEMPLATE = /没有取得可用金额|不给当前完整成本|没有可用的保存成本快照|无法核对的金额/;
const INTERNAL_CODE = /CROSS_CATALOG_CANDIDATES|AI_RESOURCE_NOT_FOUND|SEMANTIC_READINESS_REQUEST|PREVIEW_READINESS/;
const ASK_QTY = /请(?:确认|告诉)本次?要?按多少台|按多少台计算|要按多少台/;
const results = [];

function probe(tag, q, opts) {
  opts = opts || {};
  const r = chat(q, opts.conversationId);
  const askedQty = ASK_QTY.test(r.content);
  const moneyLeak = MONEY_TEMPLATE.test(r.content);
  const codeLeak = INTERNAL_CODE.test(r.content);
  const shortages = (r.content.match(/短缺\s*\d+/g) || []).length;
  const rec = { tag, q, state: r.state, canary: r.canary, planRevision: r.planRevision, calls: r.calls, goals: r.goals.map(g => g.goalKey + ':' + g.state + (g.blockerCodes && g.blockerCodes.length ? '(' + g.blockerCodes.join(',') + ')' : '')), content: r.content, askedQty, moneyLeak, codeLeak, shortages };
  results.push(rec);
  console.log('[' + tag + '] ' + q);
  console.log('   state=' + (r.state || '-') + ' canary=' + r.canary + ' planRevision=' + (r.planRevision || '-'));
  console.log('   goals=' + (rec.goals.join(' , ') || '无'));
  console.log('   工具(' + r.calls.length + '): ' + (r.calls.join(' ; ') || '无'));
  console.log('   回答(' + r.content.length + '字, 短缺项' + shortages + '): ' + r.content.replace(/\n/g, ' | ').slice(0, 230));
  if (askedQty) console.log('   >>> 仍在追问数量');
  if (moneyLeak) console.log('   >>> 金额模板泄漏');
  if (codeLeak) console.log('   >>> 内部码泄漏');
  console.log('');
  return rec;
}

console.log('===== S2-R3-P1 修复后复跑 @ 本地 owner =====\n');

console.log('--- A. 数量语序无关：5 种说法都必须解析出 quantity=300 并跑完 ---');
probe('A1', 'v550-tokoy虚拟齐料预览300台');
probe('A2', 'v550-tokoy按300台虚拟齐料预览');
probe('A3', '按300台虚拟齐料 v550-tokoy');
probe('A4', '虚拟齐料：v550-tokoy，数量300台');
probe('A5', 'v550-tokoy 300台 齐料');

console.log('--- A6. 首轮缺数量 → 次轮只回「300台」必须续跑（不得再追问）---');
const convA6 = 'a6-' + Date.now();
probe('A6-首轮', 'v550-tokoy齐料情况怎么样？', { conversationId: convA6 });
const second = probe('A6-次轮', '300台', { conversationId: convA6 });
const a6Resumed = !second.askedQty && second.state === 'SUCCEEDED';

console.log('--- B. 单配方 readiness 的不同说法 ---');
probe('B1', 'v550-tokoy生产100台缺什么料？');
probe('B2', '缺料预览 v550-tokoy 100台');
probe('B3', 'v550-tokoy 100台齐料怎么样？');
probe('B4', 'v550-tokoy按100台看缺料');

console.log('--- C. 无数量的短缺问句：必须问数量，绝不落成本域 ---');
probe('C1', 'v550-tokoy缺什么料？');

console.log('--- D. 多配方：有界澄清，不新增能力、不整句当配方名 ---');
probe('D1', 'v750-tokoy和v550-tokoy各100台，缺什么料？');

console.log('--- 回归：已验收 Owner 场景（本地对照值）---');
probe('R1', 'v550-tokoy的当前成本是多少？');
probe('R2', 'v550-tokoy换成12-140线圈，成本是多少？');
probe('R3', '12-120钢带小眼线圈的档案成本是多少？');
probe('R4', '12-120线圈库存多少？');

console.log('===== 汇总 =====');
const byTag = t => results.filter(r => r.tag === t)[0] || {};
const aOrderOk = ['A1', 'A2', 'A3', 'A4', 'A5'].every(t => { const r = byTag(t); return r.state === 'SUCCEEDED' && !r.askedQty && r.shortages > 0; });
console.log('QUANTITY_ORDER_INDEPENDENT  = ' + (aOrderOk ? 'PASS' : 'FAIL') + '   (A1-A5 全部 SUCCEEDED 且给出短缺数额)');
console.log('FOLLOWUP_QUANTITY_RESUME    = ' + (a6Resumed ? 'PASS' : 'FAIL') + '   (次轮只回 300台 → state=' + (second.state || '-') + ', 再追问=' + (second.askedQty ? '是' : '否') + ')');
const bOk = ['B1', 'B2', 'B3', 'B4'].every(t => { const r = byTag(t); return r.canary === 'eligible' && !r.moneyLeak; });
console.log('READINESS_ADMISSION_VARIANTS= ' + (bOk ? 'PASS' : 'FAIL') + '   (B1-B4 全部 canary eligible 且无金额模板)');
const c1 = byTag('C1');
console.log('NO_QUANTITY_BEHAVIOR        = ' + (c1.askedQty && !c1.moneyLeak ? 'PASS（追问数量，未落成本域）' : 'FAIL') );
const d1 = byTag('D1');
const d1Clarify = !d1.moneyLeak && d1.calls.every(c => !/recipeName":"[^"]*(和v550|各100台|缺什么料)/.test(c));
console.log('MULTI_RECIPE_BEHAVIOR       = ' + (d1Clarify ? 'CLARIFY' : 'FAIL'));
console.log('MULTI_RECIPE_SUPPORT_ADDED  = NO');
const whole = results.filter(r => r.calls.some(c => /recipeName":"[^"]{0,200}(缺什么料|各100台|齐料|齐料情况)/.test(c)));
console.log('WHOLE_SENTENCE_RECIPE_BINDING = ' + whole.length + '/' + results.length + (whole.length ? '  ' + whole.map(r => r.tag).join(',') : ''));
const drift = results.filter(r => r.moneyLeak && !/成本|金额|价格/.test(r.q));
console.log('READINESS_TO_COST_DOMAIN_DRIFT = ' + drift.length + '/' + results.length + (drift.length ? '  ' + drift.map(r => r.tag).join(',') : ''));
const leak = results.filter(r => r.codeLeak);
console.log('INTERNAL_CODE_LEAK          = ' + leak.length + '/' + results.length);

fs.writeFileSync(path.join(ROOT, '_p1-replay-after.json'), JSON.stringify({ results, a6Resumed }, null, 2), 'utf8');
console.log('\n明细 → _p1-replay-after.json');
