'use strict';

function writeAllowed(env = process.env) {
    return String(env.AI_NATIVE_WRITE_ENABLED || '').trim().toLowerCase() === 'true';
}

module.exports = { writeAllowed };
