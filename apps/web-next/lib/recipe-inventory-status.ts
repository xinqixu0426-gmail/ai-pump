import type { RecipeInventoryItem } from './recipes';

export function recipeInventoryPresentation(item: RecipeInventoryItem) {
  const label = item.status === 'in_stock' ? '有库存'
    : item.status === 'out_of_stock' ? '缺货'
      : item.status === 'not_tracked' ? '不单独管理库存'
        : item.status === 'needs_review' ? '引用待核对'
          : item.inventoryType === 'coil' ? '线圈方案缺失' : '零件缺失';
  const tone = item.status === 'in_stock' ? 'green' : item.status === 'needs_review' ? 'amber'
    : item.status === 'not_tracked' ? 'slate' : 'red';
  const model = item.currentName || item.model || '-';
  const snapshot = item.snapshotName ?? item.model;
  return {
    label, tone, model,
    name: !item.name || item.name === item.model ? model : item.name,
    previousName: item.currentName && snapshot && item.currentName !== snapshot ? snapshot : null,
    stockText: item.status === 'not_tracked' ? '—'
      : item.currentStock == null || item.status === 'needs_review' || item.status === 'missing' ? '未核实' : String(item.currentStock),
  } as const;
}
