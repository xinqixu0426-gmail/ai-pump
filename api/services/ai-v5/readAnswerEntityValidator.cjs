'use strict';
function entityMatches(claim, fact, view) {
    return claim.entityRef === view.entityRef && fact.entityRef === view.entityRef && fact.taskId === view.taskId;
}
module.exports = { entityMatches };
