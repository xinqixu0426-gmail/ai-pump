const { CommandExecutionError, executePersistentCommand } = require('./commandExecution.cjs');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');

const MEMORY_CAPABILITY = 'ai.personal_memory.change';

function fail(code, message, statusCode = 400) { throw new CommandExecutionError(code, message, statusCode); }
function memoryRow(row) {
    return row ? { id: row.id, content: row.content, version: row.version, deleted: Boolean(row.deleted), updatedAt: row.updated_at } : null;
}
function listPersonalMemories({ db }, input = {}) {
    const afterId = input.afterId === undefined ? 0 : Number(input.afterId);
    const limit = input.limit === undefined ? 30 : Number(input.limit);
    if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('MEMORY_QUERY_INVALID', '记忆分页参数不合法');
    const rows = db.prepare('SELECT * FROM ai_personal_memories WHERE deleted = 0 AND id > ? ORDER BY id LIMIT ?').all(afterId, limit + 1);
    const items = rows.slice(0, limit).map(memoryRow);
    return { items, hasMore: rows.length > limit, nextAfterId: rows.length > limit ? items.at(-1).id : null };
}

function changePersonalMemory(dependencies, input = {}, context = {}) {
    requireBusinessCapability(MEMORY_CAPABILITY);
    const allowed = new Set(['action', 'id', 'content', 'expectedVersion', 'idempotencyKey']);
    if (Object.keys(input).some(key => !allowed.has(key))) fail('MEMORY_INPUT_INVALID', '记忆请求包含未知字段');
    const { action, id, expectedVersion } = input;
    if (!['save', 'update', 'delete', 'undo'].includes(action)) fail('MEMORY_ACTION_INVALID', '记忆操作不合法');
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (['save', 'update'].includes(action) && (!content || content.length > 1500)) fail('MEMORY_CONTENT_INVALID', '记忆内容应为 1–1500 字');
    if (action === 'save' && (id !== undefined || expectedVersion !== undefined)) fail('MEMORY_INPUT_INVALID', '新增记忆不能携带目标版本');
    if (action !== 'save' && (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0)) fail('MEMORY_VERSION_REQUIRED', '修改记忆需要明确条目和当前版本');
    return executePersistentCommand({
        db: dependencies.db, ...context, capabilityId: MEMORY_CAPABILITY,
        input: { action, id, content, expectedVersion },
        execute({ auditContext }) {
            const { db, safeInsert, safeUpdate } = dependencies;
            let old = action === 'save'
                ? db.prepare('SELECT * FROM ai_personal_memories WHERE content = ? AND deleted = 0').get(content)
                : db.prepare('SELECT * FROM ai_personal_memories WHERE id = ?').get(id);
            if (action === 'save' && old) return { data: { memory: memoryRow(old), unchanged: true }, changes: [], auditIds: [], requiredAuditCount: 0 };
            if (action !== 'save' && !old) fail('MEMORY_NOT_FOUND', '记忆不存在', 404);
            if (old && old.version !== expectedVersion) fail('MEMORY_VERSION_CONFLICT', '记忆已发生变化，请重新读取后修改', 409);
            let values = { content, deleted: 0, version: 1 };
            if (old) {
                if (action === 'undo') {
                    const revision = db.prepare('SELECT before_json FROM ai_personal_memory_revisions WHERE memory_id = ? AND version = ?').get(id, old.version);
                    if (!revision) fail('MEMORY_UNDO_UNAVAILABLE', '没有可撤销的记忆版本', 409);
                    const before = JSON.parse(revision.before_json);
                    values = before || { content: old.content, deleted: 1 };
                } else values = { content: action === 'update' ? content : old.content, deleted: action === 'delete' ? 1 : 0 };
                values.version = old.version + 1;
            }
            const write = old ? safeUpdate('ai_personal_memories', old.id, values, auditContext) : safeInsert('ai_personal_memories', values, auditContext);
            const memoryId = old?.id || Number(write.lastInsertRowid);
            const revision = safeInsert('ai_personal_memory_revisions', { memory_id: memoryId, version: values.version, before_json: JSON.stringify(old ? { content: old.content, deleted: old.deleted } : null) }, auditContext);
            const memory = memoryRow(db.prepare('SELECT * FROM ai_personal_memories WHERE id = ?').get(memoryId));
            return { data: { memory }, resource: { type: 'aiPersonalMemory', id: memoryId, version: memory.version }, changes: [{ resourceId: memoryId, action }], auditIds: [write.auditId, revision.auditId].filter(Boolean), requiredAuditCount: 2 };
        },
    });
}

// This is a direct chat command shortcut, not a business-domain classifier.
// Only current, affirmative command syntax authorizes persistence; quoted/history text does not.
function parseMemoryCommand(text, previous = null) {
    const value = String(text || '').trim();
    // Trailing requests authorize persistence too; reported/negated examples do not.
    if (/^(?:他说|她说|原文|示例|引用|例如|比如|如何|是否|能否)/u.test(value)
        || /(?:不要|不必|别|无需|暂不|不需要|不能)\s*(?:再|帮我)?\s*(?:记入|记到|保存到)长期记忆/u.test(value)) return null;
    let match = value.match(/^(?:请)?(?:记入长期记忆|记到长期记忆|保存到长期记忆|记住这个规则|以后按这个处理)(?:里|中)?[：:，,\s]*([\s\S]*)$/u);
    if (match) return match[1].trim() ? { action: 'save', content: match[1].trim() } : { clarification: '请在“记入长期记忆：”后写出要保留的习惯或规则。' };
    match = value.match(/^([\s\S]+?)[。！!，,；;\n]\s*(?:请帮我|请|帮我)?(?:把)?(?:这点|这一点|这条规则|这条|这个规则|这件事)?(?:记入|记到|保存到)长期记忆(?:里|中)?[。！!\s]*$/u);
    if (match) {
        const content = match[1].trim();
        // A condition governing the save itself is not a complete rule to persist.
        if (/^(?:如果|假如)/u.test(content) && !/[，,。；;]/u.test(content)) return null;
        return { action: 'save', content };
    }
    match = value.match(/^(?:请)?把(?:刚才那条|上一条)(?:长期记忆|记忆)?改成[：:，,\s]*([\s\S]+)$/u);
    if (match) return previous?.memory ? { action: 'update', id: previous.memory.id, expectedVersion: previous.memory.version, content: match[1].trim() } : { clarification: '本会话没有可定位的上一条记忆，请先指定要修改的条目。' };
    if (/^(?:请)?(?:忘掉|删除)(?:刚才那条|上一条)(?:长期)?记忆[。！!]?$/u.test(value)) return previous?.memory ? { action: 'delete', id: previous.memory.id, expectedVersion: previous.memory.version } : { clarification: '本会话没有可定位的上一条记忆。' };
    if (/^(?:请)?撤销(?:刚才|上次)(?:的)?记忆修改[。！!]?$/u.test(value)) return previous?.memory ? { action: 'undo', id: previous.memory.id, expectedVersion: previous.memory.version } : { clarification: '本会话没有可撤销的记忆修改。' };
    return null;
}

module.exports = { MEMORY_CAPABILITY, listPersonalMemories, changePersonalMemory, parseMemoryCommand };
