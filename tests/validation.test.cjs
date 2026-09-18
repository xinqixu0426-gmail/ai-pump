const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parsePositiveId,
    requirePositiveId,
    parseFiniteNumber,
    parseNonNegativeNumber,
    parsePositiveNumber,
    parseNonNegativeInteger,
    parseJsonArray,
    stringifyJsonArray,
    stringifyJsonObject,
} = require('../api/services/validation.cjs');

test('validation helper 统一解析正整数 ID', () => {
    assert.equal(parsePositiveId('12'), 12);
    assert.equal(parsePositiveId(3), 3);
    assert.equal(parsePositiveId('0'), null);
    assert.equal(parsePositiveId('-1'), null);
    assert.equal(parsePositiveId('1.2'), null);
    assert.equal(parsePositiveId('abc'), null);
    assert.equal(requirePositiveId('5', 'partId'), 5);
    assert.throws(() => requirePositiveId('bad', 'partId'), /partId 必须是正整数/);
});

test('validation helper 统一解析有效数字和非负数字', () => {
    assert.equal(parseFiniteNumber('-2', 'delta'), -2);
    assert.equal(parseFiniteNumber('', 'qty', { defaultValue: 1 }), 1);
    assert.throws(() => parseFiniteNumber('abc', 'delta'), /delta 必须是有效数字/);
    assert.equal(parseNonNegativeNumber('0.5', 'price'), 0.5);
    assert.throws(() => parseNonNegativeNumber('-0.1', 'price'), /price 必须是非负数字/);
    assert.equal(parsePositiveNumber('1', 'qty'), 1);
    assert.throws(() => parsePositiveNumber('0', 'qty'), /qty 必须是正数/);
    assert.throws(() => parsePositiveNumber('-1', 'qty'), /qty 必须是正数/);
    assert.equal(parseNonNegativeInteger('2', 'count'), 2);
    assert.throws(() => parseNonNegativeInteger('2.5', 'count'), /count 必须是非负整数/);
});

test('validation helper 统一兼容 JSON 数组解析', () => {
    assert.deepEqual(parseJsonArray('[{"a":1}]'), [{ a: 1 }]);
    assert.deepEqual(parseJsonArray([{ a: 2 }]), [{ a: 2 }]);
    assert.deepEqual(parseJsonArray('{"a":1}'), []);
    assert.deepEqual(parseJsonArray('{bad'), []);
});

test('validation helper 写库前严格序列化 JSON 字段', () => {
    assert.equal(stringifyJsonArray('[{"a":1}]', 'parts_json'), '[{"a":1}]');
    assert.equal(stringifyJsonArray([{ a: 2 }], 'parts_json'), '[{"a":2}]');
    assert.equal(stringifyJsonObject('{"a":1}', 'rotor_params_json'), '{"a":1}');
    assert.equal(stringifyJsonObject({ a: 2 }, 'rotor_params_json'), '{"a":2}');
    assert.throws(() => stringifyJsonArray('{"a":1}', 'parts_json'), /parts_json 必须是 JSON 数组/);
    assert.throws(() => stringifyJsonObject('[1]', 'rotor_params_json'), /rotor_params_json 必须是 JSON 对象/);
    assert.throws(() => stringifyJsonArray('{bad', 'parts_json'), /parts_json 必须是有效 JSON/);
});
