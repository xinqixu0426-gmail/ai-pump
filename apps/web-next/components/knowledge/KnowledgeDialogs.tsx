'use client';

import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { AiAnswerFeedback } from '@/lib/ai';
import type { KnowledgeDetail } from '@/lib/knowledge';
import { StreamingText } from '@/components/ai/ai-text';
import { Button } from '@/components/ui/button';
import { Dialog, Drawer } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  ENTRY_TYPE_LABELS,
  FEEDBACK_LABELS,
  STATUS_META,
  dateTime,
  type KnowledgeDisplayItem,
} from '@/components/knowledge/knowledge-view-model';

export function KnowledgeDialogs({
  resolveTarget,
  resolving,
  resolutionNote,
  onResolutionNoteChange,
  onCloseResolve,
  onResolve,
  diagnosticTarget,
  diagnosingId,
  retesting,
  retestStatus,
  onCloseDiagnostic,
  onDiagnose,
  onSyncKnowledge,
  onRetest,
  onArchive,
  selected,
  detail,
  detailLoading,
  sourcePath,
  documentDownloadPath,
  onCloseDetail,
  onDeleteDocument,
}: {
  resolveTarget: AiAnswerFeedback | null;
  resolving: boolean;
  resolutionNote: string;
  onResolutionNoteChange: (value: string) => void;
  onCloseResolve: () => void;
  onResolve: () => void;
  diagnosticTarget: AiAnswerFeedback | null;
  diagnosingId: number | null;
  retesting: boolean;
  retestStatus: string;
  onCloseDiagnostic: () => void;
  onDiagnose: (target: AiAnswerFeedback) => void;
  onSyncKnowledge: () => void;
  onRetest: (target: AiAnswerFeedback) => void;
  onArchive: (target: AiAnswerFeedback) => void;
  selected: KnowledgeDisplayItem | null;
  detail: KnowledgeDetail | null;
  detailLoading: boolean;
  sourcePath?: string;
  documentDownloadPath?: string | null;
  onCloseDetail: () => void;
  onDeleteDocument: (target: KnowledgeDisplayItem, sourceVersion: string | null) => void;
}) {
  return (
    <>
      {resolveTarget ? (
        <Dialog
          open
          onClose={() => {
            if (!resolving) onCloseResolve();
          }}
          size="sm"
          closeOnBackdrop={!resolving}
          ariaLabelledBy="feedback-resolve-title"
        >
          <div>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="feedback-resolve-title" className="text-base font-semibold text-ink">处理 AI 回答反馈</h2>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={16} />} aria-label="关闭" onClick={onCloseResolve} disabled={resolving} />
            </div>
            <div className="space-y-3 p-4">
              <div className="text-sm font-medium text-ink">{resolveTarget.questionText}</div>
              <label className="block">
                <span className="text-xs font-medium text-muted">处理说明（可选）</span>
                <textarea
                  value={resolutionNote}
                  onChange={event => onResolutionNoteChange(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="例如：已同步最新业务数据并复核回答。"
                  className="mt-2 w-full resize-y rounded-md border border-line bg-slate-50 px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-slate-400"
                  disabled={resolving}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="ghost" onClick={onCloseResolve} disabled={resolving}>取消</Button>
              <Button variant="primary" icon={resolving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} onClick={onResolve} disabled={resolving}>
                {resolving ? '处理中' : '确认已处理'}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {diagnosticTarget ? (
        <Dialog
          open
          onClose={() => {
            if (!retesting) onCloseDiagnostic();
          }}
          size="xl"
          closeOnBackdrop={!retesting}
          ariaLabelledBy="feedback-diagnosis-title"
          panelClassName="flex flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="feedback-diagnosis-title" className="text-base font-semibold text-ink">回答诊断与复测</h2>
                  <StatusBadge tone="amber">{diagnosticTarget.rating === 'helpful' ? '准确' : FEEDBACK_LABELS[diagnosticTarget.rating]}</StatusBadge>
                </div>
                <div className="mt-1 truncate text-xs text-muted">{diagnosticTarget.questionText}</div>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={16} />} aria-label="关闭" onClick={onCloseDiagnostic} disabled={retesting} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                {diagnosticTarget.diagnosis ? (
                  <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={diagnosticTarget.diagnosis.type === 'knowledge_outdated' ? 'amber' : 'blue'}>
                        {diagnosticTarget.diagnosis.type === 'knowledge_outdated' ? '知识待同步'
                          : diagnosticTarget.diagnosis.type === 'missing_citation' ? '缺少引用'
                            : diagnosticTarget.diagnosis.type === 'knowledge_gap' ? '知识缺口'
                              : '需业务复核'}
                      </StatusBadge>
                      <span className="text-xs text-sky-700">诊断于 {dateTime(diagnosticTarget.diagnosedAt)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-sky-950">{diagnosticTarget.diagnosis.summary}</p>
                  </div>
                ) : null}

                {diagnosticTarget.diagnosis?.checkedSources.length ? (
                  <div>
                    <div className="text-xs font-medium text-muted">引用来源状态</div>
                    <div className="mt-2 divide-y divide-line rounded-md border border-line">
                      {diagnosticTarget.diagnosis.checkedSources.map((source, index) => {
                        const status = STATUS_META[source.currentStatus];
                        return (
                          <div key={`${source.sourceTable}-${source.sourceId}-${index}`} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-ink">{source.currentTitle || source.title}</div>
                              <div className="mt-0.5 text-xs text-muted">{source.sourceTable} #{source.sourceId}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                              {source.knowledgePath || source.sourcePath ? (
                                <a href={source.knowledgePath || source.sourcePath} className="inline-flex items-center gap-1 text-xs text-sky-700 hover:text-sky-900">
                                  查看来源 <ArrowUpRight size={11} />
                                </a>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {diagnosticTarget.diagnosis?.candidateSources.length ? (
                  <div>
                    <div className="text-xs font-medium text-muted">可能遗漏的知识</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {diagnosticTarget.diagnosis.candidateSources.map(source => (
                        <a key={source.id} href={`/dashboard?view=knowledge&entry=${source.id}`} className="inline-flex items-center gap-1 rounded-md border border-line bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 hover:text-ink">
                          {source.title}<ArrowUpRight size={11} />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className={`grid gap-3 ${diagnosticTarget.retestAnswerText ? 'lg:grid-cols-2' : ''}`}>
                  <div className="min-w-0 rounded-md border border-line bg-slate-50 p-3">
                    <div className="text-xs font-medium text-muted">原回答</div>
                    <div className="mt-2 max-h-80 overflow-y-auto">
                      <StreamingText id={`original-${diagnosticTarget.id}`} text={diagnosticTarget.answerText} streaming={false} />
                    </div>
                  </div>
                  {diagnosticTarget.retestAnswerText ? (
                    <div className="min-w-0 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium text-emerald-800">复测回答</div>
                        <span className="text-xs text-emerald-700">{dateTime(diagnosticTarget.retestedAt)}</span>
                      </div>
                      <div className="mt-2 max-h-80 overflow-y-auto">
                        <StreamingText id={`retest-${diagnosticTarget.id}`} text={diagnosticTarget.retestAnswerText} streaming={false} />
                      </div>
                    </div>
                  ) : null}
                </div>
                {retestStatus ? <div className="text-sm text-muted">{retestStatus}</div> : null}
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={diagnosingId === diagnosticTarget.id ? <Loader2 size={15} className="animate-spin" /> : <SearchCheck size={15} />} onClick={() => onDiagnose(diagnosticTarget)} disabled={diagnosingId !== null || retesting}>
                  重新诊断
                </Button>
                {diagnosticTarget.diagnosis?.actions.some(action => action.type === 'sync_knowledge') ? (
                  <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={onSyncKnowledge} disabled={retesting}>
                    同步知识库
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" icon={retesting ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} onClick={() => onRetest(diagnosticTarget)} disabled={retesting || diagnosingId !== null}>
                  {retesting ? '复测中' : '重新验证'}
                </Button>
                <Button variant="primary" icon={<CheckCircle2 size={15} />} onClick={() => onArchive(diagnosticTarget)} disabled={retesting}>
                  确认并归档
                </Button>
              </div>
            </div>
          </div>
        </Dialog>
      ) : null}

      {selected ? (
        <Drawer
          open
          onClose={onCloseDetail}
          width="md"
          ariaLabelledBy="knowledge-detail-title"
          panelClassName="flex flex-col overflow-hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="slate">{ENTRY_TYPE_LABELS[selected.entryType]}</StatusBadge>
                  <StatusBadge tone={STATUS_META[selected.status].tone}>{STATUS_META[selected.status].label}</StatusBadge>
                </div>
                <h2 id="knowledge-detail-title" className="mt-3 text-base font-semibold text-ink">{selected.title}</h2>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={17} />} aria-label="关闭详情" onClick={onCloseDetail} />
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {detailLoading ? (
                <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" />加载详情</div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <div className="text-xs font-medium text-muted">摘要</div>
                    <p className="mt-2 text-sm leading-6 text-ink">{selected.summary || '暂无摘要'}</p>
                  </div>
                  {detail ? (
                    <div>
                      <div className="text-xs font-medium text-muted">当前已同步内容</div>
                      <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border border-line bg-slate-50 p-3 font-sans text-sm leading-6 text-ink">{detail.content || '暂无内容'}</pre>
                    </div>
                  ) : (
                    <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                      这是尚未同步的新知识。完成同步后即可查看 AI 实际读取的完整内容。
                    </div>
                  )}
                  <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                    <div><div className="text-xs text-muted">业务来源</div><div className="mt-1 text-sm text-ink">{selected.sourceTable} #{selected.sourceId}</div></div>
                    <div><div className="text-xs text-muted">同步时间</div><div className="mt-1 text-sm text-ink">{dateTime(selected.syncedAt)}</div></div>
                    {selected.sourceUpdatedAt || detail?.sourceUpdatedAt ? <div><div className="text-xs text-muted">来源更新时间</div><div className="mt-1 text-sm text-ink">{dateTime(selected.sourceUpdatedAt || detail?.sourceUpdatedAt)}</div></div> : null}
                    {detail?.tags?.length ? <div><div className="text-xs text-muted">检索标签</div><div className="mt-1 text-sm text-ink">{detail.tags.join('、')}</div></div> : null}
                  </div>
                </div>
              )}
            </div>
            {selected.sourceTable === 'knowledge_documents' ? (
              <div className="flex gap-2 border-t border-line p-4">
                <Button variant="danger" className="flex-1" icon={<Trash2 size={15} />} onClick={() => onDeleteDocument(
                  selected,
                  selected.sourceUpdatedAt || detail?.sourceUpdatedAt || null
                )}>
                  删除资料
                </Button>
                {documentDownloadPath ? (
                  <Button className="flex-1" icon={<Download size={15} />} onClick={() => { window.location.href = documentDownloadPath; }}>
                    下载原文件
                  </Button>
                ) : null}
              </div>
            ) : sourcePath ? (
              <div className="border-t border-line p-4">
                <Button className="w-full" icon={<ArrowUpRight size={15} />} onClick={() => { window.location.href = sourcePath; }}>
                  查看业务来源
                </Button>
              </div>
            ) : null}
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
