'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ClipboardClock,
  FileCheck2,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { FactoryFileAttachments } from '@/components/factory-file-attachments';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { generateAiDraftFromAttachment, type AiAttachment } from '@/lib/ai';
import type { FactoryFileLink } from '@/lib/files';
import {
  confirmOrderExecutionRecord,
  createOrderExecutionDraft,
  deleteOrderExecutionDraft,
  getOrderExecutionRecords,
  revokeOrderExecutionConfirmation,
  updateOrderExecutionDraft,
  type OrderExecutionArchive,
  type OrderExecutionDraftInput,
  type OrderExecutionPhase,
  type OrderExecutionRecord,
  type OrderExecutionRecordType,
} from '@/lib/order-execution-records';

type OrderExecutionRecordsPanelProps = {
  orderId: number;
  contractNo?: string;
  customerName?: string;
};

type ExecutionConfirmTarget =
  | { kind: 'confirm' }
  | { kind: 'revoke' }
  | { kind: 'delete' }
  | { kind: 'summarize'; link: FactoryFileLink };

const phaseOptions: Array<{ value: OrderExecutionPhase; label: string }> = [
  { value: 'pre_production', label: '生产前' },
  { value: 'in_production', label: '生产中' },
  { value: 'post_production', label: '生产后' },
];

const typeOptions: Record<OrderExecutionPhase, Array<{ value: OrderExecutionRecordType; label: string }>> = {
  pre_production: [
    { value: 'resource_preparation', label: '资源准备' },
    { value: 'material_preparation', label: '物料准备' },
    { value: 'supplier_confirmation', label: '供应商确认' },
    { value: 'other', label: '其他事实' },
  ],
  in_production: [
    { value: 'capacity_adjustment', label: '产能调整' },
    { value: 'supplier_adjustment', label: '供应商调整' },
    { value: 'process_exception', label: '过程异常' },
    { value: 'quality_check', label: '过程质量检查' },
    { value: 'other', label: '其他事实' },
  ],
  post_production: [
    { value: 'quality_result', label: '质量结果' },
    { value: 'delivery_result', label: '交付结果' },
    { value: 'customer_feedback', label: '客户反馈' },
    { value: 'other', label: '其他事实' },
  ],
};

function localDateTime(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function dateLabel(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function emptyDraft(): OrderExecutionDraftInput {
  return {
    phase: 'pre_production',
    recordType: 'resource_preparation',
    title: '',
    summaryText: '',
    occurredAt: localDateTime(),
    sourceFileIds: [],
  };
}

function draftFromRecord(record: OrderExecutionRecord): OrderExecutionDraftInput {
  return {
    phase: record.phase,
    recordType: record.recordType,
    title: record.title,
    summaryText: record.draftText,
    occurredAt: localDateTime(record.occurredAt),
    sourceFileIds: record.sourceFileIds,
  };
}

export function OrderExecutionRecordsPanel({
  orderId,
  contractNo = '',
  customerName = '',
}: OrderExecutionRecordsPanelProps) {
  const [archive, setArchive] = useState<OrderExecutionArchive | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<OrderExecutionDraftInput>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'summarize' | 'save' | 'confirm' | 'revoke' | 'delete' | ''>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<ExecutionConfirmTarget | null>(null);

  const load = useCallback(async (selectId: number | null, preserveDraft = false) => {
    if (!orderId) return;
    setLoading(true);
    setError('');
    try {
      const next = await getOrderExecutionRecords(orderId);
      setArchive(next);
      if (preserveDraft) {
        const availableIds = new Set(next.availableFiles.map(file => file.id));
        setDraft(current => ({
          ...current,
          sourceFileIds: current.sourceFileIds.filter(id => availableIds.has(id)),
        }));
        return;
      }
      const targetId = selectId;
      if (targetId) {
        const record = next.records.find(item => item.id === targetId);
        if (record) {
          setEditingId(record.id);
          setDraft(draftFromRecord(record));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取订单执行档案失败');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    setEditingId(null);
    setDraft(emptyDraft());
    void load(null);
  }, [load]);

  const editingRecord = useMemo(
    () => archive?.records.find(item => item.id === editingId) || null,
    [archive, editingId]
  );
  const selectedFiles = useMemo(() => new Set(draft.sourceFileIds), [draft.sourceFileIds]);
  const hasText = Boolean(draft.summaryText.trim());

  function startNew() {
    setEditingId(null);
    setDraft(emptyDraft());
    setMessage('');
    setError('');
  }

  function editRecord(record: OrderExecutionRecord) {
    setEditingId(record.id);
    setDraft(draftFromRecord(record));
    setMessage('');
    setError('');
  }

  function selectPhase(phase: OrderExecutionPhase) {
    setDraft(current => ({
      ...current,
      phase,
      recordType: typeOptions[phase][0].value,
    }));
    setMessage('');
  }

  function toggleSourceFile(fileId: number) {
    setDraft(current => ({
      ...current,
      sourceFileIds: current.sourceFileIds.includes(fileId)
        ? current.sourceFileIds.filter(id => id !== fileId)
        : [...current.sourceFileIds, fileId],
    }));
    setMessage('');
  }

  function apiInput(): OrderExecutionDraftInput {
    return {
      ...draft,
      occurredAt: draft.occurredAt ? new Date(draft.occurredAt).toISOString() : '',
    };
  }

  async function saveDraft() {
    if (!hasText || busy) return;
    setBusy('save');
    setMessage('');
    setError('');
    try {
      const saved = editingId
        ? await updateOrderExecutionDraft(orderId, editingId, apiInput())
        : await createOrderExecutionDraft(orderId, apiInput());
      await load(saved.id);
      setMessage('执行事实草稿已保存，尚未进入知识库。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存执行档案草稿失败');
    } finally {
      setBusy('');
    }
  }

  async function confirmKnowledge() {
    if (!editingId || !hasText || busy) return;
    setBusy('confirm');
    setMessage('');
    setError('');
    try {
      await confirmOrderExecutionRecord(orderId, editingId, apiInput());
      await load(editingId);
      setMessage('执行事实已人工确认，知识库将自动刷新。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认执行事实失败');
    } finally {
      setBusy('');
    }
  }

  async function revokeKnowledge() {
    if (!editingId || !editingRecord?.hasConfirmedVersion || busy) return;
    setBusy('revoke');
    setMessage('');
    setError('');
    try {
      await revokeOrderExecutionConfirmation(orderId, editingId);
      await load(editingId);
      setMessage('已撤销知识确认，当前草稿仍保留。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销确认失败');
    } finally {
      setBusy('');
    }
  }

  async function deleteDraft() {
    if (!editingId || editingRecord?.hasConfirmedVersion || busy) return;
    setBusy('delete');
    setMessage('');
    setError('');
    try {
      await deleteOrderExecutionDraft(orderId, editingId);
      startNew();
      await load(null);
      setMessage('草稿已删除。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除草稿失败');
    } finally {
      setBusy('');
    }
  }

  async function summarizeExecution(link: FactoryFileLink, overwrite = false) {
    if (busy) return;
    if (
      !overwrite
      &&
      draft.summaryText.trim()
      && draft.summaryText !== (editingRecord?.draftText || '')
    ) {
      setConfirmTarget({ kind: 'summarize', link });
      return;
    }
    setBusy('summarize');
    setMessage('');
    setError('');
    try {
      const attachment: AiAttachment = {
        id: link.fileId,
        originalName: link.file?.originalName || link.title || `文件 #${link.fileId}`,
        detectedType: link.file?.detectedType || 'text',
        mimeType: link.file?.mimeType || 'application/octet-stream',
        fileSize: link.file?.fileSize || 0,
        downloadPath: `/api/files/${link.fileId}/download`,
      };
      const result = await generateAiDraftFromAttachment(
        `请只根据这个附件整理订单 ${contractNo || orderId}（${customerName || '未知客户'}）的一条执行事实说明。只写附件能够证明的实际准备、人工决定、过程调整、异常、质量结果或交付结果；建议、预测、待办和不确定推断不能写成已发生事实。直接输出适合填入“已发生事实”编辑框的正文，不要寒暄、分类建议、操作步骤或要求我复制粘贴，不要调用保存工具。`,
        attachment,
        {
          resourceType: 'order',
          resourceId: orderId,
          path: '/orders',
          view: 'execution',
          label: `订单 #${orderId} · 执行档案`,
        }
      );
      setDraft(current => ({
        ...current,
        summaryText: result,
        sourceFileIds: [link.fileId],
      }));
      setMessage('AI 归纳已填入事实说明，请核对阶段、类型和内容后保存草稿。');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800">
        这里记录实际发生的准备、调整、异常、质量和交付结果。计划与建议留在“生产准备”，只有人工确认的事实才进入知识库。
      </div>

      <FactoryFileAttachments
        targetType="order"
        targetId={orderId}
        relationRole="execution_evidence"
        title="执行依据文件"
        description="上传现场图片、质量记录、交付凭证或供应商资料；同一订单的附件会统一保留。"
        onAiSummarize={summarizeExecution}
        onChanged={() => void load(null, true)}
      />

      <section className="border-y border-line bg-white">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ClipboardClock size={16} />
              执行事实时间线
            </div>
            <div className="mt-1 text-xs text-muted">
              已记录 {archive?.records.length || 0} 条，已确认 {archive?.records.filter(item => item.hasConfirmedVersion).length || 0} 条
            </div>
          </div>
          <Button type="button" size="sm" variant="secondary" icon={<Plus size={14} />} onClick={startNew}>
            新建记录
          </Button>
        </div>

        <div className="grid min-w-0 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="border-b border-line lg:border-b-0 lg:border-r">
            {loading && !archive ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted">
                <Loader2 size={15} className="animate-spin" />
                读取执行档案
              </div>
            ) : archive?.records.length ? (
              <div className="max-h-[560px] overflow-y-auto">
                {archive.records.map(record => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => editRecord(record)}
                    className={`block w-full border-b border-line px-4 py-3 text-left transition-colors ${editingId === record.id ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-sky-700">{record.phaseLabel} · {record.recordTypeLabel}</span>
                      <span className={`text-xs ${record.knowledgeStatus === 'confirmed' ? 'text-emerald-700' : record.knowledgeStatus === 'confirmed_with_draft' ? 'text-amber-700' : 'text-muted'}`}>
                        {record.knowledgeStatus === 'confirmed'
                          ? '已确认'
                          : record.knowledgeStatus === 'confirmed_with_draft'
                            ? '有新草稿'
                            : '草稿'}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-ink">{record.title}</div>
                    <div className="mt-1 text-xs text-muted">{dateLabel(record.occurredAt)}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 text-sm leading-6 text-muted">
                暂无执行记录。生产前可以先记录物料、人员和供应商准备结果。
              </div>
            )}
          </aside>

          <div className="min-w-0 space-y-4 p-4">
            {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
            {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <SegmentedControl
                value={draft.phase}
                options={phaseOptions}
                onChange={selectPhase}
                ariaLabel="执行阶段"
                className="w-max"
              />
              <div className="text-xs text-muted">
                {editingRecord?.knowledgeStatus === 'confirmed'
                  ? `已于 ${dateLabel(editingRecord.confirmedAt)} 确认进入知识库`
                  : editingRecord?.knowledgeStatus === 'confirmed_with_draft'
                    ? '草稿已修改，知识库暂时保留上一次确认内容'
                    : '当前内容尚未进入知识库'}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-ink">
                事实类型
                <select
                  value={draft.recordType}
                  onChange={event => setDraft(current => ({
                    ...current,
                    recordType: event.target.value as OrderExecutionRecordType,
                  }))}
                  className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-sky-400"
                >
                  {typeOptions[draft.phase].map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-ink">
                发生时间
                <input
                  type="datetime-local"
                  value={draft.occurredAt}
                  onChange={event => setDraft(current => ({ ...current, occurredAt: event.target.value }))}
                  className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-sky-400"
                />
              </label>
            </div>

            <label className="block text-xs font-medium text-ink">
              标题
              <input
                type="text"
                value={draft.title}
                maxLength={120}
                placeholder="例如：首批泵壳到厂检查完成"
                onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}
                className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-sky-400"
              />
            </label>

            <label className="block text-xs font-medium text-ink">
              已发生事实
              <textarea
                value={draft.summaryText}
                rows={9}
                placeholder="记录实际发生了什么、作出了什么人工决定、结果如何。建议和待办不要写成已经完成。"
                onChange={event => {
                  setDraft(current => ({ ...current, summaryText: event.target.value }));
                  setMessage('');
                }}
                className="mt-1.5 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink outline-none placeholder:text-muted focus:border-sky-400"
              />
            </label>

            <div>
              <div className="mb-2 text-xs font-medium text-ink">事实依据</div>
              {archive?.availableFiles.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {archive.availableFiles.map(file => {
                    const selected = selectedFiles.has(file.id);
                    return (
                      <button
                        key={file.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleSourceFile(file.id)}
                        className="flex min-w-0 items-center gap-2 border-b border-line px-1 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white'}`}>
                          {selected ? <Check size={12} /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink">{file.originalName}</span>
                        <FileCheck2 size={14} className="shrink-0 text-muted" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted">暂无订单附件，也可以先手工记录事实。</div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!hasText || Boolean(busy) || loading}
                icon={busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                onClick={() => void saveDraft()}
              >
                保存草稿
              </Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={!editingId || !hasText || Boolean(busy) || loading}
                icon={busy === 'confirm' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                onClick={() => setConfirmTarget({ kind: 'confirm' })}
              >
                确认进入知识库
              </Button>
              {editingRecord?.hasConfirmedVersion ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  icon={busy === 'revoke' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  onClick={() => setConfirmTarget({ kind: 'revoke' })}
                >
                  撤销确认
                </Button>
              ) : editingId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  icon={busy === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  onClick={() => setConfirmTarget({ kind: 'delete' })}
                >
                  删除草稿
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={confirmTarget?.kind === 'confirm'
          ? '确认执行事实进入知识库？'
          : confirmTarget?.kind === 'revoke'
            ? '撤销执行事实的知识确认？'
            : confirmTarget?.kind === 'delete'
              ? '删除执行档案草稿？'
              : '覆盖未保存的事实说明？'}
        description={confirmTarget?.kind === 'confirm'
          ? `“${draft.title || '未命名执行事实'}”将被标记为已经发生的正式事实并供 AI 检索。请确认时间、类型、内容和附件依据准确。`
          : confirmTarget?.kind === 'revoke'
            ? '已确认版本将停止作为正式知识供 AI 检索；当前草稿和附件会继续保留。'
            : confirmTarget?.kind === 'delete'
              ? `尚未确认的草稿“${editingRecord?.title || draft.title || '未命名执行事实'}”将从当前执行档案列表中移除，历史审计记录仍会保留。`
              : '继续 AI 归纳会用所选附件生成的新内容覆盖事实说明中尚未保存的修改，覆盖后无法自动恢复。'}
        confirmLabel={confirmTarget?.kind === 'confirm'
          ? '确认进入知识库'
          : confirmTarget?.kind === 'revoke'
            ? '撤销确认'
            : confirmTarget?.kind === 'delete'
              ? '删除草稿'
              : '继续并覆盖'}
        confirmVariant={confirmTarget?.kind === 'confirm' ? 'primary' : 'danger'}
        busy={Boolean(busy)}
        layer="top"
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => {
          const target = confirmTarget;
          setConfirmTarget(null);
          if (target?.kind === 'confirm') void confirmKnowledge();
          else if (target?.kind === 'revoke') void revokeKnowledge();
          else if (target?.kind === 'delete') void deleteDraft();
          else if (target?.kind === 'summarize') void summarizeExecution(target.link, true);
        }}
      />
    </div>
  );
}
