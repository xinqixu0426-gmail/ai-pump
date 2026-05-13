const LEVEL_METHOD = {
    debug: 'log',
    info: 'log',
    warn: 'warn',
    error: 'error',
};

function format(scope, level, message) {
    const time = new Date().toISOString();
    return `[${time}] [${scope}] [${level.toUpperCase()}] ${message}`;
}

function createLogger(scope) {
    const write = (level, message, meta) => {
        const method = LEVEL_METHOD[level] || 'log';
        if (meta !== undefined) console[method](format(scope, level, message), meta);
        else console[method](format(scope, level, message));
    };
    return {
        debug: (message, meta) => write('debug', message, meta),
        info: (message, meta) => write('info', message, meta),
        warn: (message, meta) => write('warn', message, meta),
        error: (message, meta) => write('error', message, meta),
    };
}

module.exports = { createLogger };
