'use strict';
const { V5_TASK_CLASS_CATALOG, taskClassModelView } = require('./taskClassCatalog.cjs');
function buildLocalTaskClassCatalog(candidates) {
    const types = new Set(candidates.map(candidate => candidate.entityType));
    return Object.freeze(V5_TASK_CLASS_CATALOG.filter(item => item.entityTypes.some(type => types.has(type))));
}
function localModelView(catalog) {
    const refs = new Set(catalog.map(item => item.classRef));
    return taskClassModelView(catalog).map(item => ({ ...item,
        localAlternatives: item.localAlternatives.filter(other => refs.has(other.classRef)),
    }));
}
module.exports = { buildLocalTaskClassCatalog, localModelView };
