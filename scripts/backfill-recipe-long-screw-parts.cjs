const crypto = require('node:crypto');

process.env.NODE_TEST_CONTEXT = process.env.NODE_TEST_CONTEXT || 'maintenance';

const {
    db,
    extractPartFields,
    invalidatePartsCache,
    partRow,
    safeInsert,
    safeUpdate,
} = require('../api/db.cjs');
const {
    BATCH_CREATE_CAPABILITY_ID,
    buildPartBatchCreatePreview,
    executeConfirmedPartBatchCreate,
} = require('../api/services/partCommands.cjs');
const {
    buildLongScrewInventoryPartsFromRecipe,
} = require('../api/services/longScrewInventory.cjs');

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function partsCatalog() {
    return db.prepare(`
        SELECT id AS Id, model, category, price, supplier, stock, remark AS notes
        FROM parts
        WHERE deleted_at IS NULL
        ORDER BY id
    `).all();
}

function missingLongScrewParts() {
    const catalog = partsCatalog();
    const existingModels = new Set(
        catalog
            .filter(part => part.category === '螺丝')
            .map(part => String(part.model || '').trim())
    );
    const candidates = new Map();
    const recipes = db.prepare(`
        SELECT id, name, parts_json
        FROM recipes
        WHERE deleted_at IS NULL
        ORDER BY id
    `).all();

    for (const recipe of recipes) {
        const derived = buildLongScrewInventoryPartsFromRecipe({
            recipeName: recipe.name,
            parts: parseJsonArray(recipe.parts_json),
            partsCatalog: catalog,
        });
        for (const part of derived) {
            if (existingModels.has(part.model) || candidates.has(part.model)) continue;
            candidates.set(part.model, part);
        }
    }
    return [...candidates.values()];
}

function run() {
    const parts = missingLongScrewParts();
    if (parts.length === 0) {
        console.log('参数化长螺丝零件已齐全，无需回填。');
        return;
    }

    const dependencies = {
        db,
        extractPartFields,
        partRow,
        safeInsert,
        safeUpdate,
    };
    const subject = 'internal:recipe-long-screw-backfill';
    const preview = buildPartBatchCreatePreview(
        dependencies,
        { parts },
        subject
    );
    const result = executeConfirmedPartBatchCreate(
        dependencies,
        { confirmationToken: preview.confirmationToken },
        {
            actorKey: subject,
            capabilityId: BATCH_CREATE_CAPABILITY_ID,
            idempotencyKey: preview.suggestedIdempotencyKey,
            operationId: preview.operationId || crypto.randomUUID(),
            requestId: 'maintenance:recipe-long-screw-backfill',
            warnings: [],
        },
        subject
    );
    invalidatePartsCache();
    console.log(JSON.stringify({
        createdCount: result.createdCount,
        parts: result.parts.map(part => ({
            id: part.id,
            model: part.model,
            supplier: part.supplier,
            price: part.price,
        })),
        operationId: result.operationId,
        auditIds: result.auditIds,
    }, null, 2));
}

try {
    run();
} finally {
    db.close();
}
