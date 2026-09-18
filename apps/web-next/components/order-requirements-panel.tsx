'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookCheck, Check, Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { FactoryFileAttachments } from '@/components/factory-file-attachments';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { generateAiDraftFromAttachment, type AiAttachment } from '@/lib/ai';
import type { FactoryFileLink } from '@/lib/files';
import {
  confirmOrderRequirementSummary,
  getOrderRequirementSummary,
  revokeOrderRequirementConfirmation,
  saveOrderRequirementDraft,
  type OrderRequirementSummary,
} from '@/lib/order-requirements';

type OrderRequirementsPanelProps = {
  orderId: number;
  contractNo?: string;
  customerName?: string;
};

type RequirementConfirmTarget =
  | { kind: 'confirm' }
  | { kind: 'revoke' }
  | { kind: 'summarize'; link: FactoryFileLink };

function dateLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function OrderRequirementsPanel({
  orderId,
  contractNo = '',
  customerName = '',
}: OrderRequirementsPanelProps) {
  const [record, setRecord] = useState<OrderRequirementSummary | null>(null);
  const [summaryText, setSummaryText] = useState('');
  const [sourceFileIds, setSourceFileIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'summarize' | 'save' | 'confirm' | 'revoke' | ''>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<RequirementConfirmTarget | null>(null);

  const load = useCallback(async ({ preserveDraft = false } = {}) => {
    if (!orderId) return;
    setLoading(true);
    setError('');
    try {
      const next = await getOrderRequirementSummary(orderId);
      setRecord(next);
      if (!preserveDraft) {
        setSummaryText(next.draftText);
        setSourceFileIds(next.sourceFileIds);
      } else {
        const availableIds = new Set(next.availableFiles.map(file => file.id));
        setSourceFileIds(current => current.filter(id => availableIds.has(id)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取客户要求失败');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedFiles = useMemo(
    () => new Set(sourceFileIds),
    [sourceFileIds]
  );
  const hasText = Boolean(summaryText.trim());

  function toggleSourceFile(fileId: number) {
    setSourceFileIds(current => (
      current.includes(fileId)
        ? current.filter(id => id !== fileId)
        : [...current, fileId]
    ));
    setMessage('');
  }

  async function saveDraft() {
    if (!hasText || busy) return;
    setBusy('save');
    setMessage('');
    setError('');
    try {
      const next = await saveOrderRequirementDraft(orderId, { summaryText, sourceFileIds });
      setRecord(next);
      setSummaryText(next.draftText);
      setSourceFileIds(next.sourceFileIds);
      setMessage('草稿已保存，尚未进入知识库。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存草稿失败');
    } finally {
      setBusy('');
    }
  }

  async function confirmKnowledge() {
    if (!hasText || busy) return;
    setBusy('confirm');
    setMessage('');
    setError('');
    try {
      const next = await confirmOrderRequirementSummary(orderId, { summaryText, sourceFileIds });
      setRecord(next);
      setSummaryText(next.draftText);
      setSourceFileIds(next.sourceFileIds);
      setMessage('已人工确认，知识库将自动刷新。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认客户要求失败');
    } finally {
      setBusy('');
    }
  }

  async function revokeKnowledge() {
    if (busy || !record?.hasConfirmedVersion) return;
    setBusy('revoke');
    setMessage('');
    setError('');
    try {
      const next = await revokeOrderRequirementConfirmation(orderId);
      setRecord(next);
      setMessage('已撤销知识库确认，原文件和草稿仍保留。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销确认失败');
    } finally {
      setBusy('');
    }
  }

  async function summarizeRequirement(link: FactoryFileLink, overwrite = false) {
    if (busy) return;
    if (
      !overwrite
      &&
      summaryText.trim()
      && summaryText !== (record?.draftText || '')
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
        `请只根据这个附件原文，整理订单 ${contractNo || orderId}（${customerName || '未知客户'}）的客户要求草稿。按“产品与数量、客户型号或线圈片数、扬程流量、电气参数、材料与结构、包装与标识、交期、质量验收、待确认问题、生产前资源准备”分节；没有写明的内容标为“未提供”，冲突内容单列，禁止把工厂推断或建议写成客户明确要求。直接输出适合填入客户要求编辑框的正文，不要寒暄、解释操作步骤或要求我复制粘贴，不要调用保存工具。`,
        attachment,
        {
          resourceType: 'order',
          resourceId: orderId,
          path: '/orders',
          view: 'requirements',
          label: `订单 #${orderId} · 客户要求`,
        }
      );
      setSummaryText(result);
      setSourceFileIds([link.fileId]);
      setMessage('AI 归纳已填入编辑框，请核对后保存草稿。');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800">
        客户原始文件永久保留。AI 可以归纳草稿，但只有你在这里确认后，内容才会成为正式知识；不会自动修改订单、配方、采购或库存。
      </div>

      <FactoryFileAttachments
        targetType="order"
        targetId={orderId}
        relationRole="customer_requirement"
        title="客户要求文件"
        description="上传生产要求、包装要求、客户图片、Excel 或 PDF。上传后可直接交给 AI 归纳。"
        onAiSummarize={summarizeRequirement}
        onChanged={() => void load({ preserveDraft: true })}
      />

      <section className="overflow-hidden rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <BookCheck size={16} />
              客户要求归纳
            </div>
            <div className="mt-1 text-xs leading-5 text-muted">
              {record?.knowledgeStatus === 'confirmed'
                ? `已于 ${dateLabel(record.confirmedAt)} 确认进入知识库`
                : record?.knowledgeStatus === 'confirmed_with_draft'
                  ? '草稿已有修改，知识库暂时保留上一次确认内容'
                  : '当前内容尚未进入知识库'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
              disabled={!hasText || Boolean(busy) || loading}
              icon={busy === 'confirm' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              onClick={() => setConfirmTarget({ kind: 'confirm' })}
            >
              确认进入知识库
            </Button>
            {record?.hasConfirmedVersion ? (
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
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" />
            读取归纳内容
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
            {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

            <textarea
              value={summaryText}
              onChange={event => {
                setSummaryText(event.target.value);
                setMessage('');
              }}
              rows={14}
              placeholder="点击附件旁的“AI 归纳”可直接生成到这里，也可以手工整理客户明确要求、未提供项、冲突项和生产前准备事项。"
              className="w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink outline-none transition-colors placeholder:text-muted focus:border-sky-400"
            />

            <div>
              <div className="mb-2 text-xs font-medium text-ink">本次归纳依据</div>
              {record?.availableFiles.length ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {record.availableFiles.map(file => {
                    const selected = selectedFiles.has(file.id);
                    return (
                      <button
                        key={file.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleSourceFile(file.id)}
                        className="flex min-w-0 items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50"
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white'}`}>
                          {selected ? <Check size={12} /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink">{file.originalName}</span>
                        <span className="shrink-0 text-xs text-muted">{file.parserStatus === 'parsed' ? '已解析' : '待核对'}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted">暂无订单附件，也可以先手工录入客户要求。</div>
              )}
            </div>
          </div>
        )}
      </section>
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={confirmTarget?.kind === 'confirm'
          ? '确认客户要求进入知识库？'
          : confirmTarget?.kind === 'revoke'
            ? '撤销客户要求的知识确认？'
            : '覆盖未保存的客户要求？'}
        description={confirmTarget?.kind === 'confirm'
          ? '当前归纳内容将作为这份订单的正式客户要求供 AI 检索。请先确认内容、附件依据和未提供项均已人工核对。'
          : confirmTarget?.kind === 'revoke'
            ? '已确认版本将停止作为正式知识供 AI 检索；原始文件和当前草稿会继续保留。'
            : '继续 AI 归纳会用所选附件生成的新内容覆盖编辑框中尚未保存的修改，覆盖后无法自动恢复。'}
        confirmLabel={confirmTarget?.kind === 'confirm'
          ? '确认进入知识库'
          : confirmTarget?.kind === 'revoke'
            ? '撤销确认'
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
          else if (target?.kind === 'summarize') void summarizeRequirement(target.link, true);
        }}
      />
    </div>
  );
}
