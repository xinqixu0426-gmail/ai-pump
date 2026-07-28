import type { ApiResponse } from './api';
import { proxyRequest } from './api';

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
  schemeStatus: 'testing' | 'official' | 'disabled';
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
  schemeStatus: 'testing' | 'official' | 'disabled';
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
  spec: string;
  material?: string;
  slotType?: '小眼' | '国标眼';
  sheets: number;
  wireWeight?: number;
};

export type CoilCalcResult = {
  coilId?: number | null;
  spec: string;
  material: string;
  slotType: '小眼' | '国标眼';
  diameterMm: number;
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
    statorVariantId: row.statorVariantId || null,
    diameterMm: Number(row.diameterMm) || (row.spec === '12' ? 120 : Number(row.spec) || 0),
    commonName: row.commonName || row.spec || '',
    material: row.material || '钢带',
    slotType: row.slotType === '国标眼' ? '国标眼' : '小眼',
    sheets: Number(row.sheets) || 0,
    schemeName: row.schemeName || '',
    schemeStatus: row.schemeStatus === 'testing' || row.schemeStatus === 'disabled' ? row.schemeStatus : 'official',
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

export async function getAllCoils(): Promise<CoilRecord[]> {
  const result = await proxyRequest<ApiResponse<CoilRow[]>>('/api/coils');
  if (!result.success) throw new Error(result.error || '线圈数据加载失败');
  return (result.data || []).map(rowToCoil);
}

export async function updateCoilSpecPrice(spec: string, material: string, slotType: string, unitPrice: number): Promise<number> {
  const result = await proxyRequest<ApiResponse<unknown> & { updated?: number }>(`/api/coils/spec/${encodeURIComponent(spec)}`, {
    method: 'PATCH',
    body: JSON.stringify({ material, slotType, unitPrice }),
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

export async function getCoilStockMovements(id: number, limit = 20): Promise<CoilStockMovement[]> {
  const result = await proxyRequest<ApiResponse<CoilStockMovement[]>>(`/api/coils/${id}/stock-movements?limit=${limit}`);
  if (!result.success) throw new Error(result.error || '线圈库存流水加载失败');
  return result.data || [];
}

export async function adjustCoilStock(id: number, changeQty: number, note = ''): Promise<CoilRecord> {
  const result = await proxyRequest<ApiResponse<{ coil: CoilRow }>>(`/api/coils/${id}/stock-adjustment`, {
    method: 'POST',
    body: JSON.stringify({ changeQty, note }),
  });
  if (!result.success || !result.data?.coil) throw new Error(result.error || '线圈库存调整失败');
  return rowToCoil(result.data.coil);
}
