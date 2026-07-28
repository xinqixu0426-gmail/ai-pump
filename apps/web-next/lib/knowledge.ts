'use client';

import { proxyRequest, type ApiResponse } from './api';

export type KnowledgeSyncStats = {
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
  byType: Record<string, number>;
};

export type KnowledgeEntryType =
  | 'part'
  | 'template'
  | 'recipe'
  | 'coil'
  | 'customer'
  | 'quotation'
  | 'order'
  | 'quality_issue'
  | 'business_rule'
  | 'document';

export type KnowledgeDocumentType =
  | 'technical_note'
  | 'pump_performance_test'
  | 'drawing'
  | 'spreadsheet'
  | 'other';

export type KnowledgeDocument = {
  id: number;
  documentType: KnowledgeDocumentType;
  title: string;
  description: string;
  contentText: string;
  tags: string[];
  originalName: string;
  mimeType: string;
  fileSize: number;
  fileSha256: string;
  parserStatus: 'not_applicable' | 'parsed' | 'metadata_only';
  metadata: Record<string, unknown>;
  downloadPath: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeChangeStatus = 'pending_insert' | 'pending_update' | 'pending_delete';

export type KnowledgeListItem = {
  id: number;
  entryType: KnowledgeEntryType;
  sourceTable: string;
  sourceId: string;
  title: string;
  summary: string;
  tags: string[];
  metadata: Record<string, unknown>;
  syncedAt: string | null;
  updatedAt: string | null;
};

export type KnowledgeDetail = KnowledgeListItem & {
  sourceUpdatedAt: string | null;
  content: string;
  contentHash: string;
  createdAt: string | null;
};

export type KnowledgeChange = {
  status: KnowledgeChangeStatus;
  id: number | null;
  entryType: KnowledgeEntryType;
  sourceTable: string;
  sourceId: string;
  title: string;
  summary: string;
  sourceUpdatedAt: string | null;
  syncedAt: string | null;
};

export type KnowledgeTypeStats = {
  current: number;
  stored: number;
  fresh: number;
  pending: number;
};

export type KnowledgeAutoSyncStatus = {
  enabled: boolean;
  running: boolean;
  pending: boolean;
  pendingCount: number;
  pendingSources: string[];
  lastMode: 'automatic' | 'flush' | 'manual' | null;
  lastRequestedAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  lastError: string;
  consecutiveFailures: number;
  retryScheduled: boolean;
  lastResult: (KnowledgeSyncStats & { ftsEnabled: boolean }) | null;
};

export type KnowledgeSyncRun = {
  id: number;
  mode: 'automatic' | 'flush' | 'manual';
  status: 'success' | 'failed';
  triggerSourcesJson: string;
  triggerSources: string[];
  sourceCount: number;
  attempt: number;
  totalCount: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  deletedCount: number;
  ftsEnabled: boolean;
  durationMs: number;
  errorText: string;
  startedAt: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSyncHistory = {
  items: KnowledgeSyncRun[];
  stats: {
    totalRetained: number;
    successCount: number;
    failedCount: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  };
};

export type KnowledgeSyncHealthIssue = {
  code:
    | 'auto_sync_disabled'
    | 'sync_running_too_long'
    | 'sync_pending_too_long'
    | 'unscheduled_changes'
    | 'sync_failed'
    | 'last_run_failed';
  severity: 'attention' | 'critical';
  title: string;
  message: string;
  action: 'manual_sync';
};

export type KnowledgeSyncHealth = {
  status: 'healthy' | 'attention' | 'critical';
  summary: string;
  issues: KnowledgeSyncHealthIssue[];
  needsRecovery: boolean;
  pendingTotal: number;
  latestRun: KnowledgeSyncRun | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  checkedAt: string;
};

export type KnowledgeOverview = {
  generatedAt: string;
  lastSyncedAt: string | null;
  ftsEnabled: boolean;
  autoSync: KnowledgeAutoSyncStatus;
  stats: {
    currentTotal: number;
    storedTotal: number;
    fresh: number;
    pendingTotal: number;
    pendingInsert: number;
    pendingUpdate: number;
    pendingDelete: number;
  };
  byType: Partial<Record<KnowledgeEntryType, KnowledgeTypeStats>>;
  changes: KnowledgeChange[];
};

type KnowledgeSyncResult = {
  stats: KnowledgeSyncStats;
};

export async function getKnowledgeOverview(): Promise<KnowledgeOverview> {
  const result = await proxyRequest<ApiResponse<KnowledgeOverview>>('/api/knowledge/overview');
  if (!result.success || !result.data) throw new Error(result.error || '知识库概况加载失败');
  return result.data;
}

export async function getKnowledgeSyncRuns(limit = 8): Promise<KnowledgeSyncHistory> {
  const result = await proxyRequest<ApiResponse<KnowledgeSyncHistory>>(
    `/api/knowledge/sync-runs?limit=${Math.max(1, Math.min(limit, 100))}`
  );
  if (!result.success || !result.data) throw new Error(result.error || '同步记录加载失败');
  return result.data;
}

export async function getKnowledgeSyncHealth(): Promise<KnowledgeSyncHealth> {
  const result = await proxyRequest<ApiResponse<KnowledgeSyncHealth>>('/api/knowledge/health');
  if (!result.success || !result.data) throw new Error(result.error || '知识同步健康状态加载失败');
  return result.data;
}

export async function searchKnowledgeEntries(params: {
  query?: string;
  entryType?: KnowledgeEntryType | '';
  limit?: number;
} = {}): Promise<KnowledgeListItem[]> {
  const search = new URLSearchParams();
  if (params.query?.trim()) search.set('query', params.query.trim());
  if (params.entryType) search.set('entryType', params.entryType);
  search.set('limit', String(params.limit || 50));
  const result = await proxyRequest<ApiResponse<KnowledgeListItem[]>>(`/api/knowledge?${search.toString()}`);
  if (!result.success || !result.data) throw new Error(result.error || '知识条目加载失败');
  return result.data;
}

export async function getKnowledgeEntryDetail(id: number): Promise<KnowledgeDetail> {
  const result = await proxyRequest<ApiResponse<KnowledgeDetail>>(`/api/knowledge/${id}`);
  if (!result.success || !result.data) throw new Error(result.error || '知识详情加载失败');
  return result.data;
}

export async function syncFactoryKnowledge(): Promise<KnowledgeSyncStats> {
  const result = await proxyRequest<ApiResponse<KnowledgeSyncResult>>('/api/knowledge/sync', {
    method: 'POST',
  });
  if (!result.success || !result.data?.stats) throw new Error(result.error || '知识库同步失败');
  return result.data.stats;
}

export async function uploadKnowledgeDocument(input: {
  documentType: KnowledgeDocumentType;
  title: string;
  description?: string;
  contentText?: string;
  tags?: string[];
  file?: File | null;
}): Promise<KnowledgeDocument> {
  const form = new FormData();
  form.set('documentType', input.documentType);
  form.set('title', input.title);
  form.set('description', input.description || '');
  form.set('contentText', input.contentText || '');
  form.set('tags', JSON.stringify(input.tags || []));
  if (input.file) form.set('file', input.file);
  const result = await proxyRequest<ApiResponse<KnowledgeDocument>>('/api/knowledge/documents', {
    method: 'POST',
    body: form,
  });
  if (!result.success || !result.data) throw new Error(result.error || '工厂资料导入失败');
  return result.data;
}

export async function deleteKnowledgeDocument(id: number): Promise<void> {
  const result = await proxyRequest<ApiResponse<never>>(`/api/knowledge/documents/${id}`, {
    method: 'DELETE',
  });
  if (!result.success) throw new Error(result.error || '工厂资料删除失败');
}
