'use strict';

const { listV5Capabilities } = require('./capabilityRegistry.cjs');
const { getV5EntityType } = require('./businessOntology.cjs');
const {
    DOMAIN_SEMANTICS,
    ENTITY_TYPE_SEMANTICS,
    OPERATION_SEMANTICS,
} = require('./taskInterpreterSemantics.cjs');

const V5_TASK_CLASS_CATALOG_VERSION = 1;

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function tupleKey(capability) {
    return JSON.stringify([
        capability.domain,
        capability.operation,
        [...capability.requiredEntityTypes].sort(),
    ]);
}

function buildTaskClassCatalog(capabilities = listV5Capabilities()) {
    const tuples = new Map();
    for (const capability of capabilities.filter(item => item.exposableInV5B === true)) {
        const key = tupleKey(capability);
        if (!tuples.has(key)) tuples.set(key, {
            domain: capability.domain,
            operation: capability.operation,
            entityTypes: [...capability.requiredEntityTypes].sort(),
        });
    }
    const sorted = [...tuples.values()].sort((left, right) => (
        left.domain.localeCompare(right.domain)
        || left.operation.localeCompare(right.operation)
        || left.entityTypes.join('\0').localeCompare(right.entityTypes.join('\0'))
    ));
    return deepFreeze(sorted.map((item, index) => ({
        classRef: `tc_${String(index + 1).padStart(3, '0')}`,
        domain: item.domain,
        operation: item.operation,
        entityTypes: item.entityTypes,
        entitySlots: item.entityTypes.map((entityType, slotIndex) => ({
            slotRef: `slot_${String(slotIndex + 1).padStart(2, '0')}`,
            entityTypeRef: `et_${String(slotIndex + 1).padStart(2, '0')}`,
            entityType,
            semanticDescription: ENTITY_TYPE_SEMANTICS[entityType],
        })),
        semanticDescription: [
            DOMAIN_SEMANTICS[item.domain],
            OPERATION_SEMANTICS[item.operation],
            `Referenced object: ${item.entityTypes.map(type => ENTITY_TYPE_SEMANTICS[type]).join(' + ')}`,
        ].join(' '),
    })));
}

const V5_TASK_CLASS_CATALOG = buildTaskClassCatalog();

function getV5TaskClass(classRef) {
    return V5_TASK_CLASS_CATALOG.find(item => item.classRef === classRef) || null;
}

function taskClassModelView(catalog = V5_TASK_CLASS_CATALOG) {
    return deepFreeze(catalog.map(item => ({
        classRef: item.classRef,
        semanticDescription: item.semanticDescription,
        entitySlots: item.entitySlots.map(slot => ({
            slotRef: slot.slotRef,
            entityTypeRef: slot.entityTypeRef,
            semanticDescription: slot.semanticDescription,
        })),
    })));
}

function validateTaskClassCatalog(catalog = V5_TASK_CLASS_CATALOG) {
    if (!Array.isArray(catalog) || catalog.length === 0) throw new TypeError('V5 task class catalog must be non-empty');
    const refs = new Set();
    const knownTuples = new Set(listV5Capabilities().map(tupleKey));
    for (const item of catalog) {
        if (!/^tc_\d{3}$/.test(item.classRef) || refs.has(item.classRef)) throw new TypeError('V5 task class ref invalid or duplicate');
        refs.add(item.classRef);
        if (!DOMAIN_SEMANTICS[item.domain] || !OPERATION_SEMANTICS[item.operation]) throw new TypeError(`V5 task class taxonomy stale: ${item.classRef}`);
        if (!Array.isArray(item.entityTypes) || item.entityTypes.length === 0
            || item.entityTypes.some(type => !getV5EntityType(type))) throw new TypeError(`V5 task class entity type stale: ${item.classRef}`);
        if (!knownTuples.has(tupleKey({ ...item, requiredEntityTypes: item.entityTypes }))) throw new TypeError(`V5 task class capability tuple stale: ${item.classRef}`);
        if (!Array.isArray(item.entitySlots) || item.entitySlots.length !== item.entityTypes.length) throw new TypeError(`V5 task class slots invalid: ${item.classRef}`);
        if (new Set(item.entitySlots.map(slot => slot.slotRef)).size !== item.entitySlots.length) throw new TypeError(`V5 task class slot duplicate: ${item.classRef}`);
        if (typeof item.semanticDescription !== 'string' || !item.semanticDescription) throw new TypeError(`V5 task class description missing: ${item.classRef}`);
    }
    const expected = buildTaskClassCatalog();
    if (JSON.stringify(catalog) !== JSON.stringify(expected)) throw new TypeError('V5 task class catalog is not deterministic');
    const serializedView = JSON.stringify(taskClassModelView(catalog));
    const toolNames = listV5Capabilities().flatMap(item => item.allowedTools);
    if (toolNames.some(name => serializedView.includes(name))) throw new TypeError('V5 task class model view leaks Tool names');
    return true;
}

validateTaskClassCatalog();

module.exports = {
    V5_TASK_CLASS_CATALOG,
    V5_TASK_CLASS_CATALOG_VERSION,
    buildTaskClassCatalog,
    getV5TaskClass,
    taskClassModelView,
    validateTaskClassCatalog,
};
