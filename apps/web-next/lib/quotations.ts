import type { ApiResponse } from './api';
import { createIdempotencyKey, proxyRequest } from './api';
import { getAllCustomers, getAllQuotations, rowToQuotation, type Customer, type Quotation } from './customers';
import type { OrderItem, PurchaseItem, TodoItem } from './orders';
import { getAllParts, type Part } from './parts';
import { getAllRecipes, type Recipe } from './recipes';
import {
  buildRecipeDefaultConfiguration,
  previewRecipeConfiguration,
  type RecipeConfigurationOverrides,
  type RecipeConfigurationPreview,
  type RecipeConfigurationSnapshot,
  type RecipeConfigurationWarning,
  type RecipePackingPart,
  type RecipePackingRole,
} from './recipe-configurations';

export type QuotationStatus = '草稿' | '报价中' | '已接受' | '已拒绝' | '已转订单' | '已过时';
export type QuotationFilter = QuotationStatus | '全部';

export type QuotationItem = {
  id?: string;
  baseRecipeId?: number | '';
  baseRecipeName?: string;
  externalModel?: string;
  spec?: string;
  qty?: number | null;
  overrides?: QuotationItemOverrides;
  configurationOverrides?: RecipeConfigurationOverrides;
  configurationSnapshot?: RecipeConfigurationSnapshot;
  configurationWarnings?: RecipeConfigurationWarning[];
  warnings?: RecipeConfigurationWarning[];
  unitCost?: number;
  margin?: number;
  unitPrice?: number;
  totalPrice?: number | null;
  snapshotVersion?: number;
  snapshotAt?: string;
  bomSnapshot?: Array<Record<string, unknown>>;
  costSnapshot?: {
    version?: number;
    generatedAt?: string;
    unitCost?: number;
    partsCost?: number;
    expenses?: Record<string, unknown>;
  };
};

export type QuotationItemOverrides = RecipeConfigurationOverrides;

export type QuotationPackingRole = RecipePackingRole;
export type QuotationPackingPart = RecipePackingPart;

type QuotationRow = {
  id?: number;
  Id?: number;
  customerId?: number;
  status?: string;
  itemsJson?: string;
  totalCost?: number | null;
  totalPrice?: number | null;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
};

export type QuotationDataset = {
  customers: Customer[];
  quotations: Quotation[];
  recipes: Recipe[];
  parts: Part[];
};

export type QuotationInquirySummaryDraft = {
  preview: true;
  summaryText: string;
  sourceFileIds: number[];
  provider: 'kimi';
  model: string;
  sourceMode: 'original_attachments';
  warnings: string[];
};

export type QuotationOrderDraft = {
  capabilityId: 'workflow.quotation.convert_to_order';
  quotationId: number;
  expectedUpdatedAt: string;
  suggestedIdempotencyKey: string;
  previewHash: string;
  customerName: string;
  contractNo?: string;
  remark?: string;
  status?: string;
  itemQuantities: QuotationItemQuantity[];
  items: OrderItem[];
  purchaseList: PurchaseItem[];
  todos: TodoItem[];
};

export type QuotationItemQuantity = {
  quotationItemId: string;
  qty: number;
};

export type QuotationSavePayloadDraft = {
  customerId: number;
  status: QuotationStatus;
  itemsJson: string;
  totalCost: number | null;
  totalPrice: number | null;
  remark: string;
  attachmentFileIds: number[];
  attachmentSummary: string;
  attachmentSourceFileIds: number[];
  quantitiesConfirmed: boolean;
  preview: true;
  previewHash: string;
  suggestedIdempotencyKey: string;
  changes?: unknown[];
  warnings?: unknown[];
};

export type QuotationInquirySummary = {
  id: number | null;
  quotationId: number;
  customerName: string;
  quotationStatus: string;
  hasRecord: boolean;
  draftText: string;
  sourceFileIds: number[];
  createdAt: string | null;
  updatedAt: string | null;
  availableFiles: Array<{
    id: number;
    originalName: string;
    extension: string;
    detectedType: string;
    mimeType: string;
    fileSize: number;
    parserStatus: string;
    linkedAt: string;
    downloadPath: string;
  }>;
};

export const quotationStatusOptions: QuotationStatus[] = ['草稿', '报价中', '已接受', '已拒绝', '已转订单', '已过时'];

const quotationTransitions: Record<QuotationStatus, QuotationStatus[]> = {
  草稿: ['报价中', '已拒绝'],
  报价中: ['已接受', '已拒绝', '已过时'],
  已接受: [],
  已拒绝: [],
  已转订单: [],
  已过时: [],
};

export function quotationStatusChoices(status: QuotationStatus): QuotationStatus[] {
  return [status, ...quotationTransitions[status]];
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function parseQuotationItems(itemsJson: string | undefined): QuotationItem[] {
  if (!itemsJson) return [];
  try {
    const parsed = JSON.parse(itemsJson);
    return Array.isArray(parsed)
      ? parsed.map((item) => ({
        ...item,
        configurationWarnings: item.configurationWarnings || item.warnings || [],
      }))
      : [];
  } catch {
    return [];
  }
}

export function quotationItemSummary(quotation: Quotation): string {
  const items = parseQuotationItems(quotation.itemsJson);
  if (items.length === 0) return '无明细';
  return items
    .map((item) => {
      const qty = Number(item.qty);
      return Number.isFinite(qty) && qty > 0
        ? `${item.baseRecipeName || '未选配方'} x${qty}`
        : `${item.baseRecipeName || '未选配方'}（数量待确认）`;
    })
    .join(' / ');
}

export function quotationStatusClassName(status: string): string {
  if (status === '已接受') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === '已转订单') return 'border-sky-200 bg-sky-50 text-sky-700';
  if (status === '已拒绝') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === '已过时') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

export function buildCustomerNameMap(customers: Customer[]): Map<number, string> {
  return new Map(customers.map((customer) => [customer.id, customer.name]));
}

export function buildQuotationStats(quotations: Quotation[]) {
  const quotingCount = quotations.filter((quotation) => quotation.status === '报价中').length;
  const acceptedOrConverted = quotations.filter((quotation) =>
    quotation.status === '已接受' || quotation.status === '已转订单'
  ).length;
  const amountKnownCount = quotations.filter((quotation) => quotation.totalPrice != null).length;
  const pendingAmountCount = quotations.length - amountKnownCount;
  const totalCost = quotations.reduce((sum, quotation) => sum + (quotation.totalCost || 0), 0);
  const totalPrice = quotations.reduce((sum, quotation) => sum + (quotation.totalPrice || 0), 0);

  return {
    quoteCount: quotations.length,
    quotingCount,
    acceptedOrConverted,
    totalCost,
    totalPrice,
    totalProfit: totalPrice - totalCost,
    amountKnownCount,
    pendingAmountCount,
  };
}

export function createQuotationItemFromRecipe(recipe: Recipe, margin: number): QuotationItem {
  const unitCost = Math.max(0, Number(recipe.savedTotalCost) || 0);
  const safeMargin = Math.max(0.01, Number(margin) || 1.1);
  const unitPrice = roundMoney(unitCost * safeMargin);
  return {
    id: genId(),
    baseRecipeId: recipe.id,
    baseRecipeName: recipe.name,
    spec: recipe.spec,
    qty: null,
    overrides: buildRecipeDefaultQuotationOverrides(recipe),
    unitCost,
    margin: safeMargin,
    unitPrice,
    totalPrice: null,
  };
}

export function buildRecipeDefaultQuotationOverrides(recipe: Recipe): QuotationItemOverrides {
  return buildRecipeDefaultConfiguration(recipe);
}

export async function previewQuotationItemCost(recipeId: number, overrides: QuotationItemOverrides): Promise<RecipeConfigurationPreview> {
  return previewRecipeConfiguration(recipeId, overrides);
}

export function calculateQuotationTotals(items: QuotationItem[]) {
  const quantitiesConfirmed = items.length > 0 && items.every((item) => (
    Number.isFinite(Number(item.qty)) && Number(item.qty) > 0
  ));
  if (!quantitiesConfirmed) {
    return { totalCost: null, totalPrice: null, quantitiesConfirmed: false };
  }
  const totalCost = items.reduce((sum, item) => sum + (Number(item.unitCost) || 0) * (Number(item.qty) || 0), 0);
  const totalPrice = items.reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.qty) || 0), 0);
  return {
    totalCost: roundMoney(totalCost),
    totalPrice: roundMoney(totalPrice),
    quantitiesConfirmed: true,
  };
}

export async function getQuotationDataset(): Promise<QuotationDataset> {
  const [customers, quotations, recipes, parts] = await Promise.all([
    getAllCustomers(),
    getAllQuotations(),
    getAllRecipes(),
    getAllParts(),
  ]);
  return { customers, quotations, recipes, parts };
}

export async function createQuotation(input: {
  customerId: number;
  status: QuotationStatus;
  items: QuotationItem[];
  remark?: string;
  attachmentFileIds?: number[];
  attachmentSummary?: string;
  attachmentSourceFileIds?: number[];
}): Promise<Quotation> {
  const payload = await buildQuotationSavePayloadDraft(input);
  const result = await proxyRequest<ApiResponse<QuotationRow>>('/api/quotations', {
    method: 'POST',
    headers: { 'Idempotency-Key': payload.suggestedIdempotencyKey },
    body: JSON.stringify({
      ...payload,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '报价创建失败');
  return rowToQuotation(result.data);
}

export async function updateQuotation(input: {
  id: number;
  customerId: number;
  status: QuotationStatus;
  items: QuotationItem[];
  remark?: string;
  expectedUpdatedAt?: string;
}): Promise<Quotation> {
  if (!input.expectedUpdatedAt) throw new Error('报价版本缺失，请刷新列表后再保存');
  const payload = await buildQuotationSavePayloadDraft(input);
  const result = await proxyRequest<ApiResponse<QuotationRow>>(`/api/quotations/${input.id}`, {
    method: 'PATCH',
    headers: { 'Idempotency-Key': payload.suggestedIdempotencyKey },
    body: JSON.stringify({
      ...payload,
      expectedUpdatedAt: input.expectedUpdatedAt,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '报价保存失败');
  return rowToQuotation(result.data);
}

export async function buildQuotationSavePayloadDraft(input: {
  customerId: number;
  status: QuotationStatus;
  items: QuotationItem[];
  remark?: string;
  attachmentFileIds?: number[];
  attachmentSummary?: string;
  attachmentSourceFileIds?: number[];
}): Promise<QuotationSavePayloadDraft> {
  const result = await proxyRequest<ApiResponse<QuotationSavePayloadDraft>>('/api/quotations/save-payload-draft', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '生成报价保存草稿失败');
  return result.data;
}

export async function getQuotationInquirySummary(quotationId: number): Promise<QuotationInquirySummary> {
  const result = await proxyRequest<ApiResponse<QuotationInquirySummary>>(
    `/api/quotations/${quotationId}/inquiry-summary`
  );
  if (!result.success || !result.data) throw new Error(result.error || '读取询价资料失败');
  return result.data;
}

export async function generateQuotationInquirySummaryDraft(input: {
  fileIds: number[];
  customerName?: string;
}): Promise<QuotationInquirySummaryDraft> {
  const result = await proxyRequest<ApiResponse<QuotationInquirySummaryDraft>>(
    '/api/quotations/inquiry-summary-draft',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  if (!result.success || !result.data) throw new Error(result.error || 'Kimi 读取询价附件失败');
  return result.data;
}

export async function updateQuotationStatus(quotation: Quotation, status: QuotationStatus): Promise<Quotation> {
  if (!quotation.updatedAt) throw new Error('报价版本缺失，请刷新列表后再修改状态');
  const result = await proxyRequest<ApiResponse<QuotationRow>>(`/api/quotations/${quotation.id}/status`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`quotation-status:${quotation.id}`),
    },
    body: JSON.stringify({ status, expectedUpdatedAt: quotation.updatedAt }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '报价状态保存失败');
  return rowToQuotation(result.data);
}

export async function deleteQuotation(quotation: Quotation): Promise<void> {
  if (!quotation.updatedAt) throw new Error('报价版本缺失，请刷新列表后再删除');
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/quotations/${quotation.id}`, {
    method: 'DELETE',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`quotation-delete:${quotation.id}`),
    },
    body: JSON.stringify({ expectedUpdatedAt: quotation.updatedAt }),
  });
  if (!result.success) throw new Error(result.error || '报价删除失败');
}

export async function buildQuotationOrderDraft(
  quotationId: number,
  itemQuantities: QuotationItemQuantity[],
): Promise<QuotationOrderDraft> {
  const result = await proxyRequest<ApiResponse<QuotationOrderDraft>>(`/api/quotations/${quotationId}/order-draft`, {
    method: 'POST',
    body: JSON.stringify({ itemQuantities }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '报价转订单草稿生成失败');
  return result.data;
}

export async function convertQuotationToOrder(input: {
  quotation: Quotation;
  customer?: Customer;
  recipes?: Recipe[];
  draft?: QuotationOrderDraft;
}): Promise<void> {
  const idempotencyKey = input.draft?.suggestedIdempotencyKey
    || createIdempotencyKey(`quotation-convert:${input.quotation.id}`);
  const expectedUpdatedAt = input.draft?.expectedUpdatedAt || input.quotation.updatedAt;
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/quotations/${input.quotation.id}/convert`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      expectedUpdatedAt,
      ...(input.draft?.previewHash ? { previewHash: input.draft.previewHash } : {}),
      ...(input.draft?.itemQuantities ? { itemQuantities: input.draft.itemQuantities } : {}),
    }),
  });
  if (!result.success) throw new Error(result.error || '报价转订单失败');
}
