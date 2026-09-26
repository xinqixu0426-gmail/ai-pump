'use strict';

/**
 * NATIVE-W2 —— 零件库存调整提案卡片的**纯展示与状态逻辑**。
 *
 * 契约（W2 ticket §3–§17）：
 *   - 只消费服务端已批准的契约：SSE `type=write_proposal` / `stage=NATIVE_WRITE_PROPOSAL`；
 *   - 卡片上的每个数字都取自服务端冻结提案，**前端不做任何算术**（连 nextStock 也不自己算）；
 *   - 成功必须有服务端 `verified === true` 与核实的库存值；
 *   - 失败按后端码确定性映射为可读文案，且**不出现后端枚举名**；
 *   - 确认只使用服务端签发的不透明身份（taskId/revision/token/toolName/args 原样转发）；
 *   - 取消、过期、重载后的历史卡片都不可能再执行；
 *   - 绝不记录/输出 confirmationToken。
 *
 * 逻辑写成 CommonJS，便于根测试栈（node --test）直接覆盖；组件只做渲染。
 */

const WRITE_PROPOSAL_TOOL = 'adjust_part_stock';
const WRITE_PROPOSAL_CAPABILITY = 'inventory.parts.batch_adjust_stock';
const WRITE_PROPOSAL_STAGE = 'NATIVE_WRITE_PROPOSAL';

/** 卡片状态。执行中/核对中是活动态；其余为终态或不可执行态。 */
const WRITE_CARD_STATUS = Object.freeze({
    PROPOSED: 'proposed',
    EXECUTING: 'executing',
    RECONCILING: 'reconciling',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
});

const ACTIVE_STATUSES = Object.freeze([WRITE_CARD_STATUS.EXECUTING, WRITE_CARD_STATUS.RECONCILING]);

/** §12 后端码 → 用户文案（确定性映射；文案里不出现任何后端枚举/内部术语）。 */
const FAILURE_MESSAGES = Object.freeze({
    expired: '确认已失效，请重新生成库存调整方案。',
    stale: '该确认已失效，请重新生成调整方案。',
    version_drift: '库存状态已经发生变化，请基于最新库存重新确认。',
    payload_mismatch: '本次确认内容与原方案不一致，未执行修改。',
    unknown_outcome: '本次操作未确认执行成功，系统没有重复写入。请重新核对库存。',
    manual_review: '暂时无法确认本次库存调整结果，请先核对当前库存后再操作。',
    verification_failed: '写入结果未通过库存核验，不能确认调整成功。',
    authorization: '当前账号无权执行该操作。',
    write_disabled: 'AI 写入当前未开放，本次没有执行任何修改。',
    in_flight: '该任务已有库存调整正在执行或等待核对，暂不能重复执行。',
    state_invalid: '该方案当前不可执行，请重新生成方案。',
    rejection: '本次库存调整没有完成，请核对当前库存后重试。',
});

/** 精确映射：确认卡/执行期的后端错误码。 */
const FAILURE_CODES = Object.freeze({
    confirmation_token_expired: 'expired',
    confirmation_token_invalid: 'stale',
    TASK_NOT_FOUND: 'stale',
    TASK_REVISION_CONFLICT: 'version_drift',
    resource_version_conflict: 'version_drift',
    confirmation_payload_mismatch: 'payload_mismatch',
    TASK_COMMAND_ADMISSION_INVALID: 'payload_mismatch',
    TASK_COMMAND_CONTEXT_INVALID: 'payload_mismatch',
    TASK_COMMAND_REQUEST_INVALID: 'payload_mismatch',
    TASK_COMMAND_IDEMPOTENCY_MISMATCH: 'payload_mismatch',
    OPERATION_MISSING: 'unknown_outcome',
    RECONCILIATION_BOUND_EXCEEDED: 'manual_review',
    OPERATION_AMBIGUOUS: 'manual_review',
    NATIVE_WRITE_OWNER_REQUIRED: 'authorization',
    AI_OWNER_ONLY: 'authorization',
    AI_NATIVE_WRITE_DISABLED: 'write_disabled',
    TASK_WRITE_INFLIGHT: 'in_flight',
    TASK_WRITE_STATE_INVALID: 'state_invalid',
    TASK_WRITE_DETACHED_REQUIRED: 'state_invalid',
    TASK_WRITE_GOAL_INVALID: 'state_invalid',
    TASK_WRITE_POLICY_FORBIDDEN: 'state_invalid',
});

/** 前缀族：核验类与回读类一律归入「未通过库存核验」。 */
const VERIFICATION_PREFIXES = Object.freeze(['WRITE_VERIFICATION_', 'part_stock_readback_']);

const UNAVAILABLE_MESSAGE = '该库存调整方案已失效，请重新生成方案。';
const CANCELLED_MESSAGE = '已取消本次库存调整。';
const CLAMPED_NOTICE = '注意：本次减少量超过当前库存，执行后库存将为 0。';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isFiniteInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value);
}

/** SSE 事件是否为本能力的结构化提案（唯一允许出卡片的能力）。 */
function isNativeWriteProposalEvent(event) {
    return isPlainObject(event)
        && event.type === 'write_proposal'
        && event.stage === WRITE_PROPOSAL_STAGE
        && isPlainObject(event.proposal)
        && event.proposal.capabilityId === WRITE_PROPOSAL_CAPABILITY
        && Array.isArray(event.proposal.items)
        && event.proposal.items.length === 1
        && Boolean(event.confirmation?.confirmationToken)
        && typeof event.task?.taskId === 'string' && event.task.taskId.length > 0;
}

/** 提案实体校验：只接受服务端完整给出的展示事实。 */
function isNativeWriteProposalItem(item) {
    return isPlainObject(item)
        && isFiniteInteger(item.partId) && item.partId > 0
        && typeof item.model === 'string' && item.model.trim().length > 0
        && isFiniteInteger(item.currentStock)
        && isFiniteInteger(item.delta) && item.delta !== 0
        && isFiniteInteger(item.nextStock);
}

function deltaDirection(delta) {
    if (!isFiniteInteger(delta) || delta === 0) return 'none';
    return delta > 0 ? 'increase' : 'decrease';
}

/** §5 显式符号：正 +100，负 −20（U+2212），不依赖颜色。 */
function formatDelta(delta) {
    if (!isFiniteInteger(delta)) return '';
    return `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
}

function directionLabel(direction) {
    if (direction === 'increase') return '增加';
    if (direction === 'decrease') return '减少';
    return '无变化';
}

/**
 * §4/§6 卡片展示模型：全部数字来自服务端提案（含 nextStock 与 clampedToZero），
 * 前端不做任何加减。
 */
function toProposalCardModel(event) {
    if (!isNativeWriteProposalEvent(event)) return null;
    const item = event.proposal.items[0];
    if (!isNativeWriteProposalItem(item)) return null;
    const direction = deltaDirection(item.delta);
    return Object.freeze({
        title: '库存调整确认',
        partLabel: item.model,
        partId: item.partId,
        rows: Object.freeze([
            Object.freeze({ key: 'current', label: '当前库存', value: String(item.currentStock) }),
            Object.freeze({ key: 'delta', label: '本次调整', value: formatDelta(item.delta) }),
            Object.freeze({ key: 'next', label: '调整后库存', value: String(item.nextStock) }),
        ]),
        direction,
        directionLabel: directionLabel(direction),
        currentStock: item.currentStock,
        delta: item.delta,
        nextStock: item.nextStock,
        // §6：只使用服务端给出的确定性事实，不在前端判断是否发生截断。
        notice: item.clampedToZero === true ? CLAMPED_NOTICE : '',
        confirmLabel: '确认执行',
        cancelLabel: '取消',
    });
}

function failureCategory(code) {
    if (typeof code !== 'string' || !code) return 'rejection';
    if (Object.prototype.hasOwnProperty.call(FAILURE_CODES, code)) return FAILURE_CODES[code];
    if (VERIFICATION_PREFIXES.some(prefix => code.startsWith(prefix))) return 'verification_failed';
    return 'rejection';
}

function failureModel(category) {
    const resolved = Object.prototype.hasOwnProperty.call(FAILURE_MESSAGES, category) ? category : 'rejection';
    return Object.freeze({
        category: resolved,
        message: FAILURE_MESSAGES[resolved],
        // 永远不提供「重试写入」：只能核对库存后重新生成方案。
        retryAllowed: false,
    });
}

function failureFromCode(code) {
    return failureModel(failureCategory(code));
}

/** 执行请求失败（HTTP/网络）→ 失败模型；401/403 归入授权。 */
function failureFromExecuteError(error) {
    const code = isPlainObject(error) && typeof error.code === 'string' ? error.code : '';
    const status = isPlainObject(error) && Number.isFinite(Number(error.status)) ? Number(error.status) : null;
    if (code) return failureFromCode(code);
    if (status === 401 || status === 403) return failureModel('authorization');
    // 传输层异常：结果未知，绝不声称成功。
    return failureModel('unknown_outcome');
}

/** 服务端 outcome → 失败模型；已核实成功返回 null。 */
function failureFromOutcome(outcome) {
    if (!isPlainObject(outcome)) return failureModel('unknown_outcome');
    if (outcome.verified === true) return null;
    return failureFromCode(outcome.code);
}

/**
 * §10 成功模型：after 必须来自服务端核实值（outcome.stock），
 * 绝不用提案的 nextStock 冒充。
 */
function successModelFromOutcome(outcome, proposal) {
    if (!isPlainObject(outcome) || outcome.verified !== true || !isFiniteInteger(outcome.stock)) return null;
    const item = isPlainObject(proposal) && Array.isArray(proposal.items) ? proposal.items[0] : null;
    const partLabel = typeof outcome.model === 'string' && outcome.model.trim()
        ? outcome.model.trim()
        : (item?.model || '');
    return Object.freeze({
        title: '库存调整完成',
        partLabel,
        before: item && isFiniteInteger(item.currentStock) ? item.currentStock : null,
        after: outcome.stock,
        verifiedStock: outcome.stock,
        rows: Object.freeze([
            Object.freeze({ key: 'part', label: '零件', value: partLabel }),
            Object.freeze({
                key: 'change',
                label: '库存',
                value: item && isFiniteInteger(item.currentStock) ? `${item.currentStock} → ${outcome.stock}` : `已核实 ${outcome.stock}`,
            }),
            Object.freeze({ key: 'verified', label: '已核实当前库存', value: String(outcome.stock) }),
        ]),
    });
}

/** §8/§11 活动态文案（可读、不依赖动画；不含任何内部枚举）。 */
function pendingMessage(status) {
    if (status === WRITE_CARD_STATUS.EXECUTING) return '正在执行并核验库存…';
    if (status === WRITE_CARD_STATUS.RECONCILING) return '正在核对本次库存调整结果…';
    return '';
}

function isActiveStatus(status) {
    return ACTIVE_STATUSES.includes(status);
}

/** 只有「服务端提案已就绪且没有在途请求」才允许确认（§8/§16 前端防重复）。 */
function canConfirmWriteCard(card) {
    return isPlainObject(card)
        && card.status === WRITE_CARD_STATUS.PROPOSED
        && card.busy !== true
        && isNativeWriteProposalEvent(card.event);
}

function canCancelWriteCard(card) {
    if (!isPlainObject(card)) return false;
    if (isActiveStatus(card.status)) return false;
    return [WRITE_CARD_STATUS.PROPOSED, WRITE_CARD_STATUS.FAILED, WRITE_CARD_STATUS.EXPIRED].includes(card.status);
}

/** §17 只有「当前仍可执行」的卡片能执行；历史/过期/取消/终态一律不可。 */
function isExecutableCard(card) {
    return canConfirmWriteCard(card);
}

function createWriteCard(event) {
    return Object.freeze({
        status: isNativeWriteProposalEvent(event) ? WRITE_CARD_STATUS.PROPOSED : WRITE_CARD_STATUS.EXPIRED,
        event: isNativeWriteProposalEvent(event) ? event : null,
        busy: false,
        attempts: 0,
        failure: null,
        success: null,
        notice: '',
    });
}

/**
 * §17 历史/重载水合：只要后端没有给出「当前可执行」的确认状态，
 * 就渲染为失效卡片；**绝不**用显示值重建执行请求。
 */
function hydrateHistoricalWriteCard() {
    return Object.freeze({
        status: WRITE_CARD_STATUS.EXPIRED,
        event: null,
        busy: false,
        attempts: 0,
        failure: failureModel('stale'),
        success: null,
        notice: UNAVAILABLE_MESSAGE,
    });
}

/**
 * §7 执行请求体：原样转发服务端签发的不透明身份，绝不从显示值重建。
 * 任何显示字段（currentStock/delta/nextStock/model）都不参与。
 */
function buildExecuteRequestBody(card) {
    if (!canConfirmWriteCard(card)) return null;
    const { event } = card;
    return {
        version: 1,
        expectedRevision: event.task.revision,
        confirmationToken: event.confirmation.confirmationToken,
        toolName: event.confirmation.toolName,
        args: event.confirmation.args,
    };
}

/**
 * 确定性状态机。活动态与终态忽略后续动作：
 * 重复确认、取消后确认、过期后确认都不会产生第二次执行。
 */
function reduceWriteCard(card, action) {
    const current = isPlainObject(card) ? card : hydrateHistoricalWriteCard();
    const type = isPlainObject(action) ? action.type : null;
    if (!type) return current;

    if (type === 'cancel') {
        // §9 取消：不发起任何执行请求，只是本地失活。
        if (!canCancelWriteCard(current)) return current;
        return Object.freeze({ ...current, status: WRITE_CARD_STATUS.CANCELLED, busy: false, failure: null, notice: CANCELLED_MESSAGE });
    }
    if (type === 'expire') {
        if (isActiveStatus(current.status) || current.status === WRITE_CARD_STATUS.SUCCEEDED) return current;
        return Object.freeze({ ...current, status: WRITE_CARD_STATUS.EXPIRED, busy: false, failure: failureModel('stale'), notice: UNAVAILABLE_MESSAGE });
    }
    if (type === 'confirm') {
        if (!canConfirmWriteCard(current)) return current;
        return Object.freeze({ ...current, status: WRITE_CARD_STATUS.EXECUTING, busy: true, attempts: current.attempts + 1, failure: null, notice: '' });
    }
    if (type === 'reconcile') {
        if (current.status !== WRITE_CARD_STATUS.EXECUTING) return current;
        return Object.freeze({ ...current, status: WRITE_CARD_STATUS.RECONCILING, busy: true, notice: pendingMessage(WRITE_CARD_STATUS.RECONCILING) });
    }
    if (type === 'settled') {
        if (!isActiveStatus(current.status)) return current;
        const success = successModelFromOutcome(action.outcome, current.event?.proposal);
        if (success) {
            return Object.freeze({ ...current, status: WRITE_CARD_STATUS.SUCCEEDED, busy: false, success, failure: null, notice: '' });
        }
        return Object.freeze({
            ...current,
            status: WRITE_CARD_STATUS.FAILED,
            busy: false,
            success: null,
            failure: action.failure || failureFromOutcome(action.outcome) || failureModel('unknown_outcome'),
            notice: '',
        });
    }
    return current;
}

module.exports = {
    ACTIVE_STATUSES,
    CLAMPED_NOTICE,
    CANCELLED_MESSAGE,
    FAILURE_CODES,
    FAILURE_MESSAGES,
    UNAVAILABLE_MESSAGE,
    VERIFICATION_PREFIXES,
    WRITE_CARD_STATUS,
    WRITE_PROPOSAL_CAPABILITY,
    WRITE_PROPOSAL_STAGE,
    WRITE_PROPOSAL_TOOL,
    buildExecuteRequestBody,
    canCancelWriteCard,
    canConfirmWriteCard,
    createWriteCard,
    deltaDirection,
    directionLabel,
    failureFromCode,
    failureFromExecuteError,
    failureFromOutcome,
    failureModel,
    formatDelta,
    hydrateHistoricalWriteCard,
    isExecutableCard,
    isNativeWriteProposalEvent,
    isNativeWriteProposalItem,
    pendingMessage,
    reduceWriteCard,
    successModelFromOutcome,
    toProposalCardModel,
};
