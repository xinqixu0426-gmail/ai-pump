const {
    DEFAULT_COIL_MATERIAL,
    DEFAULT_COIL_SLOT_TYPE,
    buildCoilSpecDraft,
    buildCoilSpecOptions,
} = require('./coilCost.cjs');
const { parsePositiveId } = require('./validation.cjs');

class CoilQueryError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'CoilQueryError';
        this.statusCode = statusCode;
    }
}

function normalizeMovementLimit(value) {
    return Math.min(
        100,
        Math.max(1, Number.parseInt(value, 10) || 20)
    );
}

function createCoilQueries({
    db,
    listCoils,
    listStatorVariants,
    movementRow,
} = {}) {
    if (!db || typeof db.prepare !== 'function') {
        throw new Error('线圈查询服务缺少数据库依赖');
    }
    if (typeof listCoils !== 'function') {
        throw new Error('线圈查询服务缺少 listCoils');
    }
    if (typeof listStatorVariants !== 'function') {
        throw new Error('线圈查询服务缺少 listStatorVariants');
    }
    if (typeof movementRow !== 'function') {
        throw new Error('线圈查询服务缺少 movementRow');
    }

    function getAllCoils() {
        return listCoils();
    }

    function getAllStatorVariants() {
        return listStatorVariants();
    }

    function getSpecDraft(input = {}) {
        const spec = String(input?.spec || '').trim();
        if (!spec) {
            throw new CoilQueryError('spec 为必填');
        }
        const material = (
            String(input?.material || DEFAULT_COIL_MATERIAL).trim()
            || DEFAULT_COIL_MATERIAL
        );
        const slotType = (
            String(input?.slotType || DEFAULT_COIL_SLOT_TYPE).trim()
            || DEFAULT_COIL_SLOT_TYPE
        );
        return buildCoilSpecDraft(
            listCoils(),
            {
                ...input,
                spec,
                material,
                slotType,
            }
        );
    }

    function getStockMovements(rawCoilId, rawLimit) {
        const coilId = parsePositiveId(rawCoilId);
        if (!coilId) {
            throw new CoilQueryError('非法线圈ID');
        }
        if (!db.prepare('SELECT id FROM coils WHERE id = ?').get(coilId)) {
            throw new CoilQueryError('线圈记录不存在', 404);
        }
        const limit = normalizeMovementLimit(rawLimit);
        return db.prepare(`
            SELECT *
            FROM coil_stock_movements
            WHERE coil_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        `).all(coilId, limit).map(movementRow);
    }

    function getSpecOptions() {
        return buildCoilSpecOptions(listCoils());
    }

    return {
        getAllCoils,
        getAllStatorVariants,
        getSpecDraft,
        getSpecOptions,
        getStockMovements,
    };
}

module.exports = {
    CoilQueryError,
    createCoilQueries,
    normalizeMovementLimit,
};
