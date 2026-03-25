import { Part, RecipePart, CostDetail, CostResult } from '../types';

/**
 * 加载零件数据并构建索引
 */
export function buildPartsIndex(parts: Part[]): {
  partsCache: Map<string, Part>;
  partsByModel: Map<string, Part[]>;
} {
  const partsCache = new Map<string, Part>();
  const partsByModel = new Map<string, Part[]>();

  parts.forEach(part => {
    const model = part.型号 || part.model || '';
    const supplier = part.供应商 || part.supplier || '';

    // 构建精确匹配缓存 (model + supplier)
    const cacheKey = `${model}|${supplier}`;
    partsCache.set(cacheKey, part);

    // 构建型号索引
    if (!partsByModel.has(model)) {
      partsByModel.set(model, []);
    }
    partsByModel.get(model)!.push(part);
  });

  return { partsCache, partsByModel };
}

/**
 * 计算配方成本
 */
export function calculateRecipeCost(
  recipeParts: RecipePart[],
  partsCache: Map<string, Part>,
  partsByModel: Map<string, Part[]>
): CostResult {
  let totalCost = 0;
  let snapshotTotalCost = 0;
  let hasSnapshot = false;
  const details: CostDetail[] = [];
  const missingParts: string[] = [];

  recipeParts.forEach(item => {
    const { model, name, supplier, qty } = item;

    // 1. 尝试精确匹配 (model + supplier)
    let matchedPart = partsCache.get(`${model}|${supplier}`);
    let price = 0;
    let matchedSupplier = supplier;
    let source = '精确匹配';

    if (matchedPart) {
      price = matchedPart.单价 || matchedPart.price || 0;
    } else {
      // 2. 回退到仅匹配型号
      const partsWithModel = partsByModel.get(model);
      if (partsWithModel && partsWithModel.length > 0) {
        // 使用第一个找到的零件价格
        matchedPart = partsWithModel[0];
        price = matchedPart.单价 || matchedPart.price || 0;
        matchedSupplier = matchedPart.供应商 || matchedPart.supplier || '-';
        source = '型号回退';
      } else {
        // 未找到零件
        missingParts.push(model);
        matchedSupplier = supplier || '-';
        source = '未找到';
      }
    }

    const subtotal = price * qty;
    totalCost += subtotal;

    // 处理快照价格
    const snapshotPrice = item.snapshotPrice;
    let snapshotSubtotal: number | undefined;
    if (snapshotPrice !== undefined && snapshotPrice !== null) {
      hasSnapshot = true;
      snapshotSubtotal = snapshotPrice * qty;
      snapshotTotalCost += snapshotSubtotal;
    }

    details.push({
      name: name || model,
      model,
      supplier: matchedSupplier,
      price: price.toFixed(2),
      qty,
      subtotal: subtotal.toFixed(2),
      source,
      snapshotPrice: snapshotPrice !== undefined && snapshotPrice !== null ? snapshotPrice.toFixed(2) : undefined,
      snapshotSubtotal: snapshotSubtotal !== undefined ? snapshotSubtotal.toFixed(2) : undefined
    });
  });

  return {
    totalCost: totalCost.toFixed(2),
    snapshotTotalCost: hasSnapshot ? snapshotTotalCost.toFixed(2) : undefined,
    itemCount: recipeParts.length,
    details,
    missingParts
  };
}
