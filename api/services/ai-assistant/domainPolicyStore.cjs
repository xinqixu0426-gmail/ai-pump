'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BOOTSTRAP_POLICY_PATH = path.join(__dirname, 'domain-policy.md');
const MAX_POLICY_LENGTH = 16_000;
const POLICY_STATES = Object.freeze(['DRAFT', 'PUBLISHED', 'SUPERSEDED']);

class DomainPolicyError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = 'DomainPolicyError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function now() { return new Date().toISOString(); }
function hash(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function draftVersion(content, baseVersionId, updatedAt) { return hash(`${content}\n${baseVersionId}\n${updatedAt}`); }
function bootstrapContent() { return fs.readFileSync(BOOTSTRAP_POLICY_PATH, 'utf8').trim(); }

function validateContent(value) {
    const content = typeof value === 'string' ? value.trim() : '';
    if (!content) throw new DomainPolicyError('DOMAIN_POLICY_EMPTY', '工厂规则不能为空');
    if (content.length > MAX_POLICY_LENGTH) throw new DomainPolicyError('DOMAIN_POLICY_TOO_LARGE', `工厂规则不能超过 ${MAX_POLICY_LENGTH} 个字符`);
    const forbidden = [/忽略.*(?:核心|系统|安全).*规则/i, /绕过.*确认/i, /直接(?:写入|修改).*数据库/i, /伪造.*(?:来源|数据|结果)/i];
    if (forbidden.some(pattern => pattern.test(content))) {
        throw new DomainPolicyError('DOMAIN_POLICY_UNSAFE', '工厂规则不能覆盖核心安全、正式事实来源或写入确认边界');
    }
    return content;
}

function accessorsOf(options = {}) { return options.accessors || require('../../db.cjs'); }
function actorOf(value) { return typeof value === 'string' ? value.slice(0, 160) : ''; }
function reasonOf(value) { return typeof value === 'string' ? value.trim().slice(0, 1_000) : ''; }
function versionRow(row) {
    if (!row) return null;
    return Object.freeze({ id: Number(row.id), version: Number(row.version_number), content: row.content, status: row.status,
        sourceVersionId: row.source_version_id == null ? null : Number(row.source_version_id), actor: row.actor || '', reason: row.reason || '',
        createdAt: row.created_at, publishedAt: row.published_at, updatedAt: row.updated_at });
}
function draftRow(row) {
    if (!row) return null;
    return Object.freeze({ content: row.content, baseVersionId: Number(row.base_version_id), version: row.resource_version,
        actor: row.actor || '', createdAt: row.created_at, updatedAt: row.updated_at });
}
function auditRow(row) {
    let detail = {};
    try { detail = JSON.parse(row.detail_json || '{}'); } catch { /* recorded JSON remains opaque */ }
    return Object.freeze({ id: Number(row.id), action: row.action, versionId: row.version_id == null ? null : Number(row.version_id),
        previousVersionId: row.previous_version_id == null ? null : Number(row.previous_version_id), actor: row.actor || '', reason: row.reason || '', detail, createdAt: row.created_at });
}

function legacyOwnerRules(accessors) {
    const value = accessors.getConfig?.('ai-factory-profile') || '';
    if (!value || !String(value).trim()) return '';
    try { return validateContent(String(value)); } catch { return ''; }
}

function ensureBootstrapPublishedPolicy(options = {}) {
    const accessors = accessorsOf(options);
    const existing = accessors.db.prepare(`SELECT * FROM domain_policy_versions WHERE status = 'PUBLISHED'`).get();
    if (existing) return versionRow(existing);
    const createdAt = now();
    const bootstrap = validateContent(bootstrapContent());
    const legacy = legacyOwnerRules(accessors);
    const content = legacy && legacy !== bootstrap
        ? `${bootstrap}\n\n## 已迁移的 Owner 工厂规则\n${legacy}`
        : bootstrap;
    const transaction = accessors.db.transaction(() => {
        const concurrent = accessors.db.prepare(`SELECT * FROM domain_policy_versions WHERE status = 'PUBLISHED'`).get();
        if (concurrent) return versionRow(concurrent);
        const versionWrite = accessors.safeInsert('domain_policy_versions', {
            version_number: 1, content, status: 'PUBLISHED', source_version_id: null, actor: 'system-bootstrap', reason: 'bootstrap',
            created_at: createdAt, published_at: createdAt, updated_at: createdAt,
        }, { user: 'system-bootstrap', requireAudit: true });
        const versionId = Number(versionWrite.lastInsertRowid);
        const resourceVersion = draftVersion(content, versionId, createdAt);
        accessors.safeInsert('domain_policy_drafts', { id: 1, content, base_version_id: versionId, resource_version: resourceVersion,
            actor: 'system-bootstrap', created_at: createdAt, updated_at: createdAt }, { user: 'system-bootstrap', requireAudit: true });
        accessors.safeInsert('domain_policy_audit', { action: 'BOOTSTRAP', version_id: versionId, previous_version_id: null,
            actor: 'system-bootstrap', reason: 'bootstrap', detail_json: JSON.stringify({ source: 'domain-policy.md', legacyFactoryRulesIncluded: Boolean(legacy) }),
            created_at: createdAt, updated_at: createdAt }, { user: 'system-bootstrap', requireAudit: true });
        return versionRow(accessors.db.prepare(`SELECT * FROM domain_policy_versions WHERE id = ?`).get(versionId));
    });
    return transaction.immediate();
}

function getPublishedPolicySnapshot(options = {}) {
    const accessors = accessorsOf(options);
    const published = ensureBootstrapPublishedPolicy({ accessors });
    return Object.freeze({ policyVersion: published.version, policyContent: published.content, source: 'database', publishedAt: published.publishedAt });
}

function getCurrentPolicy(options = {}) {
    const accessors = accessorsOf(options);
    const published = ensureBootstrapPublishedPolicy({ accessors });
    const draft = draftRow(accessors.db.prepare(`SELECT * FROM domain_policy_drafts WHERE id = 1`).get());
    return Object.freeze({ published, draft });
}

function saveDraft(input = {}, options = {}) {
    const accessors = accessorsOf(options); ensureBootstrapPublishedPolicy({ accessors });
    const content = validateContent(input.content);
    const expectedVersion = String(input.expectedVersion || '').trim();
    const actor = actorOf(options.actor); const updatedAt = now();
    const transaction = accessors.db.transaction(() => {
        const current = draftRow(accessors.db.prepare(`SELECT * FROM domain_policy_drafts WHERE id = 1`).get());
        if (!current) throw new DomainPolicyError('DOMAIN_POLICY_DRAFT_MISSING', '工厂规则草稿不存在', 409);
        if (!expectedVersion || expectedVersion !== current.version) throw new DomainPolicyError('DOMAIN_POLICY_CONFLICT', '工厂规则草稿已被其他页面修改，请刷新后重试', 409);
        const nextVersion = draftVersion(content, current.baseVersionId, updatedAt);
        accessors.safeUpdate('domain_policy_drafts', 1, { content, resource_version: nextVersion, actor }, { user: actor, requireAudit: true });
        accessors.safeInsert('domain_policy_audit', { action: 'DRAFT_SAVED', version_id: current.baseVersionId, previous_version_id: current.baseVersionId,
            actor, reason: reasonOf(input.reason), detail_json: JSON.stringify({ draftVersion: nextVersion }), created_at: updatedAt, updated_at: updatedAt }, { user: actor, requireAudit: true });
        return draftRow(accessors.db.prepare(`SELECT * FROM domain_policy_drafts WHERE id = 1`).get());
    });
    return transaction.immediate();
}

function listVersions(options = {}) {
    const accessors = accessorsOf(options); ensureBootstrapPublishedPolicy({ accessors });
    return accessors.db.prepare(`SELECT * FROM domain_policy_versions ORDER BY version_number DESC`).all().map(versionRow);
}

function lineDiff(before, after) {
    const left = String(before || '').split('\n'); const right = String(after || '').split('\n'); const changes = [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        if (left[index] === right[index]) continue;
        changes.push({ line: index + 1, before: left[index] || '', after: right[index] || '' });
    }
    return changes;
}

function resolveComparable(selector, accessors) {
    if (selector === 'draft') return { kind: 'draft', ...draftRow(accessors.db.prepare(`SELECT * FROM domain_policy_drafts WHERE id = 1`).get()) };
    const id = Number(selector);
    if (!Number.isInteger(id) || id <= 0) throw new DomainPolicyError('DOMAIN_POLICY_VERSION_INVALID', '版本标识无效');
    const item = versionRow(accessors.db.prepare(`SELECT * FROM domain_policy_versions WHERE id = ?`).get(id));
    if (!item) throw new DomainPolicyError('DOMAIN_POLICY_VERSION_NOT_FOUND', '工厂规则版本不存在', 404);
    return { kind: 'version', ...item };
}

function getDiff(input = {}, options = {}) {
    const accessors = accessorsOf(options); ensureBootstrapPublishedPolicy({ accessors });
    const from = resolveComparable(input.from, accessors); const to = resolveComparable(input.to, accessors);
    return Object.freeze({ from: { kind: from.kind, id: from.id || null, version: from.version }, to: { kind: to.kind, id: to.id || null, version: to.version }, changes: lineDiff(from.content, to.content) });
}

function publishDraft(input = {}, options = {}) {
    const accessors = accessorsOf(options); ensureBootstrapPublishedPolicy({ accessors });
    const actor = actorOf(options.actor); const expectedDraftVersion = String(input.expectedDraftVersion || '').trim();
    const expectedPublishedVersion = Number(input.expectedPublishedVersion); const publishedAt = now();
    const transaction = accessors.db.transaction(() => {
        const currentPublished = versionRow(accessors.db.prepare(`SELECT * FROM domain_policy_versions WHERE status = 'PUBLISHED'`).get());
        const draft = draftRow(accessors.db.prepare(`SELECT * FROM domain_policy_drafts WHERE id = 1`).get());
        if (!draft || !currentPublished) throw new DomainPolicyError('DOMAIN_POLICY_STATE_INVALID', '工厂规则状态不完整', 409);
        if (!expectedDraftVersion || draft.version !== expectedDraftVersion || !Number.isInteger(expectedPublishedVersion) || currentPublished.version !== expectedPublishedVersion || draft.baseVersionId !== currentPublished.id) {
            throw new DomainPolicyError('DOMAIN_POLICY_CONFLICT', '工厂规则已变化，请查看最新差异后重新发布', 409);
        }
        const content = validateContent(draft.content); const nextNumber = Number(accessors.db.prepare(`SELECT COALESCE(MAX(version_number), 0) AS value FROM domain_policy_versions`).get().value) + 1;
        accessors.safeUpdate('domain_policy_versions', currentPublished.id, { status: 'SUPERSEDED' }, { user: actor, requireAudit: true });
        const created = accessors.safeInsert('domain_policy_versions', { version_number: nextNumber, content, status: 'PUBLISHED', source_version_id: currentPublished.id, actor, reason: reasonOf(input.reason), created_at: publishedAt, published_at: publishedAt, updated_at: publishedAt }, { user: actor, requireAudit: true });
        const versionId = Number(created.lastInsertRowid); const nextDraftVersion = draftVersion(content, versionId, publishedAt);
        accessors.safeUpdate('domain_policy_drafts', 1, { content, base_version_id: versionId, resource_version: nextDraftVersion, actor }, { user: actor, requireAudit: true });
        accessors.safeInsert('domain_policy_audit', { action: 'PUBLISHED', version_id: versionId, previous_version_id: currentPublished.id, actor, reason: reasonOf(input.reason), detail_json: JSON.stringify({ draftVersion: draft.version }), created_at: publishedAt, updated_at: publishedAt }, { user: actor, requireAudit: true });
        return versionRow(accessors.db.prepare(`SELECT * FROM domain_policy_versions WHERE id = ?`).get(versionId));
    });
    return transaction.immediate();
}

function rollbackPolicy(input = {}, options = {}) {
    const accessors = accessorsOf(options); ensureBootstrapPublishedPolicy({ accessors });
    const targetId = Number(input.versionId); const expectedPublishedVersion = Number(input.expectedPublishedVersion); const actor = actorOf(options.actor); const publishedAt = now();
    const transaction = accessors.db.transaction(() => {
        const current = versionRow(accessors.db.prepare(`SELECT * FROM domain_policy_versions WHERE status = 'PUBLISHED'`).get());
        const target = versionRow(accessors.db.prepare(`SELECT * FROM domain_policy_versions WHERE id = ?`).get(targetId));
        if (!target) throw new DomainPolicyError('DOMAIN_POLICY_VERSION_NOT_FOUND', '要回滚的工厂规则版本不存在', 404);
        if (!Number.isInteger(expectedPublishedVersion) || current.version !== expectedPublishedVersion) throw new DomainPolicyError('DOMAIN_POLICY_CONFLICT', '当前发布版本已变化，请刷新后重试', 409);
        const nextNumber = Number(accessors.db.prepare(`SELECT COALESCE(MAX(version_number), 0) AS value FROM domain_policy_versions`).get().value) + 1;
        accessors.safeUpdate('domain_policy_versions', current.id, { status: 'SUPERSEDED' }, { user: actor, requireAudit: true });
        const created = accessors.safeInsert('domain_policy_versions', { version_number: nextNumber, content: target.content, status: 'PUBLISHED', source_version_id: target.id, actor, reason: reasonOf(input.reason), created_at: publishedAt, published_at: publishedAt, updated_at: publishedAt }, { user: actor, requireAudit: true });
        const versionId = Number(created.lastInsertRowid); const resourceVersion = draftVersion(target.content, versionId, publishedAt);
        accessors.safeUpdate('domain_policy_drafts', 1, { content: target.content, base_version_id: versionId, resource_version: resourceVersion, actor }, { user: actor, requireAudit: true });
        accessors.safeInsert('domain_policy_audit', { action: 'ROLLED_BACK', version_id: versionId, previous_version_id: current.id, actor, reason: reasonOf(input.reason), detail_json: JSON.stringify({ restoredFromVersionId: target.id }), created_at: publishedAt, updated_at: publishedAt }, { user: actor, requireAudit: true });
        return versionRow(accessors.db.prepare(`SELECT * FROM domain_policy_versions WHERE id = ?`).get(versionId));
    });
    return transaction.immediate();
}

function listAudit(options = {}) { const accessors = accessorsOf(options); ensureBootstrapPublishedPolicy({ accessors }); return accessors.db.prepare(`SELECT * FROM domain_policy_audit ORDER BY id DESC LIMIT 100`).all().map(auditRow); }

module.exports = { BOOTSTRAP_POLICY_PATH, DomainPolicyError, MAX_POLICY_LENGTH, POLICY_STATES, bootstrapContent, ensureBootstrapPublishedPolicy, getCurrentPolicy, getDiff, getPublishedPolicySnapshot, hash, listAudit, listVersions, publishDraft, rollbackPolicy, saveDraft, validateContent };
