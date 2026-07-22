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

type KnowledgeSyncResult = {
  stats: KnowledgeSyncStats;
};

export async function syncFactoryKnowledge(): Promise<KnowledgeSyncStats> {
  const result = await proxyRequest<ApiResponse<KnowledgeSyncResult>>('/api/knowledge/sync', {
    method: 'POST',
  });
  if (!result.success || !result.data?.stats) throw new Error(result.error || '知识库同步失败');
  return result.data.stats;
}
