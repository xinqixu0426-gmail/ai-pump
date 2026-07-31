'use client';

import { proxyRequest, type ApiResponse } from './api';

export type OrderRequirementFile = {
  id: number;
  originalName: string;
  detectedType: 'pdf' | 'spreadsheet' | 'image' | 'text';
  mimeType: string;
  fileSize: number;
  parserStatus: 'pending' | 'processing' | 'parsed' | 'metadata_only' | 'failed';
  linkedAt: string;
  downloadPath: string;
};

export type OrderRequirementKnowledgeStatus =
  | 'not_confirmed'
  | 'confirmed'
  | 'confirmed_with_draft';

export type OrderRequirementSummary = {
  id: number | null;
  orderId: number;
  customerName: string;
  contractNo: string;
  orderStatus: string;
  hasRecord: boolean;
  draftText: string;
  confirmedText: string;
  sourceFileIds: number[];
  confirmedSourceFileIds: number[];
  status: 'draft' | 'confirmed';
  hasConfirmedVersion: boolean;
  hasPendingChanges: boolean;
  knowledgeStatus: OrderRequirementKnowledgeStatus;
  confirmedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  availableFiles: OrderRequirementFile[];
};

type RequirementInput = {
  summaryText: string;
  sourceFileIds: number[];
};

async function requirementRequest(
  orderId: number,
  suffix = '',
  options: RequestInit = {}
): Promise<OrderRequirementSummary> {
  const result = await proxyRequest<ApiResponse<OrderRequirementSummary>>(
    `/api/orders/${orderId}/requirements${suffix}`,
    options
  );
  if (!result.success || !result.data) {
    throw new Error(result.error || '读取客户要求失败');
  }
  return result.data;
}

export function getOrderRequirementSummary(orderId: number) {
  return requirementRequest(orderId);
}

export function saveOrderRequirementDraft(orderId: number, input: RequirementInput) {
  return requirementRequest(orderId, '/draft', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function confirmOrderRequirementSummary(orderId: number, input: RequirementInput) {
  return requirementRequest(orderId, '/confirm', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function revokeOrderRequirementConfirmation(orderId: number) {
  return requirementRequest(orderId, '/revoke', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
