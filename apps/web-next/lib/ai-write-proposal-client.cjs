'use strict';

/**
 * NATIVE-W2 —— 提案卡片的服务端交互（唯一执行/对账入口）。
 *
 * 设计：所有 HTTP 细节收敛在一个**注入式** request 适配器后面，
 * 应用里是 proxyFetch 适配器，测试里是真实 HTTP 适配器——两边跑的是完全相同的
 * 决策逻辑（含错误码映射、对账有界轮询、成功判定）。
 *
 * 安全约束（W2 ticket §7/§8/§11/§22）：
 *   - 执行请求体只来自服务端签发的不透明身份（buildExecuteRequestBody）；
 *   - 前端不重新解析目标、不重算数量、不生成幂等键、不二次预览；
 *   - 只有服务端 verified=true 才算成功；
 *   - 对账只读、有界，绝不在 UI 里自动发起第二次写入；
 *   - 绝不把 confirmationToken 写进日志。
 */

const {
    buildExecuteRequestBody,
    failureFromExecuteError,
    failureFromOutcome,
    failureModel,
} = require('./ai-write-proposal.cjs');

const RECONCILE_MAX_UI_ATTEMPTS = 3;
const RECONCILE_RETRY_DELAY_MS = 1500;

function executePath(taskId) {
    return `/api/ai/tasks/${encodeURIComponent(taskId)}/write-execute`;
}
function reconcilePath(taskId) {
    return `/api/ai/tasks/${encodeURIComponent(taskId)}/write-reconcile`;
}

/** 统一读取响应：{ status, body }；body 可能是 {success,data}、{success:false,code} 或 null。 */
function readResponse(response) {
    const status = Number(response?.status) || 0;
    const body = response?.body && typeof response.body === 'object' ? response.body : null;
    return { status, body };
}

function failureFromResponse({ status, body }) {
    const code = typeof body?.code === 'string' && body.code ? body.code : '';
    if (code) return failureFromExecuteError({ code, status });
    if (status === 401 || status === 403) return failureFromExecuteError({ status });
    return failureModel(status >= 400 ? 'rejection' : 'unknown_outcome');
}

function outcomeOf(body) {
    const data = body && typeof body === 'object' && body.data ? body.data : null;
    const outcome = data && typeof data.outcome === 'object' && data.outcome ? data.outcome : null;
    return {
        outcome,
        taskState: typeof data?.task?.state === 'string' ? data.task.state : null,
        resolved: data?.resolved === true,
        status: typeof data?.status === 'string' ? data.status : null,
    };
}

function defaultWait(attempt) {
    return new Promise(resolve => setTimeout(resolve, RECONCILE_RETRY_DELAY_MS * attempt));
}

/**
 * 确认执行 → 必要时有界对账 → 只以服务端核实结果判定成功。
 * @returns {{kind:'verified',outcome:object}
 *          |{kind:'failed',outcome?:object,failure:object}
 *          |{kind:'reconciling',status?:string|null}
 *          |{kind:'not_executable'}}
 */
async function confirmNativeWriteProposal({
    request,
    card,
    reconcileAttempts = RECONCILE_MAX_UI_ATTEMPTS,
    wait = defaultWait,
}) {
    const body = buildExecuteRequestBody(card);
    if (!body) return { kind: 'not_executable' };
    const taskId = card.event.task.taskId;

    let executed;
    try {
        executed = readResponse(await request(executePath(taskId), { method: 'POST', body: JSON.stringify(body) }));
    } catch {
        // 传输层异常：结果未知，绝不声称成功。
        return { kind: 'failed', failure: failureModel('unknown_outcome') };
    }
    if (executed.status >= 400 || executed.body?.success === false) {
        return { kind: 'failed', failure: failureFromResponse(executed) };
    }
    const first = outcomeOf(executed.body);
    if (first.outcome?.verified === true) return { kind: 'verified', outcome: first.outcome };
    if (first.outcome && first.outcome.verified === false) return { kind: 'failed', outcome: first.outcome };
    if (first.taskState !== 'RECONCILING') {
        // 既没有核实结果，也没有进入对账：结果未知。
        return { kind: 'failed', failure: failureFromOutcome(null) };
    }

    // 有界对账：只读既有 operation，不产生任何新的写入。
    let lastStatus = first.status;
    for (let attempt = 1; attempt <= reconcileAttempts; attempt += 1) {
        if (typeof wait === 'function') await wait(attempt);
        let reconciled;
        try {
            reconciled = readResponse(await request(reconcilePath(taskId), { method: 'POST', body: JSON.stringify({}) }));
        } catch {
            return { kind: 'failed', failure: failureModel('unknown_outcome') };
        }
        if (reconciled.status >= 400 || reconciled.body?.success === false) {
            return { kind: 'failed', failure: failureFromResponse(reconciled) };
        }
        const next = outcomeOf(reconciled.body);
        lastStatus = next.status || lastStatus;
        if (next.outcome?.verified === true) return { kind: 'verified', outcome: next.outcome, reconciled: true };
        if (next.outcome && next.outcome.verified === false) return { kind: 'failed', outcome: next.outcome };
        if (next.taskState && next.taskState !== 'RECONCILING') {
            return { kind: 'failed', failure: failureFromOutcome(null) };
        }
        if (next.status === 'MISSING') return { kind: 'failed', failure: failureFromOutcome({ verified: false, code: 'OPERATION_MISSING' }) };
        if (next.status === 'AMBIGUOUS') return { kind: 'failed', failure: failureFromOutcome({ verified: false, code: 'OPERATION_AMBIGUOUS' }) };
    }
    // 仍在核对：保持核对态，不声称成功也不声称失败。
    return { kind: 'reconciling', status: lastStatus };
}

module.exports = {
    RECONCILE_MAX_UI_ATTEMPTS,
    RECONCILE_RETRY_DELAY_MS,
    confirmNativeWriteProposal,
    executePath,
    outcomeOf,
    reconcilePath,
};
