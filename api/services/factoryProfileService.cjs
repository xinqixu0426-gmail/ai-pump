const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');

const UPDATE_FACTORY_PROFILE_CAPABILITY_ID = requireBusinessCapability(
    'ai.factory_profile.update'
).capabilityId;
const FACTORY_PROFILE_KEY = 'ai-factory-profile';
const LEGACY_PROMPT_KEY = 'ai-system-prompt';
const LEGACY_BACKUP_KEY = 'ai-system-prompt-legacy-backup';
const LEGACY_DEFAULT_PROMPT_SHA256 = '9432678b30f88da9ea31acb3b7ebc90bf774a4cfa0316a7d902c08b44be399e6';
const FACTORY_PROFILE_MAX_LENGTH = 8000;
const VERSION_RE = /^[a-f0-9]{64}$/;

const DEFAULT_FACTORY_PROFILE = `- 当前系统主要由一名工厂管理者使用，回答围绕效率，不安排负责人。
- 优先给出可立即执行的最短路径，同时保留必要的核对和追溯信息。
- 尊重工厂已经确认的术语和操作习惯；不确定的新俗称先澄清，不自行类推。`;

let factoryProfile = DEFAULT_FACTORY_PROFILE;

function hashPrompt(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
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

function factoryProfileSnapshot() {
    return {
        prompt: factoryProfile,
        version: hashPrompt(factoryProfile),
        sourceOfTruth: `config.${FACTORY_PROFILE_KEY}`,
    };
}

function getFactoryProfile() {
    return factoryProfile;
}

function loadSystemPromptFromDB(options = {}) {
    const accessors = options.accessors || require('../db.cjs');
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
    } catch (error) {
        factoryProfile = DEFAULT_FACTORY_PROFILE;
        console.error('[AI] 加载工厂配置失败，已使用默认配置:', error.message);
        return null;
    }
}

function normalizeExpectedVersion(value) {
    const expectedVersion = String(value || '').trim().toLowerCase();
    if (expectedVersion && !VERSION_RE.test(expectedVersion)) {
        throw new CommandExecutionError(
            'factory_profile_version_invalid',
            'expectedVersion 必须是 64 位 SHA-256 版本值',
            400
        );
    }
    return expectedVersion;
}

function currentPersistedProfile(dependencies) {
    const saved = dependencies.getConfig(FACTORY_PROFILE_KEY);
    return saved ? validateFactoryProfile(saved) : factoryProfile;
}

function executeFactoryProfileUpdate(
    dependencies,
    input = {},
    commandContext = {}
) {
    let profile;
    try {
        profile = validateFactoryProfile(input.prompt);
    } catch (error) {
        throw new CommandExecutionError(
            'factory_profile_invalid',
            error.message,
            400
        );
    }
    const expectedVersion = normalizeExpectedVersion(input.expectedVersion);
    const result = executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_FACTORY_PROFILE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'settings', eventType: 'updated' }),
        input: { prompt: profile, expectedVersion },
        warnings: [
            ...(commandContext.warnings || []),
            ...(!expectedVersion ? [{
                code: 'resource_version_missing_compatibility',
                message: '兼容调用未提供工厂配置 expectedVersion；建议先读取最新版本再保存',
            }] : []),
        ],
        execute: ({ auditContext }) => {
            const live = currentPersistedProfile(dependencies);
            const liveVersion = hashPrompt(live);
            if (expectedVersion && liveVersion !== expectedVersion) {
                throw new CommandExecutionError(
                    'resource_version_conflict',
                    '工厂配置已被其他操作修改，请刷新后重试',
                    409
                );
            }
            if (live === profile) {
                return {
                    data: {
                        profile: {
                            prompt: live,
                            version: liveVersion,
                        },
                    },
                    resource: {
                        type: 'factoryProfile',
                        ids: [FACTORY_PROFILE_KEY],
                    },
                    changes: [],
                    warnings: [{
                        code: 'no_change',
                        message: '工厂配置内容没有变化',
                    }],
                    auditIds: [],
                    requiredAuditCount: 0,
                };
            }
            const write = dependencies.setConfig(
                FACTORY_PROFILE_KEY,
                profile,
                auditContext
            );
            return {
                data: {
                    profile: {
                        prompt: profile,
                        version: hashPrompt(profile),
                    },
                },
                resource: {
                    type: 'factoryProfile',
                    ids: [FACTORY_PROFILE_KEY],
                },
                changes: [{
                    resourceType: 'factoryProfile',
                    resourceId: FACTORY_PROFILE_KEY,
                    field: 'prompt',
                    from: live,
                    to: profile,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
    factoryProfile = result.profile.prompt;
    return result;
}

module.exports = {
    DEFAULT_FACTORY_PROFILE,
    FACTORY_PROFILE_KEY,
    FACTORY_PROFILE_MAX_LENGTH,
    LEGACY_BACKUP_KEY,
    LEGACY_PROMPT_KEY,
    UPDATE_FACTORY_PROFILE_CAPABILITY_ID,
    executeFactoryProfileUpdate,
    factoryProfileSnapshot,
    getFactoryProfile,
    hashPrompt,
    loadSystemPromptFromDB,
    normalizeExpectedVersion,
    validateFactoryProfile,
};
