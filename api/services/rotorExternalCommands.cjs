const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    beginPersistentExternalCommand,
    CommandExecutionError,
    updatePersistentExternalCommand,
} = require('./commandExecution.cjs');
const {
    consumeBusinessConfirmation,
    issueBusinessConfirmation,
} = require('./businessConfirmation.cjs');
const {
    buildFcParams,
    normalizeDrawingName,
} = require('./rotorParameters.cjs');
const { resolveDrawingFile } = require('./rotorCommands.cjs');

const DRAW_CAPABILITY_ID = requireBusinessCapability(
    'drawings.rotor.generate_pdf'
).capabilityId;
const PRINT_CAPABILITY_ID = requireBusinessCapability(
    'drawings.rotor.print_pdf'
).capabilityId;

function rotorExternalError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function commandInput(input = {}) {
    const {
        confirmationToken: _confirmationToken,
        idempotencyKey: _idempotencyKey,
        ...params
    } = input || {};
    return params;
}

function requireExplicitIdempotency(commandContext) {
    if ((commandContext.warnings || []).some(
        warning => warning.code === 'idempotency_key_missing_compatibility'
    )) {
        throw rotorExternalError(
            'idempotency_key_required',
            '外部副作用命令必须提供 Idempotency-Key 或 idempotencyKey',
            400
        );
    }
}

function normalizeDrawInput(input = {}) {
    const params = commandInput(input);
    if (!params || Object.keys(params).length === 0) {
        throw rotorExternalError(
            'rotor_parameters_missing',
            '缺少参数，请至少提供一项出图参数',
            400
        );
    }
    const { fcParams, errors } = buildFcParams(params);
    if (errors.length > 0) {
        throw rotorExternalError('rotor_parameters_invalid', errors.join('; '), 400);
    }
    if (Object.keys(fcParams).filter(key => !key.startsWith('_')).length === 0) {
        throw rotorExternalError(
            'rotor_parameters_empty',
            '未提取到有效参数',
            400
        );
    }
    return {
        params,
        fcParams,
        drawingName: normalizeDrawingName(
            params.drawingName ?? params.drawing_name
        ),
        source: String(params.source || `[API] ${JSON.stringify(params)}`).slice(0, 4000),
    };
}

function buildDrawPreview(input, subject) {
    const normalized = normalizeDrawInput(input);
    const confirmation = issueBusinessConfirmation({
        capabilityId: DRAW_CAPABILITY_ID,
        input: normalized,
        subject,
    });
    return {
        capabilityId: DRAW_CAPABILITY_ID,
        operationId: confirmation.operationId,
        confirmationToken: confirmation.confirmationToken,
        inputHash: confirmation.inputHash,
        expiresAt: confirmation.expiresAt,
        suggestedIdempotencyKey: `rotor-draw:${confirmation.operationId}`,
        drawingName: normalized.drawingName,
        params: normalized.fcParams,
        warnings: [],
    };
}

function getPrintableDrawing(dependencies, jobIdValue) {
    const jobId = String(jobIdValue || '').trim();
    if (!jobId) {
        throw rotorExternalError('rotor_job_id_required', '缺少 jobId', 400);
    }
    const row = dependencies.db.prepare(
        'SELECT * FROM rotor_drawings WHERE job_id = ?'
    ).get(jobId);
    if (!row) {
        throw rotorExternalError('rotor_job_not_found', '找不到此任务', 404);
    }
    if (row.status !== 'success') {
        throw rotorExternalError(
            'rotor_job_not_printable',
            '该任务尚未成功完成，无法打印',
            409
        );
    }
    const pdfPath = resolveDrawingFile(dependencies.publicDir, row.file_url);
    if (!pdfPath || !dependencies.fileSystem.existsSync(pdfPath)) {
        throw rotorExternalError(
            'rotor_pdf_not_found',
            `PDF 文件不存在: ${row.file_url || ''}`,
            404
        );
    }
    return { row, jobId, pdfPath };
}

function buildPrintPreview(dependencies, jobId, subject) {
    const printable = getPrintableDrawing(dependencies, jobId);
    const input = {
        historyId: Number(printable.row.id),
        jobId: printable.jobId,
        fileUrl: printable.row.file_url,
        expectedUpdatedAt: printable.row.updated_at || null,
    };
    const confirmation = issueBusinessConfirmation({
        capabilityId: PRINT_CAPABILITY_ID,
        input,
        subject,
    });
    return {
        capabilityId: PRINT_CAPABILITY_ID,
        operationId: confirmation.operationId,
        confirmationToken: confirmation.confirmationToken,
        inputHash: confirmation.inputHash,
        expiresAt: confirmation.expiresAt,
        suggestedIdempotencyKey: `rotor-print:${confirmation.operationId}`,
        jobId: printable.jobId,
        drawingName: printable.row.drawing_name || '',
        fileUrl: printable.row.file_url,
        warnings: [{
            code: 'external_print_side_effect',
            message: '确认后将向当前服务器的默认打印机发送一次打印任务',
        }],
    };
}

function createRotorExternalCommands(dependencies = {}) {
    const serviceDependencies = {
        fileSystem: fs,
        platform: os.platform(),
        execFile,
        execFileSync,
        freecadBin: process.env.FREECAD_BIN || (
            os.platform() === 'darwin'
                ? '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD'
                : 'C:\\Program Files\\FreeCAD 1.1\\bin\\freecad.exe'
        ),
        workerScript: path.join(__dirname, '../../freecad/worker.py'),
        publicDir: path.join(__dirname, '../../public'),
        maxConcurrent: 2,
        ...dependencies,
    };
    const activeJobs = new Map();
    let runningJobs = 0;

    function updateDrawing(historyId, updates, auditContext) {
        return serviceDependencies.safeUpdate(
            'rotor_drawings',
            historyId,
            updates,
            auditContext
        );
    }

    function updateOperation(operationId, status, data, terminal = false) {
        return updatePersistentExternalCommand({
            db: serviceDependencies.db,
            operationId,
            status,
            data,
            terminal,
        });
    }

    function persistDrawingState(job, drawingUpdates, operationStatus, operationData, terminal = false) {
        const persist = serviceDependencies.db.transaction(() => {
            updateDrawing(job.historyId, drawingUpdates, job.auditContext);
            return updateOperation(
                job.operationId,
                operationStatus,
                operationData,
                terminal
            );
        });
        return persist.immediate();
    }

    function failDrawing(job, message) {
        const error = String(message || '出图失败').slice(0, 1000);
        activeJobs.set(job.jobId, {
            status: 'failed',
            error,
            drawingName: job.drawingName,
            doneAt: Date.now(),
        });
        try {
            persistDrawingState(
                job,
                { status: 'failed', error },
                'failed',
                { error },
                true
            );
        } catch (updateError) {
            console.error('[Rotor] 出图失败状态保存异常:', updateError.message);
        }
    }

    function launchDrawing(job) {
        runningJobs += 1;
        activeJobs.set(job.jobId, {
            status: 'processing',
            drawingName: job.drawingName,
        });
        persistDrawingState(
            job,
            { status: 'processing' },
            'processing',
            {}
        );

        const workerParams = { ...job.fcParams, _jobId: job.jobId };
        serviceDependencies.execFile(
            serviceDependencies.freecadBin,
            [
                serviceDependencies.workerScript,
                '--pass',
                JSON.stringify(workerParams),
            ],
            {
                maxBuffer: 10 * 1024 * 1024,
                timeout: 180000,
                killSignal: 'SIGKILL',
            },
            (error, stdout, stderr) => {
                runningJobs = Math.max(0, runningJobs - 1);
                if (stdout) console.log('[Rotor] FreeCAD stdout:\n' + stdout);
                if (stderr) console.error('[Rotor] FreeCAD stderr:\n' + stderr);
                if (error) return failDrawing(job, error.message);

                const srcPdf = path.join(
                    path.dirname(serviceDependencies.workerScript),
                    `output_${job.jobId}.pdf`
                );
                const drawingsDir = path.join(serviceDependencies.publicDir, 'drawings');
                const outputFile = `output_${job.jobId}.pdf`;
                const destPdf = path.join(drawingsDir, outputFile);
                try {
                    if (!serviceDependencies.fileSystem.existsSync(srcPdf)) {
                        return failDrawing(job, '未找到 output PDF');
                    }
                    serviceDependencies.fileSystem.mkdirSync(drawingsDir, { recursive: true });
                    serviceDependencies.fileSystem.copyFileSync(srcPdf, destPdf);
                    serviceDependencies.fileSystem.unlinkSync(srcPdf);
                    const srcWork = path.join(
                        path.dirname(serviceDependencies.workerScript),
                        `work_${job.jobId}.FCStd`
                    );
                    if (serviceDependencies.fileSystem.existsSync(srcWork)) {
                        try {
                            serviceDependencies.fileSystem.unlinkSync(srcWork);
                        } catch {
                            // 临时工程文件清理失败不影响已生成的正式 PDF。
                        }
                    }
                    const fileUrl = `/drawings/${outputFile}`;
                    activeJobs.set(job.jobId, {
                        status: 'success',
                        fileUrl,
                        drawingName: job.drawingName,
                        doneAt: Date.now(),
                    });
                    persistDrawingState(
                        job,
                        { status: 'success', file_url: fileUrl, error: null },
                        'completed',
                        { fileUrl },
                        true
                    );
                } catch (fileError) {
                    failDrawing(job, `移动PDF失败: ${fileError.message}`);
                }
            }
        );
    }

    function executeDraw(input, commandContext, subject) {
        requireExplicitIdempotency(commandContext);
        const confirmation = consumeBusinessConfirmation({
            confirmationToken: input.confirmationToken,
            capabilityId: DRAW_CAPABILITY_ID,
            subject,
            idempotencyKey: commandContext.idempotencyKey,
        });
        const normalized = confirmation.input;
        const existingOperation = serviceDependencies.db.prepare(`
            SELECT 1
            FROM api_operations
            WHERE actor_key = ? AND capability_id = ? AND idempotency_key = ?
        `).get(
            commandContext.actorKey,
            DRAW_CAPABILITY_ID,
            commandContext.idempotencyKey
        );
        if (!existingOperation && runningJobs >= serviceDependencies.maxConcurrent) {
            throw rotorExternalError(
                'rotor_queue_full',
                `出图队列已满（最多 ${serviceDependencies.maxConcurrent} 个并发），请稍后再试`,
                429
            );
        }
        const context = {
            ...commandContext,
            operationId: confirmation.operationId,
        };
        const jobId = crypto.randomUUID();
        const started = beginPersistentExternalCommand({
            db: serviceDependencies.db,
            ...context,
            capabilityId: DRAW_CAPABILITY_ID,
            input: normalized,
            execute: ({ auditContext, operationId }) => {
                const now = new Date().toISOString();
                const write = serviceDependencies.safeInsert(
                    'rotor_drawings',
                    {
                        job_id: jobId,
                        drawing_name: normalized.drawingName,
                        nl_input: normalized.source,
                        params_json: JSON.stringify(normalized.params),
                        fc_params_json: JSON.stringify(normalized.fcParams),
                        status: 'queued',
                        created_at: now,
                        updated_at: now,
                    },
                    auditContext
                );
                const historyId = Number(write.lastInsertRowid);
                return {
                    data: {
                        historyId,
                        jobId,
                        drawingName: normalized.drawingName,
                        params: normalized.fcParams,
                        message: '出图任务已登记',
                    },
                    resource: { type: 'rotorDrawing', ids: [historyId] },
                    changes: [{
                        resourceType: 'rotorDrawing',
                        resourceId: historyId,
                        field: 'status',
                        from: null,
                        to: 'queued',
                    }],
                    auditIds: write.auditId ? [write.auditId] : [],
                    requiredAuditCount: 1,
                    operationId,
                };
            },
        });
        if (started.shouldExecute) {
            const receipt = started.receipt;
            const auditContext = {
                requireAudit: true,
                user: context.actorKey,
                requestId: context.requestId || null,
                operationId: receipt.operationId,
                capabilityId: DRAW_CAPABILITY_ID,
            };
            try {
                launchDrawing({
                    historyId: receipt.historyId,
                    jobId: receipt.jobId,
                    drawingName: receipt.drawingName,
                    fcParams: normalized.fcParams,
                    operationId: receipt.operationId,
                    auditContext,
                });
            } catch (error) {
                failDrawing({
                    historyId: receipt.historyId,
                    jobId: receipt.jobId,
                    drawingName: receipt.drawingName,
                    operationId: receipt.operationId,
                    auditContext,
                }, error.message);
            }
        }
        return started.receipt;
    }

    function sendPrint(pdfPath) {
        let lastError = '';
        if (serviceDependencies.platform === 'darwin') {
            serviceDependencies.execFileSync('lp', [pdfPath], { timeout: 30000 });
            return 'lp';
        }
        try {
            serviceDependencies.execFileSync('where', ['SumatraPDF'], { timeout: 3000 });
            serviceDependencies.execFileSync(
                'SumatraPDF',
                ['-print-to-default', '-silent', pdfPath],
                { timeout: 30000 }
            );
            return 'SumatraPDF';
        } catch (error) {
            lastError = error.message;
        }
        const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
        if (serviceDependencies.fileSystem.existsSync(edgePath)) {
            try {
                serviceDependencies.execFileSync(
                    edgePath,
                    [
                        '--headless',
                        '--disable-gpu',
                        '--print-to-pdf-no-header',
                        '--no-pdf-header-footer',
                        '--print-to-default-printer',
                        pdfPath,
                    ],
                    { timeout: 30000 }
                );
                return 'Edge';
            } catch (error) {
                lastError = error.message;
            }
        }
        try {
            serviceDependencies.execFileSync(
                'rundll32.exe',
                ['mshtml.dll,PrintHTML', pdfPath],
                { timeout: 15000 }
            );
            return 'rundll32';
        } catch (error) {
            lastError = error.message;
        }
        throw rotorExternalError(
            'rotor_print_failed',
            `所有打印方式均失败: ${lastError}`,
            500
        );
    }

    function executePrint(input, commandContext, subject) {
        requireExplicitIdempotency(commandContext);
        const confirmation = consumeBusinessConfirmation({
            confirmationToken: input.confirmationToken,
            capabilityId: PRINT_CAPABILITY_ID,
            subject,
            idempotencyKey: commandContext.idempotencyKey,
        });
        const printable = getPrintableDrawing(
            serviceDependencies,
            confirmation.input.jobId
        );
        if (
            Number(printable.row.id) !== Number(confirmation.input.historyId)
            || printable.row.file_url !== confirmation.input.fileUrl
            || (printable.row.updated_at || null) !== confirmation.input.expectedUpdatedAt
        ) {
            throw rotorExternalError(
                'confirmation_resource_changed',
                '图纸在预览后已变化，请重新预览再打印',
                409
            );
        }
        const context = {
            ...commandContext,
            operationId: confirmation.operationId,
        };
        const started = beginPersistentExternalCommand({
            db: serviceDependencies.db,
            ...context,
            capabilityId: PRINT_CAPABILITY_ID,
            input: confirmation.input,
            execute: ({ auditContext }) => {
                const auditId = serviceDependencies.writeAuditLog(
                    'EXTERNAL_PRINT_REQUESTED',
                    'rotor_drawings',
                    Number(printable.row.id),
                    null,
                    JSON.stringify({
                        jobId: printable.jobId,
                        fileUrl: printable.row.file_url,
                    }),
                    auditContext.user,
                    auditContext
                );
                return {
                    data: {
                        historyId: Number(printable.row.id),
                        jobId: printable.jobId,
                        fileUrl: printable.row.file_url,
                        message: '打印任务已登记',
                    },
                    resource: {
                        type: 'rotorDrawing',
                        ids: [Number(printable.row.id)],
                    },
                    changes: [{
                        resourceType: 'rotorDrawing',
                        resourceId: Number(printable.row.id),
                        field: 'printRequested',
                        from: null,
                        to: true,
                    }],
                    auditIds: [auditId],
                    requiredAuditCount: 1,
                };
            },
        });
        if (!started.shouldExecute) return started.receipt;
        function persistPrintResult(status, data) {
            const persist = serviceDependencies.db.transaction(() => {
                const resultAuditId = serviceDependencies.writeAuditLog(
                    status === 'completed'
                        ? 'EXTERNAL_PRINT_COMPLETED'
                        : 'EXTERNAL_PRINT_FAILED',
                    'rotor_drawings',
                    Number(printable.row.id),
                    null,
                    JSON.stringify({
                        jobId: printable.jobId,
                        fileUrl: printable.row.file_url,
                        status,
                        ...data,
                    }),
                    context.actorKey,
                    {
                        requireAudit: true,
                        user: context.actorKey,
                        requestId: context.requestId || null,
                        operationId: started.receipt.operationId,
                        capabilityId: PRINT_CAPABILITY_ID,
                    }
                );
                return updateOperation(
                    started.receipt.operationId,
                    status,
                    {
                        ...data,
                        auditIds: [
                            ...(started.receipt.auditIds || []),
                            resultAuditId,
                        ],
                    },
                    true
                );
            });
            return persist.immediate();
        }
        let printDriver;
        try {
            printDriver = sendPrint(printable.pdfPath);
        } catch (error) {
            return persistPrintResult(
                'failed',
                { error: error.message, message: '打印失败' }
            );
        }
        try {
            return persistPrintResult(
                'completed',
                {
                    message: '打印指令已发送到默认打印机',
                    printDriver,
                }
            );
        } catch {
            throw rotorExternalError(
                'rotor_print_result_persistence_failed',
                '打印指令可能已发送，但结果审计保存失败；请使用同一 idempotencyKey 核对，禁止重新签发打印',
                500
            );
        }
    }

    function cleanupActiveJobs(now = Date.now()) {
        for (const [jobId, job] of activeJobs) {
            if (job.doneAt && now - job.doneAt > 120000) activeJobs.delete(jobId);
        }
    }

    return {
        activeJobs,
        buildDrawPreview,
        buildPrintPreview: (jobId, subject) => buildPrintPreview(
            serviceDependencies,
            jobId,
            subject
        ),
        cleanupActiveJobs,
        executeDraw,
        executePrint,
    };
}

module.exports = {
    DRAW_CAPABILITY_ID,
    PRINT_CAPABILITY_ID,
    buildDrawPreview,
    buildPrintPreview,
    createRotorExternalCommands,
    normalizeDrawInput,
};
