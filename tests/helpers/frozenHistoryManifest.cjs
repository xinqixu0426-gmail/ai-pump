'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const REQUIRED_PATHS = Object.freeze([
    'api/ontology/bindingMetadata.cjs',
    'api/services/aiCapabilityGraphV3.cjs',
    'api/services/aiAssistantAnswer.cjs',
    'api/services/aiEvidenceBundle.cjs',
    'api/services/aiResponsePresenter.cjs',
    'package.json',
    'package-lock.json',
    'api/routes/ai/tools.cjs',
    'api/services/aiAssistantRuntime.cjs',
]);

function sha256Normalized(value) {
    return crypto.createHash('sha256').update(String(value).replace(/\r\n/g, '\n')).digest('hex');
}

function validateManifest(manifest) {
    if (!manifest || manifest.version !== 1 || !/^[a-f0-9]{40}$/u.test(manifest.sourceCommit || '')) throw new Error('FROZEN_HISTORY_MANIFEST_INVALID');
    if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) throw new Error('FROZEN_HISTORY_MANIFEST_EMPTY');
    if (!/^[a-f0-9]{64}$/u.test(manifest.packageDependencySurfaceSha256 || '')) throw new Error('FROZEN_HISTORY_MANIFEST_DEPENDENCY_SURFACE');
    if (manifest.artifacts.length !== REQUIRED_PATHS.length) throw new Error('FROZEN_HISTORY_MANIFEST_ARTIFACT_COUNT');
    const paths = manifest.artifacts.map(item => item?.path);
    if (new Set(paths).size !== paths.length || paths.join('\n') !== REQUIRED_PATHS.join('\n')) throw new Error('FROZEN_HISTORY_MANIFEST_PATHS');
    for (const artifact of manifest.artifacts) {
        if (!/^[a-f0-9]{40}$/u.test(artifact.sourceBlobSha || '') || !/^[a-f0-9]{64}$/u.test(artifact.sha256 || '')) throw new Error('FROZEN_HISTORY_MANIFEST_HASH');
    }
    for (const field of ['bindingResources', 'toolNames']) {
        if (!Array.isArray(manifest[field]) || manifest[field].length === 0 || manifest[field].some(value => !/^[a-z0-9_]+$/u.test(value))) throw new Error(`FROZEN_HISTORY_MANIFEST_${field.toUpperCase()}`);
    }
    if (!manifest.runtimePromptHashes || !/^[a-f0-9]{64}$/u.test(manifest.runtimePromptHashes.systemPrompt || '') || !/^[a-f0-9]{64}$/u.test(manifest.runtimePromptHashes.localResponsePrompt || '')) throw new Error('FROZEN_HISTORY_MANIFEST_PROMPTS');
    // 冻结基线的**版本升级**记录：被批准替换过的 artifact 必须留下 previousSha256，
    // 历史 sha 不得因为一次修复就消失，否则无法审计「过去到底是什么被冻结着」。
    // 允许缺失（首次冻结时没有历史），存在时必须是合法且自洽的记录。
    const supersessions = manifest.baselineSupersessions;
    if (supersessions !== undefined) {
        if (!Array.isArray(supersessions)) throw new Error('FROZEN_HISTORY_MANIFEST_SUPERSESSIONS');
        for (const entry of supersessions) {
            if (!entry || !REQUIRED_PATHS.includes(entry.path)) throw new Error('FROZEN_HISTORY_MANIFEST_SUPERSESSION_PATH');
            if (!/^[a-f0-9]{64}$/u.test(entry.previousSha256 || '') || !/^[a-f0-9]{64}$/u.test(entry.currentSha256 || '')) {
                throw new Error('FROZEN_HISTORY_MANIFEST_SUPERSESSION_HASH');
            }
            if (entry.previousSha256 === entry.currentSha256) throw new Error('FROZEN_HISTORY_MANIFEST_SUPERSESSION_NOOP');
            // currentSha256 必须就是当前生效的基线，否则记录与实际冻结内容脱节。
            if (entry.currentSha256 !== artifactHash(manifest, entry.path)) throw new Error('FROZEN_HISTORY_MANIFEST_SUPERSESSION_STALE');
            // 历史 sha 必须与记录一致，且已经被换掉。
            if (artifactHash(manifest, entry.path) === entry.previousSha256) throw new Error('FROZEN_HISTORY_MANIFEST_SUPERSESSION_UNCHANGED');
            if (!entry.changeReason || !entry.changeClass || !entry.approvedBy) throw new Error('FROZEN_HISTORY_MANIFEST_SUPERSESSION_PROVENANCE');
        }
    }
    return manifest;
}

function loadFrozenHistoryManifest(filePath) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (error) { throw new Error(`FROZEN_HISTORY_MANIFEST_UNREADABLE: ${error.code || error.name}`); }
    return validateManifest(parsed);
}

function artifactHash(manifest, relativePath) {
    const artifact = manifest.artifacts.find(item => item.path === relativePath);
    if (!artifact) throw new Error(`FROZEN_HISTORY_MANIFEST_ARTIFACT_MISSING: ${relativePath}`);
    return artifact.sha256;
}

module.exports = { REQUIRED_PATHS, artifactHash, loadFrozenHistoryManifest, sha256Normalized, validateManifest };
