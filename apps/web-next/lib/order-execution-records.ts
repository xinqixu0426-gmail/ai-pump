'use client';

import { proxyRequest, type ApiResponse } from './api';
import type { OrderRequirementFile } from './order-requirements';

export type OrderExecutionPhase = 'pre_production' | 'in_production' | 'post_production';

export type OrderExecutionRecordType =
  | 'resource_preparation'
  | 'material_preparation'
  | 'supplier_confirmation'
  | 'capacity_adjustment'
  | 'supplier_adjustment'
  | 'process_exception'
  | 'quality_check'
  | 'quality_result'
  | 'delivery_result'
  | 'customer_feedback'
  | 'other';

export type OrderExecutionRecord = {
  id: number;
  orderId: number;
  phase: OrderExecutionPhase;
  phaseLabel: string;
  recordType: OrderExecutionRecordType;
  recordTypeLabel: string;
  title: string;
  draftText: string;
  occurredAt: string;
  sourceFileIds: number[];
  confirmedPhase: OrderExecutionPhase | null;
  confirmedPhaseLabel: string;
  confirmedRecordType: OrderExecutionRecordType | '';
  confirmedRecordTypeLabel: string;
  confirmedTitle: string;
  confirmedText: string;
  confirmedOccurredAt: string | null;
  confirmedSourceFileIds: number[];
  status: 'draft' | 'confirmed';
  hasConfirmedVersion: boolean;
  hasPendingChanges: boolean;
  knowledgeStatus: 'not_confirmed' | 'confirmed' | 'confirmed_with_draft';
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderExecutionArchive = {
  orderId: number;
  customerName: string;
  contractNo: string;
  orderStatus: string;
  records: OrderExecutionRecord[];
  availableFiles: OrderRequirementFile[];
};

export type OrderExecutionDraftInput = {
  phase: OrderExecutionPhase;
  recordType: OrderExecutionRecordType;
  title: string;
  summaryText: string;
  occurredAt: string;
  sourceFileIds: number[];
};

async function recordRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const result = await proxyRequest<ApiResponse<T>>(path, options);
  if (!result.success || result.data === undefined) {
    throw new Error(result.error || '订单执行档案操作失败');
  }
  return result.data;
}

export function getOrderExecutionRecords(orderId: number) {
  return recordRequest<OrderExecutionArchive>(`/api/orders/${orderId}/execution-records`);
}

export function createOrderExecutionDraft(orderId: number, input: OrderExecutionDraftInput) {
  return recordRequest<OrderExecutionRecord>(`/api/orders/${orderId}/execution-records`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateOrderExecutionDraft(
  orderId: number,
  recordId: number,
  input: OrderExecutionDraftInput
) {
  return recordRequest<OrderExecutionRecord>(
    `/api/orders/${orderId}/execution-records/${recordId}/draft`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    }
  );
}

export function confirmOrderExecutionRecord(
  orderId: number,
  recordId: number,
  input: OrderExecutionDraftInput
) {
  return recordRequest<OrderExecutionRecord>(
    `/api/orders/${orderId}/execution-records/${recordId}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
}

export function revokeOrderExecutionConfirmation(orderId: number, recordId: number) {
  return recordRequest<OrderExecutionRecord>(
    `/api/orders/${orderId}/execution-records/${recordId}/revoke`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

export function deleteOrderExecutionDraft(orderId: number, recordId: number) {
  return recordRequest<{ id: number; deleted: boolean }>(
    `/api/orders/${orderId}/execution-records/${recordId}`,
    { method: 'DELETE' }
  );
}
