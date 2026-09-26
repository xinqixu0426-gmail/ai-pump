'use strict';
/**
 * NATIVE-W1.5-R1 —— delta vs 绝对目标值语义安全契约（确定性，无服务、无数据库）。
 *
 * 缺陷背景：V1.5 的增量正则把 `到/至/为` 当作连接词，于是「库存增加到 30」被误读成 +30。
 * 本文件锁定修复后的契约：
 *   1) 绝对目标值语法**先于**增量抽取被识别，永远不产生 delta；
 *   2) 可支持的 delta 说法保持可用；
 *   3) 数值二义性/冲突一律澄清，绝不由模型推断。
 */
process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    detectProtectedCommandRoute,
    extractSinglePartStockAdjustmentArgs,
    parsePartStockAdjustment,
} = require('../api/services/aiProtectedCommandRoute.cjs');
const { INTENT_FEEDBACK } = require('../api/services/aiNativeWriteChatBridgeV2.cjs');

const MODEL = '6202轴承';
const ABSOLUTE_CODE = 'NATIVE_WRITE_ABSOLUTE_STOCK_UNSUPPORTED';

function routeCapability(content) {
    return detectProtectedCommandRoute([{ role: 'user', content }])?.preferredCapability;
}

/** §2：V1 只支持 delta，这些说法必须继续可用。 */
const DELTA_PHRASES = Object.freeze([
    [`把${MODEL}库存增加100`, 100],
    [`${MODEL}库存加100`, 100],
    [`把${MODEL}库存减少20`, -20],
    [`${MODEL}库存减20`, -20],
    [`${MODEL}库存入库5`, 5],
    [`${MODEL}库存出库3`, -3],
    [`把${MODEL}库存增加了30`, 30],
    [`把${MODEL}库存上调10`, 10],
    [`把${MODEL}库存下调10`, -10],
]);

/** §3：绝对目标值语法（最终值），一个都不能变成 delta。 */
const ABSOLUTE_PHRASES = Object.freeze([
    `把${MODEL}库存增加到30`,
    `把${MODEL}库存加到30`,
    `把${MODEL}库存提高到30`,
    `把${MODEL}库存上调到30`,
    `把${MODEL}库存减少到20`,
    `把${MODEL}库存减到20`,
    `把${MODEL}库存降低到20`,
    `把${MODEL}库存降到20`,
    `把${MODEL}库存下调到20`,
    `把${MODEL}库存调整到30`,
    `把${MODEL}库存到30`,
    `把${MODEL}库存改成30`,
    `把${MODEL}库存改为30`,
    `把${MODEL}库存设成30`,
    `把${MODEL}库存设为30`,
    `把${MODEL}库存设置为30`,
    // 空格/间隔写法必须一致处理。
    `把 ${MODEL} 库存 增加 到 30`,
    `把${MODEL}库存增加至30`,
    `把${MODEL}库存增加为30`,
]);

test('W15R1-DELTA-1 §2 delta 说法继续产生正确的正负增量', () => {
    for (const [text, expected] of DELTA_PHRASES) {
        assert.deepEqual(extractSinglePartStockAdjustmentArgs(text), { items: [{ model: MODEL, changeQty: expected }] }, text);
    }
});

test('W15R1-ABS-1 §3 绝对目标值语法一律拒绝，绝不产生 delta', () => {
    for (const text of ABSOLUTE_PHRASES) {
        const parsed = parsePartStockAdjustment(text);
        assert.equal(parsed.ok, false, `${text} 不得生成提案参数`);
        assert.equal(parsed.reason, 'absolute_target', text);
        assert.equal(extractSinglePartStockAdjustmentArgs(text), null, text);
        // 仍然必须被识别为该能力族，从而给出确定性的「不支持绝对目标值」结论，
        // 而不是落进只读规划或别的能力分支。
        assert.equal(routeCapability(text), 'adjust_part_stock', text);
        assert.equal(INTENT_FEEDBACK[parsed.reason].code, ABSOLUTE_CODE, text);
    }
});

test('W15R1-ORDER-1 §5 解析顺序：绝对目标值先于增量（同一句里两者都像时以绝对为准）', () => {
    // 「增加到 30」同时包含「增加 + 数字」的增量形状与「到」的绝对标记：
    // 修复前会被读成 +30；现在必须判定为绝对目标值。
    const ambiguousShape = `把${MODEL}库存增加到30`;
    assert.equal(parsePartStockAdjustment(ambiguousShape).reason, 'absolute_target');
    assert.equal(extractSinglePartStockAdjustmentArgs(ambiguousShape), null);
    // 对照：去掉绝对标记后，同一动作仍必须正常产生 delta。
    assert.deepEqual(
        extractSinglePartStockAdjustmentArgs(`把${MODEL}库存增加30`),
        { items: [{ model: MODEL, changeQty: 30 }] },
    );
    // 代码层面的顺序证明：绝对目标判定独立且先执行。
    const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'api/services/aiProtectedCommandRoute.cjs'), 'utf8');
    const absoluteAt = source.indexOf('if (isAbsoluteStockTarget(text)) return');
    const deltaAt = source.indexOf('const matches = partStockQuantityMatches(text);');
    assert.ok(absoluteAt > 0 && deltaAt > 0 && absoluteAt < deltaAt, '绝对目标判定必须排在增量抽取之前');
});

test('W15R1-SAFE-1 §6 数值安全：缺数量/模糊数量/零/负号/冲突一律澄清，绝不由模型推断', () => {
    const cases = [
        [`把${MODEL}库存增加`, 'quantity_required'],
        [`把${MODEL}库存加一点`, 'quantity_required'],
        [`把${MODEL}库存增加100还是200`, 'quantity_ambiguous'],
        [`把${MODEL}库存增加100或者200`, 'quantity_ambiguous'],
        [`把${MODEL}库存加0`, 'quantity_zero'],
        [`把${MODEL}库存加-20`, 'sign_conflict'],
        [`把${MODEL}库存减-20`, 'sign_conflict'],
        [`把${MODEL}库存增加100减少20`, 'sign_conflict'],
        [`把${MODEL}库存增加又减少100`, 'sign_conflict'],
        [`把${MODEL}库存调整100`, 'action_ambiguous'],
    ];
    for (const [text, reason] of cases) {
        const parsed = parsePartStockAdjustment(text);
        assert.equal(parsed.ok, false, text);
        assert.equal(parsed.reason, reason, text);
        assert.equal(extractSinglePartStockAdjustmentArgs(text), null, text);
        // 每个原因都必须有确定性的用户文案（不允许静默通过）。
        assert.ok(INTENT_FEEDBACK[reason]?.code, `${reason} 缺少确定性错误码`);
    }
});

test('W15R1-CONTRACT-1 绝对目标值的用户文案与错误码稳定', () => {
    const feedback = INTENT_FEEDBACK.absolute_target;
    assert.equal(feedback.code, ABSOLUTE_CODE);
    assert.equal(feedback.message, '当前只支持按数量增加或减少库存，请明确说增加多少或减少多少。');
});
