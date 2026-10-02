'use strict';

const JOINERS = new Set(['-', '－', '–', '—']);

function normalizedWithMap(value) {
    const input = String(value || '');
    let normalized = '';
    const map = [];
    for (let index = 0; index < input.length;) {
        const codePoint = input.codePointAt(index);
        const character = String.fromCodePoint(codePoint);
        const width = character.length;
        const transformed = character.normalize('NFKC').toLowerCase();
        for (const unit of transformed) {
            if (/\s/u.test(unit) || JOINERS.has(unit)) continue;
            normalized += unit;
            map.push(Object.freeze({ start: index, end: index + width }));
        }
        index += width;
    }
    return Object.freeze({ normalized, map: Object.freeze(map) });
}

function allMatchOffsets(haystack, needle) {
    if (!needle) return Object.freeze([]);
    const offsets = [];
    for (let start = 0; start <= haystack.length - needle.length;) {
        const found = haystack.indexOf(needle, start);
        if (found < 0) break;
        offsets.push(found);
        start = found + needle.length;
    }
    return Object.freeze(offsets);
}

function alignRoleExpressionToWorkingUtterance(expression, workingUtterance) {
    const working = normalizedWithMap(workingUtterance);
    const role = normalizedWithMap(expression);
    const offsets = allMatchOffsets(working.normalized, role.normalized);
    if (!role.normalized || !offsets.length) return Object.freeze({ status: 'NO_MATCH', expression, alignedExpression: null, matchCount: offsets.length });
    if (offsets.length !== 1) return Object.freeze({ status: 'AMBIGUOUS', expression, alignedExpression: null, matchCount: offsets.length });
    const offset = offsets[0];
    const start = working.map[offset].start;
    const end = working.map[offset + role.normalized.length - 1].end;
    return Object.freeze({ status: 'UNIQUE_MATCH', expression, alignedExpression: String(workingUtterance).slice(start, end), matchCount: 1 });
}

module.exports = { normalizedWithMap, allMatchOffsets, alignRoleExpressionToWorkingUtterance };
