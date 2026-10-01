'use strict';

const dns = require('node:dns').promises;
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const dotenv = require('dotenv');
const { resolveProviderConfig } = require('../../../api/services/aiProviderRegistry.cjs');
const { callDeepSeek } = require('./modelClient.cjs');

const execFileAsync = promisify(execFile);
const CONFIG_KEYS = Object.freeze(['AI_PROVIDER', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL', 'DEEPSEEK_API_KEY']);
const PROXY_KEYS = Object.freeze(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']);

function sourceFor(key, processValues, dotenvValues, forced = false) {
    if (forced) return 'EXPERIMENT_FORCED';
    if (Object.hasOwn(dotenvValues, key)) return 'DOTENV';
    if (Object.hasOwn(processValues, key)) return 'PROCESS_ENV';
    return 'DEFAULT';
}

function sanitizeValue(value) {
    const text = String(value || '');
    try {
        const url = new URL(text);
        if (url.username || url.password) {
            url.username = url.username ? 'REDACTED' : '';
            url.password = url.password ? 'REDACTED' : '';
        }
        return url.toString();
    } catch { return text; }
}

function serializeError(error, depth = 0) {
    if (!error || depth >= 3) return null;
    const details = error.details && typeof error.details === 'object'
        ? Object.fromEntries(Object.entries(error.details).filter(([key]) => !/key|authorization|token|secret/i.test(key)))
        : null;
    return Object.freeze({
        name: typeof error.name === 'string' ? error.name : null,
        code: error.code || null,
        message: String(error.message || '').replace(/Bearer\s+\S+/giu, 'Bearer REDACTED'),
        statusCode: Number.isFinite(error.statusCode) ? error.statusCode : null,
        retryable: error.retryable === true,
        fallbackEligible: error.fallbackEligible === true,
        details,
        errno: error.errno || null,
        syscall: error.syscall || null,
        hostname: error.hostname || null,
        cause: serializeError(error.cause, depth + 1),
    });
}

function loadSmokeEnvironment({ processValues = process.env, dotenvValues } = {}) {
    const parsed = dotenvValues || dotenv.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../../.env')));
    const env = { ...processValues, ...parsed, DEEPSEEK_MODEL: 'deepseek-chat' };
    return Object.freeze({ env, processValues, dotenvValues: parsed });
}

async function dnsResult(operation) {
    try { return Object.freeze({ status: 'PASS', value: await operation(), error: null }); }
    catch (error) { return Object.freeze({ status: 'FAIL', value: null, error: serializeError(error) }); }
}

async function systemDns(hostname) {
    try {
        const result = await execFileAsync('nslookup', [hostname], { timeout: 15_000, maxBuffer: 32 * 1024 });
        return Object.freeze({ status: 'PASS', summary: String(result.stdout || '').slice(0, 2000), error: null });
    } catch (error) {
        return Object.freeze({ status: 'FAIL', summary: String(error.stdout || '').slice(0, 2000), error: serializeError(error) });
    }
}

async function httpsConnectivity(baseUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(baseUrl, { method: 'GET', signal: controller.signal, redirect: 'manual' });
        return Object.freeze({ status: 'PASS', httpStatus: response.status, responseReceived: true, error: null });
    } catch (error) {
        return Object.freeze({ status: 'FAIL', httpStatus: null, responseReceived: false, error: serializeError(error) });
    } finally { clearTimeout(timer); }
}

function classifyFailure(diagnostics) {
    const error = diagnostics.minimalCall.error || diagnostics.https.error || diagnostics.dns.lookup.error;
    const chain = [error, error?.cause, error?.cause?.cause].filter(Boolean);
    const code = chain.map(item => item.code || item.errno || item.details?.causeCode).find(Boolean);
    if (code === 'ENOTFOUND' || diagnostics.dns.lookup.status === 'FAIL') return 'DNS_RESOLUTION_FAILURE';
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENETUNREACH' || code === 'ECONNREFUSED') return 'NETWORK_CONNECTIVITY_FAILURE';
    if (/CERT|TLS|SSL/i.test(String(code || ''))) return 'TLS_CONNECTION_FAILURE';
    if (error?.code === 'AI_PROVIDER_AUTH_ERROR') return 'PROVIDER_AUTH_FAILURE';
    if (error?.code === 'AI_PROVIDER_RATE_LIMITED') return 'PROVIDER_RATE_LIMIT';
    if (error?.code === 'AI_PROVIDER_UPSTREAM_ERROR') return 'PROVIDER_UPSTREAM_FAILURE';
    if (error?.statusCode >= 400 && error?.statusCode < 500) return 'MODEL_OR_REQUEST_CONFIGURATION_FAILURE';
    return error ? 'UNKNOWN_PROVIDER_FAILURE' : 'NONE';
}

async function diagnoseProvider(options = {}) {
    const loaded = loadSmokeEnvironment(options);
    const config = resolveProviderConfig('deepseek', loaded.env);
    const url = new URL(config.baseUrl);
    const proxy = Object.fromEntries(PROXY_KEYS.filter(key => loaded.env[key]).map(key => [key, sanitizeValue(loaded.env[key])]));
    const retries = [];
    const minimalCall = { status: 'FAIL', response: null, error: null };
    try {
        const content = await callDeepSeek([
            { role: 'system', content: 'You are a connectivity test. Reply exactly: OK' },
            { role: 'user', content: 'Reply OK.' },
        ], {
            env: loaded.env,
            timeoutMs: options.timeoutMs || 30_000,
            onProvider: event => { if (event.retry) retries.push({ attempt: event.attempt, causeCode: event.causeCode || event.code || null, status: event.status || null, timestamp: new Date().toISOString() }); },
        });
        minimalCall.status = 'PASS';
        minimalCall.response = String(content).slice(0, 80);
    } catch (error) { minimalCall.error = serializeError(error); }
    const diagnostics = {
        provider: config.provider,
        model: config.model,
        baseUrl: config.baseUrl,
        hostname: url.hostname,
        apiKeyPresent: Boolean(config.apiKey),
        configSources: Object.fromEntries(CONFIG_KEYS.map(key => [key, sourceFor(key, loaded.processValues, loaded.dotenvValues, key === 'DEEPSEEK_MODEL')])),
        processEnvPresent: Object.fromEntries(CONFIG_KEYS.map(key => [key, Object.hasOwn(loaded.processValues, key)])),
        dotenvPresent: Object.fromEntries(CONFIG_KEYS.map(key => [key, Object.hasOwn(loaded.dotenvValues, key)])),
        proxy: { present: Object.keys(proxy).length > 0, values: proxy, fetch: 'Node global fetch; no custom dispatcher or proxy agent in experiment/modelClient' },
        dns: {
            lookup: await dnsResult(() => dns.lookup(url.hostname, { all: true })),
            resolve4: await dnsResult(() => dns.resolve4(url.hostname)),
            resolve6: await dnsResult(() => dns.resolve6(url.hostname)),
        },
        systemDns: await systemDns(url.hostname),
        https: await httpsConnectivity(config.baseUrl),
        minimalCall,
        retryAttempts: retries,
    };
    diagnostics.rootCause = classifyFailure(diagnostics);
    return Object.freeze(diagnostics);
}

module.exports = { classifyFailure, diagnoseProvider, loadSmokeEnvironment, sanitizeValue, serializeError };
