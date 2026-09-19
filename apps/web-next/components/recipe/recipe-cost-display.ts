import { money } from '@/lib/format';
import type { RecipeSelectionRow } from '@/components/recipe/RecipeDataTable';
import type { RecipeBomDraftResult, RecipePart } from '@/lib/recipes';

function numberValue(value: unknown): number {
  const number = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(number) ? number : 0;
}

export function findDraftSelectionPart(
  draft: RecipeBomDraftResult | null,
  selection: RecipeSelectionRow
): RecipePart | undefined {
  if (!draft || !selection.model.trim()) return undefined;
  const model = selection.model.trim();
  const supplier = selection.supplier.trim();
  return draft.parts.find((part) => (
    part.model === model
    && (!supplier || String(part.supplier || '') === supplier)
    && Number(part.qty || 1) === (numberValue(selection.qty) || 1)
  )) || draft.parts.find((part) => part.model === model && (!supplier || String(part.supplier || '') === supplier));
}

export function recipePartSubtotal(part?: RecipePart): number {
  return Number(part?.snapshotPrice || 0) * Number(part?.qty || 0);
}

export function partCostSourceLabel(part?: RecipePart): string {
  if (!part) return '待匹配';
  if (part.costSource === 'manual') return '手输价';
  if (part.source === 'pump_shell_template') return '模板价';
  if (part.source === 'manual') return '手输价';
  if (part.name === '线圈转子') return '线圈计算';
  if (part.dynamicRule === 'longScrewByBarrelLength') return '长度计算';
  if (part.dynamicRule === 'stainlessStretchBarrelByLength') return '长度计算';
  return '目录价';
}

export function partCostLine(part?: RecipePart): string {
  if (!part) return '未生成成本';
  const unitPrice = Number(part.snapshotPrice || 0);
  const qty = Number(part.qty || 0);
  return `${partCostSourceLabel(part)} ${money(unitPrice)} × ${qty || 0} = ${money(unitPrice * qty)}`;
}

export function partFormulaLine(part?: RecipePart): string {
  if (!part) return '';
  if (part.formula) return part.formula;
  if (part.dynamicRule === 'longScrewByBarrelLength') {
    return `长螺丝长度=${part.barrelLength || 0}+${part.longScrewExtraLength || 0}=${part.screwLength || 0}mm`;
  }
  if (part.dynamicRule === 'stainlessShellBundleByBarrelLength') {
    return `泵壳整体价=${money(Number(part.baseSnapshotPrice ?? part.snapshotPrice ?? 0))}+机筒加价${money(Number(part.barrelExtraCost || 0))}`;
  }
  return '';
}
