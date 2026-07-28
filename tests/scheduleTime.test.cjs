const test = require('node:test');
const assert = require('node:assert/strict');
const { nextBjtTime } = require('../api/services/scheduleTime.cjs');

test('北京时间凌晨三点前调度当天备份', () => {
    const now = new Date('2026-07-28T18:30:00.000Z');
    assert.equal(nextBjtTime(3, 0, now).toISOString(), '2026-07-28T19:00:00.000Z');
});

test('北京时间凌晨三点后调度次日备份且延迟始终为正', () => {
    const now = new Date('2026-07-28T19:12:00.000Z');
    const target = nextBjtTime(3, 0, now);
    assert.equal(target.toISOString(), '2026-07-29T19:00:00.000Z');
    assert(target.getTime() > now.getTime());
});

test('北京时间下午三点调度跨 UTC 日期仍保持正确', () => {
    const before = new Date('2026-07-29T06:59:00.000Z');
    const after = new Date('2026-07-29T07:01:00.000Z');
    assert.equal(nextBjtTime(15, 0, before).toISOString(), '2026-07-29T07:00:00.000Z');
    assert.equal(nextBjtTime(15, 0, after).toISOString(), '2026-07-30T07:00:00.000Z');
});
