'use strict';

// This adapter deliberately compresses only the business-language category of
// recent owner expressions. It never exposes an identity, candidate result,
// formal fact, policy conclusion, or the full Business Memo to the reference
// model.
const EXPRESSION_PATTERNS = Object.freeze([
    /[A-Za-z]+\d+(?:-\d+)?(?:[\u4e00-\u9fff]{1,8})?/gu,
    /\d+(?:-\d+)+(?:[\u4e00-\u9fff]{1,8})?/gu,
    /(?:通用款|豪贝款)?模板/gu,
    /(?:通用款|豪贝款)?(?:配方|方案)/gu,
]);

function uniqueExpressions(recentOwnerWording) {
    const found = [];
    const seen = new Set();
    for (const pattern of EXPRESSION_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of String(recentOwnerWording || '').matchAll(pattern)) {
            const expression = match[0].trim();
            if (expression && !seen.has(expression)) {
                seen.add(expression);
                found.push(expression);
            }
        }
    }
    return Object.freeze(found);
}

function localMemoText(expression, businessMemo) {
    const memo = String(businessMemo || '');
    const index = memo.indexOf(expression);
    if (index < 0) return memo.slice(0, 600);
    const lines = memo.split(/\r?\n/u);
    const lineIndex = lines.findIndex(line => line.includes(expression));
    if (lineIndex < 0) return memo.slice(Math.max(0, index - 120), index + expression.length + 180);
    const line = lines[lineIndex];
    if (/coil|线圈|绕组|定子|template|模板|泵壳|recipe|配方|产品配置|oem|part|零件|轴承/iu.test(line)) return line;
    return lines.slice(Math.max(0, lineIndex - 1), Math.min(lines.length, lineIndex + 3)).join('\n');
}

function categoryFor(expression, businessMemo) {
    const local = localMemoText(expression, businessMemo);
    if (/coil|线圈|绕组|定子/u.test(local)) return '线圈/线圈方案相关业务表达';
    if (/template|模板|泵壳/u.test(local)) return '模板相关业务表达';
    if (/recipe|配方|产品配置|oem/u.test(local)) return '配方/产品配置相关业务表达';
    if (/part|零件|轴承/u.test(local)) return '零件相关业务表达';
    return '业务相关表达';
}

function buildNarrowBusinessReferenceHint({ recentOwnerWording, businessMemo }) {
    const entries = uniqueExpressions(recentOwnerWording).map(expression => Object.freeze({
        expression,
        category: categoryFor(expression, businessMemo),
    }));
    return Object.freeze({
        source: 'BUSINESS_MEMO_CONTROLLED_CATEGORY_COMPRESSION',
        entries: Object.freeze(entries),
        text: entries.length
            ? entries.map(entry => `${entry.expression}：${entry.category}`).join('\n')
            : 'NONE',
    });
}

module.exports = { uniqueExpressions, categoryFor, buildNarrowBusinessReferenceHint };
