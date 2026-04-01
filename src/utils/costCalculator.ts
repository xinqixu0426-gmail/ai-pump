import { Part } from '../types';

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
    if (matchedPart) {
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
