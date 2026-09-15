const { assertCatalogPhysicalUpdate } = require('./catalogPhysicalIdentity.cjs');
const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const {
    assertPreviewHash,
    normalizePreviewHash,
} = require('./previewIntegrity.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const {
    COIL_MATERIALS,
    COIL_PRICING_MODES,
    COIL_SCHEME_STATUSES,
    COIL_SLOT_TYPES,
    DEFAULT_COIL_MATERIAL,
    DEFAULT_COIL_SLOT_TYPE,
    calculateStoredCoilCost,
    normalizeCoilDimensions,
} = require('./coilCost.cjs');
const {
    parseNonNegativeNumber,
    parsePositiveId,
} = require('./validation.cjs');

const CREATE_CAPABILITY_ID = requireBusinessCapability('coils.create').capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability('coils.update').capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('coils.delete').capabilityId;
const BATCH_UNIT_PRICE_CAPABILITY_ID = requireBusinessCapability(
    'coils.batch_update_unit_price'
).capabilityId;

const OPTIONAL_TEXT_FIELDS = new Set([
    'market',
    'schemeFamilyCode',
    'schemeName',
    'defaultWireGauge',
    'defaultCapacitor',
    'mainWireGauge',
    'mainWireData',
    'auxWireGauge',
    'auxWireData',
]);
const NUMERIC_FIELDS = new Set([
    'diameterMm',
    'kitPrice',
    'unitPrice',
    'sheets',
    'wireWeight',
    'copperBase',
    'coilFee',
    'rotorFee',
    'ratedVoltageV',
    'ratedFrequencyHz',
]);
const UPDATE_FIELDS = new Set([
    'spec',
    'commonName',
    'diameterMm',
    'material',
    'slotType',
    'schemeName',
    'schemeStatus',
    'isDefault',
    'ratedVoltageV',
    'ratedFrequencyHz',
    'market',
    'schemeFamilyCode',
    'pricingMode',
    'kitPrice',
    'unitPrice',
    'sheets',
    'wireWeight',
    'copperBase',
    'coilFee',
    'rotorFee',
    'defaultWireGauge',
    'defaultCapacitor',
    'mainWireGauge',
    'mainWireData',
    'auxWireGauge',
    'auxWireData',
]);

function coilCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function getCoilRecord(dependencies, coilId) {
    const record = dependencies.db.prepare(
        'SELECT * FROM coils WHERE id = ?'
    ).get(coilId);
    if (!record) throw coilCommandError('coil_not_found', '线圈记录不存在', 404);
    return record;
}

function normalizeSchemeInput(body = {}) {
    const dimensions = normalizeCoilDimensions(body);
    if (!dimensions.commonName) {
        throw coilCommandError('coil_spec_required', '规格俗称为必填项', 400);
    }
    if (!dimensions.diameterMm) {
        throw coilCommandError('coil_diameter_invalid', '定子直径必须是正整数', 400);
    }
    if (!COIL_MATERIALS.has(dimensions.material)) {
        throw coilCommandError('coil_material_invalid', '材质仅支持钢带或冷轧', 400);
    }
    if (!COIL_SLOT_TYPES.has(dimensions.slotType)) {
        throw coilCommandError('coil_slot_type_invalid', '槽眼仅支持小眼或国标眼', 400);
    }
    const schemeStatus = String(body.schemeStatus || 'official').trim() || 'official';
    if (!COIL_SCHEME_STATUSES.has(schemeStatus)) {
        throw coilCommandError('coil_scheme_status_invalid', '方案状态无效', 400);
    }
    const isDefault = body.isDefault === true
        || body.isDefault === 1
        || body.isDefault === '1';
    if (isDefault && schemeStatus !== 'official') {
        throw coilCommandError(
            'coil_default_requires_official',
            '只有正式方案可以设为默认方案',
            400
        );
    }
    const voltageSupplied = body.ratedVoltageV !== undefined && body.ratedVoltageV !== null && body.ratedVoltageV !== '';
    const frequencySupplied = body.ratedFrequencyHz !== undefined && body.ratedFrequencyHz !== null && body.ratedFrequencyHz !== '';
    const ratedVoltageV = voltageSupplied ? parsePositiveId(body.ratedVoltageV) : null;
    const ratedFrequencyHz = frequencySupplied ? parsePositiveId(body.ratedFrequencyHz) : null;
    if (voltageSupplied && !ratedVoltageV) {
        throw coilCommandError('coil_voltage_invalid', '额定电压必须是正整数', 400);
    }
    if (frequencySupplied && !ratedFrequencyHz) {
        throw coilCommandError('coil_frequency_invalid', '额定频率必须是正整数', 400);
    }
    return {
        ...dimensions,
        schemeCode: String(body.schemeCode || '').trim().toUpperCase(),
        schemeName: String(
            body.schemeName
            || (schemeStatus === 'testing' ? '测试方案' : '正式方案')
        ).trim(),
        schemeStatus,
        isDefault,
        ratedVoltageV,
        ratedFrequencyHz,
        market: String(body.market || '').trim(),
        schemeFamilyCode: String(body.schemeFamilyCode || '').trim().toUpperCase(),
    };
}

function assertSchemeMetadata(scheme) {
    if (scheme.ratedVoltageV === null && scheme.ratedFrequencyHz === null) return;
    if (!scheme.ratedVoltageV) {
        throw coilCommandError('coil_voltage_invalid', '额定电压必须是正整数', 400);
    }
    if (!scheme.ratedFrequencyHz) {
        throw coilCommandError('coil_frequency_invalid', '额定频率必须是正整数', 400);
    }
}

function coilCostFromValues(values) {
    const pricingMode = String(values.pricingMode || 'calculated').trim() || 'calculated';
    if (!COIL_PRICING_MODES.has(pricingMode)) {
        throw coilCommandError('coil_pricing_mode_invalid', 'pricingMode 仅支持 calculated 或 kit', 400);
    }
    const kitPrice = parseNonNegativeNumber(values.kitPrice, 'kitPrice');
    if (pricingMode === 'kit' && kitPrice <= 0) {
        throw coilCommandError('coil_kit_price_required', '供应商套件价必须大于 0', 400);
    }
    const unitPrice = parseNonNegativeNumber(values.unitPrice, 'unitPrice', {
        required: pricingMode === 'calculated',
    });
    const sheets = parsePositiveId(values.sheets);
    if (!sheets) {
        throw coilCommandError('coil_sheets_invalid', 'sheets 必须是正整数', 400);
    }
    const wireWeight = parseNonNegativeNumber(values.wireWeight, 'wireWeight');
    const copperBase = parseNonNegativeNumber(values.copperBase, 'copperBase');
    const coilFee = parseNonNegativeNumber(values.coilFee, 'coilFee');
    const rotorFee = parseNonNegativeNumber(values.rotorFee, 'rotorFee');
    return {
        pricingMode,
        kitPrice: pricingMode === 'kit' ? kitPrice : 0,
        unitPrice: pricingMode === 'kit' ? 0 : unitPrice,
        sheets,
        wireWeight,
        copperBase,
        coilFee: pricingMode === 'kit' ? 0 : coilFee,
        rotorFee: pricingMode === 'kit' ? 0 : rotorFee,
        cost: calculateStoredCoilCost({
            pricingMode,
            kitPrice,
            unitPrice,
            sheets,
            wireWeight,
            copperBase,
            coilFee,
            rotorFee,
        }).toFixed(5),
    };
}

function ensureStatorVariant(dependencies, dimensions, auditContext) {
    let variant = dependencies.db.prepare(`
        SELECT * FROM stator_variants
        WHERE diameter_mm = ? AND material = ? AND slot_type = ?
    `).get(dimensions.diameterMm, dimensions.material, dimensions.slotType);
    if (variant) {
        if (!variant.common_name && dimensions.commonName) {
            const write = dependencies.safeUpdate(
                'stator_variants',
                variant.id,
                { common_name: dimensions.commonName },
                auditContext
            );
            variant = dependencies.db.prepare(
                'SELECT * FROM stator_variants WHERE id = ?'
            ).get(variant.id);
            return {
                variant,
                auditIds: write.auditId ? [write.auditId] : [],
                writeCount: 1,
                changes: [{
                    resourceType: 'statorVariant',
                    resourceId: variant.id,
                    field: 'commonName',
                    from: '',
                    to: dimensions.commonName,
                }],
            };
        }
        return { variant, auditIds: [], writeCount: 0, changes: [] };
    }
    const now = new Date().toISOString();
    const write = dependencies.safeInsert('stator_variants', {
        diameter_mm: dimensions.diameterMm,
        common_name: dimensions.commonName,
        material: dimensions.material,
        slot_type: dimensions.slotType,
        created_at: now,
        updated_at: now,
    }, auditContext);
    variant = dependencies.db.prepare(
        'SELECT * FROM stator_variants WHERE id = ?'
    ).get(write.lastInsertRowid);
    return {
        variant,
        auditIds: write.auditId ? [write.auditId] : [],
        writeCount: 1,
        changes: [{
            resourceType: 'statorVariant',
            resourceId: Number(write.lastInsertRowid),
            field: 'created',
            from: null,
            to: {
                diameterMm: dimensions.diameterMm,
                commonName: dimensions.commonName,
                material: dimensions.material,
                slotType: dimensions.slotType,
            },
        }],
    };
}

function clearExistingDefault(
    dependencies,
    variantId,
    sheets,
    excludeId,
    auditContext
) {
    const rows = dependencies.db.prepare(`
        SELECT id FROM coils
        WHERE stator_variant_id = ? AND sheets = ?
          AND scheme_status = 'official' AND is_default = 1
    `).all(variantId, sheets);
    const auditIds = [];
    const changes = [];
    let writeCount = 0;
    for (const row of rows) {
        if (Number(row.id) === Number(excludeId)) continue;
        const write = dependencies.safeUpdate(
            'coils',
            row.id,
            { is_default: 0 },
            auditContext
        );
        writeCount += 1;
        if (write.auditId) auditIds.push(write.auditId);
        changes.push({
            resourceType: 'coil',
            resourceId: row.id,
            field: 'isDefault',
            from: true,
            to: false,
        });
    }
    return { auditIds, writeCount, changes };
}

function hasOtherDefault(dependencies, variantId, sheets, excludeId = null) {
    return Boolean(dependencies.db.prepare(`
        SELECT id FROM coils
        WHERE stator_variant_id = ? AND sheets = ?
          AND scheme_status = 'official' AND is_default = 1
          AND (? IS NULL OR id <> ?)
        LIMIT 1
    `).get(variantId, sheets, excludeId, excludeId));
}

function promoteFallbackDefault(dependencies, variantId, sheets, excludeId, auditContext) {
    if (hasOtherDefault(dependencies, variantId, sheets, excludeId)) {
        return { auditIds: [], writeCount: 0, changes: [] };
    }
    const fallback = dependencies.db.prepare(`
        SELECT id FROM coils
        WHERE stator_variant_id = ? AND sheets = ?
          AND scheme_status = 'official' AND id <> ?
        ORDER BY id
        LIMIT 1
    `).get(variantId, sheets, excludeId || 0);
    if (!fallback) return { auditIds: [], writeCount: 0, changes: [] };
    const write = dependencies.safeUpdate(
        'coils',
        fallback.id,
        { is_default: 1 },
        auditContext
    );
    return {
        auditIds: write.auditId ? [write.auditId] : [],
        writeCount: 1,
        changes: [{
            resourceType: 'coil',
            resourceId: fallback.id,
            field: 'isDefault',
            from: false,
            to: true,
        }],
    };
}

function versionCompatibilityWarning(coilId, expectedUpdatedAt) {
    return coilId && !expectedUpdatedAt ? [{
        code: 'expected_updated_at_missing_compatibility',
        message: `线圈 #${coilId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
    }] : [];
}

function normalizeCreateInput(input = {}) {
    const scheme = normalizeSchemeInput(input);
    assertSchemeMetadata(scheme);
    const generated = require('./catalogNaming.cjs').generateCatalogName({ ruleId: 'coil', spec: {
        statorCode: scheme.commonName,
        sheets: Number(input.sheets),
        material: scheme.material,
        slotType: scheme.slotType,
        scheme: scheme.schemeName,
    } });
    const cost = coilCostFromValues({
        ...input,
        sheets: input.sheets,
    });
    return {
        ...scheme,
        schemeName: generated.name,
        ...cost,
        defaultWireGauge: String(input.defaultWireGauge || '').trim(),
        defaultCapacitor: String(input.defaultCapacitor || '').trim(),
        mainWireGauge: String(input.mainWireGauge || '').trim(),
        mainWireData: String(input.mainWireData || '').trim(),
        auxWireGauge: String(input.auxWireGauge || '').trim(),
        auxWireData: String(input.auxWireData || '').trim(),
    };
}

function executeCoilCreate(dependencies, input = {}, commandContext = {}) {
    const normalized = normalizeCreateInput(input);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CREATE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'coil', eventType: 'created' }),
        input: normalized,
        execute: ({ auditContext }) => {
            const variantResult = ensureStatorVariant(
                dependencies,
                normalized,
                auditContext
            );
            const shouldBeDefault = normalized.schemeStatus === 'official' && (
                normalized.isDefault
                || !hasOtherDefault(
                    dependencies,
                    variantResult.variant.id,
                    normalized.sheets
                )
            );
            const defaultResult = shouldBeDefault
                ? clearExistingDefault(
                    dependencies,
                    variantResult.variant.id,
                    normalized.sheets,
                    null,
                    auditContext
                )
                : { auditIds: [], writeCount: 0, changes: [] };
            const now = new Date().toISOString();
            const schemeCode = normalized.schemeCode
                || `COIL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
            const write = dependencies.safeInsert('coils', {
                stator_variant_id: variantResult.variant.id,
                spec: normalized.commonName,
                material: normalized.material,
                slot_type: normalized.slotType,
                sheets: normalized.sheets,
                scheme_code: schemeCode,
                scheme_name: normalized.schemeName,
                scheme_status: normalized.schemeStatus,
                is_default: shouldBeDefault ? 1 : 0,
                rated_voltage_v: normalized.ratedVoltageV,
                rated_frequency_hz: normalized.ratedFrequencyHz,
                market: normalized.market,
                scheme_family_code: normalized.schemeFamilyCode || schemeCode,
                pricing_mode: normalized.pricingMode,
                kit_price: normalized.kitPrice,
                unit_price: normalized.unitPrice,
                wire_weight: normalized.wireWeight,
                copper_base: normalized.copperBase,
                coil_fee: normalized.coilFee,
                rotor_fee: normalized.rotorFee,
                cost: normalized.cost,
                default_wire_gauge: normalized.defaultWireGauge || null,
                default_capacitor: normalized.defaultCapacitor || null,
                main_wire_gauge: normalized.mainWireGauge,
                main_wire_data: normalized.mainWireData,
                aux_wire_gauge: normalized.auxWireGauge,
                aux_wire_data: normalized.auxWireData,
                created_at: now,
                updated_at: now,
            }, auditContext);
            const coilId = Number(write.lastInsertRowid);
            const coil = dependencies.coilRow(getCoilRecord(dependencies, coilId));
            const auditIds = [
                ...variantResult.auditIds,
                ...defaultResult.auditIds,
                ...(write.auditId ? [write.auditId] : []),
            ];
            return {
                data: { coil },
                resource: { type: 'coil', ids: [coilId] },
                changes: [
                    ...variantResult.changes,
                    ...defaultResult.changes,
                    {
                        resourceType: 'coil',
                        resourceId: coilId,
                        field: 'created',
                        from: null,
                        to: {
                            spec: coil.spec,
                            sheets: coil.sheets,
                            schemeStatus: coil.schemeStatus,
                            cost: coil.cost,
                        },
                    },
                ],
                auditIds,
                requiredAuditCount: (
                    variantResult.writeCount
                    + defaultResult.writeCount
                    + 1
                ),
            };
        },
    });
}

function normalizeUpdatePatch(input = {}) {
    const patch = {};
    for (const key of UPDATE_FIELDS) {
        if (input[key] === undefined) continue;
        if (OPTIONAL_TEXT_FIELDS.has(key)) {
            patch[key] = String(input[key] || '').trim();
        } else if (key === 'isDefault') {
            patch[key] = input[key] === true || input[key] === 1 || input[key] === '1';
        } else if (NUMERIC_FIELDS.has(key)) {
            if (key === 'sheets' || key === 'diameterMm') {
                const value = parsePositiveId(input[key]);
                if (!value) {
                    throw coilCommandError(
                        'coil_positive_integer_required',
                        `${key} 必须是正整数`,
                        400
                    );
                }
                patch[key] = value;
            } else if ((key === 'ratedVoltageV' || key === 'ratedFrequencyHz') && (input[key] === null || input[key] === '')) {
                patch[key] = null;
            } else if (key === 'ratedVoltageV' || key === 'ratedFrequencyHz') {
                const value = parsePositiveId(input[key]);
                if (!value) {
                    throw coilCommandError('coil_positive_integer_required', `${key} 必须是正整数`, 400);
                }
                patch[key] = value;
            } else {
                patch[key] = parseNonNegativeNumber(input[key], key);
            }
        } else {
            patch[key] = String(input[key] || '').trim();
        }
    }
    if (
        patch.schemeStatus !== undefined
        && !COIL_SCHEME_STATUSES.has(patch.schemeStatus)
    ) {
        throw coilCommandError('coil_scheme_status_invalid', '方案状态无效', 400);
    }
    if (patch.isDefault && patch.schemeStatus && patch.schemeStatus !== 'official') {
        throw coilCommandError('coil_default_requires_official', '只有正式方案可以设为默认方案', 400);
    }
    if (
        patch.pricingMode !== undefined
        && !COIL_PRICING_MODES.has(patch.pricingMode)
    ) {
        throw coilCommandError('coil_pricing_mode_invalid', 'pricingMode 仅支持 calculated 或 kit', 400);
    }
    return patch;
}

function patchToDbUpdates(patch) {
    const aliases = {
        spec: 'spec',
        material: 'material',
        slotType: 'slot_type',
        schemeName: 'scheme_name',
        schemeStatus: 'scheme_status',
        isDefault: 'is_default',
        ratedVoltageV: 'rated_voltage_v',
        ratedFrequencyHz: 'rated_frequency_hz',
        market: 'market',
        schemeFamilyCode: 'scheme_family_code',
        pricingMode: 'pricing_mode',
        kitPrice: 'kit_price',
        unitPrice: 'unit_price',
        sheets: 'sheets',
        wireWeight: 'wire_weight',
        copperBase: 'copper_base',
        coilFee: 'coil_fee',
        rotorFee: 'rotor_fee',
        defaultWireGauge: 'default_wire_gauge',
        defaultCapacitor: 'default_capacitor',
        mainWireGauge: 'main_wire_gauge',
        mainWireData: 'main_wire_data',
        auxWireGauge: 'aux_wire_gauge',
        auxWireData: 'aux_wire_data',
    };
    return Object.fromEntries(
        Object.entries(aliases)
            .filter(([key]) => patch[key] !== undefined)
            .map(([key, column]) => [column, patch[key]])
    );
}

function executeCoilUpdate(
    dependencies,
    coilIdValue,
    input = {},
    commandContext = {}
) {
    const coilId = parsePositiveId(coilIdValue);
    if (!coilId) throw coilCommandError('coil_id_invalid', '非法线圈ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const patch = normalizeUpdatePatch(input);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'coil', eventType: 'updated' }),
        input: { coilId, expectedUpdatedAt, patch },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionCompatibilityWarning(coilId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const record = getCoilRecord(dependencies, coilId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `线圈 #${coilId}`);
            const current = dependencies.coilRow(record);
            assertSchemeMetadata({
                ratedVoltageV: patch.ratedVoltageV !== undefined ? patch.ratedVoltageV : current.ratedVoltageV ?? null,
                ratedFrequencyHz: patch.ratedFrequencyHz !== undefined ? patch.ratedFrequencyHz : current.ratedFrequencyHz ?? null,
            });
            if (Object.keys(patch).length === 0) {
                return {
                    data: { coil: current },
                    resource: { type: 'coil', ids: [coilId] },
                    changes: [],
                    auditIds: [],
                    requiredAuditCount: 0,
                    warnings: [{
                        code: 'coil_update_noop',
                        message: '没有可保存的线圈字段，未执行写入',
                    }],
                };
            }

            const dbUpdates = patchToDbUpdates(patch);
            let targetVariantId = current.statorVariantId;
            const identityChanges = [];
            const hasDimensionUpdates = [
                'spec',
                'diameterMm',
                'commonName',
                'material',
                'slotType',
            ].some(key => patch[key] !== undefined);
            let targetScheme = null;
            if (hasDimensionUpdates) {
                targetScheme = normalizeSchemeInput({
                    ...current,
                    ...patch,
                    spec: patch.spec
                        ?? patch.commonName
                        ?? current.commonName
                        ?? current.spec,
                    schemeStatus: patch.schemeStatus ?? current.schemeStatus,
                });
                if (targetScheme.commonName !== current.commonName) {
                    identityChanges.push('规格俗称');
                }
                if (Number(targetScheme.diameterMm) !== Number(current.diameterMm)) {
                    identityChanges.push('定子直径');
                }
                if (targetScheme.material !== current.material) identityChanges.push('材质');
                if (targetScheme.slotType !== current.slotType) identityChanges.push('槽眼');
            }
            if (
                patch.sheets !== undefined
                && Number(patch.sheets) !== Number(current.sheets)
            ) {
                identityChanges.push('片数');
            }
            dependencies.assertCoilIdentityEditable(
                dependencies.db,
                coilId,
                identityChanges
            );

            let variantResult = {
                auditIds: [],
                writeCount: 0,
                changes: [],
            };
            if (targetScheme) {
                variantResult = ensureStatorVariant(
                    dependencies,
                    targetScheme,
                    auditContext
                );
                targetVariantId = variantResult.variant.id;
                dbUpdates.stator_variant_id = targetVariantId;
                dbUpdates.spec = targetScheme.commonName;
                dbUpdates.material = targetScheme.material;
                dbUpdates.slot_type = targetScheme.slotType;
            }

            if ([
                'pricing_mode',
                'kit_price',
                'unit_price',
                'sheets',
                'wire_weight',
                'copper_base',
                'coil_fee',
                'rotor_fee',
            ].some(key => dbUpdates[key] !== undefined)) {
                const normalizedCost = coilCostFromValues({
                    pricingMode: dbUpdates.pricing_mode ?? current.pricingMode ?? 'calculated',
                    kitPrice: dbUpdates.kit_price ?? current.kitPrice ?? 0,
                    unitPrice: dbUpdates.unit_price ?? current.unitPrice ?? 0,
                    sheets: dbUpdates.sheets ?? current.sheets ?? 0,
                    wireWeight: dbUpdates.wire_weight ?? current.wireWeight ?? 0,
                    copperBase: dbUpdates.copper_base ?? current.copperBase ?? 0,
                    coilFee: dbUpdates.coil_fee ?? current.coilFee ?? 0,
                    rotorFee: dbUpdates.rotor_fee ?? current.rotorFee ?? 0,
                });
                const normalizedFields = {
                    pricing_mode: normalizedCost.pricingMode,
                    kit_price: normalizedCost.kitPrice,
                    unit_price: normalizedCost.unitPrice,
                    sheets: normalizedCost.sheets,
                    wire_weight: normalizedCost.wireWeight,
                    copper_base: normalizedCost.copperBase,
                    coil_fee: normalizedCost.coilFee,
                    rotor_fee: normalizedCost.rotorFee,
                };
                for (const [field, value] of Object.entries(normalizedFields)) {
                    if (
                        dbUpdates[field] !== undefined
                        || field === 'pricing_mode'
                        || field === 'kit_price'
                        || normalizedCost.pricingMode === 'kit'
                    ) {
                        dbUpdates[field] = value;
                    }
                }
                dbUpdates.cost = normalizedCost.cost;
            }

            const sourceVariantId = current.statorVariantId;
            const sourceSheets = Number(current.sheets);
            const sourceWasDefault = current.isDefault === true;
            const targetSheets = Number(dbUpdates.sheets ?? current.sheets);
            const targetStatus = String(
                dbUpdates.scheme_status ?? current.schemeStatus ?? 'official'
            );
            let shouldBeDefault = targetStatus === 'official'
                ? (dbUpdates.is_default !== undefined
                    ? Boolean(dbUpdates.is_default)
                    : current.isDefault === true)
                : false;
            if (
                targetStatus === 'official'
                && !shouldBeDefault
                && !hasOtherDefault(dependencies, targetVariantId, targetSheets, coilId)
            ) {
                shouldBeDefault = true;
            }
            dbUpdates.is_default = shouldBeDefault ? 1 : 0;
            const defaultResult = shouldBeDefault
                ? clearExistingDefault(
                    dependencies,
                    targetVariantId,
                    targetSheets,
                    coilId,
                    auditContext
                )
                : { auditIds: [], writeCount: 0, changes: [] };
            assertCatalogPhysicalUpdate(dependencies.db, 'coil', record, dbUpdates);
            const write = dependencies.safeUpdate(
                'coils',
                coilId,
                dbUpdates,
                auditContext
            );
            const movedDefault = sourceWasDefault && (
                sourceVariantId !== targetVariantId
                || sourceSheets !== targetSheets
                || targetStatus !== 'official'
            );
            const fallbackResult = movedDefault
                ? promoteFallbackDefault(
                    dependencies,
                    sourceVariantId,
                    sourceSheets,
                    coilId,
                    auditContext
                )
                : { auditIds: [], writeCount: 0, changes: [] };
            const coil = dependencies.coilRow(getCoilRecord(dependencies, coilId));
            const auditIds = [
                ...variantResult.auditIds,
                ...defaultResult.auditIds,
                ...fallbackResult.auditIds,
                ...(write.auditId ? [write.auditId] : []),
            ];
            return {
                data: { coil },
                resource: { type: 'coil', ids: [coilId] },
                changes: [
                    ...variantResult.changes,
                    ...defaultResult.changes,
                    ...fallbackResult.changes,
                    {
                        resourceType: 'coil',
                        resourceId: coilId,
                        field: 'fields',
                        from: null,
                        to: Object.keys(dbUpdates),
                    },
                ],
                auditIds,
                requiredAuditCount: (
                    variantResult.writeCount
                    + defaultResult.writeCount
                    + fallbackResult.writeCount
                    + 1
                ),
            };
        },
    });
}

function executeCoilDelete(
    dependencies,
    coilIdValue,
    input = {},
    commandContext = {}
) {
    const coilId = parsePositiveId(coilIdValue);
    if (!coilId) throw coilCommandError('coil_id_invalid', '非法线圈ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: DELETE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'coil', eventType: 'deleted' }),
        input: { coilId, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionCompatibilityWarning(coilId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const record = getCoilRecord(dependencies, coilId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `线圈 #${coilId}`);
            dependencies.assertCoilCanBeDeleted(dependencies.db, coilId);
            const write = dependencies.hardDelete('coils', coilId, auditContext);
            const fallbackResult = record.scheme_status === 'official' && Number(record.is_default || 0) === 1
                ? promoteFallbackDefault(
                    dependencies,
                    record.stator_variant_id,
                    Number(record.sheets),
                    coilId,
                    auditContext
                )
                : { auditIds: [], writeCount: 0, changes: [] };
            return {
                data: { deleted: 1, coilId },
                resource: { type: 'coil', ids: [coilId] },
                changes: [{
                    resourceType: 'coil',
                    resourceId: coilId,
                    field: 'deleted',
                    from: {
                        spec: record.spec,
                        sheets: record.sheets,
                    },
                    to: true,
                }, ...fallbackResult.changes],
                auditIds: [
                    ...(write.auditId ? [write.auditId] : []),
                    ...fallbackResult.auditIds,
                ],
                requiredAuditCount: 1 + fallbackResult.writeCount,
            };
        },
    });
}

function normalizeSpecPriceInput(input = {}) {
    const spec = String(input.spec || '').trim();
    if (!spec) {
        throw coilCommandError('coil_spec_required', 'spec 为必填项', 400);
    }
    if (input.unitPrice === undefined || input.unitPrice === '') {
        throw coilCommandError('coil_unit_price_required', 'unitPrice 为必填', 400);
    }
    const material = input.material ? String(input.material).trim() : '';
    const slotType = input.slotType ? String(input.slotType).trim() : '';
    if (material && !COIL_MATERIALS.has(material)) {
        throw coilCommandError('coil_material_invalid', '材质仅支持钢带或冷轧', 400);
    }
    if (slotType && !COIL_SLOT_TYPES.has(slotType)) {
        throw coilCommandError('coil_slot_type_invalid', '槽眼仅支持小眼或国标眼', 400);
    }
    const dimensions = normalizeCoilDimensions({
        spec,
        material: material || DEFAULT_COIL_MATERIAL,
        slotType: slotType || DEFAULT_COIL_SLOT_TYPE,
    });
    return {
        spec,
        diameterMm: dimensions.diameterMm,
        material,
        slotType,
        unitPrice: parseNonNegativeNumber(input.unitPrice, 'unitPrice'),
    };
}

function buildCoilUnitPricePreview(dependencies, input = {}) {
    const normalized = normalizeSpecPriceInput(input);
    const rows = dependencies.listCoils().filter(coil => (
        Number(coil.diameterMm) === normalized.diameterMm
        && (!normalized.material || coil.material === normalized.material)
        && (!normalized.slotType || coil.slotType === normalized.slotType)
        && String(coil.pricingMode || 'calculated') === 'calculated'
    ));
    if (rows.length === 0) {
        const suffix = normalized.material
            ? `、材质 "${normalized.material}"`
            : '';
        throw coilCommandError(
            'coil_spec_not_found',
            `未找到规格 "${normalized.spec}"${suffix} 的计算计价方案；供应商套件价不参与定子单片价批量更新`,
            404
        );
    }
    const updates = rows
        .map(coil => {
            const cost = (
                normalized.unitPrice * Number(coil.sheets || 0)
                + Number(coil.wireWeight || 0) * Number(coil.copperBase || 0)
                + Number(coil.coilFee || 0)
                + Number(coil.rotorFee || 0)
            ).toFixed(5);
            return {
                coilId: Number(coil.id),
                expectedUpdatedAt: coil.updatedAt || null,
                unitPrice: normalized.unitPrice,
                cost,
                currentUnitPrice: Number(coil.unitPrice || 0),
                currentCost: Number(coil.cost || 0),
            };
        })
        .sort((left, right) => left.coilId - right.coilId);
    const snapshot = {
        ...normalized,
        updates: updates.map(item => ({
            coilId: item.coilId,
            expectedUpdatedAt: item.expectedUpdatedAt,
            unitPrice: item.unitPrice,
            cost: item.cost,
        })),
    };
    return {
        capabilityId: BATCH_UNIT_PRICE_CAPABILITY_ID,
        preview: true,
        previewHash: requestHash(snapshot),
        suggestedIdempotencyKey: `coil-unit-prices:${crypto.randomUUID()}`,
        ...normalized,
        updates,
        updatedCount: updates.length,
        changes: updates.flatMap(item => [
            {
                resourceType: 'coil',
                resourceId: item.coilId,
                field: 'unitPrice',
                from: item.currentUnitPrice,
                to: item.unitPrice,
            },
            {
                resourceType: 'coil',
                resourceId: item.coilId,
                field: 'cost',
                from: item.currentCost,
                to: Number(item.cost),
            },
        ]),
        warnings: updates.some(item => !item.expectedUpdatedAt) ? [{
            code: 'coil_version_missing',
            message: '部分历史线圈缺少 updatedAt；预览哈希仍绑定其成本快照',
        }] : [],
    };
}

function executeCoilUnitPriceBatch(
    dependencies,
    input = {},
    commandContext = {}
) {
    const normalized = normalizeSpecPriceInput(input);
    const previewHash = normalizePreviewHash(input.previewHash);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: BATCH_UNIT_PRICE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'coil', eventType: 'updated' }),
        input: { ...normalized, previewHash },
        warnings: [
            ...(commandContext.warnings || []),
            ...(!previewHash ? [{
                code: 'preview_hash_missing_compatibility',
                message: '线圈批量改单片价未绑定正式预览',
            }] : []),
        ],
        execute: ({ auditContext }) => {
            const currentPreview = buildCoilUnitPricePreview(
                dependencies,
                normalized
            );
            assertPreviewHash(
                previewHash,
                currentPreview.previewHash,
                '线圈单片价、成本或版本已经变化，请重新预览'
            );
            const coils = [];
            const auditIds = [];
            for (const item of currentPreview.updates) {
                const record = getCoilRecord(dependencies, item.coilId);
                assertExpectedUpdatedAt(
                    record,
                    item.expectedUpdatedAt,
                    `线圈 #${item.coilId}`
                );
                const write = dependencies.safeUpdate(
                    'coils',
                    item.coilId,
                    {
                        unit_price: item.unitPrice,
                        cost: item.cost,
                    },
                    auditContext
                );
                if (write.auditId) auditIds.push(write.auditId);
                coils.push(dependencies.coilRow(
                    getCoilRecord(dependencies, item.coilId)
                ));
            }
            return {
                data: {
                    updated: coils.length,
                    updatedCount: coils.length,
                    coils,
                },
                resource: {
                    type: 'coil',
                    ids: coils.map(coil => coil.id),
                },
                changes: currentPreview.changes,
                auditIds,
                requiredAuditCount: coils.length,
                warnings: currentPreview.warnings,
            };
        },
    });
}

module.exports = {
    BATCH_UNIT_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildCoilUnitPricePreview,
    executeCoilCreate,
    executeCoilDelete,
    executeCoilUnitPriceBatch,
    executeCoilUpdate,
};
