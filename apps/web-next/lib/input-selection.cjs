'use strict';

function selectEditableInputValue(input) {
  if (!input || input.disabled || input.readOnly || typeof input.select !== 'function') return false;
  input.select();
  return true;
}

module.exports = { selectEditableInputValue };
