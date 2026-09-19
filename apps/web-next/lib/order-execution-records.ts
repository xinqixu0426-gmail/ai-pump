'use client';

import { createIdempotencyKey, proxyRequest, type ApiResponse } from './api';
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
  operationId?: string;
  idempotentReplay?: boolean;
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

const executionRecordVersions = new Map<number, string>();

function rememberRecord(record: OrderExecutionRecord) {
  executionRecordVersions.set(record.id, record.updatedAt);
  return record;
}

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

export async function getOrderExecutionRecords(orderId: number) {
  const archive = await recordRequest<OrderExecutionArchive>(
    `/api/orders/${orderId}/execution-records`
  );
  archive.records.forEach(rememberRecord);
  return archive;
}

export async function createOrderExecutionDraft(orderId: number, input: OrderExecutionDraftInput) {
  return rememberRecord(await recordRequest<OrderExecutionRecord>(
    `/api/orders/${orderId}/execution-records`,
    {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`order-execution-create:${orderId}`),
    },
    body: JSON.stringify(input),
    }
  ));
}

export async function updateOrderExecutionDraft(
  orderId: number,
  recordId: number,
  input: OrderExecutionDraftInput
) {
  return rememberRecord(await recordRequest<OrderExecutionRecord>(
    `/api/orders/${orderId}/execution-records/${recordId}/draft`,
    {
      method: 'PUT',
      headers: {
        'Idempotency-Key': createIdempotencyKey(`order-execution-update:${recordId}`),
      },
      body: JSON.stringify({
        ...input,
        expectedUpdatedAt: executionRecordVersions.get(recordId) || null,
      }),
    }
  ));
}

export async function confirmOrderExecutionRecord(
  orderId: number,
  recordId: number,
  input: OrderExecutionDraftInput
) {
  return rememberRecord(await recordRequest<OrderExecutionRecord>(
    `/api/orders/${orderId}/execution-records/${recordId}/confirm`,
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': createIdempotencyKey(`order-execution-confirm:${recordId}`),
      },
      body: JSON.stringify({
        ...input,
        expectedUpdatedAt: executionRecordVersions.get(recordId) || null,
      }),
    }
  ));
}

export async function revokeOrderExecutionConfirmation(orderId: number, recordId: number) {
  return rememberRecord(await recordRequest<OrderExecutionRecord>(
    `/api/orders/${orderId}/execution-records/${recordId}/revoke`,
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': createIdempotencyKey(`order-execution-revoke:${recordId}`),
      },
      body: JSON.stringify({
        expectedUpdatedAt: executionRecordVersions.get(recordId) || null,
      }),
    }
  ));
}

export async function deleteOrderExecutionDraft(orderId: number, recordId: number) {
  const result = await recordRequest<{ id: number; deleted: boolean }>(
    `/api/orders/${orderId}/execution-records/${recordId}`,
    {
      method: 'DELETE',
      headers: {
        'Idempotency-Key': createIdempotencyKey(`order-execution-delete:${recordId}`),
      },
      body: JSON.stringify({
        expectedUpdatedAt: executionRecordVersions.get(recordId) || null,
      }),
    }
  );
  executionRecordVersions.delete(recordId);
  return result;
}
