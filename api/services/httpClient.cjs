const { createLogger } = require('../logger.cjs');

const httpLogger = createLogger('http-client');
const DEFAULT_TIMEOUT_MS = 10000;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function timeoutError(label, timeoutMs) {
    const error = new Error(`${label}请求超时（${timeoutMs}ms）`);
    error.code = 'REQUEST_TIMEOUT';
    return error;
}

async function fetchWithPolicy(url, options = {}, policy = {}) {
    const {
        timeoutMs = DEFAULT_TIMEOUT_MS,
        retries = 0,
        retryDelayMs = 250,
        label = '外部服务',
        fetchImpl = global.fetch,
    } = policy;
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch');

    const method = String(options.method || 'GET').toUpperCase();
    const retryable = method === 'GET' || method === 'HEAD';
    const maxAttempts = 1 + (retryable ? Math.max(0, Number(retries) || 0) : 0);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(timeoutError(label, timeoutMs)), timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
        const callerSignal = options.signal;
        const abortFromCaller = () => controller.abort(callerSignal.reason);
        if (callerSignal) {
            if (callerSignal.aborted) abortFromCaller();
            else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
        }

        try {
            const response = await fetchImpl(url, { ...options, signal: controller.signal });
            if (response.status >= 500 && attempt < maxAttempts) {
                await response.body?.cancel?.();
                httpLogger.warn(`${label}返回 ${response.status}，准备第 ${attempt + 1} 次请求`);
                await wait(retryDelayMs * attempt);
                continue;
            }
            if (typeof response.arrayBuffer !== 'function') return response;
            const body = await response.arrayBuffer();
            const responseBody = [204, 205, 304].includes(response.status) ? null : body;
            return new Response(responseBody, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
        } catch (error) {
            const normalized = controller.signal.aborted && !callerSignal?.aborted
                ? timeoutError(label, timeoutMs)
                : error;
            if (attempt >= maxAttempts) throw normalized;
            httpLogger.warn(`${label}请求失败，准备第 ${attempt + 1} 次请求: ${normalized.message}`);
            await wait(retryDelayMs * attempt);
        } finally {
            clearTimeout(timer);
            callerSignal?.removeEventListener?.('abort', abortFromCaller);
        }
    }

    throw new Error(`${label}请求失败`);
}

module.exports = {
    DEFAULT_TIMEOUT_MS,
    fetchWithPolicy,
};
