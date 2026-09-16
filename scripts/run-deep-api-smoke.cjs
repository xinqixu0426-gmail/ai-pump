const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const XLSX = require('@e965/xlsx');
const { Client: LegacyMcpClient } = require('@modelcontextprotocol/sdk/client/index.js');
const {
    StreamableHTTPClientTransport: LegacyMcpTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {
    Client: ModernMcpClient,
    StreamableHTTPClientTransport: ModernMcpTransport,
} = require('@modelcontextprotocol/client');
const {
    createCanvas,
    loadImage,
    PDFDocument,
} = require('@napi-rs/canvas');
const { buildPdfBuffer } = require('../tests/helpers/pdfFixture.cjs');
const { MCP_READ_ONLY_TOOL_NAMES } = require('../api/mcp/catalog.cjs');
const { auditCatalogReferences } = require('../api/services/catalogReferenceAudit.cjs');
const { readCatalogSource } = require('../api/services/catalogSources.cjs');

require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const root = process.cwd();
const sourceDatabasePath = path.resolve(
    process.env.DEEP_API_SOURCE_DATABASE_PATH || path.join(root, 'pump.db')
);
const MCP_EXPECTED_TOOL_NAMES = MCP_READ_ONLY_TOOL_NAMES;
const results = [];
let child = null;
let cookie = '';
let baseUrl = '';
let mcpExpectedCoilProfile = null;
let startupCopperFinished = false;
const MCP_TEST_TOKEN = 'deep-generic-mcp-token-0123456789abcdef';
const MCP_WRITE_TEST_TOKEN = 'deep-write-mcp-token-0123456789abcdef';
const DEEP_API_INTERNAL_SECRET = 'deep-api-internal-secret-0123456789abcdef';
const DEEP_API_ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'deep-api-access-password';
const MCP_COIL_PROFILE_FIXTURE = Object.freeze({
    spec: '99887',
    sheets: 321,
    diameterMm: 99887,
    commonName: 'MCP绕组验收',
    material: '冷轧',
    slotType: '国标眼',
    schemeName: 'MCP完整档案方案',
    schemeStatus: 'official',
    unitPrice: 0.456,
    wireWeight: 1.234,
    copperBase: 87.65,
    coilFee: 12.34,
    rotorFee: 5.67,
    cost: 166.51376,
    stock: 7,
    defaultWireGauge: 'MCP-2.5',
    defaultCapacitor: 'MCP-45',
    mainWireGauge: 'MCP-0.71*2',
    mainWireData: 'MCP-31-32-33-34',
    auxWireGauge: 'MCP-0.52',
    auxWireData: 'MCP-61-62',
});

function readScope(args) {
    const scopeArg = args.find(arg => arg.startsWith('--scope='));
    const scope = String(scopeArg?.slice('--scope='.length) || 'all').trim().toLowerCase();
    if (!['all', 'mcp', 'catalog'].includes(scope)) {
        throw new Error(`未知深度验收范围: ${scope || '(empty)'}`);
    }
    return scope;
}

const DEEP_API_SCOPE = readScope(process.argv.slice(2));

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function seedMcpCoilProfileFixture(databasePath) {
    const db = new Database(databasePath);
    try {
        const now = new Date().toISOString();
        const fixture = MCP_COIL_PROFILE_FIXTURE;
        const variantId = Number(db.prepare(`
            INSERT INTO stator_variants (
                diameter_mm, common_name, material, slot_type, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            fixture.diameterMm,
            fixture.commonName,
            fixture.material,
            fixture.slotType,
            now,
            now
        ).lastInsertRowid);
        db.prepare(`
            INSERT INTO coils (
                stator_variant_id, spec, material, slot_type, sheets,
                scheme_name, scheme_status, unit_price, wire_weight, copper_base,
                coil_fee, rotor_fee, cost, stock, default_wire_gauge,
                default_capacitor, main_wire_gauge, main_wire_data,
                aux_wire_gauge, aux_wire_data, created_at, updated_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
        `).run(
            variantId,
            fixture.spec,
            fixture.material,
            fixture.slotType,
            fixture.sheets,
            fixture.schemeName,
            fixture.schemeStatus,
            fixture.unitPrice,
            fixture.wireWeight,
            fixture.copperBase,
            fixture.coilFee,
            fixture.rotorFee,
            fixture.cost,
            fixture.stock,
            fixture.defaultWireGauge,
            fixture.defaultCapacitor,
            fixture.mainWireGauge,
            fixture.mainWireData,
            fixture.auxWireGauge,
            fixture.auxWireData,
            now,
            now
        );
    } finally {
        db.close();
    }
}

function seedMcpReadResourceFixtures(databasePath) {
    const db = new Database(databasePath);
    try {
        const now = new Date().toISOString();
        db.transaction(() => {
            db.prepare(`
                INSERT INTO parts (
                    model, category, subcategory, price, supplier, stock,
                    remark, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                'MCP-BOM-SNAPSHOT',
                'MCP验收',
                '只读夹具',
                99.8,
                'MCP',
                10,
                'MCP 零件完整字段',
                now,
                now
            );
            const templateId = Number(db.prepare(`
                INSERT INTO pump_shell_templates (
                    shell_model, description, parts_json, rotor_params_json,
                    assembly_wage, packing_wage, painting_wage,
                    surface_treatment_mode, surface_treatment_cost,
                    cost_mode, bundle_cost, bundle_note, shell_components_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                'MCP-READ-TEMPLATE',
                'MCP 完整模板只读验收',
                '[]',
                JSON.stringify({ bearing: '6202', shaftDiameter: 12 }),
                6,
                3,
                2,
                'painting',
                2,
                'bundle',
                99.8,
                'MCP 整体价',
                '[]',
                now,
                now
            ).lastInsertRowid);
            const insertRecipe = db.prepare(`
                INSERT INTO recipes (
                    name, spec, parts_json, saved_total_cost, saved_cost_details,
                    template_id, coil_spec, coil_sheets, coil_material, coil_slot_type,
                    assembly_wage, packing_wage, painting_wage,
                    surface_treatment_mode, surface_treatment_cost,
                    management_fee, technical_data_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
            `);
            const recipePartsJson = JSON.stringify([{
                name: '线圈转子',
                model: 'MCP完整档案线圈',
                category: '线圈',
                qty: 1,
                snapshotPrice: 99.8,
            }]);
            insertRecipe.run(
                'MCP-READ-RECIPE-A', 'MCP-A', recipePartsJson, 99.8, templateId,
                MCP_COIL_PROFILE_FIXTURE.spec, MCP_COIL_PROFILE_FIXTURE.sheets,
                MCP_COIL_PROFILE_FIXTURE.material, MCP_COIL_PROFILE_FIXTURE.slotType,
                6, 3, 2, 'painting', 2, 0, now, now
            );
            insertRecipe.run(
                'MCP-READ-RECIPE-B', 'MCP-B', recipePartsJson, 101.8, templateId,
                MCP_COIL_PROFILE_FIXTURE.spec, MCP_COIL_PROFILE_FIXTURE.sheets,
                MCP_COIL_PROFILE_FIXTURE.material, MCP_COIL_PROFILE_FIXTURE.slotType,
                6, 3, 2, 'painting', 2, 0, now, now
            );
            const customerId = Number(db.prepare(`
                INSERT INTO customers (
                    name, contact_info, default_margin, remark, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                'MCP 只读验收客户',
                'mcp@example.invalid',
                0.1,
                'MCP 客户完整字段',
                now,
                now
            ).lastInsertRowid);
            db.prepare(`
                INSERT INTO quotations (
                    customer_id, status, items_json, total_cost, total_price,
                    remark, created_at, updated_at
                ) VALUES (?, '报价中', ?, ?, ?, ?, ?, ?)
            `).run(
                customerId,
                JSON.stringify([{
                    recipeName: 'MCP-READ-RECIPE-A',
                    qty: 2,
                    unitCost: 99.8,
                    unitPrice: 120,
                    configurationSnapshot: { cableLength: 10 },
                }]),
                199.6,
                240,
                'MCP 报价完整字段',
                now,
                now
            );
        })();
    } finally {
        db.close();
    }
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

async function waitForHealth() {
    for (let index = 0; index < 80; index += 1) {
        try {
            const response = await fetch(`${baseUrl}/api/health`, {
                signal: AbortSignal.timeout(1000),
            });
            if (response.ok) return;
        } catch {
            // The isolated API may still be starting.
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('隔离 API 启动超时');
}

async function request(label, method, pathname, body, expectedStatuses = [200]) {
    const startedAt = Date.now();
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
        response = await fetch(`${baseUrl}${pathname}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
        });
    } catch (error) {
        throw new Error(
            `${label} ${method} ${pathname} 请求失败: ${error.message}`,
            { cause: error }
        );
    }
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!expectedStatuses.includes(response.status)) {
        throw new Error(
            `${label} ${method} ${pathname} -> ${response.status}: ${text.slice(0, 300)}`
        );
    }
    results.push({ label, status: response.status, ms: Date.now() - startedAt });
    return { response, payload };
}

async function waitForMcpCoilProfileStable() {
    // Equal reads before the asynchronous startup fetch finishes do not prove
    // stability. Wait for its terminal event before freezing the formal oracle.
    const deadline = Date.now() + 60000;
    while (!startupCopperFinished && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(startupCopperFinished, '启动铜价同步未结束，不能冻结 MCP 对照档案');
    const pathname = `/api/coils?spec=${encodeURIComponent(MCP_COIL_PROFILE_FIXTURE.spec)}&sheets=${MCP_COIL_PROFILE_FIXTURE.sheets}`;
    let previousFingerprint = '';
    let stableReads = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const profiles = (await request(
            `等待 MCP 线圈正式档案稳定 ${attempt + 1}`,
            'GET',
            pathname
        )).payload.data;
        assert(profiles.length === 1, '正式 API 未唯一返回 MCP 线圈档案夹具');
        const [profile] = profiles;
        const fingerprint = JSON.stringify({
            copperBase: profile.copperBase,
            cost: profile.cost,
            updatedAt: profile.updatedAt,
        });
        stableReads = fingerprint === previousFingerprint ? stableReads + 1 : 1;
        previousFingerprint = fingerprint;
        if (stableReads >= 3) return profile;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('启动铜价同步后 MCP 线圈档案未能稳定');
}

async function syncKnowledge(label) {
    const preview = (await request(
        `${label}预览`,
        'POST',
        '/api/knowledge/sync-preview',
        {}
    )).payload.data;
    return request(label, 'POST', '/api/knowledge/sync', {
        confirmationToken: preview.confirmationToken,
        idempotencyKey: preview.suggestedIdempotencyKey,
    });
}

async function archiveFactoryFile(label, fileId, input, expectedStatuses = [201]) {
    const preview = (await request(
        `${label}预览`,
        'POST',
        `/api/files/${fileId}/archive-preview`,
        input
    )).payload.data;
    return request(
        label,
        'POST',
        `/api/files/${fileId}/archive`,
        {
            confirmationToken: preview.confirmationToken,
            idempotencyKey: preview.suggestedIdempotencyKey,
        },
        expectedStatuses
    );
}

async function deleteFactoryFileLink(label, fileId, link, expectedStatuses = [200]) {
    return request(
        label,
        'DELETE',
        `/api/files/${fileId}/links/${link.id}`,
        {
            expectedUpdatedAt: link.updatedAt,
            idempotencyKey: `deep:file-link-delete:${fileId}:${link.id}`,
        },
        expectedStatuses
    );
}

async function requestForm(label, pathname, form, expectedStatuses = [200]) {
    const startedAt = Date.now();
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers,
        body: form,
        signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!expectedStatuses.includes(response.status)) {
        throw new Error(`${label} POST ${pathname} -> ${response.status}: ${text.slice(0, 300)}`);
    }
    results.push({ label, status: response.status, ms: Date.now() - startedAt });
    return { response, payload };
}

async function requestDownload(label, pathname) {
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}${pathname}`, {
        headers: cookie ? { Cookie: cookie } : {},
        signal: AbortSignal.timeout(20000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
        throw new Error(`${label} GET ${pathname} -> ${response.status}: ${bytes.toString('utf8').slice(0, 300)}`);
    }
    results.push({ label, status: response.status, ms: Date.now() - startedAt });
    return bytes;
}

async function callVerifiedMcpTool(client, clientLabel, name, args, options = {}) {
    const startedAt = Date.now();
    let result;
    try {
        result = await client.callTool({ name, arguments: args });
    } catch (error) {
        throw new Error(
            `${clientLabel} / ${name} MCP 调用失败: ${error.message}`,
            { cause: error }
        );
    }
    const structured = result.structuredContent;
    assert(
        structured?.mcp?.capabilityId,
        `${clientLabel} / ${name} 缺少 capabilityId: ${JSON.stringify(result).slice(0, 500)}`
    );
    assert(structured?.mcp?.verified === true, `${clientLabel} / ${name} 缺少正式 API 证据`);

    if (result.isError === true) {
        const allowedErrorCodes = options.allowedErrorCodes || [];
        assert(
            allowedErrorCodes.includes(structured?.code),
            `${clientLabel} / ${name} 意外失败: ${JSON.stringify(result).slice(0, 500)}`
        );
    } else {
        assert(structured?.success === true, `${clientLabel} / ${name} 未返回 success=true`);
    }

    results.push({
        label: `${clientLabel} / ${name}`,
        status: 200,
        ms: Date.now() - startedAt,
    });
    return result;
}

function mcpDataArray(result) {
    return Array.isArray(result?.structuredContent?.data)
        ? result.structuredContent.data
        : [];
}

function mcpData(result) {
    return result?.structuredContent?.data;
}

async function verifyMcpReadOnlyFlow(client, transport, label, expectedProtocolVersion) {
    const startedAt = Date.now();
    try {
        await client.connect(transport);
        if (expectedProtocolVersion) {
            assert(
                client.getNegotiatedProtocolVersion() === expectedProtocolVersion,
                `通用 MCP 未协商到 ${expectedProtocolVersion}`
            );
        }
        const listed = await client.listTools();
        const listedNames = listed.tools.map(tool => tool.name);
        assert(
            listedNames.length === MCP_EXPECTED_TOOL_NAMES.length,
            `通用 MCP 未返回 ${MCP_EXPECTED_TOOL_NAMES.length} 个只读工具`
        );
        assert(
            MCP_EXPECTED_TOOL_NAMES.every(name => listedNames.includes(name)),
            `通用 MCP 工具目录不完整: ${listedNames.join(', ')}`
        );
        assert(
            listed.tools.every(tool => tool.annotations?.readOnlyHint === true),
            '通用 MCP 暴露了非只读工具'
        );
        assert(
            !listed.tools.some(tool => tool.name === 'create_part'),
            '通用 MCP 暴露了写工具 create_part'
        );

        const calledNames = new Set();
        const call = async (name, args = {}, callOptions = {}) => {
            const result = await callVerifiedMcpTool(
                client,
                label,
                name,
                args,
                callOptions
            );
            calledNames.add(name);
            return result;
        };
        const notFound = { allowedErrorCodes: ['AI_RESOURCE_NOT_FOUND'] };

        const templatesResult = await call('search_templates', {
            shellModel: 'MCP-READ-TEMPLATE',
            limit: 3,
        });
        const template = mcpDataArray(templatesResult)[0] || null;
        const templateDetailResult = await call(
            'get_template_detail',
            template ? { templateId: Number(template.id) } : { shellModel: 'MCP-NOT-FOUND' },
            template ? {} : notFound
        );
        if (template) {
            const templateDetail = templateDetailResult.structuredContent?.template;
            assert(templateDetail?.id === template.id, 'get_template_detail 未返回选中的完整模板');
            for (const field of [
                'partsJson', 'shellComponentsJson', 'rotorParamsJson',
                'assemblyWage', 'packingWage', 'paintingWage', 'bundleCost',
            ]) {
                assert(
                    Object.hasOwn(templateDetail, field),
                    `get_template_detail 缺少模板正式字段 ${field}`
                );
            }
            assert(templateDetail.shellModel === 'MCP-READ-TEMPLATE', 'get_template_detail 未命中唯一模板夹具');
            assert(templateDetail.assemblyWage === 6, 'get_template_detail 未保留模板装配工资');
            assert(templateDetail.bundleCost === 99.8, 'get_template_detail 未保留模板套件成本');
            assert(templateDetail.rotorParams?.bearing === '6202', 'get_template_detail 未保留模板转子参数');
        }
        const customersResult = await call('search_customers', { limit: 3 });
        const customer = mcpDataArray(customersResult)[0] || null;
        const quotationsResult = await call('search_quotations', {
            customerName: 'MCP 只读验收客户',
            limit: 3,
        });
        const quotation = mcpDataArray(quotationsResult)[0] || null;
        const quotationDetailResult = await call(
            'get_quotation_detail',
            { quotationId: Number(quotation?.id || 999999999) },
            quotation ? {} : notFound
        );
        if (quotation) {
            const quotationDetail = quotationDetailResult.structuredContent?.quotation;
            assert(quotationDetail?.id === quotation.id, 'get_quotation_detail 未返回选中的完整报价');
            for (const field of [
                'itemsJson', 'remark', 'convertedOrderId', 'convertedAt', 'updatedAt',
            ]) {
                assert(
                    Object.hasOwn(quotationDetail, field),
                    `get_quotation_detail 缺少报价正式字段 ${field}`
                );
            }
            assert(quotationDetail.customerName === 'MCP 只读验收客户', 'get_quotation_detail 未命中唯一报价夹具');
            assert(quotationDetail.remark === 'MCP 报价完整字段', 'get_quotation_detail 未保留报价备注');
            assert(quotationDetail.items?.[0]?.configurationSnapshot?.cableLength === 10, 'get_quotation_detail 未保留完整报价明细');
        }
        await call('get_copper_price');
        await call('get_coil_specs');
        await call('search_parts', { limit: 3 });
        const coilsResult = await call('search_coils', {
            spec: MCP_COIL_PROFILE_FIXTURE.spec,
            sheets: MCP_COIL_PROFILE_FIXTURE.sheets,
        });
        const profileCoil = mcpDataArray(coilsResult)[0] || null;
        assert(profileCoil, 'search_coils 未返回精确 MCP 线圈档案夹具');
        assert(mcpExpectedCoilProfile, 'search_coils 缺少正式 API 对照档案');
        for (const field of [
            'id', 'statorVariantId', 'spec', 'sheets', 'diameterMm', 'commonName',
            'material', 'slotType', 'schemeName', 'schemeStatus', 'unitPrice',
            'wireWeight', 'copperBase', 'coilFee', 'rotorFee', 'cost', 'stock',
            'defaultWireGauge',
            'defaultCapacitor', 'mainWireGauge', 'mainWireData', 'auxWireGauge',
            'auxWireData', 'createdAt', 'updatedAt',
        ]) {
            assert(
                profileCoil[field] === mcpExpectedCoilProfile[field],
                `search_coils 线圈档案字段 ${field} 与正式 API 当前值不一致`
            );
        }
        for (const field of [
            'mainWireGauge', 'mainWireData', 'auxWireGauge', 'auxWireData',
        ]) {
            assert(
                profileCoil[field] === MCP_COIL_PROFILE_FIXTURE[field],
                `search_coils 绕组字段 ${field} 未保留测试夹具已保存值`
            );
        }
        assert(!Object.hasOwn(profileCoil, 'Id'), 'search_coils 泄漏兼容字段 Id');
        assert(!Object.hasOwn(profileCoil, 'CreatedAt'), 'search_coils 泄漏兼容字段 CreatedAt');
        assert(!Object.hasOwn(profileCoil, 'UpdatedAt'), 'search_coils 泄漏兼容字段 UpdatedAt');
        assert(
            coilsResult.structuredContent?.mcp?.sourceOfTruth === 'coilService',
            'search_coils MCP 能力来源未声明 coilService'
        );
        assert(
            coilsResult.structuredContent?.sources?.some(source => source.sourceTable === 'coils'),
            'search_coils MCP 结果缺少 coils 可追溯来源'
        );
        const allCoilsResult = await call('search_coils');
        const coil = mcpDataArray(allCoilsResult).find(item => item.schemeStatus === 'official') || null;

        const recipesResult = await call('get_all_recipes');
        const recipes = mcpDataArray(recipesResult);
        const recipe = recipes[0] || null;
        const recipeId = Number(mcpDataArray(recipesResult)[0]?.id || 999999999);
        const recipeErrorOptions = recipeId === 999999999
            ? notFound
            : {};
        const fullEstimateErrorOptions = recipeId === 999999999
            ? { allowedErrorCodes: ['AI_RESOURCE_NOT_FOUND', 'FULL_ESTIMATE_RECIPE_NOT_FOUND'] }
            : {};
        const recipeDetailResult = await call(
            'get_recipe_detail',
            { recipeId },
            recipeErrorOptions
        );
        await call(
            'get_recipe_technical_files',
            { recipeId },
            recipeErrorOptions
        );
        await call(
            'preview_recipe_cost',
            { recipeId },
            recipeErrorOptions
        );

        const shellModel = template?.shellModel || template?.description || 'MCP-NOT-FOUND';
        const templateArgs = template
            ? { templateId: Number(template.id), customBarrelLength: 180 }
            : { shellModel, customBarrelLength: 180 };
        const templateErrorOptions = template ? {} : notFound;
        const coilArgs = coil
            ? {
                spec: coil.spec,
                sheets: Number(coil.sheets),
                material: coil.material,
                slotType: coil.slotType,
            }
            : { spec: 'MCP-NOT-FOUND', sheets: 1, material: '钢带', slotType: '小眼' };
        await call('calculate_coil_cost', coilArgs, coil ? {} : notFound);
        const fullEstimateResult = await call('full_calculate', {
            ...(recipe ? { recipeId: Number(recipe.id) } : { recipeName: 'MCP-NOT-FOUND' }),
            ...(coil ? { stator: `${coil.spec}-${coil.sheets}` } : {}),
            hasFloat: false,
            cableLength: 0,
        }, fullEstimateErrorOptions);
        if (recipe) {
            const fullEstimate = mcpData(fullEstimateResult);
            assert(fullEstimate?.recipeCost?.recipeId === Number(recipe.id), '完整估算未绑定请求的正式配方');
            assert(!fullEstimate?.recipeCost?.error, '完整估算把配方错误静默嵌入成功响应');
        }
        await call('full_calculate', {
            pumphousing_model: 'MCP-PUMP-SHELL-TEMPLATE-NOT-RECIPE',
        }, { allowedErrorCodes: ['FULL_ESTIMATE_RECIPE_NOT_FOUND'] });
        await call('dynamic_config_cost', {
            ...(coil ? { stator: `${coil.spec}-${coil.sheets}` } : {}),
            hasFloat: false,
            cableLength: 0,
        });
        await call('build_recipe_bom_draft', {
            ...(template ? { templateId: Number(template.id) } : {}),
            ...(coil ? {
                coilSpec: coil.spec,
                coilSheets: Number(coil.sheets),
                coilMaterial: coil.material,
                coilSlotType: coil.slotType,
            } : {}),
        });
        await call('preview_pump_shell_cost', templateArgs, templateErrorOptions);

        const comparisonRecipe = recipes[1] || recipe;
        const comparisonArgs = recipe && comparisonRecipe
            ? { recipe1: recipe.name, recipe2: comparisonRecipe.name }
            : { recipe1: 'MCP-NOT-FOUND-A', recipe2: 'MCP-NOT-FOUND-B' };
        const comparisonErrorOptions = recipe && comparisonRecipe
            ? {}
            : { allowedErrorCodes: ['AI_RESOURCE_NOT_FOUND', 'RECIPE_SELECTOR_NOT_FOUND'] };
        const compared = await call('compare_recipes', comparisonArgs, comparisonErrorOptions);
        if (recipe && comparisonRecipe) {
            assert(
                compared.structuredContent?.costBasis === 'currentFullCost',
                '配方对比未使用完整当前成本口径'
            );
        }
        const explained = await call('explain_cost_change', recipe && comparisonRecipe
            ? { leftRecipeId: Number(recipe.id), rightRecipeId: Number(comparisonRecipe.id) }
            : { leftRecipeId: 999999998, rightRecipeId: 999999999 }, comparisonErrorOptions);
        if (recipe && comparisonRecipe) {
            assert(
                mcpData(explained)?.costBasis === 'currentFullCost',
                '成本差异解释未使用完整当前成本口径'
            );
        }
        await call('analyze_recipe_configuration', { recipeId }, recipeErrorOptions);

        await call('inspect_quotation_file', { fileId: 999999999 }, notFound);
        await call('build_quotation_draft', {
            ...(customer ? { customerId: Number(customer.id) } : { customerName: 'MCP-NOT-FOUND' }),
            items: [{
                ...(recipe ? { recipeId: Number(recipe.id) } : { recipeName: 'MCP-NOT-FOUND' }),
                qty: 1,
                margin: 1.1,
            }],
        }, customer && recipe ? {} : notFound);
        await call('build_order_draft', {
            customerName: customer?.name || 'MCP 本地验收客户',
            items: [{
                ...(recipe ? { recipeId: Number(recipe.id), recipeName: recipe.name } : {}),
                spec: recipe?.spec || 'MCP-SMOKE',
                qty: 1,
                unitCost: Number(
                    mcpData(recipeDetailResult)?.currentCost?.unitCost
                    || recipe?.savedTotalCost
                    || 1
                ),
                unitPrice: Number(
                    mcpData(recipeDetailResult)?.currentCost?.unitCost
                    || recipe?.savedTotalCost
                    || 1
                ) * 1.1,
                partsJson: recipe?.partsJson || '[]',
            }],
        });
        await call('search_customer_history', customer
            ? { customerId: Number(customer.id), limit: 3 }
            : { customerName: 'MCP-NOT-FOUND', limit: 3 }, customer ? {} : notFound);

        const ordersResult = await call(
            'get_recent_orders',
            { limit: 3 }
        );
        const orderId = Number(mcpDataArray(ordersResult)[0]?.id || 999999999);
        const orderErrorOptions = orderId === 999999999
            ? notFound
            : {};
        await call(
            'get_order_detail',
            { orderId },
            orderErrorOptions
        );
        await call(
            'get_order_knowledge_package',
            { orderId },
            orderErrorOptions
        );
        await call(
            'check_order_readiness',
            { orderId },
            orderErrorOptions
        );
        await call('plan_order_readiness_actions', { orderId }, orderErrorOptions);
        await call('get_purchase_overview', { limit: 3 });
        await call('get_order_readiness_overview');
        await call('get_dashboard_summary');
        await call('get_business_alerts');
        await call('get_management_action_center');
        await call('plan_factory_workflow', {
            workflowType: 'order_readiness',
            orderId,
        }, orderErrorOptions);

        await call('get_data_quality_summary');
        await call('get_factory_learning_health', { limit: 3 });
        const ruleCandidatesResult = await call('get_factory_rule_candidates');
        const ruleCandidates = mcpDataArray(ruleCandidatesResult);
        const candidateId = Number(ruleCandidates[0]?.id || 999999999);
        await call('get_factory_rule_impact', { candidateId }, candidateId === 999999999
            ? notFound
            : {});
        await call('get_factory_rule_compliance');
        await call('get_factory_rule_history', { limit: 3 });

        await call('search_factory_file_archive_targets', {
            targetType: 'recipe',
            query: recipe?.name || '',
            limit: 3,
        });
        const knowledgeResult = await call(
            'search_factory_knowledge',
            { query: '本地 MCP 验收', limit: 3 }
        );
        const knowledgeId = Number(mcpDataArray(knowledgeResult)[0]?.id || 999999999);
        await call('get_factory_knowledge_detail', { id: knowledgeId }, knowledgeId === 999999999
            ? notFound
            : {});
        await call('get_factory_knowledge_health');
        await call('get_rotor_drawing_history', { limit: 3 });
        await call('search_business_changes', { period: 'all', limit: 3 });

        assert(
            calledNames.size === MCP_EXPECTED_TOOL_NAMES.length
                && MCP_EXPECTED_TOOL_NAMES.every(name => calledNames.has(name)),
            `${label} 未真实调用完整 MCP 目录: ${[...calledNames].join(', ')}`
        );

        for (const name of ['get_order_detail', 'check_order_readiness']) {
            await callVerifiedMcpTool(
                client,
                `${label} 已核验负结果`,
                name,
                { orderId: 999999999 },
                { allowedErrorCodes: ['AI_RESOURCE_NOT_FOUND'] }
            );
        }
        results.push({
            label,
            status: 200,
            ms: Date.now() - startedAt,
        });
    } finally {
        await client.close();
    }
}

async function testMcpReadOnlyFlows() {
    const url = new URL(`${baseUrl}/mcp`);
    const requestInit = { headers: { Authorization: `Bearer ${MCP_TEST_TOKEN}` } };
    const unauthorizedMalformed = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
    });
    assert(unauthorizedMalformed.status === 401, 'MCP 畸形 JSON 在鉴权前被解析');

    const malformed = await fetch(url, {
        method: 'POST',
        headers: {
            ...requestInit.headers,
            'Content-Type': 'application/json',
        },
        body: '{',
    });
    assert(malformed.status === 400, 'MCP 畸形 JSON 未返回 HTTP 400');
    const malformedPayload = await malformed.json();
    assert(malformedPayload?.jsonrpc === '2.0', 'MCP 畸形 JSON 未返回 JSON-RPC 错误');
    assert(malformedPayload?.error?.code === -32700, 'MCP 畸形 JSON 未返回 Parse error');
    assert(Boolean(malformedPayload?.error?.data?.requestId), 'MCP Parse error 缺少 requestId');
    results.push({
        label: '通用 MCP 畸形 JSON 协议错误',
        status: malformed.status,
        ms: 0,
    });

    const oversizedBody = await fetch(url, {
        method: 'POST',
        headers: {
            ...requestInit.headers,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'x'.repeat(262_144) }),
    });
    assert(oversizedBody.status === 413, 'MCP 超大 JSON 未返回 HTTP 413');
    const oversizedPayload = await oversizedBody.json();
    assert(oversizedPayload?.error?.code === -32600, 'MCP 超大 JSON 未返回 Invalid Request');
    assert(
        oversizedPayload?.error?.data?.maxRequestBytes === 262_144,
        'MCP 超大 JSON 未返回请求上限'
    );
    results.push({
        label: '通用 MCP 请求体上限',
        status: oversizedBody.status,
        ms: 0,
    });

    await verifyMcpReadOnlyFlow(
        new LegacyMcpClient({ name: 'hermes-compatible-smoke', version: '1.0.0' }),
        new LegacyMcpTransport(url, { requestInit }),
        'Hermes 2025 MCP 真实只读调用'
    );
    await verifyMcpReadOnlyFlow(
        new ModernMcpClient(
            { name: 'generic-agent-smoke', version: '2.0.0' },
            { versionNegotiation: { mode: 'auto' } }
        ),
        new ModernMcpTransport(url, { requestInit }),
        '通用 2026 MCP 真实只读调用',
        '2026-07-28'
    );

    const writeClient = new ModernMcpClient(
        { name: 'generic-write-agent-smoke', version: '2.0.0' },
        { versionNegotiation: { mode: 'auto' } }
    );
    writeClient.registerCapabilities({ elicitation: { form: {} } });
    writeClient.setRequestHandler('elicitation/create', async elicitation => {
        assert(elicitation.params.mode === 'form', 'MCP 写确认未使用 form elicitation');
        assert(
            String(elicitation.params.message).includes('同步工厂知识库'),
            'MCP 写确认没有展示正式能力摘要'
        );
        return { action: 'accept', content: { confirm: true } };
    });
    const writeStartedAt = Date.now();
    try {
        await writeClient.connect(new ModernMcpTransport(url, {
            requestInit: {
                headers: { Authorization: `Bearer ${MCP_WRITE_TEST_TOKEN}` },
            },
        }));
        assert(
            writeClient.getNegotiatedProtocolVersion() === '2026-07-28',
            'MCP 写验收未协商到 2026-07-28'
        );
        const listed = await writeClient.listTools();
        const writeTool = listed.tools.find(tool => tool.name === 'sync_factory_knowledge');
        assert(writeTool, '具备 mcp:write 的身份看不到写工具');
        assert(writeTool.annotations?.readOnlyHint === false, '写工具 readOnlyHint 错误');
        const result = await writeClient.callTool({
            name: 'sync_factory_knowledge',
            arguments: {},
        });
        assert(result.isError !== true, `MCP 正式写调用失败: ${JSON.stringify(result).slice(0, 500)}`);
        assert(result.structuredContent?.success === true, 'MCP 正式写调用未返回 success=true');
        assert(result.structuredContent?.data?.status === 'completed', 'MCP 正式写回执未完成');
        assert(result.structuredContent?.data?.operationId, 'MCP 正式写回执缺少 operationId');
        assert(result.structuredContent?.data?.auditId, 'MCP 正式写回执缺少 auditId');
        assert(result.structuredContent?.mcp?.verified === true, 'MCP 正式写回执缺少执行证据');
        results.push({
            label: '通用 2026 MCP 正式写入与人工确认',
            status: 200,
            ms: Date.now() - writeStartedAt,
        });
    } finally {
        await writeClient.close();
    }
}

function readGetPuritySnapshot(databasePath) {
    const snapshotDb = new Database(databasePath, { readonly: true });
    try {
        snapshotDb.pragma('busy_timeout = 5000');
        return {
            orders: snapshotDb.prepare(`
                SELECT id, status, purchase_list_json, updated_at
                FROM orders
                ORDER BY id
            `).all(),
            quotations: snapshotDb.prepare(`
                SELECT id, status, updated_at
                FROM quotations
                ORDER BY id
            `).all(),
        };
    } finally {
        snapshotDb.close();
    }
}

async function testCatalogReferenceBindings(databasePath) {
    const inspectDb = new Database(databasePath, { readonly: true });
    try {
        const report = auditCatalogReferences(inspectDb);
        assert(report.complete, '绑定验收盘点不完整');
        const reference = report.references.find(ref => ref.sourceType === 'recipe' && ref.targetType === 'part'
            && ['resolved_id', 'resolved_legacy'].includes(ref.status) && ref.candidateIds.length === 1);
        assert(reference, '缺少可核实的历史配方引用');
        const sourceInput = { sourceType: reference.sourceType, sourceId: reference.sourceId };
        const sourceBefore = readCatalogSource(inspectDb, reference.sourceType, reference.sourceId);
        const targetBefore = readCatalogSource(inspectDb, 'part', reference.candidateIds[0]);
        const preview = (await request('历史引用绑定预览', 'POST', '/api/catalog/reference-bindings-preview', {
            bindings: [{ ...sourceInput, path: reference.path, sourceHash: reference.sourceHash,
                targetType: 'part', targetId: reference.candidateIds[0] }],
        })).payload.data;
        await request('绑定拒绝隐式幂等键', 'POST', '/api/catalog/reference-bindings', {
            confirmationToken: preview.confirmationToken,
        }, [400]);
        const body = { confirmationToken: preview.confirmationToken, idempotencyKey: preview.suggestedIdempotencyKey };
        const receipt = (await request('历史引用绑定正式保存', 'POST', '/api/catalog/reference-bindings', body)).payload.data;
        assert(receipt.bindingIds.length === 1 && receipt.auditIds.length >= 1, '缺少绑定或强审计');
        const replay = (await request('历史引用绑定幂等重放', 'POST', '/api/catalog/reference-bindings', body)).payload.data;
        assert(replay.idempotentReplay && replay.bindingIds[0] === receipt.bindingIds[0], '重复提交未返回原回执');
        const names = (await request('历史引用读取现名', 'POST', '/api/catalog/bound-names', sourceInput)).payload.data;
        const name = names.items.find(item => item.bindingId === receipt.bindingIds[0]);
        assert(name?.currentName === targetBefore.model && name.displayOnly, '绑定未投影正式现名');
        assert(JSON.stringify(readCatalogSource(inspectDb, reference.sourceType, reference.sourceId)) === JSON.stringify(sourceBefore), '绑定改写了配方快照');
        assert(JSON.stringify(readCatalogSource(inspectDb, 'part', reference.candidateIds[0])) === JSON.stringify(targetBefore), '绑定修改了物料事实');
        await request('绑定读取拒绝超限分页', 'POST', '/api/catalog/bound-names', { ...sourceInput, limit: 101 }, [400]);
    } finally { inspectDb.close(); }
}

async function testCoreGetEndpointsDoNotWrite(databasePath) {
    const before = readGetPuritySnapshot(databasePath);
    const orders = (await request('GET纯度-订单列表', 'GET', '/api/orders')).payload.data;
    const orderId = orders[0]?.id;
    if (orderId) await request('GET纯度-订单详情', 'GET', `/api/orders/${orderId}`);
    await request('GET纯度-报价列表', 'GET', '/api/quotations');
    const activeQuotations = (await request(
        '报价正式状态筛选',
        'GET',
        `/api/quotations?status=${encodeURIComponent('报价中')}&limit=100`
    )).payload.data;
    assert(
        activeQuotations.every(quotation => quotation.status === '报价中'),
        '报价状态筛选返回了非报价中记录'
    );
    await request(
        '报价非法状态筛选拒绝',
        'GET',
        `/api/quotations?status=${encodeURIComponent('采购中')}`,
        undefined,
        [400]
    );
    const parts = (await request('零件正式全量查询', 'GET', '/api/parts')).payload.data;
    const namingRules = (await request('服务端命名规则查询', 'GET', '/api/catalog/naming-rules')).payload.data;
    assert(namingRules.rules.some(rule => rule.id === 'bearing'), '缺少轴承命名规则');
    const namingPreview = (await request('服务端规格直读名称预览', 'POST', '/api/catalog/name-preview', {
        ruleId: 'bearing', spec: { code: '202' },
    })).payload.data;
    assert(namingPreview.name === '轴承-202' && namingPreview.preview === true, '名称预览结果不正确');
    await request('命名不能猜测线径单位', 'POST', '/api/catalog/name-preview', {
        ruleId: 'cable', spec: { wireValue: 0.55 },
    }, [400]);
    if (parts[0]) {
        const currentNames = (await request('目录 ID 批量现名读取', 'POST', '/api/catalog/references/resolve', {
            references: [{ entityType: 'part', entityId: parts[0].id, snapshotName: '历史显示名称' }],
        })).payload.data;
        assert(currentNames.items[0].currentName === parts[0].model, '没有读取所选 ID 的当前名称');
        assert(currentNames.items[0].snapshotName === '历史显示名称', '覆盖了历史显示名称');
    }
    await request('目录现名读取拒绝非法 ID', 'POST', '/api/catalog/references/resolve', {
        references: [{ entityType: 'part', entityId: -1 }],
    }, [400]);
    if (parts[0]?.category) {
        const filteredParts = (await request(
            '零件正式类别和数量筛选',
            'GET',
            `/api/parts?category=${encodeURIComponent(parts[0].category)}&limit=1`
        )).payload.data;
        assert(filteredParts.length <= 1, '零件 limit 未生效');
        assert(filteredParts.every(part => part.category.includes(parts[0].category)), '零件类别筛选未生效');
    }
    const customers = (await request('客户正式全量查询', 'GET', '/api/customers')).payload.data;
    if (customers[0]?.name) {
        const filteredCustomers = (await request(
            '客户正式名称筛选',
            'GET',
            `/api/customers?name=${encodeURIComponent(customers[0].name)}`
        )).payload.data;
        assert(filteredCustomers.some(customer => customer.id === customers[0].id), '客户名称筛选未命中');
    }
    const templates = (await request('模板正式全量查询', 'GET', '/api/templates')).payload.data;
    if (templates[0]?.shellModel) {
        const filteredTemplates = (await request(
            '模板正式型号筛选',
            'GET',
            `/api/templates?shellModel=${encodeURIComponent(templates[0].shellModel)}`
        )).payload.data;
        assert(filteredTemplates.every(template => template.shellModel.includes(templates[0].shellModel)), '模板型号筛选未生效');
    }
    if (orders[0]?.status) {
        const filteredOrders = (await request(
            '订单正式状态筛选',
            'GET',
            `/api/orders?status=${encodeURIComponent(orders[0].status)}`
        )).payload.data;
        assert(filteredOrders.every(order => order.status === orders[0].status), '订单状态筛选未生效');
    }
    await request(
        '订单非法状态筛选拒绝',
        'GET',
        `/api/orders?status=${encodeURIComponent('不存在')}`,
        undefined,
        [400]
    );
    const after = readGetPuritySnapshot(databasePath);
    assert(
        JSON.stringify(after.orders) === JSON.stringify(before.orders),
        '订单 GET 修改了 orders 表'
    );
    assert(
        JSON.stringify(after.quotations) === JSON.stringify(before.quotations),
        '报价 GET 修改了 quotations 表'
    );
    results.push({ label: '核心 GET 前后业务表不变', status: 200, ms: 0 });
}

async function waitForAutomaticKnowledgeUpdate(part, expectedPrice) {
    let lastStatus = null;
    for (let index = 0; index < 40; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 250));
        const overviewResponse = await fetch(`${baseUrl}/api/knowledge/overview`, {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(5000),
        });
        const overview = (await overviewResponse.json()).data;
        lastStatus = overview?.autoSync;
        if (
            !lastStatus?.enabled
            || lastStatus.running
            || lastStatus.pending
            || lastStatus.lastMode !== 'automatic'
            || !lastStatus.lastCompletedAt
        ) {
            continue;
        }

        const params = new URLSearchParams({
            query: part.model,
            sourceTable: 'parts',
            limit: '10',
        });
        const searchResponse = await fetch(`${baseUrl}/api/knowledge?${params}`, {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(5000),
        });
        const entries = (await searchResponse.json()).data || [];
        const entry = entries.find(item => String(item.sourceId) === String(part.id));
        if (!entry) continue;

        const detailResponse = await fetch(`${baseUrl}/api/knowledge/${entry.id}`, {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(5000),
        });
        const detail = (await detailResponse.json()).data;
        if (detail?.content?.includes(String(expectedPrice))) {
            results.push({ label: '业务变更自动刷新知识', status: 200, ms: 0 });
            return;
        }
    }
    throw new Error(`知识自动刷新超时: ${JSON.stringify(lastStatus)}`);
}

async function readCoreResources() {
    const paths = [
        ['零件列表', '/api/parts'],
        ['配方列表', '/api/recipes'],
        ['模板列表', '/api/templates'],
        ['型号配置列表', '/api/model-variants'],
        ['订单列表', '/api/orders'],
        ['线圈列表', '/api/coils'],
        ['定子组合列表', '/api/coils/variants'],
        ['线圈规格列表', '/api/coils/specs'],
        ['转子历史', '/api/rotor/history'],
        ['转子订单型号', '/api/rotor/order-pump-models'],
        ['转子关联目标', '/api/rotor/link-targets'],
        ['系统设置', '/api/settings'],
        ['系统初始化设置', '/api/settings/runtime'],
        ['客户列表', '/api/customers'],
        ['报价列表', '/api/quotations'],
        ['工作台汇总', '/api/workbench/summary'],
        ['管理待办', '/api/workbench/action-center'],
        ['数据质量', '/api/quality/summary'],
        ['经营提醒', '/api/quality/business-alerts'],
        ['规则执行', '/api/quality/rule-compliance'],
        ['学习证据健康', '/api/quality/rule-learning-health?limit=20'],
        ['规则候选', '/api/quality/rule-candidates'],
        ['规则历史', '/api/quality/rule-events'],
        ['知识概况', '/api/knowledge/overview'],
        ['知识向量能力', '/api/knowledge/vector-health'],
        ['知识向量同步记录', '/api/knowledge/vector-sync-runs?limit=5'],
        ['知识搜索', '/api/knowledge?query=V750&limit=5'],
        ['AI 会话列表', '/api/ai/conversations?limit=5'],
        ['AI 模型能力', '/api/ai/capabilities'],
        ['AI 问题反馈', '/api/ai/feedback?limit=5'],
        ['AI 回归概况', '/api/ai/evaluations/overview'],
    ];
    const resources = {};
    for (const [label, pathname] of paths) {
        resources[label] = (await request(label, 'GET', pathname)).payload;
    }
    return resources;
}

async function testBusinessSettingCommand() {
    const current = (await request(
        '读取管理费设置版本',
        'GET',
        '/api/settings/management_fee'
    )).payload.data;
    const input = {
        value: current.value,
        expectedUpdatedAt: current.updatedAt,
        idempotencyKey: `deep:business-setting:${Date.now()}`,
    };
    const result = (await request(
        '保存业务设置正式命令',
        'PUT',
        '/api/settings/management_fee',
        input
    )).payload.data;
    assert(
        result.capabilityId === 'settings.update_business_value',
        '保存业务设置缺少正式 capability 回执'
    );
    assert(result.auditId, '保存业务设置缺少强审计回执');
    const replay = (await request(
        '重放业务设置正式命令',
        'PUT',
        '/api/settings/management_fee',
        input
    )).payload.data;
    assert(
        replay.idempotentReplay === true,
        '保存业务设置重放未命中持久幂等回执'
    );
}

async function testResourceDetails(resources) {
    const parts = resources['零件列表'].data;
    const recipes = resources['配方列表'].data;
    const templates = resources['模板列表'].data;
    const orders = resources['订单列表'].data;
    const coils = resources['线圈列表'].data;
    const knowledge = resources['知识搜索'].data;
    assert(
        parts.length > 0 && recipes.length > 0 && templates.length > 0 && coils.length > 0,
        '核心基础资料为空'
    );

    const recipe = recipes.find(candidate => {
        const parts = JSON.parse(candidate.partsJson || '[]');
        const hasCoilPart = parts.some(item => item.name === '线圈转子');
        const hasOfficialCoil = coils.some(item => (
            String(item.spec || '').trim() === String(candidate.coilSpec || '').trim()
            && Number(item.sheets) === Number(candidate.coilSheets)
            && String(item.material || '').trim() === String(candidate.coilMaterial || '').trim()
            && String(item.slotType || '').trim() === String(candidate.coilSlotType || '').trim()
            && (!item.schemeStatus || item.schemeStatus === 'official')
        ));
        return hasCoilPart && hasOfficialCoil;
    });
    assert(recipe, '深度测试数据缺少关联正式线圈方案的配方');
    const template = templates[0];
    const coil = coils[0];
    const recipesWithTechnicalFiles = (await request(
        '有技术档案的配方筛选',
        'GET',
        '/api/recipes?hasTechnicalFiles=true'
    )).payload.data;
    assert(
        recipesWithTechnicalFiles.every(item => Number(item.technicalFileCount) > 0),
        '有技术档案的配方筛选返回了无有效档案的配方'
    );
    const recipeDetail = (await request('配方详情及只读对外型号', 'GET', `/api/recipes/${recipe.id}`)).payload.data;
    assert(typeof recipeDetail.externalModel === 'string' && recipeDetail.externalModel.length > 0, '配方详情缺少对外型号');
    const inventoryStatus = (await request(
        '配方库存状态',
        'GET',
        `/api/recipes/${recipe.id}/inventory-status`
    )).payload.data;
    const coilInventory = inventoryStatus.items.find(item => item.inventoryType === 'coil');
    if (JSON.parse(recipe.partsJson || '[]').some(item => item.name === '线圈转子')) {
        assert(coilInventory, '配方库存状态未识别线圈转子');
        assert(coilInventory.coilId, '配方库存状态未关联正式线圈方案');
        assert(coilInventory.status !== 'missing', '线圈转子被错误标记为零件缺失');
    }
    await request('配方技术文件', 'GET', `/api/recipes/${recipe.id}/technical-files`);
    await request('配方当前成本', 'GET', `/api/recipes/${recipe.id}/cost`);
    await request('配方成本预览', 'POST', `/api/recipes/${recipe.id}/cost-preview`, {});
    await request('配方智能检查', 'POST', '/api/quality/recipe-analysis', {
        recipeId: recipe.id,
    });
    await request('模板详情', 'GET', `/api/templates/${template.id}`);
    await request('模板成本', 'GET', `/api/templates/${template.id}/cost`);
    await request('模板默认配方', 'GET', `/api/templates/${template.id}/default-recipe`);
    await request('模板引用配方', 'GET', `/api/templates/${template.id}/recipes`);
    await request('模板应用草稿', 'POST', `/api/templates/${template.id}/apply`, {
        recipe: { name: '深度测试草稿' },
    });
    await request('线圈库存流水', 'GET', `/api/coils/${coil.id}/stock-movements`);
    await request('线圈规格草稿', 'POST', '/api/coils/spec-draft', {
        spec: coil.spec,
        material: coil.material,
        slotType: coil.slotType,
    });
    await request('线圈成本计算', 'POST', '/api/coils/calculate', {
        spec: coil.spec,
        sheets: coil.sheets,
        material: coil.material,
        slotType: coil.slotType,
    });
    await request('线圈单片价预览', 'POST', '/api/coils/spec-price-preview', {
        spec: coil.spec,
        material: coil.material,
        slotType: coil.slotType,
        unitPrice: coil.unitPrice,
    });
    await request('订单采购草稿', 'POST', '/api/orders/purchase-plan', {
        items: [{
            recipeId: recipe.id,
            recipeName: recipe.name,
            qty: 1,
            partsJson: recipe.partsJson,
        }],
    });
    await request(
        '历史订单价格',
        'GET',
        `/api/orders/history-price/${encodeURIComponent(recipe.name)}`
    );
    if (orders.length > 0) await request('订单详情', 'GET', `/api/orders/${orders[0].id}`);
    if (knowledge.length > 0) {
        await request('知识详情', 'GET', `/api/knowledge/${knowledge[0].id}`);
    }
    return { recipe, coil };
}

async function createBundleTemplate(unique, suffix = '') {
    const shell = (await request(`新增模板泵壳${suffix}`, 'POST', '/api/parts', { naming: { ruleId: 'shell', spec: { series: `${unique}${suffix}`, specification: '整套' } }, category: '泵壳', supplier: '自动验收', price: 100, stock: 0, idempotencyKey: `deep:template-shell:${unique}${suffix}` })).payload.data;
    return (await request(`新增模板${suffix}`, 'POST', '/api/templates', {
        shellModel: `${unique}-SHELL${suffix}`,
        shellPartId: shell.id,
        naming: { ruleId: 'template', spec: { series: `${unique}${suffix}`, configuration: '整套' } },
        description: '隔离验收模板',
        partsJson: '[]',
        shellComponentsJson: '[]',
        rotorParamsJson: '{}',
        assemblyWage: 1,
        packingWage: 1,
        paintingWage: null,
        surfaceTreatmentMode: 'none',
        surfaceTreatmentCost: 0,
        costMode: 'bundle',
        bundleCost: 100,
        bundleNote: '自动验收',
        idempotencyKey: `deep:template-create:${unique}${suffix}`,
    })).payload.data;
}

async function testBusinessRevision() {
    const before = (await request('读取提交前业务变更版本', 'GET', '/api/business-changes/revision')).payload.data;
    const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DEEP_API_ACCESS_PASSWORD }), signal: AbortSignal.timeout(5000) });
    assert(login.ok, '第二会话登录失败');
    const secondCookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const unique = `REVISION-${Date.now()}`;
    await request('正式目录提交产生刷新版本', 'POST', '/api/parts', {
        model: unique, category: '测试件', supplier: unique, stock: 0, price: 1, idempotencyKey: `deep:revision:${unique}`,
    });
    const after = (await request('提交后业务变更版本改变', 'GET', '/api/business-changes/revision')).payload.data;
    assert(before.revision !== after.revision, '提交后版本未变化');
    const other = await fetch(`${baseUrl}/api/business-changes/revision`, { headers: { Cookie: secondCookie }, signal: AbortSignal.timeout(5000) });
    assert(other.ok && other.headers.get('cache-control') === 'no-store', '第二会话版本接口或缓存控制失败');
    assert((await other.json()).data.revision === after.revision, '独立会话未读到同一提交版本');
    results.push({ label: '独立登录会话读取相同最新业务版本', status: 200, ms: 0 });
}

async function testCatalogMigrationHttp(databasePath) {
    const fixture = new Database(databasePath);
    const supplier = `MIGRATION-${Date.now()}`;
    try {
        const ids = ['6287', '6288'].map(model => Number(fixture.prepare("INSERT INTO parts (model, category, supplier, price, stock, updated_at) VALUES (?, '轴承', ?, 2, 11, ?)").run(model, supplier, new Date().toISOString()).lastInsertRowid));
        const entries = ids.map((entityId, index) => ({ entityType: 'part', entityId, naming: { ruleId: 'bearing', spec: { code: `628${index + 7}` } }, samePhysicalItem: true, expectedUpdatedAt: fixture.prepare('SELECT updated_at FROM parts WHERE id=?').get(entityId).updated_at }));
        const before = fixture.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
        const preview = (await request('已核对批量迁移正式 HTTP 预览', 'POST', '/api/catalog/migration-preview', { entries })).payload.data;
        assert(fixture.prepare('SELECT COUNT(*) n FROM audit_log').get().n === before, '迁移预览产生业务写入');
        const input = { confirmationToken: preview.confirmationToken, idempotencyKey: preview.suggestedIdempotencyKey };
        const applied = (await request('已核对批量迁移原子提交并返回审计', 'POST', '/api/catalog/migrate', input)).payload.data;
        assert(applied.migratedCount === 2 && applied.auditIds.length >= 4, '批量迁移数量或审计不完整');
        assert((await request('批量迁移 HTTP 幂等重放不重复写入', 'POST', '/api/catalog/migrate', input)).payload.data.idempotentReplay, '批量迁移未幂等');
        const rows = (await request('批量迁移后正式目录回读现名及库存', 'GET', '/api/parts')).payload.data;
        for (const [index, id] of ids.entries()) assert(rows.find(row => row.id === id)?.model === `轴承-28${index + 7}` && fixture.prepare('SELECT stock FROM parts WHERE id=?').get(id).stock === 11, '迁移改变身份或库存');
        const versions = ids.map(entityId => fixture.prepare('SELECT updated_at FROM parts WHERE id=?').get(entityId).updated_at);
        await request('过期迁移映射明确拒绝', 'POST', '/api/catalog/migration-preview', { entries }, [409]);
        assert(ids.every((id, index) => fixture.prepare('SELECT updated_at FROM parts WHERE id=?').get(id).updated_at === versions[index]), '过期映射修改了目录');
    } finally { fixture.close(); }
}

async function testSavedPurchaseNameViews(databasePath) {
    const fixture = new Database(databasePath);
    const unique = `SAVED-PURCHASE-${Date.now()}`;
    let partId;
    let orderId;
    let legacyOrderId;
    try {
        partId = Number(fixture.prepare("INSERT INTO parts (model, supplier, stock, price, updated_at) VALUES (?, ?, 0, 3, '2026-09-15T00:00:00.000Z')").run(`${unique}-旧名`, unique).lastInsertRowid);
        const items = JSON.stringify([{ qty: 2, partsJson: JSON.stringify([{ partId, model: `${unique}-旧名`, supplier: unique, qty: 1 }]) }]);
        const purchase = JSON.stringify([{ id: 'retained-purchase-row', partId, model: `${unique}-旧名`, supplier: unique,
            inventoryType: 'part', plannedQty: 2, orderedQty: 1, receivedQty: 1, stockedQty: 0,
            purchasePrice: 7, purchasePriceRecorded: true, actualSupplier: '实际供应商', stockInHistory: [],
        }]);
        orderId = Number(fixture.prepare("INSERT INTO orders (customer_name, contract_no, status, items_json, purchase_list_json) VALUES (?, ?, '采购中', ?, ?)").run(unique, unique, items, purchase).lastInsertRowid);
        const before = fixture.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        const legacyBom = JSON.stringify([{ model: `${unique}-旧名`, supplier: unique, qty: 1 }]);
        legacyOrderId = Number(fixture.prepare("INSERT INTO orders(customer_name,status,items_json,purchase_list_json,todos_json) VALUES(?, '已关闭', ?, ?, ?)").run(unique,
            JSON.stringify([{ partsJson: legacyBom }]), legacyBom, JSON.stringify([{ id: 'continuity-todo', done: false }])).lastInsertRowid);
        const renamePreview = (await request('现存采购物料正式规格改名预览', 'POST', '/api/catalog/rename-preview', { entityType: 'part', entityId: partId, naming: { ruleId: 'custom-part', spec: { kind: unique, specification: '新名' } }, samePhysicalItem: true, expectedUpdatedAt: '2026-09-15T00:00:00.000Z' })).payload.data;
        const renameInput = { confirmationToken: renamePreview.confirmationToken, idempotencyKey: renamePreview.suggestedIdempotencyKey };
        const renamed = (await request('有采购引用物料正式改名保留 ID', 'POST', '/api/catalog/rename', renameInput)).payload.data;
        assert(renamed.entityId === partId && renamed.currentName === `${unique}-新名` && renamed.auditIds.length > 0, '规格改名回执不完整');
        assert((await request('有采购引用物料正式改名幂等重放', 'POST', '/api/catalog/rename', renameInput)).payload.data.idempotentReplay, '改名未幂等');
        const todoInput = { todoId: 'continuity-todo', done: true, idempotencyKey: `catalog-continuity-${legacyOrderId}` };
        await request('无ID旧引用改名后正式切换订单待办', 'POST', `/api/orders/${legacyOrderId}/todos/toggle`, todoInput);
        const legacyDetail = (await request('待办更新后旧引用仍显示正式现名和物料ID', 'GET', `/api/orders/${legacyOrderId}`)).payload.data;
        const legacyRow = JSON.parse(legacyDetail.purchaseListJson)[0];
        assert(legacyRow.model === `${unique}-新名` && legacyRow.partId === partId, '普通更新丢失改名引用绑定');
        assert(JSON.parse(JSON.parse(legacyDetail.itemsJson)[0].partsJson)[0].partId === partId, '嵌套BOM未续接');
        assert(fixture.prepare('SELECT purchase_list_json FROM orders WHERE id=?').get(legacyOrderId).purchase_list_json === legacyBom, '续接改写原业务快照');
        assert((await request('待办续接幂等重放', 'POST', `/api/orders/${legacyOrderId}/todos/toggle`, todoInput)).payload.data.idempotentReplay, '待办续接重复执行');
        const detail = (await request('订单详情采购行按保存 ID 显示现名', 'GET', `/api/orders/${orderId}`)).payload.data;
        const row = JSON.parse(detail.purchaseListJson)[0];
        assert(row.model === `${unique}-新名` && row.id === 'retained-purchase-row', '详情现名或采购行 ID 不正确');
        assert(row.purchasePrice === 7 && row.orderedQty === 1 && row.receivedQty === 1 && row.stockedQty === 0, '现名读取改变采购事实');
        const list = (await request('订单列表采购现名与详情一致', 'GET', `/api/orders?contractNo=${encodeURIComponent(unique)}`)).payload.data;
        assert(JSON.parse(list.find(order => order.id === orderId).purchaseListJson)[0].model === row.model, '列表与详情现名不一致');
        const overview = (await request('采购总览使用保存 ID 对应现名', 'GET', `/api/orders/purchase-overview?supplier=${encodeURIComponent(unique)}`)).payload.data;
        assert(overview.tasks.some(task => task.model === row.model && task.orderedQty === 1 && task.receivedQty === 1), '采购总览名称或进度错误');
        assert(JSON.stringify(fixture.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)) === JSON.stringify(before), '采购现名查询修改了订单原始快照');
        const draft = (await request('改名后既有采购连续入库预览', 'POST', `/api/orders/${orderId}/complete-purchase-draft`, {})).payload.data;
        const inboundInput = { expectedUpdatedAt: draft.expectedUpdatedAt, previewHash: draft.previewHash, idempotencyKey: draft.suggestedIdempotencyKey };
        const inbound = (await request('改名后既有采购按原物料 ID 入库', 'POST', `/api/orders/${orderId}/complete-purchase`, inboundInput)).payload.data;
        assert(inbound.order.status === '采购完成' && fixture.prepare('SELECT stock FROM parts WHERE id = ?').get(partId).stock === 2, '改名后的入库数量或状态错误');
        assert((await request('改名后入库幂等不重复增库存', 'POST', `/api/orders/${orderId}/complete-purchase`, inboundInput)).payload.data.idempotentReplay, '入库重试未幂等');
        assert(fixture.prepare('SELECT stock FROM parts WHERE id = ?').get(partId).stock === 2, '重复入库增了库存');
        for (const status of ['已关闭', '已取消']) {
            fixture.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId);
            const frozen = fixture.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            const historical = (await request(`${status}订单详情显示现名但保留采购事实`, 'GET', `/api/orders/${orderId}`)).payload.data;
            const historyRow = JSON.parse(historical.purchaseListJson)[0];
            assert(historyRow.model === row.model && historyRow.id === 'retained-purchase-row' && historyRow.purchasePrice === 7 && historyRow.orderedQty === JSON.parse(frozen.purchase_list_json)[0].orderedQty, '历史订单显示改变了采购事实');
            const historyList = (await request(`${status}订单列表显示现名`, 'GET', `/api/orders?contractNo=${encodeURIComponent(unique)}`)).payload.data;
            assert(JSON.parse(historyList.find(order => order.id === orderId).purchaseListJson)[0].model === row.model, '历史订单列表名称未更新');
            assert(JSON.stringify(fixture.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)) === JSON.stringify(frozen), '历史现名查询改写了订单');
        }
    } finally {
        if (legacyOrderId) fixture.prepare("UPDATE orders SET deleted_at = 'qa-cleanup' WHERE id = ?").run(legacyOrderId);
        if (orderId) fixture.prepare("UPDATE orders SET deleted_at = 'qa-cleanup' WHERE id = ?").run(orderId);
        if (partId) fixture.prepare("UPDATE parts SET deleted_at = 'qa-cleanup' WHERE id = ?").run(partId);
        fixture.close();
    }
}

async function testRecipeInventoryIdentity(databasePath) {
    const fixture = new Database(databasePath);
    let recipeId;
    let brokenId;
    let snapshot;
    let firstId;
    let secondId;
    let unavailableCoilId;
    try {
        const name = `INVENTORY-${Date.now()}`;
        const insert = fixture.prepare('INSERT INTO parts (model, supplier, stock, price) VALUES (?, ?, ?, 1)');
        firstId = Number(insert.run(name, '库存验收甲', 9).lastInsertRowid);
        secondId = Number(insert.run(name, '库存验收乙', 0).lastInsertRowid);
        unavailableCoilId = Number(fixture.prepare("INSERT INTO coils (spec, sheets, scheme_code, scheme_name, scheme_status, stock) VALUES ('验收', 100, ?, '未正式方案', 'testing', 20)").run(name).lastInsertRowid);
        snapshot = JSON.stringify([
            { partId: secondId, model: name },
            { partId: firstId, model: '旧名称' },
            { model: name },
            { model: name, supplier: '不存在的供应商' },
            { costRole: 'coil', coilId: unavailableCoilId, model: '旧线圈名称' },
            { costRole: 'rotorProcess', model: '加工费' },
            { partId: firstId, model: name, supplier: '错误供应商' },
        ]);
        recipeId = Number(fixture.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run(name, snapshot).lastInsertRowid);
        brokenId = Number(fixture.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run(`${name}-broken`, '[null]').lastInsertRowid);
    } finally { fixture.close(); }
    const data = (await request('配方库存按身份读取并区分待核对', 'GET', `/api/recipes/${recipeId}/inventory-status`)).payload.data;
    assert(data.sourceOfTruth === 'recipes.inventory_status', '库存查询未声明正式来源');
    assert(data.items[0].currentStock === 0 && data.items[0].status === 'out_of_stock', '同名其他供应商库存混入');
    assert(data.items[1].referenceStatus === 'resolved' && data.items[1].currentName && data.items[1].currentStock === 9, '已保存 ID 未读取当前名称和库存');
    assert(data.items[2].referenceStatus === 'ambiguous' && data.items[2].currentStock === null, '多候选被当作零库存或任取候选');
    assert(data.items[3].referenceStatus === 'missing', '精确供应商不存在时发生回退');
    assert(data.items[4].referenceStatus === 'inactive' && data.items[4].currentStock === null, '非正式线圈被当作可用库存');
    assert(data.items[5].status === 'not_tracked', '加工费被当作缺货');
    assert(data.items[6].referenceStatus === 'identity_mismatch' && data.items[6].currentStock === null, '供应商冲突没有明确拒绝');
    await request('损坏配方 BOM 不返回虚假空库存', 'GET', `/api/recipes/${brokenId}/inventory-status`, undefined, [422]);
    const check = new Database(databasePath);
    try {
        // This isolated fixture simulates a renamed catalog row; it does not
        // bypass the production rename guard or claim command acceptance.
        check.prepare('UPDATE parts SET model = ? WHERE id = ?').run('验收新名称', firstId);
        const refreshed = (await request('已存 ID 在目录改名后回读现名且不依赖旧称', 'GET', `/api/recipes/${recipeId}/inventory-status`)).payload.data;
        assert(refreshed.items[1].currentName === '验收新名称' && refreshed.items[1].currentStock === 9 && refreshed.items[1].partId === firstId, '目录改名后库存读取未跟随稳定 ID');
        assert(check.prepare('SELECT parts_json FROM recipes WHERE id = ?').get(recipeId).parts_json === snapshot, '库存查询改写了配方快照');
        check.prepare('DELETE FROM recipes WHERE id IN (?, ?)').run(recipeId, brokenId);
        check.prepare('DELETE FROM parts WHERE id IN (?, ?)').run(firstId, secondId);
        check.prepare('DELETE FROM coils WHERE id = ?').run(unavailableCoilId);
    } finally { check.close(); }
}

async function testPartRenameGuard(databasePath) {
    const unique = `RENAME-GUARD-${Date.now()}`;
    const part = (await request('改名保护验收建档', 'POST', '/api/parts', {
        model: unique, category: '测试件', supplier: unique, stock: 5, price: 3,
        idempotencyKey: `deep:rename-create:${unique}`,
    })).payload.data;
    const fixture = new Database(databasePath);
    let recipeId;
    const snapshot = JSON.stringify([{ partId: part.id, model: part.model, supplier: part.supplier, qty: 2 }]);
    try {
        recipeId = Number(fixture.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run(unique, snapshot).lastInsertRowid);
        const renameAudits = fixture.prepare("SELECT count(*) n FROM audit_log WHERE capability_id IN ('parts.update', 'parts.save_profile')");
        const before = renameAudits.get().n;
        await request('有引用零件拒绝直接改名', 'PATCH', `/api/parts/${part.id}`, {
            model: `${unique}-NEW`, expectedUpdatedAt: part.updatedAt,
            idempotencyKey: `deep:rename-blocked:${unique}`,
        }, [409]);
        const impact = (await request('有引用零件改名影响只读报告', 'POST', `/api/parts/${part.id}/rename-impact`, {
            model: `${unique}-NEW`, limit: 1,
        })).payload.data;
        assert(impact.displayOnly && impact.referenceCount > 0 && impact.references[0].sourceId === recipeId,
            '改名影响报告遗漏引用或不是只读结果');
        assert(impact.blockers.some(item => item.code === 'PART_RENAME_REFERENCES_REQUIRE_MIGRATION'), '报告遗漏引用迁移阻塞');
        await request('改名影响报告拒绝伪造分页版本', 'POST', `/api/parts/${part.id}/rename-impact`, {
            model: `${unique}-NEW`, offset: 1, sourceHash: '0'.repeat(64),
        }, [409]);
        await request('有引用零件拒绝资料改名预览', 'POST', `/api/parts/${part.id}/save-preview`, {
            model: `${unique}-NEW`, stock: 8, expectedUpdatedAt: part.updatedAt,
        }, [409]);
        const row = fixture.prepare('SELECT model, stock FROM parts WHERE id = ?').get(part.id);
        assert(row.model === part.model && row.stock === 5, '拒绝改名后出现部分保存');
        assert(fixture.prepare('SELECT parts_json FROM recipes WHERE id = ?').get(recipeId).parts_json === snapshot, '拒绝改名改写了引用快照');
        assert(renameAudits.get().n === before, '拒绝改名留下了写审计');
    } finally {
        if (recipeId) fixture.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
        fixture.close();
    }
}

async function testCatalogNamingSave() {
    const unique = `NAMING-${Date.now()}`;
    const namedInput = { category: '包装', supplier: unique, price: 6, stock: 2,
        naming: { ruleId: 'packaging', spec: { kind: '纸箱', specification: '400*300*200' } },
        idempotencyKey: `deep:named-part:${unique}` };
    const named = (await request('规格命名正式新增', 'POST', '/api/parts', namedInput)).payload.data;
    assert(named.model === '纸箱-400*300*200' && named.naming?.ruleVersion === 1, '未持久保存命名输入');
    const namedReplay = (await request('规格命名新增幂等重放', 'POST', '/api/parts', namedInput)).payload.data;
    assert(namedReplay.idempotentReplay === true && namedReplay.id === named.id, '命名新增重放错误');
    const namedRead = (await request('规格命名列表回读', 'GET', `/api/parts?supplier=${encodeURIComponent(unique)}`)).payload.data;
    assert(namedRead.some(row => row.id === named.id && row.naming?.spec?.specification === '400*300*200'), '列表丢失命名字段');
    await request('规格命名拒绝伪造显示名', 'POST', '/api/parts', { ...namedInput, model: '手写名称', idempotencyKey: `deep:named-forged:${unique}` }, [400]);
    await request('规格命名拒绝普通改名', 'PATCH', `/api/parts/${named.id}`, { model: '新名称', expectedUpdatedAt: named.updatedAt }, [409]);
    await request('规格命名资料保存保护', 'POST', `/api/parts/${named.id}/save-preview`, { model: '新名称', stock: 2, expectedUpdatedAt: named.updatedAt }, [409]);

}

async function testCrossModuleWriteFlow(baseResources) {
    const unique = `DEEP-${Date.now()}`;
    const baseRecipe = baseResources.recipe;
    const baseCoil = baseResources.coil;

    const partCreateInput = {
        model: unique,
        category: '测试件',
        price: 12.34,
        supplier: '自动验收',
        stock: 5,
        remark: '隔离数据库',
        idempotencyKey: `deep:part-create:${unique}`,
    };
    const partCreateReceipt = (await request(
        '新增零件正式命令',
        'POST',
        '/api/parts',
        partCreateInput
    )).payload.data;
    const partCreateReplay = (await request(
        '新增零件幂等重放',
        'POST',
        '/api/parts',
        partCreateInput
    )).payload.data;
    assert(partCreateReceipt.capabilityId === 'parts.create', '新增零件缺少正式 capability 回执');
    assert(partCreateReceipt.auditId, '新增零件缺少强审计回执');
    assert(partCreateReplay.idempotentReplay === true, '新增零件重复请求没有命中幂等回执');
    assert(partCreateReplay.id === partCreateReceipt.id, '新增零件幂等重放产生了不同资源');
    const part = partCreateReceipt;
    const partBatchPreview = (await request(
        '批量新增零件预览',
        'POST',
        '/api/parts/batch-create-preview',
        {
            parts: [
                {
                    model: unique,
                    category: '测试件',
                    price: 12.34,
                    supplier: '自动验收',
                    stock: 0,
                },
                {
                    model: unique,
                    category: '测试件',
                    price: 12.5,
                    supplier: '第二供应商',
                    stock: 0,
                },
                {
                    model: `${unique}-BATCH`,
                    category: '测试件',
                    price: 8.8,
                    supplier: '自动验收',
                    stock: 0,
                },
            ],
        }
    )).payload.data;
    assert(partBatchPreview.requestedCount === 3, '批量新增零件预览数量错误');
    assert(partBatchPreview.createCount === 2, '批量新增零件预览未保留同型号不同供应商');
    assert(partBatchPreview.skippedCount === 1, '批量新增零件预览未跳过同型号同供应商');
    const partBatchInput = {
        confirmationToken: partBatchPreview.confirmationToken,
        idempotencyKey: partBatchPreview.suggestedIdempotencyKey,
    };
    const partBatchCreate = (await request(
        '批量新增零件正式命令',
        'POST',
        '/api/parts/batch-create',
        partBatchInput
    )).payload.data;
    const partBatchReplay = (await request(
        '批量新增零件幂等重放',
        'POST',
        '/api/parts/batch-create',
        partBatchInput
    )).payload.data;
    assert(partBatchCreate.capabilityId === 'parts.batch_create', '批量新增零件缺少正式 capability 回执');
    assert(partBatchCreate.createdCount === 2, '批量新增零件执行数量错误');
    assert(partBatchCreate.auditIds.length === 2, '批量新增零件强审计数量错误');
    assert(partBatchReplay.idempotentReplay === true, '批量新增零件没有命中幂等重放');
    const partUpdate = (await request('修改零件正式命令', 'PATCH', `/api/parts/${part.id}`, {
        price: 13.21,
        remark: '已修改',
        expectedUpdatedAt: part.updatedAt,
        idempotencyKey: `deep:part-update:${unique}`,
    })).payload.data;
    assert(partUpdate.capabilityId === 'parts.update', '修改零件缺少正式 capability 回执');
    assert(partUpdate.auditId, '修改零件缺少强审计回执');

    const coilCreateInput = {
        spec: '987',
        diameterMm: 987,
        material: '钢带',
        slotType: '小眼',
        sheets: 140,
        schemeName: '深度测试方案',
        schemeStatus: 'testing',
        unitPrice: 0.4,
        wireWeight: 1.2,
        copperBase: 80,
        coilFee: 10,
        rotorFee: 5,
        idempotencyKey: `deep:coil-create:${unique}`,
    };
    const coilCreate = (await request(
        '新增线圈正式命令',
        'POST',
        '/api/coils',
        coilCreateInput
    )).payload.data;
    const coilCreateReplay = (await request(
        '新增线圈幂等重放',
        'POST',
        '/api/coils',
        coilCreateInput
    )).payload.data;
    assert(coilCreate.capabilityId === 'coils.create', '新增线圈缺少正式 capability 回执');
    assert(coilCreate.auditId, '新增线圈缺少强审计回执');
    assert(coilCreateReplay.idempotentReplay === true, '新增线圈没有命中幂等重放');
    assert(coilCreateReplay.id === coilCreate.id, '新增线圈幂等重放产生了不同资源');

    const coilUpdate = (await request(
        '修改线圈正式命令',
        'PATCH',
        `/api/coils/${coilCreate.id}`,
        {
            wireWeight: 1.3,
            expectedUpdatedAt: coilCreate.updatedAt,
            idempotencyKey: `deep:coil-update:${unique}`,
        }
    )).payload.data;
    assert(coilUpdate.capabilityId === 'coils.update', '修改线圈缺少正式 capability 回执');
    assert(coilUpdate.auditId, '修改线圈缺少强审计回执');

    const coilPricePreview = (await request(
        '线圈批量改单片价正式预览',
        'POST',
        '/api/coils/spec-price-preview',
        {
            spec: coilUpdate.spec,
            material: coilUpdate.material,
            slotType: coilUpdate.slotType,
            unitPrice: 0.5,
        }
    )).payload.data;
    assert(coilPricePreview.updatedCount === 1, '隔离线圈调价预览范围不正确');
    const coilPriceInput = {
        material: coilUpdate.material,
        slotType: coilUpdate.slotType,
        unitPrice: 0.5,
        previewHash: coilPricePreview.previewHash,
        idempotencyKey: coilPricePreview.suggestedIdempotencyKey,
    };
    const coilPrice = (await request(
        '线圈批量改单片价正式命令',
        'PATCH',
        `/api/coils/spec/${encodeURIComponent(coilUpdate.spec)}`,
        coilPriceInput
    )).payload.data;
    const coilPriceReplay = (await request(
        '线圈批量改单片价幂等重放',
        'PATCH',
        `/api/coils/spec/${encodeURIComponent(coilUpdate.spec)}`,
        coilPriceInput
    )).payload.data;
    assert(coilPrice.capabilityId === 'coils.batch_update_unit_price', '线圈调价缺少正式 capability 回执');
    assert(coilPrice.auditIds.length === 1, '线圈调价缺少逐项强审计');
    assert(coilPriceReplay.idempotentReplay === true, '线圈调价没有命中幂等重放');

    const pricedCoil = coilPrice.coils[0];
    const coilDeleteInput = {
        expectedUpdatedAt: pricedCoil.updatedAt,
        idempotencyKey: `deep:coil-delete:${unique}`,
    };
    const coilDelete = (await request(
        '删除线圈正式命令',
        'DELETE',
        `/api/coils/${pricedCoil.id}`,
        coilDeleteInput
    )).payload.data;
    const coilDeleteReplay = (await request(
        '删除线圈幂等重放',
        'DELETE',
        `/api/coils/${pricedCoil.id}`,
        coilDeleteInput
    )).payload.data;
    assert(coilDelete.capabilityId === 'coils.delete', '删除线圈缺少正式 capability 回执');
    assert(coilDelete.auditId, '删除线圈缺少强审计回执');
    assert(coilDeleteReplay.idempotentReplay === true, '删除线圈没有命中幂等重放');

    const pricePreview = (await request(
        '批量调价正式预览',
        'POST',
        '/api/parts/prices-preview',
        {
            updates: [{
                partId: part.id,
                price: 14.56,
                expectedUpdatedAt: partUpdate.updatedAt,
            }],
        }
    )).payload.data;
    const priceCommand = {
        updates: pricePreview.updates,
        previewHash: pricePreview.previewHash,
        idempotencyKey: pricePreview.suggestedIdempotencyKey,
    };
    const priceReceipt = (await request(
        '批量调价持久化命令',
        'PATCH',
        '/api/parts/prices',
        priceCommand
    )).payload.data;
    const priceReplay = (await request(
        '批量调价幂等重放',
        'PATCH',
        '/api/parts/prices',
        priceCommand
    )).payload.data;
    assert(priceReceipt.capabilityId === 'parts.batch_update_prices', '批量调价缺少正式 capability 回执');
    assert(priceReceipt.auditId && priceReceipt.auditIds.length === 1, '批量调价缺少强审计回执');
    assert(priceReplay.idempotentReplay === true, '批量调价重复请求没有命中幂等回执');
    assert(priceReplay.operationId === priceReceipt.operationId, '批量调价幂等重放 operationId 发生变化');
    const stalePricePreview = (await request(
        '批量调价过期预览',
        'POST',
        '/api/parts/prices-preview',
        {
            updates: [{
                partId: part.id,
                price: 15.67,
                expectedUpdatedAt: priceReceipt.parts[0].updatedAt,
            }],
        }
    )).payload.data;
    await request('制造调价预览版本变化', 'PATCH', `/api/parts/${part.id}`, {
        remark: '调价预览版本变化',
        expectedUpdatedAt: priceReceipt.parts[0].updatedAt,
        idempotencyKey: `deep:part-price-conflict:${unique}`,
    });
    const priceConflict = await request(
        '批量调价版本冲突',
        'PATCH',
        '/api/parts/prices',
        {
            updates: stalePricePreview.updates,
            previewHash: stalePricePreview.previewHash,
            idempotencyKey: stalePricePreview.suggestedIdempotencyKey,
        },
        [409]
    );
    assert(priceConflict.payload?.code === 'resource_version_conflict', '调价版本冲突没有返回稳定错误码');
    const partBeforeStock = (await request(
        '库存命令读取资源版本',
        'GET',
        '/api/parts'
    )).payload.data.find(item => item.id === part.id);
    const stockPreview = (await request(
        '批量库存正式预览',
        'POST',
        '/api/parts/batch-stock-preview',
        {
            operations: [{
                partId: part.id,
                delta: 2,
                expectedUpdatedAt: partBeforeStock.updatedAt,
            }],
        }
    )).payload.data;
    const stockCommand = {
        idempotencyKey: stockPreview.suggestedIdempotencyKey,
        confirmationToken: stockPreview.confirmationToken,
    };
    const stockReceipt = (await request(
        '批量库存持久化命令',
        'POST',
        '/api/parts/batch-stock',
        stockCommand
    )).payload.data;
    const stockReplay = (await request(
        '批量库存幂等重放',
        'POST',
        '/api/parts/batch-stock',
        stockCommand
    )).payload.data;
    assert(stockReceipt.idempotentReplay === false, '首次库存命令被错误标记为重放');
    assert(stockReplay.idempotentReplay === true, '重复库存命令没有返回持久化回执');
    assert(stockReplay.operationId === stockReceipt.operationId, '幂等重放 operationId 发生变化');
    assert(stockReceipt.auditId && stockReceipt.auditIds.length > 0, '库存命令缺少强审计回执');
    const staleStockPreview = (await request(
        '批量库存过期预览',
        'POST',
        '/api/parts/batch-stock-preview',
        {
            operations: [{
                partId: part.id,
                delta: 1,
            }],
        }
    )).payload.data;
    await request('制造库存预览版本变化', 'PATCH', `/api/parts/${part.id}`, {
        remark: '库存预览版本变化',
        expectedUpdatedAt: staleStockPreview.operations[0].expectedUpdatedAt,
        idempotencyKey: `deep:part-stock-conflict:${unique}`,
    });
    const versionConflict = await request(
        '批量库存版本冲突',
        'POST',
        '/api/parts/batch-stock',
        {
            idempotencyKey: staleStockPreview.suggestedIdempotencyKey,
            confirmationToken: staleStockPreview.confirmationToken,
        },
        [409]
    );
    assert(versionConflict.payload?.code === 'resource_version_conflict', '库存版本冲突没有返回稳定错误码');
    const partAfterStock = (await request(
        '库存命令核对最终库存',
        'GET',
        '/api/parts'
    )).payload.data.find(item => item.id === part.id);
    assert(partAfterStock.stock === partBeforeStock.stock + 2, '幂等重放或版本冲突重复修改了库存');
    await waitForAutomaticKnowledgeUpdate(part, 14.56);
    const automaticHistory = (await request(
        '自动知识同步历史',
        'GET',
        '/api/knowledge/sync-runs?limit=10'
    )).payload.data;
    assert(
        automaticHistory.items.some(run => run.mode === 'automatic' && run.status === 'success'),
        '业务变更后没有生成自动知识同步历史'
    );
    const automaticHealth = (await request(
        '自动知识同步健康',
        'GET',
        '/api/knowledge/health'
    )).payload.data;
    assert(
        automaticHealth.status === 'healthy' && automaticHealth.issues.length === 0,
        `自动同步完成后健康状态异常: ${JSON.stringify(automaticHealth)}`
    );

    const template = await createBundleTemplate(unique);
    const templateReplay = await createBundleTemplate(unique);
    assert(template.capabilityId === 'templates.create', '新增模板缺少正式 capability 回执');
    assert(template.auditId, '新增模板缺少强审计回执');
    assert(templateReplay.idempotentReplay === true, '新增模板重复请求没有命中幂等回执');

    const shellComponent = (await request(
        '新增泵壳搭配零件',
        'POST',
        '/api/parts',
        {
            naming: { ruleId: 'shell-component', spec: { kind: '组件', specification: `${unique}-SHELL-COMPONENT` } },
            category: '泵壳搭配',
            price: 8,
            supplier: '自动验收',
            stock: 0,
            idempotencyKey: `deep:shell-component-create:${unique}`,
        }
    )).payload.data;
    const componentTemplate = (await request(
        '新增自由搭配模板并忽略未知组件字段',
        'POST',
        '/api/templates',
        {
            shellModel: `${unique}-COMPONENT-SHELL`,
            naming: { ruleId: 'template', spec: { series: unique, configuration: 'COMPONENT-SHELL' } },
            description: '组件数量与字段白名单验收',
            partsJson: '[]',
            shellComponentsJson: JSON.stringify([{
                id: 'client-only-row-id',
                name: '验收组件',
                model: shellComponent.model,
                supplier: shellComponent.supplier,
                qty: 0.25,
                unitCost: 8,
                included: true,
                componentType: 'standard',
                unexpected: { clientOnly: true },
            }]),
            rotorParamsJson: '{}',
            assemblyWage: 0,
            packingWage: 0,
            surfaceTreatmentMode: 'none',
            surfaceTreatmentCost: 0,
            costMode: 'components',
            bundleCost: 0,
            idempotencyKey: `deep:component-template-create:${unique}`,
        }
    )).payload.data;
    const componentTemplateDetail = (await request(
        '读取自由搭配模板字段白名单结果',
        'GET',
        `/api/templates/${componentTemplate.id}`
    )).payload.data;
    const [savedComponent] = JSON.parse(componentTemplateDetail.shellComponentsJson);
    assert(savedComponent.qty === 0.25, '自由搭配模板合法小数数量未原样保存');
    assert(savedComponent.id === undefined, '自由搭配模板保存了客户端临时 id');
    assert(savedComponent.unexpected === undefined, '自由搭配模板保存了未知字段');
    const invalidQuantity = await request(
        '拒绝自由搭配模板零数量',
        'POST',
        '/api/templates',
        {
            shellModel: `${unique}-INVALID-QTY`,
            naming: { ruleId: 'template', spec: { series: unique, configuration: 'INVALID-QTY' } },
            partsJson: '[]',
            shellComponentsJson: JSON.stringify([{
                name: '验收组件',
                model: shellComponent.model,
                supplier: shellComponent.supplier,
                qty: 0,
                unitCost: 8,
                included: true,
                componentType: 'standard',
            }]),
            rotorParamsJson: '{}',
            costMode: 'components',
            idempotencyKey: `deep:invalid-component-template:${unique}`,
        },
        [400]
    );
    assert(/必须是正数/.test(invalidQuantity.payload?.error || ''), '零数量模板未返回明确校验错误');

    const updatedTemplate = (await request(
        '修改模板正式命令',
        'PATCH',
        `/api/templates/${template.id}`,
        {
        description: '隔离验收模板已修改',
            expectedUpdatedAt: template.updatedAt,
            idempotencyKey: `deep:template-update:${unique}`,
        }
    )).payload.data;
    assert(updatedTemplate.capabilityId === 'templates.update', '修改模板缺少正式 capability 回执');
    assert(updatedTemplate.auditId, '修改模板缺少强审计回执');
    const variantInput = {
        naming: { ruleId: 'model-variant', spec: { series: unique, configuration: '普通' } },
        modelName: `${unique}-MODEL`,
        templateId: template.id,
        coilId: baseCoil.id,
        coilSpec: baseCoil.spec,
        coilSheets: baseCoil.sheets,
        coilMaterial: baseCoil.material,
        coilSlotType: baseCoil.slotType,
        longScrewExtraLength: 0,
        note: '自动验收',
        customFieldsJson: '[]',
    };
    const variantCreateInput = {
        ...variantInput,
        idempotencyKey: `deep:model-variant-create:${unique}`,
    };
    const variant = (await request(
        '新增型号配置',
        'POST',
        '/api/model-variants',
        variantCreateInput
    )).payload.data;
    assert(variant.capabilityId === 'model_variants.create', '新增型号配置缺少正式 capability 回执');
    const variantReplay = (await request(
        '重放新增型号配置',
        'POST',
        '/api/model-variants',
        variantCreateInput
    )).payload.data;
    assert(variantReplay.idempotentReplay === true, '新增型号配置重放未命中持久幂等回执');
    const updatedVariant = (await request('修改型号配置', 'PATCH', `/api/model-variants/${variant.id}`, {
        ...variantInput,
        modelName: variant.modelName,
        longScrewExtraLength: 1,
        note: '自动验收已修改',
        expectedUpdatedAt: variant.updatedAt,
        idempotencyKey: `deep:model-variant-update:${unique}`,
    })).payload.data;
    assert(updatedVariant.capabilityId === 'model_variants.update', '修改型号配置缺少正式 capability 回执');
    await request('型号配置配方草稿', 'POST', '/api/recipes/model-variant-draft', {
        modelVariantId: variant.id,
    });

    const recipeInput = {
        naming: { ruleId: 'recipe', spec: { series: unique, configuration: '普通' } },
        ...baseRecipe,
        id: undefined,
        name: `${unique}-RECIPE`,
        templateId: template.id,
        modelVariantId: variant.id,
        coilId: baseCoil.id,
        coilSpec: baseCoil.spec,
        coilSheets: baseCoil.sheets,
        coilMaterial: baseCoil.material,
        coilSlotType: baseCoil.slotType,
        partsJson: JSON.stringify(JSON.parse(baseRecipe.partsJson || '[]').map(part => (
            part?.inventoryType === 'coil' || part?.name === '线圈转子'
                ? {
                    ...part,
                    model: `${baseCoil.spec}-${baseCoil.sheets}`,
                    coilId: baseCoil.id,
                    schemeCode: baseCoil.schemeCode || '',
                    schemeName: baseCoil.schemeName || '',
                    material: baseCoil.material,
                    slotType: baseCoil.slotType,
                }
                : part
        ))),
    };
    const recipe = (await request(
        '新增配方',
        'POST',
        '/api/recipes',
        recipeInput
    )).payload.data;
    await request('修改配方', 'PATCH', `/api/recipes/${recipe.id}`, {
        ...recipeInput,
        name: recipe.name,
        spec: '深度验收已修改',
    });
    await request('新配方成本预览', 'POST', `/api/recipes/${recipe.id}/cost-preview`, {});
    const analysis = (await request(
        '新配方智能检查',
        'POST',
        '/api/quality/recipe-analysis',
        { recipeId: recipe.id }
    )).payload.data;
    const finding = [...(analysis.missingItems || []), ...(analysis.priceAlerts || [])][0];
    if (finding) {
        await request(
            '保存检查反馈',
            'POST',
            `/api/quality/recipes/${recipe.id}/feedback`,
            {
                findingKey: finding.key,
                findingType: finding.type,
                decision: 'review',
                findingSnapshot: finding,
            }
        );
    }
    const learningFeedback = (await request(
        '保存待复核学习反馈',
        'POST',
        `/api/quality/recipes/${recipe.id}/feedback`,
        {
            findingKey: `peer_pattern:deep-smoke:${unique}`,
            findingType: 'peer_pattern',
            decision: 'confirmed',
            findingSnapshot: { title: '深度验收待复核提醒' },
        }
    )).payload.data;
    await request('修改配方触发学习反馈过期', 'PATCH', `/api/recipes/${recipe.id}`, {
        ...recipeInput,
        name: recipe.name,
        spec: '深度验收触发待复核',
    });
    const healthBeforeResolve = (await request(
        '确认学习反馈进入待复核队列',
        'GET',
        '/api/quality/rule-learning-health?limit=200'
    )).payload.data;
    assert(
        healthBeforeResolve.items.some(item => item.feedbackId === learningFeedback.id && item.needsRecheck),
        '过期学习反馈没有进入待复核队列'
    );
    const resolvedFeedback = (await request(
        '确认已消失提醒解决',
        'POST',
        `/api/quality/recipe-feedback/${learningFeedback.id}/resolve`,
        {}
    )).payload.data;
    assert(resolvedFeedback.decision === 'review' && resolvedFeedback.resolved, '待复核反馈未正确解决');
    const healthAfterResolve = (await request(
        '确认已解决反馈退出队列',
        'GET',
        '/api/quality/rule-learning-health?limit=200'
    )).payload.data;
    assert(
        !healthAfterResolve.items.some(item => item.feedbackId === learningFeedback.id),
        '已解决学习反馈仍停留在待复核队列'
    );
    await request('转子模板草稿', 'POST', '/api/rotor/template-draft', {
        templateId: template.id,
    });
    await request('转子配方草稿', 'POST', '/api/rotor/recipe-draft', {
        recipeId: recipe.id,
    });

    const customerCreateInput = {
        name: `${unique}-CUSTOMER`,
        contactInfo: '自动验收',
        defaultMargin: 0.15,
        remark: '隔离数据库',
        idempotencyKey: `customer-create:${unique}`,
    };
    const createdCustomer = (await request(
        '正式新增客户',
        'POST',
        '/api/customers',
        customerCreateInput
    )).payload.data;
    assert(
        createdCustomer.capabilityId === 'customers.create'
            && createdCustomer.auditId,
        '新增客户没有返回正式命令与强审计回执'
    );
    const customerReplay = (await request(
        '新增客户幂等重放',
        'POST',
        '/api/customers',
        customerCreateInput
    )).payload.data;
    assert(
        customerReplay.idempotentReplay === true
            && customerReplay.id === createdCustomer.id,
        '新增客户幂等重放产生了重复客户'
    );
    const customer = (await request(
        '正式修改客户',
        'PATCH',
        `/api/customers/${createdCustomer.id}`,
        {
            name: createdCustomer.name,
            contactInfo: createdCustomer.contactInfo,
            defaultMargin: createdCustomer.defaultMargin,
            remark: '隔离数据库已修改',
            expectedUpdatedAt: createdCustomer.updatedAt,
            idempotencyKey: `customer-update:${unique}`,
        }
    )).payload.data;
    assert(
        customer.capabilityId === 'customers.update'
            && customer.auditId
            && customer.remark === '隔离数据库已修改',
        '修改客户没有返回正式命令与强审计回执'
    );
    const disposableCustomer = (await request(
        '新增待删除客户',
        'POST',
        '/api/customers',
        {
            ...customerCreateInput,
            name: `${unique}-DISPOSABLE-CUSTOMER`,
            idempotencyKey: `customer-create-delete:${unique}`,
        }
    )).payload.data;
    const deletedCustomer = (await request(
        '正式删除客户',
        'DELETE',
        `/api/customers/${disposableCustomer.id}`,
        {
            expectedUpdatedAt: disposableCustomer.updatedAt,
            idempotencyKey: `customer-delete:${unique}`,
        }
    )).payload.data;
    assert(
        deletedCustomer.capabilityId === 'customers.delete'
            && deletedCustomer.deleted === 1
            && deletedCustomer.auditId,
        '删除客户没有返回正式命令与强审计回执'
    );
    const quoteInput = {
        customerId: customer.id,
        status: '草稿',
        items: [{
            baseRecipeId: recipe.id,
            baseRecipeName: recipe.name,
            qty: 2,
            margin: 1.15,
        }],
        remark: '自动深度验收',
    };
    const quoteSaveDraft = (await request(
        '报价保存草稿',
        'POST',
        '/api/quotations/save-payload-draft',
        quoteInput
    )).payload.data;
    assert(
        quoteSaveDraft.previewHash && quoteSaveDraft.suggestedIdempotencyKey,
        '报价保存草稿缺少预览哈希或建议幂等键'
    );
    const quotation = (await request(
        '新增报价',
        'POST',
        '/api/quotations',
        {
            ...quoteSaveDraft,
            idempotencyKey: quoteSaveDraft.suggestedIdempotencyKey,
        }
    )).payload.data;
    assert(
        quotation.capabilityId === 'quotations.create'
            && quotation.operationId
            && quotation.auditId
            && quotation.totalCost === quoteSaveDraft.totalCost,
        '新增报价没有返回正式命令、强审计回执或保持预览成本'
    );
    const quotationReplay = (await request(
        '新增报价幂等重放',
        'POST',
        '/api/quotations',
        {
            ...quoteSaveDraft,
            idempotencyKey: quoteSaveDraft.suggestedIdempotencyKey,
        }
    )).payload.data;
    assert(
        quotationReplay.idempotentReplay === true
            && quotationReplay.id === quotation.id,
        '新增报价幂等重放产生了重复报价'
    );
    const quotationIdempotencyConflict = (await request(
        '新增报价幂等键异参复用拒绝',
        'POST',
        '/api/quotations',
        {
            ...quoteSaveDraft,
            remark: '异参请求不得复用原报价幂等键',
            idempotencyKey: quoteSaveDraft.suggestedIdempotencyKey,
        },
        [409]
    )).payload;
    assert(
        quotationIdempotencyConflict.code === 'idempotency_key_conflict',
        '新增报价异参复用没有返回稳定幂等冲突'
    );
    const quoteUpdateDraft = (await request(
        '报价修改草稿',
        'POST',
        '/api/quotations/save-payload-draft',
        { ...quoteInput, remark: '自动深度验收已修改' }
    )).payload.data;
    const updatedQuotation = (await request(
        '正式修改报价',
        'PATCH',
        `/api/quotations/${quotation.id}`,
        {
            ...quoteUpdateDraft,
            expectedUpdatedAt: quotation.updatedAt,
            idempotencyKey: quoteUpdateDraft.suggestedIdempotencyKey,
        }
    )).payload.data;
    assert(
        updatedQuotation.capabilityId === 'quotations.update'
            && updatedQuotation.remark === '自动深度验收已修改',
        '报价修改未通过正式命令保存'
    );
    const staleQuotationUpdate = (await request(
        '报价修改旧版本拒绝',
        'PATCH',
        `/api/quotations/${quotation.id}`,
        {
            ...quoteUpdateDraft,
            expectedUpdatedAt: quotation.updatedAt,
            idempotencyKey: `quotation-update-stale:${unique}`,
        },
        [409]
    )).payload;
    assert(
        staleQuotationUpdate.code === 'resource_version_conflict',
        '报价修改旧版本没有返回稳定版本冲突'
    );
    const disposableQuotation = (await request(
        '新增待删除报价',
        'POST',
        '/api/quotations',
        {
            ...quoteSaveDraft,
            idempotencyKey: `quotation-create-delete:${unique}`,
        }
    )).payload.data;
    const deletedQuotation = (await request(
        '正式删除报价',
        'DELETE',
        `/api/quotations/${disposableQuotation.id}`,
        {
            expectedUpdatedAt: disposableQuotation.updatedAt,
            idempotencyKey: `quotation-delete:${unique}`,
        }
    )).payload.data;
    assert(
        deletedQuotation.capabilityId === 'quotations.delete'
            && deletedQuotation.deleted === 1
            && deletedQuotation.auditId,
        '报价删除没有返回正式命令与强审计回执'
    );
    await request(
        '报价转订单预览',
        'POST',
        `/api/quotations/${quotation.id}/order-draft`,
        {}
    );
    const quotingQuotation = (await request(
        '报价进入报价中',
        'POST',
        `/api/quotations/${quotation.id}/status`,
        {
            status: '报价中',
            expectedUpdatedAt: updatedQuotation.updatedAt,
            idempotencyKey: `quotation-status:${unique}:quoting`,
        }
    )).payload.data;
    assert(
        quotingQuotation.capabilityId === 'quotations.change_status'
            && quotingQuotation.auditId,
        '报价状态变更没有正式命令回执'
    );
    const staleQuotationStatus = (await request(
        '报价状态旧版本拒绝',
        'POST',
        `/api/quotations/${quotation.id}/status`,
        {
            status: '已接受',
            expectedUpdatedAt: updatedQuotation.updatedAt,
            idempotencyKey: `quotation-status-stale:${unique}`,
        },
        [409]
    )).payload;
    assert(
        staleQuotationStatus.code === 'resource_version_conflict',
        '报价状态旧版本没有返回稳定版本冲突'
    );
    await request(
        '报价接受',
        'POST',
        `/api/quotations/${quotation.id}/status`,
        {
            status: '已接受',
            expectedUpdatedAt: quotingQuotation.updatedAt,
            idempotencyKey: `quotation-status:${unique}:accepted`,
        }
    );
    const workflowBeforeConvert = (await request(
        'V8报价转单计划',
        'POST',
        '/api/workbench/execution-plan',
        {
            workflowType: 'quotation_to_order',
            quotationId: quotation.id,
        }
    )).payload.data;
    const conversionStep = workflowBeforeConvert.steps.find(item => item.id === 'convert_quotation');
    assert(workflowBeforeConvert.status === 'ready', '已接受报价未进入可执行计划状态');
    assert(
        conversionStep?.status === 'available'
        && conversionStep?.canExecute === true
        && conversionStep?.confirmation?.toolName === 'execute_factory_workflow_step',
        '报价转单计划没有返回受保护的跨模块执行步骤'
    );
    const failedWorkflowRun = (await request(
        'V8.4记录失败执行',
        'POST',
        '/api/workbench/execution-runs',
        {
            workflowType: 'quotation_to_order',
            subjectType: 'quotation',
            subjectId: quotation.id,
            actionId: 'convert_quotation',
            toolName: 'execute_factory_workflow_step',
            status: 'failed',
            plan: workflowBeforeConvert,
            recheck: workflowBeforeConvert,
            outcomeSummary: '隔离验收模拟失败',
            error: '隔离验收模拟错误',
        },
        [201]
    )).payload.data;
    assert(failedWorkflowRun.status === 'failed', '失败执行记录状态错误');
    const retryPlan = (await request(
        'V8.4失败后恢复计划',
        'POST',
        '/api/workbench/execution-plan',
        {
            workflowType: 'quotation_to_order',
            quotationId: quotation.id,
        }
    )).payload.data;
    assert(
        retryPlan.executionHistory?.recovery?.state === 'retry_available'
        && retryPlan.executionHistory.recovery.recoverableActionIds.includes('convert_quotation'),
        '失败步骤在当前计划仍可执行时没有提供安全恢复'
    );
    const conversionDraft = (await request(
        '报价转订单执行前预览',
        'POST',
        `/api/quotations/${quotation.id}/order-draft`,
        {}
    )).payload.data;
    assert(
        conversionDraft.capabilityId === 'workflow.quotation.convert_to_order'
        && conversionDraft.expectedUpdatedAt
        && conversionDraft.previewHash
        && conversionDraft.suggestedIdempotencyKey,
        '报价转订单预览缺少能力、版本、预览哈希或幂等信息'
    );
    const conversionPayload = {
        idempotencyKey: conversionDraft.suggestedIdempotencyKey,
        expectedUpdatedAt: conversionDraft.expectedUpdatedAt,
        previewHash: conversionDraft.previewHash,
    };
    const converted = (await request(
        '报价转订单',
        'POST',
        `/api/quotations/${quotation.id}/convert`,
        conversionPayload,
        [201]
    )).payload.data;
    assert(
        converted.capabilityId === 'workflow.quotation.convert_to_order'
        && converted.operationId
        && converted.auditIds?.length === 2
        && converted.idempotentReplay === false,
        '报价转订单没有返回完整 operation 与强审计回执'
    );
    const conversionReplay = (await request(
        '报价转订单幂等重放',
        'POST',
        `/api/quotations/${quotation.id}/convert`,
        conversionPayload,
        [201]
    )).payload.data;
    assert(
        conversionReplay.idempotentReplay === true
        && conversionReplay.order?.id === converted.order?.id,
        '报价转订单相同幂等键产生了重复订单'
    );
    const customerContext = (await request(
        '客户正式上下文聚合',
        'GET',
        `/api/customers/${customer.id}/context?keyword=${encodeURIComponent(recipe.name)}&limit=1`
    )).payload.data;
    assert(
        customerContext.customer?.id === customer.id
            && customerContext.quotations?.length === 1
            && customerContext.quotations[0].displaySequence === 1
            && !Object.prototype.hasOwnProperty.call(customerContext.quotations[0], 'id')
            && customerContext.orders?.length === 1
            && customerContext.orders[0].id === converted.order?.id
            && customerContext.provenance?.kind === 'live_business',
        '客户上下文没有从正式客户、报价和订单事实聚合'
    );
    const staleConversion = (await request(
        '报价转订单版本冲突',
        'POST',
        `/api/quotations/${quotation.id}/convert`,
        {
            idempotencyKey: `quotation-convert-stale:${unique}`,
            expectedUpdatedAt: conversionDraft.expectedUpdatedAt,
        },
        [409]
    )).payload;
    assert(
        staleConversion.code === 'resource_version_conflict',
        '报价转订单旧版本没有稳定返回 resource_version_conflict'
    );
    const workflowAfterConvert = (await request(
        'V8转单后计划复查',
        'POST',
        '/api/workbench/execution-plan',
        {
            workflowType: 'quotation_to_order',
            quotationId: quotation.id,
        }
    )).payload.data;
    assert(workflowAfterConvert.status === 'complete', '报价转单后执行计划没有自动完成');
    assert(
        workflowAfterConvert.steps.some(item => item.id === 'quotation_already_converted' && item.status === 'complete'),
        '报价转单后计划缺少防重复完成状态'
    );
    const completedWorkflowRun = (await request(
        'V8.4记录成功执行',
        'POST',
        '/api/workbench/execution-runs',
        {
            workflowType: 'quotation_to_order',
            subjectType: 'quotation',
            subjectId: quotation.id,
            actionId: 'convert_quotation',
            toolName: 'execute_factory_workflow_step',
            status: 'completed',
            plan: workflowBeforeConvert,
            result: { orderId: converted.order.id },
            recheck: workflowAfterConvert,
            outcomeSummary: `报价已转为订单 #${converted.order.id}`,
        },
        [201]
    )).payload.data;
    assert(completedWorkflowRun.attemptNumber === 2, '执行历史尝试次数没有递增');
    const workflowHistory = (await request(
        'V8.4读取执行历史',
        'GET',
        `/api/workbench/execution-runs?workflowType=quotation_to_order&subjectId=${quotation.id}`
    )).payload.data;
    assert(
        workflowHistory.metrics.completedCount === 1
        && workflowHistory.metrics.failedCount === 1
        && workflowHistory.items[0].status === 'completed',
        '执行历史没有正确汇总成功和失败'
    );
    const completedRecoveryPlan = (await request(
        'V8.4完成后防重复计划',
        'POST',
        '/api/workbench/execution-plan',
        {
            workflowType: 'quotation_to_order',
            quotationId: quotation.id,
        }
    )).payload.data;
    assert(
        completedRecoveryPlan.executionHistory?.recovery?.state === 'complete'
        && completedRecoveryPlan.metrics.executableSteps === 0,
        '已完成写操作仍被计划标记为可重复执行'
    );
    const order = (await request(
        '新订单详情',
        'GET',
        `/api/orders/${converted.order.id}`
    )).payload.data;
    const readiness = (await request(
        '订单生产准备检查',
        'GET',
        `/api/orders/${order.id}/readiness`
    )).payload.data;
    assert(
        ['ready', 'waiting_materials', 'needs_review', 'blocked'].includes(readiness.verdict),
        `订单生产准备结论无效: ${readiness.verdict}`
    );
    assert(readiness.steps.length === 6, '订单生产准备检查没有返回完整六步结果');
    assert(readiness.steps.some(item => item.key === 'parts'), '订单生产准备检查缺少零件库存步骤');
    assert(readiness.steps.some(item => item.key === 'coils'), '订单生产准备检查缺少线圈库存步骤');
    const readinessPlan = (await request(
        '订单生产准备处理方案',
        'GET',
        `/api/orders/${order.id}/readiness-plan`
    )).payload.data;
    assert(
        ['complete', 'ready_for_confirmation', 'action_required', 'needs_resolution', 'waiting'].includes(readinessPlan.planStatus),
        `订单处理方案状态无效: ${readinessPlan.planStatus}`
    );
    assert(Array.isArray(readinessPlan.steps), '订单处理方案没有返回步骤数组');
    assert(
        readinessPlan.steps.every((item, index) => Number(item.sequence) === index + 1),
        '订单处理方案步骤顺序不连续'
    );
    const readinessOverview = (await request(
        '订单生产准备总览',
        'GET',
        '/api/orders/readiness-overview'
    )).payload.data;
    assert(
        readinessOverview.metrics.totalActiveOrders === readinessOverview.items.length,
        '订单准备总览汇总数量与明细不一致'
    );
    assert(
        readinessOverview.items.some(item => Number(item.order?.id) === Number(order.id)),
        '订单准备总览没有包含当前活动订单'
    );
    assert(
        readinessOverview.metrics.attentionRequired
            === readinessOverview.metrics.blocked
                + readinessOverview.metrics.waitingMaterials
                + readinessOverview.metrics.needsReview,
        '订单准备总览关注数量计算错误'
    );
    const lookupOrders = (await request(
        '订单只读查询',
        'GET',
        `/api/orders/lookup?query=${encodeURIComponent(order.customerName)}`
    )).payload.data;
    assert(lookupOrders.some(item => Number(item.id) === Number(order.id)), '订单只读查询未返回目标订单');
    const actionRecipe = (await request(
        '新增订单方案执行专用配方',
        'POST',
        '/api/recipes',
        {
            ...baseRecipe,
            id: undefined,
            name: `${unique}-ACTION-RECIPE`,
            naming: { ruleId: 'recipe', spec: { series: unique, configuration: '方案执行' } },
            spec: '订单方案执行自动验收',
            templateId: null,
            modelVariantId: null,
            coilSpec: baseCoil.spec,
            coilSheets: baseCoil.sheets,
            coilId: baseCoil.id,
            coilMaterial: baseCoil.material,
            coilSlotType: baseCoil.slotType,
            coilSchemeFamilyCode: '',
            coilWireWeight: null,
            partsJson: JSON.stringify([{
                name: '深度验收零件',
                model: part.model,
                supplier: part.supplier,
                partId: part.id,
                qty: 1,
                snapshotPrice: 14.56,
            }]),
            assemblyWage: 0,
            packingWage: 0,
            surfaceTreatmentMode: 'none',
            surfaceTreatmentCost: 0,
            managementFee: 0,
            idempotencyKey: `deep:action-recipe-create:${unique}`,
        }
    )).payload.data;
    const pendingOrder = (await request(
        '新增待确认订单用于方案执行',
        'POST',
        '/api/orders',
        {
            customerId: order.customerId,
            customerName: order.customerName,
            contractNo: `${unique}-ACTION`,
            remark: '订单方案执行自动验收',
            items: [{
                recipeId: actionRecipe.id,
                recipeName: actionRecipe.name,
                qty: 20,
                unitCost: 14.56,
                unitPrice: 20,
                partsJson: JSON.stringify([{
                    name: '深度验收零件',
                    model: part.model,
                    supplier: part.supplier,
                    qty: 1,
                    price: 14.56,
                }]),
            }],
        }
    )).payload.data;
    const pendingPlan = (await request(
        '待确认订单处理方案',
        'GET',
        `/api/orders/${pendingOrder.id}/readiness-plan`
    )).payload.data;
    const confirmStep = pendingPlan.steps.find(item => item.id === 'confirm_order');
    assert(
        confirmStep?.mode === 'confirmable' && confirmStep?.status === 'available',
        `待确认订单没有可执行的确认步骤: ${JSON.stringify(confirmStep)}`
    );
    const confirmCommand = pendingPlan.actions?.confirm_order || confirmStep.command;
    assert(
        confirmCommand?.expectedUpdatedAt
            && confirmCommand?.previewHash
            && confirmCommand?.suggestedIdempotencyKey,
        `订单确认步骤缺少正式命令协议: ${JSON.stringify(confirmCommand)}`
    );
    const confirmPayload = {
        idempotencyKey: confirmCommand.suggestedIdempotencyKey,
        expectedUpdatedAt: confirmCommand.expectedUpdatedAt,
        previewHash: confirmCommand.previewHash,
    };
    const actionResult = (await request(
        '执行订单确认步骤',
        'POST',
        `/api/orders/${pendingOrder.id}/readiness-actions/confirm_order`,
        confirmPayload
    )).payload.data;
    assert(actionResult.action?.id === 'confirm_order', '订单方案动作返回了错误的步骤');
    assert(
        ['待采购', '采购中', '采购完成'].includes(actionResult.order?.status),
        `订单确认步骤没有进入采购流程: ${actionResult.order?.status}`
    );
    assert(
        !actionResult.nextPlan?.steps?.some(item => item.id === 'confirm_order'),
        '订单确认后重新检查仍返回确认步骤'
    );
    assert(
        actionResult.capabilityId === 'orders.execute_readiness_action'
            && actionResult.operationId
            && actionResult.auditId
            && actionResult.businessChangeEvent?.primaryDomain === 'order',
        `订单确认步骤缺少正式命令回执: ${JSON.stringify(actionResult)}`
    );
    const businessChangePage = (await request(
        '业务变更中心查询刚完成的订单修改',
        'GET',
        `/api/business-changes?period=all&domain=order&entityType=order&entityId=${pendingOrder.id}`
    )).payload.data;
    assert(
        businessChangePage.items.some(item => (
            item.id === actionResult.businessChangeEvent.id
            && item.capabilityId === 'orders.execute_readiness_action'
        )),
        `业务变更中心没有返回刚完成的订单修改: ${JSON.stringify(businessChangePage)}`
    );
    const replayedAction = (await request(
        '幂等重放订单确认步骤',
        'POST',
        `/api/orders/${pendingOrder.id}/readiness-actions/confirm_order`,
        confirmPayload
    )).payload.data;
    assert(replayedAction.idempotentReplay === true, '订单确认步骤幂等重放未返回原回执');
    await request(
        '重复执行已过期订单步骤',
        'POST',
        `/api/orders/${pendingOrder.id}/readiness-actions/confirm_order`,
        { idempotencyKey: `readiness-stale:${unique}:confirm` },
        [409]
    );
    const purchaseDraft = (await request(
        '采购一键入库正式预览',
        'POST',
        `/api/orders/${pendingOrder.id}/complete-purchase-draft`,
        {}
    )).payload.data;
    assert(
        purchaseDraft.capabilityId === 'purchasing.order.complete_inbound'
            && purchaseDraft.expectedUpdatedAt
            && purchaseDraft.previewHash
            && purchaseDraft.suggestedIdempotencyKey,
        `采购入库预览缺少正式协议字段: ${JSON.stringify(purchaseDraft)}`
    );
    assert(purchaseDraft.additions.length > 0, '采购入库预览没有返回待入库物料');
    const completePurchasePayload = {
        idempotencyKey: purchaseDraft.suggestedIdempotencyKey,
        expectedUpdatedAt: purchaseDraft.expectedUpdatedAt,
        previewHash: purchaseDraft.previewHash,
    };
    const purchaseReceipt = (await request(
        '采购一键入库持久化命令',
        'POST',
        `/api/orders/${pendingOrder.id}/complete-purchase`,
        completePurchasePayload
    )).payload.data;
    assert(purchaseReceipt.order?.status === '采购完成', '采购一键入库没有进入采购完成');
    assert(
        purchaseReceipt.operationId
            && purchaseReceipt.receiptId
            && purchaseReceipt.auditIds?.length >= 2,
        `采购一键入库回执不完整: ${JSON.stringify(purchaseReceipt)}`
    );
    const purchaseReplay = (await request(
        '采购一键入库同键重放',
        'POST',
        `/api/orders/${pendingOrder.id}/complete-purchase`,
        completePurchasePayload
    )).payload.data;
    assert(
        purchaseReplay.idempotentReplay === true
            && purchaseReplay.receiptId === purchaseReceipt.receiptId,
        '采购一键入库重试没有返回原回执'
    );
    await request(
        '采购一键入库旧版本拒绝',
        'POST',
        `/api/orders/${pendingOrder.id}/complete-purchase`,
        {
            ...completePurchasePayload,
            idempotencyKey: `${purchaseDraft.suggestedIdempotencyKey}:stale`,
        },
        [409]
    );
    await request(
        '结束方案执行测试订单',
        'POST',
        `/api/orders/${pendingOrder.id}/status`,
        {
            status: '已关闭',
            inventoryDisposition: 'manual_outbound_confirmed',
            inventoryDispositionNote: '深度验收已核对仓库领用流程',
            expectedUpdatedAt: purchaseReceipt.order.updatedAt,
        }
    );
    const purchaseList = JSON.parse(order.purchaseListJson || '[]');
    const purchaseItem = purchaseList.find(
        item => Number(item.plannedQty || item.needToBuy || 0) > 0
    );
    if (purchaseItem) {
        const plannedQty = Number(purchaseItem.plannedQty || purchaseItem.needToBuy);
        const batchPayload = {
            identityKey: purchaseItem.identityKey,
            model: purchaseItem.model,
            supplier: purchaseItem.supplier,
            purchased: true,
        };
        const batchDraft = (await request(
            '采购中心批量下单正式预览',
            'POST',
            '/api/orders/purchase-items/batch-draft',
            batchPayload
        )).payload.data;
        assert(
            batchDraft.capabilityId === 'purchasing.task.batch_order'
                && batchDraft.expectedVersions?.length > 0
                && batchDraft.previewHash
                && batchDraft.suggestedIdempotencyKey,
            `采购批量下单预览缺少正式协议字段: ${JSON.stringify(batchDraft)}`
        );
        const batchCommand = {
            ...batchPayload,
            idempotencyKey: batchDraft.suggestedIdempotencyKey,
            expectedVersions: batchDraft.expectedVersions,
            previewHash: batchDraft.previewHash,
        };
        const batchReceipt = (await request(
            '采购中心批量下单持久化命令',
            'POST',
            '/api/orders/purchase-items/batch',
            batchCommand
        )).payload.data;
        assert(
            batchReceipt.operationId
                && batchReceipt.updatedCount > 0
                && batchReceipt.auditIds?.length >= batchReceipt.updatedCount,
            `采购批量下单回执不完整: ${JSON.stringify(batchReceipt)}`
        );
        const batchReplay = (await request(
            '采购中心批量下单同键重放',
            'POST',
            '/api/orders/purchase-items/batch',
            batchCommand
        )).payload.data;
        assert(batchReplay.idempotentReplay === true, '采购批量下单重试没有返回原回执');
        const progressPayload = {
            identityKey: purchaseItem.identityKey,
            model: purchaseItem.model,
            supplier: purchaseItem.supplier,
            orderedQty: plannedQty,
            receivedQty: 0,
            stockedQty: 0,
        };
        const progressDraft = (await request(
            '登记采购进度正式预览',
            'POST',
            `/api/orders/${order.id}/purchase-items/progress-draft`,
            progressPayload
        )).payload.data;
        assert(
            progressDraft.capabilityId === 'purchasing.order.item_progress'
                && progressDraft.expectedUpdatedAt
                && progressDraft.previewHash
                && progressDraft.suggestedIdempotencyKey,
            `采购进度预览缺少正式协议字段: ${JSON.stringify(progressDraft)}`
        );
        const progressCommand = {
            ...progressPayload,
            idempotencyKey: progressDraft.suggestedIdempotencyKey,
            expectedUpdatedAt: progressDraft.expectedUpdatedAt,
            previewHash: progressDraft.previewHash,
        };
        const progressReceipt = (await request(
            '登记采购进度持久化命令',
            'POST',
            `/api/orders/${order.id}/purchase-items/progress`,
            progressCommand
        )).payload.data;
        assert(
            progressReceipt.operationId
                && progressReceipt.auditIds?.length >= 1
                && progressReceipt.order?.status === '采购中',
            `采购进度命令回执不完整: ${JSON.stringify(progressReceipt)}`
        );
        const progressReplay = (await request(
            '登记采购进度同键重放',
            'POST',
            `/api/orders/${order.id}/purchase-items/progress`,
            progressCommand
        )).payload.data;
        assert(progressReplay.idempotentReplay === true, '采购进度重试没有返回原回执');
        await request(
            '登记采购进度旧版本拒绝',
            'POST',
            `/api/orders/${order.id}/purchase-items/progress`,
            {
                ...progressCommand,
                idempotencyKey: `${progressDraft.suggestedIdempotencyKey}:stale`,
            },
            [409]
        );
    }
    await request('取消测试订单', 'POST', `/api/orders/${order.id}/status`, {
        status: '已取消',
        reason: '隔离深度验收结束',
    });
    const cancelledReadiness = (await request(
        '已取消订单不再执行生产准备检查',
        'GET',
        `/api/orders/${order.id}/readiness`
    )).payload.data;
    assert(cancelledReadiness.verdict === 'not_applicable', '已取消订单仍被判定为可生产');
    const cancelledPlan = (await request(
        '已取消订单不生成处理方案',
        'GET',
        `/api/orders/${order.id}/readiness-plan`
    )).payload.data;
    assert(cancelledPlan.planStatus === 'not_applicable', '已取消订单仍生成了处理方案');

    const coilInput = {
        spec: baseCoil.spec,
        material: baseCoil.material,
        slotType: baseCoil.slotType,
        sheets: baseCoil.sheets,
        schemeStatus: 'testing',
        unitPrice: baseCoil.unitPrice,
        wireWeight: baseCoil.wireWeight,
        copperBase: baseCoil.copperBase,
        coilFee: baseCoil.coilFee,
        rotorFee: baseCoil.rotorFee,
        defaultWireGauge: baseCoil.defaultWireGauge,
        defaultCapacitor: baseCoil.defaultCapacitor,
    };
    const trackedCoil = (await request('新增线圈方案', 'POST', '/api/coils', {
        ...coilInput,
        schemeName: unique,
    })).payload.data;
    await request('修改线圈方案', 'PATCH', `/api/coils/${trackedCoil.id}`, {
        schemeName: `${unique}-UPDATED`,
    });
    const coilInboundPreview = (await request(
        '线圈库存入库预览',
        'POST',
        '/api/coils/stock-adjustments-preview',
        {
            adjustments: [{ coilId: trackedCoil.id, changeQty: 3 }],
            note: '自动验收',
        }
    )).payload.data;
    await request('线圈库存入库', 'POST', '/api/coils/stock-adjustments', {
        confirmationToken: coilInboundPreview.confirmationToken,
        idempotencyKey: coilInboundPreview.suggestedIdempotencyKey,
    });
    const coilOutboundPreview = (await request(
        '线圈库存出库预览',
        'POST',
        '/api/coils/stock-adjustments-preview',
        {
            adjustments: [{ coilId: trackedCoil.id, changeQty: -1 }],
            note: '自动验收',
        }
    )).payload.data;
    await request('线圈库存出库', 'POST', '/api/coils/stock-adjustments', {
        confirmationToken: coilOutboundPreview.confirmationToken,
        idempotencyKey: coilOutboundPreview.suggestedIdempotencyKey,
    });
    await request('新线圈库存流水', 'GET', `/api/coils/${trackedCoil.id}/stock-movements`);
    const blockedDelete = await request(
        '阻止删除有库存流水的线圈',
        'DELETE',
        `/api/coils/${trackedCoil.id}`,
        undefined,
        [409]
    );
    assert(
        blockedDelete.payload.error.includes('已有库存或库存流水'),
        '线圈删除阻止说明不明确'
    );
    const cleanCoil = (await request('新增无库存线圈方案', 'POST', '/api/coils', {
        ...coilInput,
        schemeName: `${unique}-CLEAN`,
    })).payload.data;
    await request('删除无库存线圈方案', 'DELETE', `/api/coils/${cleanCoil.id}`);

    const conversation = (await request(
        '新增 AI 会话',
        'POST',
        '/api/ai/conversations',
        { title: '自动深度验收' },
        [201]
    )).payload.data;
    const message = (await request(
        '保存 AI 消息',
        'POST',
        `/api/ai/conversations/${conversation.id}/messages`,
        { role: 'user', content: '自动验收消息' },
        [201]
    )).payload.data;
    await request(
        '更新 AI 消息元数据',
        'PATCH',
        `/api/ai/conversations/${conversation.id}/messages/${message.id}`,
        { metadata: { test: true } }
    );
    const assistantMessage = (await request(
        '保存 AI 回答消息',
        'POST',
        `/api/ai/conversations/${conversation.id}/messages`,
        { role: 'assistant', content: '自动验收回答' },
        [201]
    )).payload.data;
    const answerFeedback = (await request(
        '提交 AI 回答反馈',
        'POST',
        '/api/ai/feedback',
        {
            messageId: assistantMessage.id,
            rating: 'incorrect',
            note: '自动验收正确做法',
            learnFromCorrection: true,
            idempotencyKey: `deep:ai-feedback-submit:${unique}`,
        },
        [201]
    )).payload.data;
    await request('读取 AI 会话', 'GET', `/api/ai/conversations/${conversation.id}`);
    await request('删除 AI 会话', 'DELETE', `/api/ai/conversations/${conversation.id}`);
    const feedbackAfterConversationDelete = (await request(
        '原会话删除后读取 AI 回答反馈',
        'GET',
        `/api/ai/feedback?conversationId=${conversation.id}&status=open&limit=5`
    )).payload.data.items.find(item => item.id === answerFeedback.id);
    assert(
        feedbackAfterConversationDelete?.conversationDeleted === true,
        '原会话删除后反馈快照未保留或缺少删除状态'
    );
    const diagnosedFeedback = (await request(
        '原会话删除后诊断 AI 回答反馈',
        'POST',
        `/api/ai/feedback/${answerFeedback.id}/diagnose`,
        {
            expectedUpdatedAt: feedbackAfterConversationDelete.updatedAt,
            idempotencyKey: `deep:ai-feedback-diagnose:${unique}`,
        }
    )).payload.data;
    assert(diagnosedFeedback.conversationDeleted === true, '诊断结果丢失原会话删除状态');
    await request(
        '原会话删除后禁止新增 AI 回答反馈',
        'POST',
        '/api/ai/feedback',
        {
            messageId: assistantMessage.id,
            rating: 'outdated',
            idempotencyKey: `deep:ai-feedback-resubmit:${unique}`,
        },
        [404]
    );
    const reviewedFeedback = (await request(
        '原会话删除后处理 AI 回答反馈',
        'PATCH',
        `/api/ai/feedback/${answerFeedback.id}`,
        {
            status: 'resolved',
            resolutionNote: '自动验收完成',
            expectedUpdatedAt: diagnosedFeedback.updatedAt,
            idempotencyKey: `deep:ai-feedback-review:${unique}`,
        }
    )).payload.data;
    assert(
        reviewedFeedback.status === 'resolved' && reviewedFeedback.conversationDeleted === true,
        '原会话删除后反馈未能完成处理'
    );

    const documentText = `型号 ${unique}\n泵壳材料 304\n叶轮直径 120mm`;
    const factoryFileForm = new FormData();
    factoryFileForm.set('file', new Blob([documentText], { type: 'text/markdown' }), `${unique}.md`);
    const factoryFile = (await requestForm(
        'V9.1统一文件上传',
        '/api/files',
        factoryFileForm,
        [201]
    )).payload.data;
    assert(factoryFile.detectedType === 'text', '统一文件没有识别为文本');
    assert(factoryFile.parserStatus === 'pending', '统一文件不应伪装成已解析');

    const duplicateFileForm = new FormData();
    duplicateFileForm.set('file', new Blob([documentText], { type: 'application/octet-stream' }), `${unique}-副本.md`);
    const duplicateFileResponse = (await requestForm(
        'V9.1统一文件哈希去重',
        '/api/files',
        duplicateFileForm,
        [200]
    )).payload;
    assert(
        duplicateFileResponse.deduplicated === true
            && duplicateFileResponse.data.id === factoryFile.id
            && duplicateFileResponse.data.duplicateCount === 2,
        '相同文件没有复用统一文件对象'
    );
    const factoryFiles = (await request(
        'V9.1统一文件列表',
        'GET',
        '/api/files?detectedType=text&limit=100'
    )).payload.data;
    assert(factoryFiles.some(item => item.id === factoryFile.id), '统一文件列表缺少上传文件');
    const unifiedDownload = await requestDownload(
        'V9.1下载统一原文件',
        `/api/files/${factoryFile.id}/download`
    );
    assert(unifiedDownload.equals(Buffer.from(documentText)), '统一文件下载内容不一致');

    const disguisedPdfForm = new FormData();
    disguisedPdfForm.set('file', new Blob(['not a pdf'], { type: 'application/pdf' }), `${unique}.pdf`);
    await requestForm('V9.1拒绝扩展名伪装', '/api/files', disguisedPdfForm, [400]);

    const pdfBuffer = buildPdfBuffer([
        [
            { text: `Pump ${unique}`, x: 72, y: 740 },
            { text: 'Flow', x: 72, y: 700 },
            { text: 'Head', x: 220, y: 700 },
            { text: '10', x: 72, y: 680 },
            { text: '35', x: 220, y: 680 },
        ],
        [
            { text: 'Result PASS', x: 72, y: 740 },
        ],
    ]);
    const pdfForm = new FormData();
    pdfForm.set('file', new Blob([pdfBuffer], { type: 'application/pdf' }), `${unique}-report.pdf`);
    const pdfUploadResponse = (await requestForm(
        'V9.2 PDF上传自动解析',
        '/api/files',
        pdfForm,
        [201]
    )).payload;
    const pdfFile = pdfUploadResponse.data;
    assert(pdfFile.detectedType === 'pdf', 'PDF 没有识别为 PDF');
    assert(
        pdfFile.parserStatus === 'parsed',
        `PDF 上传后没有完成文字层解析: ${JSON.stringify({
            parserStatus: pdfFile.parserStatus,
            parserError: pdfFile.parserError,
            parseWarning: pdfUploadResponse.parseWarning,
        })}`
    );
    assert(pdfFile.parserSummary?.pageCount === 2, 'PDF 页数摘要不正确');
    const pdfContent = (await request(
        'V9.2 PDF按页读取解析结果',
        'GET',
        `/api/files/${pdfFile.id}/content`
    )).payload.data;
    assert(pdfContent.parsedText.includes('【第 1 页】'), 'PDF 全文缺少第 1 页定位');
    assert(pdfContent.parsedText.includes('【第 2 页】'), 'PDF 全文缺少第 2 页定位');
    assert(pdfContent.parsed.pages[0].tables[0].rows.length === 2, 'PDF 表格行没有保留');
    const reparsedPdf = (await request(
        'V9.2 PDF手动重试解析',
        'POST',
        `/api/files/${pdfFile.id}/parse`,
        {}
    )).payload.data;
    assert(reparsedPdf.parserStatus === 'parsed', 'PDF 手动重试后状态不正确');

    const orderRequirementArchive = (await archiveFactoryFile(
        'V10.2订单绑定客户要求文件',
        pdfFile.id,
        {
            targetType: 'order',
            targetId: order.id,
            source: 'business_page',
        },
        [201]
    )).payload.data;
    assert(
        orderRequirementArchive.link.relationRole === 'customer_requirement',
        '订单客户要求文件关联角色不正确'
    );
    const emptyRequirement = (await request(
        'V10.2读取空客户要求',
        'GET',
        `/api/orders/${order.id}/requirements`
    )).payload.data;
    assert(emptyRequirement.knowledgeStatus === 'not_confirmed', '空客户要求知识状态不正确');
    assert(
        emptyRequirement.availableFiles.some(file => file.id === pdfFile.id),
        '客户要求接口没有返回当前订单附件'
    );
    const firstRequirementText = `客户明确要求：${unique}-REQ-A 包装标签。`;
    const secondRequirementText = `客户明确要求：${unique}-REQ-B 包装标签。`;
    const requirementDraft = (await request(
        'V10.2保存客户要求草稿',
        'PUT',
        `/api/orders/${order.id}/requirements/draft`,
        {
            summaryText: firstRequirementText,
            sourceFileIds: [pdfFile.id],
        }
    )).payload.data;
    assert(requirementDraft.knowledgeStatus === 'not_confirmed', '草稿被错误标记为正式知识');
    const confirmedRequirement = (await request(
        'V10.2人工确认客户要求',
        'POST',
        `/api/orders/${order.id}/requirements/confirm`,
        {}
    )).payload.data;
    assert(confirmedRequirement.knowledgeStatus === 'confirmed', '客户要求确认状态不正确');
    await syncKnowledge('V10.2同步确认客户要求知识');
    const requirementKnowledge = (await request(
        'V10.2检索确认客户要求',
        'GET',
        `/api/knowledge?query=${encodeURIComponent(`${unique}-REQ-A`)}&entryType=order&limit=10`
    )).payload.data;
    assert(requirementKnowledge.length === 1, '确认的客户要求没有进入订单知识');
    const requirementKnowledgeDetail = (await request(
        'V10.2读取客户要求知识详情',
        'GET',
        `/api/knowledge/${requirementKnowledge[0].id}`
    )).payload.data;
    assert(
        requirementKnowledgeDetail.content.includes(`${unique}-REQ-A`),
        '订单知识详情缺少人工确认客户要求'
    );
    const changedRequirement = (await request(
        'V10.2修改已确认后的草稿',
        'PUT',
        `/api/orders/${order.id}/requirements/draft`,
        {
            summaryText: secondRequirementText,
            sourceFileIds: [pdfFile.id],
        }
    )).payload.data;
    assert(
        changedRequirement.knowledgeStatus === 'confirmed_with_draft',
        '修改草稿后没有保留上次确认状态'
    );
    await syncKnowledge('V10.2同步待确认草稿');
    const knowledgeBeforeReconfirm = (await request(
        'V10.2复核待确认草稿未覆盖知识',
        'GET',
        `/api/knowledge/${requirementKnowledge[0].id}`
    )).payload.data;
    assert(
        knowledgeBeforeReconfirm.content.includes(`${unique}-REQ-A`)
            && !knowledgeBeforeReconfirm.content.includes(`${unique}-REQ-B`),
        '待确认草稿错误覆盖了上次确认知识'
    );
    await request(
        'V10.2重新确认客户要求',
        'POST',
        `/api/orders/${order.id}/requirements/confirm`,
        {}
    );
    await syncKnowledge('V10.2同步新确认客户要求');
    const knowledgeAfterReconfirm = (await request(
        'V10.2复核新确认客户要求',
        'GET',
        `/api/knowledge/${requirementKnowledge[0].id}`
    )).payload.data;
    assert(
        knowledgeAfterReconfirm.content.includes(`${unique}-REQ-B`)
            && !knowledgeAfterReconfirm.content.includes(`${unique}-REQ-A`),
        '重新确认后订单知识没有替换旧客户要求'
    );
    await deleteFactoryFileLink(
        'V10.2阻止解除已确认来源文件',
        pdfFile.id,
        orderRequirementArchive.link,
        [409]
    );
    const executionEvidenceArchive = (await archiveFactoryFile(
        'V10.3订单绑定执行依据文件',
        pdfFile.id,
        {
            targetType: 'order',
            targetId: order.id,
            relationRole: 'execution_evidence',
            source: 'business_page',
        },
        [201]
    )).payload.data;
    assert(
        executionEvidenceArchive.link.relationRole === 'execution_evidence',
        '订单执行依据文件关联角色不正确'
    );
    const firstExecutionText = `已完成 ${unique}-EXEC-A 首批物料检查。`;
    const secondExecutionText = `因供应商延期，人工决定执行 ${unique}-EXEC-B 备用供应方案。`;
    const executionDraft = (await request(
        'V10.3新建订单执行事实草稿',
        'POST',
        `/api/orders/${order.id}/execution-records`,
        {
            phase: 'pre_production',
            recordType: 'material_preparation',
            title: '首批物料检查完成',
            summaryText: firstExecutionText,
            occurredAt: '2026-07-30T09:00:00.000Z',
            sourceFileIds: [pdfFile.id],
        }
    )).payload.data;
    assert(executionDraft.knowledgeStatus === 'not_confirmed', '执行事实草稿被错误标记为正式知识');
    const confirmedExecution = (await request(
        'V10.3人工确认执行事实',
        'POST',
        `/api/orders/${order.id}/execution-records/${executionDraft.id}/confirm`,
        {}
    )).payload.data;
    assert(confirmedExecution.knowledgeStatus === 'confirmed', '执行事实确认状态不正确');
    await syncKnowledge('V10.3同步确认执行事实知识');
    const executionKnowledge = (await request(
        'V10.3检索确认执行事实',
        'GET',
        `/api/knowledge?query=${encodeURIComponent(`${unique}-EXEC-A`)}&entryType=order&limit=10`
    )).payload.data;
    assert(executionKnowledge.length === 1, '确认的执行事实没有进入订单知识');
    const changedExecution = (await request(
        'V10.3修改已确认执行事实草稿',
        'PUT',
        `/api/orders/${order.id}/execution-records/${executionDraft.id}/draft`,
        {
            phase: 'in_production',
            recordType: 'supplier_adjustment',
            title: '供应商临时调整',
            summaryText: secondExecutionText,
            occurredAt: '2026-07-30T10:00:00.000Z',
            sourceFileIds: [pdfFile.id],
        }
    )).payload.data;
    assert(
        changedExecution.knowledgeStatus === 'confirmed_with_draft',
        '修改执行事实草稿后没有保留上次确认状态'
    );
    await syncKnowledge('V10.3同步待确认执行事实草稿');
    const executionBeforeReconfirm = (await request(
        'V10.3复核待确认执行事实未覆盖知识',
        'GET',
        `/api/knowledge/${executionKnowledge[0].id}`
    )).payload.data;
    assert(
        executionBeforeReconfirm.content.includes(`${unique}-EXEC-A`)
            && !executionBeforeReconfirm.content.includes(`${unique}-EXEC-B`),
        '待确认执行事实草稿错误覆盖了上次确认知识'
    );
    await request(
        'V10.3重新确认执行事实',
        'POST',
        `/api/orders/${order.id}/execution-records/${executionDraft.id}/confirm`,
        {}
    );
    await syncKnowledge('V10.3同步新确认执行事实');
    const executionAfterReconfirm = (await request(
        'V10.3复核新确认执行事实',
        'GET',
        `/api/knowledge/${executionKnowledge[0].id}`
    )).payload.data;
    assert(
        executionAfterReconfirm.content.includes(`${unique}-EXEC-B`)
            && !executionAfterReconfirm.content.includes(`${unique}-EXEC-A`),
        '重新确认后订单知识没有替换旧执行事实'
    );
    const orderKnowledgePackage = (await request(
        'V10.4读取订单知识包',
        'GET',
        `/api/orders/${order.id}/knowledge-package`
    )).payload.data;
    assert(orderKnowledgePackage.order.id === order.id, '订单知识包没有返回目标订单');
    assert(
        orderKnowledgePackage.confirmedKnowledge.customerRequirement.text.includes(`${unique}-REQ-B`),
        '订单知识包缺少人工确认客户要求'
    );
    assert(
        orderKnowledgePackage.confirmedKnowledge.executionRecords.some(item => (
            item.text.includes(`${unique}-EXEC-B`)
        )),
        '订单知识包缺少人工确认执行事实'
    );
    assert(
        orderKnowledgePackage.provenance.liveBusiness.kind === 'live_business'
            && orderKnowledgePackage.provenance.confirmedKnowledge.kind === 'human_confirmed'
            && orderKnowledgePackage.provenance.confirmedKnowledge.draftsExcluded === true,
        '订单知识包没有区分实时业务数据和人工确认事实'
    );
    assert(
        orderKnowledgePackage.sourceFiles.some(file => (
            file.id === pdfFile.id && file.relationRole === 'customer_requirement'
        ))
            && orderKnowledgePackage.sourceFiles.some(file => (
                file.id === pdfFile.id && file.relationRole === 'execution_evidence'
            )),
        '订单知识包来源文件角色不完整'
    );
    const revokedRequirement = (await request(
        'V10.2撤销客户要求知识确认',
        'POST',
        `/api/orders/${order.id}/requirements/revoke`,
        {}
    )).payload.data;
    assert(
        revokedRequirement.knowledgeStatus === 'not_confirmed'
            && revokedRequirement.draftText === secondRequirementText,
        '撤销确认后没有保留客户要求草稿'
    );
    await syncKnowledge('V10.2同步撤销客户要求知识');
    const knowledgeAfterRevoke = (await request(
        'V10.2复核撤销后移除客户要求',
        'GET',
        `/api/knowledge/${requirementKnowledge[0].id}`
    )).payload.data;
    assert(
        !knowledgeAfterRevoke.content.includes(`${unique}-REQ-A`)
            && !knowledgeAfterRevoke.content.includes(`${unique}-REQ-B`),
        '撤销确认后订单知识仍保留客户要求'
    );
    await deleteFactoryFileLink(
        'V10.3阻止解除执行事实来源文件',
        pdfFile.id,
        executionEvidenceArchive.link,
        [409]
    );
    const revokedExecution = (await request(
        'V10.3撤销执行事实知识确认',
        'POST',
        `/api/orders/${order.id}/execution-records/${executionDraft.id}/revoke`,
        {}
    )).payload.data;
    assert(
        revokedExecution.knowledgeStatus === 'not_confirmed'
            && revokedExecution.draftText === secondExecutionText,
        '撤销确认后没有保留执行事实草稿'
    );
    await request(
        'V10.3删除未确认执行事实草稿',
        'DELETE',
        `/api/orders/${order.id}/execution-records/${executionDraft.id}`
    );
    const executionArchive = (await request(
        'V10.3复核执行事实时间线',
        'GET',
        `/api/orders/${order.id}/execution-records`
    )).payload.data;
    assert(executionArchive.records.length === 0, '已删除执行事实草稿仍出现在时间线');
    await deleteFactoryFileLink(
        'V10.3撤销后解除执行依据文件关联',
        pdfFile.id,
        executionEvidenceArchive.link
    );
    await deleteFactoryFileLink(
        'V10.2撤销后解除订单文件关联',
        pdfFile.id,
        orderRequirementArchive.link
    );

    const imageCanvas = createCanvas(1600, 600);
    const imageContext = imageCanvas.getContext('2d');
    imageContext.fillStyle = '#ffffff';
    imageContext.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
    imageContext.fillStyle = '#111111';
    imageContext.font = 'bold 72px sans-serif';
    imageContext.fillText('PUMP DRAWING', 70, 120);
    imageContext.font = '60px sans-serif';
    imageContext.fillText('Voltage: 220V  Frequency: 60Hz', 70, 270);
    imageContext.fillText('Diameter: 35 mm', 70, 410);
    const imageBuffer = imageCanvas.toBuffer('image/png');
    const imageForm = new FormData();
    imageForm.set('file', new Blob([imageBuffer], { type: 'image/png' }), `${unique}-drawing.png`);
    const imageFile = (await requestForm(
        'V9.4 图片上传自动 OCR',
        '/api/files',
        imageForm,
        [201]
    )).payload.data;
    assert(imageFile.parserStatus === 'parsed', '图片上传后没有完成 OCR');
    assert(imageFile.parserSummary.ocrApplied === true, '图片没有记录 OCR 状态');
    assert(imageFile.parserSummary.drawingCandidateCount >= 2, '图片没有生成技术参数候选');
    const imageContent = (await request(
        'V9.4 图片读取 OCR 结果',
        'GET',
        `/api/files/${imageFile.id}/content`
    )).payload.data;
    assert(imageContent.parsedText.includes('220V'), '图片 OCR 缺少电压文字');
    assert(
        imageContent.parsed.drawingCandidates.some(
            candidate => candidate.type === 'diameter' && candidate.value === '35'
        ),
        '图片 OCR 没有保留直径候选'
    );

    const rasterImage = await loadImage(imageBuffer);
    const scannedDocument = new PDFDocument();
    const scannedPage = scannedDocument.beginPage(800, 300);
    scannedPage.drawImage(rasterImage, 0, 0, 800, 300);
    scannedDocument.endPage();
    const scannedPdfBuffer = scannedDocument.close();
    const scannedPdfForm = new FormData();
    scannedPdfForm.set(
        'file',
        new Blob([scannedPdfBuffer], { type: 'application/pdf' }),
        `${unique}-scanned.pdf`
    );
    const scannedPdfFile = (await requestForm(
        'V9.4 扫描 PDF 自动 OCR',
        '/api/files',
        scannedPdfForm,
        [201]
    )).payload.data;
    assert(scannedPdfFile.parserStatus === 'parsed', '扫描 PDF 上传后没有完成 OCR');
    assert(scannedPdfFile.parserSummary.ocrApplied === true, '扫描 PDF 没有记录 OCR 状态');
    const scannedPdfContent = (await request(
        'V9.4 扫描 PDF 按页读取 OCR',
        'GET',
        `/api/files/${scannedPdfFile.id}/content`
    )).payload.data;
    assert(scannedPdfContent.parsedText.includes('【第 1 页 OCR】'), '扫描 PDF 缺少 OCR 页码');
    assert(scannedPdfContent.parsedText.includes('60Hz'), '扫描 PDF OCR 缺少频率文字');

    const quotationWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
        quotationWorkbook,
        XLSX.utils.aoa_to_sheet([
            ['客户名称', customer.name],
            ['报价编号', `${unique}-QUOTE-FILE`],
            ['产品型号', '规格', '数量', '单价', '金额'],
            [recipe.name, recipe.spec || '', 30, 295, 8_850],
        ]),
        '客户报价'
    );
    const quotationWorkbookBuffer = XLSX.write(
        quotationWorkbook,
        { type: 'buffer', bookType: 'xlsx' }
    );
    const spreadsheetForm = new FormData();
    spreadsheetForm.set(
        'file',
        new Blob([quotationWorkbookBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${unique}-quotation.xlsx`
    );
    const spreadsheetFile = (await requestForm(
        'V9.3 Excel上传自动解析',
        '/api/files',
        spreadsheetForm,
        [201]
    )).payload.data;
    assert(spreadsheetFile.parserStatus === 'parsed', 'Excel 上传后没有完成表格解析');
    assert(spreadsheetFile.parserSummary.sheetCount === 1, 'Excel 工作表摘要不正确');
    assert(spreadsheetFile.parserSummary.rowCount === 4, 'Excel 行数摘要不正确');
    const spreadsheetContent = (await request(
        'V9.3 Excel读取解析结果',
        'GET',
        `/api/files/${spreadsheetFile.id}/content`
    )).payload.data;
    assert(spreadsheetContent.parsedText.includes('【工作表：客户报价】'), 'Excel 全文缺少工作表定位');
    assert(spreadsheetContent.parsedText.includes('[第 4 行]'), 'Excel 全文缺少行号定位');
    const quotationCountBeforeFileDraft = (await request(
        'V9.3 报价文件草稿前读取报价',
        'GET',
        '/api/quotations'
    )).payload.data.length;
    const quotationFileDraft = (await request(
        'V9.3 报价文件生成映射草稿',
        'POST',
        `/api/files/${spreadsheetFile.id}/quotation-draft`,
        {}
    )).payload.data;
    assert(quotationFileDraft.customerMatch.status === 'matched', '报价文件客户没有精确匹配');
    assert(quotationFileDraft.items[0].recipeMatch.status === 'matched', '报价文件配方没有精确匹配');
    assert(quotationFileDraft.items[0].source.rowNumber === 4, '报价文件没有保留原始行号');
    assert(quotationFileDraft.summary.readyForSaveDraft === true, '报价文件未生成可复核草稿输入');
    assert(quotationFileDraft.quotationDraftInput.items[0].qty === 30, '报价文件数量映射错误');
    const quotationCountAfterFileDraft = (await request(
        'V9.3 报价文件草稿后读取报价',
        'GET',
        '/api/quotations'
    )).payload.data.length;
    assert(
        quotationCountAfterFileDraft === quotationCountBeforeFileDraft,
        '报价文件草稿不应创建正式报价'
    );

    const archiveTargets = (await request(
        'V9.5查找配方归档目标',
        'GET',
        `/api/files/archive-targets?targetType=recipe&query=${encodeURIComponent(recipe.name)}`
    )).payload.data;
    assert(
        archiveTargets.length === 1 && archiveTargets[0].id === recipe.id,
        '文件归档没有找到唯一真实配方'
    );
    const recipeArchive = (await archiveFactoryFile(
        'V9.5归档报价文件到配方',
        spreadsheetFile.id,
        {
            targetType: 'recipe',
            targetId: recipe.id,
            note: '深度 API 归档验收',
            source: 'manual',
        },
        [201]
    )).payload.data;
    assert(recipeArchive.link.relationRole === 'technical_reference', '配方文件关联角色不正确');
    const recipeFileLinks = (await request(
        'V9.5按配方读取文件关联',
        'GET',
        `/api/files/links?targetType=recipe&targetId=${recipe.id}`
    )).payload.data;
    assert(
        recipeFileLinks.some(link => link.id === recipeArchive.link.id && link.file.id === spreadsheetFile.id),
        '配方没有返回归档文件'
    );
    const customerArchive = (await archiveFactoryFile(
        'V9业务页归档文件到客户',
        spreadsheetFile.id,
        {
            targetType: 'customer',
            targetId: customer.id,
            title: `${unique}-客户附件`,
            source: 'business_page',
        },
        [201]
    )).payload.data;
    assert(
        customerArchive.link.relationRole === 'attachment'
            && customerArchive.link.source === 'business_page',
        '客户业务页文件关联属性不正确'
    );
    const quotationArchive = (await archiveFactoryFile(
        'V9业务页归档文件到报价',
        spreadsheetFile.id,
        {
            targetType: 'quotation',
            targetId: quotation.id,
            title: `${unique}-报价附件`,
            source: 'business_page',
        },
        [201]
    )).payload.data;
    assert(
        quotationArchive.link.relationRole === 'quotation_source'
            && quotationArchive.link.source === 'business_page',
        '报价业务页文件关联属性不正确'
    );
    const customerFileLinks = (await request(
        'V9按客户读取业务附件',
        'GET',
        `/api/files/links?targetType=customer&targetId=${customer.id}`
    )).payload.data;
    assert(
        customerFileLinks.some(link => link.id === customerArchive.link.id && link.file.id === spreadsheetFile.id),
        '客户业务页没有返回归档文件'
    );
    const quotationFileLinks = (await request(
        'V9按报价读取业务附件',
        'GET',
        `/api/files/links?targetType=quotation&targetId=${quotation.id}`
    )).payload.data;
    assert(
        quotationFileLinks.some(link => link.id === quotationArchive.link.id && link.file.id === spreadsheetFile.id),
        '报价业务页没有返回归档文件'
    );
    await request(
        'V9.5阻止删除仍有关联的文件',
        'DELETE',
        `/api/files/${spreadsheetFile.id}`,
        undefined,
        [409]
    );

    const knowledgeArchiveTitle = `${unique}-归档PDF资料`;
    const knowledgeArchive = (await archiveFactoryFile(
        'V9.5归档 PDF 到知识库',
        pdfFile.id,
        {
            targetType: 'knowledge_document',
            title: knowledgeArchiveTitle,
            documentType: 'other',
            tags: [unique, '归档验收'],
            note: '统一文件归档生成',
            source: 'manual',
        },
        [201]
    )).payload.data;
    assert(knowledgeArchive.knowledgeDocument?.id > 0, '知识库归档没有创建知识资料');
    const duplicateKnowledgeArchive = (await archiveFactoryFile(
        'V9.5知识库归档去重',
        pdfFile.id,
        {
            targetType: 'knowledge_document',
            title: `${knowledgeArchiveTitle}-重复`,
            source: 'manual',
        },
        [200]
    )).payload;
    assert(
        duplicateKnowledgeArchive.deduplicated === true
            && duplicateKnowledgeArchive.data.knowledgeDocument.id === knowledgeArchive.knowledgeDocument.id,
        '同一文件重复归档没有复用知识资料'
    );

    const documentForm = new FormData();
    documentForm.set('documentType', 'technical_note');
    documentForm.set('title', `${unique} 技术资料`);
    documentForm.set('description', '深度 API 自动验收');
    documentForm.set('contentText', '技术参数由自动验收生成');
    documentForm.set('tags', JSON.stringify([unique, '技术资料']));
    documentForm.set('idempotencyKey', `deep:knowledge-document-upload:${unique}`);
    documentForm.set('file', new Blob([documentText], { type: 'text/markdown' }), `${unique}.md`);
    const document = (await requestForm(
        '导入工厂资料',
        '/api/knowledge/documents',
        documentForm,
        [201]
    )).payload.data;
    assert(document.parserStatus === 'parsed', '文本资料没有完成解析');
    assert(document.downloadPath, '工厂资料没有下载地址');
    assert(document.fileId === factoryFile.id, '知识资料没有复用统一文件对象');
    const linkedFactoryFile = (await request(
        'V9.1统一文件解析状态升级',
        'GET',
        `/api/files/${factoryFile.id}`
    )).payload.data;
    assert(linkedFactoryFile.parserStatus === 'parsed', '统一文件没有同步已完成的解析状态');
    const documents = (await request(
        '工厂资料列表',
        'GET',
        '/api/knowledge/documents'
    )).payload.data;
    assert(documents.some(item => item.id === document.id), '工厂资料列表缺少新资料');

    await syncKnowledge('知识增量同步');
    const syncHistory = (await request(
        '手动知识同步历史',
        'GET',
        '/api/knowledge/sync-runs?limit=10'
    )).payload.data;
    assert(
        syncHistory.items.some(run => run.mode === 'manual' && run.status === 'success'),
        '人工同步成功后没有生成同步历史'
    );
    const recoveredHealth = (await request(
        '人工恢复后知识健康',
        'GET',
        '/api/knowledge/health'
    )).payload.data;
    assert(
        recoveredHealth.status === 'healthy' && recoveredHealth.needsRecovery === false,
        `人工同步后健康状态未恢复: ${JSON.stringify(recoveredHealth)}`
    );
    const overview = (await request(
        '同步后知识概况',
        'GET',
        '/api/knowledge/overview'
    )).payload.data;
    assert(
        overview.stats.pendingTotal === 0,
        `同步后仍有 ${overview.stats.pendingTotal} 条知识待处理`
    );
    const documentKnowledge = (await request(
        '检索工厂资料知识',
        'GET',
        `/api/knowledge?query=${encodeURIComponent(unique)}&entryType=document&limit=10`
    )).payload.data;
    assert(
        documentKnowledge.some(item => String(item.sourceId) === String(document.id)),
        '独立工厂资料没有生成知识条目'
    );
    const archivedFileKnowledge = (await request(
        'V9.5检索归档文件知识',
        'GET',
        `/api/knowledge?query=${encodeURIComponent(knowledgeArchiveTitle)}&entryType=document&limit=10`
    )).payload.data;
    assert(
        archivedFileKnowledge.some(
            item => String(item.sourceId) === String(knowledgeArchive.knowledgeDocument.id)
        ),
        '归档文件没有进入知识检索'
    );
    const documentDetail = (await request(
        '工厂资料知识详情',
        'GET',
        `/api/knowledge/${documentKnowledge[0].id}`
    )).payload.data;
    assert(documentDetail.content.includes('泵壳材料 304'), '工厂资料提取文本没有进入知识详情');
    const downloaded = await requestDownload('下载工厂资料原件', document.downloadPath);
    assert(downloaded.equals(Buffer.from(documentText)), '工厂资料下载内容与上传内容不一致');
    await deleteFactoryFileLink(
        'V9.5解除配方文件关联',
        spreadsheetFile.id,
        recipeArchive.link
    );
    await deleteFactoryFileLink(
        'V9解除客户文件关联',
        spreadsheetFile.id,
        customerArchive.link
    );
    await deleteFactoryFileLink(
        'V9解除报价文件关联',
        spreadsheetFile.id,
        quotationArchive.link
    );
    await deleteFactoryFileLink(
        'V9.5解除知识资料文件关联',
        pdfFile.id,
        knowledgeArchive.link
    );
    await request(
        'V9.5删除归档知识资料',
        'DELETE',
        `/api/knowledge/documents/${knowledgeArchive.knowledgeDocument.id}`,
        {
            expectedUpdatedAt: knowledgeArchive.knowledgeDocument.updatedAt,
            idempotencyKey: `deep:knowledge-document-delete:archive:${unique}`,
        }
    );
    await request(
        '删除工厂资料',
        'DELETE',
        `/api/knowledge/documents/${document.id}`,
        {
            expectedUpdatedAt: document.updatedAt,
            idempotencyKey: `deep:knowledge-document-delete:direct:${unique}`,
        }
    );
    await request('删除未引用统一文件', 'DELETE', `/api/files/${factoryFile.id}`);
    await request('删除 PDF 验收文件', 'DELETE', `/api/files/${pdfFile.id}`);
    await request('删除图片 OCR 验收文件', 'DELETE', `/api/files/${imageFile.id}`);
    await request('删除扫描 PDF OCR 验收文件', 'DELETE', `/api/files/${scannedPdfFile.id}`);
    await request('删除 Excel 验收文件', 'DELETE', `/api/files/${spreadsheetFile.id}`);
    await syncKnowledge('删除资料后同步知识');
    const removedDocumentKnowledge = (await request(
        '确认工厂资料知识移除',
        'GET',
        `/api/knowledge?query=${encodeURIComponent(unique)}&entryType=document&limit=10`
    )).payload.data;
    assert(removedDocumentKnowledge.length === 0, '删除资料后对应知识仍然存在');

    await request('删除测试配方', 'DELETE', `/api/recipes/${recipe.id}`);
    const variantDeleteInput = {
        expectedUpdatedAt: updatedVariant.updatedAt,
        idempotencyKey: `deep:model-variant-delete:${unique}`,
    };
    const variantDelete = (await request(
        '删除型号配置',
        'DELETE',
        `/api/model-variants/${variant.id}`,
        variantDeleteInput
    )).payload.data;
    assert(variantDelete.capabilityId === 'model_variants.delete', '删除型号配置缺少正式 capability 回执');
    const variantDeleteReplay = (await request(
        '重放删除型号配置',
        'DELETE',
        `/api/model-variants/${variant.id}`,
        variantDeleteInput
    )).payload.data;
    assert(variantDeleteReplay.idempotentReplay === true, '删除型号配置重放未命中持久幂等回执');
    await request(
        '阻止删除仍有历史配方引用的模板',
        'DELETE',
        `/api/templates/${template.id}`,
        {
            expectedUpdatedAt: updatedTemplate.updatedAt,
            idempotencyKey: `deep:template-delete-blocked:${unique}`,
        },
        [409]
    );
    const cleanTemplate = await createBundleTemplate(unique, '-CLEAN');
    const templateDelete = (await request(
        '删除无引用模板正式命令',
        'DELETE',
        `/api/templates/${cleanTemplate.id}`,
        {
            expectedUpdatedAt: cleanTemplate.updatedAt,
            idempotencyKey: `deep:template-delete:${unique}`,
        }
    )).payload.data;
    assert(templateDelete.capabilityId === 'templates.delete', '删除模板缺少正式 capability 回执');
    assert(templateDelete.auditId, '删除模板缺少强审计回执');
    const partBeforeDelete = (await request(
        '删除零件读取资源版本',
        'GET',
        '/api/parts'
    )).payload.data.find(item => item.id === part.id);
    const partDeletePreview = (await request(
        '生成测试零件删除预览',
        'POST',
        `/api/parts/${part.id}/delete-preview`,
        { expectedUpdatedAt: partBeforeDelete.updatedAt }
    )).payload.data;
    assert(partDeletePreview.preview === true, '零件删除预览未声明 preview=true');
    assert(partDeletePreview.previewHash, '零件删除预览缺少 previewHash');
    const partDeleteReceipt = (await request(
        '删除测试零件正式命令',
        'DELETE',
        `/api/parts/${part.id}`,
        {
            expectedUpdatedAt: partBeforeDelete.updatedAt,
            previewHash: partDeletePreview.previewHash,
            idempotencyKey: `deep:part-delete:${unique}`,
        }
    )).payload.data;
    assert(partDeleteReceipt.capabilityId === 'parts.delete', '删除零件缺少正式 capability 回执');
    assert(partDeleteReceipt.auditId, '删除零件缺少强审计回执');
    await request('删除测试客户', 'DELETE', `/api/customers/${customer.id}`);
}

async function run() {
    const tempPrefix = DEEP_API_SCOPE === 'mcp' ? 'pump-mcp-local-' : 'pump-deep-test-';
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), tempPrefix));
    let childErrors = '';
    try {
        fs.cpSync(path.join(root, 'api'), path.join(temp, 'api'), { recursive: true });
        fs.cpSync(path.join(root, 'shared'), path.join(temp, 'shared'), { recursive: true });
        fs.copyFileSync(path.join(root, 'api.cjs'), path.join(temp, 'api.cjs'));
        fs.mkdirSync(path.join(temp, 'public', 'drawings'), { recursive: true });
        if (!fs.existsSync(sourceDatabasePath)) {
            throw new Error(`深度 API 测试源数据库不存在: ${sourceDatabasePath}`);
        }
        const sourceDb = new Database(sourceDatabasePath, { readonly: true });
        await sourceDb.backup(path.join(temp, 'pump.db'));
        sourceDb.close();
        seedMcpCoilProfileFixture(path.join(temp, 'pump.db'));
        seedMcpReadResourceFixtures(path.join(temp, 'pump.db'));

        const port = await getFreePort();
        const unavailableNextPort = await getFreePort();
        baseUrl = `http://127.0.0.1:${port}`;
        child = spawn(process.execPath, ['api.cjs'], {
            cwd: temp,
            env: {
                ...process.env,
                NODE_ENV: 'development',
                BEHIND_PROXY: 'false',
                PORT: String(port),
                NEXT_ORIGIN: `http://127.0.0.1:${unavailableNextPort}`,
                KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED: 'false',
                KNOWLEDGE_HYBRID_SEARCH_ENABLED: 'false',
                MCP_ENABLED: 'true',
                MCP_CLIENT_ID: '',
                MCP_TOKEN: '',
                MCP_SERVICE_TOKENS: JSON.stringify({
                    'deep-api-read': MCP_TEST_TOKEN,
                    'deep-api-write': MCP_WRITE_TEST_TOKEN,
                }),
                MCP_WRITE_ENABLED: 'true',
                MCP_WRITE_CLIENT_IDS: 'deep-api-write',
                MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
                    'deep-api-write': ['sync_factory_knowledge'],
                }),
                MCP_ALLOWED_HOSTS: '127.0.0.1',
                MCP_RATE_LIMIT_PER_MINUTE: '600',
                INTERNAL_SECRET: DEEP_API_INTERNAL_SECRET,
                ACCESS_PASSWORD: DEEP_API_ACCESS_PASSWORD,
                NODE_PATH: path.join(root, 'node_modules'),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        // 隔离 API 会输出请求和 MCP 工具日志；必须持续排空 stdout，避免管道写满后
        // 子进程被反压阻塞，进而把后续业务请求误报为超时。
        const { StringDecoder } = require('node:string_decoder');
        const stdoutDecoder = new StringDecoder('utf8'), stderrDecoder = new StringDecoder('utf8');
        let stdoutTail = '', stderrTail = '';
        const observeStartup = text => {
            if (/\[copper\].*铜价同步(?:完成|失败).*"trigger":"startup"/.test(text)) startupCopperFinished = true;
        };
        child.stdout.on('data', chunk => {
            stdoutTail = (stdoutTail + stdoutDecoder.write(chunk)).slice(-16000);
            observeStartup(stdoutTail);
        });
        child.stderr.on('data', chunk => {
            const text = stderrDecoder.write(chunk);
            stderrTail = (stderrTail + text).slice(-16000);
            observeStartup(stderrTail);
            childErrors += text;
        });
        try {
            await waitForHealth();
        } catch (error) {
            const startupError = childErrors.trim();
            if (!startupError) throw error;
            throw new Error(`${error.message}\n隔离 API stderr: ${startupError.slice(0, 2000)}`, {
                cause: error,
            });
        }

        await request('公开健康检查', 'GET', '/api/health');
        await request('进程存活检查', 'GET', '/api/health/live');
        const readiness = await request('服务就绪检查', 'GET', '/api/health/ready');
        assert(readiness.payload?.data?.ready === true, '服务就绪检查未返回 ready=true');
        assert(readiness.response.headers.get('x-request-id'), '服务就绪检查缺少 X-Request-ID');
        assert(readiness.payload?.data?.runtime?.gitCommit, '服务就绪检查缺少运行版本');
        assert(readiness.payload?.data?.background?.databaseBackup, '服务就绪检查缺少后台任务状态');
        if (DEEP_API_SCOPE === 'all') {
            const proxyFailure = await request('前端转发失败返回 502', 'GET', '/frontend-proxy-check', undefined, [502]);
            assert(String(proxyFailure.payload).includes('前端服务暂时不可用'), '前端转发失败提示不明确');
            await request('未登录访问保护', 'GET', '/api/parts', undefined, [401]);
            await request('未登录不能绑定历史引用', 'POST', '/api/catalog/reference-bindings-preview', { bindings: [] }, [401]);
        }
        await request(
            '通用 MCP 未授权访问',
            'POST',
            '/mcp',
            { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
            [401]
        );
        const login = await request('登录', 'POST', '/api/auth/login', {
            password: DEEP_API_ACCESS_PASSWORD,
        });
        cookie = (login.response.headers.get('set-cookie') || '').split(';')[0];
        assert(cookie.startsWith('token='), '登录未返回 token Cookie');
        await request('登录状态', 'GET', '/api/auth/check');
        if (DEEP_API_SCOPE !== 'mcp') {
            await testBusinessRevision();
            await testCatalogNamingSave();
            await testRecipeInventoryIdentity(path.join(temp, 'pump.db'));
            await testSavedPurchaseNameViews(path.join(temp, 'pump.db'));
            await testCatalogMigrationHttp(path.join(temp, 'pump.db'));
            await testPartRenameGuard(path.join(temp, 'pump.db'));
        }
        if (DEEP_API_SCOPE !== 'catalog') {
            mcpExpectedCoilProfile = await waitForMcpCoilProfileStable();
            await testMcpReadOnlyFlows();
        } else {
            await testCoreGetEndpointsDoNotWrite(path.join(temp, 'pump.db'));
            await testCatalogReferenceBindings(path.join(temp, 'pump.db'));
        }
        if (DEEP_API_SCOPE === 'all') {
            const legacyConfirmation = await request(
                'AI旧确认参数不能直接执行',
                'POST',
                '/api/ai/confirm-tool',
                { toolName: 'delete_part', args: { id: 1 } },
                [409]
            );
            assert(
                legacyConfirmation.payload?.code === 'confirmation_token_required',
                'AI旧确认请求未返回 confirmation_token_required'
            );
            const invalidConfirmation = await request(
                'AI伪造确认token被拒绝',
                'POST',
                '/api/ai/confirm-tool',
                { confirmationToken: 'not-a-valid-confirmation-token' },
                [400]
            );
            assert(
                invalidConfirmation.payload?.code === 'confirmation_token_invalid',
                'AI伪造确认 token 未被拒绝'
            );
            const missingApi = await request('不存在 API 返回 JSON 404', 'GET', '/api/not-found', undefined, [404]);
            assert(missingApi.payload?.success === false, '不存在 API 未返回标准 JSON 错误');

            await testCoreGetEndpointsDoNotWrite(path.join(temp, 'pump.db'));
            await testCatalogReferenceBindings(path.join(temp, 'pump.db'));
            const resources = await readCoreResources();
            await testBusinessSettingCommand();
            const baseResources = await testResourceDetails(resources);
            await testCrossModuleWriteFlow(baseResources);

            await request('退出登录', 'POST', '/api/auth/logout', {});
            cookie = '';
            await request('退出后状态', 'GET', '/api/auth/check', undefined, [401]);
        } else {
            await request('退出登录', 'POST', '/api/auth/logout', {});
            cookie = '';
        }

        const cloneDb = new Database(path.join(temp, 'pump.db'), { readonly: true });
        const integrity = cloneDb.prepare('PRAGMA integrity_check').get().integrity_check;
        const foreignKeys = cloneDb.prepare('PRAGMA foreign_key_check').all();
        cloneDb.close();
        assert(integrity === 'ok', `隔离数据库完整性失败: ${integrity}`);
        assert(foreignKeys.length === 0, `隔离数据库外键违规: ${foreignKeys.length}`);

        const slowest = [...results].sort((left, right) => right.ms - left.ms).slice(0, 8);
        console.log(JSON.stringify({
            scope: DEEP_API_SCOPE,
            passed: results.length,
            failed: 0,
            tempDatabaseIntegrity: integrity,
            tempDatabaseForeignKeyViolations: foreignKeys.length,
            slowest,
        }, null, 2));
        if (childErrors.trim()) {
            console.log(`隔离 API stderr: ${childErrors.trim().slice(0, 1000)}`);
        }
    } finally {
        if (child && !child.killed) child.kill();
        if (temp.startsWith(os.tmpdir()) && path.basename(temp).startsWith(tempPrefix)) {
            for (let attempt = 0; attempt < 20; attempt += 1) {
                try {
                    fs.rmSync(temp, { recursive: true, force: true });
                    break;
                } catch {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }
    }
}

run().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
