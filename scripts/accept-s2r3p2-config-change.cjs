#!/usr/bin/env node
'use strict';
/**
 * S2-R3-P2 独立复跑（验收侧）
 * 核心判据：请求的正式配置 == 当前正式配置 → NO_OP（不显示 Δ0、不显示 coilId、不说"已正式应用的临时配置"）
 * 反例必须保持真变更语义：不同配置但同价仍然是真变更。
 */
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const token = fs.readFileSync(path.join(ROOT, '_owner-token.local'), 'utf8').trim();

function chat(text, conversationId) {
  const out = execFileSync('curl', ['-s', '-m', '200', '-X', 'POST', 'http://127.0.0.1:3002/api/ai/chat',
    '-H', 'content-type: application/json', '-H', 'cookie: token=' + token,
    '-d', JSON.stringify({ messages: [{ role: 'user', content: text }], conversationId: conversationId || ('p2-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)) })],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const evs = [];
  for (const l of out.split(/\r?\n/)) if (l.startsWith('data: ')) { try { evs.push(JSON.parse(l.slice(6))); } catch (e) {} }
  let content = '', state = '';
  for (const e of evs) { if (e.type === 'content') content += e.content; if (e.type === 'detail' && e.state && !state) state = e.state; }
  return { content, state };
}

const INTERNAL = [
  [/coilId\s*[=:]/i, 'coilId'],
  [/coilSheets\s*[=:]/i, 'coilSheets'],
  [/\bcableLength\s*[=:]/i, 'cableLength'],
  [/\bhasFloat\s*[=:]/i, 'hasFloat'],
  [/\bpackingParts\s*[=:]/i, 'packingParts'],
  [/已正式应用的临时配置/, '已正式应用的临时配置'],
  [/增加 ¥0\.00|减少 ¥0\.00/, 'Δ0 措辞'],
];

const cases = [
  ['P2-A 换成当前已用的线圈（12-120 就是现状）→ 必须 NO_OP', 'v550-tokoy换成12-120线圈，成本是多少？', { expectNoOp: true }],
  ['P2-B 换成真正不同的线圈（12-140）→ 必须真变更', 'v550-tokoy换成12-140线圈，成本是多少？', { expectNoOp: false }],
  ['P2-C 改电缆长度（真变更）', 'v550-tokoy电缆改成5米，其他不变，看看成本', { expectNoOp: false }],
];

let failures = 0;
for (const [label, q, opt] of cases) {
  const r = chat(q);
  const leaks = INTERNAL.filter(([re]) => re.test(r.content)).map(([, name]) => name);
  const isNoOp = /配置(与当前正式配置一致|没有变化)/.test(r.content);
  console.log('=== ' + label + ' ===');
  console.log('  Q: ' + q);
  console.log('  state=' + (r.state || '-'));
  console.log('  A: ' + r.content.replace(/\n/g, ' | '));
  console.log('  NO_OP 判定 = ' + isNoOp + (opt.expectNoOp === isNoOp ? '  ✅ 符合预期' : '  ❌ 与预期不符'));
  console.log('  内部字段名/旧措辞泄漏 = ' + (leaks.length ? '❌ ' + leaks.join(',') : '0 ✅'));
  if (opt.expectNoOp !== isNoOp) failures++;
  if (leaks.length) failures++;
  console.log('');
}
console.log('失败项 = ' + failures + ' / ' + cases.length);
