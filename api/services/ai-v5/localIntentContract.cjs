'use strict';
const { parseStrict } = require('./twoStageModel.cjs');
function parseLocalIntent(content, catalog) {
    const value = parseStrict(content, ['version', 'localTaskClassRef']);
    if (typeof value.localTaskClassRef !== 'string' || !catalog.some(item => item.classRef === value.localTaskClassRef)) throw new Error('INVALID_LOCAL_TASK_CLASS_REF');
    return Object.freeze(value);
}
module.exports = { parseLocalIntent };
