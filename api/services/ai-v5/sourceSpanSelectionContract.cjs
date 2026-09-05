'use strict';
const { parseStrict } = require('./twoStageModel.cjs');
const { getSourceSpan } = require('./sourceSpanCatalog.cjs');
function parseSpanSelection(content, catalog) {
    const value = parseStrict(content, ['version', 'spanRef', 'needsClarification']);
    if (typeof value.needsClarification !== 'boolean') throw new Error('INVALID_SCHEMA');
    if (value.needsClarification && value.spanRef === null) return Object.freeze(value);
    if (typeof value.spanRef !== 'string' || !getSourceSpan(catalog, value.spanRef)) throw new Error('INVALID_SPAN_REF');
    return Object.freeze(value);
}
module.exports = { parseSpanSelection };
