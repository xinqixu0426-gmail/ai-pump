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
  if (recipe.parts_json !== undefined) payload.partsJson = recipe.parts_json || '[]';
  if (recipe.saved_total_cost !== undefined) payload.savedTotalCost = recipe.saved_total_cost;
  if (recipe.saved_cost_details !== undefined) payload.savedCostDetails = recipe.saved_cost_details;
  if (recipe.template_id !== undefined) payload.templateId = recipe.template_id || null;
  if (recipe.coil_spec !== undefined) payload.coilSpec = recipe.coil_spec || '';
  if (recipe.coil_sheets !== undefined) payload.coilSheets = recipe.coil_sheets || 0;
  if (recipe.coil_material !== undefined) payload.coilMaterial = recipe.coil_material || '钢带';
  if (recipe.has_float !== undefined) payload.hasFloat = recipe.has_float || 0;
  if (recipe.float_wire !== undefined) payload.floatWire = recipe.float_wire || '';
  if (recipe.has_cable !== undefined) payload.hasCable = recipe.has_cable || 0;
  if (recipe.cable_length !== undefined) payload.cableLength = recipe.cable_length || 0;
  if (recipe.cable_wire !== undefined) payload.cableWire = recipe.cable_wire || '';
  if (recipe.extra_parts_json !== undefined) payload.extraPartsJson = recipe.extra_parts_json || '[]';
  if (recipe.packing_parts_json !== undefined) payload.packingPartsJson = recipe.packing_parts_json || '[]';
  if (recipe.assembly_wage !== undefined) payload.assemblyWage = recipe.assembly_wage || 0;
  if (recipe.packing_wage !== undefined) payload.packingWage = recipe.packing_wage || 0;
  if (recipe.painting_wage !== undefined) payload.paintingWage = recipe.painting_wage != null ? recipe.painting_wage : null;
  if (recipe.surface_treatment_mode !== undefined) payload.surfaceTreatmentMode = recipe.surface_treatment_mode || 'none';
  if (recipe.surface_treatment_cost !== undefined) payload.surfaceTreatmentCost = recipe.surface_treatment_cost || 0;
  if (recipe.management_fee !== undefined) payload.managementFee = recipe.management_fee || 0;
  if (recipe.custom_barrel_length !== undefined) payload.customBarrelLength = recipe.custom_barrel_length ?? null;
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
  if (tpl.shell_model !== undefined) payload.shellModel = tpl.shell_model;
  if (tpl.description !== undefined) payload.description = tpl.description || '';
  if (tpl.parts_json !== undefined) payload.partsJson = tpl.parts_json || '[]';
  if (tpl.assembly_wage !== undefined) payload.assemblyWage = tpl.assembly_wage ?? 0;
  if (tpl.packing_wage !== undefined) payload.packingWage = tpl.packing_wage ?? 0;
  if (tpl.painting_wage !== undefined) payload.paintingWage = tpl.painting_wage ?? null;
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

export const fetchCustomers = async (): Promise<Customer[]> => proxyRequest<Customer[]>('/api/customers');
export const createCustomer = async (data: CustomerInput): Promise<{ success: boolean; id: number }> =>
  proxyRequest<{ success: boolean; id: number }>('/api/customers', { method: 'POST', body: JSON.stringify(data) });
export const updateCustomer = async (id: number, data: CustomerInput): Promise<ApiResponse<never>> =>
  proxyRequest<ApiResponse<never>>(`/api/customers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCustomer = async (id: number): Promise<ApiResponse<never>> =>
  proxyRequest<ApiResponse<never>>(`/api/customers/${id}`, { method: 'DELETE' });

// ====== 报价单 CRUD ======

export const fetchQuotations = async (): Promise<Quotation[]> => proxyRequest<Quotation[]>('/api/quotations');
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
