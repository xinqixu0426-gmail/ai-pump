'use strict';

// Semantic identity is finer-grained than the existing read execution capability.
// Both operations project to the unchanged catalog/read_inventory/part tuple.
const PART_READ_SEMANTIC_VERSION = 1;
const PART_READ_SEMANTICS = Object.freeze({
    'part.inventory.read': Object.freeze({ classRef: 'tc_002', semanticOperation: 'read_inventory',
        meaning: 'retrieve the current stock quantity of a generic part, not its monetary price' }),
    'part.price.read': Object.freeze({ classRef: 'tc_028', semanticOperation: 'read_price',
        meaning: 'retrieve the current catalog unit price of a generic part, not its stock quantity' }),
});

function splitPartReadIdentities(identities) {
    const part = identities.find(item => item.classRef === 'tc_002' && item.domain === 'catalog'
        && item.operation === 'read_inventory' && item.entityTypes.length === 1 && item.entityTypes[0] === 'part');
    if (!part) throw new TypeError('PART_READ_SEMANTIC_SOURCE_INVALID');
    const variant = semanticId => ({ ...part, semanticId, ...PART_READ_SEMANTICS[semanticId],
        semanticSplitVersion: PART_READ_SEMANTIC_VERSION });
    return identities.map(item => item === part ? variant('part.inventory.read') : item)
        .concat(variant('part.price.read'));
}

module.exports = { PART_READ_SEMANTIC_VERSION, PART_READ_SEMANTICS, splitPartReadIdentities };
