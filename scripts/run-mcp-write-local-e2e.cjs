const fs = require('node:fs');
const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const strictAssert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    Client: LegacyMcpClient,
} = require('@modelcontextprotocol/sdk/client/index.js');
const {
    StreamableHTTPClientTransport: LegacyMcpTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {
    Client: ModernMcpClient,
    StreamableHTTPClientTransport: ModernMcpTransport,
    CallToolResult: ModernCallToolResult,
    withInputRequired,
} = require('@modelcontextprotocol/client');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    MCP_READ_ONLY_TOOL_NAMES,
    MCP_WRITE_TOOL_NAMES,
} = require('../api/mcp/catalog.cjs');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const {
    MCP_PREVIOUSLY_ACCEPTED_WRITE_TOOL_NAMES,
    MCP_BATCH_WRITE_SCENARIOS,
    MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES,
    batchScenarioForTool,
} = require('./mcp-write-acceptance-manifest.cjs');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'logs', 'mcp-write-local-e2e-latest.json');
const READ_TOKEN = 'mcp-local-read-token-0123456789abcdef';
const WRITE_TOKEN = 'mcp-local-write-token-0123456789abcdef';
const INTERNAL_SECRET = 'mcp-local-internal-secret-0123456789abcdef';
const ACCESS_PASSWORD = 'mcp-local-access-password';
const CLIENT_ID = 'mcp-local-write';
const FIXTURE = Object.freeze({
    partModel: 'MCP-LOCAL-BOM-PART',
    partCategory: 'MCP本地验收BOM',
    templateName: 'MCP-LOCAL-TEMPLATE',
    recipeA: 'MCP-LOCAL-RECIPE-A',
    recipeB: 'MCP-LOCAL-RECIPE-B',
    legacyRecipe: 'MCP-LOCAL-LEGACY-RECIPE',
    coilSpec: '99887',
    coilSheets: 321,
    coilMaterial: '冷轧',
    coilSlotType: '国标眼',
    customerName: 'MCP 本地验收客户',
});

let baseUrl = '';
let cookie = '';
let child = null;
let childStderr = '';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function normalizedJsonValue(value) {
    const stripVolatileTimestamps = input => {
        if (Array.isArray(input)) return input.map(stripVolatileTimestamps);
        if (!input || typeof input !== 'object') return input;
        return Object.fromEntries(Object.entries(input)
            .filter(([key]) => !['generatedAt', 'createdAt', 'updatedAt'].includes(key))
            .map(([key, nested]) => [key, stripVolatileTimestamps(nested)]));
    };
    if (typeof value !== 'string') return stripVolatileTimestamps(value ?? null);
    try {
        return stripVolatileTimestamps(JSON.parse(value));
    } catch {
        return value;
    }
}

function recipeBusinessSnapshot(recipe = {}) {
    const scalarFields = [
        'id', 'name', 'spec', 'savedTotalCost', 'templateId', 'coilSpec', 'coilSheets',
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
    return {
        ...Object.fromEntries(scalarFields.map(field => [field, recipe[field] ?? null])),
        ...Object.fromEntries(jsonFields.map(field => [field, normalizedJsonValue(recipe[field])])),
    };
}

function createFixtureDatabase(databasePath) {
    const db = new Database(databasePath);
    try {
        db.pragma('foreign_keys = ON');
        runMigrations(db);
        const now = new Date().toISOString();
        const result = {};
        db.transaction(() => {
            const partId = Number(db.prepare(`
                INSERT INTO parts (
                    model, category, subcategory, price, supplier, stock,
                    remark, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                FIXTURE.partModel,
                FIXTURE.partCategory,
                '正式BOM',
                99.8,
                'MCP-LOCAL',
                20,
                'MCP localhost 写验收夹具',
                now,
                now
            ).lastInsertRowid);
            const templateId = Number(db.prepare(`
                INSERT INTO pump_shell_templates (
                    shell_model, description, parts_json, rotor_params_json,
                    assembly_wage, packing_wage, painting_wage,
                    surface_treatment_mode, surface_treatment_cost,
                    cost_mode, bundle_cost, bundle_note, shell_components_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                FIXTURE.templateName,
                'MCP localhost 写验收模板',
                '[]',
                JSON.stringify({ upper_bearing: '6203', lower_bearing: '6304' }),
                6,
                3,
                2,
                'painting',
                2,
                'bundle',
                99.8,
                'MCP localhost 整体价',
                '[]',
                now,
                now
            ).lastInsertRowid);
            const variantId = Number(db.prepare(`
                INSERT INTO stator_variants (
                    diameter_mm, common_name, material, slot_type, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                99887,
                FIXTURE.coilSpec,
                FIXTURE.coilMaterial,
                FIXTURE.coilSlotType,
                now,
                now
            ).lastInsertRowid);
            const coilId = Number(db.prepare(`
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
                FIXTURE.coilSpec,
                FIXTURE.coilMaterial,
                FIXTURE.coilSlotType,
                FIXTURE.coilSheets,
                'MCP localhost 正式线圈方案',
                'official',
                0.456,
                1.234,
                87.65,
                12.34,
                5.67,
                166.51376,
                7,
                'MCP-2.5',
                'MCP-45',
                'MCP-0.71*2',
                'MCP-31-32-33-34',
                'MCP-0.52',
                'MCP-61-62',
                now,
                now
            ).lastInsertRowid);
            const recipePartsJson = JSON.stringify([{
                partId,
                name: FIXTURE.partModel,
                model: FIXTURE.partModel,
                category: FIXTURE.partCategory,
                supplier: 'MCP-LOCAL',
                qty: 1,
                snapshotPrice: 99.8,
            }]);
            const insertRecipe = db.prepare(`
                INSERT INTO recipes (
                    name, spec, parts_json, saved_total_cost, saved_cost_details,
                    template_id, coil_spec, coil_sheets, coil_material, coil_slot_type,
                    assembly_wage, packing_wage, painting_wage,
                    surface_treatment_mode, surface_treatment_cost,
                    management_fee, technical_data_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
            `);
            const recipeAId = Number(insertRecipe.run(
                FIXTURE.recipeA,
                'MCP-A',
                recipePartsJson,
                99.8,
                templateId,
                FIXTURE.coilSpec,
                FIXTURE.coilSheets,
                FIXTURE.coilMaterial,
                FIXTURE.coilSlotType,
                6,
                3,
                2,
                'painting',
                2,
                0,
                now,
                now
            ).lastInsertRowid);
            const recipeBId = Number(insertRecipe.run(
                FIXTURE.recipeB,
                'MCP-B',
                recipePartsJson,
                101.8,
                templateId,
                FIXTURE.coilSpec,
                FIXTURE.coilSheets,
                FIXTURE.coilMaterial,
                FIXTURE.coilSlotType,
                6,
                3,
                2,
                'painting',
                2,
                0,
                now,
                now
            ).lastInsertRowid);
            const legacyRecipeId = Number(db.prepare(`
                INSERT INTO recipes (
                    name, spec, parts_json, saved_total_cost, saved_cost_details,
                    extra_parts_json, technical_data_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, '[]', NULL, '{}', ?, ?)
            `).run(
                FIXTURE.legacyRecipe,
                'MCP-LEGACY',
                recipePartsJson,
                99.8,
                now,
                now
            ).lastInsertRowid);
            const customerId = Number(db.prepare(`
                INSERT INTO customers (
                    name, contact_info, default_margin, remark, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                FIXTURE.customerName,
                'mcp-local@example.invalid',
                0.15,
                'MCP localhost 写验收客户',
                now,
                now
            ).lastInsertRowid);
            const fileId = Number(db.prepare(`
                INSERT INTO factory_files (
                    original_name, extension, detected_type, mime_type, file_size,
                    file_sha256, file_blob, parser_status, source_type,
                    duplicate_count, metadata_json, parsed_text, parsed_json,
                    parser_error, parsed_at, created_at, updated_at, deleted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            `).run(
                'MCP-local-acceptance.txt',
                '.txt',
                'text',
                'text/plain',
                24,
                'mcp-local-acceptance-fixture',
                Buffer.from('MCP localhost acceptance'),
                'parsed',
                'direct_upload',
                1,
                '{}',
                'MCP localhost acceptance',
                '{}',
                '',
                now,
                now,
                now
            ).lastInsertRowid);
            Object.assign(result, {
                partId,
                templateId,
                coilId,
                recipeAId,
                recipeBId,
                legacyRecipeId,
                customerId,
                fileId,
            });
        })();
        return result;
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
    for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
            const response = await fetch(`${baseUrl}/api/health`, {
                signal: AbortSignal.timeout(1000),
            });
            if (response.ok) return;
        } catch {
            // The isolated API is still starting.
        }
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`MCP localhost API 启动超时${childStderr ? `: ${childStderr.slice(0, 1000)}` : ''}`);
}

async function apiRequest(label, method, pathname, body, expectedStatuses = [200]) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!expectedStatuses.includes(response.status)) {
        throw new Error(`${label} ${method} ${pathname} -> ${response.status}: ${text.slice(0, 600)}`);
    }
    return { response, payload };
}

async function waitForRotorJob(jobId) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        const result = await apiRequest(
            '回读转子出图任务',
            'GET',
            `/api/rotor/status/${encodeURIComponent(jobId)}`
        );
        const status = result.payload?.data?.status;
        if (status === 'success') return result.payload.data;
        if (status === 'failed') {
            throw new Error(`转子出图替身任务失败: ${result.payload?.data?.error || 'unknown'}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`转子出图替身任务未完成: ${jobId}`);
}

async function stopChild() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await Promise.race([
        exited,
        new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
}

function removeTempDirectory(tempDir) {
    const resolvedTemp = path.resolve(tempDir);
    const resolvedOsTemp = path.resolve(os.tmpdir());
    assert(
        resolvedTemp.startsWith(`${resolvedOsTemp}${path.sep}`)
            && path.basename(resolvedTemp).startsWith('pump-mcp-write-e2e-'),
        `拒绝清理非验收临时目录: ${resolvedTemp}`
    );
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
}

async function createAcceptedQuotationFixture(unique, customerId, recipeId) {
    const quoteInput = {
        customerId,
        status: '草稿',
        items: [{
            baseRecipeId: recipeId,
            baseRecipeName: FIXTURE.recipeA,
            qty: 1,
            margin: 1.15,
        }],
        remark: 'MCP localhost 工作流夹具',
    };
    const draft = (await apiRequest(
        'MCP工作流报价保存草稿',
        'POST',
        '/api/quotations/save-payload-draft',
        quoteInput
    )).payload.data;
    assert(draft?.previewHash && draft?.suggestedIdempotencyKey, '报价夹具草稿缺少预览或幂等键');
    const quotation = (await apiRequest(
        'MCP工作流创建报价夹具',
        'POST',
        '/api/quotations',
        {
            ...draft,
            idempotencyKey: `mcp-local-quotation-create:${unique}`,
        }
    )).payload.data;
    const quoting = (await apiRequest(
        'MCP工作流报价进入报价中',
        'POST',
        `/api/quotations/${quotation.id}/status`,
        {
            status: '报价中',
            expectedUpdatedAt: quotation.updatedAt,
            idempotencyKey: `mcp-local-quotation-status:${unique}:quoting`,
        }
    )).payload.data;
    const accepted = (await apiRequest(
        'MCP工作流接受报价夹具',
        'POST',
        `/api/quotations/${quotation.id}/status`,
        {
            status: '已接受',
            expectedUpdatedAt: quoting.updatedAt,
            idempotencyKey: `mcp-local-quotation-status:${unique}:accepted`,
        }
    )).payload.data;
    assert(accepted.status === '已接受', '报价夹具未进入已接受状态');
    return accepted;
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function databaseSnapshot(databasePath) {
    const db = new Database(databasePath, { readonly: true });
    try {
        db.pragma('busy_timeout = 5000');
        const scalar = sql => Number(db.prepare(sql).pluck().get() || 0);
        return {
            orders: scalar('SELECT COUNT(*) FROM orders'),
            recipes: scalar('SELECT COUNT(*) FROM recipes'),
            parts: scalar('SELECT COUNT(*) FROM parts'),
            partStock: scalar('SELECT COALESCE(SUM(stock), 0) FROM parts'),
            partPrices: Number(db.prepare(
                'SELECT COALESCE(SUM(price), 0) FROM parts'
            ).pluck().get() || 0),
            coilStock: scalar('SELECT COALESCE(SUM(stock), 0) FROM coils'),
            fileLinks: scalar('SELECT COUNT(*) FROM factory_file_links'),
            rotorHistory: scalar('SELECT COUNT(*) FROM rotor_drawings'),
            knowledgeSyncRuns: scalar('SELECT COUNT(*) FROM knowledge_sync_runs'),
            operations: scalar('SELECT COUNT(*) FROM api_operations'),
            audits: scalar('SELECT COUNT(*) FROM audit_log'),
        };
    } finally {
        db.close();
    }
}

async function waitForDatabaseSnapshotToSettle(databasePath, {
    timeoutMs = 2500,
    intervalMs = 50,
    stableSamples = 8,
} = {}) {
    const startedAt = Date.now();
    let previous = null;
    let stableCount = 0;
    while (Date.now() - startedAt <= timeoutMs) {
        const current = {
            snapshot: databaseSnapshot(databasePath),
            content: databaseContentDigest(databasePath),
        };
        if (previous && JSON.stringify(current) === JSON.stringify(previous)) {
            stableCount += 1;
            if (stableCount >= stableSamples) return current;
        } else {
            stableCount = 0;
        }
        previous = current;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error('MCP localhost 验收数据库在限定时间内未稳定');
}

function databaseContentDigest(databasePath) {
    const db = new Database(databasePath, { readonly: true });
    try {
        db.pragma('busy_timeout = 5000');
        const tables = db.prepare(`
            SELECT name
            FROM sqlite_schema
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        `).all().map(row => String(row.name));
        const hash = crypto.createHash('sha256');
        let rows = 0;
        for (const table of tables) {
            const quoted = `"${table.replaceAll('"', '""')}"`;
            const serializedRows = db.prepare(`SELECT * FROM ${quoted}`).all()
                .map(row => JSON.stringify(row))
                .sort();
            hash.update(table);
            hash.update('\0');
            for (const serialized of serializedRows) {
                hash.update(serialized);
                hash.update('\0');
            }
            rows += serializedRows.length;
        }
        return {
            tables: tables.length,
            rows,
            sha256: hash.digest('hex'),
        };
    } finally {
        db.close();
    }
}

function externalTreeSnapshot(tempDir) {
    const roots = ['public/drawings', 'freecad'];
    const files = [];
    function visit(absoluteDir) {
        if (!fs.existsSync(absoluteDir)) return;
        for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
            const absolutePath = path.join(absoluteDir, entry.name);
            if (entry.isDirectory()) {
                visit(absolutePath);
                continue;
            }
            assert(entry.isFile(), `隔离外部目录出现非文件项: ${absolutePath}`);
            const content = fs.readFileSync(absolutePath);
            files.push({
                path: path.relative(tempDir, absolutePath).split(path.sep).join('/'),
                bytes: content.length,
                sha256: crypto.createHash('sha256').update(content).digest('hex'),
            });
        }
    }
    for (const root of roots) visit(path.join(tempDir, ...root.split('/')));
    files.sort((left, right) => left.path.localeCompare(right.path));
    return files;
}

function readStubEvents(stubLogPath) {
    return fs.existsSync(stubLogPath)
        ? fs.readFileSync(stubLogPath, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .map(line => JSON.parse(line))
        : [];
}

function publicWriteReceipt(result, toolName, allowedStatuses = ['completed']) {
    assert(result?.isError !== true, `${toolName} MCP 写调用失败: ${JSON.stringify(result).slice(0, 900)}`);
    const structured = result?.structuredContent;
    const receipt = structured?.data;
    assert(structured?.success === true, `${toolName} 未返回 success=true`);
    assert(structured?.mcp?.verified === true, `${toolName} 缺少正式写执行证据`);
    assert(structured?.mcp?.capabilityId === `ai.${toolName}`, `${toolName} capabilityId 不匹配`);
    assert(receipt?.capabilityId === `ai.${toolName}`, `${toolName} 回执 capabilityId 不匹配`);
    assert(allowedStatuses.includes(receipt?.status), `${toolName} 回执状态异常: ${receipt?.status}`);
    assert(receipt?.confirmationOperationId, `${toolName} 缺少确认层 operationId`);
    assert(Array.isArray(receipt?.formalCapabilityIds), `${toolName} 缺少正式 capability 列表`);
    assert(Array.isArray(receipt?.formalOperationIds), `${toolName} 缺少正式 operation 列表`);
    assert(receipt.formalOperationIds.length > 0, `${toolName} 没有正式 operation 回执`);
    assert(receipt.operationId === receipt.formalOperationIds[0], `${toolName} 主 operationId 未指向正式命令`);
    assert(Array.isArray(receipt?.auditIds) && receipt.auditIds.length > 0, `${toolName} 缺少 auditIds`);
    assert(receipt?.result?.success === true, `${toolName} 业务结果未成功`);
    return receipt;
}

async function verifyPersistentReceipts(databasePath, toolReports) {
    const db = new Database(databasePath, { readonly: true });
    try {
        db.pragma('busy_timeout = 5000');
        const operationStatement = db.prepare(`
            SELECT operation_id, capability_id, status
            FROM api_operations
            WHERE operation_id = ?
        `);
        const auditStatement = db.prepare('SELECT id FROM audit_log WHERE id = ?');
        const seenOperations = new Set();
        for (const report of toolReports) {
            assert(report.formalOperationIds.length > 0, `${report.name} 没有可回读正式 operation`);
            for (const [index, operationId] of report.formalOperationIds.entries()) {
                const operation = operationStatement.get(operationId);
                assert(operation, `${report.name} 的 operation ${operationId} 未持久化`);
                assert(
                    operation.capability_id === report.formalCapabilityIds[index],
                    `${report.name} operation/capability 关联不一致`
                );
                assert(operation.status === 'completed', `${report.name} 正式 operation 未完成: ${operation.status}`);
                assert(!seenOperations.has(operationId), `${report.name} 复用了其他工具的 operationId`);
                seenOperations.add(operationId);
            }
            for (const auditId of report.auditIds) {
                assert(auditStatement.get(auditId), `${report.name} 的 auditId ${auditId} 不存在`);
            }
        }
        return {
            integrity: db.pragma('integrity_check', { simple: true }),
            foreignKeyViolations: db.pragma('foreign_key_check').length,
            operationsVerified: seenOperations.size,
        };
    } finally {
        db.close();
    }
}

async function run() {
    const startedAt = new Date();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-mcp-write-e2e-'));
    const databasePath = path.join(tempDir, 'pump.db');
    const stubLogPath = path.join(tempDir, 'external-stub.jsonl');
    const report = {
        schemaVersion: 3,
        suite: 'mcp-write-localhost-e2e',
        status: 'running',
        startedAt: startedAt.toISOString(),
        completedAt: null,
        durationMs: null,
        protocolVersion: null,
        productionTouched: false,
        productionCredentialsRead: false,
        physicalSideEffects: false,
        temporaryDatabaseCleaned: false,
        toolsExpected: MCP_WRITE_TOOL_NAMES.length,
        toolsPassed: 0,
        tools: [],
        directorySnapshot: null,
        previouslyAcceptedTools: MCP_PREVIOUSLY_ACCEPTED_WRITE_TOOL_NAMES,
        candidateTools: MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES,
        declinedCalls: [],
        scenarios: [],
        legacyCompatibility: null,
        idempotencyReplays: [],
        failedCalls: [],
        recipeRecovery: null,
        persistentEvidence: null,
        externalStub: null,
    };
    let modernClient = null;
    let manualClient = null;
    let legacyClient = null;
    try {
        const fixtureIds = createFixtureDatabase(databasePath);
        fs.cpSync(path.join(ROOT, 'api'), path.join(tempDir, 'api'), { recursive: true });
        fs.cpSync(path.join(ROOT, 'shared'), path.join(tempDir, 'shared'), { recursive: true });
        fs.copyFileSync(path.join(ROOT, 'api.cjs'), path.join(tempDir, 'api.cjs'));
        fs.mkdirSync(path.join(tempDir, 'public', 'drawings'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'freecad'), { recursive: true });
        const stubPath = path.join(tempDir, 'mcp-external-command-stub.cjs');
        fs.copyFileSync(
            path.join(ROOT, 'tests', 'helpers', 'mcpExternalCommandStub.cjs'),
            stubPath
        );

        const port = await getFreePort();
        const unusedNextPort = await getFreePort();
        baseUrl = `http://127.0.0.1:${port}`;
        child = spawn(process.execPath, ['api.cjs'], {
            cwd: tempDir,
            env: {
                ...process.env,
                NODE_ENV: 'development',
                NODE_TEST_CONTEXT: 'mcp-write-local-e2e',
                PORT: String(port),
                NEXT_ORIGIN: `http://127.0.0.1:${unusedNextPort}`,
                BEHIND_PROXY: 'false',
                KNOWLEDGE_AUTO_SYNC_ENABLED: 'false',
                KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED: 'false',
                KNOWLEDGE_HYBRID_SEARCH_ENABLED: 'false',
                MCP_ENABLED: 'true',
                MCP_CLIENT_ID: '',
                MCP_TOKEN: '',
                MCP_SERVICE_TOKENS: JSON.stringify({
                    'mcp-local-read': READ_TOKEN,
                    [CLIENT_ID]: WRITE_TOKEN,
                }),
                MCP_WRITE_ENABLED: 'true',
                MCP_WRITE_CLIENT_IDS: CLIENT_ID,
                MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
                    [CLIENT_ID]: MCP_WRITE_TOOL_NAMES,
                }),
                MCP_ALLOWED_HOSTS: '127.0.0.1',
                MCP_RATE_LIMIT_PER_MINUTE: '600',
                MCP_VERIFY_TOKEN: '',
                HERMES_MCP_ENABLED: 'false',
                HERMES_MCP_TOKEN: '',
                INTERNAL_SECRET,
                ACCESS_PASSWORD,
                FREECAD_BIN: 'mcp-local-freecad-stub',
                MCP_LOCAL_EXTERNAL_STUB_ENABLED: 'true',
                MCP_LOCAL_FREECAD_STUB_COMMAND: 'mcp-local-freecad-stub',
                MCP_LOCAL_EXTERNAL_STUB_LOG: stubLogPath,
                MCP_LOCAL_EXTERNAL_STUB_ROOT: tempDir,
                MCP_LOCAL_EXTERNAL_STUB_FAIL_CLOSED: 'true',
                NODE_OPTIONS: `--require=${stubPath}`,
                NODE_PATH: path.join(ROOT, 'node_modules'),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        child.stdout.resume();
        child.stderr.on('data', chunk => {
            childStderr += chunk.toString();
        });
        await waitForHealth();

        const login = await apiRequest('MCP localhost 登录', 'POST', '/api/auth/login', {
            password: ACCESS_PASSWORD,
        });
        cookie = (login.response.headers.get('set-cookie') || '').split(';')[0];
        assert(cookie.startsWith('token='), 'MCP localhost 登录未返回 Cookie');

        const legacyUrl = new URL(`${baseUrl}/mcp`);
        legacyClient = new LegacyMcpClient({ name: 'mcp-local-legacy-write-check', version: '1.0.0' });
        await legacyClient.connect(new LegacyMcpTransport(legacyUrl, {
            requestInit: { headers: { Authorization: `Bearer ${WRITE_TOKEN}` } },
        }));
        const legacyTools = await legacyClient.listTools();
        assert(
            legacyTools.tools.map(tool => tool.name).join('\0') === MCP_READ_ONLY_TOOL_NAMES.join('\0'),
            '2025 兼容客户端不应暴露任何写工具'
        );
        const legacyRead = await legacyClient.callTool({
            name: 'get_all_recipes',
            arguments: {},
        });
        assert(
            legacyRead?.isError !== true
                && legacyRead?.structuredContent?.success === true,
            '2025 兼容客户端真实查询调用失败'
        );
        const legacyWriteBefore = databaseSnapshot(databasePath);
        let legacyWriteRejected = false;
        let legacyWriteCode = 'client_rejected_hidden_tool';
        try {
            const hiddenWrite = await legacyClient.callTool({
                name: 'sync_factory_knowledge',
                arguments: {},
            });
            legacyWriteRejected = hiddenWrite?.isError === true
                || hiddenWrite?.structuredContent?.success === false;
            legacyWriteCode = hiddenWrite?.structuredContent?.code
                || (hiddenWrite?.isError ? 'mcp_tool_error' : 'unexpected_success');
        } catch (error) {
            legacyWriteRejected = true;
            legacyWriteCode = error?.code || 'client_rejected_hidden_tool';
        }
        assert(legacyWriteRejected, '2025 兼容客户端竟可调用隐藏写工具');
        strictAssert.deepEqual(
            databaseSnapshot(databasePath),
            legacyWriteBefore,
            '2025 隐藏写工具调用产生了数据库副作用'
        );
        report.legacyCompatibility = {
            listedReadTools: legacyTools.tools.length,
            readCall: 'passed',
            hiddenWrite: 'rejected',
            hiddenWriteCode: String(legacyWriteCode),
            sideEffects: 0,
        };
        await legacyClient.close();
        legacyClient = null;

        let activeTool = '';
        let responseMode = 'accept';
        let activeCallKind = 'success';
        const confirmationCounts = {
            success: new Map(),
            decline: new Map(),
            failure: new Map(),
        };
        function recordConfirmation(name, request, kind = activeCallKind) {
            assert(request?.method === 'elicitation/create', `${name} 未使用 elicitation/create`);
            assert(request.params?.mode === 'form', `${name} 未使用 form elicitation`);
            assert(
                request.params.requestedSchema?.required?.includes('confirm'),
                `${name} 确认表单没有必填 confirm`
            );
            const displayName = getAiCapability(name).displayName;
            assert(
                String(request.params.message || '').includes(displayName),
                `${name} 确认文案没有正式能力名称`
            );
            const counts = confirmationCounts[kind];
            counts.set(name, (counts.get(name) || 0) + 1);
        }
        modernClient = new ModernMcpClient(
            { name: 'mcp-local-write-e2e', version: '2.0.0' },
            { versionNegotiation: { mode: 'auto' } }
        );
        let modernListCalls = 0;
        const originalModernListTools = modernClient.listTools.bind(modernClient);
        modernClient.listTools = (...args) => {
            modernListCalls += 1;
            return originalModernListTools(...args);
        };
        modernClient.registerCapabilities({ elicitation: { form: {} } });
        modernClient.setRequestHandler('elicitation/create', async request => {
            assert(activeTool, '收到无法关联工具的 MCP 确认请求');
            recordConfirmation(activeTool, request);
            return responseMode === 'decline'
                ? { action: 'decline' }
                : { action: 'accept', content: { confirm: true } };
        });
        await modernClient.connect(new ModernMcpTransport(new URL(`${baseUrl}/mcp`), {
            requestInit: { headers: { Authorization: `Bearer ${WRITE_TOKEN}` } },
        }));
        report.protocolVersion = modernClient.getNegotiatedProtocolVersion();
        assert(report.protocolVersion === '2026-07-28', '现代客户端未协商到 2026-07-28');
        const listed = await modernClient.listTools();
        const expectedNames = [...MCP_READ_ONLY_TOOL_NAMES, ...MCP_WRITE_TOOL_NAMES];
        assert(
            listed.tools.map(tool => tool.name).join('\0') === expectedNames.join('\0'),
            `localhost 写身份目录不等于 ${expectedNames.length} 个预期工具`
        );
        assert(
            listed.tools.filter(tool => MCP_WRITE_TOOL_NAMES.includes(tool.name))
                .every(tool => tool.annotations?.readOnlyHint === false),
            'localhost 写工具 readOnlyHint 不正确'
        );
        report.directorySnapshot = {
            protocolVersion: report.protocolVersion,
            listCalls: modernListCalls,
            readTools: MCP_READ_ONLY_TOOL_NAMES.length,
            writeTools: MCP_WRITE_TOOL_NAMES.length,
            totalTools: listed.tools.length,
            names: listed.tools.map(tool => tool.name),
        };

        manualClient = new ModernMcpClient(
            { name: 'mcp-local-write-replay-e2e', version: '2.0.0' },
            {
                versionNegotiation: { mode: 'auto' },
                inputRequired: { autoFulfill: false },
            }
        );
        manualClient.registerCapabilities({ elicitation: { form: {} } });
        await manualClient.connect(new ModernMcpTransport(new URL(`${baseUrl}/mcp`), {
            requestInit: { headers: { Authorization: `Bearer ${WRITE_TOKEN}` } },
        }));
        assert(
            manualClient.getNegotiatedProtocolVersion() === '2026-07-28',
            '手动重放客户端未协商到 2026-07-28'
        );
        function recordSuccessfulTool(name, receipt, durationMs) {
            report.tools.push({
                name,
                status: 'passed',
                durationMs,
                operationStatus: receipt.status,
                operationId: receipt.operationId,
                confirmationOperationId: receipt.confirmationOperationId,
                formalCapabilityIds: receipt.formalCapabilityIds,
                formalOperationIds: receipt.formalOperationIds,
                auditIds: receipt.auditIds,
                idempotentReplay: receipt.idempotentReplay,
            });
        }

        async function callWrite(name, args, options = {}) {
            activeTool = name;
            responseMode = options.responseMode || 'accept';
            activeCallKind = options.callKind
                || (responseMode === 'decline' ? 'decline' : 'success');
            const started = Date.now();
            try {
                const result = await modernClient.callTool({ name, arguments: args });
                if (responseMode === 'decline') return result;
                const receipt = publicWriteReceipt(
                    result,
                    name,
                    options.allowedStatuses || ['completed']
                );
                if (options.record !== false) {
                    recordSuccessfulTool(name, receipt, Date.now() - started);
                }
                return { result, receipt };
            } finally {
                activeTool = '';
                responseMode = 'accept';
                activeCallKind = 'success';
            }
        }

        async function callWriteWithReplay(name, args) {
            const started = Date.now();
            const originalParams = { name, arguments: args };
            const initial = await manualClient.request(
                { method: 'tools/call', params: originalParams },
                withInputRequired(ModernCallToolResult),
                { allowInputRequired: true }
            );
            assert(initial?.resultType === 'input_required', `${name} 未返回 input_required`);
            assert(initial.requestState, `${name} 未返回可重放 requestState`);
            const confirmationRequest = initial.inputRequests?.confirmation;
            recordConfirmation(name, confirmationRequest, 'success');
            const continuation = {
                ...originalParams,
                inputResponses: {
                    confirmation: {
                        action: 'accept',
                        content: { confirm: true },
                    },
                },
                requestState: initial.requestState,
            };
            const firstResult = await manualClient.request({
                method: 'tools/call',
                params: continuation,
            });
            const firstReceipt = publicWriteReceipt(firstResult, name);
            assert(firstReceipt.idempotentReplay === false, `${name} 首次执行被误报为重放`);
            recordSuccessfulTool(name, firstReceipt, Date.now() - started);

            const beforeReplay = await waitForDatabaseSnapshotToSettle(databasePath);
            const replayResult = await manualClient.request({
                method: 'tools/call',
                params: continuation,
            });
            const replayReceipt = publicWriteReceipt(replayResult, name);
            assert(replayReceipt.idempotentReplay === true, `${name} 第二次提交未命中幂等重放`);
            assert(replayReceipt.operationId === firstReceipt.operationId, `${name} 重放 operationId 漂移`);
            strictAssert.deepEqual(
                replayReceipt.formalOperationIds,
                firstReceipt.formalOperationIds,
                `${name} 重放正式 operation 列表漂移`
            );
            strictAssert.deepEqual(
                replayReceipt.auditIds,
                firstReceipt.auditIds,
                `${name} 重放 auditIds 漂移`
            );
            strictAssert.deepEqual(
                await waitForDatabaseSnapshotToSettle(databasePath),
                beforeReplay,
                `${name} 幂等重放产生了数据库副作用`
            );
            report.idempotencyReplays.push({
                name,
                operationId: firstReceipt.operationId,
                idempotentReplay: true,
                sideEffects: 0,
            });
            return { result: firstResult, receipt: firstReceipt };
        }

        async function callWriteFailure(name, args, options = {}) {
            activeTool = name;
            responseMode = 'accept';
            activeCallKind = 'failure';
            const before = await waitForDatabaseSnapshotToSettle(databasePath);
            const externalBefore = readStubEvents(stubLogPath).length;
            try {
                const result = await modernClient.callTool({ name, arguments: args });
                assert(result?.isError === true, `${name} 失败样本未返回 MCP tool error`);
                assert(result?.structuredContent?.success === false, `${name} 失败样本未返回 success=false`);
                const code = String(result.structuredContent.code || 'mcp_write_execution_failed');
                if (options.expectedCode) {
                    assert(code === options.expectedCode, `${name} 失败码异常: ${code}`);
                }
                if (options.errorPattern) {
                    assert(
                        options.errorPattern.test(String(result.structuredContent.error || '')),
                        `${name} 失败信息不符合预期: ${result.structuredContent.error}`
                    );
                }
                strictAssert.deepEqual(
                    await waitForDatabaseSnapshotToSettle(databasePath),
                    before,
                    `${name} 失败路径产生了数据库副作用`
                );
                assert(
                    readStubEvents(stubLogPath).length === externalBefore,
                    `${name} 失败路径触发了外部命令`
                );
                report.failedCalls.push({
                    name,
                    code,
                    confirmationPresented: (confirmationCounts.failure.get(name) || 0) > 0,
                    sideEffects: 0,
                });
                return result;
            } finally {
                activeTool = '';
                responseMode = 'accept';
                activeCallKind = 'success';
            }
        }

        async function declineWrite(name, args) {
            assert(
                MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES.includes(name),
                `${name} 不属于本轮批次候选工具`
            );
            const before = await waitForDatabaseSnapshotToSettle(databasePath);
            const treeBefore = externalTreeSnapshot(tempDir);
            const externalBefore = readStubEvents(stubLogPath).length;
            const declined = await callWrite(name, args, { responseMode: 'decline' });
            assert(declined?.isError !== true, `${name} 用户拒绝不应返回协议错误`);
            assert(
                declined?.structuredContent?.code === 'mcp_write_declined',
                `${name} 拒绝回执错误`
            );
            strictAssert.deepEqual(
                await waitForDatabaseSnapshotToSettle(databasePath),
                before,
                `${name} 拒绝确认后产生了数据库副作用`
            );
            strictAssert.deepEqual(
                externalTreeSnapshot(tempDir),
                treeBefore,
                `${name} 拒绝确认后改变了隔离外部文件树`
            );
            assert(
                readStubEvents(stubLogPath).length === externalBefore,
                `${name} 拒绝确认后触发了外部命令`
            );
            report.declinedCalls.push({
                name,
                scenario: batchScenarioForTool(name)?.id || null,
                code: 'mcp_write_declined',
                confirmationPresented: true,
                sideEffects: 0,
                externalSideEffects: 0,
                databaseDigest: before.content.sha256,
                databaseTables: before.content.tables,
                databaseRows: before.content.rows,
                externalFiles: treeBefore.length,
            });
        }

        const unique = `${Date.now().toString(36)}-${process.pid}`;
        const createOrderArgs = {
            customerName: FIXTURE.customerName,
            contractNo: `MCP-LOCAL-${unique}`,
            status: '待确认',
            // Deliberately exceed the seeded stock so confirm_order has a
            // deterministic pending-purchase state for the editable-order tools.
            items: [{ recipeName: FIXTURE.recipeA, qty: 30 }],
        };
        await declineWrite('create_order', createOrderArgs);
        const createdOrderCall = await callWriteWithReplay('create_order', createOrderArgs);
        const orderId = Number(createdOrderCall.receipt.result?.order?.id);
        assert(orderId > 0, 'create_order 未返回订单ID');
        let order = (await apiRequest('回读新建订单', 'GET', `/api/orders/${orderId}`)).payload.data;
        assert(order.status === '待确认', 'create_order 未固定进入待确认');
        assert(parseJsonArray(order.itemsJson).some(item => item.recipeName === FIXTURE.recipeA), '新订单缺少配方A');

        const readinessArgs = {
            orderId,
            actionId: 'confirm_order',
        };
        await declineWrite('execute_order_readiness_action', readinessArgs);
        await callWrite('execute_order_readiness_action', readinessArgs);
        order = (await apiRequest('回读订单确认结果', 'GET', `/api/orders/${orderId}`)).payload.data;
        assert(order.status === '待采购', `订单准备动作未进入待采购，实际为 ${order.status}`);

        const addRecipeArgs = {
            orderId,
            recipeName: FIXTURE.recipeB,
            qty: 2,
            reason: 'MCP localhost 验收追加产品',
        };
        await declineWrite('add_recipe_to_order', addRecipeArgs);
        await callWrite('add_recipe_to_order', addRecipeArgs);
        order = (await apiRequest('回读订单追加产品', 'GET', `/api/orders/${orderId}`)).payload.data;
        assert(parseJsonArray(order.itemsJson).some(item => item.recipeName === FIXTURE.recipeB), '追加配方未回读到');

        const updateOrderItemArgs = {
            orderId,
            recipeName: FIXTURE.recipeB,
            qty: 3,
            reason: 'MCP localhost 验收修改数量',
        };
        await declineWrite('update_order_item', updateOrderItemArgs);
        await callWrite('update_order_item', updateOrderItemArgs);
        order = (await apiRequest('回读订单产品修改', 'GET', `/api/orders/${orderId}`)).payload.data;
        assert(
            parseJsonArray(order.itemsJson).some(item => item.recipeName === FIXTURE.recipeB && Number(item.qty) === 3),
            '订单产品数量回读不一致'
        );

        const purchaseListArgs = {
            orderId,
            reason: 'MCP localhost 验收重新生成采购清单',
        };
        await declineWrite('generate_purchase_list', purchaseListArgs);
        await callWrite('generate_purchase_list', purchaseListArgs);
        order = (await apiRequest('回读采购清单', 'GET', `/api/orders/${orderId}`)).payload.data;
        assert(parseJsonArray(order.purchaseListJson).length > 0, '采购清单未生成');

        const removeRecipeArgs = {
            orderId,
            recipeName: FIXTURE.recipeB,
            reason: 'MCP localhost 验收移除产品',
        };
        await declineWrite('remove_recipe_from_order', removeRecipeArgs);
        await callWrite('remove_recipe_from_order', removeRecipeArgs);
        order = (await apiRequest('回读订单移除产品', 'GET', `/api/orders/${orderId}`)).payload.data;
        assert(!parseJsonArray(order.itemsJson).some(item => item.recipeName === FIXTURE.recipeB), '移除配方后仍存在');
        assert(parseJsonArray(order.itemsJson).some(item => item.recipeName === FIXTURE.recipeA), '移除配方误删了其他产品');

        const createdRecipeName = `MCP-WRITE-RECIPE-${unique}`;
        const createdRecipeCall = await callWrite('create_recipe', {
            name: createdRecipeName,
            spec: '',
            parts: [{ model: FIXTURE.partModel, qty: 1 }],
        });
        const createdRecipeId = Number(createdRecipeCall.receipt.result?.recipe?.id);
        assert(createdRecipeId > 0, 'create_recipe 未返回配方ID');
        const recipeBaseline = (await apiRequest(
            '读取配方修改基线',
            'GET',
            `/api/recipes/${createdRecipeId}`
        )).payload.data;
        const recipeBaselineSnapshot = recipeBusinessSnapshot(recipeBaseline);
        const partIdsBeforeRecipeUpdate = (await apiRequest(
            '读取配方修改前零件目录',
            'GET',
            '/api/parts'
        )).payload.data.map(part => Number(part.id)).sort((left, right) => left - right);
        await callWrite('update_recipe', {
            recipeName: createdRecipeName,
            newSpec: 'MCP-LOCAL-2',
        });
        const updatedRecipe = (await apiRequest(
            '回读配方修改',
            'GET',
            `/api/recipes/${createdRecipeId}`
        )).payload.data;
        assert(updatedRecipe.spec === 'MCP-LOCAL-2', '配方修改回读不一致');
        const recoveryCall = await callWrite('update_recipe', {
            recipeName: createdRecipeName,
            clearSpec: true,
        }, { record: false });
        const recoveredRecipe = (await apiRequest(
            '回读配方恢复',
            'GET',
            `/api/recipes/${createdRecipeId}`
        )).payload.data;
        strictAssert.deepEqual(
            recipeBusinessSnapshot(recoveredRecipe),
            recipeBaselineSnapshot,
            '配方恢复后完整业务快照未回到 baseline'
        );
        const partIdsAfterRecipeRecovery = (await apiRequest(
            '读取配方恢复后零件目录',
            'GET',
            '/api/parts'
        )).payload.data.map(part => Number(part.id)).sort((left, right) => left - right);
        strictAssert.deepEqual(
            partIdsAfterRecipeRecovery,
            partIdsBeforeRecipeUpdate,
            '配方修改和恢复意外新增或删除了零件目录记录'
        );
        report.recipeRecovery = {
            name: 'update_recipe_recovery',
            status: 'passed',
            baselineSpec: recipeBaseline.spec,
            temporarySpec: updatedRecipe.spec,
            restoredSpec: recoveredRecipe.spec,
            operationId: recoveryCall.receipt.operationId,
            confirmationOperationId: recoveryCall.receipt.confirmationOperationId,
            formalCapabilityIds: recoveryCall.receipt.formalCapabilityIds,
            formalOperationIds: recoveryCall.receipt.formalOperationIds,
            auditIds: recoveryCall.receipt.auditIds,
            idempotentReplay: recoveryCall.receipt.idempotentReplay,
            snapshotRestored: true,
            catalogSideEffects: 0,
        };

        const partIdsBeforePartCreate = (await apiRequest(
            '读取零件删除验收基线目录',
            'GET',
            '/api/parts'
        )).payload.data.map(part => Number(part.id)).sort((left, right) => left - right);
        const createdPartModel = `MCP-WRITE-PART-${unique}`;
        const createdPartCategory = `MCP-WRITE-CATEGORY-${unique}`;
        await callWrite('batch_create_parts', {
            parts: [{
                model: createdPartModel,
                category: createdPartCategory,
                price: 12.34,
                supplier: 'MCP-LOCAL',
                stock: 0,
            }],
        });
        let createdPart = (await apiRequest(
            '回读批量新增零件',
            'GET',
            `/api/parts?keyword=${encodeURIComponent(createdPartModel)}`
        )).payload.data.find(part => part.model === createdPartModel);
        assert(createdPart && Number(createdPart.price) === 12.34, '批量新增零件回读不一致');

        await callWriteWithReplay('adjust_part_stock', {
            items: [{ model: createdPartModel, changeQty: 2 }],
            note: 'MCP localhost 验收入库',
        });
        createdPart = (await apiRequest(
            '回读零件库存调整',
            'GET',
            `/api/parts?keyword=${encodeURIComponent(createdPartModel)}`
        )).payload.data.find(part => part.model === createdPartModel);
        assert(Number(createdPart.stock) === 2, '零件库存回读不一致');

        await callWriteWithReplay('batch_update_prices', {
            targets: [{
                partId: createdPart.id,
            }],
            absoluteChange: 0.01,
        });
        createdPart = (await apiRequest(
            '回读零件批量调价',
            'GET',
            `/api/parts?keyword=${encodeURIComponent(createdPartModel)}`
        )).payload.data.find(part => part.model === createdPartModel);
        assert(Number(createdPart.price) === 12.35, `零件调价回读异常: ${createdPart.price}`);

        const deletePartCall = await callWriteWithReplay('delete_part', {
            partId: createdPart.id,
            model: createdPart.model,
            supplier: createdPart.supplier,
        });
        const deletedPartMatches = (await apiRequest(
            '回读已删除零件目录',
            'GET',
            `/api/parts?keyword=${encodeURIComponent(createdPartModel)}`
        )).payload.data.filter(part => Number(part.id) === Number(createdPart.id));
        assert(deletedPartMatches.length === 0, 'delete_part 后目标零件仍在正式目录可见');
        const partIdsAfterPartDelete = (await apiRequest(
            '核对零件删除后完整目录',
            'GET',
            '/api/parts'
        )).payload.data.map(part => Number(part.id)).sort((left, right) => left - right);
        strictAssert.deepEqual(
            partIdsAfterPartDelete,
            partIdsBeforePartCreate,
            'delete_part 未精确恢复零件目录或误删其他零件'
        );
        report.partDeletion = {
            name: 'delete_part_cleanup',
            status: 'passed',
            partId: Number(createdPart.id),
            model: createdPart.model,
            operationId: deletePartCall.receipt.operationId,
            confirmationOperationId: deletePartCall.receipt.confirmationOperationId,
            formalCapabilityIds: deletePartCall.receipt.formalCapabilityIds,
            formalOperationIds: deletePartCall.receipt.formalOperationIds,
            auditIds: deletePartCall.receipt.auditIds,
            idempotentReplay: deletePartCall.receipt.idempotentReplay,
            readbackVisible: false,
            partCountDelta: 0,
            unrelatedPartSideEffects: 0,
        };

        await callWrite('adjust_coil_stock', {
            items: [{
                model: `${FIXTURE.coilSpec}-${FIXTURE.coilSheets}`,
                material: FIXTURE.coilMaterial,
                slotType: FIXTURE.coilSlotType,
                changeQty: 1,
            }],
            note: 'MCP localhost 线圈入库验收',
        });
        const coils = (await apiRequest(
            '回读线圈库存调整',
            'GET',
            `/api/coils?spec=${FIXTURE.coilSpec}&sheets=${FIXTURE.coilSheets}`
        )).payload.data;
        assert(coils.length === 1 && Number(coils[0].stock) === 8, '线圈库存回读不一致');

        const archiveArgs = {
            fileId: fixtureIds.fileId,
            targetType: 'recipe',
            targetId: createdRecipeId,
            title: 'MCP localhost 技术资料',
            note: 'MCP localhost 归档验收',
        };
        await declineWrite('archive_factory_file', archiveArgs);
        await callWrite('archive_factory_file', archiveArgs);
        const fileLinks = (await apiRequest(
            '回读文件归档关联',
            'GET',
            `/api/files/${fixtureIds.fileId}/links`
        )).payload.data;
        assert(
            fileLinks.some(link => link.targetType === 'recipe' && Number(link.targetId) === createdRecipeId),
            '文件归档回读不一致'
        );

        await callWriteWithReplay('sync_factory_knowledge', {});
        const knowledgeHealth = (await apiRequest(
            '回读知识同步健康',
            'GET',
            '/api/knowledge/health'
        )).payload.data;
        assert(knowledgeHealth.pendingTotal === 0, '知识同步后仍有待同步来源');

        await callWriteFailure('update_order_item', {
            orderId: 999999999,
            recipeName: FIXTURE.recipeA,
            qty: 2,
            reason: 'MCP localhost 失败路径验收',
        }, { errorPattern: /找不到订单|订单不存在/ });
        await callWriteFailure('adjust_part_stock', {
            items: [{ model: `MCP-MISSING-PART-${unique}`, changeQty: 1 }],
            note: 'MCP localhost 失败路径验收',
        }, { errorPattern: /未找到|不存在|零件/ });
        await callWriteFailure('update_recipe', {
            recipeName: FIXTURE.legacyRecipe,
            newSpec: 'MCP-LEGACY-UPDATED',
        }, {
            expectedCode: 'RECIPE_OPTIONAL_PARTS_MIGRATION_REQUIRED',
            errorPattern: /配方页面核对并保存一次/,
        });
        await callWriteFailure('archive_factory_file', {
            fileId: 999999999,
            targetType: 'recipe',
            targetId: createdRecipeId,
            title: 'MCP localhost 不存在文件',
        }, { errorPattern: /文件|附件|不存在/ });
        await callWriteFailure('print_rotor_drawing', {
            jobId: `mcp-missing-job-${unique}`,
        }, { errorPattern: /任务|图纸|不存在|找不到/ });

        const acceptedQuotation = await createAcceptedQuotationFixture(
            unique,
            fixtureIds.customerId,
            fixtureIds.recipeAId
        );
        const workflowArgs = {
            workflowType: 'quotation_to_order',
            quotationId: acceptedQuotation.id,
            actionId: 'convert_quotation',
        };
        await declineWrite('execute_factory_workflow_step', workflowArgs);
        await callWrite('execute_factory_workflow_step', workflowArgs);
        const quotationReadback = (await apiRequest(
            '回读报价转订单结果',
            'GET',
            `/api/quotations/${acceptedQuotation.id}`
        )).payload.data;
        assert(Number(quotationReadback.convertedOrderId) > 0, '报价转订单没有回读到订单ID');
        assert(quotationReadback.status === '已转订单', '报价转订单后报价状态不正确');
        const generatedOrder = (await apiRequest(
            '回读报价生成的订单',
            'GET',
            `/api/orders/${quotationReadback.convertedOrderId}`
        )).payload.data;
        const generatedItems = parseJsonArray(generatedOrder.itemsJson);
        const acceptedItems = parseJsonArray(acceptedQuotation.itemsJson);
        assert(Number(generatedOrder.customerId) === fixtureIds.customerId, '报价转订单客户ID不一致');
        assert(generatedOrder.customerName === FIXTURE.customerName, '报价转订单客户名称不一致');
        assert(generatedOrder.status === '待采购', '报价转订单未进入待采购');
        assert(String(generatedOrder.remark || '').includes(`报价 #${acceptedQuotation.id}`), '订单未保留来源报价说明');
        assert(generatedItems.length === 1, '报价转订单明细数量不一致');
        assert(Number(generatedItems[0].recipeId) === fixtureIds.recipeAId, '报价转订单配方ID不一致');
        assert(generatedItems[0].recipeName === FIXTURE.recipeA, '报价转订单配方名称不一致');
        assert(Number(generatedItems[0].qty) === 1, '报价转订单数量不一致');
        if (acceptedItems[0]?.id) {
            assert(
                generatedItems[0].quotationItemId === acceptedItems[0].id,
                '报价转订单明细未保留来源报价明细ID'
            );
        }

        const drawingArgs = {
            upper_bearing: '303',
            lower_bearing: '6304',
            piece_count: 160,
        };
        await declineWrite('generate_rotor_drawing', drawingArgs);
        const drawingCall = await callWrite('generate_rotor_drawing', drawingArgs, {
            allowedStatuses: ['accepted', 'processing', 'completed'],
        });
        const drawingJobId = String(drawingCall.receipt.result?.jobId || '');
        assert(drawingJobId, 'generate_rotor_drawing 未返回 jobId');
        const drawingStatus = await waitForRotorJob(drawingJobId);
        assert(drawingStatus.fileUrl, '出图替身完成后缺少 fileUrl');

        const printArgs = { jobId: drawingJobId };
        await declineWrite('print_rotor_drawing', printArgs);
        const printCall = await callWrite('print_rotor_drawing', printArgs);
        assert(printCall.receipt.result?.jobId === drawingJobId, '打印回执 jobId 与完成任务不一致');

        const recipesBeforeDelete = (await apiRequest(
            '读取配方删除前目录',
            'GET',
            '/api/recipes'
        )).payload.data;
        assert(
            recipesBeforeDelete.some(recipe => Number(recipe.id) === createdRecipeId),
            '配方删除前目标不存在'
        );
        const partIdsBeforeRecipeDelete = (await apiRequest(
            '读取配方删除前零件目录',
            'GET',
            '/api/parts'
        )).payload.data.map(part => Number(part.id)).sort((left, right) => left - right);
        const deleteRecipeCall = await callWrite('delete_recipe', {
            recipeName: createdRecipeName,
        });
        await callWriteFailure('delete_part', {
            partId: 2147483647,
            model: `MCP-MISSING-PART-${unique}`,
            supplier: 'MCP-LOCAL',
        }, {
            expectedCode: 'part_delete_target_not_found',
        });
        assert(
            Number(deleteRecipeCall.receipt.result?.recipeId) === createdRecipeId,
            'delete_recipe 回执目标与确认目标不一致'
        );
        const deletedReadback = await apiRequest(
            '回读已删除配方',
            'GET',
            `/api/recipes/${createdRecipeId}`,
            undefined,
            [404]
        );
        assert(deletedReadback.payload?.success === false, '已删除配方详情未返回正式不存在');
        const recipesAfterDelete = (await apiRequest(
            '读取配方删除后目录',
            'GET',
            '/api/recipes'
        )).payload.data;
        assert(recipesAfterDelete.length === recipesBeforeDelete.length - 1, '配方删除后目录数量不是精确-1');
        assert(
            !recipesAfterDelete.some(recipe => Number(recipe.id) === createdRecipeId),
            '软删除配方仍出现在正式目录'
        );
        strictAssert.deepEqual(
            recipesAfterDelete.map(recipe => Number(recipe.id)).sort((left, right) => left - right),
            recipesBeforeDelete
                .filter(recipe => Number(recipe.id) !== createdRecipeId)
                .map(recipe => Number(recipe.id))
                .sort((left, right) => left - right),
            '配方删除误影响其他配方'
        );
        const partIdsAfterRecipeDelete = (await apiRequest(
            '读取配方删除后零件目录',
            'GET',
            '/api/parts'
        )).payload.data.map(part => Number(part.id)).sort((left, right) => left - right);
        strictAssert.deepEqual(
            partIdsAfterRecipeDelete,
            partIdsBeforeRecipeDelete,
            '配方删除意外新增或删除零件目录记录'
        );
        report.recipeDeletion = {
            name: 'delete_recipe_cleanup',
            status: 'passed',
            recipeId: createdRecipeId,
            recipeName: createdRecipeName,
            operationId: deleteRecipeCall.receipt.operationId,
            confirmationOperationId: deleteRecipeCall.receipt.confirmationOperationId,
            formalCapabilityIds: deleteRecipeCall.receipt.formalCapabilityIds,
            formalOperationIds: deleteRecipeCall.receipt.formalOperationIds,
            auditIds: deleteRecipeCall.receipt.auditIds,
            idempotentReplay: deleteRecipeCall.receipt.idempotentReplay,
            readbackStatus: deletedReadback.response.status,
            recipeCountDelta: -1,
            partCatalogSideEffects: 0,
        };

        assert(
            report.tools.length === MCP_WRITE_TOOL_NAMES.length,
            `实际成功工具数不是${MCP_WRITE_TOOL_NAMES.length}`
        );
        assert(modernListCalls === 1, `2026 写客户端目录读取次数不是1: ${modernListCalls}`);
        report.directorySnapshot.listCalls = modernListCalls;
        assert(
            MCP_WRITE_TOOL_NAMES.every(name => report.tools.some(item => item.name === name)),
            `${MCP_WRITE_TOOL_NAMES.length}个写工具未全部完成真实localhost调用`
        );
        for (const name of MCP_WRITE_TOOL_NAMES) {
            const expectedCount = name === 'update_recipe' ? 2 : 1;
            assert(
                confirmationCounts.success.get(name) === expectedCount,
                `${name} 成功路径原生确认次数异常: ${confirmationCounts.success.get(name) || 0}`
            );
        }
        assert(
            report.declinedCalls.length === MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES.length,
            `批次候选拒绝样本不是${MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES.length}个`
        );
        for (const name of MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES) {
            assert(
                confirmationCounts.decline.get(name) === 1,
                `${name} 拒绝路径原生确认次数异常`
            );
            assert(
                report.declinedCalls.some(item => item.name === name && item.sideEffects === 0),
                `${name} 缺少拒绝零副作用证据`
            );
        }
        const expectedFailureConfirmations = new Map([
            ['update_order_item', 1],
            ['adjust_part_stock', 0],
            ['update_recipe', 0],
            ['delete_part', 0],
            ['archive_factory_file', 1],
            ['print_rotor_drawing', 1],
        ]);
        for (const [name, count] of expectedFailureConfirmations) {
            assert(
                (confirmationCounts.failure.get(name) || 0) === count,
                `${name} 失败路径原生确认次数异常: ${confirmationCounts.failure.get(name) || 0}`
            );
        }
        assert(report.idempotencyReplays.length === 5, '真实幂等重放样本不是5个');
        assert(report.failedCalls.length === 6, '真实业务失败样本不是6个');

        const persistentEvidence = await verifyPersistentReceipts(databasePath, [
            ...report.tools,
            report.recipeRecovery,
        ]);
        assert(persistentEvidence.integrity === 'ok', '隔离数据库完整性失败');
        assert(persistentEvidence.foreignKeyViolations === 0, '隔离数据库存在外键违规');
        report.persistentEvidence = persistentEvidence;

        const stubEvents = readStubEvents(stubLogPath);
        assert(stubEvents.filter(event => event.kind === 'freecad').length === 1, 'FreeCAD 替身调用次数不是1');
        assert(stubEvents.filter(event => event.kind === 'printer').length === 1, '打印替身调用次数不是1');
        const printerEvent = stubEvents.find(event => event.kind === 'printer');
        const expectedPrintedPath = path.resolve(
            tempDir,
            'public',
            String(drawingStatus.fileUrl).replace(/^\/+/, '').split('/').join(path.sep)
        );
        assert(printerEvent.jobId === drawingJobId, '打印替身 jobId 与完成任务不一致');
        assert(path.resolve(printerEvent.pdfPath) === expectedPrintedPath, '打印替身文件与完成任务不一致');
        report.externalStub = {
            freecadCalls: stubEvents.filter(event => event.kind === 'freecad').length,
            printerCalls: stubEvents.filter(event => event.kind === 'printer').length,
            physicalCalls: 0,
        };
        report.scenarios = MCP_BATCH_WRITE_SCENARIOS.map(scenario => {
            const successfulTools = scenario.tools.filter(name => (
                report.tools.some(item => item.name === name && item.status === 'passed')
            ));
            const declinedTools = scenario.tools.filter(name => (
                report.declinedCalls.some(item => item.name === name && item.sideEffects === 0)
            ));
            const passed = successfulTools.length === scenario.tools.length
                && declinedTools.length === scenario.tools.length;
            assert(passed, `${scenario.id} 场景未完成成功与拒绝双路径`);
            return {
                id: scenario.id,
                title: scenario.title,
                status: 'passed',
                tools: scenario.tools,
                successfulTools,
                declinedTools,
                cleanup: scenario.cleanup,
                productionBoundary: scenario.productionBoundary,
            };
        });

        report.status = 'passed';
        report.toolsPassed = report.tools.length;
    } catch (error) {
        report.status = 'failed';
        report.error = String(error?.message || error).slice(0, 2000);
        throw error;
    } finally {
        try {
            if (modernClient) await modernClient.close();
        } catch {
            // Preserve the primary acceptance result.
        }
        try {
            if (manualClient) await manualClient.close();
        } catch {
            // Preserve the primary acceptance result.
        }
        try {
            if (legacyClient) await legacyClient.close();
        } catch {
            // Preserve the primary acceptance result.
        }
        await stopChild();
        try {
            removeTempDirectory(tempDir);
            report.temporaryDatabaseCleaned = true;
        } catch (error) {
            report.cleanupError = error.message;
        }
        const completedAt = new Date();
        report.toolsPassed = report.tools.length;
        report.completedAt = completedAt.toISOString();
        report.durationMs = completedAt.getTime() - startedAt.getTime();
        fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
        fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(JSON.stringify({
            suite: report.suite,
            status: report.status,
            protocolVersion: report.protocolVersion,
            toolsPassed: report.toolsPassed,
            toolsExpected: report.toolsExpected,
            productionTouched: report.productionTouched,
            physicalSideEffects: report.physicalSideEffects,
            temporaryDatabaseCleaned: report.temporaryDatabaseCleaned,
            durationMs: report.durationMs,
            report: path.relative(ROOT, REPORT_PATH),
        }, null, 2));
    }
}

run().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
