'use client';

import { Checkbox, selectInputValueOnFocus } from '@/components/ui/field';
import type { OrderItem } from '@/lib/orders';
import type { Recipe, SurfaceTreatmentMode } from '@/lib/recipes';
import {
  configurationAllowedValues,
  configurationValueAllowed,
  recipePackingPartIds,
  recipeSurfaceTreatmentOptions,
} from '@/lib/configuration-policy';
import {
  configurationDifferences,
  configurationSummary,
  findPackingOption,
  inferPackingRole,
  normalizePackingParts,
  packingOptionKey,
  resolvePackingPart,
  updatePackingRole,
  type RecipeConfigurationOverrides,
  type RecipePackingOption,
  type RecipePackingRole,
} from '@/lib/recipe-configurations';

const surfaceTreatmentOptions: Array<{ value: SurfaceTreatmentMode; label: string }> = [
  { value: 'none', label: '无处理' },
  { value: 'painting', label: '喷漆' },
  { value: 'electrophoresis', label: '电泳' },
  { value: 'powder_coating', label: '整体喷塑' },
  { value: 'electrophoresis_powder_coating', label: '电泳+喷塑' },
  { value: 'custom', label: '自定义' },
];

export function OrderItemConfigurationEditor({
  item,
  recipe,
  packingOptions,
  calculating,
  onChange,
  onError,
}: {
  item: OrderItem;
  recipe?: Recipe;
  packingOptions: RecipePackingOption[];
  calculating: boolean;
  onChange: (patch: RecipeConfigurationOverrides) => void;
  onError: (message: string) => void;
}) {
  const overrides = item.configurationOverrides || {};
  const differences = configurationDifferences(recipe, overrides);
  const summary = configurationSummary(overrides);
  const packingParts = normalizePackingParts(overrides.packingPartsJson);
  const allowedPackingPartIds = recipePackingPartIds(recipe);
  const basePackingParts = normalizePackingParts(recipe?.packingPartsJson);
  const policyPackingOptions = allowedPackingPartIds === null
    ? packingOptions
    : packingOptions.filter(option => (
      Boolean(option.partId && allowedPackingPartIds.includes(option.partId))
      || basePackingParts.some(base => (
        base.model === option.model && (base.supplier || '') === option.supplier
      ))
    ));
  const containerOptions = policyPackingOptions.filter(option => option.packingRole === 'container');
  const container = resolvePackingPart(overrides.packingPartsJson, 'container', overrides.boxType);
  const currentContainerOption = findPackingOption(containerOptions, container);
  const currentContainerKey = currentContainerOption ? packingOptionKey(currentContainerOption) : '';

  function defaultOption(role: RecipePackingRole): RecipePackingOption | undefined {
    const basePart = resolvePackingPart(recipe?.packingPartsJson, role, recipe?.boxType);
    if (basePart?.model) {
      return policyPackingOptions.find(option => (
        option.packingRole === role
        && option.model === basePart.model
        && option.supplier === (basePart.supplier || '')
      ));
    }
    return policyPackingOptions.find(option => option.packingRole === role);
  }

  const coilSheetValues = configurationAllowedValues(recipe, 'coilSheets');
  const cableLengthValues = configurationAllowedValues(recipe, 'cableLength');
  const barrelLengthValues = configurationAllowedValues(recipe, 'customBarrelLength');
  const allowedSurfaceOptions = recipeSurfaceTreatmentOptions(recipe);
  const displayedSurfaceOptions = allowedSurfaceOptions === null
    ? surfaceTreatmentOptions.map(option => ({ ...option, cost: undefined as number | undefined }))
    : allowedSurfaceOptions.map(option => ({
      value: option.mode,
      label: surfaceTreatmentOptions.find(item => item.value === option.mode)?.label || option.mode,
      cost: option.cost,
    }));

  function numericPolicyValues(values: Array<string | number | boolean> | null, baseline: number | null | undefined) {
    if (values === null) return null;
    return Array.from(new Set([baseline, ...values].filter(value => value !== null && value !== undefined).map(Number)))
      .filter(value => Number.isFinite(value))
      .sort((left, right) => left - right);
  }

  function setPackingRole(role: RecipePackingRole, option?: RecipePackingOption) {
    onChange(updatePackingRole(overrides, role, option));
  }

  function togglePackingRole(role: 'foam' | 'pearlCotton', enabled: boolean) {
    if (!enabled) {
      setPackingRole(role);
      return;
    }
    const option = defaultOption(role);
    if (!option) {
      onError(role === 'foam' ? '零件库和配方中没有可用泡沫包材' : '零件库和配方中没有可用珍珠棉包材');
      return;
    }
    setPackingRole(role, option);
  }

  return (
    <div className="border-t border-line bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-ink">客户配置</div>
          <div className="mt-1 text-xs text-muted">{summary.join('；')}</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {differences.length > 0 ? differences.map(value => (
            <span key={value} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
              {value}
            </span>
          )) : <span className="text-[11px] text-muted">沿用配方默认配置</span>}
          {calculating ? <span className="text-[11px] text-sky-700">成本重算中...</span> : null}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block text-xs text-muted">
          线圈片数
          {numericPolicyValues(coilSheetValues, recipe?.coilSheets) ? (
            <select value={String(overrides.coilSheets ?? recipe?.coilSheets ?? '')} onChange={event => onChange({ coilSheets: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-sky-400">
              {numericPolicyValues(coilSheetValues, recipe?.coilSheets)?.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : (
            <input type="number" min="1" step="1" value={overrides.coilSheets ?? ''} onFocus={selectInputValueOnFocus} onChange={event => onChange({ coilSheets: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-sky-400" />
          )}
          <span className="mt-1 block text-[11px] text-slate-400">{overrides.coilSpec || '-'} · {overrides.coilMaterial || '钢带'} · {overrides.coilSlotType || '小眼'}</span>
        </label>

        <label className="block text-xs text-muted">
          电缆长度（米）
          {numericPolicyValues(cableLengthValues, recipe?.cableLength) ? (
            <select value={String(overrides.cableLength ?? recipe?.cableLength ?? '')} onChange={event => { const cableLength = event.target.value; onChange({ cableLength, hasCable: Number(cableLength) > 0 }); }} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-sky-400">
              {numericPolicyValues(cableLengthValues, recipe?.cableLength)?.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : (
            <input type="number" min="0" step="1" value={overrides.cableLength ?? ''} onFocus={selectInputValueOnFocus} onChange={event => { const cableLength = event.target.value; onChange({ cableLength, hasCable: Number(cableLength) > 0 }); }} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-sky-400" />
          )}
          <span className="mt-1 block text-[11px] text-slate-400">{overrides.cableWire || '-'} · {overrides.cableAccessoryType === 'xinjie' ? '新界式' : '普通铜套'}</span>
        </label>

        <label className="block text-xs text-muted">
          外包装
          <select
            value={currentContainerKey}
            onChange={event => setPackingRole(
              'container',
              containerOptions.find(option => packingOptionKey(option) === event.target.value),
            )}
            className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-sky-400"
          >
            <option value="">未配置外包装</option>
            {containerOptions.map(option => (
              <option key={packingOptionKey(option)} value={packingOptionKey(option)}>
                {option.packagingMaterial} · {option.model}{option.supplier ? ` / ${option.supplier}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs text-muted">
          机筒长度（mm）
          {numericPolicyValues(barrelLengthValues, recipe?.customBarrelLength) ? (
            <select value={String(overrides.customBarrelLength ?? recipe?.customBarrelLength ?? '')} onChange={event => onChange({ customBarrelLength: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-sky-400">
              {numericPolicyValues(barrelLengthValues, recipe?.customBarrelLength)?.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : (
            <input type="number" min="0" step="1" value={overrides.customBarrelLength ?? ''} onFocus={selectInputValueOnFocus} onChange={event => onChange({ customBarrelLength: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-sky-400" />
          )}
        </label>
      </div>

      <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-[1fr_13rem_8rem] sm:items-end">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-ink">
            <Checkbox
              checked={Boolean(overrides.hasFloat)}
              disabled={!configurationValueAllowed(recipe, 'hasFloat', !Boolean(overrides.hasFloat), Boolean(recipe?.hasFloat))}
              onChange={event => onChange({ hasFloat: event.target.checked })}
            />
            带浮球
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <Checkbox
              checked={packingParts.some(part => inferPackingRole(part) === 'foam')}
              onChange={event => togglePackingRole('foam', event.target.checked)}
            />
            带泡沫
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <Checkbox
              checked={packingParts.some(part => inferPackingRole(part) === 'pearlCotton')}
              onChange={event => togglePackingRole('pearlCotton', event.target.checked)}
            />
            带珍珠棉
          </label>
        </div>

        <label className="block text-xs text-muted">
          表面处理
          <select
            value={overrides.surfaceTreatmentMode || 'none'}
            onChange={event => {
              const mode = event.target.value as SurfaceTreatmentMode;
              const policyOption = displayedSurfaceOptions.find(option => option.value === mode);
              onChange({ surfaceTreatmentMode: mode, surfaceTreatmentCost: policyOption?.cost ?? (mode === 'none' ? 0 : overrides.surfaceTreatmentCost) });
            }}
            className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-sky-400"
          >
            {displayedSurfaceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="block text-xs text-muted">
          工艺成本
          <input
            type="number"
            min="0"
            step="0.01"
            disabled={allowedSurfaceOptions !== null || (overrides.surfaceTreatmentMode || 'none') === 'none'}
            value={overrides.surfaceTreatmentCost ?? 0}
            onChange={event => onChange({ surfaceTreatmentCost: event.target.value })}
            className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-sky-400 disabled:bg-slate-100"
          />
        </label>
      </div>

      {item.configurationWarnings?.map(warning => (
        <div key={warning.code} className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {warning.message}
        </div>
      ))}
    </div>
  );
}
