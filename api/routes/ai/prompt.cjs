const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { getConfig, setConfig } = require('../../db.cjs');
const authMiddleware = require('../../authMiddleware.cjs');

const FACTORY_PROFILE_KEY = 'ai-factory-profile';
const LEGACY_PROMPT_KEY = 'ai-system-prompt';
const LEGACY_BACKUP_KEY = 'ai-system-prompt-legacy-backup';
const LEGACY_DEFAULT_PROMPT_SHA256 = '9432678b30f88da9ea31acb3b7ebc90bf774a4cfa0316a7d902c08b44be399e6';
const FACTORY_PROFILE_MAX_LENGTH = 8000;

const DEFAULT_FACTORY_PROFILE = `- 当前系统主要由一名工厂管理者使用，回答围绕效率，不安排负责人。
- 优先给出可立即执行的最短路径，同时保留必要的核对和追溯信息。
- 尊重工厂已经确认的术语和操作习惯；不确定的新俗称先澄清，不自行类推。`;

let factoryProfile = DEFAULT_FACTORY_PROFILE;

function promptAuth(req, res, next) {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
        return next();
    }
    return authMiddleware(req, res, next);
}

function hashPrompt(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function validateFactoryProfile(value) {
    const profile = typeof value === 'string' ? value.trim() : '';
    if (!profile) throw new Error('工厂配置不能为空');
    if (profile.length > FACTORY_PROFILE_MAX_LENGTH) {
        throw new Error(`工厂配置不能超过 ${FACTORY_PROFILE_MAX_LENGTH} 个字符`);
    }
    const forbiddenPatterns = [
        /忽略.*(?:核心|系统|安全).*规则/i,
        /绕过.*确认/i,
        /直接(?:写入|修改).*数据库/i,
        /不(?:需要|用).*工具.*(?:查询|调用)/i,
        /伪造.*(?:来源|数据|结果)/i,
    ];
    if (forbiddenPatterns.some(pattern => pattern.test(profile))) {
        throw new Error('工厂配置不能覆盖核心安全、数据来源或写入确认规则');
    }
    return profile;
}

function loadSystemPromptFromDB(options = {}) {
    const accessors = options.accessors || { getConfig, setConfig };
    try {
        const savedProfile = accessors.getConfig(FACTORY_PROFILE_KEY);
        if (savedProfile) {
            factoryProfile = validateFactoryProfile(savedProfile);
            console.log('[AI] 工厂配置已从数据库加载, 长度:', factoryProfile.length);
            return 1;
        }

        const legacyPrompt = accessors.getConfig(LEGACY_PROMPT_KEY);
        if (!legacyPrompt) {
            factoryProfile = DEFAULT_FACTORY_PROFILE;
            return null;
        }

        if (!accessors.getConfig(LEGACY_BACKUP_KEY)) {
            accessors.setConfig(LEGACY_BACKUP_KEY, legacyPrompt);
        }
        const legacyProfile = hashPrompt(legacyPrompt) === LEGACY_DEFAULT_PROMPT_SHA256
            ? DEFAULT_FACTORY_PROFILE
            : String(legacyPrompt).trim();
        try {
            factoryProfile = validateFactoryProfile(legacyProfile);
        } catch (error) {
            factoryProfile = DEFAULT_FACTORY_PROFILE;
            console.warn(`[AI] 旧 System Prompt 不符合当前工厂配置边界，仅保留备份: ${error.message}`);
        }
        accessors.setConfig(FACTORY_PROFILE_KEY, factoryProfile);
        console.log('[AI] 旧 System Prompt 已备份并迁移为工厂配置, 长度:', factoryProfile.length);
        return 1;
    } catch (err) {
        factoryProfile = DEFAULT_FACTORY_PROFILE;
        console.error('[AI] 加载工厂配置失败，已使用默认配置:', err.message);
        return null;
    }
}

router.get('/api/ai/system-prompt', promptAuth, (req, res) => {
    res.json({ success: true, data: factoryProfile });
});

router.put('/api/ai/system-prompt', promptAuth, (req, res) => {
    try {
        const profile = validateFactoryProfile(req.body?.prompt);
        factoryProfile = profile;
        setConfig(FACTORY_PROFILE_KEY, profile);
        res.json({ success: true });
    } catch (err) {
        const status = /不能为空|不能超过|不能覆盖/.test(err.message) ? 400 : 500;
        res.status(status).json({ success: false, error: err.message });
    }
});

function getFactoryProfile() {
    return factoryProfile;
}

module.exports = {
    DEFAULT_FACTORY_PROFILE,
    FACTORY_PROFILE_KEY,
    FACTORY_PROFILE_MAX_LENGTH,
    LEGACY_BACKUP_KEY,
    LEGACY_PROMPT_KEY,
    getFactoryProfile,
    loadSystemPromptFromDB,
    router,
    validateFactoryProfile,
};
