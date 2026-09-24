#!/usr/bin/env node
'use strict';
/**
 * S2-R3-P1 独立复跑（验收侧，不依赖执行者自报）
 * 对本地 canary 运行时的真实 /api/ai/chat 发问，记录：
 *   family(goalKinds) / subject / quantity / admission / 工具域 / 最终用户措辞
 * 用法: node _p1-replay.cjs [baseUrl]   默认 http://127.0.0.1:3002
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.argv[2] || 'http://127.0.0.1:3002';
const ROOT = path.resolve(__dirname);

function env(k) {
  const t = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const l of t.split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && l.slice(0, i).trim() === k) return l.slice(i + 1).trim(); }
  return '';
}

// ---- owner 身份：优先用已签发的 owner token，才能进入 native owner 路径 ----
let GLOBAL_COOKIE = '';
function ownerCookie() {
  const tokenFile = path.join(ROOT, '_owner-token.local');
  if (fs.existsSync(tokenFile)) return 'token=' + fs.readFileSync(tokenFile, 'utf8').trim();
  const pw = env('ACCESS_PASSWORD');
  const out = execFileSync('curl', ['-s', '-m', '20', '-i', '-X', 'POST', BASE + '/api/auth/login',
    '-H', 'content-type: application/json', '-d', JSON.stringify({ password: pw })], { encoding: 'utf8' });
  const m = out.match(/[Ss]et-[Cc]ookie:\s*([^;\r\n]+)/);
  if (!m) throw new Error('LOGIN_FAILED: ' + out.slice(0, 300));
  return m[1];
}

function chat(cookie, text, conversationId) {
  const out = execFileSync('curl', ['-s', '-m', '200', '-X', 'POST', BASE + '/api/ai/chat',
    '-H', 'content-type: application/json', '-H', 'cookie: ' + cookie,
    '-d', JSON.stringify({ messages: [{ role: 'user', content: text }], conversationId })],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const events = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    try { events.push(JSON.parse(line.slice(6))); } catch (e) { /* ignore */ }
  }
  let content = '';
  let state = '';
  let canary = 'eligible';
  const calls = [];
  let plan = '';
  for (const ev of events) {
    if (ev.type === 'content') content += ev.content;
    if (ev.type === 'detail' && ev.state && !state) state = ev.state;
    if (ev.type === 'status' && ev.stage === 'canary_ineligible') canary = 'INELIGIBLE';
    if (ev.type === 'tool_call') calls.push(ev.name + '(' + JSON.stringify(ev.args || {}).slice(0, 70) + ')');
    if (ev.type === 'status' && ev.stage === 'task_v2' && /canary/i.test(ev.message || '')) canary = ev.message;
    if (ev.type === 'detail' && ev.planRevision) plan = 'planRevision=' + ev.planRevision;
    if (ev.type === 'plan' || ev.type === 'task') plan = plan || JSON.stringify(ev).slice(0, 200);
  }
  return { content, state, canary, calls, plan, bytes: out.length };
}

const INTERNAL_CODE = /CROSS_CATALOG_CANDIDATES|AI_RESOURCE_NOT_FOUND|ERROR|_V1\b|formal requirement/i;
const MONEY_TEMPLATE = /没有取得可用金额|不给当前完整成本|没有可用的保存成本快照/;

const results = [];
function run(tag, text) {
  const conv = 'p1-' + tag + '-' + Date.now();
  let r;
  try { r = chat(GLOBAL_COOKIE, text, conv); }
  catch (e) { console.log('[' + tag + '] 执行异常: ' + e.message); results.push({ tag, error: e.message }); return; }
  const domainDrift = MONEY_TEMPLATE.test(r.content) && !/成本|金额|价格/.test(text);
  const codeLeak = INTERNAL_CODE.test(r.content);
  console.log('[' + tag + '] ' + text);
  console.log('   state=' + (r.state || '-') + '  canary=' + r.canary + '  ' + r.plan);
  console.log('   工具(' + r.calls.length + '): ' + (r.calls.join(' ; ') || '无'));
  console.log('   回答(' + r.content.length + '字): ' + r.content.replace(/\n/g, ' | ').slice(0, 260));
  if (domainDrift) console.log('   >>> 域漂移！(问的是缺料/库存，答的是金额)');
  if (codeLeak) console.log('   >>> 内部码泄漏！');
  console.log('');
  results.push({ tag, text, state: r.state, canary: r.canary, calls: r.calls, content: r.content, domainDrift, codeLeak, bytes: r.bytes });
  return r;
}

console.log('===== S2-R3-P1 独立复跑 @ ' + BASE + ' =====\n');
GLOBAL_COOKIE = ownerCookie();
console.log('owner 身份 OK (native owner 路径)\n');

console.log('--- A. 数量语序无关（5 种说法必须都拿到 quantity=300 并跑完）---');
run('A1', 'V750大脚板-2寸-经典款虚拟齐料预览300台');
run('A2', 'V750大脚板-2寸-经典款按300台虚拟齐料预览');
run('A3', '按300台虚拟齐料 V750大脚板-2寸-经典款');
run('A4', '虚拟齐料：V750大脚板-2寸-经典款，数量300台');
run('A5', 'V750大脚板-2寸-经典款 300台 齐料');

console.log('--- A6. 首轮缺数量 → 次轮只回「300台」必须续跑 ---');
(function () {
  const conv = 'p1-A6-' + Date.now();
  const first = chat(GLOBAL_COOKIE, 'V750大脚板-2寸-经典款齐料情况怎么样？', conv);
  console.log('[A6-首轮] state=' + (first.state || '-') + ' 回答: ' + first.content.slice(0, 120));
  const second = chat(GLOBAL_COOKIE, '300台', conv);
  const reasked = /请(确认|告诉).{0,20}多少台|按多少台/.test(second.content);
  console.log('[A6-次轮] state=' + (second.state || '-') + ' 再次追问数量=' + (reasked ? '是（死循环！）' : '否') + ' 回答: ' + second.content.replace(/\n/g, ' | ').slice(0, 200));
  results.push({ tag: 'A6', first: first.content, firstState: first.state, second: second.content, secondState: second.state, reasked });
  console.log('');
})();

console.log('--- B. 同族不同说法都必须进 readiness ---');
run('B1', 'V750大脚板-2寸-经典款生产100台缺什么料？');
run('B2', '缺料预览 V750大脚板-2寸-经典款 100台');
run('B3', 'V750大脚板-2寸-经典款 100台齐料怎么样？');
run('B4', 'V750大脚板-2寸-经典款按100台看缺料');

console.log('--- C. 无数量的 shortage 问句不得掉进成本域 ---');
run('C1', 'V750大脚板-2寸-经典款缺什么料？');

console.log('--- D. 多配方必须安全澄清，不得新增能力 ---');
run('D1', 'V750大脚板-2寸-经典款和V550大脚板-2寸-经典款各100台，缺什么料？');

console.log('--- 回归：已验收通过的 6 个 Owner 场景 ---');
run('R1', 'V550大脚板-2寸-经典款的当前成本是多少？');
run('R2', '比较一下 V750大脚板-2寸-经典款 和 V550大脚板-2寸-经典款 的成本差多少');
run('R3', '12-120钢带小眼线圈的档案成本是多少？');
run('R4', '12-120线圈库存多少？');
run('R5', 'V750大脚板-2寸-经典款换成12-120线圈，成本是多少？');
run('R6', 'V750大脚板-2寸-经典款生产300台缺什么料？');

console.log('===== 汇总 =====');
const drift = results.filter(r => r.domainDrift);
const leak = results.filter(r => r.codeLeak);
const wholeName = results.filter(r => (r.calls || []).some(c => /recipeName":"[^"]{0,200}(缺什么料|各100台|齐料|和V550)/.test(c)));
console.log('READINESS_TO_COST_DOMAIN_DRIFT = ' + drift.length + (drift.length ? '  ' + drift.map(r => r.tag).join(',') : ''));
console.log('INTERNAL_CODE_LEAK = ' + leak.length + (leak.length ? '  ' + leak.map(r => r.tag).join(',') : ''));
console.log('WHOLE_SENTENCE_RECIPE_BINDING = ' + wholeName.length + (wholeName.length ? '  ' + wholeName.map(r => r.tag).join(',') : ''));
const a6 = results.find(r => r.tag === 'A6');
console.log('FOLLOWUP_QUANTITY_RESUME = ' + (a6 && a6.reasked === false ? 'PASS' : 'FAIL'));
const qtyOk = ['A1', 'A2', 'A3', 'A4', 'A5'].every(t => { const r = results.find(x => x.tag === t); return r && r.state === 'SUCCEEDED' && r.content.length > 200; });
console.log('QUANTITY_ORDER_INDEPENDENT = ' + (qtyOk ? 'PASS' : 'FAIL'));
fs.writeFileSync(path.join(ROOT, '_p1-replay-result.json'), JSON.stringify(results, null, 2), 'utf8');
console.log('\n明细已写入 _p1-replay-result.json');
