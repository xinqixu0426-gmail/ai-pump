import type { ApiResponse } from './api';
import { proxyRequest } from './api';

export type Part = {
  id: number;
  model: string;
  category: string;
  subcategory?: string;
  price: number;
  supplier: string;
  stock: number;
  notes?: string;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PartInput = {
  model: string;
  category: string;
  subcategory?: string;
  price: number;
  supplier: string;
  stock: number;
  notes?: string;
};

type PartRow = {
  id?: number;
  Id?: number;
  model?: string;
  category?: string;
  subcategory?: string;
  price?: number;
  supplier?: string;
  stock?: number;
  notes?: string;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
};

export type PartStockStatus = 'out' | 'low' | 'ok';

export function partStockStatus(part: Part): { status: PartStockStatus; label: string; className: string } {
  if (part.stock <= 0) {
    return { status: 'out', label: '缺货', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  }
  if (part.stock <= 5) {
    return { status: 'low', label: '低库存', className: 'border-amber-200 bg-amber-50 text-amber-700' };
  }
  return { status: 'ok', label: '正常', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
}

export function rowToPart(row: PartRow): Part {
  const id = row.id ?? row.Id ?? 0;
  return {
    id,
    model: row.model || '',
    category: row.category || '未分类',
    subcategory: row.subcategory || '',
    price: Number(row.price) || 0,
    supplier: row.supplier || '',
    stock: Number(row.stock) || 0,
    notes: row.notes || row.remark || '',
    remark: row.remark || row.notes || '',
    createdAt: row.createdAt || row.CreatedAt,
    updatedAt: row.updatedAt || row.UpdatedAt,
  };
}

export async function getAllParts(): Promise<Part[]> {
  const result = await proxyRequest<ApiResponse<PartRow[]>>('/api/parts');
  if (!result.success) throw new Error(result.error || '零件加载失败');
  return (result.data || []).map(rowToPart);
}

export async function createPart(input: PartInput): Promise<Part> {
  const result = await proxyRequest<ApiResponse<PartRow>>('/api/parts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '零件创建失败');
  return rowToPart(result.data);
}

export async function updatePart(id: number, input: PartInput): Promise<Part> {
  const result = await proxyRequest<ApiResponse<PartRow>>(`/api/parts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '零件保存失败');
  return rowToPart(result.data);
}

export async function deletePart(id: number): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/parts/${id}`, {
    method: 'DELETE',
  });
  if (!result.success) throw new Error(result.error || '零件删除失败');
}

export async function deleteParts(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await Promise.all(ids.map((id) => deletePart(id)));
}

export async function getSettingValue(key: string): Promise<string> {
  const result = await proxyRequest<ApiResponse<{ value: string }>>(`/api/settings/${key}`);
  if (!result.success || !result.data) throw new Error(result.error || '设置加载失败');
  return String(result.data.value ?? '');
}

export async function setSettingValue(key: string, value: unknown): Promise<void> {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value: payload }),
  });
  if (!result.success) throw new Error(result.error || '设置保存失败');
}
