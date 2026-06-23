// ⚠️ SYNC REQUIRED: 本组成本计算逻辑（包括 buildIndices 和 calculateRecipeCost）必须与 api/db.cjs 中的逻辑保持高度一致！
// 若修改了以下任一匹配降级逻辑，请务必同步修改 api/db.cjs。

import { CableAccessoryType, Part } from '../types';

/**
 * 构建零件索引
 * @returns partsCache: model+supplier → Part (精确匹配)
 * @returns partsByModel: model → Part[] (型号回退)
 */
export function buildPartsIndex(parts: Part[]): {
  partsCache: Map<string, Part>;
  partsByModel: Map<string, Part[]>;
} {
  const partsCache = new Map<string, Part>();
  const partsByModel = new Map<string, Part[]>();

  for (const part of parts) {
    const model = part.model;
    const supplier = part.supplier;
    const key = `${model}||${supplier}`;
    partsCache.set(key, part);

    if (!partsByModel.has(model)) {
      partsByModel.set(model, []);
    }
    partsByModel.get(model)!.push(part);
  }

  return { partsCache, partsByModel };
}

/**
 * 计算配方成本
 */
export interface RecipePartForCalc {
  model: string;
  name: string;
  supplier: string;
  qty: number;
  snapshotPrice?: number;
  source?: string;
  costSource?: string;
  floatAccessoryType?: CableAccessoryType;
  floatAccessoryDelta?: number;
  cableAccessoryType?: CableAccessoryType;
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

function getCableAccessoryFee(partsByModel: Map<string, Part[]>, cableModel: string, supplier: string, accessoryType: CableAccessoryType = 'standard'): number {
  const candidates = partsByModel.get(cableModel) || [];
  const normalizedSupplier = (supplier || '').trim();
  const matchedPart = candidates.find(p => (p.supplier || '').trim() === normalizedSupplier);
  const matchedFee = parseCableAccessoryFee(matchedPart?.notes, accessoryType);
  if (matchedPart && normalizedSupplier && matchedFee != null) return matchedFee;
  if (candidates.length > 0) {
    const fallbackPart = candidates.reduce((min, curr) => curr.price < min.price ? curr : min, candidates[0]);
    const fallbackFee = parseCableAccessoryFee(fallbackPart.notes, accessoryType);
    if (fallbackFee != null) return fallbackFee;
  }
  const legacyParts = partsByModel.get('电缆配件费') || [];
  if (legacyParts.length === 0) return 0;
  return legacyParts.reduce((min, curr) => curr.price < min.price ? curr : min, legacyParts[0]).price;
}

function isCableAccessoryPart(part: RecipePartForCalc): boolean {
  return part.model === '电缆配件费' || part.name.includes('电缆接头配件');
}

function findCablePart(parts: RecipePartForCalc[]): RecipePartForCalc | undefined {
  return parts.find(part => part.model.startsWith('电缆-') || part.name.includes('电缆线'));
}

function isFloatPart(part: RecipePartForCalc): boolean {
  return part.model.startsWith('浮球-') || part.name === '浮球' || part.name === '浮球-新界式' || part.name === '浮球-普通铜套';
}

export function calculateRecipeCost(
  recipeParts: RecipePartForCalc[],
  partsCache: Map<string, Part>,
  partsByModel: Map<string, Part[]>,
  savedTotalCost?: number
): { totalCost: string; snapshotTotalCost?: string; itemCount: number; details: Array<{
  name: string; model: string; supplier: string; price: string; qty: number; subtotal: string; source: string; snapshotPrice?: string; snapshotSubtotal?: string;
}>; missingParts: string[] } {
  let totalCost = 0;
  let snapshotTotal = 0;
  const details: Array<{
    name: string; model: string; supplier: string; price: string; qty: number; subtotal: string; source: string; snapshotPrice?: string; snapshotSubtotal?: string;
  }> = [];
  const missingParts: string[] = [];

  for (const rp of recipeParts) {
    let price = 0;
    let source = '未找到';
    let matchedSupplier = rp.supplier || '-';

    // 1) 精确匹配: model + supplier
    const exactKey = `${rp.model}||${rp.supplier}`;
    const matchedPart = partsCache.get(exactKey);
    if ((rp.source === 'pump_shell_template' || rp.costSource === 'manual') && rp.snapshotPrice !== undefined) {
      price = rp.snapshotPrice;
      source = rp.costSource === 'manual' ? '手动估算价' : '模板手动价';
    } else if (isCableAccessoryPart(rp)) {
      const cablePart = findCablePart(recipeParts);
      price = getCableAccessoryFee(partsByModel, cablePart?.model || '', cablePart?.supplier || '', rp.cableAccessoryType);
      source = '电缆线配件费';
    } else if (isFloatPart(rp)) {
      if (matchedPart) {
        price = matchedPart.price;
        source = '精确匹配';
        matchedSupplier = matchedPart.supplier;
      } else {
        const candidates = partsByModel.get(rp.model);
        if (candidates && candidates.length > 0) {
          const fallbackPart = candidates.reduce((min, curr) => curr.price < min.price ? curr : min, candidates[0]);
          price = fallbackPart.price;
          matchedSupplier = fallbackPart.supplier;
          source = `型号回退(${matchedSupplier})`;
        } else if (rp.snapshotPrice !== undefined) {
          price = rp.snapshotPrice;
          source = '快照价格';
        } else {
          missingParts.push(rp.model);
        }
      }
      if (rp.floatAccessoryType === 'xinjie' && rp.snapshotPrice !== undefined) {
        price = rp.snapshotPrice;
        source = '快照价格';
      } else if (rp.floatAccessoryType === 'xinjie') {
        price += Number(rp.floatAccessoryDelta || 0);
        source += '+新界式';
      }
    } else if (matchedPart) {
      price = matchedPart.price;
      source = '精确匹配';
      matchedSupplier = matchedPart.supplier;
    } else {
      // 2) 型号回退: 找同型号最便宜的
      const candidates = partsByModel.get(rp.model);
      if (candidates && candidates.length > 0) {
        const fallbackPart = candidates.reduce((min, curr) => {
          return curr.price < min.price ? curr : min;
        }, candidates[0]);
        price = fallbackPart.price;
        matchedSupplier = fallbackPart.supplier;
        source = `型号回退(${matchedSupplier})`;
      } else if ((rp.name === '线圈转子' || rp.name === '电容') && rp.snapshotPrice !== undefined) {
        // 线圈和电容不在配件表中，使用快照价格
        price = rp.snapshotPrice;
        source = '快照价格';
      } else {
        missingParts.push(rp.model);
      }
    }

    const subtotal = price * rp.qty;
    totalCost += subtotal;

    const detail: typeof details[0] = {
      name: rp.name,
      model: rp.model,
      supplier: matchedSupplier,
      price: price.toFixed(2),
      qty: rp.qty,
      subtotal: subtotal.toFixed(2),
      source,
    };

    // 快照价格
    if (rp.snapshotPrice !== undefined) {
      detail.snapshotPrice = rp.snapshotPrice.toFixed(2);
      detail.snapshotSubtotal = (rp.snapshotPrice * rp.qty).toFixed(2);
      snapshotTotal += rp.snapshotPrice * rp.qty;
    }

    details.push(detail);
  }

  return {
    totalCost: totalCost.toFixed(2),
    snapshotTotalCost: savedTotalCost !== undefined ? String(savedTotalCost) : (snapshotTotal > 0 ? snapshotTotal.toFixed(2) : undefined),
    itemCount: recipeParts.length,
    details,
    missingParts,
  };
}
