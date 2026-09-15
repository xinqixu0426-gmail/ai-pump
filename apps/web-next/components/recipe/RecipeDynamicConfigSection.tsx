'use client';

import { EditableWireSelect } from '@/components/recipe/EditableValueSelect';
import { RecipeSection as WorkspaceSection, RecipeStatusBadge } from '@/components/recipe/RecipeSection';
import { partCostLine, partFormulaLine, recipePartSubtotal } from '@/components/recipe/recipe-cost-display';
import { Checkbox, selectInputValueOnFocus } from '@/components/ui/field';
import { money } from '@/lib/format';
import type { CableAccessoryType, RecipePart } from '@/lib/recipes';

type RecipeDynamicFields = {
  hasFloat: boolean;
  floatWire: string;
  floatAccessoryType: CableAccessoryType;
  hasCable: boolean;
  cableLength: string;
  cableWire: string;
  cableAccessoryType: CableAccessoryType;
};

type RecipeDynamicConfigSectionProps = {
  form: RecipeDynamicFields;
  complete: boolean;
  floatWireOptions: string[];
  cableWireOptions: string[];
  recommendedFloatWire: string;
  recommendedCableWire: string;
  isFloatWireRecommended: boolean;
  isCableWireRecommended: boolean;
  floatCostReady: boolean;
  cableCostReady: boolean;
  costLoading: boolean;
  floatCostPart?: RecipePart;
  cableCostPart?: RecipePart;
  onChange: (patch: Partial<RecipeDynamicFields>) => void;
  onFloatWireChange: (value: string) => void;
  onCableWireChange: (value: string) => void;
};

function normalizeWireGauge(value: unknown): string {
  return String(value ?? '').trim().replace(/^线径/, '');
}

export function wireLinkNote(enabled: boolean, currentWire: string, recommendedWire?: string, specification = '线径'): string {
  if (!enabled) return '未启用';
  if (!recommendedWire) return `线圈未给出推荐${specification}`;
  if (!currentWire) return `待选择，线圈推荐 ${recommendedWire}`;
  return normalizeWireGauge(currentWire) === normalizeWireGauge(recommendedWire)
    ? `随线圈推荐${specification} ${recommendedWire} 自动推荐`
    : `当前 ${currentWire}，线圈推荐 ${recommendedWire}`;
}

function DynamicConfigCostRow({
  label,
  ready,
  loading,
  part,
}: {
  label: string;
  ready: boolean;
  loading: boolean;
  part?: RecipePart;
}) {
  const amount = recipePartSubtotal(part);
  const unpriced = Boolean(part) && Number(part?.snapshotPrice || 0) <= 0;
  const note = loading && ready && part
    ? '正在更新，暂显上次结果'
    : loading
      ? '首次计算中'
    : !ready
      ? '参数填写完整后自动计算'
      : !part
        ? '等待生成成本'
        : unpriced
          ? '未匹配到零件价格，请先补齐零件库'
          : partFormulaLine(part) || partCostLine(part);

  return (
    <div className="mt-3 flex min-h-12 items-center justify-between gap-4 border-t border-line pt-3">
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted">{label}</div>
        <div className={`mt-0.5 text-xs leading-5 ${unpriced ? 'text-red-700' : 'text-muted'}`}>{note}</div>
      </div>
      <div className={`shrink-0 text-base font-semibold tabular-nums ${unpriced ? 'text-red-700' : 'text-ink'}`}>
        {!ready || !part ? '-' : money(amount)}
      </div>
    </div>
  );
}

export function RecipeDynamicConfigSection({
  form,
  complete,
  floatWireOptions,
  cableWireOptions,
  recommendedFloatWire,
  recommendedCableWire,
  isFloatWireRecommended,
  isCableWireRecommended,
  floatCostReady,
  cableCostReady,
  costLoading,
  floatCostPart,
  cableCostPart,
  onChange,
  onFloatWireChange,
  onCableWireChange,
}: RecipeDynamicConfigSectionProps) {
  const enabled = form.hasFloat || form.hasCable;

  return (
    <WorkspaceSection
      id="recipe-dynamic-config-section"
      title="3. 浮球与电缆"
      description="动态配置会进入 BOM 草稿，并实时影响成本预览。"
      summary={[
        form.hasFloat ? `浮球 ${form.floatWire || '待填线径'}` : '',
        form.hasCable ? `电缆 ${form.cableWire ? `${form.cableWire}mm²` : '待填横截面积'} / ${form.cableLength || '待填长度'}m` : '',
      ].filter(Boolean).join(' · ') || '未启用浮球和电缆'}
      status={complete ? 'complete' : 'warning'}
      badge={!enabled ? '未启用' : '已配置'}
      badgeTone={complete ? 'green' : 'amber'}
      defaultOpen={false}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-line p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <Checkbox
              checked={form.hasFloat}
              onChange={(event) => onChange({ hasFloat: event.target.checked })}
            />
            浮球
          </label>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <label className="block">
              <span className="flex min-h-6 items-center gap-2 text-xs font-medium text-muted">
                线径
                {isFloatWireRecommended ? <RecipeStatusBadge tone="green">系统推荐</RecipeStatusBadge> : null}
              </span>
              <EditableWireSelect
                value={form.floatWire}
                options={floatWireOptions}
                onChange={onFloatWireChange}
                ariaLabel="浮球线径"
                listboxId="recipe-float-wire-listbox"
                disabled={!form.hasFloat}
              />
              {form.hasFloat ? (
                <span className={`mt-1 block text-xs ${isFloatWireRecommended ? 'text-emerald-700' : recommendedFloatWire ? 'text-amber-700' : 'text-muted'}`}>
                  {wireLinkNote(form.hasFloat, form.floatWire, recommendedFloatWire)}
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted">类型</span>
              <select
                value={form.floatAccessoryType}
                onChange={(event) => onChange({ floatAccessoryType: event.target.value as CableAccessoryType })}
                disabled={!form.hasFloat}
                className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
              >
                <option value="standard">普通</option>
                <option value="xinjie">新界式</option>
              </select>
            </label>
          </div>
          {form.hasFloat ? (
            <DynamicConfigCostRow label="浮球成本" ready={floatCostReady} loading={costLoading} part={floatCostPart} />
          ) : null}
        </div>

        <div className="rounded-md border border-line p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <Checkbox
              checked={form.hasCable}
              onChange={(event) => onChange({ hasCable: event.target.checked })}
            />
            电缆
          </label>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="flex min-h-6 items-center gap-2 text-xs font-medium text-muted">
                横截面积 mm²
                {isCableWireRecommended ? <RecipeStatusBadge tone="green">系统推荐</RecipeStatusBadge> : null}
              </span>
              <EditableWireSelect
                value={form.cableWire}
                options={cableWireOptions}
                onChange={onCableWireChange}
                ariaLabel="电缆横截面积 mm²"
                listboxId="recipe-cable-wire-listbox"
                disabled={!form.hasCable}
              />
              {form.hasCable ? (
                <span className={`mt-1 block text-xs ${isCableWireRecommended ? 'text-emerald-700' : recommendedCableWire ? 'text-amber-700' : 'text-muted'}`}>
                  {wireLinkNote(form.hasCable, form.cableWire, recommendedCableWire, '横截面积（mm²）')}
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted">长度 m</span>
              <input
                value={form.cableLength}
                onChange={(event) => onChange({ cableLength: event.target.value })}
                onFocus={selectInputValueOnFocus}
                type="number"
                min="0"
                step="0.1"
                disabled={!form.hasCable}
                className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted">插头 / 规格</span>
              <select
                value={form.cableAccessoryType}
                onChange={(event) => onChange({ cableAccessoryType: event.target.value as CableAccessoryType })}
                disabled={!form.hasCable}
                className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
              >
                <option value="standard">普通</option>
                <option value="xinjie">新界式</option>
              </select>
            </label>
          </div>
          {form.hasCable ? (
            <DynamicConfigCostRow label="成品电缆成本" ready={cableCostReady} loading={costLoading} part={cableCostPart} />
          ) : null}
        </div>
      </div>
    </WorkspaceSection>
  );
}
