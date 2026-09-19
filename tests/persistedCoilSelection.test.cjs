const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    resolvePersistedCoilSelection,
} = require('../api/services/persistedCoilSelection.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY,
            spec TEXT NOT NULL,
            sheets INTEGER NOT NULL,
            material TEXT NOT NULL,
            slot_type TEXT NOT NULL,
            scheme_status TEXT NOT NULL,
            scheme_family_code TEXT NOT NULL,
            pricing_mode TEXT NOT NULL
        );
        INSERT INTO coils VALUES
            (1, '12', 120, '钢带', '小眼', 'official', 'LEGACY-V1', 'calculated'),
            (2, '12', 160, '钢带', '小眼', 'official', 'LEGACY-V1', 'calculated'),
            (3, '12', 120, '钢带', '小眼', 'official', '12-240V-50HZ', 'calculated'),
            (4, '12', 160, '钢带', '小眼', 'official', '12-240V-50HZ', 'calculated'),
            (5, '12', 140, '钢带', '小眼', 'testing', 'TESTING', 'calculated');
    `);
    return db;
}

test('持久化线圈选择：精确片数必须绑定具体正式方案并归一方案族', () => {
    const db = createFixture();
    try {
        const missing = resolvePersistedCoilSelection(db, {
            coilSpec: '12',
            coilSheets: 120,
            coilMaterial: '钢带',
            coilSlotType: '小眼',
        });
        assert.equal(missing.success, false);
        assert.equal(missing.code, 'COIL_SELECTION_REQUIRED');

        const selected = resolvePersistedCoilSelection(db, {
            coilId: 3,
            coilSpec: '12',
            coilSheets: 120,
            coilMaterial: '钢带',
            coilSlotType: '小眼',
        });
        assert.deepEqual(selected, {
            success: true,
            data: {
                coilId: 3,
                schemeFamilyCode: '12-240V-50HZ',
                selectionMode: 'exact',
            },
        });

        const normalizedFromStaleFamily = resolvePersistedCoilSelection(db, {
            coilId: 3,
            coilSchemeFamilyCode: 'legacy-v1',
            coilSpec: '12',
            coilSheets: 120,
            coilMaterial: '钢带',
            coilSlotType: '小眼',
        });
        assert.equal(normalizedFromStaleFamily.success, true);
        assert.equal(
            normalizedFromStaleFamily.data.schemeFamilyCode,
            '12-240V-50HZ'
        );
    } finally {
        db.close();
    }
});

test('持久化线圈选择：非精确片数必须显式选择同一 calculated 方案族', () => {
    const db = createFixture();
    try {
        const missing = resolvePersistedCoilSelection(db, {
            coilSpec: '12',
            coilSheets: 140,
            coilMaterial: '钢带',
            coilSlotType: '小眼',
        });
        assert.equal(missing.success, false);
        assert.equal(missing.code, 'COIL_SCHEME_FAMILY_REQUIRED');

        const selected = resolvePersistedCoilSelection(db, {
            coilSchemeFamilyCode: 'legacy-v1',
            coilSpec: '12',
            coilSheets: 140,
            coilMaterial: '钢带',
            coilSlotType: '小眼',
        });
        assert.deepEqual(selected, {
            success: true,
            data: {
                coilId: null,
                schemeFamilyCode: 'LEGACY-V1',
                selectionMode: 'family',
            },
        });
    } finally {
        db.close();
    }
});
