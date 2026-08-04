'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { SlideOver } from '@/components/motion/slide-over';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { money } from '@/lib/format';
import {
  buildTemplateNameMap,
  parseRecipePartsJson,
  validRecipeParts,
  type PumpShellTemplate,
  type Recipe,
  type RecipePart,
} from '@/lib/recipes';
import { recipePartSubtotal } from '@/components/recipe/recipe-cost-display';

type ComparePartRow = {
  key: string;
  label: string;
  leftModel: string;
  rightModel: string;
  leftQty: number;
  rightQty: number;
  leftSubtotal: number;
  rightSubtotal: number;
};

type RecipeComparePanelProps = {
  open: boolean;
  recipes: Recipe[];
  templates: PumpShellTemplate[];
  compareIds: number[];
  onClose: () => void;
};

function recipePartKey(part: RecipePart): string {
  const name = String(part.name || '').trim();
  if (name) return `name:${name.replace(/\s+/g, '')}`;
  if (part.dynamicRule) return `rule:${part.dynamicRule}`;
  if (part.packagingMaterial) return `packing:${String(part.packagingMaterial).trim()}`;
  return `model:${String(part.model || '').trim().replace(/\s+/g, '')}`;
}

function comparePartLabel(part: RecipePart): string {
  if (part.name) return part.name;
  if (part.dynamicRule === 'longScrewByBarrelLength') return '长螺丝';
  if (part.packagingMaterial) return String(part.packagingMaterial);
  return part.model || '-';
}

function comparePartIdentity(part?: RecipePart): string {
  if (!part) return '-';
  return [part.model, part.supplier].filter(Boolean).join(' / ') || part.name || '-';
}

function buildComparePartRows(left: RecipePart[], right: RecipePart[]): ComparePartRow[] {
  type CompareAccumulator = {
    label: string;
    leftModels: Set<string>;
    rightModels: Set<string>;
    leftQty: number;
    rightQty: number;
    leftSubtotal: number;
    rightSubtotal: number;
  };

  const map = new Map<string, CompareAccumulator>();

  function ensure(key: string, part: RecipePart): CompareAccumulator {
    const current = map.get(key);
    if (current) return current;
    const next = {
      label: comparePartLabel(part),
      leftModels: new Set<string>(),
      rightModels: new Set<string>(),
      leftQty: 0,
      rightQty: 0,
      leftSubtotal: 0,
      rightSubtotal: 0,
    };
    map.set(key, next);
    return next;
  }

  left.forEach((part) => {
    const key = recipePartKey(part);
    const row = ensure(key, part);
    row.leftModels.add(comparePartIdentity(part));
    row.leftQty += Number(part.qty || 0);
    row.leftSubtotal += recipePartSubtotal(part);
  });
  right.forEach((part) => {
    const key = recipePartKey(part);
    const row = ensure(key, part);
    row.rightModels.add(comparePartIdentity(part));
    row.rightQty += Number(part.qty || 0);
    row.rightSubtotal += recipePartSubtotal(part);
  });

  return Array.from(map.entries())
    .map(([key, row]) => ({
      key,
      label: row.label,
      leftModel: Array.from(row.leftModels).join('、') || '-',
      rightModel: Array.from(row.rightModels).join('、') || '-',
      leftQty: row.leftQty,
      rightQty: row.rightQty,
      leftSubtotal: row.leftSubtotal,
      rightSubtotal: row.rightSubtotal,
    }))
    .filter((row) => (
      row.leftModel !== row.rightModel ||
      row.leftQty !== row.rightQty ||
      Math.abs(row.leftSubtotal - row.rightSubtotal) >= 0.01
    ))
    .sort((a, b) => Math.abs(b.rightSubtotal - b.leftSubtotal) - Math.abs(a.rightSubtotal - a.leftSubtotal));
}

function comparePartDifference(row: ComparePartRow): { label: string; tone: StatusBadgeTone } {
  const hasLeft = row.leftQty > 0 || row.leftSubtotal > 0 || row.leftModel !== '-';
  const hasRight = row.rightQty > 0 || row.rightSubtotal > 0 || row.rightModel !== '-';
  if (hasLeft && !hasRight) return { label: '仅左侧有', tone: 'amber' };
  if (!hasLeft && hasRight) return { label: '仅右侧有', tone: 'blue' };
  if (row.leftModel !== row.rightModel) return { label: '型号不同', tone: 'purple' };
  if (row.leftQty !== row.rightQty) return { label: '数量不同', tone: 'orange' };
  return { label: '金额不同', tone: 'red' };
}

export function RecipeComparePanel({
  open,
  recipes,
  templates,
  compareIds,
  onClose,
}: RecipeComparePanelProps) {
  const templateNameMap = useMemo(() => buildTemplateNameMap(templates), [templates]);
  const compareRecipes = useMemo(
    () => compareIds
      .map((id) => recipes.find((recipe) => recipe.id === id))
      .filter(Boolean) as Recipe[],
    [compareIds, recipes]
  );
  const comparePartRows = useMemo(() => {
    if (compareRecipes.length !== 2) return [];
    return buildComparePartRows(
      validRecipeParts(parseRecipePartsJson(compareRecipes[0].partsJson)),
      validRecipeParts(parseRecipePartsJson(compareRecipes[1].partsJson))
    );
  }, [compareRecipes]);

  return (
    <SlideOver open={open} onClose={onClose}>
      <div className="flex min-h-full flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Compare</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">配方对比</h2>
            <div className="mt-1 text-sm text-muted">选择两个配方后，对比基础参数、保存成本和 BOM 快照差异。</div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          {compareRecipes.length !== 2 ? (
            <div className="rounded-panel border border-dashed border-line p-6 text-sm text-muted">
              请先在配方列表中选择两个配方。
            </div>
          ) : (
            <>
              <section className="rounded-panel border border-line">
                <div className="border-b border-line p-4 text-sm font-semibold text-ink">基础信息</div>
                <div className="overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0 text-sm">
                    <tbody>
                      {[
                        ['配方名称', compareRecipes[0].name || '-', compareRecipes[1].name || '-'],
                        ['规格', compareRecipes[0].spec || '-', compareRecipes[1].spec || '-'],
                        ['泵壳模板', compareRecipes[0].templateId ? templateNameMap.get(compareRecipes[0].templateId) || '-' : '-', compareRecipes[1].templateId ? templateNameMap.get(compareRecipes[1].templateId) || '-' : '-'],
                        ['保存成本', money(compareRecipes[0].savedTotalCost || 0), money(compareRecipes[1].savedTotalCost || 0)],
                        ['线圈', [compareRecipes[0].coilSpec, compareRecipes[0].coilSheets ? `${compareRecipes[0].coilSheets}片` : '', compareRecipes[0].coilMaterial, compareRecipes[0].coilSlotType || '小眼'].filter(Boolean).join(' / ') || '-', [compareRecipes[1].coilSpec, compareRecipes[1].coilSheets ? `${compareRecipes[1].coilSheets}片` : '', compareRecipes[1].coilMaterial, compareRecipes[1].coilSlotType || '小眼'].filter(Boolean).join(' / ') || '-'],
                        ['机筒长度', compareRecipes[0].customBarrelLength ? `${compareRecipes[0].customBarrelLength} mm` : '-', compareRecipes[1].customBarrelLength ? `${compareRecipes[1].customBarrelLength} mm` : '-'],
                        ['叶轮', [compareRecipes[0].impellerModel, compareRecipes[0].impellerThickness ? `${compareRecipes[0].impellerThickness}厚` : '', compareRecipes[0].impellerDiameter ? `直径${compareRecipes[0].impellerDiameter}` : '', compareRecipes[0].impellerBladeCount ? `${compareRecipes[0].impellerBladeCount}片` : ''].filter(Boolean).join(' / ') || '-', [compareRecipes[1].impellerModel, compareRecipes[1].impellerThickness ? `${compareRecipes[1].impellerThickness}厚` : '', compareRecipes[1].impellerDiameter ? `直径${compareRecipes[1].impellerDiameter}` : '', compareRecipes[1].impellerBladeCount ? `${compareRecipes[1].impellerBladeCount}片` : ''].filter(Boolean).join(' / ') || '-'],
                        ['电缆', compareRecipes[0].hasCable ? `${compareRecipes[0].cableWire || '-'} / ${compareRecipes[0].cableLength || 0}m / ${compareRecipes[0].cableAccessoryType || 'standard'}` : '不带', compareRecipes[1].hasCable ? `${compareRecipes[1].cableWire || '-'} / ${compareRecipes[1].cableLength || 0}m / ${compareRecipes[1].cableAccessoryType || 'standard'}` : '不带'],
                        ['浮球', compareRecipes[0].hasFloat ? `${compareRecipes[0].floatWire || '-'} / ${compareRecipes[0].floatAccessoryType || 'standard'}` : '不带', compareRecipes[1].hasFloat ? `${compareRecipes[1].floatWire || '-'} / ${compareRecipes[1].floatAccessoryType || 'standard'}` : '不带'],
                      ].map(([label, left, right]) => (
                        <tr key={String(label)} className={left !== right ? 'bg-amber-50/60' : ''}>
                          <td className="border-b border-line px-4 py-3 font-medium text-muted">{label}</td>
                          <td className="border-b border-line px-4 py-3 text-ink">{left}</td>
                          <td className="border-b border-line px-4 py-3 text-ink">{right}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-panel border border-line">
                <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                  <div className="text-sm font-semibold text-ink">BOM 差异</div>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{comparePartRows.length} 项</span>
                </div>
                {comparePartRows.length === 0 ? (
                  <div className="p-6 text-sm text-muted">两个配方的 BOM 快照没有发现差异。</div>
                ) : (
                  <div className="max-h-[460px] overflow-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                        <tr>
                          <th className="border-b border-line px-4 py-3">配件</th>
                          <th className="border-b border-line px-4 py-3">差异</th>
                          <th className="border-b border-line px-4 py-3">{compareRecipes[0].name || '左侧'}</th>
                          <th className="border-b border-line px-4 py-3">{compareRecipes[1].name || '右侧'}</th>
                          <th className="border-b border-line px-4 py-3 text-right">小计差额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparePartRows.map((row) => {
                          const diff = row.rightSubtotal - row.leftSubtotal;
                          const difference = comparePartDifference(row);
                          return (
                            <tr key={row.key} className="transition-colors duration-150 hover:bg-slate-50">
                              <td className="border-b border-line px-4 py-3">
                                <div className="font-medium text-ink">{row.label}</div>
                              </td>
                              <td className="border-b border-line px-4 py-3">
                                <StatusBadge tone={difference.tone}>{difference.label}</StatusBadge>
                              </td>
                              <td className="border-b border-line px-4 py-3">
                                <div className="font-medium text-ink">{row.leftModel}</div>
                                <div className="mt-0.5 text-xs text-muted">数量 {row.leftQty || '-'}，小计 {money(row.leftSubtotal)}</div>
                              </td>
                              <td className="border-b border-line px-4 py-3">
                                <div className="font-medium text-ink">{row.rightModel}</div>
                                <div className="mt-0.5 text-xs text-muted">数量 {row.rightQty || '-'}，小计 {money(row.rightSubtotal)}</div>
                              </td>
                              <td className={`border-b border-line px-4 py-3 text-right font-semibold ${diff >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                                {diff >= 0 ? '+' : ''}{money(diff)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </SlideOver>
  );
}
