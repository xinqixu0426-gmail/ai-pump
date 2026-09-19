const { z } = require('zod');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { CommandExecutionError, requestHash } = require('./commandExecution.cjs');
const { analyzePartRename } = require('./partRenameImpact.cjs');
const { assertPartNamingUpdate } = require('./partNaming.cjs');
const CAPABILITY_ID = requireBusinessCapability('parts.rename_impact').capabilityId;
const INPUT = z.object({
    model: z.string().trim().min(1).max(180),
    offset: z.number().int().nonnegative().safe().default(0),
    limit: z.number().int().min(1).max(100).default(50),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

function queryPartRenameImpact(db, partId, value) {
    const parsed = INPUT.safeParse(value);
    if (!Number.isSafeInteger(partId) || partId <= 0 || !parsed.success) {
        throw new CommandExecutionError('PART_RENAME_QUERY_INVALID', '请提供有效零件 ID、新名称和分页参数', 400);
    }
    const input = parsed.data;
    if (input.offset > 0 && !input.sourceHash) {
        throw new CommandExecutionError('PART_RENAME_QUERY_HASH_REQUIRED', '继续读取影响报告时必须携带 sourceHash', 400);
    }
    return db.transaction(() => {
        const current = db.prepare('SELECT * FROM parts WHERE id = ? AND deleted_at IS NULL').get(partId);
        if (!current) throw new CommandExecutionError('PART_NOT_FOUND', '零件不存在或已停用', 404);
        const { impact, blockers } = analyzePartRename(db, current, { model: input.model });
        try { assertPartNamingUpdate(current, { model: input.model }); }
        catch (error) {
            if (!error.code) throw error;
            blockers.push({ code: error.code, message: error.message });
        }
        const nameChanged = current.model !== input.model;
        const effectiveBlockers = nameChanged ? blockers : [];
        // Includes target and bindings, not just the audit's source tables.
        const sourceHash = requestHash({ current, impact, blockers: effectiveBlockers });
        if (input.sourceHash && input.sourceHash !== sourceHash) {
            throw new CommandExecutionError('PART_RENAME_QUERY_STALE', '引用或零件资料已变化，请从第一页重新读取', 409);
        }
        const references = impact.references.slice(input.offset, input.offset + input.limit);
        return { ...impact, sourceHash, references, nameChanged,
            blockers: effectiveBlockers, expectedUpdatedAt: current.updated_at,
            nextOffset: input.offset + references.length < impact.referenceCount ? input.offset + references.length : null,
            sourceOfTruth: CAPABILITY_ID, displayOnly: true,
            warnings: [{ code: 'RENAME_REPORT_ONLY', message: '仅报告现有引用和普通改名限制，不确认实物规格，不签发改名或入库授权' }] };
    }).deferred();
}

module.exports = { queryPartRenameImpact };
