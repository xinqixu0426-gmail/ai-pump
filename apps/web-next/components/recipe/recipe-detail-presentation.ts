import type { Recipe, RecipePart } from '@/lib/recipes';

export function recipePartModel(part: RecipePart, recipe: Recipe): string {
  if (part.costRole !== 'coil' && !part.coilId && part.name !== '线圈转子') return part.model || '-';
  const dimensions = part.model?.match(/^(\d+(?:\.\d+)?)-(\d+)$/);
  const spec = dimensions?.[1] || recipe.coilSpec;
  const sheets = dimensions?.[2] || recipe.coilSheets;
  const weight = part.wireWeight ?? recipe.coilWireWeight;
  return [spec || '规格未记录', sheets ? `${sheets}片` : '片数未记录', part.material || recipe.coilMaterial || '材质未记录', part.slotType || recipe.coilSlotType || '槽眼未记录', weight != null && Number.isFinite(Number(weight)) ? `线重 ${Number(weight)}kg` : '线重未记录'].join(' / ');
}

export function bomCategory(part: RecipePart): string {
  if (part.snapshotPrice == null || Number(part.snapshotPrice) > 1) return '';
  const text = `${part.name || ''} ${part.model || ''}`;
  if (/螺丝|螺钉|螺栓|螺母/.test(text)) return '螺丝';
  if (/皮垫|O型圈|O形圈|垫圈|垫片/i.test(text)) return '皮垫与垫圈';
  return '';
}

export function groupBomRows<T extends { part: RecipePart; savedSubtotal: number | null }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const [index, row] of rows.entries()) {
    const category = bomCategory(row.part) || `single-${index}`;
    groups.set(category, [...(groups.get(category) || []), row]);
  }
  return Array.from(groups, ([category, items]) => ({
    category,
    rows: [...items].sort((a, b) => (b.savedSubtotal ?? -Infinity) - (a.savedSubtotal ?? -Infinity)),
    amount: items.reduce((sum, row) => sum + (row.savedSubtotal ?? 0), 0),
  })).sort((a, b) => b.amount - a.amount);
}


// Display the saved service receipt; do not introduce another cost-calculation rule.
export function recipeFeeRows(recipe: Recipe) {
  const lines = (recipe.savedCostDetails || '').split('\n');
  const modes: Record<string, string> = { none: '无处理', painting: '喷漆', electrophoresis: '电泳', electrophoresis_powder_coating: '电泳+喷塑', powder_coating: '喷塑', custom: '自定义' };
  const savedProcess = lines.map(line => line.match(/^表面处理\(([^)]+)\):/)).find(Boolean)?.[1];
  const process = savedProcess || modes[recipe.surfaceTreatmentMode || ''] || (recipe.paintingWage ? '喷漆' : '未记录工艺');
  return [
    { category: '人工', name: '安装工资', value: recipe.assemblyWage, pattern: /^安装工资:\s*¥([\d.]+)/ },
    { category: '人工', name: '打包工资', value: recipe.packingWage, pattern: /^打包工资:\s*¥([\d.]+)/ },
    { category: '表面处理', name: '表面处理', process, value: recipe.surfaceTreatmentCost ?? recipe.paintingWage, pattern: /^(?:表面处理(?:\([^)]*\))?|喷漆工资):\s*¥([\d.]+)/ },
    { category: '管理费用', name: '管理费用', value: recipe.managementFee, pattern: /^管理费用:\s*¥([\d.]+)/ },
  ].map(({ pattern, value, ...row }) => {
    const match = lines.map(line => line.match(pattern)).find(Boolean);
    return { ...row, amount: match ? Number(match[1]) : value ?? null };
  }).sort((a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity));
}
