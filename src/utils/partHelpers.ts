import { CableAccessoryType, Part } from '../types';

/**
 * 根据型号和供应商查找零件价格
 * 优先精确匹配（型号+供应商），回退到同型号最低价
 */
export function getPriceByModelAndSupplier(parts: Part[], model: string, supplier: string): number {
  const m1 = (model || '').trim();
  const s1 = (supplier || '').trim();
  const exactPart = parts.find(p => p.model.trim() === m1 && p.supplier.trim() === s1);
  if (exactPart && s1) return exactPart.price;
  const modelParts = parts.filter(p => p.model.trim() === m1);
  if (modelParts.length > 0) {
    return modelParts.reduce((min, curr) => curr.price < min.price ? curr : min, modelParts[0]).price;
  }
  return 0;
}

function parseCableAccessoryFee(notes?: string, accessoryType: CableAccessoryType = 'standard'): number | null {
  if (!notes) return null;
  try {
    const meta = JSON.parse(notes);
    const typedFee = Number(meta?.cableAccessoryFees?.[accessoryType]);
    if (Number.isFinite(typedFee) && typedFee >= 0) return typedFee;
    const fee = Number(meta?.cableAccessoryFee);
    return Number.isFinite(fee) && fee >= 0 ? fee : null;
  } catch {
    return null;
  }
}

function parseCableAccessoryName(notes?: string, accessoryType: CableAccessoryType = 'standard'): string | null {
  if (!notes) return null;
  try {
    const name = JSON.parse(notes)?.cableAccessoryNames?.[accessoryType];
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export function getCableAccessoryFee(parts: Part[], cableModel: string, supplier: string, accessoryType: CableAccessoryType = 'standard'): number {
  const m1 = (cableModel || '').trim();
  const s1 = (supplier || '').trim();
  const exactPart = parts.find(p => p.model.trim() === m1 && p.supplier.trim() === s1);
  const exactFee = parseCableAccessoryFee(exactPart?.notes, accessoryType);
  if (exactPart && s1 && exactFee != null) return exactFee;

  const modelParts = parts.filter(p => p.model.trim() === m1);
  if (modelParts.length > 0) {
    const fallbackPart = modelParts.reduce((min, curr) => curr.price < min.price ? curr : min, modelParts[0]);
    const fallbackFee = parseCableAccessoryFee(fallbackPart.notes, accessoryType);
    if (fallbackFee != null) return fallbackFee;
  }

  return getPriceByModelAndSupplier(parts, '电缆配件费', '');
}

export function getCableAccessoryName(parts: Part[], cableModel: string, supplier: string, accessoryType: CableAccessoryType = 'standard'): string {
  const m1 = (cableModel || '').trim();
  const s1 = (supplier || '').trim();
  const exactPart = parts.find(p => p.model.trim() === m1 && p.supplier.trim() === s1);
  const exactName = parseCableAccessoryName(exactPart?.notes, accessoryType);
  if (exactPart && s1 && exactName) return exactName;

  const modelParts = parts.filter(p => p.model.trim() === m1);
  if (modelParts.length > 0) {
    const fallbackPart = modelParts.reduce((min, curr) => curr.price < min.price ? curr : min, modelParts[0]);
    const fallbackName = parseCableAccessoryName(fallbackPart.notes, accessoryType);
    if (fallbackName) return fallbackName;
  }

  return accessoryType === 'xinjie' ? '新界式' : '普通铜套';
}

/**
 * 获取指定类别下的去重型号列表
 */
export function getModelsByCategory(parts: Part[], category: string): string[] {
  const set = new Set<string>();
  parts.forEach(p => {
    if (p.category === category && p.model) set.add(p.model);
  });
  return Array.from(set).sort();
}

/**
 * 获取指定型号的所有供应商列表
 */
export function getSuppliersByModel(parts: Part[], model: string): string[] {
  const suppliers = new Set<string>();
  parts.forEach(p => {
    if (p.model.trim() === model.trim() && p.supplier) suppliers.add(p.supplier);
  });
  return Array.from(suppliers).filter(Boolean).sort();
}
