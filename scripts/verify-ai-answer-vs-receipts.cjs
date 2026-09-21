'use strict';
/**
 * Acceptance check #2 for production AI conversations: does each final answer agree with the formal
 * tool receipts of its OWN turn?
 *
 * This is the check the first pass could not do, because it needs the turn's `metadata_json`:
 *   - every successful tool result in the turn is extracted with its amount (preview/BOM/coil);
 *   - the answer's own amounts are extracted from its text;
 *   - an answer that reports an EARLIER amount while a later successful result carries a different one
 *     is flagged STALE: the pipeline computed an answer the text does not show;
 *   - an answer that reports an amount no tool result supports is flagged UNSOURCED;
 *   - duplicate failed calls, and a natural-language value used as a formal identifier, are reported too.
 *
 * Usage: node scripts/verify-ai-answer-vs-receipts.cjs <conversations.json>
 */
const fs = require('node:fs');
const conversations = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const amountOf = result => {
    const data = result?.data || {};
    const candidates = [data.currentTotalCost, data.unitCost, data.coilSnapshot?.totalCost, result?.totalCost];
    return candidates.find(value => typeof value === 'number' && Number.isFinite(value)) ?? null;
};
/** Every amount a receipt itself carries: a list result legitimately sources per-row prices/costs. */
const receiptAmounts = result => {
    const out = [];
    const walk = value => {
        if (Array.isArray(value)) { for (const item of value) walk(item); return; }
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (typeof child === 'number' && Number.isFinite(child)
                && /^(price|cost|unitPrice|total|totalPrice|currentTotalCost|unitCost|kitPrice|snapshotPrice|partsCost|laborCost)$/u.test(key)) out.push(child);
            else if (child && typeof child === 'object') walk(child);
        }
    };
    // Normalise the two receipt shapes (`{data:[…]}` and `{parts:[…]}`) before walking.
    walk(result?.data ?? null);
    walk(result?.parts ?? null);
    walk(result?.items ?? null);
    return out;
};
/** All amounts any successful receipt of this turn carries, including list rows. */
const receiptAmountsOfTurn = results => results
    .filter(item => item.result && item.result.success !== false)
    .flatMap(item => receiptAmounts(item.result));
const amountsIn = text => [...String(text).matchAll(/(\d+(?:\.\d+)?)\s*(?:元|¥)/gu)].map(match => Number(match[1]));
const close = (a, b) => Math.abs(a - b) < 0.02;
/**
 * A value used as a formal identifier is wrong when it is a SENTENCE, not merely because it contains
 * Chinese: `V550大脚板-2寸-经典款` is a real recipe name and must keep working. Clause markers and
 * question/instruction shapes are what make it a sentence.
 */
const isNaturalLanguageIdentifier = value => typeof value === 'string' && (
    value.length > 24
    || /(换成|换成|改用|替换|重新算|重新核算|是多少|多少钱|的线圈|的配件|为什么|怎么)/u.test(value)
    || /[？?。！!，,；;]/u.test(value)
);

const findings = [];
for (const conversation of conversations) {
    for (const message of conversation.messages) {
        if (message.role !== 'assistant') continue;
        let meta = {};
        try { meta = JSON.parse(message.metadata_json || '{}'); } catch { /* keep {} */ }
        const calls = Array.isArray(meta.toolCalls) ? meta.toolCalls : [];
        const results = Array.isArray(meta.toolResults) ? meta.toolResults : [];
        if (!results.length) {
            findings.push({ conversationId: conversation.id, messageId: message.id, kind: 'no-tool-evidence',
                detail: '本轮没有任何工具回执，答案无法从正式事实复核' });
            continue;
        }
        const succeeded = results.filter(item => item.result && item.result.success !== false)
            .map(item => ({ name: item.name, amount: amountOf(item.result), summary: item.result.summary || '' }))
            .filter(item => item.amount !== null);
        const failed = results.filter(item => item.result && item.result.success === false)
            .map(item => ({ name: item.name, code: item.result.code || null }));
        const answerAmounts = amountsIn(message.content);

        if (succeeded.length > 1) {
            const last = succeeded[succeeded.length - 1];
            const earlier = succeeded.slice(0, -1).filter(item => !close(item.amount, last.amount));
            if (earlier.length && answerAmounts.some(amount => earlier.some(item => close(item.amount, amount)))
                && !answerAmounts.some(amount => close(amount, last.amount))) {
                findings.push({ conversationId: conversation.id, messageId: message.id, kind: 'STALE_AMOUNT',
                    detail: `答案报了 ${answerAmounts.join('/')}，但本轮最后一个成功试算是 ${last.amount}（${last.name}）`,
                    lastAmount: last.amount, answerAmounts });
            }
        }
        const unsourced = answerAmounts.filter(amount => !succeeded.some(item => close(item.amount, amount)));
        if (answerAmounts.length && unsourced.length) {
            // Only a real gap counts: the amount must not appear anywhere in this turn's successful receipts.
            const turnAmounts = receiptAmountsOfTurn(results);
            const missing = unsourced.filter(amount => !turnAmounts.some(value => close(value, amount)));
            if (missing.length) {
                findings.push({ conversationId: conversation.id, messageId: message.id, kind: 'UNSOURCED_AMOUNT',
                    detail: `答案给出本轮成功回执中找不到依据的金额 ${missing.join('/')}` });
            }
        }
        for (const call of calls) {
            for (const [field, value] of Object.entries(call.args || {})) {
                if ((field === 'recipeName' || field === 'shellModel' || field === 'baseRecipeId') && isNaturalLanguageIdentifier(value)) {
                    findings.push({ conversationId: conversation.id, messageId: message.id, kind: 'NL_AS_IDENTIFIER',
                        detail: `${call.name}.${field} 收到整句自然语言：${String(value).slice(0, 60)}` });
                }
            }
        }
        const repeatedFailures = {};
        for (const call of calls) {
            const key = `${call.name}:${JSON.stringify(call.args || {})}`;
            repeatedFailures[key] = (repeatedFailures[key] || 0) + 1;
        }
        for (const [key, count] of Object.entries(repeatedFailures)) {
            if (count > 1) {
                findings.push({ conversationId: conversation.id, messageId: message.id, kind: 'REPEATED_CALL',
                    detail: `同一调用重复 ${count} 次：${key.slice(0, 120)}` });
            }
        }
        if (failed.length && succeeded.length === 0) {
            findings.push({ conversationId: conversation.id, messageId: message.id, kind: 'ALL_TOOLS_FAILED',
                detail: failed.map(item => `${item.name}=${item.code}`).join(', ') });
        }
    }
}

const byKind = findings.reduce((acc, item) => { acc[item.kind] = (acc[item.kind] || 0) + 1; return acc; }, {});
for (const finding of findings) {
    console.log(`[${finding.kind}] c${finding.conversationId}/m${finding.messageId}: ${finding.detail}`);
}
console.log('\n汇总: ' + JSON.stringify(byKind));
fs.writeFileSync('logs/ai-answer-vs-receipts.json', `${JSON.stringify({ checkedAt: new Date().toISOString(), byKind, findings }, null, 2)}\n`, 'utf8');
console.log('report -> logs/ai-answer-vs-receipts.json');
