const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const startedAt = new Date().toISOString();

function packageVersion() {
    try {
        const packageJson = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
        );
        return String(packageJson.version || 'unknown');
    } catch {
        return 'unknown';
    }
}

function gitCommit() {
    const configured = String(process.env.RELEASE_COMMIT || process.env.GIT_COMMIT || '').trim();
    if (configured) return configured;
    try {
        return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
            cwd: path.join(__dirname, '..', '..'),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000,
        }).trim() || 'unknown';
    } catch {
        return 'unknown';
    }
}

const identity = Object.freeze({
    version: packageVersion(),
    gitCommit: gitCommit(),
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
});

function runtimeDiagnostics() {
    const memory = process.memoryUsage();
    return {
        ...identity,
        pid: process.pid,
        startedAt,
        uptimeSeconds: Math.floor(process.uptime()),
        memory: {
            rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
            heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
        },
    };
}

module.exports = { runtimeDiagnostics };
