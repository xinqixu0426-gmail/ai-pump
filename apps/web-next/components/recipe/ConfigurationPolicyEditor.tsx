'use client';

import type { Part } from '@/lib/parts';
import type { SurfaceTreatmentMode } from '@/lib/recipes';
import { Checkbox } from '@/components/ui/field';
import {
  parseConfigurationPolicy,
  stringifyConfigurationPolicy,
  type RecipeConfigurationPolicy,
  type RecipeConfigurationPolicyField,
} from '@/lib/configuration-policy';

const numberFields: Array<{ key: RecipeConfigurationPolicyField; label: string; placeholder: string }> = [
  { key: 'cableLength', label: '允许的电缆长度（米）', placeholder: '例如：5, 10, 20' },
  { key: 'coilSheets', label: '允许的线圈片数', placeholder: '例如：120, 130, 140' },
  { key: 'customBarrelLength', label: '允许的机筒长度（mm）', placeholder: '例如：150, 160, 180' },
];

const surfaceOptions: Array<{ mode: SurfaceTreatmentMode; label: string }> = [
  { mode: 'none', label: '无处理' },
  { mode: 'painting', label: '喷漆' },
  { mode: 'electrophoresis', label: '电泳' },
  { mode: 'powder_coating', label: '整体喷塑' },
  { mode: 'electrophoresis_powder_coating', label: '电泳+喷塑' },
  { mode: 'custom', label: '自定义' },
];

function emptyPolicy(): RecipeConfigurationPolicy {
  return {
    version: 1,
    fields: {
      hasFloat: [false, true],
      hasCable: [false, true],
    },
  };
}

function numberListText(values: Array<string | number | boolean> | undefined): string {
  return (values || []).map(String).join(', ');
}

function parseNumberList(value: string): number[] {
  return Array.from(new Set(value
    .split(/[,，\s]+/)
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && item >= 0)));
}

function looksLikePacking(part: Part): boolean {
  const text = `${part.category || ''} ${part.subcategory || ''} ${part.model || ''}`;
  return /包装|纸箱|木箱|泡沫|珍珠棉|说明书|贴纸|商标/.test(text);
}

export function ConfigurationPolicyEditor({
  value,
  parts,
  onChange,
}: {
  value: string | null | undefined;
  parts: Part[];
  onChange: (value: string | null) => void;
}) {
  const policy = parseConfigurationPolicy(value);
  const packingParts = parts.filter(looksLikePacking);

  function updatePolicy(update: (current: RecipeConfigurationPolicy) => RecipeConfigurationPolicy) {
    onChange(stringifyConfigurationPolicy(update(policy || emptyPolicy())));
  }

  function setFieldValues(field: RecipeConfigurationPolicyField, values: Array<string | number | boolean> | null) {
    updatePolicy((current) => {
      const fields = { ...current.fields };
      if (values === null) delete fields[field];
      else fields[field] = values;
      return { ...current, fields };
    });
  }

  return (
    <section id="recipe-configuration-policy-section" className="rounded-panel border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">客户可选配置范围</div>
          <div className="mt-1 text-xs text-muted">模板提供默认规则，配方保存自己的副本；报价和订单由服务端按此范围校验。</div>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <Checkbox
            checked={Boolean(policy)}
            onChange={(event) => onChange(event.target.checked ? JSON.stringify(emptyPolicy()) : null)}
            className="h-4 w-4 rounded border-line"
          />
          启用范围管理
        </label>
      </div>

      {!policy ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          当前为历史开放模式：客户配置仍可沿用现有字段。启用后，仅已设置的项目会被严格限制。
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink">
              <Checkbox
                checked={Array.isArray(policy.fields.hasFloat)}
                onChange={(event) => setFieldValues('hasFloat', event.target.checked ? [false, true] : null)}
              />
              客户可增减浮球
            </label>
            <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink">
              <Checkbox
                checked={Array.isArray(policy.fields.hasCable)}
                onChange={(event) => setFieldValues('hasCable', event.target.checked ? [false, true] : null)}
              />
              客户可增减电缆
            </label>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {numberFields.map((field) => {
              const enabled = Array.isArray(policy.fields[field.key]);
              return (
                <label key={field.key} className="block rounded-md border border-line p-3">
                  <span className="flex items-center gap-2 text-xs font-medium text-muted">
                    <Checkbox
                      checked={enabled}
                      onChange={(event) => setFieldValues(field.key, event.target.checked ? [] : null)}
                    />
                    {field.label}
                  </span>
                  <input
                    value={numberListText(policy.fields[field.key])}
                    disabled={!enabled}
                    onChange={(event) => setFieldValues(field.key, parseNumberList(event.target.value))}
                    placeholder={field.placeholder}
                    className="mt-2 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-sky-400 disabled:bg-slate-50"
                  />
                </label>
              );
            })}
          </div>

          <div className="rounded-md border border-line p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <Checkbox
                checked={Object.prototype.hasOwnProperty.call(policy, 'packingPartIds')}
                onChange={(event) => updatePolicy((current) => {
                  if (event.target.checked) return { ...current, packingPartIds: [] };
                  const { packingPartIds: _removed, ...rest } = current;
                  return rest;
                })}
              />
              限制可选包装零件
            </label>
            {Object.prototype.hasOwnProperty.call(policy, 'packingPartIds') ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {packingParts.map((part) => (
                  <label key={part.id} className="flex items-center gap-2 text-xs text-ink">
                    <Checkbox
                      checked={(policy.packingPartIds || []).includes(part.id)}
                      onChange={(event) => updatePolicy((current) => ({
                        ...current,
                        packingPartIds: event.target.checked
                          ? Array.from(new Set([...(current.packingPartIds || []), part.id]))
                          : (current.packingPartIds || []).filter(id => id !== part.id),
                      }))}
                    />
                    <span>{part.model} · {part.supplier || '未填供应商'}</span>
                  </label>
                ))}
                {packingParts.length === 0 ? <span className="text-xs text-amber-700">零件库中暂无包装类零件。</span> : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-md border border-line p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <Checkbox
                checked={Object.prototype.hasOwnProperty.call(policy, 'surfaceTreatmentOptions')}
                onChange={(event) => updatePolicy((current) => {
                  if (event.target.checked) return { ...current, surfaceTreatmentOptions: [{ mode: 'none', cost: 0 }] };
                  const { surfaceTreatmentOptions: _removed, ...rest } = current;
                  return rest;
                })}
              />
              限制可选表面处理及成本
            </label>
            {Object.prototype.hasOwnProperty.call(policy, 'surfaceTreatmentOptions') ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {surfaceOptions.map((option) => {
                  const selected = policy.surfaceTreatmentOptions?.find(item => item.mode === option.mode);
                  return (
                    <div key={option.mode} className="grid grid-cols-[1fr_7rem] items-center gap-2">
                      <label className="flex items-center gap-2 text-xs text-ink">
                        <Checkbox
                          checked={Boolean(selected)}
                          onChange={(event) => updatePolicy((current) => ({
                            ...current,
                            surfaceTreatmentOptions: event.target.checked
                              ? [...(current.surfaceTreatmentOptions || []), { mode: option.mode, cost: 0 }]
                              : (current.surfaceTreatmentOptions || []).filter(item => item.mode !== option.mode),
                          }))}
                        />
                        {option.label}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={!selected || option.mode === 'none'}
                        value={selected?.cost ?? 0}
                        onChange={(event) => updatePolicy((current) => ({
                          ...current,
                          surfaceTreatmentOptions: (current.surfaceTreatmentOptions || []).map(item => (
                            item.mode === option.mode ? { ...item, cost: Number(event.target.value) || 0 } : item
                          )),
                        }))}
                        className="h-8 rounded-md border border-line px-2 text-xs text-ink disabled:bg-slate-50"
                        aria-label={`${option.label}成本`}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
