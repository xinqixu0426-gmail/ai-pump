'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Database,
  Download,
  FileClock,
  FileUp,
  History,
  Loader2,
  MessageSquareWarning,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  SearchCheck,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  deleteKnowledgeDocument,
  getKnowledgeEntryDetail,
  getKnowledgeOverview,
  getKnowledgeSyncHealth,
  getKnowledgeSyncRuns,
  searchKnowledgeEntries,
  syncFactoryKnowledge,
  uploadKnowledgeDocument,
  type KnowledgeChange,
  type KnowledgeChangeStatus,
  type KnowledgeDetail,
  type KnowledgeDocumentType,
  type KnowledgeEntryType,
  type KnowledgeListItem,
  type KnowledgeOverview,
  type KnowledgeSyncHealth,
  type KnowledgeSyncHistory,
} from '@/lib/knowledge';
import {
  diagnoseAiAnswerFeedback,
  completeAiEvaluationRun,
  createAiEvaluationRun,
  getAiEvaluationOverview,
  listAiAnswerFeedback,
  recordAiEvaluationResult,
  recordAiAnswerFeedbackRetest,
  reviewAiAnswerFeedback,
  streamAiChat,
  type AiAnswerFeedback,
  type AiAnswerFeedbackList,
  type AiEvaluationOverview,
  type AiToolResult,
} from '@/lib/ai';
import { StreamingText } from '@/components/prompt-kit/basic-chat';
import { FadePanel } from '@/components/motion/fade-panel';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';

type KnowledgeStatusFilter = 'all' | 'fresh' | 'pending';

type KnowledgeDisplayItem = {
  id: number | null;
  entryType: KnowledgeEntryType;
  sourceTable: string;
  sourceId: string;
  title: string;
  summary: string;
  sourceUpdatedAt: string | null;
  syncedAt: string | null;
  status: 'fresh' | KnowledgeChangeStatus;
};

const ENTRY_TYPE_OPTIONS: Array<{ value: KnowledgeEntryType | ''; label: string }> = [
  { value: '', label: '全部分类' },
  { value: 'part', label: '零件' },
  { value: 'template', label: '泵壳模板' },
  { value: 'recipe', label: '配方' },
  { value: 'coil', label: '线圈' },
  { value: 'customer', label: '客户' },
  { value: 'quotation', label: '报价' },
  { value: 'order', label: '订单' },
  { value: 'quality_issue', label: '质量问题' },
  { value: 'business_rule', label: '业务规则' },
  { value: 'document', label: '工厂资料' },
];

const ENTRY_TYPE_LABELS = Object.fromEntries(
  ENTRY_TYPE_OPTIONS.filter(option => option.value).map(option => [option.value, option.label])
) as Record<KnowledgeEntryType, string>;

const STATUS_META: Record<'fresh' | KnowledgeChangeStatus, { label: string; tone: StatusBadgeTone }> = {
  fresh: { label: '最新', tone: 'green' },
  pending_insert: { label: '待新增', tone: 'blue' },
  pending_update: { label: '待更新', tone: 'amber' },
  pending_delete: { label: '待移除', tone: 'red' },
};

const SYNC_MODE_LABELS = {
  automatic: '自动同步',
  flush: '即时同步',
  manual: '手动同步',
} as const;

const DOCUMENT_TYPE_OPTIONS: Array<{ value: KnowledgeDocumentType; label: string }> = [
  { value: 'technical_note', label: '技术说明' },
  { value: 'pump_performance_test', label: '性能测试报告' },
  { value: 'drawing', label: '图纸' },
  { value: 'spreadsheet', label: 'Excel 资料' },
  { value: 'other', label: '其他资料' },
];

const FEEDBACK_LABELS: Record<Exclude<AiAnswerFeedback['rating'], 'helpful'>, string> = {
  incorrect: '内容错误',
  outdated: '来源过期',
  missing_source: '资料不足',
};

const SOURCE_PATHS: Record<string, string> = {
  parts: '/parts',
  pump_shell_templates: '/parts',
  recipes: '/recipes',
  coils: '/coils',
  customers: '/customers',
  quotations: '/quotations',
  orders: '/orders',
  quality_summary: '/dashboard?view=quality',
  business_rules: '/dashboard?view=knowledge',
  factory_rule_candidates: '/dashboard?view=quality',
};

function sourceKey(item: { sourceTable: string; sourceId: string }) {
  return `${item.sourceTable}\u0000${item.sourceId}`;
}

function dateTime(value: string | null | undefined) {
  if (!value) return '尚未同步';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function matchesChange(change: KnowledgeChange, query: string, entryType: KnowledgeEntryType | '') {
  if (entryType && change.entryType !== entryType) return false;
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return true;
  return `${change.title}\n${change.summary}\n${change.sourceId}`.toLocaleLowerCase().includes(keyword);
}

export function KnowledgeView({
  initialEntryId = null,
  refreshKey = 0,
  onRefreshComplete,
}: {
  initialEntryId?: number | null;
  refreshKey?: number;
  onRefreshComplete?: () => void;
}) {
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null);
  const [syncHealth, setSyncHealth] = useState<KnowledgeSyncHealth | null>(null);
  const [syncHistory, setSyncHistory] = useState<KnowledgeSyncHistory | null>(null);
  const [entries, setEntries] = useState<KnowledgeListItem[]>([]);
  const [query, setQuery] = useState('');
  const [entryType, setEntryType] = useState<KnowledgeEntryType | ''>('');
  const [statusFilter, setStatusFilter] = useState<KnowledgeStatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<KnowledgeDisplayItem | null>(null);
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [documentOpen, setDocumentOpen] = useState(false);
  const [documentType, setDocumentType] = useState<KnowledgeDocumentType>('technical_note');
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentDescription, setDocumentDescription] = useState('');
  const [documentContent, setDocumentContent] = useState('');
  const [documentTags, setDocumentTags] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [deleteDocumentId, setDeleteDocumentId] = useState<number | null>(null);
  const [documentDeleting, setDocumentDeleting] = useState(false);
  const [feedback, setFeedback] = useState<AiAnswerFeedbackList | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackError, setFeedbackError] = useState('');
  const [resolveTarget, setResolveTarget] = useState<AiAnswerFeedback | null>(null);
  const [diagnosticTarget, setDiagnosticTarget] = useState<AiAnswerFeedback | null>(null);
  const [diagnosingId, setDiagnosingId] = useState<number | null>(null);
  const [retesting, setRetesting] = useState(false);
  const [retestStatus, setRetestStatus] = useState('');
  const [evaluation, setEvaluation] = useState<AiEvaluationOverview | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(true);
  const [evaluationRunning, setEvaluationRunning] = useState(false);
  const [evaluationProgress, setEvaluationProgress] = useState({ completed: 0, total: 0, title: '' });
  const [evaluationError, setEvaluationError] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const openedInitialEntryRef = useRef(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [nextOverview, nextEntries, nextSyncHistory, nextSyncHealth] = await Promise.all([
        getKnowledgeOverview(),
        searchKnowledgeEntries({ query, entryType, limit: 50 }),
        getKnowledgeSyncRuns(8),
        getKnowledgeSyncHealth(),
      ]);
      setOverview(nextOverview);
      setEntries(nextEntries);
      setSyncHistory(nextSyncHistory);
      setSyncHealth(nextSyncHealth);
    } catch (err) {
      setError(err instanceof Error ? err.message : '知识库加载失败');
    } finally {
      setLoading(false);
      onRefreshComplete?.();
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [query, entryType, refreshKey]);

  async function loadFeedback() {
    setFeedbackLoading(true);
    setFeedbackError('');
    try {
      setFeedback(await listAiAnswerFeedback({ status: 'open', limit: 30 }));
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'AI 回答反馈加载失败');
    } finally {
      setFeedbackLoading(false);
    }
  }

  useEffect(() => {
    void loadFeedback();
  }, [refreshKey]);

  async function loadEvaluation() {
    setEvaluationLoading(true);
    setEvaluationError('');
    try {
      setEvaluation(await getAiEvaluationOverview());
    } catch (err) {
      setEvaluationError(err instanceof Error ? err.message : '知识库检查结果加载失败');
    } finally {
      setEvaluationLoading(false);
    }
  }

  useEffect(() => {
    void loadEvaluation();
  }, [refreshKey]);

  const changeBySource = useMemo(
    () => new Map((overview?.changes || []).map(change => [sourceKey(change), change])),
    [overview]
  );

  useEffect(() => {
    if (!initialEntryId || !overview || openedInitialEntryRef.current) return;
    openedInitialEntryRef.current = true;
    let cancelled = false;
    setDetailLoading(true);
    void getKnowledgeEntryDetail(initialEntryId)
      .then(entry => {
        if (cancelled) return;
        const change = overview.changes.find(item => sourceKey(item) === sourceKey(entry));
        setSelected({
          id: entry.id,
          entryType: entry.entryType,
          sourceTable: entry.sourceTable,
          sourceId: entry.sourceId,
          title: change?.title || entry.title,
          summary: change?.summary || entry.summary,
          sourceUpdatedAt: change?.sourceUpdatedAt || entry.sourceUpdatedAt,
          syncedAt: entry.syncedAt,
          status: change?.status || 'fresh',
        });
        setDetail(entry);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : '知识详情加载失败');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialEntryId, overview]);

  const displayItems = useMemo(() => {
    if (!overview) return [];
    if (statusFilter === 'pending') {
      return overview.changes
        .filter(change => matchesChange(change, query, entryType))
        .map(change => ({ ...change })) as KnowledgeDisplayItem[];
    }

    const stored = entries.map((entry): KnowledgeDisplayItem => {
      const change = changeBySource.get(sourceKey(entry));
      return {
        id: entry.id,
        entryType: entry.entryType,
        sourceTable: entry.sourceTable,
        sourceId: entry.sourceId,
        title: change?.title || entry.title,
        summary: change?.summary || entry.summary,
        sourceUpdatedAt: change?.sourceUpdatedAt || null,
        syncedAt: entry.syncedAt,
        status: change?.status || 'fresh',
      };
    });
    const filteredStored = statusFilter === 'fresh'
      ? stored.filter(item => item.status === 'fresh')
      : stored;
    if (statusFilter !== 'all') return filteredStored;
    const unsynced = overview.changes
      .filter(change => change.status === 'pending_insert' && matchesChange(change, query, entryType))
      .map(change => ({ ...change })) as KnowledgeDisplayItem[];
    return [...unsynced, ...filteredStored];
  }, [changeBySource, entries, entryType, overview, query, statusFilter]);

  async function openDetail(item: KnowledgeDisplayItem) {
    setSelected(item);
    setDetail(null);
    if (!item.id) return;
    setDetailLoading(true);
    try {
      setDetail(await getKnowledgeEntryDetail(item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '知识详情加载失败');
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncMessage('');
    try {
      const stats = await syncFactoryKnowledge();
      setSyncMessage(`同步完成：新增 ${stats.inserted}，更新 ${stats.updated}，移除 ${stats.deleted}，未变化 ${stats.unchanged}`);
      await load();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : '知识库同步失败');
    } finally {
      setSyncing(false);
    }
  }

  function resetDocumentForm() {
    setDocumentType('technical_note');
    setDocumentTitle('');
    setDocumentDescription('');
    setDocumentContent('');
    setDocumentTags('');
    setDocumentFile(null);
    setDocumentError('');
  }

  async function saveDocument() {
    setDocumentSaving(true);
    setDocumentError('');
    try {
      await uploadKnowledgeDocument({
        documentType,
        title: documentTitle.trim(),
        description: documentDescription.trim(),
        contentText: documentContent.trim(),
        tags: documentTags.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean),
        file: documentFile,
      });
      setDocumentOpen(false);
      resetDocumentForm();
      await new Promise(resolve => window.setTimeout(resolve, 450));
      await load();
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : '工厂资料导入失败');
    } finally {
      setDocumentSaving(false);
    }
  }

  async function removeDocument() {
    if (!deleteDocumentId) return;
    setDocumentDeleting(true);
    setDocumentError('');
    try {
      await deleteKnowledgeDocument(deleteDocumentId);
      setDeleteDocumentId(null);
      setSelected(null);
      setDetail(null);
      await new Promise(resolve => window.setTimeout(resolve, 450));
      await load();
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : '工厂资料删除失败');
    } finally {
      setDocumentDeleting(false);
    }
  }

  async function resolveFeedback() {
    if (!resolveTarget) return;
    setResolving(true);
    setFeedbackError('');
    try {
      await reviewAiAnswerFeedback(resolveTarget.id, {
        status: 'resolved',
        resolutionNote,
      });
      setResolveTarget(null);
      setResolutionNote('');
      await loadFeedback();
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : '处理反馈失败');
    } finally {
      setResolving(false);
    }
  }

  function updateFeedbackItem(next: AiAnswerFeedback) {
    setFeedback(current => current ? {
      ...current,
      items: current.items.map(item => item.id === next.id ? next : item),
    } : current);
    setDiagnosticTarget(current => current?.id === next.id ? next : current);
  }

  async function diagnoseFeedback(item: AiAnswerFeedback) {
    setDiagnosingId(item.id);
    setFeedbackError('');
    try {
      const diagnosed = await diagnoseAiAnswerFeedback(item.id);
      updateFeedbackItem(diagnosed);
      setDiagnosticTarget(diagnosed);
      setRetestStatus('');
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : '诊断反馈失败');
    } finally {
      setDiagnosingId(null);
    }
  }

  async function retestFeedback(item: AiAnswerFeedback) {
    if (!item.questionText || retesting) return;
    setRetesting(true);
    setRetestStatus('正在重新查询当前业务数据和知识库...');
    setFeedbackError('');
    let answerText = '';
    let toolResults: AiToolResult[] = [];
    try {
      await streamAiChat([{ role: 'user', content: item.questionText }], event => {
        if (event.type === 'content') answerText += event.content;
        if (event.type === 'tool_result') toolResults = [...toolResults, { name: event.name, result: event.result }];
        if (event.type === 'detail' && event.toolResults) toolResults = event.toolResults;
        if (event.type === 'status' && event.message) setRetestStatus(event.message);
        if (event.type === 'error') throw new Error(event.message);
      });
      if (!answerText.trim()) throw new Error('复测没有返回有效回答');
      const retested = await recordAiAnswerFeedbackRetest(item.id, { answerText, toolResults });
      updateFeedbackItem(retested);
      setRetestStatus('复测完成，请对比新旧回答后人工确认。');
    } catch (err) {
      const message = err instanceof Error ? err.message : '重新验证失败';
      setFeedbackError(message);
      setRetestStatus(message);
    } finally {
      setRetesting(false);
    }
  }

  async function runEvaluationSuite() {
    if (evaluationRunning) return;
    setEvaluationRunning(true);
    setEvaluationError('');
    setEvaluationProgress({ completed: 0, total: 0, title: '正在创建检查任务' });
    try {
      const created = await createAiEvaluationRun();
      setEvaluationProgress({ completed: 0, total: created.cases.length, title: created.cases[0]?.title || '' });
      for (let index = 0; index < created.cases.length; index += 1) {
        const evaluationCase = created.cases[index];
        let answerText = '';
        let toolResults: AiToolResult[] = [];
        let errorText = '';
        setEvaluationProgress({ completed: index, total: created.cases.length, title: evaluationCase.title });
        try {
          await streamAiChat([{ role: 'user', content: evaluationCase.question }], event => {
            if (event.type === 'content') answerText += event.content;
            if (event.type === 'tool_result') toolResults = [...toolResults, { name: event.name, result: event.result }];
            if (event.type === 'detail' && event.toolResults) toolResults = event.toolResults;
            if (event.type === 'error') throw new Error(event.message);
          });
        } catch (err) {
          errorText = err instanceof Error ? err.message : 'AI 查询失败';
        }
        await recordAiEvaluationResult(created.run.id, {
          caseId: evaluationCase.id,
          answerText,
          toolResults,
          errorText,
        });
        setEvaluationProgress({ completed: index + 1, total: created.cases.length, title: evaluationCase.title });
      }
      await completeAiEvaluationRun(created.run.id);
      await loadEvaluation();
    } catch (err) {
      setEvaluationError(err instanceof Error ? err.message : '知识库检查运行失败');
      await loadEvaluation();
    } finally {
      setEvaluationRunning(false);
    }
  }

  const documentDownloadPath = selected?.sourceTable === 'knowledge_documents'
    && typeof detail?.metadata?.downloadPath === 'string'
    ? detail.metadata.downloadPath
    : '';
  const sourcePath = selected ? SOURCE_PATHS[selected.sourceTable] : undefined;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FadePanel className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted">已同步知识</div>
            <Database size={17} className="text-sky-600" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{overview?.stats.storedTotal ?? '-'}</div>
          <div className="mt-1 text-xs text-muted">当前知识条目</div>
        </FadePanel>
        <FadePanel className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted">最新状态</div>
            <CheckCircle2 size={17} className="text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{overview?.stats.fresh ?? '-'}</div>
          <div className="mt-1 text-xs text-muted">内容与业务来源一致</div>
        </FadePanel>
        <FadePanel className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted">待同步</div>
            <FileClock size={17} className="text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-semibold text-ink">{overview?.stats.pendingTotal ?? '-'}</div>
          <div className="mt-1 text-xs text-muted">
            新增 {overview?.stats.pendingInsert ?? 0} · 更新 {overview?.stats.pendingUpdate ?? 0} · 移除 {overview?.stats.pendingDelete ?? 0}
          </div>
        </FadePanel>
        <FadePanel className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted">最近同步</div>
            <RefreshCw size={17} className="text-violet-600" />
          </div>
          <div className="mt-2 text-sm font-semibold text-ink">{dateTime(overview?.lastSyncedAt)}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusBadge
              tone={!overview?.autoSync.enabled
                ? 'slate'
                : overview.autoSync.lastError
                  ? 'red'
                  : overview.autoSync.running || overview.autoSync.pending
                    ? 'amber'
                    : 'green'}
            >
              {!overview?.autoSync.enabled
                ? '自动同步已关闭'
                : overview.autoSync.lastError
                  ? '自动同步异常'
                  : overview.autoSync.running
                    ? '自动同步中'
                    : overview.autoSync.pending
                      ? '等待自动同步'
                      : '自动同步正常'}
            </StatusBadge>
            <span>{overview?.ftsEnabled ? 'FTS 全文检索已启用' : '普通文本检索'}</span>
          </div>
          {overview?.autoSync.lastError ? (
            <div className="mt-2 line-clamp-2 text-xs text-rose-700">{overview.autoSync.lastError}</div>
          ) : null}
        </FadePanel>
      </div>

      {syncHealth && syncHealth.status !== 'healthy' ? (
        <FadePanel
          className={`overflow-hidden rounded-panel border shadow-panel ${
            syncHealth.status === 'critical'
              ? 'border-rose-200 bg-rose-50'
              : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <MessageSquareWarning
                  size={17}
                  className={syncHealth.status === 'critical' ? 'text-rose-700' : 'text-amber-700'}
                />
                <div className="text-sm font-semibold text-ink">{syncHealth.summary}</div>
                <StatusBadge tone={syncHealth.status === 'critical' ? 'red' : 'amber'}>
                  {syncHealth.status === 'critical' ? '需要处理' : '需要关注'}
                </StatusBadge>
              </div>
              <div className="mt-2 divide-y divide-black/5">
                {syncHealth.issues.map(issue => (
                  <div key={issue.code} className="py-2 first:pt-0 last:pb-0">
                    <div className="text-sm font-medium text-ink">{issue.title}</div>
                    <div className={`mt-0.5 text-xs leading-5 ${
                      issue.severity === 'critical' ? 'text-rose-800' : 'text-amber-800'
                    }`}>
                      {issue.message}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {syncHealth.needsRecovery ? (
              <Button
                variant="secondary"
                icon={<RefreshCw size={15} />}
                onClick={() => {
                  setSyncMessage('');
                  setSyncOpen(true);
                }}
              >
                {syncHealth.issues.every(issue => issue.code === 'auto_sync_disabled')
                  ? '手动核对'
                  : '检查并恢复'}
              </Button>
            ) : null}
          </div>
        </FadePanel>
      ) : null}

      <FadePanel className="overflow-hidden rounded-panel border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <div className="text-sm font-semibold text-ink">来源覆盖</div>
          <div className="mt-1 text-xs text-muted">按业务类型核对当前来源与已同步知识。</div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {ENTRY_TYPE_OPTIONS.filter(option => option.value).map(option => {
            const type = option.value as KnowledgeEntryType;
            const stats = overview?.byType[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => setEntryType(type)}
                className={`flex min-h-20 items-center justify-between gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-slate-50 sm:border-r ${
                  entryType === type ? 'bg-slate-50' : 'bg-white'
                }`}
              >
                <div>
                  <div className="text-sm font-medium text-ink">{option.label}</div>
                  <div className="mt-1 text-xs text-muted">来源 {stats?.current || 0} · 已同步 {stats?.stored || 0}</div>
                </div>
                {stats?.pending ? <StatusBadge tone="amber">{stats.pending} 待同步</StatusBadge> : <StatusBadge tone="green">最新</StatusBadge>}
              </button>
            );
          })}
        </div>
      </FadePanel>

      <FadePanel className="overflow-hidden rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <History size={16} className="text-sky-700" />
              同步记录
            </div>
            <div className="mt-1 text-xs text-muted">保留最近 200 次自动与手动同步结果，失败和重试可追溯。</div>
          </div>
          {syncHistory ? (
            <StatusBadge tone={overview?.autoSync.lastError ? 'red' : 'green'}>
              {overview?.autoSync.lastError
                ? `${syncHistory.stats.failedCount} 次失败`
                : `最近 ${syncHistory.stats.totalRetained} 次有记录`}
            </StatusBadge>
          ) : null}
        </div>
        {syncHistory?.items.length ? (
          <div className="divide-y divide-line">
            {syncHistory.items.map(run => {
              const changed = run.insertedCount + run.updatedCount + run.deletedCount;
              return (
                <div key={run.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={run.status === 'success' ? 'green' : 'red'}>
                        {run.status === 'success' ? '成功' : '失败'}
                      </StatusBadge>
                      <span className="text-sm font-medium text-ink">{SYNC_MODE_LABELS[run.mode]}</span>
                      {run.attempt > 1 ? <span className="text-xs text-amber-700">第 {run.attempt} 次尝试</span> : null}
                      <span className="text-xs text-muted">{dateTime(run.completedAt)}</span>
                    </div>
                    {run.status === 'success' ? (
                      <div className="mt-1 text-xs text-muted">
                        {changed
                          ? `新增 ${run.insertedCount} · 更新 ${run.updatedCount} · 移除 ${run.deletedCount}`
                          : '知识内容无变化'}
                        {run.sourceCount ? ` · ${run.sourceCount} 个触发来源` : ''}
                      </div>
                    ) : (
                      <div className="mt-1 line-clamp-2 text-xs text-rose-700">{run.errorText || '同步执行失败'}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted sm:text-right">
                    <div>{run.durationMs} ms</div>
                    <div className="mt-1">
                      {run.status === 'failed' ? '未完成' : run.ftsEnabled ? 'FTS' : '普通检索'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted">首次自动或手动同步后会显示运行记录。</div>
        )}
      </FadePanel>

      <FadePanel className="overflow-hidden rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ShieldCheck size={16} className="text-emerald-600" />
              知识库回归检查
              {evaluation?.latestRun?.status === 'completed' ? (
                <StatusBadge tone={evaluation.latestRun.failedCount || evaluation.latestRun.reviewCount ? 'amber' : 'green'}>
                  {evaluation.latestRun.passedCount}/{evaluation.latestRun.totalCount} 通过
                </StatusBadge>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-muted">自动复查价格、来源、报告类型、线圈方案、报价序号和成品电缆语义。</div>
          </div>
          <Button
            variant="primary"
            icon={evaluationRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            onClick={() => void runEvaluationSuite()}
            disabled={evaluationRunning || evaluationLoading}
          >
            {evaluationRunning ? '检查中' : '运行知识库检查'}
          </Button>
        </div>
        {evaluationError ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{evaluationError}</div>
        ) : null}
        {evaluationRunning ? (
          <div className="border-b border-line bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-medium text-ink">{evaluationProgress.title || '正在准备'}</span>
              <span className="shrink-0 text-muted">{evaluationProgress.completed}/{evaluationProgress.total}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-ink transition-[width] duration-300"
                style={{ width: `${evaluationProgress.total ? Math.round(evaluationProgress.completed / evaluationProgress.total * 100) : 0}%` }}
              />
            </div>
          </div>
        ) : null}
        {evaluationLoading ? (
          <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" />加载检查结果
          </div>
        ) : evaluation?.latestRun ? (
          <div>
            <div className="grid grid-cols-2 border-b border-line bg-slate-50 sm:grid-cols-4">
              <div className="border-r border-line px-4 py-3"><div className="text-xs text-muted">通过</div><div className="mt-1 text-lg font-semibold text-emerald-700">{evaluation.latestRun.passedCount}</div></div>
              <div className="border-r border-line px-4 py-3"><div className="text-xs text-muted">需要修复</div><div className="mt-1 text-lg font-semibold text-rose-700">{evaluation.latestRun.failedCount}</div></div>
              <div className="border-r border-line px-4 py-3"><div className="text-xs text-muted">需要确认</div><div className="mt-1 text-lg font-semibold text-amber-700">{evaluation.latestRun.reviewCount}</div></div>
              <div className="px-4 py-3"><div className="text-xs text-muted">运行时间</div><div className="mt-1 text-sm font-medium text-ink">{dateTime(evaluation.latestRun.completedAt || evaluation.latestRun.startedAt)}</div></div>
            </div>
            <div className="divide-y divide-line">
              {evaluation.results.map(result => {
                const failedChecks = result.checks.filter(check => !check.passed);
                return (
                  <details key={result.id} className="group">
                    <summary className="grid cursor-pointer list-none gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[100px_minmax(0,1fr)_auto] sm:items-center">
                      <div><StatusBadge tone={result.status === 'passed' ? 'green' : result.status === 'failed' ? 'red' : 'amber'}>{result.status === 'passed' ? '通过' : result.status === 'failed' ? '需要修复' : '需要确认'}</StatusBadge></div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{result.caseTitle}</div>
                        <div className="mt-1 line-clamp-1 text-xs text-muted">
                          {failedChecks[0]?.detail || `${result.checks.length} 项规则全部通过`}
                        </div>
                      </div>
                      <span className="text-xs text-muted group-open:hidden">查看详情</span>
                    </summary>
                    <div className="border-t border-line bg-slate-50 px-4 py-3">
                      <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
                        <div>
                          <div className="text-xs font-medium text-muted">自动判定</div>
                          <div className="mt-2 space-y-1.5">
                            {result.checks.map(check => (
                              <div key={check.key} className={`rounded-md border px-2.5 py-2 text-xs ${check.passed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                                <div className="font-medium">{check.passed ? '通过' : '失败'}：{check.label}</div>
                                <div className="mt-1 leading-5">{check.detail}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-muted">AI 实际回答</div>
                          <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-line bg-white p-3">
                            {result.answerText ? <StreamingText id={`evaluation-${result.id}`} text={result.answerText} streaming={false} /> : <div className="text-sm text-rose-700">{result.errorText || '没有返回回答'}</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex min-h-28 flex-col items-center justify-center px-4 text-center">
            <ShieldCheck size={21} className="text-muted" />
            <div className="mt-2 text-sm font-medium text-ink">尚未运行知识库检查</div>
            <div className="mt-1 text-xs text-muted">点击运行后，系统会自动完成 {evaluation?.cases.length || 0} 个关键用例。</div>
          </div>
        )}
      </FadePanel>

      <FadePanel className="overflow-hidden rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <MessageSquareWarning size={16} className="text-amber-600" />
              AI 回答反馈
              {feedback?.stats.open ? <StatusBadge tone="amber">{feedback.stats.open} 待处理</StatusBadge> : null}
            </div>
            <div className="mt-1 text-xs text-muted">核对用户报告的错误、过期来源和资料缺口；处理不会自动改写知识或业务数据。</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <span>内容错误 {feedback?.stats.incorrect || 0}</span>
            <span>来源过期 {feedback?.stats.outdated || 0}</span>
            <span>资料不足 {feedback?.stats.missingSource || 0}</span>
          </div>
        </div>
        {feedbackError ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{feedbackError}</div>
        ) : null}
        {feedbackLoading ? (
          <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" />加载回答反馈
          </div>
        ) : feedback?.items.length ? (
          <div className="divide-y divide-line">
            {feedback.items.map(item => (
              <div key={item.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[110px_minmax(0,1fr)_auto] lg:items-start">
                <div><StatusBadge tone="amber">{item.rating === 'helpful' ? '准确' : FEEDBACK_LABELS[item.rating]}</StatusBadge></div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{item.questionText || '未保存用户问题'}</div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted">AI：{item.answerText || '未保存回答内容'}</div>
                  {item.note ? <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900">反馈：{item.note}</div> : null}
                  {item.sources.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.sources.map((source, index) => (
                        <a
                          key={`${source.knowledgeEntryId || source.sourceId}-${index}`}
                          href={source.knowledgePath || source.sourcePath}
                          className="inline-flex items-center gap-1 rounded-md border border-line bg-slate-50 px-2 py-1 text-xs text-slate-600 hover:text-ink"
                        >
                          {source.title || `${source.sourceTable}#${source.sourceId}`}
                          <ArrowUpRight size={11} />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={diagnosingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <SearchCheck size={14} />}
                    onClick={() => item.diagnosis ? setDiagnosticTarget(item) : void diagnoseFeedback(item)}
                    disabled={diagnosingId !== null}
                  >
                    {item.diagnosis ? '查看诊断' : diagnosingId === item.id ? '诊断中' : '诊断'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<CheckCircle2 size={14} />}
                    onClick={() => { setResolveTarget(item); setResolutionNote(''); setFeedbackError(''); }}
                  >
                    标记已处理
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-28 flex-col items-center justify-center px-4 text-center">
            <CheckCircle2 size={21} className="text-emerald-600" />
            <div className="mt-2 text-sm font-medium text-ink">暂无待处理反馈</div>
            <div className="mt-1 text-xs text-muted">AI 工作台报告的问题会出现在这里。</div>
          </div>
        )}
      </FadePanel>

      <FadePanel className="overflow-hidden rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">知识条目</div>
            <div className="mt-1 text-xs text-muted">业务数据变更后自动刷新；手动同步用于全量核对和故障恢复。</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<FileUp size={15} />} onClick={() => { resetDocumentForm(); setDocumentOpen(true); }}>
              导入资料
            </Button>
            <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={() => { setSyncMessage(''); setSyncOpen(true); }}>
              同步知识库
            </Button>
          </div>
        </div>
        <div className="grid gap-3 border-b border-line bg-slate-50 p-3 md:grid-cols-[minmax(220px,1fr)_180px_auto]">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-muted" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索名称、型号、客户或内容"
              className="h-9 w-full rounded-md border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none focus:border-slate-400"
            />
          </label>
          <select
            value={entryType}
            onChange={event => setEntryType(event.target.value as KnowledgeEntryType | '')}
            className="h-9 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
            aria-label="知识分类"
          >
            {ENTRY_TYPE_OPTIONS.map(option => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
          </select>
          <div className="flex h-9 rounded-md border border-line bg-white p-0.5" role="group" aria-label="同步状态">
            {([
              ['all', '全部'],
              ['fresh', '最新'],
              ['pending', `待同步 ${overview?.stats.pendingTotal || ''}`],
            ] as Array<[KnowledgeStatusFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={`rounded px-3 text-xs font-medium ${statusFilter === value ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" />加载知识条目
          </div>
        ) : displayItems.length ? (
          <div className="divide-y divide-line">
            {displayItems.map(item => {
              const status = STATUS_META[item.status];
              return (
                <button
                  key={`${sourceKey(item)}-${item.status}`}
                  type="button"
                  onClick={() => void openDetail(item)}
                  className="grid w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 md:grid-cols-[110px_minmax(0,1fr)_100px] md:items-center"
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge tone="slate">{ENTRY_TYPE_LABELS[item.entryType]}</StatusBadge>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{item.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{item.summary || '暂无摘要'}</div>
                  </div>
                  <div className="flex md:justify-end"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
            <BookOpen size={22} className="text-muted" />
            <div className="mt-3 text-sm font-medium text-ink">没有符合条件的知识条目</div>
            <div className="mt-1 text-xs text-muted">调整搜索词、分类或同步状态后再查看。</div>
          </div>
        )}
      </FadePanel>

      {syncOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
          <div className="w-full max-w-md rounded-panel border border-line bg-white shadow-panel" role="dialog" aria-modal="true" aria-labelledby="knowledge-sync-title">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="knowledge-sync-title" className="text-base font-semibold text-ink">同步工厂知识库</h2>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={16} />} aria-label="关闭" onClick={() => setSyncOpen(false)} disabled={syncing} />
            </div>
            <div className="space-y-3 p-4 text-sm text-muted">
              <p>同步会根据当前业务数据新增、更新或移除知识条目，源业务数据不会被修改。</p>
              {overview?.stats.pendingTotal ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
                  本次预计处理 {overview.stats.pendingTotal} 条：新增 {overview.stats.pendingInsert}，更新 {overview.stats.pendingUpdate}，移除 {overview.stats.pendingDelete}。
                </p>
              ) : (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">当前知识内容已经是最新状态。</p>
              )}
              {syncMessage ? <p className="rounded-md border border-line bg-slate-50 p-3 text-ink">{syncMessage}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="ghost" onClick={() => setSyncOpen(false)} disabled={syncing}>关闭</Button>
              <Button variant="primary" icon={syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} onClick={() => void runSync()} disabled={syncing}>
                {syncing ? '同步中' : '确认同步'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {documentOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-panel border border-line bg-white shadow-panel" role="dialog" aria-modal="true" aria-labelledby="knowledge-document-title">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="knowledge-document-title" className="text-base font-semibold text-ink">导入工厂资料</h2>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={16} />} aria-label="关闭" onClick={() => setDocumentOpen(false)} disabled={documentSaving} />
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-muted">资料类型</span>
                  <select
                    value={documentType}
                    onChange={event => setDocumentType(event.target.value as KnowledgeDocumentType)}
                    className="mt-2 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
                    disabled={documentSaving}
                  >
                    {DOCUMENT_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">标题</span>
                  <input
                    value={documentTitle}
                    onChange={event => setDocumentTitle(event.target.value)}
                    maxLength={200}
                    className="mt-2 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
                    disabled={documentSaving}
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-muted">说明</span>
                <textarea
                  value={documentDescription}
                  onChange={event => setDocumentDescription(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="mt-2 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-slate-400"
                  disabled={documentSaving}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">技术内容</span>
                <textarea
                  value={documentContent}
                  onChange={event => setDocumentContent(event.target.value)}
                  maxLength={200000}
                  rows={6}
                  className="mt-2 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-slate-400"
                  disabled={documentSaving}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-muted">标签</span>
                  <input
                    value={documentTags}
                    onChange={event => setDocumentTags(event.target.value)}
                    placeholder="型号、类别、用途"
                    className="mt-2 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
                    disabled={documentSaving}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">文件</span>
                  <input
                    type="file"
                    accept=".txt,.md,.csv,.xls,.xlsx,.pdf"
                    onChange={event => setDocumentFile(event.target.files?.[0] || null)}
                    className="mt-2 block h-9 w-full rounded-md border border-line bg-white text-xs text-muted file:mr-3 file:h-full file:border-0 file:border-r file:border-line file:bg-slate-50 file:px-3 file:text-xs file:font-medium file:text-ink"
                    disabled={documentSaving}
                  />
                </label>
              </div>
              {documentType === 'drawing' && documentFile?.name.toLowerCase().endsWith('.pdf') ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  当前版本保存原始 PDF，并检索标题、说明和标签；图纸正文解析将在后续版本加入。
                </div>
              ) : null}
              {documentError ? <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{documentError}</div> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="ghost" onClick={() => setDocumentOpen(false)} disabled={documentSaving}>取消</Button>
              <Button
                variant="primary"
                icon={documentSaving ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
                onClick={() => void saveDocument()}
                disabled={documentSaving || !documentTitle.trim() || (!documentFile && !documentContent.trim())}
              >
                {documentSaving ? '导入中' : '确认导入'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDocumentId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
          <div className="w-full max-w-md rounded-panel border border-line bg-white shadow-panel" role="dialog" aria-modal="true" aria-labelledby="knowledge-document-delete-title">
            <div className="border-b border-line px-4 py-3">
              <h2 id="knowledge-document-delete-title" className="text-base font-semibold text-ink">删除工厂资料</h2>
            </div>
            <div className="space-y-3 p-4 text-sm leading-6 text-muted">
              <p>原始文件和对应知识条目将被移除，操作会进入审计记录。</p>
              {documentError ? <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{documentError}</div> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="ghost" onClick={() => setDeleteDocumentId(null)} disabled={documentDeleting}>取消</Button>
              <Button variant="danger" icon={documentDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} onClick={() => void removeDocument()} disabled={documentDeleting}>
                {documentDeleting ? '删除中' : '确认删除'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {resolveTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
          <div className="w-full max-w-md rounded-panel border border-line bg-white shadow-panel" role="dialog" aria-modal="true" aria-labelledby="feedback-resolve-title">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="feedback-resolve-title" className="text-base font-semibold text-ink">处理 AI 回答反馈</h2>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={16} />} aria-label="关闭" onClick={() => setResolveTarget(null)} disabled={resolving} />
            </div>
            <div className="space-y-3 p-4">
              <div className="text-sm font-medium text-ink">{resolveTarget.questionText}</div>
              <label className="block">
                <span className="text-xs font-medium text-muted">处理说明（可选）</span>
                <textarea
                  value={resolutionNote}
                  onChange={event => setResolutionNote(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="例如：已同步最新业务数据并复核回答。"
                  className="mt-2 w-full resize-y rounded-md border border-line bg-slate-50 px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-slate-400"
                  disabled={resolving}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="ghost" onClick={() => setResolveTarget(null)} disabled={resolving}>取消</Button>
              <Button variant="primary" icon={resolving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} onClick={() => void resolveFeedback()} disabled={resolving}>
                {resolving ? '处理中' : '确认已处理'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {diagnosticTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-panel border border-line bg-white shadow-panel" role="dialog" aria-modal="true" aria-labelledby="feedback-diagnosis-title">
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="feedback-diagnosis-title" className="text-base font-semibold text-ink">回答诊断与复测</h2>
                  <StatusBadge tone="amber">{diagnosticTarget.rating === 'helpful' ? '准确' : FEEDBACK_LABELS[diagnosticTarget.rating]}</StatusBadge>
                </div>
                <div className="mt-1 truncate text-xs text-muted">{diagnosticTarget.questionText}</div>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={16} />} aria-label="关闭" onClick={() => setDiagnosticTarget(null)} disabled={retesting} />
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
                <Button variant="secondary" icon={diagnosingId === diagnosticTarget.id ? <Loader2 size={15} className="animate-spin" /> : <SearchCheck size={15} />} onClick={() => void diagnoseFeedback(diagnosticTarget)} disabled={diagnosingId !== null || retesting}>
                  重新诊断
                </Button>
                {diagnosticTarget.diagnosis?.actions.some(action => action.type === 'sync_knowledge') ? (
                  <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={() => { setDiagnosticTarget(null); setSyncMessage(''); setSyncOpen(true); }} disabled={retesting}>
                    同步知识库
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" icon={retesting ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} onClick={() => void retestFeedback(diagnosticTarget)} disabled={retesting || diagnosingId !== null}>
                  {retesting ? '复测中' : '重新验证'}
                </Button>
                <Button variant="primary" icon={<CheckCircle2 size={15} />} onClick={() => { setResolveTarget(diagnosticTarget); setDiagnosticTarget(null); setResolutionNote(''); }} disabled={retesting}>
                  确认并归档
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div className="fixed inset-0 z-50 bg-black/25" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}>
          <aside className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-line bg-white shadow-panel" role="dialog" aria-modal="true" aria-labelledby="knowledge-detail-title">
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="slate">{ENTRY_TYPE_LABELS[selected.entryType]}</StatusBadge>
                  <StatusBadge tone={STATUS_META[selected.status].tone}>{STATUS_META[selected.status].label}</StatusBadge>
                </div>
                <h2 id="knowledge-detail-title" className="mt-3 text-base font-semibold text-ink">{selected.title}</h2>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={17} />} aria-label="关闭详情" onClick={() => setSelected(null)} />
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
                <Button variant="danger" className="flex-1" icon={<Trash2 size={15} />} onClick={() => {
                  setDocumentError('');
                  setDeleteDocumentId(Number(selected.sourceId));
                  setSelected(null);
                }}>
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
          </aside>
        </div>
      ) : null}
    </div>
  );
}
