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
} = require('./ai-assistant-write-proposal.cjs');

function executePath() { return '/api/ai/write/confirm'; }

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


/**
 * 确认执行 → 必要时有界对账 → 只以服务端核实结果判定成功。
 * @returns {{kind:'verified',outcome:object}
 *          |{kind:'failed',outcome?:object,failure:object}
 *          |{kind:'reconciling',status?:string|null}
 *          |{kind:'not_executable'}}
 */
async function confirmAiAssistantWriteProposal({
    request,
    card,
}) {
    const body = buildExecuteRequestBody(card);
    if (!body) return { kind: 'not_executable' };
    let executed;
    try {
        executed = readResponse(await request(executePath(), { method: 'POST', body: JSON.stringify(body) }));
    } catch {
        // 传输层异常：结果未知，绝不声称成功。
        return { kind: 'failed', failure: failureModel('unknown_outcome') };
    }
    if (executed.status >= 400 || executed.body?.success === false) {
        return { kind: 'failed', failure: failureFromResponse(executed) };
    }
    const first = outcomeOf(executed.body);
    if (first.outcome?.verified === true) return { kind: 'verified', outcome: first.outcome };
    return { kind: 'failed', outcome: first.outcome, failure: failureFromOutcome(first.outcome) };
}

module.exports = {
    confirmAiAssistantWriteProposal,
    executePath,
    outcomeOf,
};
