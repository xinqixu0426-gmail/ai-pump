'use strict';

const {
    DOMAIN_SEMANTICS,
    ENTITY_TYPE_SEMANTICS,
} = require('./taskInterpreterSemantics.cjs');

const V5_TASK_CLASS_SEMANTICS_VERSION = '1.1';

const OPERATION_RESULT_SEMANTICS = Object.freeze({
    adjust_inventory: 'change a stored inventory quantity',
    analyze_recipe: 'assess whether a named recipe configuration is coherent or has quality problems',
    archive: 'archive an existing file record',
    build_draft: 'produce a non-executing draft for later review',
    calculate: 'calculate a monetary cost from a generic, unnamed cost context',
    cost: 'determine monetary coil or winding-material cost, price, or accounting amount',
    execute_readiness: 'perform an order-readiness action rather than only inspect or plan it',
    execute_workflow: 'perform a factory workflow step rather than only inspect or plan it',
    explain_cost: 'explain why a quotation monetary cost changed',
    generate: 'generate a new drawing artifact',
    generate_purchase: 'generate a purchasing list for an order',
    inspect_file: 'inspect an existing quotation file without archiving it',
    maintain: 'create, update, or delete the referenced domain object',
    plan_readiness: 'prepare order-readiness actions without executing them',
    plan_workflow: 'prepare a factory workflow without executing it',
    preview_cost: 'retrieve, calculate, or compare the complete monetary cost of a named recipe',
    print: 'print an existing drawing',
    read: 'retrieve existing non-monetary factual state, details, or records without calculating cost',
    read_customer: 'retrieve quotation-customer records or customer history',
    read_files: 'retrieve technical files attached to a named recipe',
    read_inventory: 'retrieve current generic-part catalog facts such as stock or catalog price',
    read_knowledge: 'retrieve the knowledge package attached to an order',
    read_purchase: 'retrieve purchasing status or overview for an order',
    read_readiness: 'retrieve current order-readiness status without planning or executing actions',
    read_template: 'retrieve pump-shell template records used by recipes',
    save_file_draft: 'save an order-scoped file draft',
    search: 'find matching records in the factory file archive',
    sync: 'synchronize the factory knowledge index',
});

function entityMeaning(entityTypes) {
    return entityTypes.map(type => ENTITY_TYPE_SEMANTICS[type]).join(' + ');
}

function primaryMeaningFor(taskClass) {
    const operationMeaning = OPERATION_RESULT_SEMANTICS[taskClass.operation];
    const domainMeaning = DOMAIN_SEMANTICS[taskClass.domain];
    if (!operationMeaning || !domainMeaning) {
        throw new TypeError(`Task Class semantic source missing: ${taskClass.classRef || 'unassigned'}`);
    }
    return `Expected result: ${operationMeaning}. Business owner: ${domainMeaning} Target: ${entityMeaning(taskClass.entityTypes)}`;
}

function entityTypesOverlap(left, right) {
    return left.entityTypes.some(type => right.entityTypes.includes(type));
}

function discoverLocalAlternatives(taskClass, catalog) {
    return catalog.filter(candidate => candidate.classRef !== taskClass.classRef
        && entityTypesOverlap(taskClass, candidate)
        && (candidate.domain === taskClass.domain
            || JSON.stringify(candidate.entityTypes) === JSON.stringify(taskClass.entityTypes)))
        .sort((left, right) => left.classRef.localeCompare(right.classRef));
}

function buildTaskClassSemanticView(catalog) {
    const meanings = new Map(catalog.map(item => [item.classRef, primaryMeaningFor(item)]));
    return catalog.map(item => Object.freeze({
        classRef: item.classRef,
        primaryMeaning: meanings.get(item.classRef),
        localAlternatives: Object.freeze(discoverLocalAlternatives(item, catalog).map(alternative => Object.freeze({
            classRef: alternative.classRef,
            useWhen: `Alternative expected result: ${OPERATION_RESULT_SEMANTICS[alternative.operation]}.`,
        }))),
    }));
}

function validateTaskClassSemanticView(catalog, semanticView) {
    if (!Array.isArray(catalog) || !Array.isArray(semanticView) || catalog.length !== semanticView.length) {
        throw new TypeError('Task Class semantic view must cover the complete catalog');
    }
    const refs = new Set(catalog.map(item => item.classRef));
    const viewRefs = semanticView.map(item => item.classRef);
    if (new Set(viewRefs).size !== refs.size || viewRefs.some(ref => !refs.has(ref))) {
        throw new TypeError('Task Class semantic view changed class identity');
    }
    const meanings = new Map();
    for (const item of semanticView) {
        if (typeof item.primaryMeaning !== 'string' || item.primaryMeaning.trim().length === 0) {
            throw new TypeError(`Task Class primary meaning missing: ${item.classRef}`);
        }
        if (!Array.isArray(item.localAlternatives)) {
            throw new TypeError(`Task Class local alternatives missing: ${item.classRef}`);
        }
        const alternatives = item.localAlternatives.map(value => value.classRef);
        if (alternatives.includes(item.classRef)
            || new Set(alternatives).size !== alternatives.length
            || alternatives.some(ref => !refs.has(ref))) {
            throw new TypeError(`Task Class local alternatives invalid: ${item.classRef}`);
        }
        const key = item.primaryMeaning.trim();
        const prior = meanings.get(key);
        if (prior && catalog.find(value => value.classRef === prior)?.operation
            !== catalog.find(value => value.classRef === item.classRef)?.operation) {
            throw new TypeError(`Task Class semantic definition duplicates a different operation: ${item.classRef}`);
        }
        meanings.set(key, item.classRef);
    }
    return true;
}

module.exports = {
    OPERATION_RESULT_SEMANTICS,
    V5_TASK_CLASS_SEMANTICS_VERSION,
    buildTaskClassSemanticView,
    discoverLocalAlternatives,
    primaryMeaningFor,
    validateTaskClassSemanticView,
};
