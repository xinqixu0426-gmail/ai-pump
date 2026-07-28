/**
 * 数据库初始化 + 共享辅助函数
 */
const path = require('path');
const Database = require('better-sqlite3');
const { createLogger } = require('./logger.cjs');
const { calculateRecipeCost: calculateRecipeCostFromEngine } = require('./services/costEngine.cjs');
const { collapseLegacyCableParts } = require('./services/cableAccessory.cjs');
const { partSubcategory } = require('./services/packagingClassification.cjs');
const { pruneAuditLog } = require('./services/auditRetention.cjs');
const { runMigrations } = require('./database/migrations.cjs');
const backupLogger = createLogger('backup');

// ── SQLite 初始化 ──
const DB_PATH = path.join(__dirname, '..', 'pump.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('wal_checkpoint(TRUNCATE)'); // 启动时清理 WAL，避免 WAL 文件无限增长

// ── 版本化数据库迁移 ──
const migrationState = runMigrations(db);
if (migrationState.appliedVersions.length > 0) {
    backupLogger.info(`数据库迁移完成: ${migrationState.appliedVersions.join(', ')}，当前版本 ${migrationState.currentVersion}`);
}

// seed 默认管理费
const existing = db.prepare('SELECT key FROM system_settings WHERE key = ?').get('management_fee');
if (!existing) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('management_fee', '5', new Date().toISOString());
}
// 已移除线圈材质默认单价配置，启动时清理历史设置。
db.prepare('DELETE FROM system_settings WHERE key = ?').run('coil_material_prices');
const existingCableAccessories = db.prepare('SELECT key FROM system_settings WHERE key = ?').get('cable_accessories');
if (!existingCableAccessories) {
    const legacyCableAccessoryPart = db.prepare(`SELECT price FROM parts WHERE model = '电缆配件费' ORDER BY price LIMIT 1`).get();
    const cableParts = db.prepare(`SELECT remark FROM parts WHERE model LIKE '电缆-线径%' AND remark IS NOT NULL AND TRIM(remark) <> ''`).all();
    const inferred = {
        standard: { name: '普通铜套', fee: Number(legacyCableAccessoryPart?.price || 0) },
        xinjie: { name: '新界式', fee: 0 },
    };
    for (const part of cableParts) {
        try {
            const meta = JSON.parse(part.remark);
            for (const type of ['standard', 'xinjie']) {
                const name = meta?.cableAccessoryNames?.[type];
                const fee = Number(meta?.cableAccessoryFees?.[type] ?? (type === 'standard' ? meta?.cableAccessoryFee : undefined));
                if (typeof name === 'string' && name.trim()) inferred[type].name = name.trim();
                if (Number.isFinite(fee) && fee >= 0 && (fee > 0 || inferred[type].fee === 0)) inferred[type].fee = fee;
            }
            break;
        } catch { /* try next cable part */ }
    }
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('cable_accessories', JSON.stringify({
        standard: inferred.standard,
        xinjie: inferred.xinjie,
    }), new Date().toISOString());
}
if (!db.prepare('SELECT key FROM system_settings WHERE key = ?').get('float_accessory_delta')) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('float_accessory_delta', '0.6', new Date().toISOString());
}
if (!db.prepare('SELECT key FROM system_settings WHERE key = ?').get('aluminum_wire_price_per_kg')) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('aluminum_wire_price_per_kg', '0', new Date().toISOString());
}
if (!db.prepare('SELECT key FROM system_settings WHERE key = ?').get('usd_cny_rate')) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run('usd_cny_rate', '0', new Date().toISOString());
}

// ── Row Adapters ──

function partRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, model: r.model, category: r.category, subcategory: r.subcategory || '', price: r.price,
        supplier: r.supplier, stock: r.stock, notes: r.remark || '',
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function recipeRow(r) {
    if (!r) return r;
    const surfaceTreatmentMode = r.surface_treatment_mode || (r.painting_wage != null ? 'painting' : 'none');
    const surfaceTreatmentCost = r.surface_treatment_cost != null
        ? r.surface_treatment_cost
        : (r.painting_wage != null ? r.painting_wage : 0);
    return {
        id: r.id, Id: r.id, name: r.name, spec: r.spec,
        partsJson: (() => {
            try {
                return JSON.stringify(collapseLegacyCableParts(JSON.parse(r.parts_json || '[]')));
            } catch {
                return r.parts_json;
            }
        })(),
        savedTotalCost: r.saved_total_cost,
        savedCostDetails: r.saved_cost_details,
        templateId: r.template_id, coilSpec: r.coil_spec, coilSheets: r.coil_sheets,
        coilMaterial: r.coil_material || '钢带',
        coilSlotType: r.coil_slot_type || '小眼',
        coilWireWeight: r.coil_wire_weight,
        hasFloat: r.has_float, floatWire: r.float_wire, floatAccessoryType: r.float_accessory_type || 'standard', hasCable: r.has_cable,
        cableLength: r.cable_length, cableWire: r.cable_wire, cableAccessoryType: r.cable_accessory_type || 'standard', boxType: r.box_type,
        customBarrelLength: r.custom_barrel_length, extraPartsJson: r.extra_parts_json,
        modelVariantId: r.model_variant_id,
        impellerModel: r.impeller_model || '',
        impellerThickness: r.impeller_thickness,
        impellerDiameter: r.impeller_diameter,
        impellerBladeCount: r.impeller_blade_count,
        technicalDataJson: r.technical_data_json || '{}',
        longScrewExtraLength: Number(r.long_screw_extra_length || 0),
        packingPartsJson: r.packing_parts_json,
        assemblyWage: r.assembly_wage, packingWage: r.packing_wage, paintingWage: r.painting_wage,
        surfaceTreatmentMode,
        surfaceTreatmentCost,
        managementFee: r.management_fee,
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function templateRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, shellModel: r.shell_model, description: r.description || '',
        partsJson: r.parts_json || '[]', rotorParamsJson: r.rotor_params_json || '{}',
        shellComponentsJson: r.shell_components_json || '[]',
        assemblyWage: r.assembly_wage || 0, packingWage: r.packing_wage || 0,
        paintingWage: r.painting_wage != null ? r.painting_wage : null,
        surfaceTreatmentMode: r.surface_treatment_mode && !(r.surface_treatment_mode === 'none' && r.painting_wage != null)
            ? r.surface_treatment_mode
            : (r.painting_wage != null ? 'painting' : 'none'),
        surfaceTreatmentCost: r.surface_treatment_cost != null ? r.surface_treatment_cost : (r.painting_wage || 0),
        costMode: r.cost_mode || 'components', bundleCost: r.bundle_cost || 0, bundleNote: r.bundle_note || '',
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function modelVariantRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        Id: r.id,
        modelName: r.model_name,
        templateId: r.template_id,
        coilSpec: r.coil_spec || '',
        coilSheets: r.coil_sheets || 0,
        coilMaterial: r.coil_material || '钢带',
        coilSlotType: r.coil_slot_type || '小眼',
        barrelLength: r.barrel_length,
        longScrewExtraLength: r.long_screw_extra_length || 0,
        impellerModel: r.impeller_model || '',
        impellerThickness: r.impeller_thickness,
        impellerDiameter: r.impeller_diameter,
        impellerBladeCount: r.impeller_blade_count,
        note: r.note || '',
        customFieldsJson: r.custom_fields_json || '[]',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        CreatedAt: r.created_at,
        UpdatedAt: r.updated_at,
    };
}
function orderRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, customerName: r.customer_name, contractNo: r.contract_no,
        remark: r.remark, status: r.status, itemsJson: r.items_json,
        purchaseListJson: r.purchase_list_json, todosJson: r.todos_json,
        purchaseCompletedAt: r.purchase_completed_at || null,
        purchaseReceiptId: r.purchase_receipt_id || null,
        statusReason: r.status_reason || '',
        statusChangedAt: r.status_changed_at || null,
        closedAt: r.closed_at || null,
        cancelledAt: r.cancelled_at || null,
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function coilRow(r) {
    if (!r) return r;
    const variant = r.stator_variant_id
        ? db.prepare('SELECT * FROM stator_variants WHERE id = ?').get(r.stator_variant_id)
        : null;
    return {
        id: r.id, Id: r.id, spec: r.spec, material: r.material || '钢带', unitPrice: r.unit_price, sheets: r.sheets,
        statorVariantId: r.stator_variant_id || null,
        diameterMm: variant?.diameter_mm || (String(r.spec).trim() === '12' ? 120 : Number(r.spec) || 0),
        commonName: variant?.common_name || r.spec || '',
        slotType: variant?.slot_type || r.slot_type || '小眼',
        schemeName: r.scheme_name || '',
        schemeStatus: r.scheme_status || 'official',
        wireWeight: r.wire_weight, copperBase: r.copper_base,
        coilFee: r.coil_fee, rotorFee: r.rotor_fee,
        cost: r.cost, stock: Number(r.stock || 0),
        defaultCapacitor: r.default_capacitor, defaultWireGauge: r.default_wire_gauge,
        mainWireGauge: r.main_wire_gauge || '', mainWireData: r.main_wire_data || '',
        auxWireGauge: r.aux_wire_gauge || '', auxWireData: r.aux_wire_data || '',
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function customerRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, name: r.name, contactInfo: r.contact_info, defaultMargin: r.default_margin, remark: r.remark,
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function quotationRow(r) {
    if (!r) return r;
    return {
        id: r.id, Id: r.id, customerId: r.customer_id, status: r.status, itemsJson: r.items_json,
        totalCost: r.total_cost, totalPrice: r.total_price, remark: r.remark,
        convertedOrderId: r.converted_order_id || null, convertedAt: r.converted_at || null,
        createdAt: r.created_at, updatedAt: r.updated_at,
        CreatedAt: r.created_at, UpdatedAt: r.updated_at
    };
}
function knowledgeEntryRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        entryType: r.entry_type,
        sourceTable: r.source_table,
        sourceId: r.source_id,
        sourceUpdatedAt: r.source_updated_at,
        title: r.title,
        summary: r.summary || '',
        content: r.content || '',
        tagsJson: r.tags_json || '[]',
        metadataJson: r.metadata_json || '{}',
        searchText: r.search_text || '',
        contentHash: r.content_hash || '',
        syncedAt: r.synced_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
function aiConversationRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        title: r.title,
        messageCount: Number(r.message_count || 0),
        lastMessagePreview: r.last_message_preview || '',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
function aiConversationMessageRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role,
        content: r.content || '',
        metadataJson: r.metadata_json || '{}',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
function recipeTechnicalFileRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        recipeId: r.recipe_id,
        originalName: r.original_name,
        mimeType: r.mime_type || 'application/octet-stream',
        fileSize: Number(r.file_size || 0),
        fileSha256: r.file_sha256 || '',
        reportType: r.report_type || 'pump_performance_test',
        summaryJson: r.summary_json || '{}',
        parsedJson: r.parsed_json || '{}',
        extractedText: r.extracted_text || '',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
function aiAnswerFeedbackRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        conversationId: r.conversation_id,
        messageId: r.message_id,
        rating: r.rating,
        note: r.note || '',
        questionText: r.question_text || '',
        answerText: r.answer_text || '',
        sourcesJson: r.sources_json || '[]',
        diagnosisJson: r.diagnosis_json || '{}',
        diagnosedAt: r.diagnosed_at,
        retestAnswerText: r.retest_answer_text || '',
        retestSourcesJson: r.retest_sources_json || '[]',
        retestedAt: r.retested_at,
        status: r.status,
        resolutionNote: r.resolution_note || '',
        resolvedAt: r.resolved_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
function aiEvaluationCaseRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        caseKey: r.case_key,
        title: r.title,
        category: r.category,
        question: r.question,
        evaluatorType: r.evaluator_type,
        configJson: r.config_json || '{}',
        enabled: Boolean(r.enabled),
        sortOrder: Number(r.sort_order || 0),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
function aiEvaluationRunRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        status: r.status,
        totalCount: Number(r.total_count || 0),
        passedCount: Number(r.passed_count || 0),
        failedCount: Number(r.failed_count || 0),
        reviewCount: Number(r.review_count || 0),
        startedAt: r.started_at,
        completedAt: r.completed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
function aiEvaluationResultRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        runId: r.run_id,
        caseId: r.case_id,
        status: r.status,
        answerText: r.answer_text || '',
        toolResultsJson: r.tool_results_json || '[]',
        sourcesJson: r.sources_json || '[]',
        checksJson: r.checks_json || '[]',
        errorText: r.error_text || '',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
function recipeAnalysisFeedbackRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        recipeId: r.recipe_id,
        findingKey: r.finding_key,
        findingType: r.finding_type,
        decision: r.decision,
        note: r.note || '',
        findingSnapshotJson: r.finding_snapshot_json || '{}',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
function factoryRuleCandidateRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        ruleKey: r.rule_key,
        title: r.title,
        content: r.content,
        scopeType: r.scope_type,
        scopeRef: r.scope_ref,
        findingKey: r.finding_key,
        findingType: r.finding_type,
        evidenceCount: Number(r.evidence_count || 0),
        evidenceJson: r.evidence_json || '[]',
        status: r.status,
        reviewNote: r.review_note || '',
        approvedAt: r.approved_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}
function statorVariantRow(r) {
    if (!r) return r;
    return {
        id: r.id,
        diameterMm: Number(r.diameter_mm || 0),
        commonName: r.common_name || '',
        material: r.material || '钢带',
        slotType: r.slot_type || '小眼',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

// ── 数据访问层 ──
function dbGetAllParts() { return db.prepare('SELECT * FROM parts WHERE deleted_at IS NULL').all().map(partRow); }
function dbGetAllRecipes() { return db.prepare('SELECT * FROM recipes WHERE deleted_at IS NULL').all().map(recipeRow); }
function dbGetAllOrders() { return db.prepare('SELECT * FROM orders WHERE deleted_at IS NULL').all().map(orderRow); }
function dbGetAllCoils() { return db.prepare('SELECT * FROM coils').all().map(coilRow); }
function dbGetAllStatorVariants() { return db.prepare('SELECT * FROM stator_variants ORDER BY diameter_mm, material, slot_type').all().map(statorVariantRow); }
function dbGetAllTemplates() { return db.prepare('SELECT * FROM pump_shell_templates ORDER BY shell_model').all().map(templateRow); }
function dbGetAllModelVariants() { return db.prepare('SELECT * FROM pump_model_variants WHERE deleted_at IS NULL ORDER BY model_name').all().map(modelVariantRow); }
function dbGetAllCustomers() { return db.prepare('SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY id DESC').all().map(customerRow); }
function dbGetAllQuotations() { return db.prepare('SELECT * FROM quotations WHERE deleted_at IS NULL ORDER BY id DESC').all().map(quotationRow); }
function dbGetAllRecipeTechnicalFiles() {
    return db.prepare(`
        SELECT id, recipe_id, original_name, mime_type, file_size, file_sha256,
               report_type, summary_json, parsed_json, extracted_text, created_at, updated_at
        FROM recipe_technical_files
        WHERE deleted_at IS NULL
        ORDER BY recipe_id, id DESC
    `).all().map(recipeTechnicalFileRow);
}
function dbGetRecipeAnalysisFeedback(recipeId) {
    return db.prepare(`
        SELECT * FROM recipe_analysis_feedback
        WHERE recipe_id = ?
        ORDER BY updated_at DESC, id DESC
    `).all(recipeId).map(recipeAnalysisFeedbackRow);
}
function dbGetFactoryRuleCandidates(status) {
    const rows = status
        ? db.prepare('SELECT * FROM factory_rule_candidates WHERE status = ? ORDER BY updated_at DESC, id DESC').all(status)
        : db.prepare('SELECT * FROM factory_rule_candidates ORDER BY updated_at DESC, id DESC').all();
    return rows.map(factoryRuleCandidateRow);
}

function extractPartFields(body) {
    const category = body.category || '其他';
    return {
        model: body.model || '',
        category,
        subcategory: partSubcategory(category, body.subcategory, body),
        price: body.price ?? 0,
        supplier: body.supplier || '-',
        stock: body.stock ?? 0,
        remark: body.notes || body.remark || '',
    };
}

// 兼容导出：成本计算本体位于 api/services/costEngine.cjs。
function calculateRecipeCost(parts, partsCache, partsByModel) {
    return calculateRecipeCostFromEngine(parts, partsCache, partsByModel, { getSetting });
}

function getSetting(key) {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
    return row ? row.value : null;
}
function setSetting(key, value) {
    const now = new Date().toISOString();
    const oldRow = db.prepare('SELECT key, value, updated_at FROM system_settings WHERE key = ?').get(key);
    db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, String(value), now);
    try {
        const newRow = { key, value: String(value), updated_at: now };
        writeAuditLog(oldRow ? 'SETTING_UPDATE' : 'SETTING_INSERT', 'system_settings', null, oldRow ? JSON.stringify(oldRow) : null, JSON.stringify(newRow));
    } catch { /* 审计日志写入失败不应阻断业务 */ }
}

function getConfig(key) {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row ? row.value : null;
}
function setConfig(key, value) {
    const oldRow = db.prepare('SELECT key, value FROM config WHERE key = ?').get(key);
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
    try {
        const newRow = { key, value: String(value) };
        writeAuditLog(oldRow ? 'CONFIG_UPDATE' : 'CONFIG_INSERT', 'config', null, oldRow ? JSON.stringify(oldRow) : null, JSON.stringify(newRow));
    } catch { /* 审计日志写入失败不应阻断业务 */ }
}

/**
 * 安全执行 UPDATE — 列名经正则校验 + 表名走白名单
 * 从根源杜绝 SQL 注入：所有动态 UPDATE 必须走此函数
 * @param {string} table - 表名（需在白名单中）
 * @param {number} id - 记录 ID
 * @param {Record<string, any>} updates - { column_name: value }，undefined 值自动跳过
 */
const SAFE_TABLES = new Set(['parts', 'recipes', 'orders', 'coils', 'coil_stock_movements', 'stator_variants', 'pump_shell_templates', 'pump_model_variants', 'system_settings', 'rotor_drawings', 'customers', 'quotations', 'knowledge_entries', 'ai_conversations', 'ai_conversation_messages', 'ai_answer_feedback', 'ai_evaluation_cases', 'ai_evaluation_runs', 'ai_evaluation_results', 'recipe_technical_files', 'recipe_analysis_feedback', 'factory_rule_candidates']);
const SAFE_COL_RE = /^[a-z][a-z0-9_]*$/;

function auditJson(value) {
    return JSON.stringify(value, (_key, item) => {
        if (Buffer.isBuffer(item)) return `[binary ${item.length} bytes]`;
        if (item?.type === 'Buffer' && Array.isArray(item.data)) return `[binary ${item.data.length} bytes]`;
        return item;
    });
}

function safeInsert(table, values) {
    if (!SAFE_TABLES.has(table)) throw new Error(`safeInsert: 非法表名 "${table}"`);
    const cols = [];
    const vals = [];
    for (const [col, val] of Object.entries(values || {})) {
        if (val === undefined) continue;
        if (!SAFE_COL_RE.test(col)) throw new Error(`safeInsert: 非法列名 "${col}"`);
        cols.push(col);
        vals.push(val);
    }
    if (cols.length === 0) throw new Error('safeInsert: 写入字段不能为空');
    const placeholders = cols.map(() => '?').join(', ');
    const info = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
    try {
        const recordId = Number(info.lastInsertRowid);
        const newRow = Number.isInteger(recordId) && recordId > 0
            ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId)
            : values;
        writeAuditLog('INSERT', table, recordId || null, null, auditJson(newRow || values));
    } catch { /* 审计日志写入失败不应阻断业务 */ }
    return info;
}

function safeUpdate(table, id, updates) {
    if (!SAFE_TABLES.has(table)) throw new Error(`safeUpdate: 非法表名 "${table}"`);
    const sets = [];
    const vals = [];
    for (const [col, val] of Object.entries(updates)) {
        if (val === undefined) continue;
        if (!SAFE_COL_RE.test(col)) throw new Error(`safeUpdate: 非法列名 "${col}"`);
        sets.push(`${col} = ?`);
        vals.push(val);
    }
    if (sets.length === 0) return;
    // 审计日志：记录更新前的值
    const oldRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    sets.push('updated_at = ?');
    vals.push(new Date().toISOString());
    vals.push(id);
    db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    // 异步写审计日志，不阻塞主逻辑
    try {
        writeAuditLog('UPDATE', table, id, oldRow ? auditJson(oldRow) : null, auditJson(updates));
    } catch { /* 审计日志写入失败不应阻断业务 */ }
}

/**
 * 订单字段更新助手 — 替代 ai.cjs 中 5 处 copy-paste 的订单更新样板
 * @param {number} orderId
 * @param {object} fields - { status?, items_json?, purchase_list_json?, todos_json? }
 */
function updateOrderFields(orderId, fields) {
    safeUpdate('orders', orderId, fields);
}

/**
 * 软删除 — 标记 deleted_at 而非物理删除
 * @param {string} table - 表名
 * @param {number} id - 记录 ID
 */
function softDelete(table, id) {
    if (!SAFE_TABLES.has(table)) throw new Error(`softDelete: 非法表名 "${table}"`);
    const now = new Date().toISOString();
    // 记录旧值到审计日志
    const oldRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!oldRow) throw new Error(`softDelete: 记录不存在 (${table}#${id})`);
    db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
    try {
        writeAuditLog('SOFT_DELETE', table, id, auditJson(oldRow), null);
    } catch { /* 审计日志写入失败不应阻断业务 */ }
}

/**
 * 物理删除（用于暂未支持 deleted_at 的表），删除前写入审计日志
 */
function hardDelete(table, id) {
    if (!SAFE_TABLES.has(table)) throw new Error(`hardDelete: 非法表名 "${table}"`);
    const oldRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!oldRow) throw new Error(`hardDelete: 记录不存在 (${table}#${id})`);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    try {
        writeAuditLog('DELETE', table, id, auditJson(oldRow), null);
    } catch { /* 审计日志写入失败不应阻断业务 */ }
}

// ── P1.7: loadPartsData 缓存 ──
let _partsDataCache = null;
let _partsDataCacheTime = 0;
const PARTS_CACHE_TTL = 10_000; // 10秒缓存

function loadPartsData() {
    const now = Date.now();
    if (_partsDataCache && (now - _partsDataCacheTime) < PARTS_CACHE_TTL) {
        return _partsDataCache;
    }
    const records = db.prepare('SELECT * FROM parts WHERE deleted_at IS NULL').all();
    const partsCache = {};
    const partsByModel = {};
    records.forEach(record => {
        const model = record.model;
        const price = record.price || 0;
        const supplier = record.supplier || '-';
        const notes = record.remark || '';
        const category = record.category || '其他';
        partsCache[model] = { price, supplier, category, notes };
        if (!partsByModel[model]) partsByModel[model] = [];
        partsByModel[model].push({ id: record.id, model, category, supplier, price, notes });
    });
    _partsDataCache = { partsCache, partsByModel };
    _partsDataCacheTime = now;
    return _partsDataCache;
}

/** 使 loadPartsData 缓存失效（写入零件后调用） */
function invalidatePartsCache() {
    _partsDataCache = null;
    _partsDataCacheTime = 0;
}

// ── P4.22: 审计日志 ──
const _auditStmt = db.prepare('INSERT INTO audit_log (action, table_name, record_id, old_value, new_value, user, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
function writeAuditLog(action, tableName, recordId, oldValue, newValue, user = 'system') {
    _auditStmt.run(action, tableName, recordId, oldValue, newValue, user, new Date().toISOString());
}

// ── P4.20: 数据库自动备份 ──
const fsDb = require('fs');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const MAX_BACKUPS = 7;

function nextBjtTime(hour, minute = 0) {
    const now = new Date();
    const utcMs = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        hour - 8,
        minute,
        0,
        0
    );
    let target = new Date(utcMs);
    if (target <= now) target = new Date(target.getTime() + 24 * 3600 * 1000);
    return target;
}

function runBackup() {
    try {
        if (!fsDb.existsSync(BACKUP_DIR)) fsDb.mkdirSync(BACKUP_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupPath = path.join(BACKUP_DIR, `pump_${stamp}.db`);
        // P0-3: 使用 better-sqlite3 backup() API 替代字符串拼接的 VACUUM INTO
        db.backup(backupPath)
            .then(() => {
                backupLogger.info(`数据库已备份到 ${backupPath}`);
                const auditRetention = pruneAuditLog(db);
                if (auditRetention.deletedCount > 0) {
                    backupLogger.info(
                        `已清理 ${auditRetention.deletedCount} 条超过 ${auditRetention.retentionDays} 天的审计日志`
                    );
                }
                // 清理旧备份，只保留最近 MAX_BACKUPS 个
                const files = fsDb.readdirSync(BACKUP_DIR)
                    .filter(f => f.startsWith('pump_') && f.endsWith('.db'))
                    .sort().reverse();
                for (const old of files.slice(MAX_BACKUPS)) {
                    fsDb.unlinkSync(path.join(BACKUP_DIR, old));
                    backupLogger.info(`已清理旧备份: ${old}`);
                }
            })
            .catch(err => backupLogger.error(`失败: ${err.message}`));
    } catch (err) { backupLogger.error(`失败: ${err.message}`); }
}

function scheduleBackup() {
    // 每天凌晨 3:00 北京时间备份
    const now = new Date();
    const target = nextBjtTime(3);
    const delay = target.getTime() - now.getTime();
    backupLogger.info(`下次备份: ${target.toISOString()} (${(delay / 3600000).toFixed(1)}h 后)`);
    setTimeout(() => {
        runBackup();
        scheduleBackup();
    }, delay);
}
// 启动时立即备份一次，然后开始定时
runBackup();
scheduleBackup();

module.exports = {
    db,
    partRow, recipeRow, templateRow, modelVariantRow, orderRow, coilRow, statorVariantRow, customerRow, quotationRow, knowledgeEntryRow, aiConversationRow, aiConversationMessageRow, aiAnswerFeedbackRow, aiEvaluationCaseRow, aiEvaluationRunRow, aiEvaluationResultRow, recipeTechnicalFileRow, recipeAnalysisFeedbackRow, factoryRuleCandidateRow,
    dbGetAllParts, dbGetAllRecipes, dbGetAllOrders, dbGetAllCoils, dbGetAllStatorVariants, dbGetAllTemplates, dbGetAllModelVariants, dbGetAllCustomers, dbGetAllQuotations, dbGetAllRecipeTechnicalFiles, dbGetRecipeAnalysisFeedback, dbGetFactoryRuleCandidates,
    extractPartFields, loadPartsData, calculateRecipeCost,
    getSetting, setSetting, getConfig, setConfig,
    updateOrderFields, invalidatePartsCache, safeInsert, safeUpdate, softDelete, hardDelete,
    nextBjtTime,
};
