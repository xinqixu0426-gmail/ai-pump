'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectEditableInputValue } = require('../apps/web-next/lib/input-selection.cjs');

test('整值输入首次聚焦时选择当前值', () => {
  let selectCalls = 0;
  const input = {
    disabled: false,
    readOnly: false,
    select() {
      selectCalls += 1;
    },
  };

  assert.equal(selectEditableInputValue(input), true);
  assert.equal(selectCalls, 1);
});

test('禁用或只读输入不执行选择', () => {
  let selectCalls = 0;
  const select = () => {
    selectCalls += 1;
  };

  assert.equal(selectEditableInputValue({ disabled: true, readOnly: false, select }), false);
  assert.equal(selectEditableInputValue({ disabled: false, readOnly: true, select }), false);
  assert.equal(selectCalls, 0);
});

test('缺少输入或原生选择能力时安全退出', () => {
  assert.equal(selectEditableInputValue(null), false);
  assert.equal(selectEditableInputValue({ disabled: false, readOnly: false }), false);
});
