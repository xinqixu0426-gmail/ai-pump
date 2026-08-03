const { Router } = require('express');
const { db, setSetting } = require('../db.cjs');
const {
    commandContextFromRequest,
    sendCommandError,
} = require('../services/commandRequest.cjs');
const {
    ALLOWED_SETTINGS,
    UPDATE_CAPABILITY_ID: BUSINESS_SETTING_UPDATE_CAPABILITY_ID,
    executeBusinessSettingUpdate,
} = require('../services/businessSettingCommands.cjs');
const {
    buildCandidateAiEnvironment,
    publicSnapshot,
} = require('../services/runtimeConfig.cjs');
const {
    UPDATE_RUNTIME_CAPABILITY_ID,
    executeRuntimeSettingsUpdate,
} = require('../services/runtimeSettingCommands.cjs');
const {
    fetchAiProvider,
    resolveAiProviderConfig,
    resolveProviderConfig,
} = require('../services/aiProvider.cjs');
const {
    createSettingsQueries,
} = require('../services/settingsQueries.cjs');
const router = Router();
const settingsQueries = createSettingsQueries({
    allowedSettings: ALLOWED_SETTINGS,
    buildCandidateAiEnvironment,
    db,
    fetchAiProvider,
    publicRuntimeSnapshot: publicSnapshot,
    resolveAiProviderConfig,
    resolveProviderConfig,
});

function runtimeError(res, error, fallback = '运行设置操作失败') {
    const message = String(error?.message || fallback)
        .replace(/sk-[a-zA-Z0-9_-]{12,}/g, '[已隐藏密钥]');
    return res.status(400).json({ success: false, error: message });
}

router.get('/runtime', (_req, res) => {
    try {
        res.json({
            success: true,
            data: settingsQueries.getRuntimeSettings(),
        });
    } catch (error) {
        runtimeError(res, error, '运行设置读取失败');
    }
});

router.put('/runtime', (req, res) => {
    try {
        const result = executeRuntimeSettingsUpdate(
            {
                dbAccessors: require('../db.cjs'),
                env: process.env,
            },
            req.body || {},
            commandContextFromRequest(
                req,
                UPDATE_RUNTIME_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: result,
            changed: result.changed,
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.post('/runtime/test-ai', async (req, res) => {
    try {
        res.json({
            success: true,
            data: await settingsQueries.testAiConnection(req.body || {}),
        });
    } catch (error) {
        runtimeError(res, error, 'AI 连接测试失败');
    }
});

router.get('/:key', (req, res) => {
    try {
        res.json({
            success: true,
            data: settingsQueries.getBusinessSetting(req.params.key),
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message,
        });
    }
});

router.put('/:key', (req, res) => {
    try {
        const result = executeBusinessSettingUpdate(
            { db, setSetting },
            req.params.key,
            req.body || {},
            commandContextFromRequest(
                req,
                BUSINESS_SETTING_UPDATE_CAPABILITY_ID
            )
        );
        res.json({
            success: true,
            data: {
                ...result,
                operationStatus: result.status,
                ...result.setting,
            },
        });
    } catch (error) {
        sendCommandError(res, error);
    }
});

router.get('/', (req, res) => {
    try {
        res.json({
            success: true,
            data: settingsQueries.getAllBusinessSettings(),
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

module.exports = router;
