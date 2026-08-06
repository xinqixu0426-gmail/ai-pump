import type {
  KnowledgeChange,
  KnowledgeChangeStatus,
  KnowledgeDocumentType,
  KnowledgeEntryType,
} from '@/lib/knowledge';
import type { AiAnswerFeedback } from '@/lib/ai';
import type { StatusBadgeTone } from '@/components/ui/status-badge';

export type KnowledgeStatusFilter = 'all' | 'fresh' | 'pending';
export type KnowledgeWorkspace = 'overview' | 'sources' | 'entries' | 'ai';

export type KnowledgeDisplayItem = {
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

export const ENTRY_TYPE_OPTIONS: Array<{ value: KnowledgeEntryType | ''; label: string }> = [
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

export const ENTRY_TYPE_LABELS = Object.fromEntries(
  ENTRY_TYPE_OPTIONS.filter(option => option.value).map(option => [option.value, option.label])
) as Record<KnowledgeEntryType, string>;

export const STATUS_META: Record<'fresh' | KnowledgeChangeStatus, { label: string; tone: StatusBadgeTone }> = {
  fresh: { label: '最新', tone: 'green' },
  pending_insert: { label: '待新增', tone: 'blue' },
  pending_update: { label: '待更新', tone: 'amber' },
  pending_delete: { label: '待移除', tone: 'red' },
};

export const SYNC_MODE_LABELS = {
  automatic: '自动同步',
  flush: '即时同步',
  manual: '手动同步',
} as const;

export const DOCUMENT_TYPE_OPTIONS: Array<{ value: KnowledgeDocumentType; label: string }> = [
  { value: 'technical_note', label: '技术说明' },
  { value: 'pump_performance_test', label: '性能测试报告' },
  { value: 'drawing', label: '图纸' },
  { value: 'spreadsheet', label: 'Excel 资料' },
  { value: 'other', label: '其他资料' },
];

export const FEEDBACK_LABELS: Record<Exclude<AiAnswerFeedback['rating'], 'helpful'>, string> = {
  incorrect: '内容错误',
  outdated: '来源过期',
  missing_source: '资料不足',
};

export const KNOWLEDGE_PAGE_SIZE = 30;
export const KNOWLEDGE_WORKSPACES: Array<{ value: KnowledgeWorkspace; label: string }> = [
  { value: 'overview', label: '运行概况' },
  { value: 'sources', label: '来源同步' },
  { value: 'entries', label: '知识条目' },
  { value: 'ai', label: 'AI 治理' },
];

export const SOURCE_PATHS: Record<string, string> = {
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
  factory_ai_rules: '/dashboard?view=knowledge',
};

export function sourceKey(item: { sourceTable: string; sourceId: string }) {
  return `${item.sourceTable}\u0000${item.sourceId}`;
}

export function dateTime(value: string | null | undefined) {
  if (!value) return '尚未同步';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function matchesChange(change: KnowledgeChange, query: string, entryType: KnowledgeEntryType | '') {
  if (entryType && change.entryType !== entryType) return false;
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return true;
  return `${change.title}\n${change.summary}\n${change.sourceId}`.toLocaleLowerCase().includes(keyword);
}
