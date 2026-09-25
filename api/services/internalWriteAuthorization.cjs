'use strict';
/**
 * SEC-R0：内部共享密钥（INTERNAL_SECRET）只授权内部**只读**调用。
 *
 * 背景：历史上一个 INTERNAL_SECRET 值出现在公开的 Gitee 历史中，必须视为已泄露。
 * 而 api.cjs 的 /api 认证中间件曾允许 x-internal-secret 单独绕过 JWT 命中**正式业务写路由**，
 * 等于「持有该共享密钥即可改业务数据」。
 *
 * 本模块提供**窄范围**的机器写凭据判定：
 *   - 读：x-internal-secret 即可（既有内部通道，保持不变）
 *   - 写：除 x-internal-secret 外，还必须持有独立、专用的 x-internal-write-secret
 *   - 未配置专用写凭据 → 一律 fail closed（泄露的旧密钥因此不具备任何业务写权限）
 *
 * 严格要求：专用写凭据必须 ≥32 字符，且**不得**与 INTERNAL_SECRET 相同。
 * 该值只能来自环境/密钥存储，绝不写入仓库。
 */

const crypto = require('node:crypto');

const MUTATING_METHODS = Object.freeze(new Set(['POST', 'PUT', 'PATCH', 'DELETE']));
const MINIMUM_WRITE_SECRET_LENGTH = 32;

function isMutatingMethod(method) {
    return MUTATING_METHODS.has(String(method || '').toUpperCase());
}

function equalSecret(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
    const leftHash = crypto.createHash('sha256').update(left).digest();
    const rightHash = crypto.createHash('sha256').update(right).digest();
    return crypto.timingSafeEqual(leftHash, rightHash);
}

/** 返回生效的专用写凭据；未配置、过短或与 INTERNAL_SECRET 相同 → 返回空串（等价于未配置）。 */
function configuredInternalWriteSecret(env = process.env) {
    const value = String((env || {}).INTERNAL_WRITE_SECRET || '');
    if (value.length < MINIMUM_WRITE_SECRET_LENGTH) return '';
    const readSecret = String((env || {}).INTERNAL_SECRET || '');
    if (readSecret && equalSecret(value, readSecret)) return '';
    return value;
}

function internalWriteAuthorizationConfigured(env = process.env) {
    return configuredInternalWriteSecret(env) !== '';
}

/** 写操作是否被专用机器凭据授权。任何缺失/不匹配都返回 false（fail closed）。 */
function isInternalWriteAuthorized(req, env = process.env) {
    const expected = configuredInternalWriteSecret(env);
    if (!expected) return false;
    const supplied = String((req && req.headers && req.headers['x-internal-write-secret']) || '');
    return equalSecret(supplied, expected);
}

module.exports = {
    MUTATING_METHODS,
    MINIMUM_WRITE_SECRET_LENGTH,
    isMutatingMethod,
    configuredInternalWriteSecret,
    internalWriteAuthorizationConfigured,
    isInternalWriteAuthorized,
};
