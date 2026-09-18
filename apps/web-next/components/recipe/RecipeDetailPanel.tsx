'use client';

import { Fragment, useMemo } from 'react';
import { CircleAlert, Printer, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RecipePrintSheet } from './RecipePrintSheet';
import { SlideOver } from '@/components/motion/slide-over';
import { StatusBadge } from '@/components/ui/status-badge';
import { money } from '@/lib/format';
import { recipeInventoryPresentation } from '@/lib/recipe-inventory-status';
import {
  getRecipeSavedTotal,
  parseRecipePartsJson,
  validRecipeParts,
  type Recipe,
  type RecipeCurrentCostResult,
  type RecipeCurrentTotalCost,
  type RecipeInventoryStatusResult,
} from '@/lib/recipes';
import { getTechnicalDataEntries, parseTechnicalDataJson } from '@/lib/technical-data';
import { groupBomRows, recipeFeeRows, recipePartModel } from './recipe-detail-presentation';

type RecipeDetailPanelProps = {
  recipe: Recipe | null;
  templateName: string;
  currentSummary: RecipeCurrentTotalCost | null;
  currentCost: RecipeCurrentCostResult | null;
  currentCostError: string | null;
  inventoryStatus: RecipeInventoryStatusResult | null;
  inventoryStatusLoading: boolean;
  inventoryStatusError: string | null;
  onClose: () => void;
  onRefreshInventory: (recipe: Recipe) => void | Promise<void>;
};

function dateTimeShort(value: string | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function signedMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${money(Math.abs(value))}`;
}

export function RecipeDetailPanel({
  recipe,
  templateName,
  currentSummary,
  currentCost,
  currentCostError,
  inventoryStatus,
  inventoryStatusLoading,
  inventoryStatusError,
  onClose,
  onRefreshInventory,
}: RecipeDetailPanelProps) {
  const parts = useMemo(
    () => recipe ? validRecipeParts(parseRecipePartsJson(recipe.partsJson)) : [],
    [recipe]
  );
  const technicalEntries = useMemo(() => {
    if (!recipe) return [];
    const technicalData = parseTechnicalDataJson(recipe.technicalDataJson);
    const representedKeys = new Set<string>();
    if (Number(recipe.coilSheets || 0) > 0) representedKeys.add('pieceCount');
    if (recipe.impellerThickness != null) representedKeys.add('impellerDepth');
    return getTechnicalDataEntries(technicalData)
      .filter((entry) => !representedKeys.has(entry.id));
  }, [recipe]);
  const partCompareRows = useMemo(() => {
    return parts.map((part, index) => {
      const current = currentCost?.details?.[index];
      const snapshotPrice = part.snapshotPrice != null ? Number(part.snapshotPrice) : null;
      const qty = Number(part.qty || current?.qty || 1);
      const savedSubtotal = snapshotPrice != null ? snapshotPrice * qty : null;
      const currentPrice = current?.price != null ? Number(current.price) : null;
      const currentSubtotal = current?.subtotal != null
        ? Number(current.subtotal)
        : (currentPrice != null ? currentPrice * qty : null);
      const diff = currentSubtotal != null && savedSubtotal != null ? currentSubtotal - savedSubtotal : null;
      return {
        part,
        current,
        qty,
        snapshotPrice,
        currentPrice,
        savedSubtotal,
        currentSubtotal,
        diff,
      };
    });
  }, [currentCost, parts]);
  const bomGroups = useMemo(() => groupBomRows(partCompareRows), [partCompareRows]);
  const fees = useMemo(() => recipe ? recipeFeeRows(recipe) : [], [recipe]);

  const savedTotal = recipe ? getRecipeSavedTotal(recipe) : null;
  const currentCostComplete = currentSummary?.costComplete !== false;
  const currentTotal = currentCostComplete ? currentSummary?.currentTotalCost ?? null : null;
  const costDiff = currentCostComplete ? currentSummary?.difference ?? null : null;
  const savedAt = recipe ? dateTimeShort(recipe.updatedAt || recipe.createdAt) : '-';
  const currentAt = currentSummary?.fetchedAt ? dateTimeShort(currentSummary.fetchedAt) : '-';
  const barrelLength = useMemo(() => {
    const savedLength = Number(recipe?.customBarrelLength || 0);
    if (savedLength > 0) return { value: savedLength, source: 'recipe' as const };
    const bomLengths = Array.from(new Set(parts
      .map((part) => Number(part.barrelLength || 0))
      .filter((value) => value > 0)));
    return bomLengths.length === 1
      ? { value: bomLengths[0], source: 'bom' as const }
      : { value: null, source: 'missing' as const };
  }, [parts, recipe?.customBarrelLength]);
  const bomSummary = useMemo(() => {
    const snapshotComplete = partCompareRows.length > 0
      && partCompareRows.every((row) => row.savedSubtotal != null);
    const currentComplete = currentCostComplete
      && partCompareRows.length > 0
      && partCompareRows.every((row) => row.currentSubtotal != null);
    const snapshotSubtotal = snapshotComplete
      ? partCompareRows.reduce((sum, row) => sum + Number(row.savedSubtotal), 0)
      : null;
    const currentSubtotal = currentComplete
      ? partCompareRows.reduce((sum, row) => sum + Number(row.currentSubtotal), 0)
      : null;
    return {
      totalQty: partCompareRows.reduce((sum, row) => sum + Number(row.qty || 0), 0),
      snapshotSubtotal,
      currentSubtotal,
      difference: snapshotSubtotal != null && currentSubtotal != null
        ? currentSubtotal - snapshotSubtotal
        : null,
    };
  }, [currentCostComplete, partCompareRows]);

  return (
    <SlideOver open={Boolean(recipe)} onClose={onClose} size="workspace">
      {recipe ? (
        <div className="flex min-h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Recipe Detail</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{recipe.name || '未命名配方'}</h2>
              {recipe.externalModel ? <div className="mt-1 break-words text-sm text-muted">对外型号：{recipe.externalModel}</div> : null}
              <div className="mt-1 text-sm text-muted">{recipe.spec || '无规格'}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => window.print()}><Printer size={16} />打印配方</Button>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink"
            >
              <X size={16} />
            </button>
            </div>
          </div>

          <div className="flex-1 space-y-5 p-5">
            <section className="grid gap-3 md:grid-cols-5">
              <div className="rounded-panel border border-line p-4">
                <div className="text-xs text-muted">保存成本</div>
                <div className="mt-1 text-xl font-semibold text-ink">{savedTotal ? money(savedTotal) : '-'}</div>
                <div className="mt-1 text-xs text-muted">保存 {savedAt}</div>
              </div>
              <div className="rounded-panel border border-line p-4">
                <div className="text-xs text-muted">当日完整成本</div>
                <div className={`mt-1 text-xl font-semibold ${currentCostComplete ? 'text-ink' : 'text-amber-700'}`}>
                  {currentCostComplete ? currentTotal != null ? money(currentTotal) : '-' : '成本不完整'}
                </div>
                <div className="mt-1 text-xs text-muted">{currentCostComplete ? '含人工及管理费' : `缺 ${currentSummary?.missingParts.length || 0} 项价格`} · {currentAt}</div>
              </div>
              <div className="rounded-panel border border-line p-4">
                <div className="text-xs text-muted">成本差额</div>
                <div className={`mt-1 text-xl font-semibold ${Number(costDiff || 0) > 0 ? 'text-rose-700' : Number(costDiff || 0) < 0 ? 'text-emerald-700' : 'text-ink'}`}>
                  {costDiff != null ? signedMoney(costDiff) : '-'}
                </div>
                <div className="mt-1 text-xs text-muted">当日完整成本 - 保存成本</div>
              </div>
              <div className="rounded-panel border border-line p-4">
                <div className="text-xs text-muted">BOM 项数</div>
                <div className="mt-1 text-xl font-semibold text-ink">{parts.length}</div>
                <div className="mt-1 text-xs text-muted">{currentSummary?.missingParts?.length ? `${currentSummary.missingParts.length} 项缺当前价` : '当前价已匹配'}</div>
              </div>
              <div className="rounded-panel border border-line p-4">
                <div className="text-xs text-muted">泵壳模板</div>
                <div className="mt-1 truncate text-xl font-semibold text-ink">{templateName || '-'}</div>
              </div>
            </section>

            {currentCostError ? (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <CircleAlert size={16} />
                {currentCostError}
              </div>
            ) : null}

            {currentSummary?.costComplete === false ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <CircleAlert className="mt-0.5 shrink-0" size={16} />
                <div>
                  <div className="font-medium">当日成本未生成完整金额</div>
                  <div className="mt-1">缺少价格：{currentSummary.missingParts.join('、')}</div>
                </div>
              </div>
            ) : null}


            <section className="rounded-panel border border-line">
              <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                <div className="text-sm font-semibold text-ink">BOM 快照</div>
                <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{parts.length} 项</span>
              </div>
              {parts.length === 0 ? (
                <div className="p-5 text-sm text-muted">暂无 BOM 快照</div>
              ) : (
                <>
                  <div className="grid gap-px border-b border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
                    <div className="bg-white px-4 py-3">
                      <div className="text-xs text-muted">数量合计</div>
                      <div className="mt-1 font-semibold text-ink">{bomSummary.totalQty}</div>
                    </div>
                    <div className="bg-white px-4 py-3">
                      <div className="text-xs text-muted">快照配件合计</div>
                      <div className="mt-1 font-semibold text-ink">{bomSummary.snapshotSubtotal != null ? money(bomSummary.snapshotSubtotal) : '不完整'}</div>
                    </div>
                    <div className="bg-white px-4 py-3">
                      <div className="text-xs text-muted">当前配件合计</div>
                      <div className="mt-1 font-semibold text-ink">{bomSummary.currentSubtotal != null ? money(bomSummary.currentSubtotal) : '不完整'}</div>
                    </div>
                    <div className="bg-white px-4 py-3">
                      <div className="text-xs text-muted">配件差额</div>
                      <div className="mt-1 font-semibold text-ink">{signedMoney(bomSummary.difference)}</div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                      <tr>
                        <th className="border-b border-line px-4 py-3">名称</th>
                        <th className="border-b border-line px-4 py-3">型号</th>
                        <th className="border-b border-line px-4 py-3">供应商</th>
                        <th className="border-b border-line px-4 py-3 text-right">数量</th>
                        <th className="border-b border-line px-4 py-3 text-right">快照价</th>
                        <th className="border-b border-line px-4 py-3 text-right">当前价</th>
                        <th className="border-b border-line px-4 py-3 text-right">快照小计</th>
                        <th className="border-b border-line px-4 py-3 text-right">当前小计</th>
                        <th className="border-b border-line px-4 py-3 text-right">差额</th>
                        <th className="border-b border-line px-4 py-3">当前来源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bomGroups.map((group) => (
                        <Fragment key={group.category}>
                          {!group.category.startsWith('single-') ? (
                            <tr className="bg-slate-50"><th colSpan={10} className="border-b border-line px-4 py-2 text-ink">{group.category}</th></tr>
                          ) : null}
                      {group.rows.map((row, index) => {
                        const part = row.part;
                        return (
                          <tr key={`${part.model}-${part.supplier || ''}-${index}`} className="transition-colors duration-150 hover:bg-slate-50">
                            <td className={`border-b border-line py-3 pr-4 font-medium text-ink ${group.category.startsWith('single-') ? 'pl-4' : 'pl-8'}`}>
                              {part.name || part.model || '-'}{!group.category.startsWith('single-') ? <span className="ml-1 font-normal text-muted">× {row.qty}</span> : null}
                            </td>
                            <td className="border-b border-line px-4 py-3 text-muted">{recipePartModel(part, recipe)}</td>
                            <td className="border-b border-line px-4 py-3 text-muted">{part.supplier || '-'}</td>
                            <td className="border-b border-line px-4 py-3 text-right text-muted">
                              {part.cableAssembly ? `1 根 / ${part.cableLength || part.inventoryQty || 0}m` : row.qty || 1}
                            </td>
                            <td className="border-b border-line px-4 py-3 text-right text-muted">{row.snapshotPrice != null ? money(row.snapshotPrice) : '-'}</td>
                            <td className="border-b border-line px-4 py-3 text-right text-muted">{row.currentPrice != null ? money(row.currentPrice) : '-'}</td>
                            <td className="border-b border-line px-4 py-3 text-right text-muted">{row.savedSubtotal != null ? money(row.savedSubtotal) : '-'}</td>
                            <td className="border-b border-line px-4 py-3 text-right text-muted">{row.currentSubtotal != null ? money(row.currentSubtotal) : '-'}</td>
                            <td className={`border-b border-line px-4 py-3 text-right font-medium ${Number(row.diff || 0) > 0 ? 'text-rose-700' : Number(row.diff || 0) < 0 ? 'text-emerald-700' : 'text-muted'}`}>
                              {row.diff != null ? money(row.diff) : '-'}
                            </td>
                            <td className="border-b border-line px-4 py-3 text-muted">{row.current?.source || '-'}</td>
                          </tr>
                        );
                      })}
                        </Fragment>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-semibold text-ink">
                      <tr>
                        <td colSpan={3} className="border-t border-line px-4 py-3">合计（{parts.length} 项）</td>
                        <td className="border-t border-line px-4 py-3 text-right">{bomSummary.totalQty}</td>
                        <td className="border-t border-line px-4 py-3 text-right text-muted">-</td>
                        <td className="border-t border-line px-4 py-3 text-right text-muted">-</td>
                        <td className="border-t border-line px-4 py-3 text-right">{bomSummary.snapshotSubtotal != null ? money(bomSummary.snapshotSubtotal) : '不完整'}</td>
                        <td className="border-t border-line px-4 py-3 text-right">{bomSummary.currentSubtotal != null ? money(bomSummary.currentSubtotal) : '不完整'}</td>
                        <td className="border-t border-line px-4 py-3 text-right">{signedMoney(bomSummary.difference)}</td>
                        <td className="border-t border-line px-4 py-3 text-muted">-</td>
                      </tr>
                    </tfoot>
                    </table>
                  </div>
                </>
              )}
              <div className="border-y border-line p-4 text-sm font-semibold text-ink">人工、表面处理与管理费用</div>
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                {fees.map((fee) => <div key={fee.name} className="rounded-md bg-slate-50 p-3"><div className="text-xs text-muted">{fee.name}{fee.process ? ` · ${fee.process}` : ''}</div><div className="mt-1 font-semibold text-ink">{fee.amount != null ? money(fee.amount) : '未记录'}</div></div>)}
              </div>
              <div className="border-t border-line px-4 py-3 text-sm text-muted">保存完整成本：<span className="font-semibold text-ink">{savedTotal != null ? money(savedTotal) : '未记录'}</span>（包含上述物料及费用，以保存成本为准）</div>
            </section>

            <section className="rounded-panel border border-line">
              <div className="border-b border-line p-4 text-sm font-semibold text-ink">关键参数</div>
              <div className="grid gap-3 p-4 text-sm md:grid-cols-2">
                <div className="text-muted">线圈：<span className="text-ink">{[recipe.coilSpec, recipe.coilSheets ? `${recipe.coilSheets}片` : '', recipe.coilMaterial, recipe.coilSlotType || '小眼'].filter(Boolean).join(' / ') || '-'}</span></div>
                <div className="text-muted">
                  机筒长度：<span className={barrelLength.value ? 'text-ink' : 'text-amber-700'}>
                    {barrelLength.value ? `${barrelLength.value} mm` : '未记录，请在编辑配方中补录'}
                  </span>
                  {barrelLength.source === 'bom' ? <span className="ml-1 text-xs text-muted">（来自 BOM 快照）</span> : null}
                </div>
                <div className="text-muted">叶轮：<span className="text-ink">{[recipe.impellerModel, recipe.impellerThickness ? `${recipe.impellerThickness}厚` : '', recipe.impellerDiameter ? `直径${recipe.impellerDiameter}` : '', recipe.impellerBladeCount ? `${recipe.impellerBladeCount}片` : ''].filter(Boolean).join(' / ') || '-'}</span></div>
                <div className="text-muted">动态配置：<span className="text-ink">{[recipe.hasFloat ? `浮球 ${recipe.floatWire || '-'}` : '', recipe.hasCable ? `电缆 ${recipe.cableWire || '-'} ${recipe.cableLength || 0}m` : ''].filter(Boolean).join(' / ') || '-'}</span></div>
              </div>
            </section>

            {technicalEntries.length > 0 ? (
              <section className="rounded-panel border border-line">
                <div className="border-b border-line p-4 text-sm font-semibold text-ink">技术参数</div>
                <div className="grid gap-3 p-4 text-sm md:grid-cols-2">
                  {technicalEntries.map((entry) => (
                    <div key={entry.id} className="text-muted">
                      {entry.label || '参数'}：<span className="text-ink">{entry.value || '-'}</span>{entry.unit ? ` ${entry.unit}` : ''}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <details key={recipe.id} className="rounded-panel border border-line">
              <summary className="cursor-pointer p-4 text-sm font-semibold text-ink">配件与线圈库存 <span className="ml-2 font-normal text-muted">点击展开</span></summary>
              <div className="flex items-center justify-between gap-3 border-y border-line px-4 py-2">
                <div>
                  <div className="mt-1 text-xs text-muted">分别读取零件库和线圈库存</div>
                </div>
                <button
                  type="button"
                  aria-label="刷新库存状态"
                  title="刷新库存状态"
                  onClick={() => void onRefreshInventory(recipe)}
                  disabled={inventoryStatusLoading}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:opacity-60"
                >
                  <RefreshCw size={14} className={inventoryStatusLoading ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="p-4">
                {inventoryStatusError ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{inventoryStatusError}</div>
                ) : inventoryStatus ? (
                  <div className="overflow-x-auto rounded-md border border-line">
                    <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                        <tr>
                          <th className="border-b border-line px-3 py-2">配件</th>
                          <th className="border-b border-line px-3 py-2 text-right">库存</th>
                          <th className="border-b border-line px-3 py-2">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventoryStatus.items.map((item, index) => {
                          const presentation = recipeInventoryPresentation(item);
                          return (
                          <tr key={`${item.inventoryType}-${item.partId ?? item.coilId ?? index}-${index}`} className={item.status === 'needs_review' ? 'bg-amber-50/60' : item.status === 'missing' || item.status === 'out_of_stock' ? 'bg-rose-50/60' : ''}>
                            <td className="border-b border-line px-3 py-2">
                              <div className="font-medium text-ink">{presentation.name}</div>
                              <div className="text-xs text-muted">{presentation.model}{item.supplier ? ` / ${item.supplier}` : ''}</div>
                              {presentation.previousName ? <div className="mt-1 text-xs text-muted">保存时型号：{presentation.previousName}</div> : null}
                              {item.message ? <div className="mt-1 text-xs text-muted">{item.message}</div> : null}
                            </td>
                            <td className="border-b border-line px-3 py-2 text-right text-muted">{presentation.stockText}</td>
                            <td className="border-b border-line px-3 py-2">
                              <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-4 text-sm text-muted">正在读取库存状态...</div>
                )}
              </div>
            </details>
          </div>
          <RecipePrintSheet recipe={recipe} templateName={templateName} groups={bomGroups} savedTotal={savedTotal} barrelLength={barrelLength.value} technicalEntries={technicalEntries} />
        </div>
      ) : null}
    </SlideOver>
  );
}
