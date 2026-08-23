'use client';

import { proxyRequest, type ApiResponse } from './api';

export type BusinessChangeDomain =
  | 'order'
  | 'quotation'
  | 'purchasing'
  | 'part'
  | 'recipe'
  | 'template'
  | 'coil'
  | 'customer'
  | 'model_variant'
  | 'quality'
  | 'rotor'
  | 'settings'
  | 'file'
  | 'knowledge'
  | 'workflow';
export type BusinessChangeEventType = 'created' | 'updated' | 'deleted' | 'status_changed' | 'inventory_changed' | 'converted';

export type BusinessChangeEntity = {
  entityType: BusinessChangeDomain;
  entityId: string;
  entityLabel: string;
  role: 'primary' | 'affected';
};

export type BusinessChange = {
  id: number;
  operationId: string;
  capabilityId: string;
  eventType: BusinessChangeEventType;
  primaryDomain: BusinessChangeDomain;
  summary: string;
  reason: string;
  changes: Array<Record<string, unknown>>;
  auditIds: number[];
  detailRef: Record<string, unknown>;
  actor: string;
  sourceType: 'command' | 'order_revision_backfill';
  occurredAt: string;
  entities: BusinessChangeEntity[];
};

export type BusinessChangePage = {
  items: BusinessChange[];
  total: number;
  nextCursor: string | null;
  appliedFilters: Record<string, string | null>;
  asOf: string;
  provenance: { kind: 'live_business_history'; sourceTable: 'business_change_events' };
  semanticSearch: null | {
    query: string;
    matchedEventIds: number[];
    fallbackToStructured: boolean;
    evidenceLevel: 'semantic_candidate' | 'text_match';
  };
};

export type BusinessChangeFilters = {
  period?: 'today' | 'yesterday' | 'last7days' | 'last30days' | 'all';
  domain?: BusinessChangeDomain | '';
  eventType?: BusinessChangeEventType | '';
  keyword?: string;
  semanticQuery?: string;
  limit?: number;
};

export async function getBusinessChanges(filters: BusinessChangeFilters = {}): Promise<BusinessChangePage> {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value));
  });
  const response = await proxyRequest<ApiResponse<BusinessChangePage>>(
    `/api/business-changes${query.size ? `?${query.toString()}` : ''}`
  );
  if (!response.success || !response.data) throw new Error(response.error || '业务变更历史加载失败');
  return response.data;
}
