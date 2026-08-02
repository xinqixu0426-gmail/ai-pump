const test = require('node:test');
const assert = require('node:assert/strict');

const {
    REQUIRED_PRODUCTION_ENV,
    assertProductionEnvironment,
    getInternalApiTimeoutMs,
    getServerPort,
    isProductionEnvironment,
    parseCorsOrigins,
    validateProductionEnvironment,
} = require('../api/services/environment.cjs');

function validProductionEnv(overrides = {}) {
    return {
        ACCESS_PASSWORD: 'access-password',
        JWT_SECRET: 'production-jwt-secret',
        INTERNAL_SECRET: 'internal-secret',
        CORS_ORIGIN: 'https://pump.example.com',
        SIRI_API_TOKEN: 'siri-token',
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

test('运行环境：生产校验集中报告缺失项、默认密钥和无效数值', () => {
    assert.deepEqual(validateProductionEnvironment(validProductionEnv()), []);
    assert.deepEqual(REQUIRED_PRODUCTION_ENV, [
        'ACCESS_PASSWORD',
        'JWT_SECRET',
        'INTERNAL_SECRET',
        'CORS_ORIGIN',
        'SIRI_API_TOKEN',
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
