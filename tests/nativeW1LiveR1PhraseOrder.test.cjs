'use strict';
/**
 * NATIVE-W1-LIVE-R1 —— 首次真实使用缺陷回归（词序 + 失败文案 + 失败可观测性）。
 *
 * 生产实录（Owner 第一次尝试，任务 ddf5384b-…，零写入、安全失败）：
 *   用户原话：「将轴承202增加1库存」   ← 库存一词在动作之后
 *   旧行为：目标提及被抽成 "轴承202增加1"（把动作与数量一起吞掉）→ 预览目标找不到
 *   新行为：目标提及 = "轴承202"，Delta 仍为 +1；型号写错则由精确解析给出明确提示
 *
 * 这些用例锁定：修复只改变「目标边界」的抽取，不改变任何写安全语义。
 */
process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    detectProtectedCommandRoute,
    parsePartStockAdjustment,
} = require('../api/services/aiProtectedCommandRoute.cjs');
const { INTENT_FEEDBACK, previewFailureMessage } = require('../api/services/aiNativeWriteChatBridgeV2.cjs');

/** 生产实录原句（不得改写：这就是回归锚点）。 */
const PRODUCTION_FIRST_ATTEMPT = '将轴承202增加1库存';
const PRODUCTION_SECOND_ATTEMPT = '将 轴承-202 库存增加1';

test('W1LIVE-R1-1 生产第一次失败原句：目标提及必须只含型号，不再吞掉动作与数量', () => {
    const parsed = parsePartStockAdjustment(PRODUCTION_FIRST_ATTEMPT);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mention, '轴承202', '目标边界必须止于增减动词或「库存」，不能包含「增加1」');
    assert.deepEqual(parsed.args, { items: [{ model: '轴承202', changeQty: 1 }] });
    assert.equal(detectProtectedCommandRoute([{ role: 'user', content: PRODUCTION_FIRST_ATTEMPT }])?.preferredCapability, 'adjust_part_stock');
});

test('W1LIVE-R1-2 词序无关：库存在前 / 在后 / 无把将 / 带「的」都得到同一个型号与增量', () => {
    const cases = [
        ['将轴承-202增加1库存', '轴承-202', 1],
        ['将 轴承-202 库存增加1', '轴承-202', 1],
        ['把轴承-202库存增加1', '轴承-202', 1],
        ['轴承-202库存加100', '轴承-202', 100],
        ['把轴承-202的库存增加30', '轴承-202', 30],
        ['将轴承-202增加1库存', '轴承-202', 1],
        ['轴承-202增加1库存', '轴承-202', 1],
    ];
    for (const [text, model, delta] of cases) {
        const parsed = parsePartStockAdjustment(text);
        assert.equal(parsed.ok, true, text);
        assert.equal(parsed.mention, model, text);
        assert.deepEqual(parsed.args, { items: [{ model, changeQty: delta }] }, text);
    }
});

test('W1LIVE-R1-3 词序修复不改变安全语义：绝对目标值 / 缺目标 / 缺数量仍然被拒', () => {
    const rejected = [
        ['将轴承-202增加到30库存', 'absolute_target'],
        ['把轴承-202库存增加到30', 'absolute_target'],
        ['将轴承-202改为30库存', 'absolute_target'],
        ['增加1库存', 'target_required'],
        ['将库存增加1', 'target_required'],
        ['将轴承-202增加1库存再减少2库存', 'sign_conflict'],
        ['将轴承-202库存', 'quantity_required'],
    ];
    for (const [text, reason] of rejected) {
        const parsed = parsePartStockAdjustment(text);
        assert.equal(parsed.ok, false, text);
        assert.equal(parsed.reason, reason, text);
    }
});

test('W1LIVE-R1-4 目标找不到时回显用户写的型号（帮助发现「轴承202」vs「轴承-202」这类差异）', () => {
    assert.equal(
        previewFailureMessage('part_stock_target_not_found', '轴承202'),
        '没有找到型号为「轴承202」的零件，请确认准确型号后再试。'
    );
    // 没有可回显的型号时退回稳定文案。
    assert.equal(previewFailureMessage('part_stock_target_not_found', ''), '没有找到要调整的零件，请确认型号后重新提交。');
    // 其它预览失败码的文案不变。
    assert.match(previewFailureMessage('part_stock_target_ambiguous', 'x'), /找到多个匹配的零件/u);
    // 绝对目标值属于**解析阶段**澄清（不会走到预览），文案由 INTENT_FEEDBACK 提供。
    assert.match(INTENT_FEEDBACK.absolute_target.message, /只支持按数量增加或减少库存/u);
    assert.equal(previewFailureMessage('SOMETHING_UNMAPPED', 'x'), '本次库存调整方案没有生成，也未执行任何修改。请核对零件型号和数量后重试。');
    // 回显长度受限，且不改变任何解析语义。
    assert.ok(previewFailureMessage('part_stock_target_not_found', 'x'.repeat(500)).length < 200);
});

test('W1LIVE-R1-5 第二次成功原句仍然产生完全相同的提案事实（回归保护）', () => {
    const parsed = parsePartStockAdjustment(PRODUCTION_SECOND_ATTEMPT);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mention, '轴承-202');
    assert.deepEqual(parsed.args, { items: [{ model: '轴承-202', changeQty: 1 }] });
});
