const { Router } = require('express');
const path = require('path');
const {
    db,
    safeInsert,
    safeUpdate,
    hardDelete,
    writeAuditLog,
} = require('../db.cjs');
const {
    getRotorJobStatus,
    listRotorHistory,
    rotorHistoryRow,
} = require('../services/rotorHistory.cjs');
const {
    buildRecipeRotorDraft,
    buildTemplateRotorDraft,
    listOrderPumpModels,
    listRotorLinkTargets,
} = require('../services/rotorQueries.cjs');
const {
    DELETE_CAPABILITY_ID,
    LINK_CAPABILITY_ID,
    RENAME_CAPABILITY_ID,
    SAVE_CAPABILITY_ID,
    executeRotorHistoryDelete,
    executeRotorHistoryLink,
    executeRotorHistoryRename,
    executeRotorParameterSave,
} = require('../services/rotorCommands.cjs');
const {
    DRAW_CAPABILITY_ID,
    PRINT_CAPABILITY_ID,
    createRotorExternalCommands,
} = require('../services/rotorExternalCommands.cjs');
const {
    createRotorNaturalLanguageService,
} = require('../services/rotorNaturalLanguage.cjs');
const {
    commandActorKey,
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');

const router = Router();
const rotorExternalCommands = createRotorExternalCommands({
    db,
    safeInsert,
    safeUpdate,
    writeAuditLog,
    publicDir: path.join(__dirname, '../../public'),
});
const { activeJobs } = rotorExternalCommands;
const rotorNaturalLanguageService = createRotorNaturalLanguageService({
    buildDrawPreview: (input, actorKey) => (
        rotorExternalCommands.buildDrawPreview(input, actorKey)
    ),
});

function rotorSuccess(res, data) {
    res.json({ success: true, data, ...data });
}

function rotorError(res, statusCode, message) {
    res.status(statusCode).json({ success: false, error: message, status: 'error', message });
}

// 2分钟后自动清理已完成任务
const cleanupTimer = setInterval(
    () => rotorExternalCommands.cleanupActiveJobs(),
    30000
);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

// ═══════════════════════════════════════════════
// POST /draw-preview — 规范化出图参数并签发一次性确认凭证，不执行外部副作用
// ═══════════════════════════════════════════════
router.post('/draw-preview', (req, res) => {
    try {
        return rotorSuccess(
            res,
            rotorExternalCommands.buildDrawPreview(
                req.body,
                commandActorKey(req)
            )
        );
    } catch (e) {
        return sendCommandError(res, e);
    }
});

// ═══════════════════════════════════════════════
// POST /draw — 消费服务端绑定的确认凭证并登记 FreeCAD 外部命令
// ═══════════════════════════════════════════════
router.post('/draw', (req, res) => {
    try {
        const receipt = rotorExternalCommands.executeDraw(
            req.body || {},
            commandContextFromRequest(req, DRAW_CAPABILITY_ID),
            commandActorKey(req)
        );
        return rotorSuccess(res, receipt);
    } catch (e) {
        console.error('[Rotor] /draw 错误:', e);
        return sendCommandError(res, e);
    }
});

// ═══════════════════════════════════════════════
// POST /save — 保存暂定转子参数，不启动 FreeCAD
// ═══════════════════════════════════════════════
router.post('/save', (req, res) => {
    try {
        const receipt = executeRotorParameterSave(
            { db, safeInsert, rotorHistoryRow },
            req.body,
            commandContextFromRequest(req, SAVE_CAPABILITY_ID)
        );
        return rotorSuccess(res, receipt);
    } catch (e) {
        console.error('[Rotor] /save 错误:', e);
        return sendCommandError(res, e);
    }
});

// ═══════════════════════════════════════════════
// POST /chat — 自然语言出图（前端页面使用）
// ═══════════════════════════════════════════════
router.post('/chat', async (req, res) => {
    try {
        return rotorSuccess(
            res,
            await rotorNaturalLanguageService.preview(
                req.body || {},
                commandActorKey(req)
            )
        );
    } catch (e) {
        console.error('[Rotor] 路由错误:', e);
        return rotorError(res, e.statusCode || 500, e.message);
    }
});

// ═══════════════════════════════════════════════
// GET /status/:jobId — 查询出图任务状态
// ═══════════════════════════════════════════════
router.get('/status/:jobId', (req, res) => {
    const job = getRotorJobStatus(db, req.params.jobId, activeJobs);
    if (!job) return res.status(404).json({ success: false, status: 'not_found', message: '找不到此任务' });
    res.json({ success: true, data: job, ...job });
});

// ═══════════════════════════════════════════════
// GET /history — 出图历史记录
// ═══════════════════════════════════════════════
router.get('/history', (req, res) => {
    try {
        res.json({ success: true, data: listRotorHistory(db) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// PATCH /history/:id/name — 重命名图纸
router.patch('/history/:id/name', (req, res) => {
    try {
        const receipt = executeRotorHistoryRename(
            { db, safeUpdate, rotorHistoryRow },
            req.params.id,
            req.body,
            commandContextFromRequest(req, RENAME_CAPABILITY_ID)
        );
        const jobId = receipt.history?.jobId;
        if (jobId && activeJobs.has(jobId)) {
            const job = activeJobs.get(jobId);
            activeJobs.set(jobId, {
                ...job,
                drawingName: receipt.drawingName,
            });
        }
        return rotorSuccess(res, receipt);
    } catch (e) {
        return sendCommandError(res, e);
    }
});

// ═══════════════════════════════════════════════
// DELETE /history/:id — 删除出图记录
// ═══════════════════════════════════════════════
router.delete('/history/:id', (req, res) => {
    try {
        const receipt = executeRotorHistoryDelete(
            {
                db,
                hardDelete,
                publicDir: path.join(__dirname, '../../public'),
            },
            req.params.id,
            req.body,
            commandContextFromRequest(req, DELETE_CAPABILITY_ID)
        );
        if (receipt.jobId) activeJobs.delete(receipt.jobId);
        return rotorSuccess(res, receipt);
    } catch (e) {
        return sendCommandError(res, e);
    }
});
// ═══════════════════════════════════════════════
// POST /print/:jobId/preview — 校验图纸并签发打印确认凭证
// ═══════════════════════════════════════════════
router.post('/print/:jobId/preview', (req, res) => {
    try {
        return rotorSuccess(
            res,
            rotorExternalCommands.buildPrintPreview(
                req.params.jobId,
                commandActorKey(req)
            )
        );
    } catch (e) {
        return sendCommandError(res, e);
    }
});

// ═══════════════════════════════════════════════
// POST /print/:jobId — 消费确认凭证并幂等发送打印任务
// ═══════════════════════════════════════════════
router.post('/print/:jobId', (req, res) => {
    try {
        const receipt = rotorExternalCommands.executePrint(
            req.body || {},
            commandContextFromRequest(req, PRINT_CAPABILITY_ID),
            commandActorKey(req)
        );
        if (receipt.status === 'failed') {
            return res.status(500).json({
                success: false,
                code: 'rotor_print_failed',
                error: receipt.error || '打印失败',
                data: receipt,
                ...receipt,
            });
        }
        return rotorSuccess(res, receipt);
    } catch (e) {
        console.error('[Rotor] 打印失败:', e.message);
        return sendCommandError(res, e);
    }
});

// ═══════════════════════════════════════════════
// GET /order-pump-models — 获取订单中的水泵型号列表（供关联选择）
// ═══════════════════════════════════════════════
router.get('/order-pump-models', (req, res) => {
    try {
        res.json({ success: true, data: listOrderPumpModels(db) });
    } catch (e) {
        res.status(Number(e.statusCode) || 500).json({
            success: false,
            code: e.code || 'rotor_order_models_failed',
            error: e.message,
            requestId: req.requestId || null,
        });
    }
});

// ═══════════════════════════════════════════════
// POST /recipe-draft — 根据配方技术档案生成转子出图表单草稿，不写库
// ═══════════════════════════════════════════════
router.post('/recipe-draft', (req, res) => {
    try {
        res.json({
            success: true,
            data: buildRecipeRotorDraft(db, req.body?.recipeId),
        });
    } catch (e) {
        res.status(Number(e.statusCode) || 500).json({
            success: false,
            code: e.code || 'rotor_recipe_draft_failed',
            error: e.message,
            requestId: req.requestId || null,
        });
    }
});

// ═══════════════════════════════════════════════
// POST /template-draft — 根据泵壳模板/变体生成转子出图表单草稿，不写库
// ═══════════════════════════════════════════════
router.post('/template-draft', (req, res) => {
    try {
        res.json({
            success: true,
            data: buildTemplateRotorDraft(
                db,
                req.body?.templateId,
                req.body?.variantId
            ),
        });
    } catch (e) {
        res.status(Number(e.statusCode) || 500).json({
            success: false,
            code: e.code || 'rotor_template_draft_failed',
            error: e.message,
            requestId: req.requestId || null,
        });
    }
});

// ═══════════════════════════════════════════════
// GET /link-targets — 获取出图记录可关联对象（订单/变体/配方）
// ═══════════════════════════════════════════════
router.get('/link-targets', (req, res) => {
    try {
        res.json({ success: true, data: listRotorLinkTargets(db) });
    } catch (e) {
        res.status(Number(e.statusCode) || 500).json({
            success: false,
            code: e.code || 'rotor_link_targets_failed',
            error: e.message,
            requestId: req.requestId || null,
        });
    }
});

// ═══════════════════════════════════════════════
// PATCH /history/:id/link — 关联水泵型号到出图记录
// ═══════════════════════════════════════════════
router.patch('/history/:id/link', (req, res) => {
    try {
        const receipt = executeRotorHistoryLink(
            { db, safeUpdate, rotorHistoryRow },
            req.params.id,
            req.body,
            commandContextFromRequest(req, LINK_CAPABILITY_ID)
        );
        return rotorSuccess(res, receipt);
    } catch (e) {
        return sendCommandError(res, e);
    }
});

module.exports = router;
