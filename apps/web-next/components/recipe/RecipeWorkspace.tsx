'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { CheckCircle2, CircleAlert, Copy, Eye, GitCompare, Package, Pencil, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { PresenceRow } from '@/components/motion/presence-row';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/field';
import { MetricCard } from '@/components/ui/metric-card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { dateShort, money } from '@/lib/format';
import { getRecipeTechnicalProgress, parseTechnicalDataJson, type RecipeTechnicalProgress } from '@/lib/technical-data';
import {
  buildRecipeCopperRisk,
  buildTemplateNameMap,
  getRecipeLaborTotal,
  getRecipeSavedTotal,
  parseRecipePartsJson,
  recipePartsOverview,
  validRecipeParts,
  type PumpShellTemplate,
  type Recipe,
  type RecipeCurrentTotalCost,
} from '@/lib/recipes';

export type RecipeWorkspaceFilter = 'all' | 'risk' | 'missingCost' | 'incompleteCost' | 'float' | 'cable';

type RecipeWorkspaceProps = {
  recipes: Recipe[];
  templates: PumpShellTemplate[];
  currentCosts: RecipeCurrentTotalCost[];
  currentCopperPricePerKg: number | null;
  query: string;
  templateId: string;
  quickFilter: RecipeWorkspaceFilter;
  compareIds: number[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  warning: string | null;
  onQueryChange: (value: string) => void;
  onTemplateIdChange: (value: string) => void;
  onQuickFilterChange: (value: RecipeWorkspaceFilter) => void;
  onClearCompare: () => void;
  onOpenCompare: () => void;
  onToggleCompare: (recipeId: number) => void;
  onView: (recipe: Recipe) => void;
  onEdit: (recipe: Recipe) => void;
  onClone: (recipe: Recipe) => void;
  onRemove: (recipe: Recipe) => void | Promise<void>;
};

const quickFilters: Array<{ value: RecipeWorkspaceFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'risk', label: '铜价风险' },
  { value: 'missingCost', label: '无保存成本' },
  { value: 'incompleteCost', label: '当日成本不完整' },
  { value: 'float', label: '带浮球' },
  { value: 'cable', label: '带电缆' },
];

function copperRiskTone(level: string): StatusBadgeTone {
  if (level === 'critical') return 'red';
  if (level === 'review') return 'orange';
  if (level === 'watch') return 'amber';
  if (level === 'missing') return 'slate';
  return 'green';
}

function signedMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${money(Math.abs(value))}`;
}

function TechnicalProgress({
  progress,
  technicalFileCount = 0,
  tooltipId,
}: {
  progress: RecipeTechnicalProgress;
  technicalFileCount?: number;
  tooltipId: string;
}) {
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const complete = progress.completed === progress.total;
  const hasReports = technicalFileCount > 0;
  const barColor = complete ? 'bg-emerald-500' : progress.completed > 0 ? 'bg-sky-500' : 'bg-slate-300';
  const textColor = complete ? 'text-emerald-700' : progress.completed > 0 ? 'text-sky-700' : 'text-muted';

  function showDetails(target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 460)),
      top: rect.bottom > window.innerHeight / 2 ? rect.top - 8 : rect.bottom + 8,
      above: rect.bottom > window.innerHeight / 2,
    });
  }

  return (
    <>
    <button
      type="button"
      className="min-w-24 cursor-help rounded-md text-left outline-none transition-colors focus:ring-2 focus:ring-sky-100"
      aria-label={`技术参数已填写 ${progress.completed} 项，共 ${progress.total} 项`}
      aria-describedby={position ? tooltipId : undefined}
      onMouseEnter={(event) => showDetails(event.currentTarget)}
      onMouseLeave={() => setPosition(null)}
      onFocus={(event) => showDetails(event.currentTarget)}
      onBlur={() => setPosition(null)}
      onKeyDown={(event) => { if (event.key === 'Escape') setPosition(null); }}
    >
      <div className={`flex items-center justify-between gap-2 text-xs font-medium ${textColor}`}>
        <span>技术参数</span>
        <span>{progress.completed}/{progress.total}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${progress.percent}%` }} />
      </div>
      <div className={`mt-1 text-[11px] font-medium ${hasReports ? 'text-emerald-700' : 'text-slate-400'}`}>
        {hasReports ? `报告 ${technicalFileCount} 份` : '无测试报告'}
      </div>
    </button>
    {position && typeof document !== 'undefined' ? createPortal(
      <div
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none fixed z-[100] w-[28rem] max-w-[calc(100vw-1.5rem)] rounded-md border border-slate-200 bg-white p-3 text-left shadow-xl"
        style={{
          left: position.left,
          top: position.top,
          transform: position.above ? 'translateY(-100%)' : undefined,
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
          <span className="text-xs font-semibold text-ink">已填技术参数</span>
          <span className={`text-xs font-medium ${textColor}`}>{progress.completed}/{progress.total}</span>
        </div>
        {progress.entries.length > 0 ? (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            {progress.entries.map((entry) => (
              <div key={entry.id} className="min-w-0 border-b border-slate-100 pb-1.5">
                <div className="truncate text-[11px] text-muted">{entry.label}</div>
                <div className="mt-0.5 break-words text-xs font-medium text-ink">{entry.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-3 text-xs text-muted">暂无已填参数</div>
        )}
      </div>,
      document.body,
    ) : null}
    </>
  );
}

export function RecipeWorkspace({
  recipes,
  templates,
  currentCosts,
  currentCopperPricePerKg,
  query,
  templateId,
  quickFilter,
  compareIds,
  loading,
  saving,
  error,
  warning,
  onQueryChange,
  onTemplateIdChange,
  onQuickFilterChange,
  onClearCompare,
  onOpenCompare,
  onToggleCompare,
  onView,
  onEdit,
  onClone,
  onRemove,
}: RecipeWorkspaceProps) {
  const templateNameMap = useMemo(() => buildTemplateNameMap(templates), [templates]);
  const currentCostMap = useMemo(
    () => new Map(currentCosts.map((item) => [item.recipeId, item])),
    [currentCosts]
  );
  const recipeRows = useMemo(() => {
    return recipes.map((recipe) => {
      const parts = validRecipeParts(parseRecipePartsJson(recipe.partsJson));
      return {
        recipe,
        overview: recipePartsOverview(parts),
        savedTotal: getRecipeSavedTotal(recipe),
        currentCost: currentCostMap.get(recipe.id) || null,
        laborTotal: getRecipeLaborTotal(recipe),
        templateName: recipe.templateId ? templateNameMap.get(recipe.templateId) || '' : '',
        copperRisk: buildRecipeCopperRisk(parts, currentCopperPricePerKg),
        technicalProgress: getRecipeTechnicalProgress({
          technicalData: parseTechnicalDataJson(recipe.technicalDataJson),
          impellerModel: recipe.impellerModel,
          impellerThickness: recipe.impellerThickness,
          impellerDiameter: recipe.impellerDiameter,
          impellerBladeCount: recipe.impellerBladeCount,
        }),
      };
    });
  }, [currentCopperPricePerKg, currentCostMap, recipes, templateNameMap]);
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return recipeRows.filter((row) => {
      const recipe = row.recipe;
      const text = [
        recipe.name,
        recipe.spec,
        row.templateName,
        recipe.coilSpec,
        recipe.coilSheets,
        recipe.coilMaterial,
        recipe.impellerModel,
        row.overview,
        row.copperRisk.label,
        row.copperRisk.detail,
      ].join(' ').toLowerCase();
      const matchesTemplate = templateId === '全部' || String(recipe.templateId || '') === templateId;
      const matchesQuick =
        quickFilter === 'all' ||
        (quickFilter === 'risk' && ['watch', 'review', 'critical'].includes(row.copperRisk.level)) ||
        (quickFilter === 'missingCost' && !row.savedTotal) ||
        (quickFilter === 'incompleteCost' && row.currentCost?.costComplete === false) ||
        (quickFilter === 'float' && Boolean(recipe.hasFloat)) ||
        (quickFilter === 'cable' && Boolean(recipe.hasCable));
      return matchesTemplate && matchesQuick && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [query, quickFilter, recipeRows, templateId]);
  const stats = useMemo(() => {
    const totalSavedCost = recipeRows.reduce((sum, row) => sum + (row.savedTotal || 0), 0);
    const riskyCount = recipeRows.filter((row) => ['watch', 'review', 'critical'].includes(row.copperRisk.level)).length;
    const missingCostCount = recipeRows.filter((row) => !row.savedTotal).length;
    const incompleteCurrentCostCount = recipeRows.filter((row) => row.currentCost?.costComplete === false).length;
    return { totalSavedCost, riskyCount, missingCostCount, incompleteCurrentCostCount };
  }, [recipeRows]);
  const hasCostIssues = stats.riskyCount > 0 || stats.missingCostCount > 0 || stats.incompleteCurrentCostCount > 0;

  return (
    <>
      <FadePanel className="rounded-panel border border-line bg-white p-3 shadow-panel sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink">{recipes.length} 个配方 · 保存成本 {money(stats.totalSavedCost)}</div>
            <div className={`mt-1 text-xs ${hasCostIssues ? 'text-amber-700' : 'text-emerald-700'}`}>
              {hasCostIssues ? `当日成本不完整 ${stats.incompleteCurrentCostCount} 个 · 铜价关注 ${stats.riskyCount} 个 · 无保存成本 ${stats.missingCostCount} 个` : '成本状态正常'}
            </div>
          </div>
          {hasCostIssues ? (
            <Button size="sm" onClick={() => onQuickFilterChange(
              stats.incompleteCurrentCostCount > 0 ? 'incompleteCost' : stats.riskyCount > 0 ? 'risk' : 'missingCost'
            )}>
              查看问题
            </Button>
          ) : (
            <CheckCircle2 size={20} className="shrink-0 text-emerald-600" />
          )}
        </div>
      </FadePanel>

      <div className="hidden gap-3 sm:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(18rem,1.4fr)]">
        <MetricCard value={String(recipes.length)} label="配方数量" delay={0.02} />
        <MetricCard value={money(stats.totalSavedCost)} label="保存成本合计" delay={0.04} />
        <FadePanel delay={0.06}>
          <div className={`flex h-full items-center justify-between gap-4 rounded-panel border p-4 shadow-panel ${
            hasCostIssues
              ? 'border-amber-200 bg-amber-50'
              : 'border-emerald-200 bg-emerald-50/70'
          }`}>
            <div>
              <div className={`text-sm font-semibold ${hasCostIssues ? 'text-amber-900' : 'text-emerald-900'}`}>
                {hasCostIssues ? '成本数据需要处理' : '成本状态正常'}
              </div>
              <div className={`mt-1 text-xs ${hasCostIssues ? 'text-amber-700' : 'text-emerald-700'}`}>
                当日成本不完整 {stats.incompleteCurrentCostCount} 个 · 铜价关注 {stats.riskyCount} 个 · 无保存成本 {stats.missingCostCount} 个
              </div>
            </div>
            {hasCostIssues ? (
              <Button
                size="sm"
                onClick={() => onQuickFilterChange(
                  stats.incompleteCurrentCostCount > 0 ? 'incompleteCost' : stats.riskyCount > 0 ? 'risk' : 'missingCost'
                )}
              >
                查看问题
              </Button>
            ) : (
              <CheckCircle2 size={22} className="shrink-0 text-emerald-600" />
            )}
          </div>
        </FadePanel>
      </div>

      <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3">
            <Search size={16} className="text-muted" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索配方、规格、模板、线圈或零件"
              className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            {compareIds.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={onClearCompare}>
                清空对比
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={onOpenCompare}
              disabled={compareIds.length !== 2}
              icon={<GitCompare size={14} />}
            >
              对比 {compareIds.length}/2
            </Button>
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-muted" />
              <select
                value={templateId}
                onChange={(event) => onTemplateIdChange(event.target.value)}
                className="h-9 min-w-36 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 hover:bg-slate-50"
              >
                <option value="全部">全部模板</option>
                {templates.map((template) => (
                  <option key={template.id} value={String(template.id)}>{template.shellModel}</option>
                ))}
              </select>
            </div>
            <div className="max-w-full overflow-x-auto">
              <SegmentedControl value={quickFilter} options={quickFilters} onChange={onQuickFilterChange} ariaLabel="配方快速筛选" />
            </div>
          </div>
        </div>

        {warning && !error ? (
          <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
            <CircleAlert size={16} />
            当日成本暂时无法加载，配方基础资料仍可正常查看：{warning}
          </div>
        ) : null}

        {error ? (
          <div className="flex items-center gap-2 p-5 text-sm text-rose-700">
            <CircleAlert size={16} />
            {error}
          </div>
        ) : loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="mx-auto text-slate-300" size={32} />
            <div className="mt-3 text-sm font-medium text-ink">没有匹配的配方</div>
            <div className="mt-1 text-sm text-muted">调整搜索、模板或快速筛选。</div>
          </div>
        ) : (
          <>
            <div className="divide-y divide-line min-[1180px]:hidden">
              {filteredRows.map((row) => (
                <article key={row.recipe.id} className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={compareIds.includes(row.recipe.id)}
                      onChange={() => onToggleCompare(row.recipe.id)}
                      aria-label={`选择对比${row.recipe.name || row.recipe.id}`}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-line text-ink"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => onView(row.recipe)}
                      className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                    >
                      <span className="block truncate text-sm font-semibold text-ink">{row.recipe.name || '未命名配方'}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted">{row.recipe.spec || '无规格备注'}</span>
                    </button>
                    <div className="shrink-0 text-right">
                      <div className={`text-sm font-semibold ${row.currentCost?.costComplete === false ? 'text-amber-700' : 'text-ink'}`}>
                        {row.currentCost?.costComplete === false
                          ? '成本不完整'
                          : row.currentCost?.currentTotalCost != null ? money(row.currentCost.currentTotalCost) : '-'}
                      </div>
                      <div className={`mt-0.5 text-xs ${
                        Number(row.currentCost?.difference || 0) > 0
                          ? 'text-rose-700'
                          : Number(row.currentCost?.difference || 0) < 0
                            ? 'text-emerald-700'
                            : 'text-muted'
                      }`}>
                        {row.currentCost?.costComplete === false
                          ? row.currentCost.calculationError ? '需处理线圈方案' : `缺 ${row.currentCost.missingParts.length} 项价格`
                          : signedMoney(row.currentCost?.difference)}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-xs sm:grid-cols-2">
                    <div className="min-w-0">
                      <div className="text-muted">模板 / 线圈</div>
                      <div className="mt-1 truncate text-ink">{row.templateName || '-'}</div>
                      <div className="mt-0.5 truncate text-muted">
                        {[row.recipe.coilSpec, row.recipe.coilSheets, row.recipe.coilMaterial, row.recipe.coilSlotType || '小眼'].filter(Boolean).join(' / ') || '无线圈快照'}
                      </div>
                      <div className="mt-2 max-w-44">
                        <TechnicalProgress
                          progress={row.technicalProgress}
                          technicalFileCount={row.recipe.technicalFileCount}
                          tooltipId={`recipe-technical-progress-mobile-${row.recipe.id}`}
                        />
                      </div>
                    </div>
                    <div className="flex items-end justify-between gap-3 sm:flex-col sm:items-end">
                      <StatusBadge tone={copperRiskTone(row.copperRisk.level)}>{row.copperRisk.label}</StatusBadge>
                      <span className="text-muted">保存 {row.savedTotal ? money(row.savedTotal) : '-'} · {dateShort(row.recipe.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button className="h-7" size="sm" variant="ghost" disabled={saving} onClick={() => onView(row.recipe)} icon={<Eye size={16} />}>查看</Button>
                    <Button className="h-7" size="sm" variant="secondary" disabled={saving} onClick={() => onEdit(row.recipe)} icon={<Pencil size={16} />}>编辑</Button>
                    <Button className="h-7" size="sm" variant="ghost" aria-label={`复制${row.recipe.name || '配方'}`} title="复制为新配方" disabled={saving} onClick={() => onClone(row.recipe)} icon={<Copy size={16} />}>复制</Button>
                    <Button className="h-7 w-7 px-0 text-slate-400 hover:text-rose-700" size="sm" variant="ghost" aria-label={`删除${row.recipe.name || '配方'}`} title="删除" disabled={saving} onClick={() => void onRemove(row.recipe)} icon={<Trash2 size={14} />} />
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto min-[1180px]:block">
            <table className="w-full min-w-[1020px] table-fixed border-separate border-spacing-0 text-left text-sm min-[1440px]:min-w-[1144px]">
              <thead className="whitespace-nowrap bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-10 border-b border-line px-3 py-2">对比</th>
                  <th className="w-40 border-b border-line px-3 py-2">配方</th>
                  <th className="w-44 border-b border-line px-3 py-2">模板/线圈</th>
                  <th className="w-32 border-b border-line px-3 py-2">技术参数</th>
                  <th className="w-48 border-b border-line px-3 py-2 text-right">成本（当日 / 保存）</th>
                  <th className="w-20 border-b border-line px-3 py-2">铜价</th>
                  <th className="w-20 border-b border-line px-3 py-2">创建</th>
                  <th className="w-36 border-b border-line px-4 py-2 text-right min-[1440px]:w-72">操作</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {filteredRows.map((row) => (
                    <PresenceRow key={row.recipe.id} className="transition-colors hover:bg-slate-50">
                      <td className="border-b border-line px-4 py-2">
                        <Checkbox
                          checked={compareIds.includes(row.recipe.id)}
                          onChange={() => onToggleCompare(row.recipe.id)}
                          aria-label={`选择对比${row.recipe.name || row.recipe.id}`}
                          className="h-4 w-4 rounded border-line text-ink"
                        />
                      </td>
                      <td className="border-b border-line px-3 py-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => onView(row.recipe)}
                          className="max-w-full truncate text-left font-medium text-ink underline-offset-4 hover:underline disabled:cursor-not-allowed"
                        >
                          {row.recipe.name || '未命名配方'}
                        </button>
                        <div className="max-w-[260px] truncate text-xs leading-4 text-muted">{row.recipe.spec || '-'}</div>
                      </td>
                      <td className="border-b border-line px-3 py-2">
                        <div className="text-ink">{row.templateName || '-'}</div>
                        <div className="text-xs leading-4 text-muted">
                          {[row.recipe.coilSpec, row.recipe.coilSheets, row.recipe.coilMaterial, row.recipe.coilSlotType || '小眼'].filter(Boolean).join(' / ') || '无线圈快照'}
                        </div>
                      </td>
                      <td className="border-b border-line px-3 py-2">
                        <TechnicalProgress
                          progress={row.technicalProgress}
                          technicalFileCount={row.recipe.technicalFileCount}
                          tooltipId={`recipe-technical-progress-desktop-${row.recipe.id}`}
                        />
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-3 py-2 text-right text-ink">
                        <div className="flex items-baseline justify-end gap-2">
                          <span className={`font-medium ${row.currentCost?.costComplete === false ? 'text-amber-700' : ''}`}>
                            {row.currentCost?.costComplete === false
                              ? '成本不完整'
                              : row.currentCost?.currentTotalCost != null ? money(row.currentCost.currentTotalCost) : '-'}
                          </span>
                          <span className={`text-xs ${
                            Number(row.currentCost?.difference || 0) > 0
                              ? 'text-rose-700'
                              : Number(row.currentCost?.difference || 0) < 0
                                ? 'text-emerald-700'
                                : 'text-muted'
                          }`}>
                            {row.currentCost?.costComplete === false
                              ? row.currentCost.calculationError ? '需处理线圈方案' : `缺 ${row.currentCost.missingParts.length} 项价格`
                              : signedMoney(row.currentCost?.difference)}
                          </span>
                        </div>
                        <div className="text-xs font-normal leading-4 text-muted">
                          保存 {row.savedTotal ? money(row.savedTotal) : '-'} · 人工/管理 {money(row.laborTotal)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-3 py-2">
                        <StatusBadge tone={copperRiskTone(row.copperRisk.level)}>{row.copperRisk.label}</StatusBadge>
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-3 py-2 text-muted">{dateShort(row.recipe.createdAt)}</td>
                      <td className="border-b border-line px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button className="h-7 w-7 px-0 min-[1440px]:w-auto min-[1440px]:px-2.5" size="sm" variant="ghost" aria-label={`查看${row.recipe.name || '配方'}详情`} title="查看详情" disabled={saving} onClick={() => onView(row.recipe)} icon={<Eye size={16} />}><span className="hidden min-[1440px]:inline">查看</span></Button>
                          <Button className="h-7 w-7 px-0 min-[1440px]:w-auto min-[1440px]:px-2.5" size="sm" variant="secondary" aria-label={`编辑${row.recipe.name || '配方'}`} title="编辑" disabled={saving} onClick={() => onEdit(row.recipe)} icon={<Pencil size={16} />}><span className="hidden min-[1440px]:inline">编辑</span></Button>
                          <Button className="h-7 w-7 px-0 min-[1440px]:w-auto min-[1440px]:px-2.5" size="sm" variant="ghost" aria-label={`复制${row.recipe.name || '配方'}`} title="复制为新配方" disabled={saving} onClick={() => onClone(row.recipe)} icon={<Copy size={16} />}><span className="hidden min-[1440px]:inline">复制</span></Button>
                          <Button className="h-7 w-7 px-0 text-slate-400 hover:text-rose-700" size="sm" variant="ghost" aria-label={`删除${row.recipe.name || '配方'}`} title="删除" disabled={saving} onClick={() => void onRemove(row.recipe)} icon={<Trash2 size={14} />} />
                        </div>
                      </td>
                    </PresenceRow>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            </div>
          </>
        )}
      </FadePanel>
    </>
  );
}
