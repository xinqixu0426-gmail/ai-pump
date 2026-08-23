import type { ApiResponse } from './api';
import { createIdempotencyKey, proxyRequest } from './api';

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
  duplicatePolicy?: 'allow' | 'reject';
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
    headers: {
      'Idempotency-Key': createIdempotencyKey('part-create'),
    },
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '零件创建失败');
  return rowToPart(result.data);
}

async function replacePartStock(part: Part, targetStock: number): Promise<Part> {
  const delta = targetStock - part.stock;
  if (delta === 0) return part;
  const previewResult = await proxyRequest<ApiResponse<{
    confirmationToken: string;
    suggestedIdempotencyKey: string;
  }>>('/api/parts/batch-stock-preview', {
    method: 'POST',
    body: JSON.stringify({
      operations: [{ partId: part.id, delta }],
      note: '零件资料页库存调整',
    }),
  });
  if (!previewResult.success || !previewResult.data) {
    throw new Error(previewResult.error || '生成零件库存调整预览失败');
  }
  const commandResult = await proxyRequest<ApiResponse<{
    parts?: PartRow[];
  }>>('/api/parts/batch-stock', {
    method: 'POST',
    headers: {
      'Idempotency-Key': previewResult.data.suggestedIdempotencyKey,
    },
    body: JSON.stringify({
      confirmationToken: previewResult.data.confirmationToken,
      idempotencyKey: previewResult.data.suggestedIdempotencyKey,
    }),
  });
  const updated = commandResult.data?.parts?.[0];
  if (!commandResult.success || !updated) {
    throw new Error(commandResult.error || '零件库存调整失败');
  }
  return rowToPart(updated);
}

export async function updatePart(part: Part, input: PartInput): Promise<Part> {
  if (!part.updatedAt) throw new Error('零件版本缺失，请刷新列表后再保存');
  const stockAdjustedPart = await replacePartStock(part, input.stock);
  if (!stockAdjustedPart.updatedAt) throw new Error('库存调整后零件版本缺失，请刷新列表');
  const { stock: _stock, ...metadataInput } = input;
  const result = await proxyRequest<ApiResponse<PartRow>>(`/api/parts/${part.id}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`part-update:${part.id}`),
    },
    body: JSON.stringify({
      ...metadataInput,
      expectedUpdatedAt: stockAdjustedPart.updatedAt,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '零件保存失败');
  return rowToPart(result.data);
}

export async function deletePart(part: Part): Promise<void> {
  if (!part.updatedAt) throw new Error('零件版本缺失，请刷新列表后再删除');
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/parts/${part.id}`, {
    method: 'DELETE',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`part-delete:${part.id}`),
    },
    body: JSON.stringify({ expectedUpdatedAt: part.updatedAt }),
  });
  if (!result.success) throw new Error(result.error || '零件删除失败');
}

export async function deleteParts(parts: Part[]): Promise<void> {
  if (parts.length === 0) return;
  await Promise.all(parts.map((part) => deletePart(part)));
}

const settingVersions = new Map<string, string | null>();

export async function getSettingValue(key: string): Promise<string> {
  const result = await proxyRequest<ApiResponse<{ value: string; updatedAt?: string | null }>>(`/api/settings/${key}`);
  if (!result.success || !result.data) throw new Error(result.error || '设置加载失败');
  settingVersions.set(key, result.data.updatedAt || null);
  return String(result.data.value ?? '');
}

export async function setSettingValue(key: string, value: unknown): Promise<void> {
  if (!settingVersions.has(key)) await getSettingValue(key);
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  const result = await proxyRequest<ApiResponse<{ updatedAt?: string | null }>>(`/api/settings/${key}`, {
    method: 'PUT',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`business-setting-update:${key}`),
    },
    body: JSON.stringify({
      value: payload,
      expectedUpdatedAt: settingVersions.get(key) || null,
    }),
  });
  if (!result.success) throw new Error(result.error || '设置保存失败');
  settingVersions.set(key, result.data?.updatedAt || null);
}
