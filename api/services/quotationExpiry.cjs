const { randomUUID } = require('crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { executePersistentCommand } = require('./commandExecution.cjs');
const { nextBjtTime } = require('./scheduleTime.cjs');

const DEFAULT_EXPIRY_MONTHS = 1;
const DEFAULT_RUN_HOUR_BJT = 0;
const DEFAULT_RUN_MINUTE_BJT = 5;
const PROCESS_RUN_ID = randomUUID();
const QUOTATION_EXPIRY_CAPABILITY_ID = requireBusinessCapability(
    'quotations.expire_overdue'
).capabilityId;

function bjtDateKey(now = new Date()) {
    return new Date(
        new Date(now).getTime() + 8 * 60 * 60 * 1000
    ).toISOString().slice(0, 10);
}

function quotationExpiryCommandContext({
    trigger = 'internal',
    now = new Date(),
} = {}) {
    const normalizedTrigger = String(trigger || 'internal').trim();
    const stableWindow = normalizedTrigger === 'scheduled'
        ? bjtDateKey(now)
        : normalizedTrigger === 'startup'
            ? PROCESS_RUN_ID
            : randomUUID();
    return {
        actorKey: 'system:quotation-expiry',
        idempotencyKey:
            `quotation-expiry:${normalizedTrigger}:${stableWindow}`,
        operationId: randomUUID(),
        requestId: null,
        warnings: [],
    };
}

function quotationExpiryCutoff(now = new Date(), expiryMonths = DEFAULT_EXPIRY_MONTHS) {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - expiryMonths);
    return cutoff;
}

function expireOverdueQuotations({
    db,
    safeUpdate,
    now = new Date(),
    expiryMonths = DEFAULT_EXPIRY_MONTHS,
    trigger = 'internal',
    commandContext,
} = {}) {
    if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
        throw new Error('报价过期维护缺少数据库依赖');
    }
    if (typeof safeUpdate !== 'function') {
        throw new Error('报价过期维护缺少 safeUpdate');
    }

    const startedAt = new Date(now).toISOString();
    const cutoff = quotationExpiryCutoff(now, expiryMonths);
    const normalizedTrigger = String(trigger || 'internal').trim();
    return executePersistentCommand({
        db,
        capabilityId: QUOTATION_EXPIRY_CAPABILITY_ID,
        input: {
            trigger: normalizedTrigger,
            expiryMonths,
        },
        ...(
            commandContext || quotationExpiryCommandContext({
                trigger: normalizedTrigger,
                now,
            })
        ),
        execute: ({ auditContext }) => {
            const rows = db.prepare(`
                SELECT id
                FROM quotations
                WHERE deleted_at IS NULL
                  AND status = ?
                  AND created_at <= ?
                ORDER BY id
            `).all('报价中', cutoff.toISOString());
            const quotationIds = rows.map(row => Number(row.id));
            const auditIds = [];
            for (const quotationId of quotationIds) {
                const write = safeUpdate(
                    'quotations',
                    quotationId,
                    { status: '已过时' },
                    auditContext
                );
                if (write?.auditId) auditIds.push(write.auditId);
            }
            const changes = quotationIds.map(quotationId => ({
                resourceType: 'quotation',
                resourceId: quotationId,
                field: 'status',
                from: '报价中',
                to: '已过时',
            }));
            return {
                data: {
                    startedAt,
                    cutoff: cutoff.toISOString(),
                    trigger: normalizedTrigger,
                    expiredCount: quotationIds.length,
                    quotationIds,
                },
                resource: {
                    type: 'quotationExpiry',
                    ids: quotationIds,
                },
                changes,
                auditIds,
                requiredAuditCount: quotationIds.length,
            };
        },
    });
}

function createQuotationExpiryMaintenance({
    run,
    logger,
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    runHourBjt = DEFAULT_RUN_HOUR_BJT,
    runMinuteBjt = DEFAULT_RUN_MINUTE_BJT,
} = {}) {
    if (typeof run !== 'function') throw new Error('报价过期维护缺少 run');
    let timer = null;
    let started = false;

    function runOnce(trigger = 'scheduled') {
        try {
            const result = run(now(), trigger);
            logger?.info?.('报价过期维护完成', {
                operationId: result.operationId,
                trigger,
                cutoff: result.cutoff,
                expiredCount: result.expiredCount,
            });
            return result;
        } catch (error) {
            logger?.error?.('报价过期维护失败', { trigger, error });
            return {
                operationId: randomUUID(),
                status: 'failed',
                trigger,
                startedAt: now().toISOString(),
                completedAt: now().toISOString(),
                expiredCount: 0,
                changes: [],
                warnings: [],
                error: error.message,
            };
        }
    }

    function scheduleNext() {
        if (!started) return;
        const current = now();
        const target = nextBjtTime(runHourBjt, runMinuteBjt, current);
        const delay = target.getTime() - current.getTime();
        logger?.info?.('已安排下次报价过期维护', {
            scheduledAt: target.toISOString(),
            delayMs: delay,
        });
        timer = setTimer(() => {
            timer = null;
            runOnce('scheduled');
            scheduleNext();
        }, delay);
        if (typeof timer?.unref === 'function') timer.unref();
    }

    function start({ runImmediately = true } = {}) {
        if (started) return;
        started = true;
        if (runImmediately) runOnce('startup');
        scheduleNext();
    }

    function stop() {
        started = false;
        if (timer) clearTimer(timer);
        timer = null;
    }

    return {
        runOnce,
        start,
        stop,
        isStarted: () => started,
    };
}

module.exports = {
    DEFAULT_EXPIRY_MONTHS,
    DEFAULT_RUN_HOUR_BJT,
    DEFAULT_RUN_MINUTE_BJT,
    QUOTATION_EXPIRY_CAPABILITY_ID,
    bjtDateKey,
    quotationExpiryCutoff,
    quotationExpiryCommandContext,
    expireOverdueQuotations,
    createQuotationExpiryMaintenance,
};
