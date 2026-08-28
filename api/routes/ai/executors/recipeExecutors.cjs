const { getJson, postJson, patchJson, deleteJson } = require('../internalApiClient.cjs');

async function loadParts(internalFetch) {
    return getJson(internalFetch, '/api/parts', '零件列表读取失败');
}

function recipeUpdateError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
}

function normalizedRecipeName(value) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('zh-CN');
}

function resolveRecipeWriteTarget(recipes, recipeName, operation = 'update') {
    const action = operation === 'delete' ? '删除' : '修改';
    const codePrefix = operation === 'delete' ? 'recipe_delete' : 'recipe_update';
    const query = normalizedRecipeName(recipeName);
    if (!query) {
        throw recipeUpdateError(
            `${codePrefix}_target_required`,
            `缺少要${action}的配方名称`
        );
    }
    const candidates = Array.isArray(recipes) ? recipes : [];
    const exact = candidates.filter(recipe => normalizedRecipeName(recipe?.name) === query);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
        throw recipeUpdateError(
            `${codePrefix}_target_ambiguous`,
            `配方名称“${recipeName}”匹配到多个正式配方，不能生成${action}确认`,
            { candidates: exact.slice(0, 10).map(recipe => ({ id: recipe.id ?? recipe.Id, name: recipe.name })) }
        );
    }
    const partial = candidates.filter(recipe => normalizedRecipeName(recipe?.name).includes(query));
    if (partial.length === 1) return partial[0];
    if (partial.length === 0) {
        throw recipeUpdateError(
            `${codePrefix}_target_not_found`,
            `找不到配方: ${recipeName}`
        );
    }
    throw recipeUpdateError(
        `${codePrefix}_target_ambiguous`,
        `配方名称“${recipeName}”匹配到多个正式配方，请使用完整名称`,
        { candidates: partial.slice(0, 10).map(recipe => ({ id: recipe.id ?? recipe.Id, name: recipe.name })) }
    );
}

function buildAiRecipeParts(parts, allParts) {
    return (Array.isArray(parts) ? parts : []).map(part => {
        const model = String(part?.model || '').trim();
        if (!model) return null;
        const dbPart = allParts.find(dp => (dp.model || '') === model || (dp.model || '').includes(model));
        return {
            ...(dbPart?.id || dbPart?.Id ? { partId: Number(dbPart.id || dbPart.Id) } : {}),
            model,
            name: dbPart ? (dbPart.model || model) : model,
            supplier: dbPart ? (dbPart.supplier || '-') : '-',
            qty: Number(part?.qty || 0),
            snapshotPrice: dbPart ? Number(dbPart.price || 0) : 0
        };
    }).filter(Boolean);
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function buildFormFromRecipe(recipe, overrides = {}) {
    return {
        name: overrides.name ?? recipe.name ?? '',
        spec: overrides.spec ?? recipe.spec ?? '',
        templateId: recipe.templateId ?? null,
        coilSpec: recipe.coilSpec || '',
        coilSheets: recipe.coilSheets ?? 0,
        coilMaterial: recipe.coilMaterial || '钢带',
        coilSlotType: recipe.coilSlotType || '小眼',
        coilWireWeight: recipe.coilWireWeight ?? null,
        hasFloat: Boolean(recipe.hasFloat),
        floatWire: recipe.floatWire || '',
        floatAccessoryType: recipe.floatAccessoryType || 'standard',
        hasCable: Boolean(recipe.hasCable),
        cableLength: recipe.cableLength ?? 0,
        cableWire: recipe.cableWire || '',
        cableAccessoryType: recipe.cableAccessoryType || 'standard',
        boxType: recipe.boxType || '',
        customBarrelLength: recipe.customBarrelLength ?? null,
        longScrewExtraLength: recipe.longScrewExtraLength ?? 0,
        modelVariantId: recipe.modelVariantId ?? null,
        impellerModel: recipe.impellerModel || '',
        impellerThickness: recipe.impellerThickness ?? null,
        impellerDiameter: recipe.impellerDiameter ?? null,
        impellerBladeCount: recipe.impellerBladeCount ?? null,
        assemblyWage: recipe.assemblyWage ?? 0,
        packingWage: recipe.packingWage ?? 0,
        surfaceTreatmentMode: recipe.surfaceTreatmentMode || 'none',
        surfaceTreatmentCost: recipe.surfaceTreatmentCost ?? 0,
        managementFee: recipe.managementFee ?? 0,
    };
}

function buildRecipeComparison(recipe1, recipe2, drivers = []) {
    return drivers.map(driver => ({
        key: `name:${driver.key}`,
        model: driver.name,
        name: driver.name,
        model1: (driver.leftIdentities || []).join('、') || '-',
        model2: (driver.rightIdentities || []).join('、') || '-',
        qty1: Number(driver.leftQty || 0),
        amount1: Number(driver.leftAmount || 0),
        qty2: Number(driver.rightQty || 0),
        amount2: Number(driver.rightAmount || 0),
        diff: Number(Number(driver.diff || 0).toFixed(2)),
        difference: driver.reason === '只存在于基准配方'
            ? '仅配方1有'
            : driver.reason === '只存在于对比配方'
                ? '仅配方2有'
                : driver.reason === '型号或供应商不同'
                    ? '型号不同'
                    : driver.reason === '数量不同'
                        ? '数量不同'
                        : '金额不同',
        onlyIn: driver.reason === '只存在于基准配方'
            ? recipe1
            : driver.reason === '只存在于对比配方'
                ? recipe2
                : '两者共有',
    }));
}

async function buildAiRecipeSavePayload(internalFetch, form, parts, options = {}) {
    const optionalParts = options.optionalParts === undefined
        ? parts
        : options.optionalParts;
    return postJson(internalFetch, '/api/recipes/save-payload-draft', {
        ...(options.recipeId ? {
            recipeId: Number(options.recipeId),
            expectedUpdatedAt: options.expectedUpdatedAt,
        } : {}),
        form: {
            name: form.name,
            spec: form.spec || '',
            assemblyWage: form.assemblyWage ?? 0,
            packingWage: form.packingWage ?? 0,
            surfaceTreatmentMode: form.surfaceTreatmentMode || 'none',
            surfaceTreatmentCost: form.surfaceTreatmentCost ?? 0,
            managementFee: form.managementFee ?? 0,
            templateId: form.templateId ?? null,
            coilSpec: form.coilSpec || '',
            coilSheets: form.coilSheets ?? 0,
            coilMaterial: form.coilMaterial || '钢带',
            coilSlotType: form.coilSlotType || '小眼',
            coilWireWeight: form.coilWireWeight ?? null,
            hasFloat: Boolean(form.hasFloat),
            floatWire: form.floatWire || '',
            floatAccessoryType: form.floatAccessoryType || 'standard',
            hasCable: Boolean(form.hasCable),
            cableLength: form.cableLength ?? 0,
            cableWire: form.cableWire || '',
            cableAccessoryType: form.cableAccessoryType || 'standard',
            boxType: form.boxType || '',
            customBarrelLength: form.customBarrelLength ?? null,
            longScrewExtraLength: form.longScrewExtraLength ?? 0,
            modelVariantId: form.modelVariantId ?? null,
            impellerModel: form.impellerModel || '',
            impellerThickness: form.impellerThickness ?? null,
            impellerDiameter: form.impellerDiameter ?? null,
            impellerBladeCount: form.impellerBladeCount ?? null,
        },
        packingParts: options.packingParts || [],
        optionalParts,
        technicalData: options.technicalData || {},
    }, '生成配方保存草稿失败');
}

async function resolvePersistedOptionalParts(internalFetch, recipe, authoritativeParts) {
    const persisted = parsePersistedJsonArray(recipe.extraPartsJson);
    if (persisted.known && persisted.value.length > 0) return persisted.value;

    // extra_parts_json was added after parts_json. For legacy rows an empty
    // value is not enough to prove that no manual selections existed. Rebuild
    // the current generated BOM with zero optional parts and accept it only
    // when it fully explains the stored BOM composition. Current prices may
    // differ, but identities, suppliers, quantities and duplicate counts may not.
    try {
        const regenerated = await buildAiRecipeSavePayload(
            internalFetch,
            buildFormFromRecipe(recipe),
            [],
            {
                recipeId: recipe.id ?? recipe.Id,
                expectedUpdatedAt: recipe.updatedAt ?? recipe.UpdatedAt,
                packingParts: parseJsonArray(recipe.packingPartsJson),
                optionalParts: [],
                technicalData: parseJsonObject(recipe.technicalDataJson),
            }
        );
        if (sameBomComposition(authoritativeParts, parseJsonArray(regenerated.partsJson))) {
            return [];
        }
    } catch {
        // A failed formal draft means the stored BOM cannot be classified safely.
    }

    const error = new Error(
        '该历史配方缺少可验证的可选零件选择，无法安全区分手工零件与模板/线圈/浮球/电缆生成项；请先在配方页面核对并保存一次后再由 AI 修改'
    );
    error.code = 'RECIPE_OPTIONAL_PARTS_MIGRATION_REQUIRED';
    throw error;
}

function parsePersistedJsonArray(value) {
    if (Array.isArray(value)) return { known: true, value };
    if (value === undefined || value === null || String(value).trim() === '') {
        return { known: false, value: [] };
    }
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed)
            ? { known: true, value: parsed }
            : { known: false, value: [] };
    } catch {
        return { known: false, value: [] };
    }
}

function bomComposition(parts) {
    return (Array.isArray(parts) ? parts : [])
        .map(part => JSON.stringify([
            String(part?.model || '').trim(),
            String(part?.supplier || '').trim(),
            Number(part?.qty ?? 0),
        ]))
        .sort();
}

function sameBomComposition(left, right) {
    const leftRows = bomComposition(left);
    const rightRows = bomComposition(right);
    return leftRows.length === rightRows.length
        && leftRows.every((row, index) => row === rightRows[index]);
}

function matchesPartModel(part, model) {
    const candidate = String(part?.model || '').trim();
    const query = String(model || '').trim();
    return Boolean(candidate && query && (candidate === query || candidate.includes(query)));
}

function resolveEditablePartIndex(parts, model) {
    const query = normalizedRecipeName(model);
    const exact = parts
        .map((part, index) => ({ part, index }))
        .filter(item => normalizedRecipeName(item.part?.model) === query);
    if (exact.length === 1) return exact[0].index;
    if (exact.length > 1) {
        throw recipeUpdateError(
            'recipe_optional_part_ambiguous',
            `可编辑零件“${model}”在配方中存在多条同型号记录，不能安全修改`
        );
    }
    const partial = parts
        .map((part, index) => ({ part, index }))
        .filter(item => normalizedRecipeName(item.part?.model).includes(query));
    if (partial.length === 1) return partial[0].index;
    if (partial.length > 1) {
        throw recipeUpdateError(
            'recipe_optional_part_ambiguous',
            `可编辑零件“${model}”匹配到多个配方零件，请使用完整型号`
        );
    }
    return -1;
}

function sameJsonValue(left, right) {
    const normalize = value => {
        if (Array.isArray(value)) return value.map(normalize);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
    };
    const parse = value => {
        if (typeof value !== 'string') return value;
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    };
    return JSON.stringify(normalize(parse(left))) === JSON.stringify(normalize(parse(right)));
}

function assertRecipeUpdatePreview(recipe, draft) {
    const recipeId = Number(recipe.id ?? recipe.Id);
    if (
        draft?.capabilityId !== 'recipes.update'
        || Number(draft?.recipeId) !== recipeId
        || !draft?.previewHash
        || !draft?.suggestedIdempotencyKey
        || !draft?.expectedUpdatedAt
        || !Array.isArray(draft?.changes)
        || !Array.isArray(draft?.warnings)
    ) {
        throw recipeUpdateError(
            'recipe_update_preview_invalid',
            '正式配方保存草稿缺少版本、预览或变更凭证，不能生成确认'
        );
    }
    if (draft.warnings.length > 0) {
        throw recipeUpdateError(
            'recipe_update_preview_warning',
            '正式配方保存草稿包含警告，不能生成修改确认',
            { warnings: draft.warnings }
        );
    }
}

function assertRecipeUpdateReadback(draft, readback) {
    const scalarFields = [
        'name', 'spec', 'savedTotalCost', 'templateId', 'coilSpec', 'coilSheets',
        'coilMaterial', 'coilSlotType', 'coilWireWeight', 'hasFloat', 'floatWire',
        'floatAccessoryType', 'hasCable', 'cableLength', 'cableWire',
        'cableAccessoryType', 'customBarrelLength', 'longScrewExtraLength',
        'modelVariantId', 'impellerModel', 'impellerThickness', 'impellerDiameter',
        'impellerBladeCount', 'assemblyWage', 'packingWage', 'surfaceTreatmentMode',
        'surfaceTreatmentCost', 'managementFee', 'boxType', 'paintingWage',
    ];
    const jsonFields = [
        'partsJson', 'extraPartsJson', 'packingPartsJson', 'savedCostDetails',
        'technicalDataJson', 'configurationPolicyJson',
    ];
    const mismatch = scalarFields.find(field => {
        const expected = draft[field] ?? null;
        const actual = readback?.[field] ?? null;
        if (expected === null || actual === null) return expected !== actual;
        return typeof expected === 'number' || typeof actual === 'number'
            ? Number(expected) !== Number(actual)
            : expected !== actual;
    }) || jsonFields.find(field => !sameJsonValue(draft[field] ?? null, readback?.[field] ?? null));
    if (mismatch) {
        throw recipeUpdateError(
            'recipe_update_readback_mismatch',
            `配方修改后的正式回读字段 ${mismatch} 与确认预览不一致，不能声明成功`,
            { field: mismatch }
        );
    }
}

async function buildRecipeUpdatePreparation(args = {}, dependencies = {}) {
    const { internalFetch, getJson: readJson = getJson, postJson: createDraft = postJson } = dependencies;
    const {
        recipeName,
        newName,
        newSpec,
        clearSpec = false,
        addParts = [],
        removeParts = [],
        updateParts = [],
    } = args;
    const allRecipes = await readJson(internalFetch, '/api/recipes', '配方列表读取失败');
    const recipe = resolveRecipeWriteTarget(allRecipes, recipeName);
    if (recipe.paintingWage !== null && recipe.paintingWage !== undefined) {
        throw recipeUpdateError(
            'recipe_legacy_painting_wage_migration_required',
            '该历史配方仍保存旧喷漆工资字段，正式保存会迁移到表面处理口径；请先在配方页面核对并保存一次后再由 AI 修改'
        );
    }
    const requestedPartChangeCount = addParts.length + removeParts.length + updateParts.length;
    if (requestedPartChangeCount > 15) {
        throw recipeUpdateError(
            'recipe_update_too_many_part_changes',
            '单次配方修改最多包含 15 项零件增删改，请拆分后重新确认'
        );
    }
    const requestedPartSelectors = [
        ...addParts.map(part => part.model),
        ...removeParts,
        ...updateParts.map(part => part.model),
    ].map(normalizedRecipeName);
    if (new Set(requestedPartSelectors).size !== requestedPartSelectors.length) {
        throw recipeUpdateError(
            'recipe_update_duplicate_part_target',
            '同一个零件不能在一次配方修改中重复增删改'
        );
    }
    const authoritativeParts = parseJsonArray(recipe.partsJson);
    let parts = await resolvePersistedOptionalParts(internalFetch, recipe, authoritativeParts);
    const requestedChanges = [];

    for (const model of removeParts) {
        const index = resolveEditablePartIndex(parts, model);
        if (index >= 0) {
            const [removed] = parts.splice(index, 1);
            requestedChanges.push({ label: '移除零件', value: `${removed.model} × ${removed.qty}` });
            continue;
        }
        if (authoritativeParts.some(part => matchesPartModel(part, model))) {
            throw recipeUpdateError(
                'recipe_generated_part_not_editable',
                '模板或联动规则生成的零件不能通过配方工具直接移除，请修改模板或配置'
            );
        }
        throw recipeUpdateError('recipe_optional_part_not_found', `找不到可编辑的配方零件: ${model}`);
    }

    for (const update of updateParts) {
        const index = resolveEditablePartIndex(parts, update.model);
        if (index >= 0) {
            const found = parts[index];
            requestedChanges.push({ label: `修改零件 ${found.model}`, value: `${found.qty} → ${update.qty}` });
            found.qty = update.qty;
            continue;
        }
        if (authoritativeParts.some(part => matchesPartModel(part, update.model))) {
            throw recipeUpdateError(
                'recipe_generated_part_not_editable',
                '模板或联动规则生成的零件数量不能通过配方工具直接修改，请修改模板或配置'
            );
        }
        throw recipeUpdateError('recipe_optional_part_not_found', `找不到可编辑的配方零件: ${update.model}`);
    }

    if (addParts.length > 0) {
        const allParts = await readJson(internalFetch, '/api/parts', '零件列表读取失败');
        for (const added of addParts) {
            const matches = allParts.filter(part => (
                (part.model || '') === added.model || (part.model || '').includes(added.model)
            ));
            if (matches.length !== 1) {
                throw recipeUpdateError(
                    matches.length === 0 ? 'recipe_part_not_found' : 'recipe_part_ambiguous',
                    matches.length === 0
                        ? `找不到要添加的正式零件: ${added.model}`
                        : `要添加的零件“${added.model}”匹配到多个正式零件，请使用完整型号`
                );
            }
            const part = matches[0];
            parts.push({
                partId: Number(part.id ?? part.Id),
                model: part.model,
                name: part.model,
                supplier: part.supplier || '-',
                qty: added.qty,
                snapshotPrice: Number(part.price || 0),
            });
            requestedChanges.push({ label: '添加零件', value: `${part.model} × ${added.qty}` });
        }
    }

    if (clearSpec === true && newSpec !== undefined && String(newSpec).trim() !== '') {
        throw recipeUpdateError(
            'recipe_update_spec_change_conflict',
            'clearSpec=true 时不能同时提供非空 newSpec'
        );
    }
    const targetName = newName === undefined ? recipe.name : String(newName).trim();
    const targetSpec = clearSpec === true
        ? ''
        : newSpec === undefined
            ? (recipe.spec || '')
            : String(newSpec).trim();
    if (!targetName) {
        throw recipeUpdateError('recipe_update_name_required', '配方名称不能为空');
    }
    if (targetName !== recipe.name) {
        const duplicateName = allRecipes.find(candidate => (
                Number(candidate.id ?? candidate.Id) !== Number(recipe.id ?? recipe.Id)
                && normalizedRecipeName(candidate.name) === normalizedRecipeName(targetName)
            ));
        if (duplicateName) {
            throw recipeUpdateError(
                'recipe_update_name_conflict',
                `配方名称“${targetName}”已存在，不能生成修改确认`
            );
        }
    }
    if (targetName !== recipe.name) requestedChanges.unshift({ label: '名称', value: `${recipe.name} → ${targetName}` });
    if (targetSpec !== (recipe.spec || '')) requestedChanges.unshift({ label: '规格', value: `${recipe.spec || '-'} → ${targetSpec || '-'}` });
    if (requestedChanges.length === 0) {
        throw recipeUpdateError('recipe_update_no_changes', '没有指定任何有效修改');
    }

    const draft = await createDraft(
        internalFetch,
        '/api/recipes/save-payload-draft',
        {
            recipeId: Number(recipe.id ?? recipe.Id),
            expectedUpdatedAt: recipe.updatedAt ?? recipe.UpdatedAt,
            form: buildFormFromRecipe(recipe, { name: targetName, spec: targetSpec }),
            packingParts: parseJsonArray(recipe.packingPartsJson),
            optionalParts: parts,
            technicalData: parseJsonObject(recipe.technicalDataJson),
        },
        '生成配方保存草稿失败'
    );
    assertRecipeUpdatePreview(recipe, draft);

    const oldBomCount = authoritativeParts.length;
    const newBomCount = parseJsonArray(draft.partsJson).length;
    const oldCost = Number(recipe.savedTotalCost || 0);
    const newCost = Number(draft.savedTotalCost || 0);
    return {
        args: { ...args, recipeName: recipe.name },
        confirmationRows: [
            { label: '正式配方', value: `${recipe.name}（#${recipe.id ?? recipe.Id}）` },
            ...requestedChanges,
            { label: 'BOM 条数', value: `${oldBomCount} → ${newBomCount}` },
            { label: '保存成本', value: `${oldCost} 元 → ${newCost} 元` },
        ],
        executionContext: {
            kind: 'recipe_update_preview',
            recipeId: Number(recipe.id ?? recipe.Id),
            recipeName: recipe.name,
            requestedChanges,
            draft,
        },
    };
}

async function prepareRecipeUpdate(args = {}, dependencies = {}) {
    return buildRecipeUpdatePreparation(args, dependencies);
}

async function prepareRecipeDelete(args = {}, dependencies = {}) {
    const { internalFetch, getJson: readJson = getJson } = dependencies;
    const recipes = await readJson(internalFetch, '/api/recipes', '配方列表读取失败');
    const recipe = resolveRecipeWriteTarget(recipes, args.recipeName, 'delete');
    const recipeId = Number(recipe.id ?? recipe.Id);
    const expectedUpdatedAt = recipe.updatedAt ?? recipe.UpdatedAt;
    if (!expectedUpdatedAt) {
        throw recipeUpdateError(
            'recipe_delete_version_missing',
            '正式配方缺少版本字段，不能生成删除确认'
        );
    }
    return {
        args: { ...args, recipeName: recipe.name },
        confirmationRows: [
            { label: '正式配方', value: `${recipe.name}（#${recipeId}）` },
            { label: '规格', value: recipe.spec || '-' },
            { label: '版本', value: expectedUpdatedAt },
        ],
        executionContext: {
            kind: 'recipe_delete_target',
            recipeId,
            recipeName: recipe.name,
            expectedUpdatedAt,
        },
    };
}

async function executePreparedRecipeUpdate(args = {}, dependencies = {}) {
    const {
        internalFetch,
        getJson: readJson = getJson,
        postJson: createDraft = postJson,
        patchJson: updateJson = patchJson,
        confirmationContext,
    } = dependencies;
    const prepared = confirmationContext?.kind === 'recipe_update_preview'
        ? { executionContext: confirmationContext }
        : await buildRecipeUpdatePreparation(args, { internalFetch, getJson: readJson, postJson: createDraft });
    const context = prepared.executionContext;
    const saved = await updateJson(
        internalFetch,
        `/api/recipes/${context.recipeId}`,
        context.draft,
        '配方修改失败'
    );
    const readback = await readJson(
        internalFetch,
        `/api/recipes/${context.recipeId}`,
        '配方修改后回读失败'
    );
    assertRecipeUpdateReadback(context.draft, readback);
    const auditIds = Array.isArray(saved.auditIds)
        ? saved.auditIds.filter(Boolean)
        : saved.auditId
            ? [saved.auditId]
            : [];
    if (!saved.operationId || saved.status !== 'completed' || auditIds.length === 0) {
        throw recipeUpdateError(
            'recipe_update_receipt_missing',
            '正式配方更新 API 未返回完整 operation/audit 回执，不能声明修改成功'
        );
    }
    return {
        success: true,
        message: `配方“${context.recipeName}”修改成功（已通过标准 API 写入并回读）`,
        recipeName: readback.name,
        recipeId: context.recipeId,
        partsCount: parseJsonArray(readback.partsJson).length,
        newCost: readback.savedTotalCost,
        changes: Array.isArray(saved.changes) ? saved.changes : [],
        warnings: Array.isArray(saved.warnings) ? saved.warnings : [],
        operationId: saved.operationId,
        formalOperationId: saved.operationId,
        auditId: auditIds[0],
        auditIds,
        status: saved.status,
        readback,
    };
}

async function executeRecipeTool(toolName, args, internalFetch, options = {}) {
    switch (toolName) {
        case 'create_recipe': {
            const { name, spec = '', parts = [] } = args;
            if (!name) return { success: false, error: '缺少配方名称' };

            try {
                const recipeParts = buildAiRecipeParts(parts, await loadParts(internalFetch));
                const payload = await buildAiRecipeSavePayload(internalFetch, { name, spec }, recipeParts);
                const saved = await postJson(internalFetch, '/api/recipes', payload, '配方创建失败');
                return {
                    success: true,
                    message: `配方"${name}"创建成功（已通过标准 API 写入）`,
                    recipe: {
                        id: saved.id || saved.Id,
                        name: saved.name || name,
                        spec: saved.spec || spec,
                        partsCount: recipeParts.length,
                        totalCost: saved.savedTotalCost ?? payload.savedTotalCost
                    }
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        case 'delete_recipe': {
            const prepared = options.confirmationContext?.kind === 'recipe_delete_target'
                ? { executionContext: options.confirmationContext }
                : await prepareRecipeDelete(args, { internalFetch, getJson });
            const context = prepared.executionContext;
            await deleteJson(
                internalFetch,
                `/api/recipes/${context.recipeId}`,
                '配方删除失败',
                { expectedUpdatedAt: context.expectedUpdatedAt }
            );
            return {
                success: true,
                message: `配方"${context.recipeName}"已删除`,
                recipeId: context.recipeId,
                recipeName: context.recipeName,
            };
        }

        case 'update_recipe': {
            try {
                return await executePreparedRecipeUpdate(args, {
                    internalFetch,
                    getJson,
                    postJson,
                    patchJson,
                    confirmationContext: options.confirmationContext,
                });
            } catch (error) {
                return {
                    success: false,
                    code: error.code || 'recipe_update_failed',
                    error: error.message,
                    ...(error.details || {}),
                };
            }
        }

        case 'compare_recipes': {
            const { recipe1, recipe2 } = args;
            const difference = await postJson(internalFetch, '/api/cost/recipe-difference', {
                leftRecipeName: recipe1,
                rightRecipeName: recipe2,
                limit: 20,
            }, '配方成本对比失败');
            const comparison = buildRecipeComparison(
                difference.left.name,
                difference.right.name,
                difference.drivers
            );

            return {
                success: true,
                recipe1: {
                    name: difference.left.name,
                    spec: difference.left.spec,
                    cost: difference.left.totalCost,
                    partsCost: difference.left.partsCost,
                    laborCost: difference.left.laborCost,
                    partsCount: difference.left.itemCount,
                },
                recipe2: {
                    name: difference.right.name,
                    spec: difference.right.spec,
                    cost: difference.right.totalCost,
                    partsCost: difference.right.partsCost,
                    laborCost: difference.right.laborCost,
                    partsCount: difference.right.itemCount,
                },
                costDiff: Number(difference.totalDiff || 0).toFixed(2),
                costBasis: difference.costBasis,
                sourceOfTruth: difference.sourceOfTruth,
                generatedAt: difference.generatedAt,
                warnings: difference.warnings || [],
                comparison,
            };
        }

        default:
            return null;
    }
}

module.exports = { executeRecipeTool, prepareRecipeDelete, prepareRecipeUpdate };
