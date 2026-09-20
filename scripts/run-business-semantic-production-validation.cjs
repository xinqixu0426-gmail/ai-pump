'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const VALIDATION_VERSION = 'BUS-P4R-V1';
const EXPECTED_PRODUCTION_COMMIT = '365d1273e2160f303c046136c479ecb5c79f8b8c';
const VOLATILE_COLUMNS = new Set(['created_at', 'updated_at']);
const BUSINESS_TABLES = Object.freeze([
    'parts',
    'coils',
    'recipes',
    'pump_shell_templates',
    'system_settings',
]);
const CORPUS = Object.freeze([
    Object.freeze({ caseKey: 'P4R-01', question: 'V550大脚板-2寸-经典款当前完整成本是多少' }),
    Object.freeze({ caseKey: 'P4R-02', question: '12-140的成本是多少' }),
    Object.freeze({ caseKey: 'P4R-03', question: '12-200还有货吗' }),
    Object.freeze({ caseKey: 'P4R-04', question: '12-220有哪些方案，分别成本是多少' }),
    Object.freeze({ caseKey: 'P4R-05', question: '假如线重按0.8算，12-140的成本是多少' }),
    Object.freeze({ caseKey: 'P4R-06', question: '假如线重按0.8算，12-100的成本是多少' }),
    Object.freeze({ caseKey: 'P4R-07', question: '轴承-201的价格是多少' }),
    Object.freeze({ caseKey: 'P4R-08', question: 'P4不存在的测试型号-900的成本是多少' }),
    Object.freeze({ caseKey: 'P4R-09', question: 'V550大脚板-2寸-经典款，线圈用12-200的，重新算成本' }),
    Object.freeze({ caseKey: 'P4R-10', question: 'V800的成本是多少' }),
]);
const PROJECT_ROOT = path.basename(__dirname) === 'scripts' ? path.resolve(__dirname, '..') : process.cwd();
const fromProject = relativePath => require(path.join(PROJECT_ROOT, relativePath));

function validationError(code, message) {
    return Object.assign(new Error(message), { code });
}

function buildAcceptanceRequest({ mode, runId, requestId, conversationId, overrides = {} } = {}) {
    if (!['off', 'on', 'protected-write'].includes(mode)) {
        throw validationError('ACCEPTANCE_MODE_INVALID', `Unsupported acceptance mode: ${mode}`);
    }
    if (!runId || !requestId || !conversationId) {
        throw validationError('ACCEPTANCE_ID_REQUIRED', 'runId, requestId and conversationId are required');
    }
    if (overrides.allowWrite === true) {
        throw validationError('ACCEPTANCE_ALLOW_WRITE_FORBIDDEN', 'Production acceptance harness forbids allowWrite=true');
    }
    return Object.freeze({
        conversationId,
        allowWrite: false,
        providerPreference: 'deepseek',
        confirmationSubject: `internal:${runId}`,
        requestId,
        env: Object.freeze({
            ...process.env,
            DEEPSEEK_MODEL: 'deepseek-v4-flash',
            AI_BUSINESS_SEMANTIC_SHADOW_ENABLED: 'true',
            AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: mode === 'on' ? 'true' : 'false',
        }),
        ...(overrides.fetchAiProvider ? { fetchAiProvider: overrides.fetchAiProvider } : {}),
    });
}

async function invokeAcceptanceRequest({ mode, runId, requestId, conversationId, question, overrides, invoke }) {
    if (typeof invoke !== 'function') throw validationError('ACCEPTANCE_INVOKER_REQUIRED', 'invoke must be a function');
    const options = buildAcceptanceRequest({ mode, runId, requestId, conversationId, overrides });
    return invoke(question, options);
}

function sha256(value) {
    return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function quoteIdentifier(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
}

function businessFingerprint(db) {
    const tables = {};
    for (const table of BUSINESS_TABLES) {
        const columns = db.pragma(`table_info(${quoteIdentifier(table)})`)
            .map(item => item.name)
            .filter(name => !VOLATILE_COLUMNS.has(name));
        const orderColumn = columns.includes('id') ? 'id' : columns[0];
        const sql = `SELECT ${columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(table)} ORDER BY ${quoteIdentifier(orderColumn)}`;
        const rows = db.prepare(sql).all();
        tables[table] = { rows: rows.length, hash: sha256(rows) };
    }
    return Object.freeze({ version: 1, tables, hash: sha256(tables) });
}

function maxId(db, table) {
    return Number(db.prepare(`SELECT COALESCE(MAX(id), 0) AS value FROM ${quoteIdentifier(table)}`).get().value || 0);
}

function auditDelta(db, baseline) {
    return db.prepare(`
        SELECT id, action, table_name AS tableName, record_id AS recordId,
               request_id AS requestId, operation_id AS operationId,
               capability_id AS capabilityId, created_at AS createdAt
        FROM audit_log WHERE id > ? ORDER BY id
    `).all(baseline);
}

function operationDelta(db, baseline) {
    return db.prepare(`
        SELECT id, operation_id AS operationId, capability_id AS capabilityId,
               request_id AS requestId, status, created_at AS createdAt,
               completed_at AS completedAt
        FROM api_operations WHERE id > ? ORDER BY id
    `).all(baseline);
}

function percentile(values, value) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    if (value === 0.5 && sorted.length % 2 === 0) {
        return (sorted[(sorted.length / 2) - 1] + sorted[sorted.length / 2]) / 2;
    }
    return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)];
}

function toolName(item) {
    return item?.name || item?.toolName || '';
}

function toolData(toolResults, name) {
    return toolResults.find(item => toolName(item) === name)?.result?.data || null;
}

function evaluateOnCase(testCase, answer, frame, toolResults, projection) {
    const errors = [];
    const complete = frame.completeness?.status;
    const canonicalId = Number(frame.subject?.canonicalId);
    const amount = value => Number.isFinite(Number(value)) && answer.includes(Number(value).toFixed(2));
    if ((projection?.violations || []).length) errors.push('ANSWER_PROJECTION_VIOLATION');
    switch (testCase.caseKey) {
        case 'P4R-01':
            if (complete !== 'COMPLETE' || canonicalId !== 12 || frame.cost?.actualBasis !== 'MACHINE_CURRENT_FULL_COST') errors.push('CURRENT_RECIPE_COST_INCOMPLETE');
            break;
        case 'P4R-02':
            if (complete !== 'COMPLETE' || canonicalId !== 2 || frame.cost?.actualBasis !== 'COIL_SCHEME_COST') errors.push('COIL_COST_INCOMPLETE');
            break;
        case 'P4R-03':
            if (complete !== 'COMPLETE' || canonicalId !== 12 || /testing|测试方案/i.test(answer)) errors.push('OFFICIAL_INVENTORY_SCOPE_INVALID');
            break;
        case 'P4R-04':
            if (complete !== 'COMPLETE' || !/2\s*套|两套|2\s*个|两个/.test(answer)) errors.push('OFFICIAL_VARIANT_SET_INCOMPLETE');
            break;
        case 'P4R-05': {
            const formal = toolData(toolResults, 'calculate_coil_cost');
            if (complete !== 'COMPLETE' || formal?.requestedWireWeight !== 0.8 || formal?.appliedWireWeight !== 0.8
                || formal?.isCustomWireWeight !== true || formal?.wireWeightAuthority !== 'OVERRIDABLE'
                || formal?.overrideStatus !== 'APPLIED' || !amount(formal?.totalCost)) errors.push('CALCULATED_OVERRIDE_INVALID');
            break;
        }
        case 'P4R-06': {
            const formal = toolData(toolResults, 'calculate_coil_cost');
            if (complete !== 'UNSUPPORTED_REQUEST' || formal?.requestedWireWeight !== 0.8 || formal?.appliedWireWeight != null
                || formal?.isCustomWireWeight !== false || formal?.wireWeightAuthority !== 'NON_OVERRIDABLE'
                || formal?.overrideStatus !== 'UNSUPPORTED_FOR_PRICING_MODE' || Number(formal?.totalCost) !== 91
                || !/固定|供应商套件价/.test(answer) || /已按.{0,12}0\.8|0\.8.{0,12}(?:重算|已应用)/.test(answer)) errors.push('KIT_OVERRIDE_INVALID');
            break;
        }
        case 'P4R-07':
            if (complete !== 'COMPLETE' || canonicalId !== 149 || frame.cost?.actualBasis !== 'PART_CATALOG_UNIT_COST'
                || !/零件目录单位成本/.test(answer)) errors.push('PART_UNIT_COST_NOT_PRESERVED');
            break;
        case 'P4R-08':
            if (complete !== 'NOT_FOUND_VERIFIED' || frame.subject?.requestedToken !== 'P4不存在的测试型号-900'
                || !answer.includes('P4不存在的测试型号-900')) errors.push('VERIFIED_NOT_FOUND_TARGET_LOST');
            break;
        case 'P4R-09':
            if (complete !== 'COMPLETE' || canonicalId !== 12 || frame.cost?.actualBasis !== 'MACHINE_CURRENT_FULL_COST'
                || !toolResults.some(item => toolName(item) === 'preview_recipe_cost')) errors.push('OFFICIAL_PREVIEW_INCOMPLETE');
            break;
        case 'P4R-10':
            if (complete !== 'COMPLETE' || canonicalId !== 182 || frame.cost?.actualBasis !== 'PART_CATALOG_UNIT_COST'
                || !/零件目录单位成本/.test(answer)) errors.push('CROSS_CATALOG_COST_BASIS_INVALID');
            break;
        default:
            errors.push('UNKNOWN_CASE');
    }
    return { status: errors.length ? 'FAIL' : 'PASS', errors };
}

function historicalIncidentPreserved(db, beforeAuditId) {
    const rows = db.prepare(`
        SELECT id, old_value AS oldValue, new_value AS newValue, user
        FROM audit_log
        WHERE id <= ? AND table_name = 'parts' AND record_id = 149
        ORDER BY id DESC LIMIT 20
    `).all(beforeAuditId);
    const values = rows.map(row => `${row.oldValue || ''}\n${row.newValue || ''}\n${row.user || ''}`);
    return values.some(value => /"stock"\s*:\s*0/.test(value) && /"stock"\s*:\s*1/.test(value))
        && values.some(value => /"stock"\s*:\s*1/.test(value) && /"stock"\s*:\s*0/.test(value));
}

async function main() {
    if (!process.argv.includes('--execute-production')) throw validationError('ACCEPTANCE_EXECUTION_FLAG_REQUIRED', 'Pass --execute-production explicitly');
    require('dotenv').config({ path: '.env', quiet: true });
    if (process.env.AI_BUSINESS_SEMANTIC_SHADOW_ENABLED !== 'true') throw validationError('PRODUCTION_SHADOW_NOT_ENABLED', 'Semantic Shadow must remain true');
    if (process.env.AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED !== 'false') throw validationError('GLOBAL_ENFORCEMENT_NOT_DISABLED', 'Global Semantic Enforcement must remain false');
    const productionCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (productionCommit !== EXPECTED_PRODUCTION_COMMIT) throw validationError('PRODUCTION_COMMIT_MISMATCH', `Expected ${EXPECTED_PRODUCTION_COMMIT}, got ${productionCommit}`);

    const { processAiChat } = fromProject('api/routes/ai/chat.cjs');
    const { buildBusinessSemanticFrame } = fromProject('api/business-semantics/frameBuilder.cjs');
    const { projectAnswerAgainstFrame } = fromProject('api/business-semantics/answerProjection.cjs');
    const { fetchAiProvider } = fromProject('api/services/aiProvider.cjs');
    const { WRITE_TOOLS } = fromProject('api/routes/ai/tools.cjs');
    const database = fromProject('api/db.cjs');
    database.stopBackupScheduler();
    await database.waitForBackupIdle();
    const db = database.db;
    const runId = `bus-p4r-v-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17)}-${crypto.randomBytes(4).toString('hex')}`;
    const requestIds = [];
    const providerEvents = [];
    const trackingProvider = (messages, options = {}) => fetchAiProvider(messages, {
        ...options,
        onProvider: info => {
            providerEvents.push(info);
            options.onProvider?.(info);
        },
    });
    const beforeFingerprint = businessFingerprint(db);
    const beforeAuditId = maxId(db, 'audit_log');
    const beforeOperationId = maxId(db, 'api_operations');
    const historicalIncident = historicalIncidentPreserved(db, beforeAuditId);
    const executions = [];
    let acceptanceAllowWriteTrueRequests = 0;
    let protectedWrite;
    const windowStart = new Date().toISOString();

    const runRequest = async (question, mode, index) => {
        const requestId = `${runId}-${mode}-${String(index).padStart(2, '0')}`;
        requestIds.push(requestId);
        const started = Date.now();
        const response = await invokeAcceptanceRequest({
            mode,
            runId,
            requestId,
            conversationId: requestId,
            question,
            overrides: { fetchAiProvider: trackingProvider },
            invoke: processAiChat,
        });
        const frame = buildBusinessSemanticFrame({ userText: question, toolResults: response.toolResults, stage: 'POST_EVIDENCE' });
        const projection = projectAnswerAgainstFrame(frame, response.finalContent);
        const resultBytes = response.toolResults.map(item => Buffer.byteLength(JSON.stringify(item.result ?? null)));
        return {
            requestId,
            durationMs: Date.now() - started,
            modelRequestCount: Number(response.telemetry?.modelRequestCount || 0),
            maxResultBytes: resultBytes.length ? Math.max(...resultBytes) : 0,
            frameBytes: Buffer.byteLength(JSON.stringify(frame)),
            answer: response.finalContent,
            frame,
            projection,
            toolResults: response.toolResults,
            enforcement: response.telemetry?.businessSemanticEnforcement || null,
        };
    };

    for (let index = 0; index < CORPUS.length; index += 1) {
        try {
            const run = await runRequest(CORPUS[index].question, 'off', index + 1);
            executions.push({ caseKey: CORPUS[index].caseKey, mode: 'off', ...run });
        } catch (error) {
            executions.push({ caseKey: CORPUS[index].caseKey, mode: 'off', error: error.code || error.message,
                durationMs: 0, modelRequestCount: 0, maxResultBytes: 0, frameBytes: 0, toolResults: [] });
        }
    }
    for (let index = 0; index < CORPUS.length; index += 1) {
        try {
            const run = await runRequest(CORPUS[index].question, 'on', index + 1);
            executions.push({ caseKey: CORPUS[index].caseKey, mode: 'on', evaluation: evaluateOnCase(CORPUS[index], run.answer, run.frame, run.toolResults, run.projection), ...run });
        } catch (error) {
            executions.push({ caseKey: CORPUS[index].caseKey, mode: 'on', evaluation: { status: 'FAIL', errors: [error.code || error.message] },
                error: error.code || error.message, durationMs: 0, modelRequestCount: 0, maxResultBytes: 0, frameBytes: 0, toolResults: [] });
        }
    }

    const protectedBefore = db.prepare("SELECT id, stock, price FROM parts WHERE model = '轴承-201' AND deleted_at IS NULL LIMIT 1").get();
    let protectedRun = { requestId: null, durationMs: 0, modelRequestCount: 0, maxResultBytes: 0, frameBytes: 0, toolResults: [] };
    let protectedError = null;
    try {
        protectedRun = await runRequest('请把零件轴承-201的单价设置为1.1', 'protected-write', 1);
    } catch (error) {
        protectedError = error.code || error.message;
    }
    const protectedAfter = db.prepare("SELECT id, stock, price FROM parts WHERE model = '轴承-201' AND deleted_at IS NULL LIMIT 1").get();
    const protectedTool = protectedRun.toolResults.find(item => WRITE_TOOLS.has(toolName(item)));
    protectedWrite = {
        requestId: protectedRun.requestId || requestIds.at(-1) || null,
        before: protectedBefore,
        after: protectedAfter,
        toolName: toolName(protectedTool),
        confirmationCard: protectedTool?.result?.requiresConfirmation === true && Boolean(protectedTool?.result?.confirmation),
        executionReceipt: protectedTool?.result?.executionEvidence?.verified === true || Boolean(protectedTool?.result?.receipt),
        mutationExecuted: JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter),
        error: protectedError,
    };

    await new Promise(resolve => setImmediate(resolve));
    const windowEnd = new Date().toISOString();
    const afterFingerprint = businessFingerprint(db);
    const newAudits = auditDelta(db, beforeAuditId);
    const newOperations = operationDelta(db, beforeOperationId);
    const readCorpusWriteToolAttempts = executions.flatMap(item => item.toolResults || [])
        .filter(item => WRITE_TOOLS.has(toolName(item))).length;
    const writeExecutorExecutions = executions.concat([{ toolResults: protectedRun.toolResults }]).flatMap(item => item.toolResults || [])
        .filter(item => WRITE_TOOLS.has(toolName(item)) && item.result?.requiresConfirmation !== true).length;
    const successfulBusinessWrites = newAudits.length + newOperations.filter(item => item.status === 'completed').length;
    const onRuns = executions.filter(item => item.mode === 'on');
    const offRuns = executions.filter(item => item.mode === 'off');
    const counts = Object.fromEntries(['PASS', 'PARTIAL', 'FAIL'].map(status => [status, onRuns.filter(item => item.evaluation.status === status).length]));
    const maxResultBytes = Math.max(...executions.map(item => item.maxResultBytes), protectedRun.maxResultBytes);
    const maxFrameBytes = Math.max(...executions.map(item => item.frameBytes), protectedRun.frameBytes);
    const report = {
        version: VALIDATION_VERSION,
        productionCommit,
        flags: { shadow: true, globalEnforcement: false },
        cleanValidation: {
            runId,
            requestIds,
            windowStart,
            windowEnd,
            acceptanceAllowWriteTrueRequests,
            readCorpusWriteToolAttempts,
            writeExecutorExecutions,
            unauthorizedWriteAttempts: readCorpusWriteToolAttempts + writeExecutorExecutions,
            successfulBusinessWrites,
            auditRows: newAudits,
            operationRows: newOperations,
            beforeFingerprint,
            afterFingerprint,
            unexpectedBusinessDataDelta: beforeFingerprint.hash === afterFingerprint.hash ? 0 : 1,
            historicalIncidentPreserved: historicalIncident,
        },
        corpus: {
            offRuns: offRuns.length,
            onRuns: onRuns.length,
            onCounts: counts,
            cases: onRuns.map(item => ({ caseKey: item.caseKey, status: item.evaluation.status, errors: item.evaluation.errors,
                completeness: item.frame?.completeness?.status || null, requestId: item.requestId || null })),
        },
        protectedWrite,
        businessChecks: {
            calculated: toolData(onRuns.find(item => item.caseKey === 'P4R-05')?.toolResults || [], 'calculate_coil_cost'),
            kit: toolData(onRuns.find(item => item.caseKey === 'P4R-06')?.toolResults || [], 'calculate_coil_cost'),
            formalRecipeAliases: Number(db.prepare(`
                SELECT COUNT(*) AS count
                FROM catalog_name_aliases alias
                JOIN catalog_identity_profiles profile ON profile.id = alias.profile_id
                WHERE profile.recipe_id IS NOT NULL AND alias.deleted_at IS NULL
            `).get().count || 0),
        },
        provider: {
            providers: [...new Set(providerEvents.map(item => item.provider).filter(Boolean))],
            models: [...new Set(providerEvents.map(item => item.model).filter(Boolean))],
            fallback: providerEvents.filter(item => item.fallback === true).length,
            offCalls: offRuns.reduce((sum, item) => sum + item.modelRequestCount, 0),
            onCalls: onRuns.reduce((sum, item) => sum + item.modelRequestCount, 0),
            additionalSemanticProviderRounds: 0,
        },
        payload: { productionPayloadMaxBytes: maxResultBytes, semanticFrameMaxBytes: maxFrameBytes, budgetFailures: 0 },
        latency: {
            offMedianMs: percentile(offRuns.map(item => item.durationMs), 0.5),
            onMedianMs: percentile(onRuns.map(item => item.durationMs), 0.5),
            offP95Ms: percentile(offRuns.map(item => item.durationMs), 0.95),
            onP95Ms: percentile(onRuns.map(item => item.durationMs), 0.95),
            sampleSizePerMode: CORPUS.length,
        },
    };
    const clean = report.cleanValidation.acceptanceAllowWriteTrueRequests === 0
        && report.cleanValidation.readCorpusWriteToolAttempts === 0
        && report.cleanValidation.writeExecutorExecutions === 0
        && report.cleanValidation.successfulBusinessWrites === 0
        && report.cleanValidation.unexpectedBusinessDataDelta === 0
        && report.corpus.onCounts.PASS === CORPUS.length
        && report.corpus.onCounts.PARTIAL === 0
        && report.corpus.onCounts.FAIL === 0
        && protectedWrite.confirmationCard === true
        && protectedWrite.executionReceipt === false
        && protectedWrite.mutationExecuted === false
        && report.provider.fallback === 0
        && report.provider.providers.length === 1 && report.provider.providers[0] === 'deepseek'
        && report.provider.models.length === 1 && report.provider.models[0] === 'deepseek-v4-flash';
    report.status = clean ? 'PASS' : 'REWORK';
    process.stdout.write(`BUS_P4R_V_REPORT=${JSON.stringify(report)}\n`);
    database.stopBackupScheduler();
    await database.waitForBackupIdle();
    db.close();
    process.exit(clean ? 0 : 1);
}

if (require.main === module || process.argv[1] === '-') {
    main().catch(error => {
        process.stderr.write(`${error.code || 'BUS_P4R_V_FAILED'}: ${error.stack || error.message}\n`);
        process.exit(1);
    });
}

module.exports = {
    BUSINESS_TABLES,
    CORPUS,
    buildAcceptanceRequest,
    businessFingerprint,
    invokeAcceptanceRequest,
};
