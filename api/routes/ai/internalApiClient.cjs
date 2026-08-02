const { fetchWithPolicy } = require('../../services/httpClient.cjs');
const { getInternalApiTimeoutMs, getServerPort } = require('../../services/environment.cjs');

function createInternalFetch() {
    return (url, opts = {}) => {
        const headers = { ...(opts.headers || {}) };
        headers['x-internal-secret'] = process.env.INTERNAL_SECRET || '';
        const port = getServerPort();
        return fetchWithPolicy(`http://localhost:${port}${url}`, { ...opts, headers }, {
            timeoutMs: getInternalApiTimeoutMs(),
            retries: 0,
            label: `内部 API ${opts.method || 'GET'} ${url}`,
        });
    };
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
        throw new Error(result.error || fallbackError || `API 调用失败：${response.status}`);
    }
    return result.data ?? result;
}

async function requestJson(internalFetch, method, url, body, fallbackError) {
    const options = { method };
    if (body !== undefined) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
    }
    return readApiJson(await internalFetch(url, options), fallbackError);
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

function deleteJson(internalFetch, url, fallbackError) {
    return requestJson(internalFetch, 'DELETE', url, undefined, fallbackError);
}

module.exports = { createInternalFetch, readApiJson, getJson, postJson, putJson, patchJson, deleteJson };
