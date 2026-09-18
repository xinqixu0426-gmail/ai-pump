'use client';

import {
  ArrowUpRight,
  Check,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import {
  arrayValue,
  asRecord,
  buildFactoryWorkflowShortcutPrompt,
  DataTable,
  isSafeInternalPath,
  KeyValueRows,
  money,
  textValue,
} from '@/components/ai/AiResultPrimitives';

export function OrderReadinessResult({ result }: { result: Record<string, unknown> }) {
  const data = asRecord(result.data);
  const order = asRecord(data.order);
  const metrics = asRecord(data.metrics);
  const steps = arrayValue(data.steps);
  const shortages = arrayValue(data.shortages);
  const actions = arrayValue(data.recommendedActions);
  const verdict = textValue(data.verdict);
  const verdictMeta: Record<string, { label: string; tone: StatusBadgeTone }> = {
    ready: { label: '可生产', tone: 'green' },
    waiting_materials: { label: '待补料', tone: 'amber' },
    needs_review: { label: '待复核', tone: 'orange' },
    blocked: { label: '数据阻塞', tone: 'red' },
    not_applicable: { label: '不适用', tone: 'slate' },
  };
  const currentVerdict = verdictMeta[verdict] || { label: verdict || '未知', tone: 'slate' as StatusBadgeTone };
  const stepTone = (status: unknown): StatusBadgeTone => {
    if (status === 'pass') return 'green';
    if (status === 'warning') return 'amber';
    if (status === 'fail') return 'red';
    return 'slate';
  };
  const stepLabel = (status: unknown) => {
    if (status === 'pass') return '通过';
    if (status === 'warning') return '注意';
    if (status === 'fail') return '阻塞';
    return '未执行';
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">
            订单 #{textValue(order.id)} · {textValue(order.customerName, '未命名客户')}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted">{textValue(data.summary)}</div>
        </div>
        <StatusBadge tone={currentVerdict.tone}>{currentVerdict.label}</StatusBadge>
      </div>
      <KeyValueRows rows={[
        { label: '订单状态', value: order.status },
        { label: '合同号', value: order.contractNo || '-' },
        { label: '产品数量', value: `${textValue(order.totalUnits, '0')} 台` },
        { label: '物料行', value: metrics.materialLineCount },
        { label: '缺料项', value: metrics.shortageLineCount },
        { label: '锁定成本', value: money(metrics.totalLockedCost) },
        { label: '订单金额', value: money(metrics.totalOrderPrice) },
        { label: '毛利', value: money(metrics.grossProfit) },
      ]} />
      <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
        {steps.map((item, index) => (
          <div key={textValue(item.key, String(index))} className="flex min-w-0 items-start gap-3 py-2.5">
            <StatusBadge tone={stepTone(item.status)} className="h-5 min-w-12 px-2">
              {stepLabel(item.status)}
            </StatusBadge>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink">{textValue(item.label)}</div>
              <div className="mt-0.5 text-xs leading-5 text-muted">{textValue(item.summary)}</div>
            </div>
          </div>
        ))}
      </div>
      {shortages.length > 0 ? (
        <DataTable
          rows={shortages}
          columns={[
            { key: 'model', label: '缺料' },
            { key: 'requiredQty', label: '需求' },
            { key: 'availableQty', label: '可用库存' },
            { key: 'shortageQty', label: '缺口' },
            { key: 'procurementStage', label: '当前阶段' },
          ]}
        />
      ) : null}
      {actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((item, index) => {
            const path = textValue(item.path);
            return path.startsWith('/') ? (
              <a
                key={`${textValue(item.key)}-${index}`}
                href={path}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {textValue(item.label)}
                <ArrowUpRight size={13} />
              </a>
            ) : null;
          })}
        </div>
      ) : null}
    </>
  );
}

export function OrderReadinessOverviewResult({ result }: { result: Record<string, unknown> }) {
  const data = asRecord(result.data);
  const metrics = asRecord(data.metrics);
  const items = arrayValue(data.items);
  const verdictMeta: Record<string, { label: string; tone: StatusBadgeTone }> = {
    ready: { label: '可生产', tone: 'green' },
    waiting_materials: { label: '待补料', tone: 'amber' },
    needs_review: { label: '待复核', tone: 'orange' },
    blocked: { label: '数据阻塞', tone: 'red' },
    not_applicable: { label: '不适用', tone: 'slate' },
  };

  return (
    <>
      <div className="mt-3 border-b border-slate-100 pb-3">
        <div className="text-sm font-semibold text-ink">订单准备总览</div>
        <div className="mt-1 text-xs leading-5 text-muted">{textValue(data.summary)}</div>
      </div>
      <KeyValueRows rows={[
        { label: '活动订单', value: metrics.totalActiveOrders },
        { label: '需关注', value: metrics.attentionRequired },
        { label: '数据阻塞', value: metrics.blocked },
        { label: '待补料', value: metrics.waitingMaterials },
        { label: '待复核', value: metrics.needsReview },
        { label: '可生产', value: metrics.ready },
      ]} />
      {items.length > 0 ? (
        <DataTable
          rows={items.slice(0, 12)}
          columns={[
            {
              key: 'order',
              label: '订单',
              render: (row) => {
                const order = asRecord(row.order);
                return `#${textValue(order.id)} · ${textValue(order.customerName, '未命名客户')}`;
              },
            },
            {
              key: 'verdict',
              label: '结论',
              render: (row) => {
                const verdict = textValue(row.verdict, '');
                const meta = verdictMeta[verdict] || { label: verdict || '未知', tone: 'slate' as StatusBadgeTone };
                return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
              },
            },
            {
              key: 'issue',
              label: '主要问题',
              render: (row) => {
                const blocker = arrayValue(row.blockers)[0];
                const shortage = arrayValue(row.shortages)[0];
                const warning = arrayValue(row.warnings)[0];
                if (blocker) return textValue(blocker.title);
                if (shortage) return `${textValue(shortage.model)} 缺 ${textValue(shortage.shortageQty)}${textValue(shortage.purchaseUnit, '')}`;
                if (warning) return textValue(warning.title);
                return '检查通过';
              },
            },
            {
              key: 'nextAction',
              label: '下一步',
              render: (row) => textValue(asRecord(row.nextAction).title, '无需处理'),
            },
          ]}
        />
      ) : null}
      <div className="mt-3">
        <a
          href="/dashboard?view=readiness"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          打开订单准备总览
          <ArrowUpRight size={13} />
        </a>
      </div>
    </>
  );
}

export function ManagementActionCenterResult({ result }: { result: Record<string, unknown> }) {
  const data = asRecord(result.data);
  const metrics = asRecord(data.metrics);
  const progress = asRecord(data.progress);
  const executionQueue = asRecord(data.executionQueue);
  const executionItems = arrayValue(executionQueue.items);
  const items = executionItems.length > 0 ? executionItems : arrayValue(data.items).slice(0, 3);
  const priorityMeta: Record<string, { label: string; tone: StatusBadgeTone }> = {
    critical: { label: '紧急', tone: 'red' },
    high: { label: '高优先级', tone: 'orange' },
    medium: { label: '普通', tone: 'amber' },
    low: { label: '低', tone: 'slate' },
  };

  return (
    <>
      <div className="mt-3 border-b border-slate-100 pb-3">
        <div className="text-sm font-semibold text-ink">今日执行队列</div>
        <div className="mt-1 text-xs leading-5 text-muted">
          {textValue(executionQueue.summary, textValue(data.summary))}
        </div>
      </div>
      <KeyValueRows rows={[
        { label: '待办总数', value: metrics.total },
        { label: '紧急', value: metrics.critical },
        { label: '高优先级', value: metrics.high },
        { label: '普通', value: metrics.medium },
        { label: '低优先级', value: metrics.low },
      ]} />
      {Object.keys(progress).length > 0 ? (
        <>
          <div className="mt-3 text-sm font-semibold text-ink">自动复查进展</div>
          <div className="mt-1 text-xs leading-5 text-muted">{textValue(progress.summary)}</div>
          <KeyValueRows rows={[
            { label: '近期已解决', value: progress.resolvedCount },
            { label: '仍待处理', value: progress.unresolvedCount },
            { label: '暂时受阻', value: progress.blockedCount },
            { label: '反复出现', value: progress.recurringCount },
          ]} />
        </>
      ) : null}
      {items.length > 0 ? (
        <DataTable
          rows={items.slice(0, 12)}
          columns={[
            {
              key: 'priority',
              label: '优先级',
              render: row => {
                const priority = textValue(row.priority);
                const meta = priorityMeta[priority] || { label: priority || '未知', tone: 'slate' as StatusBadgeTone };
                return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
              },
            },
            { key: 'categoryLabel', label: '来源' },
            { key: 'title', label: '待办' },
            {
              key: 'reasons',
              label: '排序依据',
              render: row => arrayValue(row.reasons).map(value => textValue(value)).filter(Boolean).join(' · '),
            },
            {
              key: 'resolution',
              label: '最短处理路径',
              render: row => textValue(asRecord(row.resolution).title, textValue(row.action)),
            },
          ]}
        />
      ) : null}
      <div className="mt-3">
        <a
          href="/dashboard?view=actions"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          打开管理待办
          <ArrowUpRight size={13} />
        </a>
      </div>
    </>
  );
}

export function WorkflowExecutionRunSummary({
  run,
  warning,
}: {
  run: Record<string, unknown>;
  warning?: string;
}) {
  if (Object.keys(run).length === 0 && !warning) return null;
  const completed = textValue(run.status, '') === 'completed';
  return (
    <div className="mt-3 border-y border-slate-100 py-3 text-xs">
      {Object.keys(run).length > 0 ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-slate-700">
              执行记录 #{textValue(run.id)} · 第 {textValue(run.attemptNumber, '1')} 次尝试
            </div>
            <div className="mt-1 leading-5 text-muted">
              {textValue(run.outcomeSummary, completed ? '执行已完成' : '执行失败')}
            </div>
            {!completed && textValue(run.errorText, '') ? (
              <div className="mt-1 leading-5 text-rose-700">{textValue(run.errorText)}</div>
            ) : null}
          </div>
          <StatusBadge tone={completed ? 'green' : 'red'}>{completed ? '已记录完成' : '已记录失败'}</StatusBadge>
        </div>
      ) : null}
      {warning ? <div className="mt-2 leading-5 text-amber-700">{warning}</div> : null}
    </div>
  );
}

export function FactoryExecutionPlanResult({
  result,
  onRequestAction,
  actionDisabled = false,
}: {
  result: Record<string, unknown>;
  onRequestAction?: (prompt: string) => void;
  actionDisabled?: boolean;
}) {
  const data = asRecord(result.data);
  const subject = asRecord(data.subject);
  const metrics = asRecord(data.metrics);
  const steps = arrayValue(data.steps);
  const safeguards = arrayValue(data.safeguards);
  const executionHistory = asRecord(data.executionHistory);
  const latestAttempt = asRecord(executionHistory.latestAttempt);
  const latestRecheck = asRecord(executionHistory.latestRecheck);
  const recovery = asRecord(executionHistory.recovery);
  const recoverableActionIds = new Set(
    Array.isArray(recovery.recoverableActionIds)
      ? recovery.recoverableActionIds.map(value => textValue(value, '')).filter(Boolean)
      : []
  );
  const statusMeta: Record<string, { label: string; tone: StatusBadgeTone }> = {
    complete: { label: '已完成', tone: 'green' },
    ready: { label: '可继续', tone: 'blue' },
    action_required: { label: '待处理', tone: 'amber' },
    needs_input: { label: '需要决定', tone: 'orange' },
    blocked: { label: '有阻塞', tone: 'red' },
    waiting: { label: '等待中', tone: 'slate' },
    not_applicable: { label: '不适用', tone: 'slate' },
  };
  const modeMeta: Record<string, { label: string; tone: StatusBadgeTone }> = {
    automatic: { label: '自动检查', tone: 'green' },
    confirmable: { label: '需确认', tone: 'blue' },
    manual: { label: '页面处理', tone: 'amber' },
    needs_input: { label: '业务判断', tone: 'orange' },
    monitor: { label: '等待状态', tone: 'slate' },
  };
  const currentStatus = statusMeta[textValue(data.status)]
    || { label: textValue(data.status, '未知'), tone: 'slate' as StatusBadgeTone };
  const stepTitles = new Map(steps.map(item => [textValue(item.id), textValue(item.title)]));

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">{textValue(subject.label, textValue(data.goal, '工厂执行计划'))}</div>
          <div className="mt-1 text-xs leading-5 text-muted">{textValue(data.summary)}</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusBadge tone={currentStatus.tone}>{currentStatus.label}</StatusBadge>
          {isSafeInternalPath(subject.path) ? (
            <a
              href={subject.path}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              打开当前业务
              <ArrowUpRight size={13} />
            </a>
          ) : null}
        </div>
      </div>
      <KeyValueRows rows={[
        { label: '总步骤', value: metrics.totalSteps },
        { label: '已检查', value: metrics.completedSteps },
        { label: '已有安全执行器', value: metrics.executableSteps },
        { label: '需要业务判断', value: metrics.needsInputSteps },
        { label: '受前置阻塞', value: metrics.blockedSteps },
      ]} />
      {Object.keys(latestAttempt).length > 0 ? (
        <div className="mt-3 border-y border-slate-100 py-3 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-slate-700">
                最近执行 · 第 {textValue(latestAttempt.attemptNumber, '1')} 次尝试
              </div>
              <div className="mt-1 leading-5 text-muted">
                {textValue(latestAttempt.outcomeSummary, textValue(recovery.message))}
              </div>
              {textValue(latestAttempt.errorText, '') ? (
                <div className="mt-1 leading-5 text-rose-700">{textValue(latestAttempt.errorText)}</div>
              ) : null}
              <div className="mt-1 leading-5 text-slate-700">{textValue(recovery.message)}</div>
              {textValue(latestRecheck.summary, '') ? (
                <div className="mt-1 leading-5 text-muted">最新复查：{textValue(latestRecheck.summary)}</div>
              ) : null}
            </div>
            <StatusBadge tone={textValue(latestAttempt.status, '') === 'completed' ? 'green' : 'red'}>
              {textValue(latestAttempt.status, '') === 'completed' ? '上次已完成' : '上次失败'}
            </StatusBadge>
          </div>
        </div>
      ) : null}
      {steps.length > 0 ? (
        <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
          {steps.map((item, index) => {
            const mode = textValue(item.mode);
            const currentMode = modeMeta[mode] || { label: mode || '处理', tone: 'slate' as StatusBadgeTone };
            const dependencies = arrayValue(item.dependsOn)
              .map(value => stepTitles.get(textValue(value)) || textValue(value))
              .filter(Boolean);
            const canExecute = Boolean(item.canExecute);
            const actionPrompt = buildFactoryWorkflowShortcutPrompt(data, item);
            return (
              <div key={textValue(item.id, String(index))} className="flex min-w-0 gap-3 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-900 text-xs font-semibold text-white">
                  {textValue(item.sequence, String(index + 1))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-ink">{textValue(item.title)}</div>
                    <StatusBadge tone={currentMode.tone}>{currentMode.label}</StatusBadge>
                    {textValue(item.status) === 'complete' ? <StatusBadge tone="green">已核对</StatusBadge> : null}
                    {textValue(item.status) === 'blocked' ? <StatusBadge tone="red">有前置步骤</StatusBadge> : null}
                    {canExecute ? <StatusBadge tone="blue">可由 AI 发起确认</StatusBadge> : null}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted">{textValue(item.reason)}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-700">
                    完成标准：{textValue(item.expectedResult)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    {dependencies.length > 0 ? <span>前置：{dependencies.join('、')}</span> : null}
                    {isSafeInternalPath(item.path) ? (
                      <a
                        href={item.path}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                      >
                        {textValue(item.status) === 'complete' ? '查看结果' : '去处理'}
                        <ArrowUpRight size={12} />
                      </a>
                    ) : null}
                    {actionPrompt && onRequestAction ? (
                      <Button
                        size="sm"
                        variant="primary"
                        className="text-xs"
                        icon={<ShieldAlert size={13} />}
                        onClick={() => onRequestAction(actionPrompt)}
                        disabled={actionDisabled}
                      >
                        {recoverableActionIds.has(textValue(item.id, '')) ? '重新发起确认' : '发起确认'}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {safeguards.length > 0 ? (
        <details className="mt-3 border-t border-slate-100 pt-3 text-xs text-muted">
          <summary className="cursor-pointer font-medium text-slate-700">执行保护</summary>
          <div className="mt-2 space-y-1">
            {safeguards.map((item, index) => <div key={index}>{textValue(item)}</div>)}
          </div>
        </details>
      ) : null}
    </>
  );
}

export function OrderReadinessPlanResult({ result }: { result: Record<string, unknown> }) {
  const data = asRecord(result.data);
  const order = asRecord(data.order);
  const metrics = asRecord(data.metrics);
  const steps = arrayValue(data.steps);
  const status = textValue(data.planStatus);
  const statusMeta: Record<string, { label: string; tone: StatusBadgeTone }> = {
    complete: { label: '无需处理', tone: 'green' },
    ready_for_confirmation: { label: '可发起确认', tone: 'blue' },
    action_required: { label: '待处理', tone: 'amber' },
    needs_resolution: { label: '先修复数据', tone: 'red' },
    waiting: { label: '等待跟进', tone: 'slate' },
    not_applicable: { label: '不适用', tone: 'slate' },
  };
  const modeMeta: Record<string, { label: string; tone: StatusBadgeTone }> = {
    confirmable: { label: 'AI可确认', tone: 'blue' },
    manual: { label: '人工处理', tone: 'amber' },
    needs_input: { label: '需要决定', tone: 'orange' },
    monitor: { label: '等待跟进', tone: 'slate' },
  };
  const currentStatus = statusMeta[status] || { label: status || '未知', tone: 'slate' as StatusBadgeTone };
  const stepTitles = new Map(steps.map((item) => [textValue(item.id), textValue(item.title)]));

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">
            订单 #{textValue(order.id)} · {textValue(order.customerName, '未命名客户')}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted">{textValue(data.summary)}</div>
        </div>
        <StatusBadge tone={currentStatus.tone}>{currentStatus.label}</StatusBadge>
      </div>
      <KeyValueRows rows={[
        { label: '总步骤', value: metrics.totalSteps },
        { label: 'AI可确认', value: metrics.confirmableSteps },
        { label: '人工处理', value: metrics.manualSteps },
        { label: '等待跟进', value: metrics.waitingSteps },
        { label: '前置阻塞', value: metrics.blockedSteps },
      ]} />
      {steps.length > 0 ? (
        <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
          {steps.map((item, index) => {
            const mode = textValue(item.mode);
            const currentMode = modeMeta[mode] || { label: mode || '处理', tone: 'slate' as StatusBadgeTone };
            const dependencies = (Array.isArray(item.dependsOn) ? item.dependsOn : [])
              .map((dependency) => stepTitles.get(String(dependency)) || String(dependency))
              .filter(Boolean);
            return (
              <div key={textValue(item.id, String(index))} className="flex min-w-0 gap-3 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-900 text-xs font-semibold text-white">
                  {textValue(item.sequence, String(index + 1))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-ink">{textValue(item.title)}</div>
                    <StatusBadge tone={currentMode.tone}>{currentMode.label}</StatusBadge>
                    {textValue(item.status) === 'blocked' ? <StatusBadge tone="red">有前置步骤</StatusBadge> : null}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted">{textValue(item.reason)}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-700">
                    完成标准：{textValue(item.expectedResult)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span>负责人：{textValue(item.owner, '管理员')}</span>
                    {dependencies.length > 0 ? <span>前置：{dependencies.join('、')}</span> : null}
                    {textValue(item.path).startsWith('/') ? (
                      <a href={textValue(item.path)} className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-950">
                        打开处理页面
                        <ArrowUpRight size={12} />
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

export function OrderReadinessActionResult({ result }: { result: Record<string, unknown> }) {
  const data = asRecord(result.data);
  const action = asRecord(data.action);
  const order = asRecord(data.order);
  const nextPlan = asRecord(data.nextPlan);
  const executionRun = asRecord(data.executionRun);

  return (
    <>
      <div className="mt-3 flex items-start gap-3 border-b border-emerald-100 pb-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white">
          <Check size={15} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">{textValue(action.title, '处理步骤已执行')}</div>
          <div className="mt-1 text-xs leading-5 text-muted">
            订单 #{textValue(order.id)} · 当前状态 {textValue(order.status)}
          </div>
        </div>
      </div>
      <WorkflowExecutionRunSummary run={executionRun} warning={textValue(data.historyWarning, '')} />
      {Object.keys(nextPlan).length > 0 ? (
        <>
          <div className="mt-3 text-xs font-semibold text-slate-700">重新检查后的处理方案</div>
          <OrderReadinessPlanResult result={{ data: nextPlan }} />
        </>
      ) : null}
    </>
  );
}

export function FactoryWorkflowActionResult({
  result,
  onRequestAction,
  actionDisabled = false,
}: {
  result: Record<string, unknown>;
  onRequestAction?: (prompt: string) => void;
  actionDisabled?: boolean;
}) {
  const data = asRecord(result.data);
  const action = asRecord(data.action);
  const quotation = asRecord(data.quotation);
  const order = asRecord(data.order);
  const nextPlan = asRecord(data.nextPlan);
  const workflowPlan = asRecord(data.workflowPlan);
  const executionRun = asRecord(data.executionRun);

  return (
    <>
      <div className="mt-3 flex items-start gap-3 border-b border-emerald-100 pb-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white">
          <Check size={15} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">{textValue(action.title, '工作流步骤已执行')}</div>
          <div className="mt-1 text-xs leading-5 text-muted">
            报价 #{textValue(quotation.id)} 已转为订单 #{textValue(order.id)} · 当前状态 {textValue(order.status)}
          </div>
        </div>
      </div>
      <WorkflowExecutionRunSummary run={executionRun} warning={textValue(data.historyWarning, '')} />
      {Object.keys(nextPlan).length > 0 ? (
        <>
          <div className="mt-3 text-xs font-semibold text-slate-700">新订单生产准备</div>
          <OrderReadinessPlanResult result={{ data: nextPlan }} />
        </>
      ) : null}
      {Object.keys(workflowPlan).length > 0 ? (
        <>
          <div className="mt-3 text-xs font-semibold text-slate-700">原报价流程复查</div>
          <FactoryExecutionPlanResult
            result={{ data: workflowPlan }}
            onRequestAction={onRequestAction}
            actionDisabled={actionDisabled}
          />
        </>
      ) : null}
    </>
  );
}
