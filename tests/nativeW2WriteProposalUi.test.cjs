'use strict';
/**
 * NATIVE-W2 —— 库存调整提案卡片的展示/交互契约（纯逻辑 + 静态 UI 契约，无需浏览器）。
 *
 * 覆盖 W2 ticket §20 的 19 个 UI 场景在**决策层**的行为：
 *   卡片数值只来自服务端、delta 显式符号、clampedToZero 提示、取消零写入、
 *   重复确认只写一次、失败码映射、非提案事件不出卡片、重载历史卡片不可执行。
 * 另加静态契约：组件不做算术、模块不打日志、文案不含后端枚举、只认唯一能力。
 */
process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const proposal = require('../apps/web-next/lib/ai-write-proposal.cjs');
const client = require('../apps/web-next/lib/ai-write-proposal-client.cjs');

const MODEL = '6202轴承';
const CAPABILITY = 'inventory.parts.batch_adjust_stock';

function proposalEvent(overrides = {}) {
    const item = {
        partId: 9001,
        model: MODEL,
        currentStock: 350,
        delta: 100,
        nextStock: 450,
        clampedToZero: false,
        ...(overrides.item || {}),
    };
    return {
        type: 'write_proposal',
        stage: 'NATIVE_WRITE_PROPOSAL',
        proposal: { kind: 'part_stock_adjust', capabilityId: CAPABILITY, items: [item] },
        confirmation: {
            confirmationToken: 'opaque-token-1',
            operationId: 'op-1',
            expiresAt: null,
            toolName: 'adjust_part_stock',
            args: { items: [{ model: MODEL, changeQty: item.delta }] },
            ...(overrides.confirmation || {}),
        },
        task: { taskId: 'task-1', revision: 5, state: 'WAITING_APPROVAL', statusPath: '/api/ai/tasks/task-1', ...(overrides.task || {}) },
    };
}

function stubRequest(responses) {
    const calls = [];
    const queue = [...responses];
    return {
        calls,
        request: async (requestPath, options) => {
            calls.push({ path: requestPath, body: options?.body });
            const next = queue.shift();
            return typeof next === 'function' ? next(requestPath) : next;
        },
    };
}
const okExecute = outcome => ({ status: 200, body: { success: true, data: { outcome, task: { state: outcome?.verified ? 'SUCCEEDED' : 'RECONCILING' } } } });

// ── §4/§5 展示：只用服务端数值 ──────────────────────────────────────────────────
test('W2-UI-1 §4/§5 正向提案：卡片数值与符号全部来自服务端，不做任何前端算术', () => {
    const card = proposal.createWriteCard(proposalEvent());
    const model = proposal.toProposalCardModel(card.event);
    assert.equal(model.title, '库存调整确认');
    assert.equal(model.partLabel, MODEL);
    assert.deepEqual(model.rows.map(row => [row.label, row.value]), [
        ['当前库存', '350'],
        ['本次调整', '+100'],
        ['调整后库存', '450'],
    ]);
    assert.equal(model.directionLabel, '增加');
    // 服务端给出「异常」的 nextStock（不等于 current+delta）时，必须原样渲染服务端值。
    const odd = proposal.toProposalCardModel(proposalEvent({ item: { currentStock: 350, delta: 100, nextStock: 999 } }).proposal
        ? proposalEvent({ item: { currentStock: 350, delta: 100, nextStock: 999 } })
        : null);
    assert.equal(odd.rows[2].value, '999', '渲染的调整后库存必须来自服务端，而不是 current+delta');
});

test('W2-UI-2 §5 负向提案：显式负号与方向文字（不依赖颜色）', () => {
    const event = proposalEvent({ item: { currentStock: 60, delta: -20, nextStock: 40 } });
    const model = proposal.toProposalCardModel(event);
    assert.equal(model.rows[1].value, '−20');
    assert.equal(model.rows[2].value, '40');
    assert.equal(model.direction, 'decrease');
    assert.equal(model.directionLabel, '减少');
});

test('W2-UI-3 §6 clampedToZero：只按服务端字段提示，不在前端判断是否截断', () => {
    const clamped = proposal.toProposalCardModel(proposalEvent({ item: { currentStock: 10, delta: -50, nextStock: 0, clampedToZero: true } }));
    assert.match(clamped.notice, /减少量超过当前库存/u);
    assert.match(clamped.notice, /库存将为 0/u);
    // 服务端没有标记截断时不得自行推断（即使 nextStock 为 0）。
    const notClamped = proposal.toProposalCardModel(proposalEvent({ item: { currentStock: 50, delta: -50, nextStock: 0, clampedToZero: false } }));
    assert.equal(notClamped.notice, '');
});

// ── §7/§8/§9 确认与取消 ────────────────────────────────────────────────────────
test('W2-UI-4 §7 执行请求体只包含服务端签发的不透明身份', () => {
    const card = proposal.createWriteCard(proposalEvent());
    assert.deepEqual(proposal.buildExecuteRequestBody(card), {
        version: 1,
        expectedRevision: 5,
        confirmationToken: 'opaque-token-1',
        toolName: 'adjust_part_stock',
        args: { items: [{ model: MODEL, changeQty: 100 }] },
    });
    // 改动显示值不影响请求体：显示与执行身份彻底分离。
    const tampered = { ...card, display: { currentStock: 1, delta: 999, nextStock: 1000 } };
    assert.deepEqual(proposal.buildExecuteRequestBody(tampered), proposal.buildExecuteRequestBody(card));
});

test('W2-UI-5 §8/§13 重复确认只发起一次执行，且活动态不允许取消', async () => {
    const card = proposal.createWriteCard(proposalEvent());
    const { calls, request } = stubRequest([okExecute({ verified: true, stock: 450, model: MODEL })]);
    const pending = proposal.reduceWriteCard(card, { type: 'confirm' });
    assert.equal(pending.status, 'executing');
    assert.equal(pending.busy, true);
    assert.equal(proposal.pendingMessage(pending.status), '正在执行并核验库存…');
    assert.equal(proposal.isExecutableCard(pending), false);
    assert.equal(proposal.canCancelWriteCard(pending), false);
    const again = proposal.reduceWriteCard(pending, { type: 'confirm' });
    assert.equal(again.attempts, 1, '第二次确认不得再次进入执行');
    // 真实流程：客户端拿到的仍是**服务端提案**（display 态只用于禁用按钮）。
    const result = await client.confirmNativeWriteProposal({ request, card, wait: async () => {} });
    assert.equal(result.kind, 'verified');
    const settled = proposal.reduceWriteCard(pending, { type: 'settled', outcome: result.outcome });
    assert.equal(settled.status, 'succeeded');
    assert.deepEqual(settled.success.rows.map(row => row.value), [MODEL, '350 → 450', '450']);
    assert.equal(proposal.isExecutableCard(settled), false, '成功后卡片必须不可再执行');
    assert.equal(calls.length, 1, '只允许一次执行请求');
    assert.match(calls[0].path, /\/write-execute$/u);
});

test('W2-UI-6 §9 取消：零写入、卡片失活、可再次确认被拒绝', async () => {
    const card = proposal.createWriteCard(proposalEvent());
    const { calls, request } = stubRequest([]);
    const cancelled = proposal.reduceWriteCard(card, { type: 'cancel' });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.notice, '已取消本次库存调整。');
    assert.equal(proposal.buildExecuteRequestBody(cancelled), null, '取消后的卡片不能构造执行请求');
    assert.equal(proposal.isExecutableCard(cancelled), false);
    const after = proposal.reduceWriteCard(cancelled, { type: 'confirm' });
    assert.equal(after.status, 'cancelled', '取消后再次确认必须被忽略');
    await client.confirmNativeWriteProposal({ request, card: cancelled, wait: async () => {} });
    assert.equal(calls.length, 0, '取消绝不能产生任何后端请求');
});

// ── §10/§11/§12 成功、对账与失败映射 ────────────────────────────────────────────
test('W2-UI-7 §10 成功只认服务端 verified，且用核实值而非提案值', () => {
    const card = proposal.createWriteCard(proposalEvent({ item: { currentStock: 350, delta: 100, nextStock: 450 } }));
    // 执行返回「未核实」的 nextStock 变化：不算成功。
    const unverified = proposal.reduceWriteCard({ ...card, status: 'executing', busy: true }, {
        type: 'settled',
        outcome: { verified: false, code: 'WRITE_VERIFICATION_STOCK_MISMATCH' },
    });
    assert.equal(unverified.status, 'failed');
    assert.match(unverified.failure.message, /未通过库存核验/u);
    // 核实值 4xx 与提案 nextStock 不同：成功态必须显示核实值。
    const verified = proposal.reduceWriteCard({ ...card, status: 'executing', busy: true }, {
        type: 'settled',
        outcome: { verified: true, stock: 452, model: MODEL },
    });
    assert.equal(verified.status, 'succeeded');
    assert.equal(verified.success.verifiedStock, 452);
    assert.deepEqual(verified.success.rows[1].value, '350 → 452');
});

test('W2-UI-8 §11 对账：先显示核对态，成功/安全失败分别收敛，绝不自动重发写入', async () => {
    const card = proposal.createWriteCard(proposalEvent());
    const pendingCard = proposal.reduceWriteCard(card, { type: 'confirm' });
    assert.equal(proposal.pendingMessage(pendingCard.status), '正在执行并核验库存…');
    const { calls, request } = stubRequest([
        { status: 200, body: { success: true, data: { outcome: null, task: { state: 'RECONCILING' }, resolved: false, status: 'PENDING' } } },
        { status: 200, body: { success: true, data: { outcome: { verified: true, stock: 450, model: MODEL }, task: { state: 'SUCCEEDED' }, resolved: true, status: 'COMPLETED' } } },
    ]);
    const result = await client.confirmNativeWriteProposal({ request, card, wait: async () => {} });
    assert.equal(result.kind, 'verified');
    assert.equal(calls.length, 2);
    assert.match(calls[1].path, /\/write-reconcile$/u);
    assert.equal(calls.filter(call => /write-execute/u.test(call.path)).length, 1, '绝不允许第二次执行请求');

    // 安全失败：MISSING → 明确失败文案，且不再重试写入。
    const failed = await client.confirmNativeWriteProposal({
        request: stubRequest([
            { status: 200, body: { success: true, data: { outcome: null, task: { state: 'RECONCILING' }, status: 'PENDING' } } },
            { status: 200, body: { success: true, data: { outcome: null, task: { state: 'FAILED' }, status: 'MISSING' } } },
        ]).request,
        card,
        wait: async () => {},
    });
    assert.equal(failed.kind, 'failed');
    assert.match(failed.failure.message, /未确认执行成功|暂时无法确认/u);
});

test('W2-UI-9 §12 失败码确定性映射，且文案不含任何后端枚举名', () => {
    const expectations = [
        ['confirmation_token_expired', /确认已失效，请重新生成库存调整方案/u],
        ['confirmation_token_invalid', /该确认已失效，请重新生成调整方案/u],
        ['resource_version_conflict', /库存状态已经发生变化/u],
        ['confirmation_payload_mismatch', /本次确认内容与原方案不一致/u],
        ['OPERATION_MISSING', /未确认执行成功，系统没有重复写入/u],
        ['RECONCILIATION_BOUND_EXCEEDED', /暂时无法确认本次库存调整结果/u],
        ['OPERATION_AMBIGUOUS', /暂时无法确认本次库存调整结果/u],
        ['WRITE_VERIFICATION_MISSING', /未通过库存核验/u],
        ['WRITE_VERIFICATION_STOCK_MISMATCH', /未通过库存核验/u],
        ['part_stock_readback_mismatch', /未通过库存核验/u],
        ['NATIVE_WRITE_OWNER_REQUIRED', /当前账号无权执行该操作/u],
        ['AI_OWNER_ONLY', /当前账号无权执行该操作/u],
        ['AI_NATIVE_WRITE_DISABLED', /AI 写入当前未开放/u],
    ];
    for (const [code, pattern] of expectations) {
        assert.match(proposal.failureFromCode(code).message, pattern, code);
        // 用户文案里绝不能出现后端码本身。
        assert.equal(proposal.failureFromCode(code).message.includes(code), false, code);
    }
    // HTTP 层：401/403 → 授权；其余未知 → 结果未知（绝不声称成功）。
    assert.match(proposal.failureFromExecuteError({ status: 401 }).message, /无权执行/u);
    assert.match(proposal.failureFromExecuteError({ status: 403 }).message, /无权执行/u);
    assert.match(proposal.failureFromExecuteError({ status: 500 }).message, /未确认执行成功/u);
    assert.equal(proposal.failureFromOutcome({ verified: true, stock: 1 }), null);
    // 所有失败面都不提供「重试写入」。
    assert.equal(proposal.failureFromCode('OPERATION_MISSING').retryAllowed, false);
});

// ── §13/§14/§15/§18 绝不出卡片的输入 ───────────────────────────────────────────
test('W2-UI-10 §13/§14/§15/§18 澄清、非 W1 能力、写未开放等事件一律不产生可执行卡片', () => {
    const nonCards = [
        // 绝对目标值澄清
        { type: 'detail', state: 'WRITE_CLARIFICATION_REQUIRED', code: 'NATIVE_WRITE_ABSOLUTE_STOCK_UNSUPPORTED' },
        // 缺数量 / 目标歧义 / 多目标
        { type: 'detail', state: 'WRITE_CLARIFICATION_REQUIRED', code: 'NATIVE_WRITE_QUANTITY_REQUIRED' },
        { type: 'detail', state: 'WRITE_CLARIFICATION_REQUIRED', code: 'part_stock_target_ambiguous' },
        { type: 'detail', state: 'WRITE_CLARIFICATION_REQUIRED', code: 'NATIVE_WRITE_SINGLE_TARGET_REQUIRED' },
        // 非 W1 写能力
        { type: 'detail', state: 'WRITE_UNSUPPORTED' },
        // 写未开放（生产默认）
        { type: 'detail', state: 'WRITE_DISABLED', nativeWriteEnabled: false },
        { type: 'status', stage: 'native_write_disabled' },
        { type: 'content', content: '本次请求包含写操作意图（零件库存调整）。AI 写入当前未开放…' },
        // 其它能力伪装的提案事件
        (() => {
            const event = proposalEvent();
            return { ...event, proposal: { ...event.proposal, capabilityId: 'inventory.coils.batch_adjust_stock' } };
        })(),
        (() => {
            const event = proposalEvent();
            return { ...event, confirmation: { ...event.confirmation, confirmationToken: '' } };
        })(),
        (() => {
            const event = proposalEvent();
            return { ...event, task: { ...event.task, taskId: '' } };
        })(),
    ];
    for (const event of nonCards) {
        assert.equal(proposal.isNativeWriteProposalEvent(event), false, JSON.stringify(event).slice(0, 120));
        assert.equal(proposal.toProposalCardModel(event), null);
        const card = proposal.createWriteCard(event);
        assert.equal(card.status, 'expired', '非提案事件只能得到不可执行卡片');
        assert.equal(proposal.buildExecuteRequestBody(card), null);
    }
});

// ── §17 重载/历史 ─────────────────────────────────────────────────────────────
test('W2-UI-11 §17 重载后的历史卡片不可执行，也绝不从显示值重建请求', () => {
    const historical = proposal.hydrateHistoricalWriteCard();
    assert.equal(historical.status, 'expired');
    assert.equal(historical.event, null, '历史卡片不持有任何可执行身份');
    assert.equal(historical.notice, '该库存调整方案已失效，请重新生成方案。');
    assert.equal(proposal.buildExecuteRequestBody(historical), null);
    assert.equal(proposal.isExecutableCard(historical), false);
    assert.equal(proposal.toProposalCardModel(historical.event), null);
    // 过期卡片再次确认无效。
    assert.equal(proposal.reduceWriteCard(historical, { type: 'confirm' }).status, 'expired');
});

// ── §22/§23 静态契约 ──────────────────────────────────────────────────────────
test('W2-UI-12 §4/§21 静态契约：组件不做算术、不显示内部证据、只认唯一能力', () => {
    const root = path.join(__dirname, '..');
    const rawCardSource = fs.readFileSync(path.join(root, 'apps/web-next/components/ai/NativeWriteProposalCard.tsx'), 'utf8');
    // 注释里可以写「不得显示 X」，因此只扫描真实代码。
    const cardSource = rawCardSource.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    // 组件不得自己算 nextStock。
    assert.equal(/currentStock\s*[+-]|delta\s*\+\s*|nextStock\s*=/u.test(cardSource), false, '组件不得计算库存数值');
    // 组件不得显示内部证据/术语。
    for (const forbidden of ['operationId', 'idempotencyKey', 'argsHash', 'proposalHash', 'RECONCILING', 'WAITING_APPROVAL', 'taskId']) {
        assert.equal(cardSource.includes(forbidden), false, `组件不得渲染 ${forbidden}`);
    }
    // 组件必须使用真实按钮（可聚焦、可禁用）。
    assert.match(cardSource, /from '@\/components\/ui\/button'/u);
    assert.match(cardSource, /disabled=\{!canConfirmWriteCard\(card\)\}/u);
    assert.match(cardSource, /disabled=\{!canCancelWriteCard\(card\)\}/u);
    // 组件必须直接消费服务端行值。
    assert.match(cardSource, /model\.rows\[2\]\.value/u);

    const moduleSource = fs.readFileSync(path.join(root, 'apps/web-next/lib/ai-write-proposal.cjs'), 'utf8');
    const clientSource = fs.readFileSync(path.join(root, 'apps/web-next/lib/ai-write-proposal-client.cjs'), 'utf8');
    for (const [name, source] of [['proposal', moduleSource], ['client', clientSource]]) {
        assert.equal(/console\.(log|info|debug|warn|error)/u.test(source), false, `${name} 模块不得打印任何内容`);
        assert.equal(/localStorage|sessionStorage/u.test(source), false, `${name} 模块不得把执行身份写进浏览器存储`);
    }
});

test('W2-UI-13 §16 每个服务端提案是独立身份：文本相同也不合并，卡片各自独立', () => {
    const first = proposal.createWriteCard(proposalEvent({ task: { taskId: 'task-A' } }));
    const second = proposal.createWriteCard(proposalEvent({ task: { taskId: 'task-B' }, confirmation: { confirmationToken: 'opaque-token-2' } }));
    assert.notEqual(first.event.task.taskId, second.event.task.taskId);
    const firstExecuting = proposal.reduceWriteCard(first, { type: 'confirm' });
    assert.equal(firstExecuting.status, 'executing');
    assert.equal(second.status, 'proposed', '另一张卡片不受影响，仍是可确认状态');
    assert.equal(proposal.buildExecuteRequestBody(firstExecuting), null);
    assert.equal(proposal.buildExecuteRequestBody(second).confirmationToken, 'opaque-token-2');
});
