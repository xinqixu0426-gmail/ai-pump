import type { ApiResponse } from './api';
import { proxyRequest } from './api';

export type OrderReadinessVerdict = 'ready' | 'waiting_materials' | 'needs_review' | 'blocked' | 'not_applicable';

export type OrderReadinessIssue = {
  code: string;
  severity: string;
  title: string;
  detail: string;
  action: string;
  path: string;
};

export type OrderReadinessShortage = {
  identityKey: string;
  model: string;
  name: string;
  supplier: string;
  inventoryType: string;
  requiredQty: number;
  availableQty: number;
  shortageQty: number;
  purchaseUnit: string;
  plannedQty: number;
  orderedQty: number;
  receivedQty: number;
  stockedQty: number;
  procurementStage: string;
};

export type OrderReadinessDetail = {
  generatedAt: string;
  order: {
    id: number;
    customerName: string;
    contractNo: string;
    status: string;
    itemCount: number;
    totalUnits: number;
  };
  verdict: OrderReadinessVerdict;
  canProduce: boolean;
  summary: string;
  metrics: {
    itemCount: number;
    totalUnits: number;
    materialLineCount: number;
    shortageLineCount: number;
    unresolvedLineCount: number;
    totalLockedCost: number;
    totalOrderPrice: number;
    grossProfit: number;
  };
  steps: Array<{
    key: string;
    label: string;
    status: string;
    summary: string;
    issues: string[];
  }>;
  shortages: OrderReadinessShortage[];
  blockers: OrderReadinessIssue[];
  warnings: OrderReadinessIssue[];
  recommendedActions: Array<{ key: string; label: string; path: string; reason: string }>;
};

export type OrderReadinessPlan = {
  generatedAt: string;
  order: OrderReadinessDetail['order'];
  readinessVerdict: OrderReadinessVerdict;
  planStatus: string;
  summary: string;
  metrics: {
    totalSteps: number;
    confirmableSteps: number;
    manualSteps: number;
    waitingSteps: number;
    blockedSteps: number;
  };
  steps: Array<{
    id: string;
    sequence: number;
    category: string;
    title: string;
    reason: string;
    expectedResult: string;
    priority: string;
    mode: string;
    status: string;
    owner: string;
    path: string;
    dependsOn: string[];
    evidenceCodes: string[];
    itemCount: number;
  }>;
  readiness: OrderReadinessDetail;
};

export type OrderReadinessOverviewItem = {
  order: {
    id: number;
    customerName: string;
    contractNo: string;
    status: string;
    itemCount: number;
    totalUnits: number;
  };
  verdict: OrderReadinessVerdict;
  canProduce: boolean;
  summary: string;
  planStatus: string;
  metrics: {
    materialLineCount: number;
    shortageLineCount: number;
    unresolvedLineCount: number;
    [key: string]: number;
  };
  blockerCount: number;
  warningCount: number;
  shortageCount: number;
  blockers: Array<{ code: string; title: string; detail: string; action: string; path: string }>;
  warnings: Array<{ code: string; title: string; detail: string; action: string; path: string }>;
  shortages: Array<{
    identityKey: string;
    model: string;
    shortageQty: number;
    purchaseUnit: string;
    procurementStage: string;
    inventoryType: string;
  }>;
  nextAction: {
    id: string;
    sequence: number;
    title: string;
    mode: string;
    status: string;
    owner: string;
    path: string;
  } | null;
};

export type OrderReadinessOverview = {
  generatedAt: string;
  summary: string;
  metrics: {
    totalActiveOrders: number;
    ready: number;
    waitingMaterials: number;
    needsReview: number;
    blocked: number;
    attentionRequired: number;
  };
  items: OrderReadinessOverviewItem[];
};

export async function getOrderReadinessOverview(): Promise<OrderReadinessOverview> {
  const result = await proxyRequest<ApiResponse<OrderReadinessOverview>>('/api/orders/readiness-overview');
  if (!result.success || !result.data) throw new Error(result.error || '订单准备总览加载失败');
  return result.data;
}

function validOrderId(value: string | number): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('非法订单 ID');
  return id;
}

export async function getOrderReadiness(orderId: string | number): Promise<OrderReadinessDetail> {
  const id = validOrderId(orderId);
  const result = await proxyRequest<ApiResponse<OrderReadinessDetail>>(`/api/orders/${id}/readiness`);
  if (!result.success || !result.data) throw new Error(result.error || '订单生产准备检查失败');
  return result.data;
}

export async function getOrderReadinessPlan(orderId: string | number): Promise<OrderReadinessPlan> {
  const id = validOrderId(orderId);
  const result = await proxyRequest<ApiResponse<OrderReadinessPlan>>(`/api/orders/${id}/readiness-plan`);
  if (!result.success || !result.data) throw new Error(result.error || '订单处理方案加载失败');
  return result.data;
}
