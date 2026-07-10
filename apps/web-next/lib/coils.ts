import type { ApiResponse } from './api';
import { proxyRequest } from './api';

export type CoilRecord = {
  id: number;
  spec: string;
  material: string;
  sheets: number;
  unitPrice: number;
  wireWeight: number;
  copperBase: number;
  coilFee: number;
  rotorFee: number;
  cost: number;
  defaultWireGauge?: string | null;
  defaultCapacitor?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CoilInput = {
  spec: string;
  material: string;
  sheets: number;
  unitPrice?: number;
  wireWeight: number;
  copperBase: number;
  coilFee: number;
  rotorFee: number;
  defaultWireGauge?: string;
  defaultCapacitor?: string;
};

export type CoilCalcInput = {
  spec: string;
  material?: string;
  sheets: number;
  wireWeight?: number;
};

export type CoilCalcResult = {
  spec: string;
  material: string;
  sheets: number;
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

export type CoilSpecDraft = {
  spec: string;
  material: string;
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
};

export type MarketIndicators = {
  copper: {
    livePrice: string | number;
    livePricePerKg: string | number;
    dbPrice?: string | number | null;
    lastUpdate?: string | null;
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
};

export type MarketIndicatorsUpdateResult = {
  copperPricePerTon: string | number;
  copperPricePerKg: string | number;
  updatedCount: number;
  aluminumPricePerTon: string | number;
  aluminumPricePerKg: string | number;
  usdCnyRate: string | number;
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
    material: row.material || '钢带',
    sheets: Number(row.sheets) || 0,
    unitPrice: Number(row.unitPrice) || 0,
    wireWeight: Number(row.wireWeight) || 0,
    copperBase: Number(row.copperBase) || 0,
    coilFee: Number(row.coilFee) || 0,
    rotorFee: Number(row.rotorFee) || 0,
    cost: Number(row.cost) || 0,
    defaultWireGauge: row.defaultWireGauge || '',
    defaultCapacitor: row.defaultCapacitor || '',
    createdAt: row.createdAt || row.CreatedAt,
    updatedAt: row.updatedAt || row.UpdatedAt,
  };
}

export async function getAllCoils(): Promise<CoilRecord[]> {
  const result = await proxyRequest<ApiResponse<CoilRow[]>>('/api/coils');
  if (!result.success) throw new Error(result.error || '线圈数据加载失败');
  return (result.data || []).map(rowToCoil);
}

export async function getCoilMaterials(): Promise<{ defaultMaterial: string; materials: string[]; materialPrices: Record<string, number> }> {
  const result = await proxyRequest<ApiResponse<{ defaultMaterial: string; materials: string[]; materialPrices: Record<string, number> }>>('/api/coils/materials');
  if (!result.success || !result.data) throw new Error(result.error || '材质配置加载失败');
  return result.data;
}

export async function saveCoilMaterialPrices(materialPrices: Record<string, number>): Promise<Record<string, number>> {
  const result = await proxyRequest<ApiResponse<{ materialPrices: Record<string, number> }>>('/api/coils/materials', {
    method: 'PUT',
    body: JSON.stringify({ materialPrices }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '材质单价配置保存失败');
  return result.data.materialPrices || {};
}

export async function updateCoilSpecPrice(spec: string, material: string, unitPrice: number): Promise<number> {
  const result = await proxyRequest<ApiResponse<unknown> & { updated?: number }>(`/api/coils/spec/${encodeURIComponent(spec)}`, {
    method: 'PATCH',
    body: JSON.stringify({ material, unitPrice }),
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
  const result = await proxyRequest<ApiResponse<MarketIndicatorsUpdateResult>>('/api/market-indicators/update', {
    method: 'POST',
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

export async function getCoilSpecDraft(spec: string, material: string): Promise<CoilSpecDraft> {
  const result = await proxyRequest<ApiResponse<CoilSpecDraft>>('/api/coils/spec-draft', {
    method: 'POST',
    body: JSON.stringify({ spec, material }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '线圈规格草稿生成失败');
  return result.data;
}

export async function createCoil(input: CoilInput): Promise<CoilRecord> {
  const result = await proxyRequest<ApiResponse<CoilRow>>('/api/coils', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '线圈记录创建失败');
  return rowToCoil(result.data);
}

export async function updateCoil(id: number, input: CoilInput): Promise<CoilRecord> {
  const result = await proxyRequest<ApiResponse<CoilRow>>(`/api/coils/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '线圈记录保存失败');
  return rowToCoil(result.data);
}

export async function deleteCoil(id: number): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/coils/${id}`, {
    method: 'DELETE',
  });
  if (!result.success) throw new Error(result.error || '线圈记录删除失败');
}
