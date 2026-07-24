import type { ApiResponse } from './api';
import { proxyRequest } from './api';

export type Customer = {
  id: number;
  name: string;
  contactInfo: string;
  defaultMargin: number;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CustomerInput = {
  name: string;
  contactInfo: string;
  defaultMargin: number;
  remark?: string;
};

export type Quotation = {
  id: number;
  customerId: number;
  status: string;
  itemsJson: string;
  totalCost: number;
  totalPrice: number;
  remark?: string;
  convertedOrderId?: number | null;
  convertedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type CustomerRow = {
  id?: number;
  Id?: number;
  name?: string;
  contactInfo?: string;
  defaultMargin?: number;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
};

type QuotationRow = {
  id?: number;
  Id?: number;
  customerId?: number;
  status?: string;
  itemsJson?: string;
  totalCost?: number;
  totalPrice?: number;
  remark?: string;
  convertedOrderId?: number | null;
  convertedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
};

export type CustomerQuotationStats = {
  count: number;
  totalPrice: number;
  latest: Date | null;
};

function rowId(row: { id?: number; Id?: number }): number {
  return row.id ?? row.Id ?? 0;
}

export function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: rowId(row),
    name: row.name || '',
    contactInfo: row.contactInfo || '',
    defaultMargin: Number(row.defaultMargin) || 0,
    remark: row.remark || '',
    createdAt: row.createdAt || row.CreatedAt,
    updatedAt: row.updatedAt || row.UpdatedAt,
  };
}

export function rowToQuotation(row: QuotationRow): Quotation {
  return {
    id: rowId(row),
    customerId: Number(row.customerId) || 0,
    status: row.status || '报价中',
    itemsJson: row.itemsJson || '[]',
    totalCost: Number(row.totalCost) || 0,
    totalPrice: Number(row.totalPrice) || 0,
    remark: row.remark || '',
    convertedOrderId: row.convertedOrderId || null,
    convertedAt: row.convertedAt || null,
    createdAt: row.createdAt || row.CreatedAt,
    updatedAt: row.updatedAt || row.UpdatedAt,
  };
}

export async function getAllCustomers(): Promise<Customer[]> {
  const result = await proxyRequest<ApiResponse<CustomerRow[]>>('/api/customers');
  if (!result.success) throw new Error(result.error || '客户加载失败');
  return (result.data || []).map(rowToCustomer);
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const result = await proxyRequest<ApiResponse<CustomerRow>>('/api/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '客户创建失败');
  return rowToCustomer(result.data);
}

export async function updateCustomer(id: number, input: CustomerInput): Promise<Customer> {
  const result = await proxyRequest<ApiResponse<CustomerRow>>(`/api/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '客户保存失败');
  return rowToCustomer(result.data);
}

export async function deleteCustomer(id: number): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/customers/${id}`, {
    method: 'DELETE',
  });
  if (!result.success) throw new Error(result.error || '客户删除失败');
}

export async function getAllQuotations(): Promise<Quotation[]> {
  const result = await proxyRequest<ApiResponse<QuotationRow[]>>('/api/quotations');
  if (!result.success) throw new Error(result.error || '报价加载失败');
  return (result.data || []).map(rowToQuotation);
}

export function quotationsForCustomer(quotations: Quotation[], customerId: number | null): Quotation[] {
  if (customerId == null) return [];
  return quotations.filter((quotation) => quotation.customerId === customerId);
}

export function quotationCountByCustomer(quotations: Quotation[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const quotation of quotations) {
    counts.set(quotation.customerId, (counts.get(quotation.customerId) || 0) + 1);
  }
  return counts;
}

export function calculateCustomerQuotationStats(quotations: Quotation[]): CustomerQuotationStats {
  const totalPrice = quotations.reduce((sum, quotation) => sum + quotation.totalPrice, 0);
  const latest = quotations
    .map((quotation) => (quotation.createdAt ? new Date(quotation.createdAt) : null))
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;

  return { count: quotations.length, totalPrice, latest };
}

export function quotationStatusClassName(status: string): string {
  if (status === '已接受') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === '已转订单') return 'border-sky-200 bg-sky-50 text-sky-700';
  if (status === '已过时') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}
