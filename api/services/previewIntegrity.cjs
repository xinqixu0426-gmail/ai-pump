const { CommandExecutionError } = require('./commandExecution.cjs');

function normalizePreviewHash(value, label = 'previewHash') {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new CommandExecutionError(
            'preview_hash_invalid',
            `${label} 格式无效`,
            400
        );
    }
    return normalized;
}

function assertPreviewHash(expectedHash, currentHash, message) {
    if (!expectedHash || expectedHash === currentHash) return;
    throw new CommandExecutionError(
        'preview_changed',
        message || '预览所依据的业务事实已经变化，请重新预览并确认',
        409
    );
}

module.exports = {
    assertPreviewHash,
    normalizePreviewHash,
};
