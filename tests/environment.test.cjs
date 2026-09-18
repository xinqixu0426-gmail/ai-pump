const test = require('node:test');
const assert = require('node:assert/strict');

const {
    REQUIRED_PRODUCTION_ENV,
    assertProductionEnvironment,
    getMcpAllowedHosts,
    getMcpMaxResultBytes,
    getMcpRateLimit,
    getMcpWriteClientIds,
    getMcpWriteToolsForClient,
    getInternalApiTimeoutMs,
    getServerPort,
    isMcpEnabled,
    isMcpWriteAllowedForClient,
    isMcpWriteEnabled,
    isProductionEnvironment,
    parseCorsOrigins,
    parseMcpServiceTokens,
    parseMcpWriteToolAllowlists,
    validateProductionEnvironment,
} = require('../api/services/environment.cjs');

function validProductionEnv(overrides = {}) {
    return {
        ACCESS_PASSWORD: 'access-password',
        JWT_SECRET: 'production-jwt-secret',
        INTERNAL_SECRET: 'internal-secret',
        CORS_ORIGIN: 'https://pump.example.com',
        PORT: '3002',
        INTERNAL_API_TIMEOUT_MS: '15000',
        ...overrides,
    };
}

test('运行环境：保留 Windows 开发和非 Windows 部署模式判定', () => {
    assert.equal(isProductionEnvironment({ NODE_ENV: 'development' }, 'win32'), false);
    assert.equal(isProductionEnvironment({ NODE_ENV: 'production' }, 'win32'), true);
    assert.equal(isProductionEnvironment({ NODE_ENV: 'development' }, 'darwin'), false);
    assert.equal(isProductionEnvironment({ NODE_ENV: 'test' }, 'darwin'), false);
    assert.equal(isProductionEnvironment({}, 'darwin'), true);
    assert.equal(isProductionEnvironment({ NODE_ENV: 'development', BEHIND_PROXY: 'true' }, 'linux'), true);
});

test('运行环境：端口和内部 API 超时只接受安全范围内整数', () => {
    assert.equal(getServerPort({}), 3002);
    assert.equal(getServerPort({ PORT: '3100' }), 3100);
    assert.throws(() => getServerPort({ PORT: '0' }), /PORT 必须是 1-65535 的整数/);
    assert.throws(() => getServerPort({ PORT: '3002.5' }), /PORT/);

    assert.equal(getInternalApiTimeoutMs({}), 15000);
    assert.equal(getInternalApiTimeoutMs({ INTERNAL_API_TIMEOUT_MS: '5000' }), 5000);
    assert.throws(
        () => getInternalApiTimeoutMs({ INTERNAL_API_TIMEOUT_MS: 'NaN' }),
        /INTERNAL_API_TIMEOUT_MS/
    );
    assert.throws(
        () => getInternalApiTimeoutMs({ INTERNAL_API_TIMEOUT_MS: '999' }),
        /1000-120000/
    );
});

test('运行环境：CORS 来源去空白并排除空项', () => {
    assert.deepEqual(
        parseCorsOrigins(' https://a.example.com, ,https://b.example.com '),
        ['https://a.example.com', 'https://b.example.com']
    );
    assert.deepEqual(parseCorsOrigins(''), []);
});

test('运行环境：通用 MCP 默认关闭，支持多 Agent 独立强 token 和有界资源参数', () => {
    assert.equal(isMcpEnabled({}), false);
    assert.equal(isMcpEnabled({ MCP_ENABLED: 'true' }), true);
    assert.equal(isMcpWriteEnabled({}), false);
    assert.equal(isMcpWriteEnabled({ MCP_WRITE_ENABLED: 'true' }), true);
    assert.equal(getMcpRateLimit({}), 60);
    assert.equal(getMcpMaxResultBytes({}), 262144);
    assert.throws(
        () => getMcpRateLimit({ MCP_RATE_LIMIT_PER_MINUTE: '0' }),
        /1-600/
    );
    assert.throws(
        () => getMcpMaxResultBytes({ MCP_MAX_RESULT_BYTES: '1000' }),
        /16384-1048576/
    );
    assert.deepEqual(
        getMcpAllowedHosts({
            CORS_ORIGIN: 'https://pump.example.com',
            MCP_ALLOWED_HOSTS: 'mcp.internal.example',
        }),
        ['localhost', '127.0.0.1', '::1', 'pump.example.com', 'mcp.internal.example']
    );

    const shortTokenErrors = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_TOKEN: 'short',
    }));
    assert.ok(shortTokenErrors.some(error => error.includes('至少需要 32 个字符')));

    const reusedToken = 'shared-mcp-token-0123456789abcdef';
    const reusedTokenErrors = validateProductionEnvironment(validProductionEnv({
        INTERNAL_SECRET: reusedToken,
        MCP_ENABLED: 'true',
        MCP_TOKEN: reusedToken,
    }));
    assert.ok(reusedTokenErrors.some(error => error.includes('不能与 INTERNAL_SECRET 相同')));

    assert.deepEqual(validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_TOKEN: '',
        MCP_SERVICE_TOKENS: JSON.stringify({
            hermes: 'independent-hermes-token-0123456789abcdef',
            codex: 'independent-codex-token-0123456789abcdef',
        }),
    })), []);
    assert.deepEqual(parseMcpServiceTokens({
        MCP_SERVICE_TOKENS: JSON.stringify({
            hermes: 'independent-hermes-token-0123456789abcdef',
            codex: 'independent-codex-token-0123456789abcdef',
        }),
    }).map(entry => entry.clientId), ['hermes', 'codex']);

    const writeEnv = {
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'hermes',
        MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
            hermes: ['sync_factory_knowledge'],
        }),
    };
    assert.deepEqual(getMcpWriteClientIds(writeEnv), ['hermes']);
    assert.deepEqual(parseMcpWriteToolAllowlists(writeEnv), {
        hermes: ['sync_factory_knowledge'],
    });
    assert.deepEqual(getMcpWriteToolsForClient('hermes', writeEnv), ['sync_factory_knowledge']);
    assert.deepEqual(getMcpWriteToolsForClient('codex', writeEnv), []);
    assert.equal(isMcpWriteAllowedForClient('hermes', writeEnv), true);
    assert.equal(isMcpWriteAllowedForClient('codex', writeEnv), false);

    const missingWriteIdentity = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_TOKEN: 'write-agent-token-0123456789abcdef',
        MCP_CLIENT_ID: 'agent',
        MCP_WRITE_ENABLED: 'true',
    }));
    assert.ok(missingWriteIdentity.some(error => error.includes('MCP_WRITE_CLIENT_IDS')));

    const unknownWriteIdentity = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_TOKEN: 'write-agent-token-0123456789abcdef',
        MCP_CLIENT_ID: 'agent',
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'unknown',
        MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
            unknown: ['sync_factory_knowledge'],
        }),
    }));
    assert.ok(unknownWriteIdentity.some(error => error.includes('没有对应 token')));

    assert.deepEqual(validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_TOKEN: 'write-agent-token-0123456789abcdef',
        MCP_CLIENT_ID: 'agent',
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'agent',
        MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
            agent: ['sync_factory_knowledge'],
        }),
    })), []);

    const missingWriteToolAllowlist = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_TOKEN: 'write-agent-token-0123456789abcdef',
        MCP_CLIENT_ID: 'agent',
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'agent',
    }));
    assert.ok(missingWriteToolAllowlist.some(error => error.includes('缺少工具白名单')));

    const invalidWriteToolAllowlists = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_TOKEN: 'write-agent-token-0123456789abcdef',
        MCP_CLIENT_ID: 'agent',
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'agent',
        MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
            agent: ['unknown_write_tool'],
        }),
    }));
    assert.ok(invalidWriteToolAllowlists.some(error => error.includes('未知工具')));

    const emptyWriteToolAllowlist = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_TOKEN: 'write-agent-token-0123456789abcdef',
        MCP_CLIENT_ID: 'agent',
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'agent',
        MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({ agent: [] }),
    }));
    assert.ok(emptyWriteToolAllowlist.some(error => error.includes('不能为空')));

    const duplicateWriteToolAllowlist = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_TOKEN: 'write-agent-token-0123456789abcdef',
        MCP_CLIENT_ID: 'agent',
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'agent',
        MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
            agent: ['sync_factory_knowledge', 'sync_factory_knowledge'],
        }),
    }));
    assert.ok(duplicateWriteToolAllowlist.some(error => error.includes('重复工具')));

    const malformedWriteToolAllowlists = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_TOKEN: 'write-agent-token-0123456789abcdef',
        MCP_CLIENT_ID: 'agent',
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'agent',
        MCP_WRITE_TOOL_ALLOWLISTS: '{invalid',
    }));
    assert.ok(malformedWriteToolAllowlists.some(error => error.includes('JSON 对象')));

    const unlistedWriteToolIdentity = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_SERVICE_TOKENS: JSON.stringify({
            agent: 'write-agent-token-0123456789abcdef',
            observer: 'observer-agent-token-0123456789abcdef',
        }),
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'agent',
        MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
            agent: ['sync_factory_knowledge'],
            observer: ['create_order'],
        }),
    }));
    assert.ok(unlistedWriteToolIdentity.some(error => error.includes('未列入 MCP_WRITE_CLIENT_IDS')));

    // 旧 NAS 部署可在一个兼容周期内不改环境变量直接升级。
    assert.equal(isMcpEnabled({ HERMES_MCP_ENABLED: 'true' }), true);
    assert.deepEqual(parseMcpServiceTokens({
        HERMES_MCP_TOKEN: 'legacy-hermes-token-0123456789abcdef',
    }), [{ clientId: 'hermes', token: 'legacy-hermes-token-0123456789abcdef' }]);

    const invalidJsonErrors = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_SERVICE_TOKENS: '{invalid',
    }));
    assert.ok(invalidJsonErrors.some(error => error.includes('JSON 对象')));

    const duplicatedToken = 'duplicate-agent-token-0123456789abcdef';
    const duplicateErrors = validateProductionEnvironment(validProductionEnv({
        MCP_ENABLED: 'true',
        MCP_SERVICE_TOKENS: JSON.stringify({
            hermes: duplicatedToken,
            codex: duplicatedToken,
        }),
    }));
    assert.ok(duplicateErrors.some(error => error.includes('不能复用同一个 token')));
});

test('运行环境：生产校验集中报告缺失项、默认密钥和无效数值', () => {
    assert.deepEqual(validateProductionEnvironment(validProductionEnv()), []);
    assert.deepEqual(REQUIRED_PRODUCTION_ENV, [
        'ACCESS_PASSWORD',
        'JWT_SECRET',
        'INTERNAL_SECRET',
        'CORS_ORIGIN',
    ]);

    const errors = validateProductionEnvironment(validProductionEnv({
        ACCESS_PASSWORD: '',
        JWT_SECRET: 'dev_jwt_secret',
        CORS_ORIGIN: ' , ',
        PORT: '70000',
        INTERNAL_API_TIMEOUT_MS: '0',
    }));
    assert.ok(errors.some(error => error.includes('ACCESS_PASSWORD')));
    assert.ok(errors.some(error => error.includes('开发或历史默认值')));
    assert.ok(errors.some(error => error.includes('有效的 CORS_ORIGIN')));
    assert.ok(errors.some(error => error.includes('PORT')));
    assert.ok(errors.some(error => error.includes('INTERNAL_API_TIMEOUT_MS')));
    assert.throws(
        () => assertProductionEnvironment(validProductionEnv({ JWT_SECRET: 'fallback_secret' })),
        /JWT_SECRET 不能使用开发或历史默认值/
    );
});
