'use strict';
const { getSourceSpan } = require('./sourceSpanCatalog.cjs');
const STAGE1_SOURCE_SPAN_SELECTION_PROTOCOL_VERSION = 2;
const STAGE1_TOP_K = 2;
function parseSpanSelection(content, catalog) {
    let value;
    try { value = JSON.parse(content); } catch { throw new Error('INVALID_JSON'); }
    if (!value || Array.isArray(value) || value.version !== 2
        || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['needsClarification','spanRefs','version'])
        || !Array.isArray(value.spanRefs)) throw new Error('INVALID_SCHEMA');
    if (typeof value.needsClarification !== 'boolean') throw new Error('INVALID_SCHEMA');
    if (value.needsClarification) {
        if (value.spanRefs.length !== 0) throw new Error('INVALID_SCHEMA');
    } else if (value.spanRefs.length !== STAGE1_TOP_K || new Set(value.spanRefs).size !== STAGE1_TOP_K
        || value.spanRefs.some(ref => typeof ref !== 'string' || !getSourceSpan(catalog, ref))) throw new Error('INVALID_SPAN_REF');
    Object.freeze(value.spanRefs);
    return Object.freeze(value);
}
module.exports = { parseSpanSelection, STAGE1_SOURCE_SPAN_SELECTION_PROTOCOL_VERSION, STAGE1_TOP_K };
