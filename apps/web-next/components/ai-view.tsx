'use client';

import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ClipboardList,
  Coins,
  Database,
  FileSearch,
  FileText,
  Maximize2,
  History,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  PanelLeft,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
  Trash2,
  UserRound,
  MessageSquareWarning,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { FadePanel } from '@/components/motion/fade-panel';
import {
  appendAiConversationMessage,
  confirmAiTool,
  createAiConversation,
  deleteAiConversation,
  getAiConversation,
  getAiSystemPrompt,
  listAiConversations,
  listAiAnswerFeedback,
  streamAiChat,
  submitAiAnswerFeedback,
  updateAiConversationMessage,
  updateAiSystemPrompt,
  type AiChatMessage,
  type AiAnswerFeedback,
  type AiAnswerFeedbackRating,
  type AiConversationSummary,
  type AiStreamEvent,
  type AiToolPlan,
  type AiToolResult,
  type AiKnowledgeSource,
  type AiResultProvenance,
} from '@/lib/ai';
import { syncFactoryKnowledge, type KnowledgeSyncStats } from '@/lib/knowledge';
import { StreamingText } from '@/components/prompt-kit/basic-chat';

type ChatItem = {
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
};

type ConfirmationResult = {
  requiresConfirmation?: boolean;
  confirmation?: {
    toolName: string;
    args?: unknown;
    title?: string;
    summary?: string;
    warning?: string;
    rows?: Array<{ label: string; value: string }>;
  };
};

type SampleCategory = '常用' | '成本' | '订单' | '质量';
type AsideMode = 'history' | 'templates';

type SpeechRecognitionResultEventLike = {
  results: ArrayLike<{
    0?: { transcript?: string };
    length: number;
  }>;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
};

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

const asideModeOptions: Array<{ value: AsideMode; label: string }> = [
  { value: 'history', label: '历史' },
  { value: 'templates', label: '模板' },
];

const sampleCategoryOptions: Array<{ value: SampleCategory; label: string }> = [
  { value: '常用', label: '常用' },
  { value: '成本', label: '成本' },
  { value: '订单', label: '订单' },
  { value: '质量', label: '质量' },
];

const samples: Array<{ category: SampleCategory; icon: LucideIcon; label: string; prompt: string; mode?: 'read' | 'write' }> = [
  { category: '常用', icon: ClipboardList, label: '最近订单', prompt: '查一下最近 5 个订单' },
  { category: '常用', icon: FileSearch, label: '转子出图', prompt: '用 V750 模板出 160 片转子图' },
  { category: '成本', icon: Database, label: '成本查询', prompt: 'V750 的成本是多少' },
  { category: '成本', icon: Database, label: '配方对比', prompt: '对比 V750 和 V550 配方' },
  { category: '成本', icon: Coins, label: '差异解释', prompt: '为什么 12-140 比 12-120 贵' },
  { category: '订单', icon: ClipboardList, label: '订单流转', prompt: '把订单 5 改成采购中', mode: 'write' },
  { category: '订单', icon: ReceiptText, label: '待采购', prompt: '现在有哪些订单卡在待采购' },
  { category: '质量', icon: ShieldAlert, label: '经营异常', prompt: '现在有什么报价订单风险需要跟进' },
  { category: '质量', icon: Database, label: '数据质量', prompt: '系统资料还有什么问题会影响 AI 准确性' },
  { category: '质量', icon: FileSearch, label: '零件检索', prompt: '找所有螺丝零件' },
];

const textLoopWords = ['订单', '成本', '零件', '出图', '报价', '采购'];

const textLoopVariants = {
  enter: (direction: number) => ({
    y: direction > 0 ? 14 : -14,
    opacity: 0,
    filter: 'blur(4px)',
  }),
  center: {
    y: 0,
    opacity: 1,
    filter: 'blur(0px)',
  },
  exit: (direction: number) => ({
    y: direction > 0 ? -14 : 14,
    opacity: 0,
    filter: 'blur(4px)',
  }),
};

function TextLoop({ words }: { words: string[] }) {
  const [[index, direction], setIndex] = useState<[number, number]>([0, 1]);
  const word = words[index % words.length] || '';

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex(([current]) => [current + 1, 1]);
    }, 1800);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="relative inline-flex h-8 min-w-[3.5rem] items-center justify-center overflow-hidden align-middle">
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.span
          key={word}
          custom={direction}
          variants={textLoopVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
          className="absolute inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-semibold text-sky-700"
        >
          {word}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function appendSpeechTranscript(base: string, transcript: string) {
  const normalizedTranscript = transcript.trim();
  if (!normalizedTranscript) return base;
  const normalizedBase = base.trimEnd();
  return normalizedBase ? `${normalizedBase} ${normalizedTranscript}` : normalizedTranscript;
}

function speechErrorMessage(error?: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') return '无法使用麦克风，请在浏览器设置中允许麦克风权限。';
  if (error === 'audio-capture') return '未检测到可用的麦克风。';
  if (error === 'network') return '语音识别服务暂时无法连接，请稍后重试。';
  if (error === 'no-speech') return '没有识别到语音，请靠近麦克风后重试。';
  return '语音识别失败，请重试。';
}

function isConfirmationResult(value: unknown): value is ConfirmationResult {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as ConfirmationResult).requiresConfirmation &&
    (value as ConfirmationResult).confirmation?.toolName
  );
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `¥${number.toFixed(2)}` : '';
}

function numberText(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '';
}

function textValue(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function dateText(value: unknown) {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function isSafeInternalPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
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

function percentText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number > 10 ? number.toFixed(1) : (number * 100).toFixed(1)}%`;
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    get_all_parts: '零件列表',
    search_parts: '零件搜索',
    create_part: '新增零件',
    update_part: '修改零件',
    batch_update_prices: '批量调价',
    get_all_recipes: '配方列表',
    query_recipe_cost_by_name: '配方成本',
    query_recipe_cost_by_id: '配方成本',
    full_calculate: '完整估算',
    calculate_coil_cost: '线圈成本',
    dynamic_config_cost: '动态配置成本',
    get_copper_price: '铜价',
    compare_recipes: '配方对比',
    create_recipe: '新增配方',
    update_recipe: '修改配方',
    get_recent_orders: '最近订单',
    get_order_detail: '订单详情',
    create_order: '新增订单',
    add_recipe_to_order: '追加型号',
    update_order_status: '订单状态',
    update_order_item: '修改订单项',
    generate_purchase_list: '采购清单',
    generate_rotor_drawing: '转子出图',
    get_rotor_drawing_history: '出图历史',
    print_rotor_drawing: '打印图纸',
    get_dashboard_summary: '运营看板',
  };
  return labels[name] || name;
}

function resultIcon(name: string) {
  if (name.includes('part')) return Boxes;
  if (name.includes('recipe') || name.includes('cost') || name.includes('calculate')) return Coins;
  if (name.includes('order') || name.includes('purchase')) return ReceiptText;
  if (name.includes('rotor') || name.includes('drawing') || name.includes('print')) return FileText;
  return Wrench;
}

function unwrapResult(value: unknown): Record<string, unknown> {
  const result = asRecord(value);
  const data = asRecord(result.data);
  if (Object.keys(data).length > 0 && Object.keys(result).length <= 2 && result.success !== false) return data;
  return result;
}

function pickMetrics(source: Record<string, unknown>) {
  const candidates: Array<[string, unknown, 'money' | 'number' | 'text' | 'percent']> = [
    ['总成本', source.totalCost ?? source.savedTotalCost ?? source.cost, 'money'],
    ['单位成本', source.unitCost, 'money'],
    ['出厂价', source.unitPrice ?? source.totalPrice, 'money'],
    ['利润', source.totalProfit ?? source.profit, 'money'],
    ['利润率', source.profitMargin ?? source.margin, 'percent'],
    ['数量', source.count ?? source.qty ?? source.quantity, 'number'],
    ['铜价', source.copperPrice ?? source.price, 'money'],
    ['线径', source.wireDiameter ?? source.resolvedWire ?? source.wire, 'text'],
    ['片数', source.sheets ?? source.statorSheets, 'number'],
  ];
  return candidates
    .map(([label, value, type]) => {
      if (value === undefined || value === null || value === '') return null;
      const display = type === 'money' ? money(value) : type === 'percent' ? percentText(value) : type === 'number' ? numberText(value) : textValue(value);
      return display ? { label, value: display } : null;
    })
    .filter((item): item is { label: string; value: string } => Boolean(item));
}

function RawDetails({ result }: { result: unknown }) {
  return (
    <details className="group mt-3 rounded-md border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-muted">
        原始数据
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-slate-200 bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">{formatJson(result)}</pre>
    </details>
  );
}

function MetricGrid({ metrics }: { metrics: Array<{ label: string; value: string }> }) {
  if (metrics.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.slice(0, 6).map((metric) => (
        <div key={metric.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs text-muted">{metric.label}</div>
          <div className="mt-1 truncate text-base font-semibold text-ink">{metric.value}</div>
        </div>
      ))}
    </div>
  );
}

function KeyValueRows({ rows }: { rows: Array<{ label: string; value: unknown }> }) {
  const visible = rows.filter((row) => row.value !== undefined && row.value !== null && row.value !== '');
  if (visible.length === 0) return null;
  return (
    <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
      {visible.map((row) => (
        <div key={row.label} className="flex min-w-0 justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <span className="shrink-0 text-muted">{row.label}</span>
          <span className="truncate font-medium text-ink">{String(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

function DataTable({ columns, rows, emptyText = '暂无数据' }: {
  columns: Array<{ key: string; label: string; render?: (row: Record<string, unknown>) => ReactNode }>;
  rows: Array<Record<string, unknown>>;
  emptyText?: string;
}) {
  if (rows.length === 0) return <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-muted">{emptyText}</div>;
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
      <div className="max-h-80 overflow-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-slate-100 text-xs font-medium text-muted">
            <tr>
              {columns.map((column) => <th key={column.key} className="border-b border-slate-200 px-3 py-2">{column.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.slice(0, 30).map((row, index) => (
              <tr key={`${textValue(row.id, String(index))}-${index}`}>
                {columns.map((column) => (
                  <td key={column.key} className="max-w-48 truncate px-3 py-2 text-slate-700">
                    {column.render ? column.render(row) : textValue(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 30 ? <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted">仅显示前 30 条，共 {rows.length} 条</div> : null}
    </div>
  );
}

function ChangesList({ changes }: { changes: unknown }) {
  const rows = Array.isArray(changes) ? changes.map(String) : [];
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
      <div className="text-xs font-medium text-emerald-800">变更内容</div>
      <div className="mt-2 grid gap-1 text-sm text-emerald-950">
        {rows.map((change, index) => <div key={`${change}-${index}`}>{change}</div>)}
      </div>
    </div>
  );
}

function PartsResult({ name, result }: { name: string; result: Record<string, unknown> }) {
  const rows = arrayValue(result.data || result.parts);
  const part = asRecord(result.part);
  if (Object.keys(part).length > 0) {
    return (
      <>
        <KeyValueRows rows={[
          { label: '型号', value: part.model },
          { label: '类别', value: part.category },
          { label: '单价', value: money(part.price) || part.price },
          { label: '库存', value: part.stock },
          { label: '供应商', value: part.supplier },
        ]} />
        <ChangesList changes={result.changes} />
      </>
    );
  }
  return (
    <>
      <div className="mt-2 text-sm text-muted">共 {textValue(result.count ?? rows.length, '0')} 条结果</div>
      <DataTable
        rows={rows}
        columns={[
          { key: 'model', label: '型号' },
          { key: 'category', label: '类别' },
          { key: 'price', label: '单价', render: (row) => money(row.price) || textValue(row.price) },
          { key: 'stock', label: '库存' },
          { key: 'supplier', label: '供应商' },
        ]}
        emptyText={name === 'search_parts' ? '没有匹配的零件' : '暂无零件'}
      />
    </>
  );
}

function RecipesResult({ result }: { result: Record<string, unknown> }) {
  const rows = arrayValue(result.data);
  const recipe = asRecord(result.recipe);
  if (Object.keys(recipe).length > 0 || result.recipeName) {
    return (
      <>
        <KeyValueRows rows={[
          { label: '配方', value: recipe.name || result.recipeName },
          { label: '规格', value: recipe.spec },
          { label: '零件数', value: recipe.partsCount || result.partsCount },
          { label: '成本', value: money(recipe.totalCost || result.newCost) || recipe.totalCost || result.newCost },
        ]} />
        <ChangesList changes={result.changes} />
      </>
    );
  }
  return (
    <DataTable
      rows={rows}
      columns={[
        { key: 'name', label: '配方' },
        { key: 'spec', label: '规格' },
        { key: 'savedCost', label: '保存成本', render: (row) => money(row.savedCost) || textValue(row.savedCost) },
      ]}
      emptyText="暂无配方"
    />
  );
}

function CostResult({ result }: { result: Record<string, unknown> }) {
  const data = unwrapResult(result);
  const metrics = pickMetrics(data);
  const parts = arrayValue(data.parts || data.breakdownParts || data.items);
  return (
    <>
      <MetricGrid metrics={metrics} />
      <KeyValueRows rows={[
        { label: '配方', value: data.recipeName || data.name || data.recipeSpec },
        { label: '规格', value: data.spec },
        { label: '线圈', value: data.coilSpec || data.resolvedSpec },
        { label: '说明', value: data.message },
      ]} />
      {parts.length > 0 ? (
        <DataTable
          rows={parts}
          columns={[
            { key: 'model', label: '零件' },
            { key: 'qty', label: '数量' },
            { key: 'price', label: '单价', render: (row) => money(row.price ?? row.snapshotPrice ?? row.unitPrice) || textValue(row.price ?? row.snapshotPrice ?? row.unitPrice) },
            { key: 'cost', label: '金额', render: (row) => money(row.cost ?? row.totalCost) || textValue(row.cost ?? row.totalCost) },
          ]}
        />
      ) : null}
    </>
  );
}

function OrderResult({ name, result }: { name: string; result: Record<string, unknown> }) {
  const order = asRecord(result.order);
  const rows = name === 'get_recent_orders' ? arrayValue(result.data) : [];
  if (rows.length > 0) {
    return (
      <DataTable
        rows={rows}
        columns={[
          { key: 'id', label: 'ID' },
          { key: 'customer', label: '客户' },
          { key: 'contract', label: '合同号' },
          { key: 'status', label: '状态' },
          { key: 'createdAt', label: '时间', render: (row) => dateText(row.createdAt) },
        ]}
      />
    );
  }

  const target = Object.keys(order).length > 0 ? order : result;
  const items = arrayValue(target.items);
  const purchaseList = arrayValue(result.purchaseList || target.purchaseList);
  return (
    <>
      <KeyValueRows rows={[
        { label: '订单 ID', value: target.id || result.orderId },
        { label: '客户', value: target.customerName || result.customerName },
        { label: '合同号', value: target.contractNo },
        { label: '状态', value: target.status || result.newStatus },
      ]} />
      <MetricGrid metrics={pickMetrics(target)} />
      <ChangesList changes={result.changes} />
      {items.length > 0 ? (
        <DataTable
          rows={items}
          columns={[
            { key: 'recipeName', label: '型号' },
            { key: 'qty', label: '数量' },
            { key: 'unitCost', label: '成本', render: (row) => money(row.unitCost) || textValue(row.unitCost) },
            { key: 'unitPrice', label: '出厂价', render: (row) => money(row.unitPrice) || textValue(row.unitPrice) },
          ]}
        />
      ) : null}
      {purchaseList.length > 0 ? (
        <DataTable
          rows={purchaseList}
          columns={[
            { key: 'model', label: '零件' },
            { key: 'supplier', label: '供应商' },
            { key: 'requiredQty', label: '需求' },
            { key: 'stock', label: '库存' },
            { key: 'needToBuy', label: '采购' },
          ]}
        />
      ) : null}
    </>
  );
}

function CompareResult({ result }: { result: Record<string, unknown> }) {
  const recipe1 = asRecord(result.recipe1);
  const recipe2 = asRecord(result.recipe2);
  const rows = arrayValue(result.comparison);
  const differenceTone = (value: unknown): StatusBadgeTone => {
    const label = textValue(value);
    if (label.includes('仅配方1')) return 'amber';
    if (label.includes('仅配方2')) return 'blue';
    if (label.includes('型号')) return 'purple';
    if (label.includes('数量')) return 'orange';
    return 'red';
  };

  return (
    <>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {[recipe1, recipe2].map((recipe, index) => (
          <div key={index} className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-semibold text-ink">{textValue(recipe.name)}</div>
            <div className="mt-1 text-xs text-muted">{textValue(recipe.spec)}</div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted">成本</span>
              <span className="font-semibold text-ink">{money(recipe.cost) || textValue(recipe.cost)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted">零件数</span>
              <span className="font-semibold text-ink">{textValue(recipe.partsCount)}</span>
            </div>
          </div>
        ))}
      </div>
      <KeyValueRows rows={[{ label: '成本差额', value: money(result.costDiff) || result.costDiff }]} />
      <DataTable
        rows={rows}
        columns={[
          { key: 'name', label: '项目', render: (row) => textValue(row.name || row.model) },
          {
            key: 'difference',
            label: '差异',
            render: (row) => {
              const label = textValue(row.difference || row.onlyIn);
              return <StatusBadge tone={differenceTone(label)}>{label}</StatusBadge>;
            },
          },
          { key: 'model1', label: '配方1型号', render: (row) => textValue(row.model1) },
          { key: 'qty1', label: '配方1数量' },
          { key: 'amount1', label: '配方1金额', render: (row) => money(row.amount1) || textValue(row.amount1) },
          { key: 'model2', label: '配方2型号', render: (row) => textValue(row.model2) },
          { key: 'qty2', label: '配方2数量' },
          { key: 'amount2', label: '配方2金额', render: (row) => money(row.amount2) || textValue(row.amount2) },
          { key: 'diff', label: '差额', render: (row) => money(row.diff) || textValue(row.diff) },
        ]}
      />
    </>
  );
}

function RotorResult({ result }: { result: Record<string, unknown> }) {
  const templateInfo = asRecord(result.templateInfo);
  const params = asRecord(result.params);
  const history = arrayValue(result.history);
  if (history.length > 0) {
    return (
      <DataTable
        rows={history}
        columns={[
          { key: 'jobId', label: '任务' },
          { key: 'status', label: '状态' },
          { key: 'input', label: '输入' },
          { key: 'createdAt', label: '时间', render: (row) => dateText(row.createdAt) },
        ]}
      />
    );
  }
  return (
    <>
      <KeyValueRows rows={[
        { label: '任务 ID', value: result.jobId },
        { label: '状态', value: result.message },
        { label: '模板', value: templateInfo.model },
        { label: '机筒长度', value: templateInfo.barrelLength },
        { label: '开档偏移', value: templateInfo.openOffset },
        { label: '状态接口', value: result.statusUrl },
      ]} />
      <MetricGrid metrics={pickMetrics(params)} />
    </>
  );
}

function GenericResult({ result }: { result: Record<string, unknown> }) {
  const source = unwrapResult(result);
  const metrics = pickMetrics(source);
  const rows = arrayValue(source.data || source.items || source.summary);
  return (
    <>
      <MetricGrid metrics={metrics} />
      <KeyValueRows rows={[
        { label: '消息', value: source.message || result.message },
        { label: '名称', value: source.name || source.model },
        { label: '状态', value: source.status },
        { label: '数量', value: source.count },
      ]} />
      {rows.length > 0 ? (
        <DataTable
          rows={rows}
          columns={[
            { key: 'name', label: '名称', render: (row) => textValue(row.name || row.model || row.recipeName || row.customer || row.id) },
            { key: 'category', label: '类别' },
            { key: 'price', label: '价格', render: (row) => money(row.price ?? row.cost ?? row.totalCost) || textValue(row.price ?? row.cost ?? row.totalCost) },
            { key: 'status', label: '状态' },
          ]}
        />
      ) : null}
    </>
  );
}

function BusinessResult({ item }: { item: AiToolResult }) {
  const result = asRecord(item.result);
  if (result.success === false) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <span>{textValue(result.error, '执行失败')}</span>
      </div>
    );
  }

  if (['get_all_parts', 'search_parts', 'create_part', 'update_part', 'batch_update_prices'].includes(item.name)) {
    return <PartsResult name={item.name} result={result} />;
  }
  if (['get_all_recipes', 'create_recipe', 'update_recipe', 'delete_recipe'].includes(item.name)) {
    return <RecipesResult result={result} />;
  }
  if (['query_recipe_cost_by_name', 'query_recipe_cost_by_id', 'full_calculate', 'calculate_coil_cost', 'dynamic_config_cost', 'get_copper_price'].includes(item.name)) {
    return <CostResult result={result} />;
  }
  if (item.name === 'compare_recipes') return <CompareResult result={result} />;
  if (item.name.includes('order') || item.name === 'generate_purchase_list') return <OrderResult name={item.name} result={result} />;
  if (item.name.includes('rotor') || item.name.includes('drawing') || item.name.includes('print')) return <RotorResult result={result} />;
  return <GenericResult result={result} />;
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

function applyStreamEvent(item: ChatItem, event: AiStreamEvent): ChatItem {
  if (event.type === 'status') return { ...item, status: event.status, statusMessage: event.message || '' };
  if (event.type === 'content') return { ...item, content: item.content + event.content, status: 'answering', statusMessage: '' };
  if (event.type === 'tool_plan') return { ...item, toolPlan: { summary: event.summary, steps: event.steps || [] } };
  if (event.type === 'tool_call') return { ...item, toolCalls: [...(item.toolCalls || []), { name: event.name, args: event.args }], status: 'calling', statusMessage: `调用 ${event.name}` };
  if (event.type === 'tool_result') return { ...item, toolResults: [...(item.toolResults || []), { name: event.name, result: event.result }] };
  if (event.type === 'detail') return { ...item, toolResults: event.toolResults || item.toolResults || [] };
  if (event.type === 'done') return { ...item, status: 'done', statusMessage: '' };
  if (event.type === 'error') return { ...item, status: 'error', statusMessage: event.message, content: item.content || event.message };
  return item;
}

function ToolResultCard({ item, onConfirmed, readOnly = false }: { item: AiToolResult; onConfirmed: (next: AiToolResult) => void; readOnly?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const result = item.result;

  if (isConfirmationResult(result)) {
    const confirmation = result.confirmation;
    async function handleConfirm() {
      if (!confirmation?.toolName) return;
      try {
        setConfirming(true);
        setError('');
        const next = await confirmAiTool(confirmation.toolName, confirmation.args || {});
        onConfirmed(next);
      } catch (err) {
        setError((err as Error).message || '确认执行失败');
      } finally {
        setConfirming(false);
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
            {Array.isArray(confirmation?.rows) && confirmation.rows.length > 0 ? (
              <div className="mt-2 grid gap-1 text-xs text-amber-950 sm:grid-cols-2">
                {confirmation.rows.map((row, index) => (
                  <div key={`${row.label}-${index}`} className="flex min-w-0 justify-between gap-3 rounded-md border border-amber-200/80 bg-white/70 px-2 py-1">
                    <span className="text-amber-700">{row.label}</span>
                    <span className="truncate font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {confirmation?.warning ? <div className="mt-2 text-xs text-amber-800">{confirmation.warning}</div> : null}
            {error ? <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</div> : null}
            <div className="mt-3 flex justify-end">
              {readOnly ? (
                <span className="text-xs text-amber-700">历史记录，仅供查看</span>
              ) : (
                <Button size="sm" variant="primary" onClick={handleConfirm} disabled={confirming} icon={confirming ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}>
                  确认执行
                </Button>
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
        <BusinessResult item={item} />
        <RawDetails result={result} />
      </div>
    </details>
  );
}

type AiViewProps = {
  variant?: 'workspace' | 'panel';
  onClose?: () => void;
};

export function AiView({ variant = 'workspace', onClose }: AiViewProps = {}) {
  const isPanel = variant === 'panel';
  const router = useRouter();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [asideMode, setAsideMode] = useState<AsideMode>('history');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeSampleCategory, setActiveSampleCategory] = useState<SampleCategory>('常用');
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [openingConversationId, setOpeningConversationId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiConversationSummary | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<number, AiAnswerFeedback>>({});
  const [feedbackTarget, setFeedbackTarget] = useState<ChatItem | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<Exclude<AiAnswerFeedbackRating, 'helpful'>>('incorrect');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [knowledgeSyncOpen, setKnowledgeSyncOpen] = useState(false);
  const [knowledgeSyncing, setKnowledgeSyncing] = useState(false);
  const [knowledgeSyncResult, setKnowledgeSyncResult] = useState<KnowledgeSyncStats | null>(null);
  const [knowledgeSyncError, setKnowledgeSyncError] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechBaseInputRef = useRef('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const apiMessages = useMemo<AiChatMessage[]>(() => (
    items
      .filter((item) => item.role === 'user' || (item.role === 'assistant' && item.content.trim()))
      .map((item) => ({ role: item.role, content: item.content }))
  ), [items]);
  const visibleSamples = useMemo(() => (
    samples.filter((sample) => sample.category === activeSampleCategory)
  ), [activeSampleCategory]);

  function updateAssistant(id: string, updater: (item: ChatItem) => ChatItem) {
    setItems((current) => current.map((item) => (item.id === id ? updater(item) : item)));
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items]);

  useEffect(() => {
    let active = true;
    void listAiConversations()
      .then((rows) => {
        if (active) setConversations(rows);
      })
      .catch((error) => {
        if (active) setHistoryError((error as Error).message || '读取会话历史失败');
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognitionConstructor()));
    return () => {
      const recognition = speechRecognitionRef.current;
      if (recognition) {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      }
      speechRecognitionRef.current = null;
    };
  }, []);

  function stopVoiceInput() {
    speechRecognitionRef.current?.stop();
  }

  function toggleVoiceInput() {
    if (isListening) {
      stopVoiceInput();
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setSpeechError('当前浏览器不支持语音输入，请使用 Chrome、Edge 或 Safari。');
      return;
    }

    const recognition = new Recognition();
    speechRecognitionRef.current = recognition;
    speechBaseInputRef.current = input;
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => {
      setSpeechError('');
      setIsListening(true);
    };
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript || '';
      }
      setInput(appendSpeechTranscript(speechBaseInputRef.current, transcript));
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') setSpeechError(speechErrorMessage(event.error));
    };
    recognition.onend = () => {
      setIsListening(false);
      speechRecognitionRef.current = null;
    };

    try {
      recognition.start();
    } catch {
      speechRecognitionRef.current = null;
      setIsListening(false);
      setSpeechError('麦克风启动失败，请重试。');
    }
  }

  async function refreshConversationList() {
    try {
      setConversations(await listAiConversations());
      setHistoryError('');
    } catch (error) {
      setHistoryError((error as Error).message || '读取会话历史失败');
    }
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    if (isListening) stopVoiceInput();

    const userItem: ChatItem = { id: makeId(), role: 'user', content };
    const assistantId = makeId();
    const assistantItem: ChatItem = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'thinking',
      statusMessage: '正在理解问题...',
      toolCalls: [],
      toolResults: [],
    };

    const nextMessages = [...apiMessages, { role: 'user' as const, content }];
    setItems((current) => [...current, userItem, assistantItem]);
    setInput('');
    setLoading(true);

    let conversationId = activeConversationId;
    let finalAssistantItem = assistantItem;

    try {
      if (!conversationId) {
        const conversation = await createAiConversation(content);
        conversationId = conversation.id;
        setActiveConversationId(conversation.id);
        setConversations((current) => [conversation, ...current]);
      }
      await appendAiConversationMessage(conversationId, { role: 'user', content });
      setHistoryError('');
    } catch (error) {
      const message = (error as Error).message || '保存会话失败';
      updateAssistant(assistantId, (item) => ({ ...item, status: 'error', statusMessage: message, content: message }));
      setHistoryError(message);
      setLoading(false);
      return;
    }

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      await streamAiChat(nextMessages, (event) => {
        finalAssistantItem = applyStreamEvent(finalAssistantItem, event);
        updateAssistant(assistantId, (item) => applyStreamEvent(item, event));
      }, controller.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        finalAssistantItem = {
          ...finalAssistantItem,
          status: 'error',
          statusMessage: (err as Error).message || 'AI 请求失败',
          content: finalAssistantItem.content || 'AI 请求失败',
        };
        updateAssistant(assistantId, (item) => ({
          ...item,
          status: 'error',
          statusMessage: (err as Error).message || 'AI 请求失败',
          content: item.content || 'AI 请求失败',
        }));
      }
    } finally {
      if (conversationId && finalAssistantItem.content.trim()) {
        try {
          const saved = await appendAiConversationMessage(conversationId, {
            role: 'assistant',
            content: finalAssistantItem.content,
            metadata: {
              toolPlan: finalAssistantItem.toolPlan,
              toolCalls: finalAssistantItem.toolCalls,
              toolResults: finalAssistantItem.toolResults,
            },
          });
          updateAssistant(assistantId, (item) => ({ ...item, persistedMessageId: saved.id }));
          await refreshConversationList();
        } catch (error) {
          setHistoryError((error as Error).message || '保存 AI 回复失败');
        }
      }
      setLoading(false);
      abortRef.current = null;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleStop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  function replaceToolResult(messageId: string, oldIndex: number, next: AiToolResult) {
    const currentItem = items.find((item) => item.id === messageId);
    const toolResults = (currentItem?.toolResults || []).map((tool, index) => (index === oldIndex ? next : tool));
    updateAssistant(messageId, (item) => ({ ...item, toolResults }));
    if (activeConversationId && currentItem?.persistedMessageId) {
      void updateAiConversationMessage(activeConversationId, currentItem.persistedMessageId, {
        toolPlan: currentItem.toolPlan,
        toolCalls: currentItem.toolCalls,
        toolResults,
      }).catch((error) => setHistoryError((error as Error).message || '更新会话记录失败'));
    }
  }

  function startNewConversation() {
    if (loading) return;
    if (isListening) stopVoiceInput();
    setActiveConversationId(null);
    setItems([]);
    setFeedbackByMessageId({});
    setInput('');
    setAsideMode('history');
    setMobileSidebarOpen(false);
  }

  async function openConversation(id: number) {
    if (loading || openingConversationId) return;
    setOpeningConversationId(id);
    setHistoryError('');
    try {
      const [conversation, feedback] = await Promise.all([
        getAiConversation(id),
        listAiAnswerFeedback({ conversationId: id }),
      ]);
      setActiveConversationId(conversation.id);
      setFeedbackByMessageId(Object.fromEntries(feedback.items.map(item => [item.messageId, item])));
      setItems(conversation.messages.map((message) => ({
        id: `saved-${message.id}`,
        role: message.role,
        content: message.content,
        status: 'done',
        toolPlan: message.metadata?.toolPlan,
        toolCalls: message.metadata?.toolCalls || [],
        toolResults: message.metadata?.toolResults || [],
        persistedMessageId: message.id,
        historical: true,
      })));
      setMobileSidebarOpen(false);
    } catch (error) {
      setHistoryError((error as Error).message || '读取会话失败');
    } finally {
      setOpeningConversationId(null);
    }
  }

  async function markAnswerHelpful(item: ChatItem) {
    if (!item.persistedMessageId || feedbackSaving) return;
    setFeedbackSaving(true);
    setFeedbackError('');
    try {
      const feedback = await submitAiAnswerFeedback({
        messageId: item.persistedMessageId,
        rating: 'helpful',
      });
      setFeedbackByMessageId(current => ({ ...current, [feedback.messageId]: feedback }));
    } catch (error) {
      const message = (error as Error).message || '保存反馈失败';
      setFeedbackError(message);
      setHistoryError(message);
    } finally {
      setFeedbackSaving(false);
    }
  }

  function openAnswerIssue(item: ChatItem) {
    const existing = item.persistedMessageId ? feedbackByMessageId[item.persistedMessageId] : undefined;
    const issueRating = existing?.rating !== 'helpful' ? existing?.rating : undefined;
    setFeedbackTarget(item);
    setFeedbackRating(issueRating || 'incorrect');
    setFeedbackNote(existing?.note || '');
    setFeedbackError('');
  }

  async function saveAnswerIssue() {
    if (!feedbackTarget?.persistedMessageId || feedbackSaving) return;
    setFeedbackSaving(true);
    setFeedbackError('');
    try {
      const feedback = await submitAiAnswerFeedback({
        messageId: feedbackTarget.persistedMessageId,
        rating: feedbackRating,
        note: feedbackNote,
      });
      setFeedbackByMessageId(current => ({ ...current, [feedback.messageId]: feedback }));
      setFeedbackTarget(null);
    } catch (error) {
      setFeedbackError((error as Error).message || '保存反馈失败');
    } finally {
      setFeedbackSaving(false);
    }
  }

  async function confirmDeleteConversation() {
    if (!deleteTarget) return;
    setDeletingConversation(true);
    try {
      await deleteAiConversation(deleteTarget.id);
      if (activeConversationId === deleteTarget.id) startNewConversation();
      setDeleteTarget(null);
      await refreshConversationList();
    } catch (error) {
      setHistoryError((error as Error).message || '删除会话失败');
    } finally {
      setDeletingConversation(false);
    }
  }

  async function openPromptEditor() {
    setPromptOpen(true);
    setPromptLoading(true);
    setPromptError('');
    try {
      setPromptDraft(await getAiSystemPrompt());
    } catch (error) {
      setPromptError((error as Error).message || '读取提示词失败');
    } finally {
      setPromptLoading(false);
    }
  }

  async function savePrompt() {
    const prompt = promptDraft.trim();
    if (!prompt) {
      setPromptError('提示词不能为空');
      return;
    }
    setPromptSaving(true);
    setPromptError('');
    try {
      await updateAiSystemPrompt(prompt);
      setPromptDraft(prompt);
      setPromptOpen(false);
    } catch (error) {
      setPromptError((error as Error).message || '保存提示词失败');
    } finally {
      setPromptSaving(false);
    }
  }

  function openKnowledgeSync() {
    setKnowledgeSyncResult(null);
    setKnowledgeSyncError('');
    setKnowledgeSyncOpen(true);
  }

  async function runKnowledgeSync() {
    setKnowledgeSyncing(true);
    setKnowledgeSyncError('');
    try {
      setKnowledgeSyncResult(await syncFactoryKnowledge());
    } catch (error) {
      setKnowledgeSyncError((error as Error).message || '知识库同步失败');
    } finally {
      setKnowledgeSyncing(false);
    }
  }

  return (
    <div className={`min-h-0 bg-white ${isPanel ? 'h-full' : 'lg:bg-transparent'}`}>
      <FadePanel className={`flex min-h-0 flex-col overflow-hidden border-0 bg-white shadow-none ${isPanel ? 'h-full xl:rounded-panel xl:border xl:border-line xl:shadow-panel' : 'h-[100dvh] md:h-[calc(100vh-8rem)] md:min-h-[620px] md:rounded-panel md:border md:border-line md:shadow-panel'}`}>
        <div className={`ai-mobile-header h-auto shrink-0 items-center justify-between border-b border-line bg-white px-3 pb-2 ${isPanel ? 'flex xl:pt-2' : 'flex lg:hidden'}`}>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 px-0"
            icon={<PanelLeft size={19} />}
            aria-label="打开会话记录"
            title="会话记录"
            onClick={() => setMobileSidebarOpen(true)}
          />
          <div className="min-w-0 flex-1 px-2 text-center">
            <div className="truncate text-sm font-semibold text-ink">
              {conversations.find((conversation) => conversation.id === activeConversationId)?.title || (isPanel ? '业务 AI 助手' : 'AI 工作台')}
            </div>
            <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[11px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              DeepSeek
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isPanel ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0"
                icon={<Database size={17} />}
                aria-label="同步知识库"
                title="同步知识库"
                onClick={openKnowledgeSync}
                disabled={knowledgeSyncing}
              />
            ) : null}
            {isPanel ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0"
                icon={<Maximize2 size={17} />}
                aria-label="进入 AI 工作台"
                title="进入 AI 工作台"
                onClick={() => router.push('/ai')}
              />
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0"
              icon={<Plus size={19} />}
              aria-label="新建会话"
              title="新建会话"
              onClick={startNewConversation}
              disabled={loading}
            />
            {isPanel && onClose ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0 xl:hidden"
                icon={<X size={18} />}
                aria-label="关闭 AI 助手"
                title="关闭"
                onClick={onClose}
              />
            ) : null}
          </div>
        </div>

        <div className={`${isPanel ? 'hidden' : 'hidden lg:flex'} shrink-0 flex-wrap items-center justify-between gap-4 border-b border-line bg-slate-50 px-5 py-4`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-ink text-white">
              <Sparkles size={20} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
                <span>DeepSeek V4 Flash</span>
                <span className="h-1 w-1 rounded-full bg-emerald-500" />
                <span>AI Executor</span>
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal text-ink">AI 工作台</h1>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" icon={<Pencil size={15} />} onClick={() => void openPromptEditor()} disabled={promptLoading || promptSaving}>
              提示词
            </Button>
            <Button variant="ghost" size="sm" icon={<Plus size={15} />} onClick={startNewConversation} disabled={loading}>
              新会话
            </Button>
          </div>
        </div>

        <div className={`grid min-h-0 min-w-0 flex-1 ${isPanel ? '' : 'lg:grid-cols-[310px_minmax(0,1fr)]'}`}>
          <aside className={`${isPanel ? 'hidden' : 'hidden lg:flex'} min-h-0 min-w-0 flex-col border-r border-line bg-white p-4`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                {asideMode === 'history' ? <History size={16} /> : <MessageSquareText size={16} />}
                {asideMode === 'history' ? '会话记录' : '任务模板'}
              </div>
              <SegmentedControl value={asideMode} options={asideModeOptions} onChange={setAsideMode} ariaLabel="AI 侧栏内容" />
            </div>

            {asideMode === 'history' ? (
              <div className="min-h-0">
                <Button variant="secondary" size="sm" className="mb-2 w-full" icon={<Plus size={15} />} onClick={startNewConversation} disabled={loading}>
                  新建会话
                </Button>
                {historyError ? (
                  <div className="mb-2 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{historyError}</span>
                  </div>
                ) : null}
                <div className="max-h-48 space-y-1 overflow-y-auto pr-1 lg:max-h-[calc(100vh-19rem)]">
                  {historyLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted"><Loader2 size={15} className="animate-spin" />正在读取</div>
                  ) : conversations.length === 0 ? (
                    <div className="rounded-md border border-dashed border-line px-3 py-5 text-center text-sm text-muted">暂无历史会话</div>
                  ) : conversations.map((conversation) => (
                    <div key={conversation.id} className={`group flex items-center gap-1 rounded-md border p-1 ${activeConversationId === conversation.id ? 'border-slate-300 bg-slate-100' : 'border-transparent hover:bg-slate-50'}`}>
                      <button
                        type="button"
                        onClick={() => void openConversation(conversation.id)}
                        disabled={loading || openingConversationId !== null}
                        className="min-w-0 flex-1 rounded px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="flex items-center gap-2">
                          {openingConversationId === conversation.id ? <Loader2 size={13} className="shrink-0 animate-spin text-muted" /> : <MessageSquareText size={13} className="shrink-0 text-muted" />}
                          <span className="truncate text-sm font-medium text-ink">{conversation.title}</span>
                        </span>
                        <span className="mt-1 block truncate pl-5 text-xs text-muted">{conversation.messageCount} 条 · {dateText(conversation.updatedAt)}</span>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-8 px-0 text-slate-400 hover:text-rose-600"
                        icon={<Trash2 size={14} />}
                        aria-label={`删除会话 ${conversation.title}`}
                        title="删除会话"
                        onClick={() => setDeleteTarget(conversation)}
                        disabled={loading}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="min-h-0">
                <SegmentedControl value={activeSampleCategory} options={sampleCategoryOptions} onChange={setActiveSampleCategory} ariaLabel="AI 任务模板分类" />
                <div className="-mx-1 mt-3 flex max-w-full gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:grid lg:max-h-[calc(100vh-21rem)] lg:grid-cols-1 lg:overflow-y-auto lg:px-0 lg:pb-0">
                  {visibleSamples.map((sample) => {
                    const Icon = sample.icon;
                    return (
                      <button
                        key={sample.prompt}
                        type="button"
                        onClick={() => void sendMessage(sample.prompt)}
                        disabled={loading}
                        className="group flex min-h-14 min-w-[190px] items-center gap-3 rounded-panel border border-line bg-slate-50 px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-16 lg:min-w-0"
                      >
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 group-hover:text-ink"><Icon size={17} /></span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium text-ink">{sample.label}</span>
                            <StatusBadge tone={sample.mode === 'write' ? 'amber' : 'blue'} className="h-5 min-w-0 px-1.5">{sample.mode === 'write' ? '确认' : '只读'}</StatusBadge>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted">{sample.prompt}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col bg-white md:bg-slate-50">
            <div ref={scrollRef} className={`flex-1 overflow-y-auto ${isPanel ? 'space-y-4 px-3 py-4' : 'space-y-5 px-4 py-5 md:space-y-4 md:p-5'}`}>
              {items.length === 0 ? (
                <div className={`flex h-full items-center justify-center ${isPanel ? 'min-h-[220px]' : 'min-h-[220px] md:min-h-[360px]'}`}>
                  <div className={`w-full max-w-lg px-2 py-7 text-center ${isPanel ? '' : 'md:rounded-panel md:border md:border-dashed md:border-slate-300 md:bg-white md:px-6 md:shadow-panel'}`}>
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-ink text-white">
                      <Bot size={22} />
                    </div>
                    <div className="mt-4 text-lg font-semibold text-ink">有什么可以帮你？</div>
                    <div className={`${isPanel ? 'flex' : 'hidden md:flex'} mt-2 items-center justify-center gap-2 text-sm leading-6 text-muted`}>
                      <span>可以先从</span>
                      <TextLoop words={textLoopWords} />
                      <span>开始</span>
                    </div>
                    <div className={`mx-auto mt-6 max-w-sm gap-2 ${isPanel ? 'grid' : 'grid md:hidden'}`}>
                      {samples.filter((sample) => sample.category === '常用').slice(0, 2).map((sample) => (
                        <button key={sample.prompt} type="button" onClick={() => void sendMessage(sample.prompt)} disabled={loading} className="min-h-11 rounded-md border border-line bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-panel disabled:opacity-60">
                          {sample.prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {items.map((item) => {
                const answerFeedback = item.persistedMessageId ? feedbackByMessageId[item.persistedMessageId] : undefined;
                return (
                <div key={item.id} className={item.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={`text-ink ${isPanel ? 'max-w-[94%]' : 'max-w-[940px]'} ${item.role === 'user' ? 'rounded-2xl bg-slate-100 px-3 py-2.5 md:rounded-panel md:border md:border-ink md:bg-ink md:p-3 md:text-white md:shadow-panel' : 'w-full bg-transparent md:w-auto md:rounded-panel md:border md:border-line md:bg-white md:p-3 md:shadow-panel'}`}>
                    <div className={`mb-2 flex items-center gap-2 text-xs font-medium ${item.role === 'user' ? 'text-muted md:text-slate-200' : 'text-muted'} ${item.role === 'user' ? 'hidden md:flex' : ''}`}>
                      <span className={`hidden h-6 w-6 items-center justify-center rounded-md md:inline-flex ${item.role === 'user' ? 'bg-white/10' : 'bg-slate-100 text-slate-600'}`}>
                        {item.role === 'user' ? <UserRound size={14} /> : <Bot size={14} />}
                      </span>
                      <span>{item.role === 'user' ? '你' : 'AI'}</span>
                      {item.status && item.status !== 'done' ? (
                        <StatusBadge tone="custom" className={`h-6 min-w-0 border-transparent px-2 ${item.role === 'user' ? 'bg-white/10 text-slate-100' : 'bg-slate-100 text-slate-600'}`}>
                          {item.statusMessage || item.status}
                        </StatusBadge>
                      ) : null}
                    </div>
                    {item.content ? (
                      item.role === 'assistant'
                        ? <StreamingText id={item.id} text={item.content} streaming={loading && !['done', 'error', 'confirming', 'cancelled'].includes(item.status || 'idle')} />
                        : <div className="whitespace-pre-wrap text-sm leading-6">{item.content}</div>
                    ) : null}
                    {item.role === 'assistant' && item.toolResults?.length ? (
                      <AnswerEvidence toolResults={item.toolResults} />
                    ) : null}
                    {item.role === 'assistant' && loading && item.status !== 'done' && !item.content ? (
                      <div className="flex items-center gap-2 text-sm text-muted">
                        <Loader2 size={15} className="animate-spin" />
                        {item.statusMessage || '处理中...'}
                      </div>
                    ) : null}
                    {item.role === 'assistant' && item.toolPlan ? (
                      <ToolPlanPanel plan={item.toolPlan} />
                    ) : null}
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
                    {item.toolResults && item.toolResults.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {item.toolResults.map((tool, index) => (
                          <ToolResultCard key={`${tool.name}-${index}`} item={tool} readOnly={item.historical} onConfirmed={(next) => replaceToolResult(item.id, index, next)} />
                        ))}
                      </div>
                    ) : null}
                    {item.role === 'assistant' && item.persistedMessageId && item.status !== 'error' ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                        <span className="text-xs text-muted">这条回答是否可靠？</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-8 px-2 text-xs ${answerFeedback?.rating === 'helpful' ? 'bg-emerald-50 text-emerald-700' : ''}`}
                          icon={<ThumbsUp size={14} />}
                          onClick={() => void markAnswerHelpful(item)}
                          disabled={feedbackSaving}
                        >
                          {answerFeedback?.rating === 'helpful' ? '已标记准确' : '准确'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-8 px-2 text-xs ${answerFeedback && answerFeedback.rating !== 'helpful' ? 'bg-amber-50 text-amber-800' : ''}`}
                          icon={<MessageSquareWarning size={14} />}
                          onClick={() => openAnswerIssue(item)}
                          disabled={feedbackSaving}
                        >
                          {answerFeedback && answerFeedback.rating !== 'helpful' ? '已报告问题' : '报告问题'}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
                );
              })}
            </div>

            <form onSubmit={handleSubmit} className={`ai-mobile-composer shrink-0 border-t border-line bg-white ${isPanel ? 'px-3 pt-2 xl:p-3' : 'px-3 pt-2 md:p-4'}`}>
              <div className="flex items-end gap-2 rounded-2xl border border-line bg-slate-50 p-1.5 shadow-panel md:rounded-panel md:p-2">
                <textarea
                  value={input}
                  onChange={(event) => {
                    if (isListening) stopVoiceInput();
                    setInput(event.target.value);
                  }}
                  placeholder="输入要查询或处理的事情..."
                  rows={1}
                  className="max-h-28 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-base leading-6 text-ink outline-none placeholder:text-slate-400 md:min-h-11 md:text-sm"
                  disabled={loading}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage(input);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className={`h-10 w-10 shrink-0 rounded-full px-0 md:h-9 md:w-9 ${isListening ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100' : ''}`}
                  icon={isListening ? <MicOff size={17} /> : <Mic size={17} />}
                  onClick={toggleVoiceInput}
                  disabled={loading || !speechSupported}
                  aria-label={isListening ? '停止语音输入' : '开始语音输入'}
                  aria-pressed={isListening}
                  title={speechSupported ? (isListening ? '停止语音输入' : '语音输入') : '当前浏览器不支持语音输入'}
                />
                {loading ? (
                  <Button variant="secondary" className="h-10 w-10 rounded-full px-0 md:h-9 md:w-auto md:rounded-md md:px-3" icon={<X size={16} />} onClick={handleStop} aria-label="停止">
                    <span className="hidden md:inline">停止</span>
                  </Button>
                ) : (
                  <Button type="submit" variant="primary" className="h-10 w-10 rounded-full px-0 md:h-9 md:w-auto md:rounded-md md:px-3" icon={<Send size={16} />} disabled={!input.trim()} aria-label="发送">
                    <span className="hidden md:inline">发送</span>
                  </Button>
                )}
              </div>
              {isListening || speechError ? (
                <div className="px-2 pt-1.5 text-xs text-rose-600">
                  {speechError || '正在聆听…再次点击麦克风结束'}
                </div>
              ) : null}
            </form>
          </section>
        </div>
      </FadePanel>

      <AnimatePresence>
        {mobileSidebarOpen ? (
          <div className={`fixed inset-0 z-40 ${isPanel ? '' : 'lg:hidden'}`}>
            <motion.button
              type="button"
              aria-label="关闭会话记录"
              className="absolute inset-0 bg-black/25"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileSidebarOpen(false)}
            />
            <motion.aside
              className="ai-mobile-drawer absolute inset-y-0 left-0 flex w-[86vw] max-w-[340px] flex-col border-r border-line bg-white px-3 shadow-xl"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            >
              <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">AI 工作台</div>
                  <div className="mt-0.5 text-xs text-muted">会话记录</div>
                </div>
                <Button variant="ghost" size="sm" className="h-9 w-9 px-0" icon={<X size={17} />} aria-label="关闭" title="关闭" onClick={() => setMobileSidebarOpen(false)} />
              </div>

              <Button variant="secondary" className="mt-3 w-full" icon={<Plus size={16} />} onClick={startNewConversation} disabled={loading}>
                新建会话
              </Button>

              {historyError ? (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{historyError}</span>
                </div>
              ) : null}

              <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
                {historyLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted"><Loader2 size={15} className="animate-spin" />正在读取</div>
                ) : conversations.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-muted">暂无历史会话</div>
                ) : conversations.map((conversation) => (
                  <div key={`mobile-${conversation.id}`} className={`flex items-center gap-1 rounded-md p-1 ${activeConversationId === conversation.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                    <button type="button" onClick={() => void openConversation(conversation.id)} disabled={loading || openingConversationId !== null} className="min-w-0 flex-1 rounded px-2 py-2 text-left disabled:opacity-60">
                      <span className="flex items-center gap-2">
                        {openingConversationId === conversation.id ? <Loader2 size={14} className="shrink-0 animate-spin text-muted" /> : <MessageSquareText size={14} className="shrink-0 text-muted" />}
                        <span className="truncate text-sm font-medium text-ink">{conversation.title}</span>
                      </span>
                      <span className="mt-1 block truncate pl-5 text-xs text-muted">{conversation.messageCount} 条 · {dateText(conversation.updatedAt)}</span>
                    </button>
                    <Button variant="ghost" size="sm" className="h-9 w-9 px-0 text-slate-400 hover:text-rose-600" icon={<Trash2 size={14} />} aria-label={`删除会话 ${conversation.title}`} title="删除会话" onClick={() => { setMobileSidebarOpen(false); setDeleteTarget(conversation); }} disabled={loading} />
                  </div>
                ))}
              </div>

              <div className="border-t border-line pt-2">
                <Button variant="ghost" className="w-full justify-start" icon={<Pencil size={16} />} onClick={() => { setMobileSidebarOpen(false); void openPromptEditor(); }} disabled={promptLoading || promptSaving}>
                  编辑提示词
                </Button>
              </div>
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      {feedbackTarget ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/25 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="answer-feedback-title" className="w-full max-w-lg rounded-panel border border-line bg-white shadow-panel">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <h2 id="answer-feedback-title" className="text-base font-semibold text-ink">报告回答问题</h2>
                <div className="mt-1 text-xs text-muted">反馈会进入知识库管理中心，不会自动修改业务数据。</div>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={16} />} aria-label="关闭" onClick={() => setFeedbackTarget(null)} disabled={feedbackSaving} />
            </div>
            <div className="space-y-4 p-4">
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="问题类型">
                {([
                  ['incorrect', '内容错误'],
                  ['outdated', '来源过期'],
                  ['missing_source', '资料不足'],
                ] as Array<[Exclude<AiAnswerFeedbackRating, 'helpful'>, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={feedbackRating === value}
                    onClick={() => setFeedbackRating(value)}
                    className={`h-10 rounded-md border px-3 text-sm font-medium ${
                      feedbackRating === value ? 'border-ink bg-ink text-white' : 'border-line bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="text-xs font-medium text-muted">补充说明（可选）</span>
                <textarea
                  value={feedbackNote}
                  onChange={event => setFeedbackNote(event.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder="例如：正确价格应为 93 元，业务数据已于今天更新。"
                  className="mt-2 w-full resize-y rounded-md border border-line bg-slate-50 px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-slate-400"
                  disabled={feedbackSaving}
                />
              </label>
              {feedbackError ? (
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  {feedbackError}
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="ghost" onClick={() => setFeedbackTarget(null)} disabled={feedbackSaving}>取消</Button>
              <Button variant="primary" icon={feedbackSaving ? <Loader2 size={15} className="animate-spin" /> : <MessageSquareWarning size={15} />} onClick={() => void saveAnswerIssue()} disabled={feedbackSaving}>
                {feedbackSaving ? '提交中' : '提交反馈'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title" className="w-full max-w-md rounded-panel border border-line bg-white shadow-panel">
            <div className="border-b border-line px-4 py-3">
              <h2 id="delete-conversation-title" className="text-base font-semibold text-ink">删除会话</h2>
            </div>
            <div className="p-4">
              <p className="text-sm leading-6 text-slate-700">确定删除“{deleteTarget.title}”及其历史记录吗？</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deletingConversation}>取消</Button>
              <Button variant="danger" icon={deletingConversation ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} onClick={() => void confirmDeleteConversation()} disabled={deletingConversation}>
                {deletingConversation ? '删除中' : '删除'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {knowledgeSyncOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="knowledge-sync-title" className="w-full max-w-md rounded-panel border border-line bg-white shadow-panel">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <h2 id="knowledge-sync-title" className="text-base font-semibold text-ink">同步工厂知识库</h2>
                <div className="mt-1 text-xs text-muted">从当前业务数据库刷新 AI 检索条目</div>
              </div>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={16} />} aria-label="关闭" title="关闭" onClick={() => setKnowledgeSyncOpen(false)} disabled={knowledgeSyncing} />
            </div>
            <div className="p-4">
              {knowledgeSyncResult ? (
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <Check size={16} />
                    同步完成，共 {knowledgeSyncResult.total} 条知识
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div className="rounded-md border border-line bg-slate-50 p-2 text-center"><div className="font-semibold text-ink">{knowledgeSyncResult.inserted}</div><div className="mt-1 text-xs text-muted">新增</div></div>
                    <div className="rounded-md border border-line bg-slate-50 p-2 text-center"><div className="font-semibold text-ink">{knowledgeSyncResult.updated}</div><div className="mt-1 text-xs text-muted">更新</div></div>
                    <div className="rounded-md border border-line bg-slate-50 p-2 text-center"><div className="font-semibold text-ink">{knowledgeSyncResult.deleted}</div><div className="mt-1 text-xs text-muted">移除</div></div>
                    <div className="rounded-md border border-line bg-slate-50 p-2 text-center"><div className="font-semibold text-ink">{knowledgeSyncResult.unchanged}</div><div className="mt-1 text-xs text-muted">未变化</div></div>
                  </div>
                </div>
              ) : (
                <div className="text-sm leading-6 text-slate-700">
                  同步会读取零件、模板、配方、线圈、客户、报价、订单、质量问题和业务规则，增量更新 AI 使用的知识索引，不会修改原始业务数据。
                </div>
              )}
              {knowledgeSyncError ? (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  {knowledgeSyncError}
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              {knowledgeSyncResult ? (
                <Button variant="primary" onClick={() => setKnowledgeSyncOpen(false)}>完成</Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => setKnowledgeSyncOpen(false)} disabled={knowledgeSyncing}>取消</Button>
                  <Button variant="primary" icon={knowledgeSyncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} onClick={() => void runKnowledgeSync()} disabled={knowledgeSyncing}>
                    {knowledgeSyncing ? '同步中' : '确认同步'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {promptOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !promptSaving) setPromptOpen(false);
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="ai-prompt-title" className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-panel border border-line bg-white shadow-panel">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 id="ai-prompt-title" className="text-base font-semibold text-ink">编辑系统提示词</h2>
              <Button
                variant="ghost"
                size="sm"
                className="w-8 px-0"
                icon={<X size={16} />}
                aria-label="关闭"
                title="关闭"
                onClick={() => setPromptOpen(false)}
                disabled={promptSaving}
              />
            </div>
            <div className="min-h-0 flex-1 p-4">
              {promptLoading ? (
                <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-muted">
                  <Loader2 size={16} className="animate-spin" />
                  正在读取提示词
                </div>
              ) : (
                <textarea
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                  aria-label="系统提示词"
                  autoFocus
                  className="h-[min(58vh,560px)] min-h-72 w-full resize-y rounded-md border border-line bg-slate-50 px-3 py-3 font-mono text-sm leading-6 text-ink outline-none transition-colors focus:border-slate-400"
                  disabled={promptSaving}
                />
              )}
              {promptError ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-rose-600">
                  <AlertCircle size={15} />
                  {promptError}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
              <Button variant="ghost" onClick={() => setPromptOpen(false)} disabled={promptSaving}>取消</Button>
              <Button variant="primary" icon={promptSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} onClick={() => void savePrompt()} disabled={promptLoading || promptSaving || !promptDraft.trim()}>
                {promptSaving ? '保存中' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
