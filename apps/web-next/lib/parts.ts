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
  businessSettings?: PartBusinessSettingUpdate[];
};

export type PartBusinessSettingUpdate = {
  key: 'cable_accessories' | 'float_accessory_delta';
  value: string;
  expectedUpdatedAt: string | null;
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

type PartCommandRow = PartRow & {
  businessSettings?: Array<{
    key: PartBusinessSettingUpdate['key'];
    value: string;
    updatedAt: string;
  }>;
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
  const result = await proxyRequest<ApiResponse<PartCommandRow>>('/api/parts', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey('part-create'),
    },
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '零件创建失败');
  rememberPartBusinessSettings(result.data.businessSettings);
  return rowToPart(result.data);
}

export type PartBatchCreateInput = Pick<
  PartInput,
  'model' | 'category' | 'subcategory' | 'price' | 'supplier' | 'stock' | 'notes'
>;

export type PartBatchCreatePreview = {
  capabilityId: 'parts.batch_create';
  preview: true;
  confirmationToken: string;
  previewHash: string;
  suggestedIdempotencyKey: string;
  requestedCount: number;
  createCount: number;
  skippedCount: number;
  parts: PartBatchCreateInput[];
  skippedExisting: PartRow[];
  warnings: Array<{ code: string; message: string; resourceId?: number }>;
};

export type PartBatchCreateReceipt = {
  operationId: string;
  status?: string;
  operationStatus?: string;
  createdCount: number;
  parts: PartRow[];
  auditIds: number[];
  warnings?: Array<{ code?: string; message?: string }>;
  idempotentReplay?: boolean;
};

export async function previewPartBatchCreate(
  parts: PartBatchCreateInput[]
): Promise<PartBatchCreatePreview> {
  const result = await proxyRequest<ApiResponse<PartBatchCreatePreview>>('/api/parts/batch-create-preview', {
    method: 'POST',
    body: JSON.stringify({ parts }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || '生成零件批量建档预览失败');
  }
  return result.data;
}

export async function confirmPartBatchCreate(
  preview: Pick<PartBatchCreatePreview, 'confirmationToken' | 'suggestedIdempotencyKey'>
): Promise<PartBatchCreateReceipt> {
  const result = await proxyRequest<ApiResponse<PartBatchCreateReceipt>>('/api/parts/batch-create', {
    method: 'POST',
    headers: {
      'Idempotency-Key': preview.suggestedIdempotencyKey,
    },
    body: JSON.stringify({
      confirmationToken: preview.confirmationToken,
      idempotencyKey: preview.suggestedIdempotencyKey,
    }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || '零件批量建档失败');
  }
  const status = result.data.status || result.data.operationStatus;
  if (status !== 'completed'
    || !result.data.operationId
    || result.data.createdCount <= 0
    || result.data.auditIds.length < result.data.createdCount) {
    throw new Error('零件批量建档回执不完整，请勿重复提交并检查业务变更记录');
  }
  return result.data;
}

export async function updatePart(part: Part, input: PartInput): Promise<Part> {
  if (!part.updatedAt) throw new Error('零件版本缺失，请刷新列表后再保存');
  const preview = await proxyRequest<ApiResponse<{
    confirmationToken: string;
    suggestedIdempotencyKey: string;
  }>>(`/api/parts/${part.id}/save-preview`, {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: part.updatedAt,
    }),
  });
  if (!preview.success || !preview.data) {
    throw new Error(preview.error || '生成零件资料保存预览失败');
  }
  const result = await proxyRequest<ApiResponse<PartCommandRow>>(`/api/parts/${part.id}/save`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': preview.data.suggestedIdempotencyKey,
    },
    body: JSON.stringify({
      confirmationToken: preview.data.confirmationToken,
      idempotencyKey: preview.data.suggestedIdempotencyKey,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '零件保存失败');
  rememberPartBusinessSettings(result.data.businessSettings);
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
  const missingVersion = parts.find(part => !part.updatedAt);
  if (missingVersion) throw new Error(`零件“${missingVersion.model}”版本缺失，请刷新后再删除`);
  const preview = await proxyRequest<ApiResponse<{
    confirmationToken: string;
    suggestedIdempotencyKey: string;
    deleteCount: number;
  }>>('/api/parts/batch-delete-preview', {
    method: 'POST',
    body: JSON.stringify({
      parts: parts.map(part => ({
        partId: part.id,
        expectedUpdatedAt: part.updatedAt,
      })),
    }),
  });
  if (!preview.success || !preview.data) {
    throw new Error(preview.error || '生成零件批量删除预览失败');
  }
  const result = await proxyRequest<ApiResponse<{
    status?: string;
    operationStatus?: string;
    operationId: string;
    deletedCount: number;
    auditIds: number[];
  }>>('/api/parts/batch-delete', {
    method: 'POST',
    headers: {
      'Idempotency-Key': preview.data.suggestedIdempotencyKey,
    },
    body: JSON.stringify({
      confirmationToken: preview.data.confirmationToken,
      idempotencyKey: preview.data.suggestedIdempotencyKey,
    }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || '零件批量删除失败');
  }
  const status = result.data.status || result.data.operationStatus;
  if (status !== 'completed'
    || result.data.deletedCount !== parts.length
    || result.data.auditIds.length < parts.length) {
    throw new Error('零件批量删除回执不完整，请刷新列表并检查业务变更记录');
  }
}

const settingVersions = new Map<string, string | null>();

function rememberPartBusinessSettings(settings?: PartCommandRow['businessSettings']) {
  for (const setting of settings || []) {
    settingVersions.set(setting.key, setting.updatedAt || null);
  }
}

export function partBusinessSettingUpdate(
  key: PartBusinessSettingUpdate['key'],
  value: unknown
): PartBusinessSettingUpdate {
  if (!settingVersions.has(key)) {
    throw new Error(`设置项 ${key} 的版本尚未加载，请刷新表单后重试`);
  }
  return {
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
    expectedUpdatedAt: settingVersions.get(key) || null,
  };
}

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
