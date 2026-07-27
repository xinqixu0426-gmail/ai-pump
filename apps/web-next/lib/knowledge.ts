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
  | 'business_rule';

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

export type KnowledgeOverview = {
  generatedAt: string;
  lastSyncedAt: string | null;
  ftsEnabled: boolean;
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
