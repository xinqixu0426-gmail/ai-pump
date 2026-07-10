import type { ApiResponse } from './api';
import { proxyRequest } from './api';

export type WorkbenchSummaryItem = {
  key: string;
  label: string;
  count: number;
  desc: string;
  path: string;
  severity: string;
};

export type WorkbenchSupplierFocus = {
  supplier: string;
  pendingQty: number;
  orderCount: number;
  orderIds: string[];
};

export type WorkbenchPendingPurchaseItem = {
  key: string;
  supplier: string;
  model: string;
  name: string;
  needToBuy: number;
  currentStock: number;
  orderCount: number;
  orders: Array<{ id: number; customerName: string; contractNo?: string }>;
};

export type WorkbenchOrderSummary = {
  id: number;
  customerName: string;
  contractNo?: string;
  status: string;
  itemCount: number;
  purchaseItemCount: number;
  purchasedItemCount: number;
  totalPrice: number;
  createdAt?: string;
};

export type DashboardPartSummary = {
  id: number;
  model: string;
  category: string;
  supplier: string;
  price: number;
  stock: number;
};

export type BusinessSummary = {
  generatedAt: string;
  kpis: {
    totalOrders: number;
    activeOrders: number;
    recipeCount: number;
    partCount: number;
    totalCost: number;
    totalRevenue: number;
    totalProfit: number;
    lowStockPartCount: number;
    outOfStockPartCount: number;
    todayOrderCount: number;
  };
  orders: {
    total: number;
    active: number;
    pendingPurchase: number;
    purchasing: number;
    completed: number;
    today: number;
    latest?: WorkbenchOrderSummary[];
    [key: string]: unknown;
  };
  recipes: { total: number };
  parts: { total: number; lowStock: number; outOfStock: number };
  financials: {
    totalCost: number;
    totalRevenue: number;
    totalProfit: number;
    profitRate: number;
  };
  workbench: {
    items: WorkbenchSummaryItem[];
    supplierFocus: WorkbenchSupplierFocus[];
    pendingPurchaseItems: WorkbenchPendingPurchaseItem[];
    readyToReceiveOrders: WorkbenchOrderSummary[];
    todayOrders: WorkbenchOrderSummary[];
    lowStockParts: DashboardPartSummary[];
    outOfStockParts: DashboardPartSummary[];
  };
};

export async function getWorkbenchSummary(): Promise<BusinessSummary> {
  const result = await proxyRequest<ApiResponse<BusinessSummary>>('/api/workbench/summary');
  if (!result.success || !result.data) throw new Error(result.error || '看板加载失败');
  return result.data;
}

export function severityClassName(severity: string): string {
  if (severity === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (severity === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-sky-200 bg-sky-50 text-sky-700';
}
