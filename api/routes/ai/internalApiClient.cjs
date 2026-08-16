const { fetchWithPolicy } = require('../../services/httpClient.cjs');
const { getInternalApiTimeoutMs, getServerPort } = require('../../services/environment.cjs');

function createInternalFetch(context = {}) {
    const trace = [];
    const internalFetch = (url, opts = {}) => {
        const headers = { ...(opts.headers || {}) };
        headers['x-internal-secret'] = process.env.INTERNAL_SECRET || '';
        if (context.operationId) headers['x-operation-id'] = String(context.operationId);
        if (context.capabilityId) headers['x-capability-id'] = String(context.capabilityId);
        const port = getServerPort();
        return fetchWithPolicy(`http://localhost:${port}${url}`, { ...opts, headers }, {
            timeoutMs: getInternalApiTimeoutMs(),
            retries: 0,
            label: `内部 API ${opts.method || 'GET'} ${url}`,
        });
    };
    Object.defineProperties(internalFetch, {
        recordApiResult: {
            value: entry => trace.push({
                method: String(entry?.method || 'GET').toUpperCase(),
                path: String(entry?.path || ''),
                ok: entry?.ok !== false,
                outcome: entry?.outcome === 'not_found' ? 'not_found' : null,
                result: entry?.result,
                error: entry?.error || null,
            }),
        },
        getApiTrace: {
            value: () => trace.map(entry => ({ ...entry })),
        },
    });
    return internalFetch;
}

async function readApiJson(response, fallbackError) {
    const text = await response.text();
    let result = {};
    try {
        result = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(fallbackError || `API 返回了非 JSON 响应：${response.status}`);
    }
    if (!response.ok || result.success === false) {
        const error = new Error(result.error || fallbackError || `API 调用失败：${response.status}`);
        error.code = result.code
            || (response.status === 404 ? 'AI_RESOURCE_NOT_FOUND' : 'internal_api_request_failed');
        error.statusCode = response.status;
        error.formalApiOutcome = response.status === 404 && result.success === false
            ? 'not_found'
            : 'failed';
        throw error;
    }
    return result.data ?? result;
}

async function requestJson(internalFetch, method, url, body, fallbackError) {
    const options = { method };
    if (body !== undefined) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
    }
    try {
        const result = await readApiJson(await internalFetch(url, options), fallbackError);
        if (typeof internalFetch.recordApiResult === 'function') {
            internalFetch.recordApiResult({ method, path: url, ok: true, result });
        }
        return result;
    } catch (error) {
        if (typeof internalFetch.recordApiResult === 'function') {
            internalFetch.recordApiResult({
                method,
                path: url,
                ok: false,
                outcome: error.formalApiOutcome,
                error: {
                    code: error.code || 'internal_api_request_failed',
                    statusCode: error.statusCode || null,
                    message: error.message,
                },
            });
        }
        throw error;
    }
}

function getJson(internalFetch, url, fallbackError) {
    return requestJson(internalFetch, 'GET', url, undefined, fallbackError);
}

function postJson(internalFetch, url, body, fallbackError) {
    return requestJson(internalFetch, 'POST', url, body, fallbackError);
}

function putJson(internalFetch, url, body, fallbackError) {
    return requestJson(internalFetch, 'PUT', url, body, fallbackError);
}

function patchJson(internalFetch, url, body, fallbackError) {
    return requestJson(internalFetch, 'PATCH', url, body, fallbackError);
}

function deleteJson(internalFetch, url, fallbackError, body) {
    return requestJson(internalFetch, 'DELETE', url, body, fallbackError);
}

module.exports = { createInternalFetch, readApiJson, getJson, postJson, putJson, patchJson, deleteJson };
