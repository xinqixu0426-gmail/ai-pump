import {
  Part,
  Recipe,
  RecipePart,
  CostResult,
  ApiResponse,
  PumpShellTemplate,
  BusinessSummary,
  Customer,
  CustomerInput,
  DynamicCostOverrides,
  DynamicCostResult,
  Quotation,
  QuotationInput,
} from '../types';

// ─── 通用请求封装 ─────────────────────────────
// 统一代理请求入口，在此集中处理 401 和重定向
export const API_BASE = import.meta.env.VITE_API_URL || '';

interface ProxyOptions {
  redirectOnUnauthorized?: boolean;
  throwOnError?: boolean;
}

function isFormData(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function resolveApiPath(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path}`;
}

export async function proxyFetch(
  path: string,
  options: RequestInit = {},
  proxyOptions: ProxyOptions = {}
): Promise<Response> {
  const { redirectOnUnauthorized = true, throwOnError = true } = proxyOptions;
  const headers = new Headers(options.headers);
  if (options.body && !isFormData(options.body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(resolveApiPath(path), {
    ...options,
    credentials: 'include',
    headers,
  });

  if (response.status === 401) {
    if (redirectOnUnauthorized) {
      window.location.href = '/login';
      throw new Error('未授权，跳转登录页');
    }
  }

  if (throwOnError && !response.ok) {
    let serverError: string | undefined;
    try {
      const errData = await response.json();
      serverError = errData?.error || errData?.message;
    } catch {
      // 响应体不是 JSON，忽略
    }
    throw new Error(serverError || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response;
}

export async function proxyRequest<T>(
  path: string,
  options: RequestInit = {},
  proxyOptions: ProxyOptions = {}
): Promise<T> {
  const response = await proxyFetch(path, options, proxyOptions);
  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function proxyFormRequest<T>(
  path: string,
  formData: FormData,
  options: Omit<RequestInit, 'body'> = {},
  proxyOptions: ProxyOptions = {}
): Promise<T> {
  return proxyRequest<T>(path, { method: 'POST', ...options, body: formData }, proxyOptions);
}

export async function getAllParts(): Promise<Part[]> {
  const res = await proxyRequest<{ success: boolean; data: Part[] }>('/api/parts');
  return res.data || [];
}

export async function createPart(part: Omit<Part, 'Id'>): Promise<Part> {
  const res = await proxyRequest<{ success: boolean; data: Part }>('/api/parts', {
    method: 'POST',
    body: JSON.stringify({
      model: part.model,
      category: part.category,
      price: part.price,
      supplier: part.supplier,
      stock: part.stock ?? 0,
      notes: part.notes ?? '',
    }),
  });
  return res.data;
}

export async function updatePart(id: number, part: Partial<Part>): Promise<Part> {
  const record: Record<string, unknown> = { Id: id };
  if (part.model !== undefined) record.model = part.model;
  if (part.category !== undefined) record.category = part.category;
  if (part.price !== undefined) record.price = part.price;
  if (part.supplier !== undefined) record.supplier = part.supplier;
  if (part.stock !== undefined) record.stock = part.stock;
  if (part.notes !== undefined) record.notes = part.notes;

  const res = await proxyRequest<{ success: boolean; data: Part }>('/api/parts', {
    method: 'PATCH',
    body: JSON.stringify(record),
  });
  return res.data;
}

export async function deletePart(id: number): Promise<void> {
  await proxyRequest('/api/parts', {
    method: 'DELETE',
    body: JSON.stringify([{ Id: id }]),
  });
}

export async function deleteParts(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await proxyRequest('/api/parts', {
    method: 'DELETE',
    body: JSON.stringify(ids.map((id) => ({ Id: id }))),
  });
}

/**
 * 批量扣减库存（生产用）— 原子操作
 */
export async function batchDeductStock(
  deductions: Array<{ partId: number; deductQty: number }>
): Promise<void> {
  await proxyRequest('/api/parts/batch-stock', {
    method: 'POST',
    body: JSON.stringify({
      operations: deductions.map(d => ({ partId: d.partId, delta: -d.deductQty })),
    }),
  });
}

/**
 * 批量增加库存（采购入库用）— 原子操作
 */
export async function batchAddStock(
  additions: Array<{ partId: number; addQty: number }>
): Promise<void> {
  await proxyRequest('/api/parts/batch-stock', {
    method: 'POST',
    body: JSON.stringify({
      operations: additions.map(a => ({ partId: a.partId, delta: a.addQty })),
    }),
  });
}

// ─── 配方 CRUD ──────────────────────────────

function recipeToApiPayload(recipe: Partial<Omit<Recipe, 'Id'>>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (recipe.name !== undefined) payload.name = recipe.name;
  if (recipe.spec !== undefined) payload.spec = recipe.spec;
  if (recipe.partsJson !== undefined) payload.partsJson = recipe.partsJson || '[]';
  if (recipe.savedTotalCost !== undefined) payload.savedTotalCost = recipe.savedTotalCost;
  if (recipe.savedCostDetails !== undefined) payload.savedCostDetails = recipe.savedCostDetails;
  if (recipe.templateId !== undefined) payload.templateId = recipe.templateId || null;
  if (recipe.coilSpec !== undefined) payload.coilSpec = recipe.coilSpec || '';
  if (recipe.coilSheets !== undefined) payload.coilSheets = recipe.coilSheets || 0;
  if (recipe.coilMaterial !== undefined) payload.coilMaterial = recipe.coilMaterial || '钢带';
  if (recipe.hasFloat !== undefined) payload.hasFloat = recipe.hasFloat || 0;
  if (recipe.floatWire !== undefined) payload.floatWire = recipe.floatWire || '';
  if (recipe.hasCable !== undefined) payload.hasCable = recipe.hasCable || 0;
  if (recipe.cableLength !== undefined) payload.cableLength = recipe.cableLength || 0;
  if (recipe.cableWire !== undefined) payload.cableWire = recipe.cableWire || '';
  if (recipe.extraPartsJson !== undefined) payload.extraPartsJson = recipe.extraPartsJson || '[]';
  if (recipe.packingPartsJson !== undefined) payload.packingPartsJson = recipe.packingPartsJson || '[]';
  if (recipe.assemblyWage !== undefined) payload.assemblyWage = recipe.assemblyWage || 0;
  if (recipe.packingWage !== undefined) payload.packingWage = recipe.packingWage || 0;
  if (recipe.paintingWage !== undefined) payload.paintingWage = recipe.paintingWage != null ? recipe.paintingWage : null;
  if (recipe.surfaceTreatmentMode !== undefined) payload.surfaceTreatmentMode = recipe.surfaceTreatmentMode || 'none';
  if (recipe.surfaceTreatmentCost !== undefined) payload.surfaceTreatmentCost = recipe.surfaceTreatmentCost || 0;
  if (recipe.managementFee !== undefined) payload.managementFee = recipe.managementFee || 0;
  if (recipe.customBarrelLength !== undefined) payload.customBarrelLength = recipe.customBarrelLength ?? null;
  return payload;
}

export async function getAllRecipes(): Promise<Recipe[]> {
  const res = await proxyRequest<{ success: boolean; data: Recipe[] }>('/api/recipes');
  return res.data || [];
}

export async function getRecipe(id: number): Promise<Recipe | null> {
  try {
    const res = await proxyRequest<{ success: boolean; data: Recipe }>(`/api/recipes/${id}`);
    return res.data || null;
  } catch {
    return null;
  }
}

export async function createRecipe(recipe: Omit<Recipe, 'Id'>): Promise<Recipe> {
  const res = await proxyRequest<{ success: boolean; data: Recipe }>('/api/recipes', {
    method: 'POST',
    body: JSON.stringify(recipeToApiPayload(recipe)),
  });
  return res.data;
}

export async function deleteRecipe(id: number): Promise<void> {
  await proxyRequest('/api/recipes', {
    method: 'DELETE',
    body: JSON.stringify([{ Id: id }]),
  });
}

export async function updateRecipe(id: number, recipe: Partial<Omit<Recipe, 'Id'>>): Promise<Recipe> {
  const res = await proxyRequest<{ success: boolean; data: Recipe }>('/api/recipes', {
    method: 'PATCH',
    body: JSON.stringify({ Id: id, ...recipeToApiPayload(recipe) }),
  });
  return res.data;
}

// ─── 成本计算 ─────────────────────────────────

export async function calculateCost(parts: RecipePart[]): Promise<CostResult> {
  if (!parts || parts.length === 0) {
    return { totalCost: '0.00', itemCount: 0, details: [], missingParts: [] };
  }

  const result = await proxyRequest<ApiResponse<CostResult>>('/api/cost/calculate', {
    method: 'POST',
    body: JSON.stringify({ parts }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || '计算成本失败');
  }
  return result.data;
}

// ─── 泵壳模板 CRUD ──────────────────────────

function templateToApiPayload(tpl: Partial<Omit<PumpShellTemplate, 'Id'>>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (tpl.shellModel !== undefined) payload.shellModel = tpl.shellModel;
  if (tpl.description !== undefined) payload.description = tpl.description || '';
  if (tpl.partsJson !== undefined) payload.partsJson = tpl.partsJson || '[]';
  if (tpl.shellComponentsJson !== undefined) payload.shellComponentsJson = tpl.shellComponentsJson || '[]';
  if (tpl.rotorParamsJson !== undefined) payload.rotorParamsJson = tpl.rotorParamsJson || '{}';
  if (tpl.assemblyWage !== undefined) payload.assemblyWage = tpl.assemblyWage ?? 0;
  if (tpl.packingWage !== undefined) payload.packingWage = tpl.packingWage ?? 0;
  if (tpl.paintingWage !== undefined) payload.paintingWage = tpl.paintingWage ?? null;
  if (tpl.costMode !== undefined) payload.costMode = tpl.costMode || 'components';
  if (tpl.bundleCost !== undefined) payload.bundleCost = tpl.bundleCost ?? 0;
  return payload;
}

export async function getAllTemplates(): Promise<PumpShellTemplate[]> {
  const res = await proxyRequest<{ success: boolean; data: PumpShellTemplate[] }>('/api/templates');
  return res.data || [];
}

export async function getTemplate(id: number): Promise<PumpShellTemplate | null> {
  try {
    const res = await proxyRequest<{ success: boolean; data: PumpShellTemplate }>(`/api/templates/${id}`);
    return res.data || null;
  } catch {
    return null;
  }
}

export async function createTemplate(tpl: Omit<PumpShellTemplate, 'Id'>): Promise<PumpShellTemplate> {
  const res = await proxyRequest<{ success: boolean; data: PumpShellTemplate }>('/api/templates', {
    method: 'POST',
    body: JSON.stringify(templateToApiPayload(tpl)),
  });
  return res.data;
}

export async function updateTemplate(id: number, tpl: Partial<Omit<PumpShellTemplate, 'Id'>>): Promise<PumpShellTemplate> {
  const res = await proxyRequest<{ success: boolean; data: PumpShellTemplate }>(`/api/templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(templateToApiPayload(tpl)),
  });
  return res.data;
}

export async function deleteTemplate(id: number): Promise<void> {
  await proxyRequest(`/api/templates/${id}`, { method: 'DELETE' });
}

// ====== 客户 CRUD ======

export const fetchCustomers = async (): Promise<Customer[]> => {
  const res = await proxyRequest<Customer[] | { success: boolean; data: Customer[] }>('/api/customers');
  return Array.isArray(res) ? res : res.data;
};
export const createCustomer = async (data: CustomerInput): Promise<{ success: boolean; id: number }> =>
  proxyRequest<{ success: boolean; id: number }>('/api/customers', { method: 'POST', body: JSON.stringify(data) });
export const updateCustomer = async (id: number, data: CustomerInput): Promise<ApiResponse<never>> =>
  proxyRequest<ApiResponse<never>>(`/api/customers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCustomer = async (id: number): Promise<ApiResponse<never>> =>
  proxyRequest<ApiResponse<never>>(`/api/customers/${id}`, { method: 'DELETE' });

// ====== 报价单 CRUD ======

export const fetchQuotations = async (): Promise<Quotation[]> => {
  const res = await proxyRequest<Quotation[] | { success: boolean; data: Quotation[] }>('/api/quotations');
  return Array.isArray(res) ? res : res.data;
};
export const createQuotation = async (data: QuotationInput): Promise<{ success: boolean; id: number }> =>
  proxyRequest<{ success: boolean; id: number }>('/api/quotations', { method: 'POST', body: JSON.stringify(data) });
export const updateQuotation = async (id: number, data: QuotationInput | Partial<QuotationInput>): Promise<ApiResponse<never>> =>
  proxyRequest<ApiResponse<never>>(`/api/quotations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteQuotation = async (id: number): Promise<ApiResponse<never>> =>
  proxyRequest<ApiResponse<never>>(`/api/quotations/${id}`, { method: 'DELETE' });

export const dynamicCalculateCost = async (baseRecipeId: number, overrides: DynamicCostOverrides): Promise<DynamicCostResult> =>
  proxyRequest<DynamicCostResult>('/api/cost/dynamic-calculate', { method: 'POST', body: JSON.stringify({ baseRecipeId, overrides }) });

export async function getWorkbenchSummary(): Promise<BusinessSummary | null> {
  const res = await proxyRequest<ApiResponse<BusinessSummary>>('/api/workbench/summary');
  return res.data || null;
}
