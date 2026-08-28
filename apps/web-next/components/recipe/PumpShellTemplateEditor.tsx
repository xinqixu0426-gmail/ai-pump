'use client';

import type { FormEvent } from 'react';
import { Check, CircleAlert, Layers3, Package, PackagePlus, Plus, Save, Trash2, X } from 'lucide-react';
import { SlideOver } from '@/components/motion/slide-over';
import {
  ShellCostEditor,
  SHELL_COMPONENT_CATEGORY,
  STAINLESS_STRETCH_BARREL_NAME,
  isBarrelComponentName,
  type ShellComponentCatalogPart,
  type ShellComponentFormRow,
} from '@/components/recipe/ShellCostEditor';
import { Button } from '@/components/ui/button';
import { ConfigurationPolicyEditor } from '@/components/recipe/ConfigurationPolicyEditor';
import { EditableValueSelect } from '@/components/recipe/EditableValueSelect';
import { selectInputValueOnFocus } from '@/components/ui/field';
import { money } from '@/lib/format';
import { parsePumpShellMeta } from '@/lib/part-form-rules';
import type { Part } from '@/lib/parts';
import {
  templatePartCatalogForName,
  templatePartCategoryForName,
} from '@/lib/template-part-category';
import type {
  PumpShellTemplate,
  SurfaceTreatmentMode,
  TemplatePartInput,
} from '@/lib/recipes';

export type TemplateRotorParamKey =
  | 'upper_bearing'
  | 'lower_bearing'
  | 'piece_count'
  | 'rotor_dia'
  | 'bearing_span'
  | 'stack_offset'
  | 'oil_seal_dia'
  | 'impeller_dia'
  | 'impeller_span'
  | 'impeller_depth'
  | 'thread_length'
  | 'thread_dia';

export type TemplateRotorParamsState = Record<TemplateRotorParamKey, string>;

export type TemplatePartFormRow = TemplatePartInput & {
  id: string;
};

export type TemplateFormState = {
  shellModel: string;
  description: string;
  assemblyWage: string;
  packingWage: string;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: string;
  costMode: 'components' | 'bundle';
  bundleCost: string;
  bundleNote: string;
  configurationPolicyJson: string | null;
  partRows: TemplatePartFormRow[];
  componentRows: ShellComponentFormRow[];
  rotorParams: TemplateRotorParamsState;
};

export type ShellCatalogOption = {
  model: string;
  rows: Part[];
};

export const templateSurfaceTreatmentOptions: Array<{
  value: SurfaceTreatmentMode;
  label: string;
}> = [
  { value: 'none', label: '无' },
  { value: 'painting', label: '喷漆' },
  { value: 'electrophoresis', label: '电泳' },
  { value: 'electrophoresis_powder_coating', label: '电泳+喷塑' },
  { value: 'powder_coating', label: '整体喷塑' },
];

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextRowId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultStainlessBarrelComponent(rows: ShellComponentFormRow[]): ShellComponentFormRow[] {
  return rows.map((row) => {
    if (!isBarrelComponentName(row.name)) return row;
    return {
      ...row,
      name: STAINLESS_STRETCH_BARREL_NAME,
      qty: Number(row.qty || 0) <= 1 ? 15 : row.qty,
      pricingMode: 'lengthCm',
      componentType: 'stainlessStretchBarrel',
      subassemblyContents: [],
    };
  });
}

type PumpShellTemplateEditorProps = {
  open: boolean;
  editingTemplate: PumpShellTemplate | null;
  reuseSource: PumpShellTemplate | null;
  templates: PumpShellTemplate[];
  form: TemplateFormState;
  formError: string | null;
  saving: boolean;
  dirty: boolean;
  missingPartCount: number;
  shellCatalogOptions: ShellCatalogOption[];
  shellComponentModelOptions: string[];
  shellComponentParts: ShellComponentCatalogPart[];
  shellComponentPartsRefreshing: boolean;
  partCatalog: Part[];
  getDefaultSupplier: (model: string, category?: string) => string;
  getDefaultUnitPrice: (model: string, category?: string, supplier?: string) => number;
  onRefreshShellComponentParts: () => Promise<void>;
  onCreateShellComponentPart: (input: {
    model: string;
    supplier: string;
    catalogUnitCost: number;
  }) => Promise<{ part: ShellComponentCatalogPart; created: boolean }>;
  onOpenCreateShellPart: () => void;
  onOpenCreateFixedPart: (row: TemplatePartFormRow, category: string | null) => void;
  onOpenMissingParts: () => void;
  onFormChange: (update: (form: TemplateFormState) => TemplateFormState) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function PumpShellTemplateEditor({
  open,
  editingTemplate,
  reuseSource,
  templates,
  form,
  formError,
  saving,
  dirty,
  missingPartCount,
  shellCatalogOptions,
  shellComponentModelOptions,
  shellComponentParts,
  shellComponentPartsRefreshing,
  partCatalog,
  getDefaultSupplier,
  getDefaultUnitPrice,
  onRefreshShellComponentParts,
  onCreateShellComponentPart,
  onOpenCreateShellPart,
  onOpenCreateFixedPart,
  onOpenMissingParts,
  onFormChange,
  onClose,
  onSubmit,
}: PumpShellTemplateEditorProps) {
  const selectedShellParts = shellCatalogOptions.find((option) => option.model === form.shellModel)?.rows || [];

  function updateForm(patch: Partial<TemplateFormState>) {
    onFormChange((current) => ({ ...current, ...patch }));
  }

  function selectShell(shellModel: string) {
    const shellOption = shellCatalogOptions.find((option) => option.model === shellModel);
    const referencePrice = shellOption?.rows.find((part) => part.catalogUnitCost > 0)?.catalogUnitCost;
    const isStainlessShell = shellOption?.rows.some((part) => parsePumpShellMeta(part.remark).isStainless) === true;
    onFormChange((current) => ({
      ...current,
      shellModel,
      bundleCost: current.costMode === 'bundle' && referencePrice != null
        ? String(referencePrice)
        : current.bundleCost,
      componentRows: !editingTemplate && current.costMode === 'components' && isStainlessShell
        ? defaultStainlessBarrelComponent(current.componentRows)
        : current.componentRows,
    }));
  }

  function selectCostMode(costMode: TemplateFormState['costMode']) {
    const referencePrice = selectedShellParts.find((part) => part.catalogUnitCost > 0)?.catalogUnitCost;
    const isStainlessShell = selectedShellParts.some((part) => parsePumpShellMeta(part.remark).isStainless);
    onFormChange((current) => ({
      ...current,
      costMode,
      bundleCost: costMode === 'bundle' && numberValue(current.bundleCost) <= 0 && referencePrice != null
        ? String(referencePrice)
        : current.bundleCost,
      componentRows: !editingTemplate && costMode === 'components' && isStainlessShell
        ? defaultStainlessBarrelComponent(current.componentRows)
        : current.componentRows,
    }));
  }

  function addPartRow() {
    onFormChange((current) => ({
      ...current,
      partRows: [...current.partRows, {
        id: nextRowId(),
        name: '',
        model: '',
        qty: 1,
        supplier: '',
      }],
    }));
  }

  function updatePartRow(id: string, patch: Partial<TemplatePartFormRow>) {
    onFormChange((current) => ({
      ...current,
      partRows: current.partRows.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.name !== undefined) {
          const allowedParts = templatePartCatalogForName(partCatalog, patch.name);
          if (next.model && !allowedParts.some((part) => part.model === next.model)) {
            next.model = '';
            next.supplier = '';
          }
        }
        if (patch.model !== undefined && patch.supplier === undefined) {
          next.supplier = getDefaultSupplier(
            String(patch.model || ''),
            templatePartCategoryForName(next.name) || undefined
          );
        }
        return next;
      }),
    }));
  }

  function removePartRow(id: string) {
    onFormChange((current) => ({
      ...current,
      partRows: current.partRows.filter((row) => row.id !== id),
    }));
  }

  return (
    <SlideOver open={open} onClose={() => !saving && onClose()} size="workspace">
      <form onSubmit={onSubmit} className="flex min-h-full flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Template</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
              {editingTemplate ? '编辑泵壳模板' : reuseSource ? '复用泵壳模板' : '新建泵壳模板'}
            </h2>
            {reuseSource ? (
              <div className="mt-1 text-sm text-muted">
                基于“{reuseSource.shellModel}”创建新模板，原模板不会改变。
                {reuseSource.costMode === 'bundle' ? ' 请重新选择新的零件库泵壳型号。' : ''}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="关闭"
            disabled={saving}
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          {formError ? (
            <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <CircleAlert size={16} />
              {formError}
            </div>
          ) : null}

          {missingPartCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <div>
                <div className="text-sm font-semibold text-amber-900">待补齐零件 {missingPartCount} 项</div>
                <div className="mt-1 text-xs text-amber-700">可以集中填写供应商和目录价，也可继续在对应物料行单条建档。</div>
              </div>
              <Button type="button" size="sm" onClick={onOpenMissingParts} disabled={saving} icon={<PackagePlus size={14} />}>
                集中补齐
              </Button>
            </div>
          ) : null}

          <section className="rounded-panel border border-line p-4">
            <div>
              <div className="text-sm font-semibold text-ink">1. 选择泵壳计价方式</div>
              <div className="mt-1 text-xs text-muted">先确定成本口径，后续表单会自动切换为对应的配置内容。</div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="泵壳计价方式">
              {([
                {
                  value: 'bundle' as const,
                  title: '泵壳套件',
                  description: '选择零件库中的整套泵壳，按套件价格直接计入成本。',
                  hint: '适合已有整套采购价',
                  icon: Package,
                },
                {
                  value: 'components' as const,
                  title: '自由搭配',
                  description: '逐项选择机筒、上帽、花板等真实组件并汇总成本。',
                  hint: '适合按组件灵活组合',
                  icon: Layers3,
                },
              ]).map((option) => {
                const selected = form.costMode === option.value;
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => selectCostMode(option.value)}
                    className={`group relative overflow-hidden rounded-panel border p-4 text-left outline-none transition-[border-color,background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                      selected
                        ? 'border-blue-700 bg-blue-600 text-white shadow-lg ring-2 ring-blue-200 ring-offset-1'
                        : 'border-line bg-white text-ink hover:border-blue-400 hover:bg-blue-50 hover:shadow-panel active:bg-blue-100'
                    }`}
                  >
                    <span className={`absolute inset-x-0 bottom-0 h-1 ${selected ? 'bg-blue-200' : 'bg-transparent'}`} />
                    <span className="flex items-start gap-3">
                      <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        selected
                          ? 'border-white bg-white text-blue-700 shadow-sm'
                          : 'border-line bg-slate-50 text-slate-600 group-hover:border-blue-200 group-hover:bg-white group-hover:text-blue-700'
                      }`}>
                        <Icon size={21} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-base font-semibold">{option.title}</span>
                          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold transition-colors ${
                            selected
                              ? 'border-white bg-white text-blue-700'
                              : 'border-slate-300 bg-white text-slate-500 group-hover:border-blue-300 group-hover:text-blue-700'
                          }`}>
                            {selected ? <Check size={13} strokeWidth={3} /> : null}
                            {selected ? '当前选择' : '点击选择'}
                          </span>
                        </span>
                        <span className={`mt-1.5 block text-sm leading-5 ${selected ? 'text-blue-50' : 'text-muted'}`}>
                          {option.description}
                        </span>
                        <span className={`mt-3 inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          selected ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600 group-hover:bg-white'
                        }`}>
                          {option.hint}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">
              <Check size={14} className="shrink-0 text-blue-600" />
              {form.costMode === 'bundle'
                ? '已选择泵壳套件：下一步从零件库选择整套泵壳型号。'
                : '已选择自由搭配：下一步填写组合名称，并逐项绑定泵壳组件。'}
            </div>
          </section>

          <ConfigurationPolicyEditor
            value={form.configurationPolicyJson}
            parts={partCatalog}
            onChange={(configurationPolicyJson) => updateForm({ configurationPolicyJson })}
          />

          <section className="rounded-panel border border-line p-4">
            <div className="text-sm font-semibold text-ink">模板基础信息</div>
            <div className="mt-1 text-xs text-muted">泵壳套件需要选择零件库整套型号；自由搭配可输入组合名称，也可从已有泵壳型号中选择，组件逐项绑定真实零件。</div>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">{form.costMode === 'bundle' ? '零件库泵壳型号' : '组合模板名称'}</span>
                {form.costMode === 'bundle' ? (
                  <>
                    <span className="mt-2 flex gap-2">
                      <select
                        value={form.shellModel}
                        onChange={(event) => selectShell(event.target.value)}
                        className="h-10 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                      >
                        <option value="">请选择泵壳型号</option>
                        {form.shellModel && !shellCatalogOptions.some((option) => option.model === form.shellModel) ? (
                          <option value={form.shellModel}>{form.shellModel}（零件库中未找到）</option>
                        ) : null}
                        {shellCatalogOptions.map((option) => {
                          const hasTemplate = templates.some((template) => (
                            template.shellModel === option.model && template.id !== editingTemplate?.id
                          ));
                          const prices = option.rows.filter((part) => part.catalogUnitCost > 0).map((part) => part.catalogUnitCost);
                          const priceText = prices.length > 0 ? money(Math.min(...prices)) : '未定价';
                          return (
                            <option key={option.model} value={option.model} disabled={hasTemplate}>
                              {option.model} · {priceText}{hasTemplate ? ' · 已有模板' : ''}
                            </option>
                          );
                        })}
                      </select>
                      <Button type="button" size="sm" onClick={onOpenCreateShellPart} icon={<Plus size={14} />}>
                        新增泵壳
                      </Button>
                    </span>
                    {shellCatalogOptions.length === 0 ? (
                      <span className="mt-2 block text-xs text-amber-700">零件库暂无泵壳，可在这里新增并自动选中。</span>
                    ) : null}
                  </>
                ) : (
                  <>
                    <EditableValueSelect
                      value={form.shellModel}
                      options={shellCatalogOptions.map((option) => option.model)}
                      onChange={selectShell}
                      ariaLabel="组合名称或泵壳型号"
                      listboxId="shell-template-model-options"
                      placeholder="例如：V系列自由组合壳体"
                      rootClassName="relative mt-2"
                    />
                    <span className="mt-2 block text-xs text-muted">可直接输入新的组合名称，也可展开选择零件库中的泵壳型号。</span>
                  </>
                )}
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">说明</span>
                <input
                  value={form.description}
                  onChange={(event) => updateForm({ description: event.target.value })}
                  className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                />
              </label>
            </div>
            {selectedShellParts.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-muted">
                <span className="font-medium text-ink">零件库参考价格</span>
                {selectedShellParts.map((part) => (
                  <span key={part.id}>{part.supplier || '未填写供应商'}：{money(part.catalogUnitCost)}</span>
                ))}
              </div>
            ) : null}
          </section>

          <ShellCostEditor
            costMode={form.costMode}
            bundleCost={form.bundleCost}
            bundleNote={form.bundleNote}
            componentRows={form.componentRows}
            modelOptions={shellComponentModelOptions}
            catalogParts={shellComponentParts}
            catalogRefreshing={shellComponentPartsRefreshing}
            getDefaultSupplier={(model) => getDefaultSupplier(model, SHELL_COMPONENT_CATEGORY)}
            getDefaultUnitPrice={(model, supplier) => getDefaultUnitPrice(model, SHELL_COMPONENT_CATEGORY, supplier)}
            onRefreshCatalog={onRefreshShellComponentParts}
            onCreateCatalogPart={onCreateShellComponentPart}
            onBundleCostChange={(bundleCost) => updateForm({ bundleCost })}
            onBundleNoteChange={(bundleNote) => updateForm({ bundleNote })}
            onComponentRowsChange={(update) => onFormChange((current) => ({
              ...current,
              componentRows: update(current.componentRows),
            }))}
          />

          <section className="rounded-panel border border-line p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-ink">3. 固定配件</div>
                <div className="mt-1 text-xs text-muted">轴承、油封、螺丝等固定装配件会保存到模板 BOM。</div>
              </div>
              <Button type="button" size="sm" onClick={addPartRow} icon={<Plus size={14} />}>添加配件</Button>
            </div>
            <div className="mt-3 space-y-2">
              {form.partRows.map((row) => {
                const category = templatePartCategoryForName(row.name);
                const modelOptions = Array.from(new Set(
                  templatePartCatalogForName(partCatalog, row.name).map((part) => part.model).filter(Boolean)
                )).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
                return (
                <div key={row.id} className="grid gap-2 lg:grid-cols-[minmax(130px,1fr)_minmax(180px,1.2fr)_minmax(120px,0.8fr)_96px_auto]">
                  <input value={row.name} onChange={(event) => updatePartRow(row.id, { name: event.target.value })} placeholder="名称" aria-label={`固定配件名称 ${row.name || ''}`} className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                  <EditableValueSelect
                    value={row.model}
                    options={modelOptions}
                    onChange={(model) => updatePartRow(row.id, { model })}
                    placeholder={category ? `${category}型号` : '型号'}
                    ariaLabel={`${row.name || '固定配件'}型号${category ? `（${category}）` : ''}`}
                    listboxId={`template-part-model-options-${row.id}`}
                    rootClassName="relative min-w-0"
                  />
                  <input value={row.supplier || ''} onChange={(event) => updatePartRow(row.id, { supplier: event.target.value })} placeholder="供应商" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                  <input value={String(row.qty)} onChange={(event) => updatePartRow(row.id, { qty: numberValue(event.target.value) })} onFocus={selectInputValueOnFocus} type="number" min="0" step="0.01" placeholder="数量" className="h-9 min-w-[88px] rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                  <span className="flex gap-1">
                    {row.model.trim() && !templatePartCatalogForName(partCatalog, row.name).some((part) => (
                      part.model === row.model.trim()
                      && (!row.supplier?.trim() || part.supplier === row.supplier.trim())
                    )) ? (
                      <Button type="button" size="sm" onClick={() => onOpenCreateFixedPart(row, category)} icon={<Plus size={14} />}>建档</Button>
                    ) : null}
                    <Button type="button" size="sm" variant="danger" onClick={() => removePartRow(row.id)} icon={<Trash2 size={14} />}>删除</Button>
                  </span>
                </div>
                );
              })}
            </div>
            <div className="mt-2 text-xs text-muted">型号候选会根据配件名称自动限定分类；无法识别的自定义名称保留全部非包装零件。</div>
          </section>

          <section className="rounded-panel border border-line p-4">
            <div className="text-sm font-semibold text-ink">人工与表面处理</div>
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="text-xs font-medium text-muted">安装工资</span>
                <input value={form.assemblyWage} onChange={(event) => updateForm({ assemblyWage: event.target.value })} onFocus={selectInputValueOnFocus} type="number" min="0" step="0.01" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">打包工资</span>
                <input value={form.packingWage} onChange={(event) => updateForm({ packingWage: event.target.value })} onFocus={selectInputValueOnFocus} type="number" min="0" step="0.01" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">表面处理</span>
                <select
                  value={form.surfaceTreatmentMode}
                  onChange={(event) => {
                    const surfaceTreatmentMode = event.target.value as SurfaceTreatmentMode;
                    updateForm({
                      surfaceTreatmentMode,
                      surfaceTreatmentCost: surfaceTreatmentMode === form.surfaceTreatmentMode
                        ? form.surfaceTreatmentCost
                        : '0',
                    });
                  }}
                  className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                >
                  {templateSurfaceTreatmentOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">表面处理费用</span>
                <input
                  value={form.surfaceTreatmentCost}
                  onChange={(event) => updateForm({ surfaceTreatmentCost: event.target.value })}
                  onFocus={selectInputValueOnFocus}
                  disabled={form.surfaceTreatmentMode === 'none'}
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:bg-slate-50 disabled:text-muted"
                />
              </label>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-5">
          <div className="text-xs text-muted" aria-live="polite">{dirty ? '有未保存修改' : '尚未修改'}</div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
            {!editingTemplate ? (
              <Button type="submit" disabled={saving} icon={<Save size={15} />}>
                {saving ? '保存中' : '保存模板'}
              </Button>
            ) : null}
            <Button
              type="submit"
              name={!editingTemplate ? 'continueToRecipe' : undefined}
              variant="primary"
              disabled={saving}
              icon={<Save size={15} />}
            >
              {saving ? '保存中' : editingTemplate ? '保存模板' : '保存模板并创建配方'}
            </Button>
          </div>
        </div>
      </form>
    </SlideOver>
  );
}
