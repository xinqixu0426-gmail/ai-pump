const LEVEL_METHOD = {
    debug: 'log',
    info: 'log',
    warn: 'warn',
    error: 'error',
};
const SENSITIVE_KEY_RE = /password|secret|token|api.?key|authorization|cookie/i;
const MAX_META_LENGTH = 8000;

function safeMeta(meta) {
    const seen = new WeakSet();
    let serialized;
    try {
        serialized = JSON.stringify(meta, (key, value) => {
            if (SENSITIVE_KEY_RE.test(key)) return '[REDACTED]';
            if (value instanceof Error) {
                return {
                    name: value.name,
                    message: value.message,
                    code: value.code,
                    stack: value.stack,
                };
            }
            if (typeof value === 'bigint') return value.toString();
            if (value && typeof value === 'object') {
                if (seen.has(value)) return '[Circular]';
                seen.add(value);
            }
            return value;
        });
    } catch (error) {
        serialized = JSON.stringify({ loggingError: error.message });
    }
    if (!serialized) return '';
    if (serialized.length <= MAX_META_LENGTH) return serialized;
    return JSON.stringify({
        truncated: true,
        originalLength: serialized.length,
        preview: serialized.slice(0, MAX_META_LENGTH - 200),
    });
}

function format(scope, level, message, meta) {
    const time = new Date().toISOString();
    const suffix = meta === undefined ? '' : ` ${safeMeta(meta)}`;
    return `[${time}] [${scope}] [${level.toUpperCase()}] ${String(message)}${suffix}`;
}

function createLogger(scope) {
    const write = (level, message, meta) => {
        const method = LEVEL_METHOD[level] || 'log';
        console[method](format(scope, level, message, meta));
    };
    return {
        debug: (message, meta) => write('debug', message, meta),
        info: (message, meta) => write('info', message, meta),
        warn: (message, meta) => write('warn', message, meta),
        error: (message, meta) => write('error', message, meta),
    };
}

module.exports = { createLogger, format, safeMeta };
