'use strict';

const TYPE_ALIASES = Object.freeze({
    recipe: 'recipe', '配方': 'recipe',
    coil: 'coil', '线圈': 'coil', '线圈方案': 'coil',
    template: 'template', '模板': 'template',
    part: 'part', '零件': 'part',
});

function extractNeed(memo) {
    const match = String(memo || '').match(/Grounding\s*Need\s*[：:]\s*(REQUIRED|NOT_REQUIRED)/iu);
    return match ? match[1].toUpperCase() : 'UNPARSED';
}

function extractLanguageTargets(memo) {
    const targets = [];
    const lines = String(memo || '').split(/\r?\n/u);
    for (const line of lines) {
        const match = line.match(/^\s*(?:[-*]\s*)?(?:Language\s*Target|Target)\s*[：:]\s*`?(.+?)`?\s*\|\s*(recipe|coil|template|part|配方|线圈|线圈方案|模板|零件)\s*$/iu);
        if (!match) continue;
        const mention = String(match[1] || '').trim();
        const typeText = String(match[2] || '').trim().toLowerCase();
        const entityType = TYPE_ALIASES[typeText] || null;
        if (mention && entityType && !targets.some(item => item.mention === mention && item.entityType === entityType)) {
            targets.push(Object.freeze({ mention, entityType }));
        }
    }
    return Object.freeze(targets);
}

function referenceStatus(memo) {
    const text = String(memo || '');
    if (/Reference\s*[：:]\s*(?:UNRESOLVED|未解决|无法恢复)/iu.test(text)) return 'UNRESOLVED';
    if (/Resolved\s+Language\s+Reference\s*[：:]/iu.test(text)) return 'RESOLVED';
    return 'NONE';
}

module.exports = { extractNeed, extractLanguageTargets, referenceStatus };
