import type { ApiResponse } from './api';
import { createIdempotencyKey, proxyRequest } from './api';

export type CoilRecord = {
  id: number;
  statorVariantId?: number | null;
  spec: string;
  diameterMm: number;
  commonName: string;
  material: string;
  slotType: '小眼' | '国标眼';
  sheets: number;
  schemeName: string;
  schemeCode: string;
  schemeStatus: 'testing' | 'official' | 'disabled';
  isDefault: boolean;
  ratedVoltageV?: number | null;
  ratedFrequencyHz?: number | null;
  market: string;
  schemeFamilyCode: string;
  pricingMode: 'calculated' | 'kit';
  kitPrice: number;
  unitPrice: number;
  wireWeight: number;
  copperBase: number;
  coilFee: number;
  rotorFee: number;
  cost: number;
  stock: number;
  defaultWireGauge?: string | null;
  defaultCapacitor?: string | null;
  mainWireGauge?: string | null;
  mainWireData?: string | null;
  auxWireGauge?: string | null;
  auxWireData?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CoilInput = {
  spec: string;
  diameterMm: number;
  material: string;
  slotType: '小眼' | '国标眼';
  sheets: number;
  schemeName: string;
  schemeCode?: string;
  schemeStatus: 'testing' | 'official' | 'disabled';
  isDefault?: boolean;
  ratedVoltageV?: number | null;
  ratedFrequencyHz?: number | null;
  market?: string;
  schemeFamilyCode?: string;
  pricingMode: 'calculated' | 'kit';
  kitPrice?: number;
  unitPrice?: number;
  wireWeight: number;
  copperBase: number;
  coilFee: number;
  rotorFee: number;
  defaultWireGauge?: string;
  defaultCapacitor?: string;
  mainWireGauge?: string;
  mainWireData?: string;
  auxWireGauge?: string;
  auxWireData?: string;
};

export type CoilCalcInput = {
  coilId?: number | null;
  schemeCode?: string;
  schemeFamilyCode?: string;
  spec: string;
  material?: string;
  slotType?: '小眼' | '国标眼';
  sheets: number;
  wireWeight?: number;
};

export type CoilCalcResult = {
  coilId?: number | null;
  schemeCode?: string;
  schemeName?: string;
  isDefault?: boolean;
  ratedVoltageV?: number | null;
  ratedFrequencyHz?: number | null;
  market?: string;
  schemeFamilyCode?: string;
  spec: string;
  material: string;
  slotType: '小眼' | '国标眼';
  diameterMm: number;
  sheets: number;
  pricingMode: 'calculated' | 'kit';
  kitPrice: number;
  unitPrice: number;
  wireWeight: number;
  copperBase: number;
  coilFee: number;
  rotorFee: number;
  wireGauge?: string | null;
  capacitor?: string | null;
  totalCost: number;
  formula: string;
  source: string;
  isCustomWireWeight?: boolean;
};

export type CoilStockMovement = {
  id: number;
  coilId: number;
  changeQty: number;
  balanceAfter: number;
  movementType: string;
  referenceType: string;
  referenceId: string;
  note: string;
  createdAt: string;
};

export type CoilSpecDraft = {
  spec: string;
  diameterMm: number;
  material: string;
  slotType: '小眼' | '国标眼';
  pricingMode: 'calculated' | 'kit';
  kitPrice: number;
  unitPrice: number;
  wireWeight: number | null;
  copperBase: number | null;
  coilFee: number | null;
  rotorFee: number | null;
  defaultWireGauge: string;
  defaultCapacitor: string;
  source: string;
  referenceCoilId: number | null;
  exactMaterial: boolean;
  exactVariant: boolean;
};

export type StatorVariant = {
  id: number;
  diameterMm: number;
  commonName: string;
  material: string;
  slotType: '小眼' | '国标眼';
};

export type MarketIndicators = {
  copper: {
    livePrice: string | number;
    livePricePerKg: string | number;
    dbPrice?: string | number | null;
    lastUpdate?: string | null;
    source?: string;
    sourceOfTruth?: string;
    asOf?: string;
  };
  aluminum: {
    livePrice: string | number;
    livePricePerKg: string | number;
    dbPrice?: string | number | null;
    lastUpdate?: string | null;
  };
  exchangeRate: {
    base?: string;
    quote?: string;
    liveRate: string | number;
    dbRate?: string | number | null;
    lastUpdate?: string | null;
    sourceDate?: string | null;
  };
  fetchedAt?: string;
  stale?: boolean;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  asOf?: string;
  sourceOfTruth?: string;
  sources?: Record<string, string>;
};

export type MarketIndicatorsUpdateResult = {
  copperPricePerTon: string | number;
  copperPricePerKg: string | number;
  updatedCount: number;
  aluminumPricePerTon: string | number;
  aluminumPricePerKg: string | number;
  usdCnyRate: string | number;
  operationId?: string;
  status?: string;
  changes?: unknown[];
  warnings?: unknown[];
  auditId?: number | null;
  idempotentReplay?: boolean;
  fetchedAt?: string;
  sourceOfTruth?: string;
  sources?: Record<string, string>;
};

type CoilRow = Partial<CoilRecord> & {
  Id?: number;
  CreatedAt?: string;
  UpdatedAt?: string;
};

function rowId(row: { id?: number; Id?: number }): number {
  return row.id ?? row.Id ?? 0;
}

export function rowToCoil(row: CoilRow): CoilRecord {
  return {
    id: rowId(row),
    spec: row.spec || '',
    statorVariantId: row.statorVariantId || null,
    diameterMm: Number(row.diameterMm) || (row.spec === '12' ? 120 : Number(row.spec) || 0),
    commonName: row.commonName || row.spec || '',
    material: row.material || '钢带',
    slotType: row.slotType === '国标眼' ? '国标眼' : '小眼',
    sheets: Number(row.sheets) || 0,
    schemeName: row.schemeName || '',
    schemeCode: row.schemeCode || `COIL-${String(rowId(row)).padStart(4, '0')}`,
    schemeStatus: row.schemeStatus === 'testing' || row.schemeStatus === 'disabled' ? row.schemeStatus : 'official',
    isDefault: Boolean(row.isDefault),
    ratedVoltageV: row.ratedVoltageV == null ? null : Number(row.ratedVoltageV),
    ratedFrequencyHz: row.ratedFrequencyHz == null ? null : Number(row.ratedFrequencyHz),
    market: row.market || '',
    schemeFamilyCode: row.schemeFamilyCode || '',
    pricingMode: row.pricingMode === 'kit' ? 'kit' : 'calculated',
    kitPrice: Number(row.kitPrice) || 0,
    unitPrice: Number(row.unitPrice) || 0,
    wireWeight: Number(row.wireWeight) || 0,
    copperBase: Number(row.copperBase) || 0,
    coilFee: Number(row.coilFee) || 0,
    rotorFee: Number(row.rotorFee) || 0,
    cost: Number(row.cost) || 0,
    stock: Number(row.stock) || 0,
    defaultWireGauge: row.defaultWireGauge || '',
    defaultCapacitor: row.defaultCapacitor || '',
    mainWireGauge: row.mainWireGauge || '',
    mainWireData: row.mainWireData || '',
    auxWireGauge: row.auxWireGauge || '',
    auxWireData: row.auxWireData || '',
    createdAt: row.createdAt || row.CreatedAt,
    updatedAt: row.updatedAt || row.UpdatedAt,
  };
}

export async function getAllCoils(signal?: AbortSignal): Promise<CoilRecord[]> {
  const result = await proxyRequest<ApiResponse<CoilRow[]>>('/api/coils', { signal });
  if (!result.success) throw new Error(result.error || '线圈数据加载失败');
  return (result.data || []).map(rowToCoil);
}

export async function updateCoilSpecPrice(spec: string, material: string, slotType: string, unitPrice: number): Promise<number> {
  const previewResult = await proxyRequest<ApiResponse<{
    previewHash: string;
    suggestedIdempotencyKey: string;
  }>>('/api/coils/spec-price-preview', {
    method: 'POST',
    body: JSON.stringify({ spec, material, slotType, unitPrice }),
  });
  if (!previewResult.success || !previewResult.data) {
    throw new Error(previewResult.error || '规格单价预览失败');
  }
  const preview = previewResult.data;
  const result = await proxyRequest<ApiResponse<unknown> & { updated?: number }>(`/api/coils/spec/${encodeURIComponent(spec)}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': preview.suggestedIdempotencyKey,
    },
    body: JSON.stringify({
      material,
      slotType,
      unitPrice,
      previewHash: preview.previewHash,
    }),
  });
  if (!result.success) throw new Error(result.error || '规格单价保存失败');
  return Number(result.updated) || 0;
}

export async function getMarketIndicators(): Promise<MarketIndicators> {
  const result = await proxyRequest<ApiResponse<MarketIndicators>>('/api/market-indicators');
  if (!result.success || !result.data) throw new Error(result.error || '市场指标加载失败');
  return result.data;
}

export async function updateMarketIndicators(): Promise<MarketIndicatorsUpdateResult> {
  const idempotencyKey = createIdempotencyKey('market-indicators-sync');
  const result = await proxyRequest<ApiResponse<MarketIndicatorsUpdateResult>>('/api/market-indicators/update', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
  });
  if (!result.success || !result.data) throw new Error(result.error || '市场指标同步失败');
  return result.data;
}

export async function calculateCoilCost(input: CoilCalcInput): Promise<CoilCalcResult> {
  const result = await proxyRequest<ApiResponse<CoilCalcResult>>('/api/coils/calculate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '线圈成本试算失败');
  return result.data;
}

export async function getCoilSpecDraft(spec: string, diameterMm: number, material: string, slotType: string): Promise<CoilSpecDraft> {
  const result = await proxyRequest<ApiResponse<CoilSpecDraft>>('/api/coils/spec-draft', {
    method: 'POST',
    body: JSON.stringify({ spec, diameterMm, material, slotType }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '线圈规格草稿生成失败');
  return result.data;
}

export async function getStatorVariants(): Promise<StatorVariant[]> {
  const result = await proxyRequest<ApiResponse<StatorVariant[]>>('/api/coils/variants');
  if (!result.success) throw new Error(result.error || '定子组合加载失败');
  return result.data || [];
}

export async function createCoil(input: CoilInput): Promise<CoilRecord> {
  const result = await proxyRequest<ApiResponse<CoilRow>>('/api/coils', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey('coil-create'),
    },
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '线圈记录创建失败');
  return rowToCoil(result.data);
}

export async function updateCoil(coil: CoilRecord, input: CoilInput): Promise<CoilRecord> {
  if (!coil.updatedAt) throw new Error('线圈版本缺失，请刷新列表后再保存');
  const result = await proxyRequest<ApiResponse<CoilRow>>(`/api/coils/${coil.id}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`coil-update:${coil.id}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: coil.updatedAt,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '线圈记录保存失败');
  return rowToCoil(result.data);
}

export async function deleteCoil(coil: CoilRecord): Promise<void> {
  if (!coil.updatedAt) throw new Error('线圈版本缺失，请刷新列表后再删除');
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/coils/${coil.id}`, {
    method: 'DELETE',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`coil-delete:${coil.id}`),
    },
    body: JSON.stringify({ expectedUpdatedAt: coil.updatedAt }),
  });
  if (!result.success) throw new Error(result.error || '线圈记录删除失败');
}

export async function getCoilStockMovements(id: number, limit = 20): Promise<CoilStockMovement[]> {
  const result = await proxyRequest<ApiResponse<CoilStockMovement[]>>(`/api/coils/${id}/stock-movements?limit=${limit}`);
  if (!result.success) throw new Error(result.error || '线圈库存流水加载失败');
  return result.data || [];
}

export async function adjustCoilStock(
  id: number,
  changeQty: number,
  note = '',
  expectedUpdatedAt?: string
): Promise<CoilRecord> {
  const previewResult = await proxyRequest<ApiResponse<{
    confirmationToken: string;
    suggestedIdempotencyKey: string;
    operationId: string;
  }>>('/api/coils/stock-adjustments-preview', {
    method: 'POST',
    body: JSON.stringify({
      adjustments: [{ coilId: id, changeQty, expectedUpdatedAt }],
      note,
    }),
  });
  if (!previewResult.success || !previewResult.data?.confirmationToken) {
    throw new Error(previewResult.error || '线圈库存调整预览失败');
  }
  const preview = previewResult.data;
  const result = await proxyRequest<ApiResponse<{
    adjustments: Array<{ coil: CoilRow }>;
  }>>('/api/coils/stock-adjustments', {
    method: 'POST',
    headers: {
      'Idempotency-Key': preview.suggestedIdempotencyKey,
      'X-Operation-ID': preview.operationId,
    },
    body: JSON.stringify({ confirmationToken: preview.confirmationToken }),
  });
  const coil = result.data?.adjustments?.[0]?.coil;
  if (!result.success || !coil) throw new Error(result.error || '线圈库存调整失败');
  return rowToCoil(coil);
}
