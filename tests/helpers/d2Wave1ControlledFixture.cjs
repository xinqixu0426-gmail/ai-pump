'use strict';

// D2 Wave 1 is intentionally separate from the frozen D1 fixture.  These
// records are formal producer envelopes, not a second readiness algorithm.
// Producer/service tests exercise the real algorithms; this fixture pins the
// Ledger and Validator boundary cases (resolved, unresolved, complete, and
// truncated) without changing D1 business data.
function createD2Wave1ControlledFixture() {
    return {
        bindings: new Map([
            ['recipe:11', { verified: true, canonicalName: 'D2配方' }],
            ['order:21', { verified: true, canonicalName: 'HT-D2-001' }],
        ]),
        virtualReadiness: {
            status: 'SHORTAGE', inventoryBasis: 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS', scenarioKey: 'base', quantity: 10,
            coverage: { complete: true, requirementCount: 2, shortageCount: 1, unresolvedCount: 0 },
            collections: {
                requirements: { returnedCount: 2, totalCount: 2, complete: true, hasMore: false },
                shortages: { returnedCount: 1, totalCount: 1, complete: true, hasMore: false },
                unresolvedRequirements: { returnedCount: 0, totalCount: 0, complete: true, hasMore: false },
            },
            requirements: [
                { resourceType: 'PART', partId: 31, model: '轴承-A', inventoryUnit: 'piece', virtualRequiredQty: 10, availableForVirtualQty: 7, shortageQty: 3 },
                { resourceType: 'PART', partId: 32, model: '密封件-B', inventoryUnit: 'piece', virtualRequiredQty: 2, availableForVirtualQty: 2, shortageQty: 0 },
            ],
            shortages: [{ resourceType: 'PART', partId: 31, model: '轴承-A', inventoryUnit: 'piece', virtualRequiredQty: 10, availableForVirtualQty: 7, shortageQty: 3 }],
            unresolvedRequirements: [],
        },
        orderReadiness: {
            verdict: 'waiting_materials', canProduce: false, metrics: { shortageLineCount: 2, unresolvedLineCount: 1 },
            collections: { shortages: { returnedCount: 2, totalCount: 2, complete: true, hasMore: false } },
            shortages: [
                { partId: 31, coilId: null, model: '轴承-A', inventoryType: 'part', purchaseUnit: '个', requiredQty: 10, availableQty: 7, shortageQty: 3, plannedQty: 3, orderedQty: 1, receivedQty: 1, stockedQty: 0, procurementStage: '待下单' },
                { partId: null, coilId: null, model: '未绑定物料', inventoryType: 'part', purchaseUnit: '个', requiredQty: 4, availableQty: 0, shortageQty: 4 },
            ],
        },
        orderDetail: {
            order: {
                status: '采购中', customerName: '测试客户', contractNo: 'HT-D2-001',
                collections: {
                    items: { returnedCount: 1, totalCount: 1, complete: true, hasMore: false },
                    purchaseList: { returnedCount: 1, totalCount: 1, complete: true, hasMore: false },
                    todos: { returnedCount: 0, totalCount: 0, complete: true, hasMore: false },
                },
                items: [{ recipeId: 999, recipeName: '历史快照配方', qty: 2 }], purchaseList: [], todos: [],
            },
        },
        purchaseOverview: {
            returnedCount: 1, truncated: true, summary: { taskCount: 2 },
            tasks: [{ partId: 31, inventoryType: 'part', model: '轴承-A', supplier: '正式供应商', purchaseUnit: '个', procurementStage: '待下单', plannedQty: 3, orderedQty: 1, receivedQty: 1, stockedQty: 0, pendingQty: 2 }],
        },
    };
}

module.exports = { createD2Wave1ControlledFixture };
