'use strict';

// N7.3 / 生产整合候选：证据哈希的跨平台规范契约（PHASE 5-R1）。
//
// 问题：ReleaseEvidenceV1 记录的是「规范化字节」的 sha256，而若干写入/校验
// 方直接对 `fs.readFileSync()` 的原始工作区字节求哈希。在 Windows 上
// `core.autocrlf=true` 会把受版本控制的文本文件物化成 CRLF，于是同一个
// git revision 在不同平台得到不同的证据哈希：
//   git blob / LF 规范化字节 -> 499b07df…（accepted revision 上的记录值）
//   Windows 检出的 CRLF 字节 -> b16b3526…（本机读到的值）
// 这会让 N7.3 存证链在 Windows/macOS 上不可验证。
//
// 契约：证据哈希一律绑定 **canonical git blob 内容**，而不是检出后的工作区
// 字节。同一 git revision 在 Windows / macOS / Linux 上必须得到同一个哈希。
// 具体实现：优先 `git cat-file blob <rev>:<path>`；文件尚未进入版本控制时，
// 退化为对工作区内容做 LF 规范化——这正是 git 在 `core.autocrlf=true` 下
// 对文本文件入库时所存储的字节，因此两条分支得到同一个哈希空间。
//
// 注意：本模块只服务证据/存证产物，不改变任何生产运行时行为。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH_CONTRACT = 'GIT_BLOB_CANONICAL';
function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// git 在 core.autocrlf 下入库文本文件时保存的规范字节：CRLF -> LF。
function toCanonicalBytes(content) {
    if (typeof content === 'string') return Buffer.from(content.replace(/\r\n/g, '\n'), 'utf8');
    return Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function gitBlob(relativePath, revision = 'HEAD') {
    try {
        return execFileSync('git', ['cat-file', 'blob', `${revision}:${relativePath}`], {
            cwd: ROOT,
            maxBuffer: 256 * 1024 * 1024,
        });
    } catch {
        return null;
    }
}

// 证据产物的规范哈希。返回 { sha256, bytes, source }。
//   source = 'git_blob'          文件在该 revision 中已存在（受版本控制）
//   source = 'canonical_worktree' 文件尚未提交，按入库规范字节计算
function canonicalEvidenceHash(relativePath, options = {}) {
    const revision = options.revision || 'HEAD';
    const blob = options.preferWorktree ? null : gitBlob(relativePath, revision);
    const bytes = blob || toCanonicalBytes(fs.readFileSync(path.join(ROOT, relativePath)));
    return {
        sha256: sha256(bytes),
        bytes: bytes.length,
        source: blob ? 'git_blob' : 'canonical_worktree',
    };
}

function canonicalEvidenceSha256(relativePath, options = {}) {
    return canonicalEvidenceHash(relativePath, options).sha256;
}

module.exports = {
    HASH_CONTRACT,
    ROOT,
    canonicalEvidenceHash,
    canonicalEvidenceSha256,
    toCanonicalBytes,
};
