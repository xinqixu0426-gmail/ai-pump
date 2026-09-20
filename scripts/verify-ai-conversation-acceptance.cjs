'use strict';
/**
 * Acceptance check for real production AI conversations.
 *
 * Determinstic part: every numeric claim an assistant answer makes about a coil scheme / coil cost /
 * recipe count / part price / order count is compared against a read-only snapshot of the production
 * database. Judgement part: answers that contain no matching number are listed for manual reading
 * instead of being silently passed.
 *
 * Usage: node scripts/verify-ai-conversation-acceptance.cjs <conversations.json> <facts.json>
 */
const fs = require('node:fs');

const conversations = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const facts = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

const coilByCode = new Map(facts.coils.map(coil => [coil.scheme_code, coil]));
const coilByShape = new Map();
for (const coil of facts.coils) {
    const key = `${coil.spec}-${coil.sheets}`;
    if (!coilByShape.has(key)) coilByShape.set(key, []);
    coilByShape.get(key).push(coil);
}
const activeRecipes = facts.recipes.filter(recipe => !recipe.deleted_at);
const activeOrders = facts.orders.filter(order => !order.deleted_at);
const partByModel = new Map(facts.parts.map(part => [part.model, part]));

const money = value => Number.parseFloat(value).toFixed(2);
const checks = [];
const record = (conversation, message, kind, claim, expected, actual, status, note = '') => {
    checks.push({ conversationId: conversation.id, messageId: message.id, kind, claim, expected, actual, status, note });
};

for (const conversation of conversations) {
    const users = conversation.messages.filter(message => message.role === 'user');
    const assistants = conversation.messages.filter(message => message.role === 'assistant');
    for (const message of assistants) {
        const text = String(message.content || '');
        const index = conversation.messages.indexOf(message);
        const question = [...conversation.messages.slice(0, index)].reverse().find(item => item.role === 'user')?.content || '';

        // 1. Every `12-NNN` shape mentioned together with a cost is checked against the official schemes.
        for (const match of text.matchAll(/(\d{1,2})-(\d{3})\D{0,12}?成本\s*[:：]?\s*¥?\s*(\d+(?:\.\d+)?)/gu)) {
            const key = `${match[1]}-${match[2]}`;
            const claimed = Number.parseFloat(match[3]);
            const candidates = coilByShape.get(key) || [];
            if (candidates.length === 0) {
                record(conversation, message, 'coil_cost', `${key} 成本 ${claimed}`, '该规格无正式方案', String(claimed), 'MISMATCH', '答案给出了生产库中不存在的规格-片数');
                continue;
            }
            const ok = candidates.some(coil => Math.abs(Number(coil.cost) - claimed) < 0.02);
            record(conversation, message, 'coil_cost', `${key} 成本 ${claimed}`,
                candidates.map(coil => `${coil.scheme_code}=${money(coil.cost)}`).join(' / '), String(claimed),
                ok ? 'OK' : 'MISMATCH');
        }

        // 2. Every scheme code mentioned with a cost must match that scheme's stored cost.
        for (const match of text.matchAll(/(COIL-[0-9A-Z]+)\D{0,40}?(\d+(?:\.\d+)?)\s*元/gu)) {
            const coil = coilByCode.get(match[1]);
            if (!coil) { record(conversation, message, 'scheme_code', match[1], '生产库无此方案编码', match[1], 'MISMATCH'); continue; }
            const claimed = Number.parseFloat(match[2]);
            record(conversation, message, 'scheme_cost', `${match[1]} 成本 ${claimed}`, money(coil.cost), String(claimed),
                Math.abs(Number(coil.cost) - claimed) < 0.02 ? 'OK' : 'MISMATCH');
        }

        // 3. Recipe-count claims.
        const countClaim = text.match(/配方(?:列表)?共\s*\**\s*(\d+)\s*(?:条|个)/u) || text.match(/正式配方库共\s*(\d+)\s*个/u);
        if (countClaim) {
            const claimed = Number(countClaim[1]);
            record(conversation, message, 'recipe_count', `配方数 ${claimed}`, String(activeRecipes.length), String(claimed),
                claimed === activeRecipes.length ? 'OK' : 'MISMATCH');
        }

        // 4. Order-count claims.
        const orderClaim = text.match(/订单(?:列表)?(?:中)?(?:没有|返回|共)\s*(\d+)?\s*条/u);
        if (orderClaim && /订单/u.test(question)) {
            const claimed = orderClaim[1] === undefined ? 0 : Number(orderClaim[1]);
            record(conversation, message, 'order_count', `订单数 ${claimed}`, String(activeOrders.length), String(claimed),
                claimed === activeOrders.length ? 'OK' : 'MISMATCH');
        }

        // 5. Part price claims: `型号：价格 元`.
        for (const match of text.matchAll(/([\u4e00-\u9fa5A-Za-z0-9*.\-]*[\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9*.\-]*)\s*[:：]\s*(\d+(?:\.\d+)?)\s*元/gu)) {
            const model = match[1].trim();
            const claimed = Number.parseFloat(match[2]);
            const part = partByModel.get(model);
            if (!part) continue;
            record(conversation, message, 'part_price', `${model} 单价 ${claimed}`, money(part.price), String(claimed),
                Math.abs(Number(part.price) - claimed) < 0.005 ? 'OK' : 'MISMATCH');
        }

        // 6. Inventory claims for parts that exist.
        for (const match of text.matchAll(/([\u4e00-\u9fa5A-Za-z0-9*.\-]*[\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9*.\-]*)[^\n]{0,20}库存[^\d]{0,6}(\d+)/gu)) {
            const part = partByModel.get(match[1].trim());
            if (!part) continue;
            record(conversation, message, 'part_stock', `${part.model} 库存 ${match[2]}`, String(part.stock), match[2],
                Number(part.stock) === Number(match[2]) ? 'OK' : 'MISMATCH', '仅在型号可精确匹配时判定');
        }
    }
    // 7. Questions whose answer must not be a silent per-answer fabrication check go to manual reading.
    checks.push({ conversationId: conversation.id, kind: 'manual', claim: `${users.length} 问 / ${assistants.length} 答需要人工判读语义`, expected: '', actual: '', status: 'MANUAL' });
}

const byStatus = checks.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
console.log('== 数字核对 ==');
for (const item of checks.filter(check => check.status !== 'MANUAL')) {
    console.log(`[${item.status}] c${item.conversationId}/m${item.messageId} ${item.kind}: ${item.claim} | 期望 ${item.expected} | 实际 ${item.actual}${item.note ? ' | ' + item.note : ''}`);
}
console.log('\n== 汇总 ==');
console.log(JSON.stringify(byStatus, null, 2));
console.log('\n== 对话清单 ==');
for (const conversation of conversations) {
    const assistants = conversation.messages.filter(message => message.role === 'assistant');
    console.log(`c${conversation.id} 「${conversation.title}」 ${assistants.length} 答 | ${conversation.created_at} -> ${conversation.updated_at}`);
}
fs.writeFileSync('logs/ai-conversation-acceptance.json', `${JSON.stringify({ checkedAt: new Date().toISOString(), byStatus, checks }, null, 2)}\n`, 'utf8');
console.log('\nreport -> logs/ai-conversation-acceptance.json');
