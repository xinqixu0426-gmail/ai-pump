const crypto = require('node:crypto');
const { fetchWithPolicy } = require('../../services/httpClient.cjs');
const { getInternalApiTimeoutMs, getServerPort } = require('../../services/environment.cjs');

function createInternalFetch(context = {}, sharedTrace = null) {
    const trace = sharedTrace || [];
    const internalFetch = (url, opts = {}) => {
        const headers = { ...(opts.headers || {}) };
        headers['x-internal-secret'] = process.env.INTERNAL_SECRET || '';
        if (context.operationId && !headers['x-operation-id']) {
            headers['x-operation-id'] = String(context.operationId);
        }
        if (context.capabilityId && !headers['x-capability-id']) {
            headers['x-capability-id'] = String(context.capabilityId);
        }
        const port = getServerPort();
        return fetchWithPolicy(`http://localhost:${port}${url}`, {
            ...opts,
            headers,
            signal: opts.signal || context.signal,
        }, {
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
        createChildOperationFetch: {
            value: () => createInternalFetch({
                ...context,
                operationId: crypto.randomUUID(),
            }, trace),
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
        const error = new Error(fallbackError || `API 返回了非 JSON 响应：${response.status}`);
        error.code = 'INTERNAL_API_PROTOCOL_FAILURE';
        error.statusCode = response.status;
        error.formalApiOutcome = 'protocol_failure';
        throw error;
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

async function lookupEntities(internalFetch, input) {
    const method = 'POST';
    const path = '/api/entity-lookup';
    try {
        const result = await readApiJson(await internalFetch(path, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        }), '实体查询 API 调用失败');
        if (typeof internalFetch.recordApiResult === 'function') {
            internalFetch.recordApiResult({
                method,
                path,
                ok: true,
                result: {
                    version: result?.version,
                    status: result?.status,
                    complete: result?.complete === true,
                    attemptedEntityTypes: result?.attemptedEntityTypes,
                    candidateCount: result?.candidateCount,
                },
            });
        }
        return result;
    } catch (error) {
        if (typeof internalFetch.recordApiResult === 'function') {
            internalFetch.recordApiResult({
                method,
                path,
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

async function supplyCoilSpanCandidates(sourceText, options = {}) {
    const internalFetch = options.internalFetch || createInternalFetch({ signal: options.signal });
    const path = '/api/entity-span-candidates';
    try {
        const result = await readApiJson(await internalFetch(path, { method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: 1, sourceText, entityScope: 'coil' }) }), 'Span candidate supply failed');
        internalFetch.recordApiResult?.({ method: 'POST', path, ok: true,
            result: { complete: result?.complete === true, candidateCount: result?.candidateCount } });
        return result;
    } catch {
        // Never propagate arbitrary transport errors containing request or response data.
        throw new Error('SPAN_SUPPLY_UNAVAILABLE');
    }
}

module.exports = {
    supplyCoilSpanCandidates,
    createInternalFetch,
    readApiJson,
    getJson,
    postJson,
    putJson,
    patchJson,
    deleteJson,
    lookupEntities,
};
