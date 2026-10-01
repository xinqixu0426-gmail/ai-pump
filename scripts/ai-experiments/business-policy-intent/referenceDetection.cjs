'use strict';

// This deliberately only recognizes a linguistic surface. It never assigns an
// antecedent or a formal identity; those are separate stages in M4-3A-R3.
const SURFACES = Object.freeze([
    /刚才那个(?:线圈|配方|模板)?/u,
    /(?:上一个|前一个|第二个|后者)/u,
    /(?:这个|那个)(?:线圈|模板|配方)?/u,
    /它/u,
]);

function detectReferenceSurface(userInput) {
    const text = String(userInput || '');
    let selected = null;
    for (const pattern of SURFACES) {
        const match = text.match(pattern);
        if (!match) continue;
        const candidate = { surface: match[0], index: match.index };
        if (!selected || candidate.index < selected.index || (candidate.index === selected.index && candidate.surface.length > selected.surface.length)) selected = candidate;
    }
    return Object.freeze(selected ? { status: 'DETECTED', surface: selected.surface } : { status: 'NONE', surface: null });
}

module.exports = { detectReferenceSurface };
