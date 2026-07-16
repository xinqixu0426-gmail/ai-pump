function createInternalFetch() {
    return (url, opts = {}) => {
        const headers = { ...(opts.headers || {}) };
        headers['x-internal-secret'] = process.env.INTERNAL_SECRET || '';
        const port = process.env.PORT || 3002;
        return fetch(`http://localhost:${port}${url}`, { ...opts, headers });
    };
}

async function readApiJson(response, fallbackError) {
    const result = await response.json();
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

function patchJson(internalFetch, url, body, fallbackError) {
    return requestJson(internalFetch, 'PATCH', url, body, fallbackError);
}

function deleteJson(internalFetch, url, fallbackError) {
    return requestJson(internalFetch, 'DELETE', url, undefined, fallbackError);
}

module.exports = { createInternalFetch, readApiJson, getJson, postJson, patchJson, deleteJson };
