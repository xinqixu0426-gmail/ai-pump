import {
  Part,
  Recipe,
  RecipePart,
  RecipeCostDraftResult,
  RecipeBomDraftResult,
  CostResult,
  ApiResponse,
  PumpShellTemplate,
  PumpModelVariant,
  BusinessSummary,
  Customer,
  CustomerInput,
  DynamicCostOverrides,
  DynamicCostResult,
  Quotation,
  QuotationInput,
  OrderItem,
  PurchaseItem,
  TodoItem,
} from '../types';
import { DEFAULT_COIL_MATERIAL } from './businessRules';

// ─── 通用请求封装 ─────────────────────────────
// 统一代理请求入口，在此集中处理 401 和重定向
export const API_BASE = import.meta.env.VITE_API_URL || '';

interface ProxyOptions {
  redirectOnUnauthorized?: boolean;
  throwOnError?: boolean;
}

type EntityCreateResponse = ApiResponse<{ id?: number }>;
type LegacyEntityShape = {
  id?: number;
  Id?: number;
  createdAt?: string;
  CreatedAt?: string;
  updatedAt?: string;
  UpdatedAt?: string;
};

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

function unwrapCreatedId(response: EntityCreateResponse): number {
  const id = response.data?.id;
  if (!response.success || !id) throw new Error(response.error || '创建失败');
  return id;
}

function normalizeLegacyEntity<T extends LegacyEntityShape>(item: T): T {
  if (!item) return item;
  const id = item.Id ?? item.id;
  const createdAt = item.CreatedAt ?? item.createdAt;
  const updatedAt = item.UpdatedAt ?? item.updatedAt;
  return {
    ...item,
    ...(id !== undefined ? { id, Id: id } : {}),
    ...(createdAt !== undefined ? { createdAt, CreatedAt: createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt, UpdatedAt: updatedAt } : {}),
  } as T;
}

function normalizeLegacyEntities<T extends LegacyEntityShape>(items: T[]): T[] {
  return items.map(normalizeLegacyEntity);
}

export async function getAllParts(): Promise<Part[]> {
  const res = await proxyRequest<{ success: boolean; data: Part[] }>('/api/parts');
  return normalizeLegacyEntities(res.data || []);
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
  return normalizeLegacyEntity(res.data);
}

export async function updatePart(id: number, part: Partial<Part>): Promise<Part> {
  const record: Record<string, unknown> = {};
  if (part.model !== undefined) record.model = part.model;
  if (part.category !== undefined) record.category = part.category;
  if (part.price !== undefined) record.price = part.price;
  if (part.supplier !== undefined) record.supplier = part.supplier;
  if (part.stock !== undefined) record.stock = part.stock;
  if (part.notes !== undefined) record.notes = part.notes;

  const res = await proxyRequest<{ success: boolean; data: Part }>(`/api/parts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(record),
  });
  return normalizeLegacyEntity(res.data);
}

export async function deletePart(id: number): Promise<void> {
  await proxyRequest(`/api/parts/${id}`, { method: 'DELETE' });
}

export async function deleteParts(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await Promise.all(ids.map((id) => deletePart(id)));
}

export async function generatePurchasePlan(items: OrderItem[]): Promise<{ purchaseList: PurchaseItem[]; todos: TodoItem[] }> {
  const result = await proxyRequest<ApiResponse<{ purchaseList: PurchaseItem[]; todos: TodoItem[] }>>('/api/orders/purchase-plan', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || '生成采购清单失败');
  }
  return result.data;
}

export async function produceRecipe(recipeId: number, produceQty: number): Promise<void> {
  const id = Number(recipeId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('非法配方 ID');
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/recipes/${id}/produce`, {
    method: 'POST',
    body: JSON.stringify({ produceQty }),
  });
  if (!result.success) throw new Error(result.error || '生产扣库存失败');
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
  if (recipe.coilMaterial !== undefined) payload.coilMaterial = recipe.coilMaterial || DEFAULT_COIL_MATERIAL;
  if (recipe.hasFloat !== undefined) payload.hasFloat = recipe.hasFloat || 0;
  if (recipe.floatWire !== undefined) payload.floatWire = recipe.floatWire || '';
  if (recipe.floatAccessoryType !== undefined) payload.floatAccessoryType = recipe.floatAccessoryType || 'standard';
  if (recipe.hasCable !== undefined) payload.hasCable = recipe.hasCable || 0;
  if (recipe.cableLength !== undefined) payload.cableLength = recipe.cableLength || 0;
  if (recipe.cableWire !== undefined) payload.cableWire = recipe.cableWire || '';
  if (recipe.cableAccessoryType !== undefined) payload.cableAccessoryType = recipe.cableAccessoryType || 'standard';
  if (recipe.extraPartsJson !== undefined) payload.extraPartsJson = recipe.extraPartsJson || '[]';
  if (recipe.packingPartsJson !== undefined) payload.packingPartsJson = recipe.packingPartsJson || '[]';
  if (recipe.assemblyWage !== undefined) payload.assemblyWage = recipe.assemblyWage || 0;
  if (recipe.packingWage !== undefined) payload.packingWage = recipe.packingWage || 0;
  if (recipe.paintingWage !== undefined) payload.paintingWage = recipe.paintingWage != null ? recipe.paintingWage : null;
  if (recipe.surfaceTreatmentMode !== undefined) payload.surfaceTreatmentMode = recipe.surfaceTreatmentMode || 'none';
  if (recipe.surfaceTreatmentCost !== undefined) payload.surfaceTreatmentCost = recipe.surfaceTreatmentCost || 0;
  if (recipe.managementFee !== undefined) payload.managementFee = recipe.managementFee || 0;
  if (recipe.customBarrelLength !== undefined) payload.customBarrelLength = recipe.customBarrelLength ?? null;
  if (recipe.modelVariantId !== undefined) payload.modelVariantId = recipe.modelVariantId ?? null;
  if (recipe.impellerModel !== undefined) payload.impellerModel = recipe.impellerModel || '';
  if (recipe.impellerThickness !== undefined) payload.impellerThickness = recipe.impellerThickness ?? null;
  if (recipe.impellerDiameter !== undefined) payload.impellerDiameter = recipe.impellerDiameter ?? null;
  if (recipe.impellerBladeCount !== undefined) payload.impellerBladeCount = recipe.impellerBladeCount ?? null;
  if (recipe.technicalDataJson !== undefined) payload.technicalDataJson = recipe.technicalDataJson || '{}';
  return payload;
}

export async function getAllRecipes(): Promise<Recipe[]> {
  const res = await proxyRequest<{ success: boolean; data: Recipe[] }>('/api/recipes');
  return normalizeLegacyEntities(res.data || []);
}

export async function createRecipe(recipe: Omit<Recipe, 'Id'>): Promise<Recipe> {
  const res = await proxyRequest<{ success: boolean; data: Recipe }>('/api/recipes', {
    method: 'POST',
    body: JSON.stringify(recipeToApiPayload(recipe)),
  });
  return normalizeLegacyEntity(res.data);
}

export async function deleteRecipe(id: number): Promise<void> {
  await proxyRequest(`/api/recipes/${id}`, { method: 'DELETE' });
}

export async function updateRecipe(id: number, recipe: Partial<Omit<Recipe, 'Id'>>): Promise<Recipe> {
  const res = await proxyRequest<{ success: boolean; data: Recipe }>(`/api/recipes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(recipeToApiPayload(recipe)),
  });
  return normalizeLegacyEntity(res.data);
}

// ─── 成本计算 ─────────────────────────────────

export async function calculateCost(parts: RecipePart[]): Promise<CostResult> {
  if (!parts || parts.length === 0) {
    return { totalCost: '0.00', itemCount: 0, details: [], missingParts: [] };
  }

  const result = await proxyRequest<ApiResponse<CostResult>>('/api/cost/parts', {
    method: 'POST',
    body: JSON.stringify({ parts }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || '计算成本失败');
  }
  return result.data;
}

export async function getCopperPrice(): Promise<{ livePrice: number; livePricePerKg: string; dbPrice: number | string | null; lastUpdate?: string | null }> {
  const result = await proxyRequest<ApiResponse<{ livePrice: number; livePricePerKg: string; dbPrice: number | string | null; lastUpdate?: string | null }>>('/api/copper-price');
  if (!result.success || !result.data) {
    throw new Error(result.error || '获取铜价失败');
  }
  return result.data;
}

export async function previewRecipeCostDraft(input: {
  parts: RecipePart[];
  assemblyWage?: number;
  packingWage?: number;
  surfaceTreatmentMode?: string;
  surfaceTreatmentCost?: number;
  managementFee?: number;
  coilMaterial?: string;
  customBarrelLength?: number | string | null;
  longScrewExtraLength?: number | string;
}): Promise<RecipeCostDraftResult> {
  const result = await proxyRequest<ApiResponse<RecipeCostDraftResult>>('/api/recipes/cost-draft', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || '生成配方成本快照失败');
  }
  return result.data;
}

export async function previewRecipeBomDraft(input: {
  templateId?: number | null;
  modelVariantId?: number | null;
  customBarrelLength?: number | string | null;
  longScrewExtraLength?: number | string;
  coilSpec?: string;
  coilSheets?: number | string;
  coilMaterial?: string;
  coilResult?: {
    totalCost: number;
    material?: string;
    unitPrice?: number;
    source?: string;
    formula?: string;
  };
  capacitorModel?: string;
  optionalParts?: Array<{ model: string; supplier?: string; qty?: number }>;
  hasFloat?: boolean | number;
  floatWire?: string;
  floatAccessoryType?: string;
  floatAccessoryDelta?: number;
  hasCable?: boolean | number;
  cableLength?: number | string;
  cableWire?: string;
  cableAccessoryType?: string;
  packingParts?: Array<{ model: string; supplier?: string; qty?: number; snapshotPrice?: number; costSource?: string; packagingMaterial?: string }>;
}): Promise<RecipeBomDraftResult> {
  const result = await proxyRequest<ApiResponse<RecipeBomDraftResult>>('/api/recipes/bom-draft', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || '生成配方 BOM 草稿失败');
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
  return normalizeLegacyEntities(res.data || []);
}

export async function createTemplate(tpl: Omit<PumpShellTemplate, 'Id'>): Promise<PumpShellTemplate> {
  const res = await proxyRequest<{ success: boolean; data: PumpShellTemplate }>('/api/templates', {
    method: 'POST',
    body: JSON.stringify(templateToApiPayload(tpl)),
  });
  return normalizeLegacyEntity(res.data);
}

export async function updateTemplate(id: number, tpl: Partial<Omit<PumpShellTemplate, 'Id'>>): Promise<PumpShellTemplate> {
  const res = await proxyRequest<{ success: boolean; data: PumpShellTemplate }>(`/api/templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(templateToApiPayload(tpl)),
  });
  return normalizeLegacyEntity(res.data);
}

export async function deleteTemplate(id: number): Promise<void> {
  await proxyRequest(`/api/templates/${id}`, { method: 'DELETE' });
}

function modelVariantToApiPayload(variant: Partial<Omit<PumpModelVariant, 'Id'>>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (variant.modelName !== undefined) payload.modelName = variant.modelName;
  if (variant.templateId !== undefined) payload.templateId = variant.templateId;
  if (variant.coilSpec !== undefined) payload.coilSpec = variant.coilSpec || '';
  if (variant.coilSheets !== undefined) payload.coilSheets = variant.coilSheets || 0;
  if (variant.coilMaterial !== undefined) payload.coilMaterial = variant.coilMaterial || DEFAULT_COIL_MATERIAL;
  if (variant.barrelLength !== undefined) payload.barrelLength = variant.barrelLength ?? null;
  if (variant.longScrewExtraLength !== undefined) payload.longScrewExtraLength = variant.longScrewExtraLength || 0;
  if (variant.impellerModel !== undefined) payload.impellerModel = variant.impellerModel || '';
  if (variant.impellerThickness !== undefined) payload.impellerThickness = variant.impellerThickness ?? null;
  if (variant.impellerDiameter !== undefined) payload.impellerDiameter = variant.impellerDiameter ?? null;
  if (variant.impellerBladeCount !== undefined) payload.impellerBladeCount = variant.impellerBladeCount ?? null;
  if (variant.note !== undefined) payload.note = variant.note || '';
  if (variant.customFieldsJson !== undefined) payload.customFieldsJson = variant.customFieldsJson || '[]';
  return payload;
}

export async function getAllModelVariants(): Promise<PumpModelVariant[]> {
  const res = await proxyRequest<{ success: boolean; data: PumpModelVariant[] }>('/api/model-variants');
  return normalizeLegacyEntities(res.data || []);
}

export async function createModelVariant(variant: Omit<PumpModelVariant, 'Id'>): Promise<PumpModelVariant> {
  const res = await proxyRequest<{ success: boolean; data: PumpModelVariant }>('/api/model-variants', {
    method: 'POST',
    body: JSON.stringify(modelVariantToApiPayload(variant)),
  });
  return normalizeLegacyEntity(res.data);
}

export async function updateModelVariant(id: number, variant: Partial<Omit<PumpModelVariant, 'Id'>>): Promise<PumpModelVariant> {
  const res = await proxyRequest<{ success: boolean; data: PumpModelVariant }>(`/api/model-variants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(modelVariantToApiPayload(variant)),
  });
  return normalizeLegacyEntity(res.data);
}

export async function deleteModelVariant(id: number): Promise<void> {
  await proxyRequest(`/api/model-variants/${id}`, { method: 'DELETE' });
}

// ====== 客户 CRUD ======

export const fetchCustomers = async (): Promise<Customer[]> => {
  const res = await proxyRequest<ApiResponse<Customer[]>>('/api/customers');
  return normalizeLegacyEntities(res.data || []);
};
export const createCustomer = async (data: CustomerInput): Promise<{ success: boolean; id: number }> => {
  const res = await proxyRequest<EntityCreateResponse>('/api/customers', { method: 'POST', body: JSON.stringify(data) });
  return { success: true, id: unwrapCreatedId(res) };
};
export const updateCustomer = async (id: number, data: CustomerInput): Promise<ApiResponse<never>> =>
  proxyRequest<ApiResponse<never>>(`/api/customers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCustomer = async (id: number): Promise<ApiResponse<never>> =>
  proxyRequest<ApiResponse<never>>(`/api/customers/${id}`, { method: 'DELETE' });

// ====== 报价单 CRUD ======

export const fetchQuotations = async (): Promise<Quotation[]> => {
  const res = await proxyRequest<ApiResponse<Quotation[]>>('/api/quotations');
  return normalizeLegacyEntities(res.data || []);
};

async function buildQuotationSavePayloadDraft(data: QuotationInput): Promise<Record<string, unknown>> {
  if (!data.items) return data as unknown as Record<string, unknown>;
  const res = await proxyRequest<ApiResponse<Record<string, unknown>>>('/api/quotations/save-payload-draft', {
    method: 'POST',
    body: JSON.stringify({
      customerId: data.customerId,
      status: data.status,
      items: data.items,
      remark: data.remark,
    }),
  });
  if (!res.success || !res.data) throw new Error(res.error || '生成报价保存草稿失败');
  return res.data;
}

export const createQuotation = async (data: QuotationInput): Promise<{ success: boolean; id: number }> => {
  const payload = await buildQuotationSavePayloadDraft(data);
  const res = await proxyRequest<EntityCreateResponse>('/api/quotations', { method: 'POST', body: JSON.stringify(payload) });
  return { success: true, id: unwrapCreatedId(res) };
};
export const updateQuotation = async (id: number, data: QuotationInput | Partial<QuotationInput>): Promise<ApiResponse<never>> => {
  const payload = data.items ? await buildQuotationSavePayloadDraft(data as QuotationInput) : data;
  return proxyRequest<ApiResponse<never>>(`/api/quotations/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
};
export const deleteQuotation = async (id: number): Promise<ApiResponse<never>> =>
  proxyRequest<ApiResponse<never>>(`/api/quotations/${id}`, { method: 'DELETE' });

export async function buildOrderDraftFromQuotation(quotationId: number): Promise<{
  customerName: string;
  contractNo?: string;
  remark?: string;
  items: OrderItem[];
  purchaseList: PurchaseItem[];
  todos: TodoItem[];
}> {
  const res = await proxyRequest<ApiResponse<{
    customerName: string;
    contractNo?: string;
    remark?: string;
    items: OrderItem[];
    purchaseList: PurchaseItem[];
    todos: TodoItem[];
  }>>(`/api/quotations/${quotationId}/order-draft`, { method: 'POST' });
  if (!res.success || !res.data) throw new Error(res.error || '报价转订单草稿生成失败');
  return res.data;
}

export const dynamicCalculateCost = async (baseRecipeId: number, overrides: DynamicCostOverrides): Promise<DynamicCostResult> =>
  proxyRequest<{ success: boolean; data: DynamicCostResult }>(`/api/recipes/${baseRecipeId}/cost-preview`, { method: 'POST', body: JSON.stringify({ overrides }) })
    .then(res => res.data);

export async function getWorkbenchSummary(): Promise<BusinessSummary | null> {
  const res = await proxyRequest<ApiResponse<BusinessSummary>>('/api/workbench/summary');
  return res.data || null;
}
