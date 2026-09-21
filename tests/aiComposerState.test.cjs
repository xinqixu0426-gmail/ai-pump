const test = require('node:test');
const assert = require('node:assert/strict');

const {
    restoreRejectedDraft,
} = require('../apps/web-next/components/ai/ai-composer-state.ts');

test('AI 输入：用户消息持久化失败时恢复原草稿', () => {
    assert.equal(restoreRejectedDraft('查询 V750 成本', ''), '查询 V750 成本');
    assert.equal(restoreRejectedDraft('查询 V750 成本', '   '), '查询 V750 成本');
});

test('AI 输入：持久化等待期间的新输入与失败草稿都不会丢失', () => {
    assert.equal(
        restoreRejectedDraft('查询 V750 成本  ', '再比较 V1100'),
        '查询 V750 成本\n再比较 V1100'
    );
});

test('AI 输入：仅附件发送失败时不在等待期间的新输入前插入空行', () => {
    assert.equal(restoreRejectedDraft('', '继续补充说明'), '继续补充说明');
    assert.equal(restoreRejectedDraft('   ', '继续补充说明'), '继续补充说明');
});
