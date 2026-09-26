'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileSearch,
  Loader2,
  Pencil,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  confirmAiTool,
  reviseAiToolConfirmation,
  type AiAttachment,
  type AiKnowledgeSource,
  type AiProviderInfo,
  type AiTurnMetrics,
  type AiResultProvenance,
  type AiToolPlan,
  type AiToolResult,
} from '@/lib/ai';
import { BusinessResult } from '@/components/ai/AiBusinessResult';
import {
  arrayValue,
  asRecord,
  dateText,
  isSafeInternalPath,
  RawDetails,
  resultIcon,
  textValue,
  toolLabel,
} from '@/components/ai/AiResultPrimitives';

export type ChatItem = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: string;
  statusMessage?: string;
  toolPlan?: AiToolPlan;
  toolCalls?: Array<{ name: string; args: unknown }>;
  toolResults?: AiToolResult[];
  persistedMessageId?: number;
  historical?: boolean;
  attachments?: AiAttachment[];
  provider?: AiProviderInfo;
  metrics?: AiTurnMetrics;
  turnState?: import('@/lib/ai').AiTurnStateV3;
  retryable?: boolean;
  nativeTaskId?: string;
  /** NATIVE-W2：服务端签发的库存调整提案卡片状态（结构化，不扁平化为 Markdown）。 */
  writeProposal?: import('@/lib/ai-write-proposal.cjs').NativeWriteCard;
  startedAt?: number;
};

type ConfirmationResult = {
  requiresConfirmation?: boolean;
  confirmation?: {
    confirmationToken?: string;
    operationId?: string;
    expiresAt?: string;
    toolName: string;
    args?: unknown;
    title?: string;
    summary?: string;
    warning?: string;
    rows?: Array<{ label: string; value: string }>;
    editableFields?: ConfirmationEditableField[];
  };
};

type ConfirmationEditableField = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'json';
  required?: boolean;
  locked?: boolean;
  value?: unknown;
  options?: unknown[];
  description?: string;
};

function isConfirmationResult(value: unknown): value is ConfirmationResult {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as ConfirmationResult).requiresConfirmation &&
    (value as ConfirmationResult).confirmation?.toolName
  );
}

function fallbackEditableFields(args: unknown): ConfirmationEditableField[] {
  return Object.entries(asRecord(args)).map(([key, value]) => ({
    key,
    label: key,
    type: typeof value === 'boolean'
      ? 'boolean'
      : typeof value === 'number'
        ? 'number'
        : value && typeof value === 'object'
          ? 'json'
          : 'string',
    locked: /(?:^id$|Id$|Ids$|Version$|UpdatedAt$|Hash$|Token$|Key$)/.test(key),
    value,
  }));
}

function initialFieldDraft(field: ConfirmationEditableField) {
  if (field.type === 'boolean') return field.value === true;
  if (field.type === 'json') return field.value == null ? '' : JSON.stringify(field.value, null, 2);
  return field.value == null ? '' : String(field.value);
}

function collectAnswerEvidence(toolResults: AiToolResult[] = []) {
  const sourceById = new Map<number, AiKnowledgeSource>();
  const provenances: AiResultProvenance[] = [];
  for (const tool of toolResults) {
    const result = asRecord(tool.result);
    const provenance = asRecord(result.provenance);
    if (provenance.kind === 'live_business' || provenance.kind === 'knowledge_snapshot') {
      provenances.push({
        kind: provenance.kind,
        label: textValue(provenance.label, provenance.kind === 'live_business' ? '实时业务数据' : '知识库快照'),
        fetchedAt: provenance.fetchedAt ? String(provenance.fetchedAt) : undefined,
        checkedAt: provenance.checkedAt ? String(provenance.checkedAt) : null,
        hasPendingSources: Boolean(provenance.hasPendingSources),
      });
    }
    for (const source of arrayValue(result.sources)) {
      const knowledgeEntryId = Number(source.knowledgeEntryId);
      if (!Number.isInteger(knowledgeEntryId) || knowledgeEntryId <= 0) continue;
      sourceById.set(knowledgeEntryId, {
        kind: 'knowledge_snapshot',
        knowledgeEntryId,
        entryType: textValue(source.entryType, ''),
        title: textValue(source.title, `知识条目 #${knowledgeEntryId}`),
        sourceTable: textValue(source.sourceTable, ''),
        sourceId: textValue(source.sourceId, ''),
        syncedAt: source.syncedAt ? String(source.syncedAt) : null,
        sourceUpdatedAt: source.sourceUpdatedAt ? String(source.sourceUpdatedAt) : null,
        freshness: ['fresh', 'pending_insert', 'pending_update', 'pending_delete'].includes(String(source.freshness))
          ? source.freshness as AiKnowledgeSource['freshness']
          : 'fresh',
        knowledgePath: isSafeInternalPath(source.knowledgePath)
          ? source.knowledgePath
          : `/dashboard?view=knowledge&entry=${knowledgeEntryId}`,
        sourcePath: isSafeInternalPath(source.sourcePath) ? source.sourcePath : '',
      });
    }
  }
  return {
    sources: [...sourceById.values()],
    hasLiveBusiness: provenances.some(item => item.kind === 'live_business'),
    hasKnowledgeSnapshot: provenances.some(item => item.kind === 'knowledge_snapshot'),
  };
}

function AnswerEvidence({ toolResults }: { toolResults: AiToolResult[] }) {
  const evidence = collectAnswerEvidence(toolResults);
  if (!evidence.hasLiveBusiness && !evidence.hasKnowledgeSnapshot && evidence.sources.length === 0) return null;
  const staleSources = evidence.sources.filter(source => source.freshness !== 'fresh');
  const freshnessLabel: Record<AiKnowledgeSource['freshness'], string> = {
    fresh: '最新',
    pending_insert: '待新增',
    pending_update: '待更新',
    pending_delete: '待移除',
  };

  return (
    <section className="mt-3 border-t border-slate-200 pt-3" aria-label="回答依据">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold text-ink">回答依据</div>
        {evidence.hasLiveBusiness ? <StatusBadge tone="green" className="h-5 min-w-0 px-2">实时业务数据</StatusBadge> : null}
        {evidence.hasKnowledgeSnapshot ? <StatusBadge tone="blue" className="h-5 min-w-0 px-2">知识库快照</StatusBadge> : null}
      </div>
      {staleSources.length ? (
        <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{staleSources.length} 条依据处于待同步状态，易变数据请以本轮实时业务查询为准。</span>
        </div>
      ) : null}
      {evidence.sources.length ? (
        <div className="mt-2 divide-y divide-slate-100 border-y border-slate-100">
          {evidence.sources.slice(0, 8).map(source => (
            <div key={source.knowledgeEntryId} className="flex min-w-0 items-center gap-3 py-2">
              <a href={source.knowledgePath} className="min-w-0 flex-1 text-left hover:text-sky-700">
                <span className="block truncate text-sm font-medium">{source.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {source.sourceTable && source.sourceId ? `${source.sourceTable} #${source.sourceId} · ` : ''}
                  同步于 {dateText(source.syncedAt)}
                </span>
              </a>
              <StatusBadge tone={source.freshness === 'fresh' ? 'green' : 'amber'} className="h-5 min-w-0 px-2">
                {freshnessLabel[source.freshness]}
              </StatusBadge>
              {source.sourcePath ? (
                <a
                  href={source.sourcePath}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-slate-100 hover:text-ink"
                  aria-label={`查看${source.title}原数据`}
                  title="查看原数据"
                >
                  <ArrowUpRight size={15} />
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ToolPlanPanel({ plan }: { plan: AiToolPlan }) {
  if (!plan.steps || plan.steps.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-ink">执行计划</div>
        <div className="text-xs text-muted">{plan.summary}</div>
      </div>
      <div className="mt-2 grid gap-2">
        {plan.steps.map((step) => (
          <div key={`${step.index}-${step.name}`} className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-slate-100 px-1.5 text-xs font-semibold text-slate-600">{step.index}</span>
                <span className="font-medium text-ink">{step.label || toolLabel(step.name)}</span>
                <StatusBadge tone={step.mode === 'write' ? 'amber' : 'blue'}>
                  {step.mode === 'write' ? '需确认' : '只读'}
                </StatusBadge>
                {step.validationStatus ? (
                  <StatusBadge tone={step.validationStatus === 'rejected' ? 'red' : 'green'}>
                    {step.validationStatus === 'rejected' ? '参数已拒绝' : '参数已校验'}
                  </StatusBadge>
                ) : null}
                <span className="text-xs text-muted">
                  {step.source === 'rule' ? '规则生成' : step.source === 'model' ? '模型候选' : ''}
                </span>
              </div>
              {step.argsSummary && step.argsSummary.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted">
                  {step.argsSummary.map((arg) => (
                    <span key={`${step.name}-${arg.key}`} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5">
                      {arg.key}: {arg.value}
                    </span>
                  ))}
                </div>
              ) : null}
              {step.validationError ? (
                <div className="mt-1 text-xs text-rose-700">{step.validationError}</div>
              ) : null}
            </div>
            {step.requiresConfirmation ? (
              <div className="text-xs text-amber-700">确认前不会写入</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolResultCard({
  item,
  onConfirmed,
  onSendPrompt,
  shortcutDisabled = false,
  readOnly = false,
}: {
  item: AiToolResult;
  onConfirmed: (next: AiToolResult) => void;
  onSendPrompt?: (prompt: string) => void;
  shortcutDisabled?: boolean;
  readOnly?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revising, setRevising] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState('');
  const result = item.result;
  const confirmation = isConfirmationResult(result) ? result.confirmation : undefined;
  const editableFields = useMemo(() => (
    confirmation
      ? confirmation.editableFields?.length
        ? confirmation.editableFields
        : fallbackEditableFields(confirmation.args)
      : []
  ), [confirmation]);

  useEffect(() => {
    if (!confirmation?.confirmationToken) return;
    setDraft(Object.fromEntries(editableFields.map((field) => [field.key, initialFieldDraft(field)])));
    setEditing(false);
    setError('');
  }, [confirmation?.confirmationToken, editableFields]);

  if (isConfirmationResult(result)) {
    async function handleConfirm() {
      if (!confirmation?.confirmationToken) {
        setError('这张确认卡片已过期，请重新发起操作。');
        return;
      }
      try {
        setConfirming(true);
        setError('');
        const next = await confirmAiTool(confirmation.confirmationToken);
        onConfirmed(next);
      } catch (err) {
        setError((err as Error).message || '确认执行失败');
      } finally {
        setConfirming(false);
      }
    }

    async function handleRevise() {
      if (!confirmation?.confirmationToken) {
        setError('这张确认卡片已过期，请重新发起操作。');
        return;
      }
      try {
        setRevising(true);
        setError('');
        const args = { ...asRecord(confirmation.args) };
        for (const field of editableFields) {
          if (field.locked) continue;
          const value = draft[field.key];
          if (field.type === 'boolean') {
            args[field.key] = value === true;
            continue;
          }
          const text = String(value ?? '').trim();
          if (!text) {
            if (field.required) throw new Error(`${field.label}为必填项`);
            delete args[field.key];
            continue;
          }
          if (field.type === 'number' || field.type === 'integer') {
            const numberValue = Number(text);
            if (!Number.isFinite(numberValue)) throw new Error(`${field.label}必须是有效数字`);
            if (field.type === 'integer' && !Number.isInteger(numberValue)) {
              throw new Error(`${field.label}必须是整数`);
            }
            args[field.key] = numberValue;
            continue;
          }
          if (field.type === 'json') {
            try {
              args[field.key] = JSON.parse(text);
            } catch {
              throw new Error(`${field.label}必须是有效 JSON`);
            }
            continue;
          }
          args[field.key] = text;
        }
        const next = await reviseAiToolConfirmation(
          confirmation.confirmationToken,
          confirmation.toolName,
          args,
        );
        onConfirmed(next);
      } catch (err) {
        setError((err as Error).message || '更新确认预览失败');
      } finally {
        setRevising(false);
      }
    }

    return (
      <div className="rounded-panel border border-amber-200 bg-amber-50 p-3 shadow-panel">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-200 bg-white text-amber-700">
            <ShieldAlert size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-950">{confirmation?.title || '待确认操作'}</div>
            {confirmation?.summary ? <div className="mt-1 text-sm text-amber-900">{confirmation.summary}</div> : null}
            {!editing && Array.isArray(confirmation?.rows) && confirmation.rows.length > 0 ? (
              <div className="mt-2 grid gap-1 text-xs text-amber-950 sm:grid-cols-2">
                {confirmation.rows.map((row, index) => (
                  <div key={`${row.label}-${index}`} className="flex min-w-0 justify-between gap-3 rounded-md border border-amber-200/80 bg-white/70 px-2 py-1">
                    <span className="text-amber-700">{row.label}</span>
                    <span className="truncate font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {editing ? (
              <div className="mt-3 grid gap-3 rounded-md border border-amber-200 bg-white p-3 sm:grid-cols-2">
                {editableFields.map((field) => (
                  <Field
                    key={field.key}
                    label={<span>{field.label}{field.locked ? <span className="ml-1 font-normal text-amber-700">· 系统绑定</span> : null}</span>}
                    required={field.required}
                    hint={field.description || undefined}
                    className={field.type === 'json' ? 'sm:col-span-2' : ''}
                  >
                    {field.type === 'boolean' ? (
                      <span className="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm text-ink">
                        <Checkbox
                          checked={draft[field.key] === true}
                          disabled={field.locked || revising}
                          onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.checked }))}
                        />
                        {draft[field.key] === true ? '是' : '否'}
                      </span>
                    ) : field.type === 'json' ? (
                      <Textarea
                        rows={5}
                        value={String(draft[field.key] ?? '')}
                        disabled={field.locked || revising}
                        onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                        className="font-mono text-xs focus:border-amber-400 focus:ring-amber-100"
                      />
                    ) : Array.isArray(field.options) && field.options.length > 0 ? (
                      <Select
                        compact
                        value={String(draft[field.key] ?? '')}
                        disabled={field.locked || revising}
                        onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                        className="focus:border-amber-400 focus:ring-amber-100"
                      >
                        {!field.required ? <option value="">不设置</option> : null}
                        {field.options.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
                      </Select>
                    ) : (
                      <Input
                        compact
                        type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
                        step={field.type === 'integer' ? 1 : field.type === 'number' ? 'any' : undefined}
                        value={String(draft[field.key] ?? '')}
                        disabled={field.locked || revising}
                        onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                        className="focus:border-amber-400 focus:ring-amber-100"
                      />
                    )}
                  </Field>
                ))}
              </div>
            ) : null}
            {confirmation?.warning ? <div className="mt-2 text-xs text-amber-800">{confirmation.warning}</div> : null}
            {error ? <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</div> : null}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {readOnly ? (
                <span className="text-xs text-amber-700">历史记录，仅供查看</span>
              ) : editing ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={revising}>
                    取消
                  </Button>
                  <Button size="sm" variant="primary" onClick={handleRevise} disabled={revising} icon={revising ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}>
                    更新预览
                  </Button>
                </>
              ) : (
                <>
                  {editableFields.some((field) => !field.locked) ? (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(true)} disabled={confirming} icon={<Pencil size={14} />}>
                      编辑参数
                    </Button>
                  ) : null}
                  <Button size="sm" variant="primary" onClick={handleConfirm} disabled={confirming} icon={confirming ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}>
                    确认执行
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const Icon = resultIcon(item.name);
  const record = asRecord(result);
  const failed = record.success === false;
  const display = asRecord(record.display);
  const title = textValue(display.title, toolLabel(item.name));
  const summary = textValue(record.summary || record.message || record.error, failed ? '执行失败' : '工具调用完成');
  return (
    <details className="group rounded-md border border-slate-200 bg-slate-50 text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-slate-600">
            <Icon size={14} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{title}</span>
            <span className="block truncate text-xs text-muted">{summary}</span>
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <StatusBadge tone={failed ? 'red' : 'green'}>{failed ? '失败' : '完成'}</StatusBadge>
          <ChevronDown size={14} className="text-slate-400 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-slate-200 bg-white p-3">
        <BusinessResult
          item={item}
          onSendPrompt={readOnly ? undefined : onSendPrompt}
          shortcutDisabled={shortcutDisabled}
        />
        <RawDetails result={result} />
      </div>
    </details>
  );
}

export function AnswerProcess({
  item,
  onConfirmed,
  onSendPrompt,
  shortcutDisabled = false,
}: {
  item: ChatItem;
  onConfirmed: (index: number, next: AiToolResult) => void;
  onSendPrompt: (prompt: string) => void;
  shortcutDisabled?: boolean;
}) {
  const toolResults = item.toolResults || [];
  const evidence = collectAnswerEvidence(toolResults);
  const hasEvidence = evidence.hasLiveBusiness || evidence.hasKnowledgeSnapshot || evidence.sources.length > 0;
  const hasProcess = Boolean(item.toolPlan || item.toolCalls?.length || toolResults.length);
  const requiresAttention = toolResults.some(tool => {
    if (isConfirmationResult(tool.result)) return true;
    return asRecord(tool.result).success === false;
  });
  const [open, setOpen] = useState(requiresAttention);
  useEffect(() => {
    if (requiresAttention) setOpen(true);
  }, [requiresAttention]);
  if (!hasEvidence && !hasProcess) return null;

  const processCount = Math.max(
    item.toolPlan?.steps?.length || 0,
    item.toolCalls?.length || 0,
    toolResults.length,
  );
  const completed = item.historical || item.status === 'done';

  return (
    <details
      className="group rounded-md border border-slate-200 bg-slate-50/70"
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm">
        <span className="inline-flex min-w-0 items-center gap-2">
          <FileSearch size={15} className="shrink-0 text-slate-500" />
          <span className="font-medium text-ink">{completed ? '已处理' : '处理中'}</span>
          <span className="text-xs text-muted">· 查看处理过程</span>
          {evidence.sources.length ? <span className="text-xs text-muted">{evidence.sources.length} 条依据</span> : null}
          {processCount ? <span className="text-xs text-muted">{processCount} 个步骤</span> : null}
        </span>
        <span className="inline-flex shrink-0 items-center gap-2">
          {requiresAttention ? <StatusBadge tone="amber">需要处理</StatusBadge> : null}
          <ChevronDown size={15} className="text-slate-400 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-slate-200 bg-white px-3 pb-3">
        {hasEvidence ? <AnswerEvidence toolResults={toolResults} /> : null}
        {item.toolPlan ? <ToolPlanPanel plan={item.toolPlan} /> : null}
        {item.toolCalls && item.toolCalls.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.toolCalls.map((call, index) => (
              <span key={`${call.name}-${index}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                <Wrench size={12} />
                {toolLabel(call.name)}
              </span>
            ))}
          </div>
        ) : null}
        {toolResults.length > 0 ? (
          <div className="mt-3 space-y-2">
            {toolResults.map((tool, index) => (
              <ToolResultCard
                key={`${tool.name}-${index}`}
                item={tool}
                readOnly={item.historical}
                onConfirmed={(next) => onConfirmed(index, next)}
                onSendPrompt={onSendPrompt}
                shortcutDisabled={shortcutDisabled}
              />
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
