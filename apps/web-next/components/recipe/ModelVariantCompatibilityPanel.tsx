'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CircleAlert, Copy, Layers3, Pencil, Plus, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { selectInputValueOnFocus } from '@/components/ui/field';
import {
  buildTemplateNameMap,
  type CoilSpecOption,
  type ModelVariantInput,
  type PumpModelVariant,
  type PumpShellTemplate,
} from '@/lib/recipes';
import {
  resolveCoilVariantSelection,
  type CoilSlotType,
} from '@/components/recipe/coil-selection';

type VariantCustomField = {
  id: string;
  label: string;
  value: string;
};

type VariantFormState = {
  modelName: string;
  templateId: string;
  coilSpec: string;
  coilSheets: string;
  coilMaterial: string;
  coilSlotType: CoilSlotType;
  barrelLength: string;
  longScrewExtraLength: string;
  impellerModel: string;
  impellerThickness: string;
  impellerDiameter: string;
  impellerBladeCount: string;
  note: string;
  customFields: VariantCustomField[];
};

export type ModelVariantEditorTarget =
  | { mode: 'create' }
  | { mode: 'edit'; variant: PumpModelVariant }
  | { mode: 'clone'; variant: PumpModelVariant }
  | null;

type ModelVariantCompatibilityPanelProps = {
  visible: boolean;
  variants: PumpModelVariant[];
  templates: PumpShellTemplate[];
  coilSpecs: CoilSpecOption[];
  editorTarget: ModelVariantEditorTarget;
  saving: boolean;
  error: string | null;
  onOpenEdit: (variant: PumpModelVariant) => void;
  onOpenClone: (variant: PumpModelVariant) => void;
  onCloseEditor: () => void;
  onSubmit: (input: ModelVariantInput, editingVariant: PumpModelVariant | null) => Promise<void>;
  onRemove: (variant: PumpModelVariant) => void;
};

function nextFieldId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyVariantForm(): VariantFormState {
  return {
    modelName: '',
    templateId: '',
    coilSpec: '',
    coilSheets: '',
    coilMaterial: '钢带',
    coilSlotType: '小眼',
    barrelLength: '',
    longScrewExtraLength: '0',
    impellerModel: '',
    impellerThickness: '',
    impellerDiameter: '',
    impellerBladeCount: '',
    note: '',
    customFields: [],
  };
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseVariantCustomFields(value?: string): VariantCustomField[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: nextFieldId(),
        label: String(item?.label || ''),
        value: String(item?.value || ''),
      }))
      .filter((field) => field.label || field.value);
  } catch {
    return [];
  }
}

function stringifyVariantCustomFields(fields: VariantCustomField[]): string {
  return JSON.stringify(fields
    .map((field) => ({ label: field.label.trim(), value: field.value.trim() }))
    .filter((field) => field.label || field.value));
}

function variantFormFromVariant(variant: PumpModelVariant, modelName = variant.modelName): VariantFormState {
  return {
    modelName,
    templateId: variant.templateId ? String(variant.templateId) : '',
    coilSpec: variant.coilSpec || '',
    coilSheets: variant.coilSheets ? String(variant.coilSheets) : '',
    coilMaterial: variant.coilMaterial || '钢带',
    coilSlotType: variant.coilSlotType || '小眼',
    barrelLength: variant.barrelLength ? String(variant.barrelLength) : '',
    longScrewExtraLength: variant.longScrewExtraLength == null ? '0' : String(variant.longScrewExtraLength),
    impellerModel: variant.impellerModel || '',
    impellerThickness: variant.impellerThickness ? String(variant.impellerThickness) : '',
    impellerDiameter: variant.impellerDiameter ? String(variant.impellerDiameter) : '',
    impellerBladeCount: variant.impellerBladeCount ? String(variant.impellerBladeCount) : '',
    note: variant.note || '',
    customFields: parseVariantCustomFields(variant.customFieldsJson),
  };
}

function variantFormToInput(form: VariantFormState): ModelVariantInput {
  return {
    modelName: form.modelName.trim(),
    templateId: Number(form.templateId),
    coilSpec: form.coilSpec.trim(),
    coilSheets: numberValue(form.coilSheets),
    coilMaterial: form.coilMaterial.trim() || '钢带',
    coilSlotType: form.coilSlotType,
    barrelLength: numberOrNull(form.barrelLength),
    longScrewExtraLength: numberValue(form.longScrewExtraLength),
    impellerModel: form.impellerModel.trim(),
    impellerThickness: numberOrNull(form.impellerThickness),
    impellerDiameter: numberOrNull(form.impellerDiameter),
    impellerBladeCount: numberOrNull(form.impellerBladeCount),
    note: form.note.trim(),
    customFieldsJson: stringifyVariantCustomFields(form.customFields),
  };
}

function initialFormForTarget(target: ModelVariantEditorTarget): VariantFormState {
  if (!target || target.mode === 'create') return emptyVariantForm();
  if (target.mode === 'clone') {
    return variantFormFromVariant(target.variant, `${target.variant.modelName || ''}-复用`);
  }
  return variantFormFromVariant(target.variant);
}

export function ModelVariantCompatibilityPanel({
  visible,
  variants,
  templates,
  coilSpecs,
  editorTarget,
  saving,
  error,
  onOpenEdit,
  onOpenClone,
  onCloseEditor,
  onSubmit,
  onRemove,
}: ModelVariantCompatibilityPanelProps) {
  const [query, setQuery] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [form, setForm] = useState<VariantFormState>(() => emptyVariantForm());
  const [formError, setFormError] = useState<string | null>(null);
  const templateNameMap = useMemo(() => buildTemplateNameMap(templates), [templates]);
  const selectedCoil = coilSpecs.find((spec) => spec.spec === form.coilSpec);
  const materialOptions = selectedCoil?.materials?.length ? selectedCoil.materials : ['钢带'];
  const matchingSlotTypes = selectedCoil?.variants
    ?.filter((variant) => variant.material === form.coilMaterial)
    .map((variant) => variant.slotType);
  const slotTypeOptions = matchingSlotTypes?.length
    ? matchingSlotTypes
    : selectedCoil?.slotTypes?.length
      ? selectedCoil.slotTypes
      : ['小眼'];

  const filteredVariants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return variants.filter((variant) => {
      if (templateFilter && String(variant.templateId) !== templateFilter) return false;
      if (!normalizedQuery) return true;
      const customText = parseVariantCustomFields(variant.customFieldsJson)
        .map((field) => `${field.label} ${field.value}`)
        .join(' ');
      const text = [
        variant.modelName,
        templateNameMap.get(variant.templateId),
        variant.coilSpec,
        variant.coilSheets,
        variant.coilMaterial,
        variant.coilSlotType,
        variant.impellerModel,
        variant.note,
        customText,
      ].join(' ').toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [query, templateFilter, templateNameMap, variants]);

  useEffect(() => {
    if (!editorTarget) {
      setFormError(null);
      return;
    }
    setForm(initialFormForTarget(editorTarget));
    setFormError(null);
  }, [editorTarget]);

  useEffect(() => {
    if (!editorTarget || !selectedCoil) return;
    setForm((current) => {
      if (current.coilSpec !== selectedCoil.spec) return current;
      const selection = resolveCoilVariantSelection(
        selectedCoil,
        current.coilMaterial,
        current.coilSlotType
      );
      if (selection.material === current.coilMaterial && selection.slotType === current.coilSlotType) {
        return current;
      }
      const currentSheets = Number(current.coilSheets);
      const sheetsRemainValid = currentSheets > 0 && selection.sheets.includes(currentSheets);
      return {
        ...current,
        coilMaterial: selection.material,
        coilSlotType: selection.slotType,
        coilSheets: sheetsRemainValid ? current.coilSheets : '',
      };
    });
  }, [editorTarget, form.coilMaterial, form.coilSlotType, form.coilSpec, selectedCoil]);

  function updateForm(patch: Partial<VariantFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function addCustomField() {
    setForm((current) => ({
      ...current,
      customFields: [...current.customFields, { id: nextFieldId(), label: '', value: '' }],
    }));
  }

  function updateCustomField(id: string, patch: Partial<VariantCustomField>) {
    setForm((current) => ({
      ...current,
      customFields: current.customFields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    }));
  }

  function removeCustomField(id: string) {
    setForm((current) => ({
      ...current,
      customFields: current.customFields.filter((field) => field.id !== id),
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.modelName.trim()) {
      setFormError('配置名称不能为空');
      return;
    }
    if (!form.templateId) {
      setFormError('请选择泵壳模板');
      return;
    }
    setFormError(null);
    try {
      await onSubmit(
        variantFormToInput(form),
        editorTarget?.mode === 'edit' ? editorTarget.variant : null
      );
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : '常用配置保存失败');
    }
  }

  return (
    <>
      {visible ? (
        <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
          <div className="flex flex-col gap-3 border-b border-line p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3">
              <Search size={16} className="text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索配置、线圈、叶轮、备注或自定义字段"
                className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-muted" />
              <select
                value={templateFilter}
                onChange={(event) => setTemplateFilter(event.target.value)}
                className="h-9 min-w-40 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 hover:bg-slate-50"
              >
                <option value="">全部模板</option>
                {templates.map((template) => (
                  <option key={template.id} value={String(template.id)}>{template.shellModel}</option>
                ))}
              </select>
            </div>
          </div>
          {error ? (
            <div className="flex items-center gap-2 p-5 text-sm text-rose-700">
              <CircleAlert size={16} />
              {error}
            </div>
          ) : filteredVariants.length === 0 ? (
            <div className="p-10 text-center">
              <Layers3 className="mx-auto text-slate-300" size={32} />
              <div className="mt-3 text-sm font-medium text-ink">没有常用配置</div>
              <div className="mt-1 text-sm text-muted">点击右上角“新建配置”，保存模板 + 线圈 + 机筒 + 叶轮组合。</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                  <tr>
                    <th className="border-b border-line px-4 py-3">配置名称</th>
                    <th className="border-b border-line px-4 py-3">泵壳模板</th>
                    <th className="border-b border-line px-4 py-3">线圈</th>
                    <th className="border-b border-line px-4 py-3">机筒/长螺丝</th>
                    <th className="border-b border-line px-4 py-3">叶轮</th>
                    <th className="border-b border-line px-4 py-3">备注</th>
                    <th className="border-b border-line px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVariants.map((variant) => {
                    const customFields = parseVariantCustomFields(variant.customFieldsJson);
                    return (
                      <tr key={variant.id} className="transition-colors duration-150 hover:bg-slate-50">
                        <td className="border-b border-line px-4 py-3 font-medium text-ink">{variant.modelName || '-'}</td>
                        <td className="border-b border-line px-4 py-3 text-muted">{templateNameMap.get(variant.templateId) || '-'}</td>
                        <td className="border-b border-line px-4 py-3 text-muted">
                          {variant.coilSpec ? `${variant.coilSpec} / ${variant.coilSheets || 0}片 / ${variant.coilMaterial || '钢带'} / ${variant.coilSlotType || '小眼'}` : '-'}
                        </td>
                        <td className="border-b border-line px-4 py-3 text-muted">
                          {variant.barrelLength ? `${variant.barrelLength}mm + ${variant.longScrewExtraLength || 0}mm` : '-'}
                        </td>
                        <td className="border-b border-line px-4 py-3 text-muted">
                          {[variant.impellerModel, variant.impellerThickness ? `${variant.impellerThickness}厚` : '', variant.impellerDiameter ? `直径${variant.impellerDiameter}` : '', variant.impellerBladeCount ? `${variant.impellerBladeCount}片` : ''].filter(Boolean).join(' / ') || '-'}
                        </td>
                        <td className="border-b border-line px-4 py-3 text-muted">
                          <div className="max-w-[240px] truncate">{variant.note || '-'}</div>
                          {customFields.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {customFields.slice(0, 2).map((field) => (
                                <span key={field.id} className="rounded border border-line px-1.5 py-0.5 text-xs text-muted">
                                  {field.label || '字段'}: {field.value || '-'}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="border-b border-line px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => onOpenClone(variant)} disabled={saving} icon={<Copy size={14} />}>
                              复用
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => onOpenEdit(variant)} disabled={saving} icon={<Pencil size={14} />}>
                              编辑
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => onRemove(variant)} disabled={saving} icon={<Trash2 size={14} />}>
                              删除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </FadePanel>
      ) : null}

      <SlideOver open={Boolean(editorTarget)} onClose={() => !saving && onCloseEditor()}>
        <form onSubmit={submit} className="flex min-h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Variant</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
                {editorTarget?.mode === 'edit' ? '编辑常用配置' : '新建常用配置'}
              </h2>
            </div>
            <button
              type="button"
              aria-label="关闭"
              disabled={saving}
              onClick={onCloseEditor}
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

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">配置名称</span>
                <input
                  value={form.modelName}
                  onChange={(event) => updateForm({ modelName: event.target.value })}
                  className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  placeholder="例如：4QGD1.2-50-0.37"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">共用泵壳模板</span>
                <select
                  value={form.templateId}
                  onChange={(event) => updateForm({ templateId: event.target.value })}
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                >
                  <option value="">请选择模板</option>
                  {templates.map((template) => (
                    <option key={template.id} value={String(template.id)}>{template.shellModel}</option>
                  ))}
                </select>
              </label>
            </div>

            <section className="rounded-panel border border-line p-4">
              <div className="text-sm font-semibold text-ink">线圈配置</div>
              <div className="mt-3 grid gap-4 md:grid-cols-4">
                <label className="block">
                  <span className="text-xs font-medium text-muted">线圈规格</span>
                  <select
                    value={form.coilSpec}
                    onChange={(event) => {
                      const coilSpec = event.target.value;
                      const selection = coilSpec
                        ? resolveCoilVariantSelection(
                            coilSpecs.find((spec) => spec.spec === coilSpec),
                            form.coilMaterial,
                            form.coilSlotType
                          )
                        : { material: '钢带', slotType: '小眼' as const };
                      updateForm({
                        coilSpec,
                        coilSheets: '',
                        coilMaterial: selection.material,
                        coilSlotType: selection.slotType,
                      });
                    }}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    <option value="">不预设</option>
                    {coilSpecs.map((spec) => <option key={spec.spec} value={spec.spec}>{spec.spec}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">材质</span>
                  <select
                    value={form.coilMaterial}
                    onChange={(event) => {
                      const selection = resolveCoilVariantSelection(
                        selectedCoil,
                        event.target.value,
                        form.coilSlotType
                      );
                      updateForm({
                        coilMaterial: selection.material,
                        coilSlotType: selection.slotType,
                        coilSheets: '',
                      });
                    }}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    {materialOptions.map((material) => <option key={material} value={material}>{material}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">槽眼</span>
                  <select
                    value={form.coilSlotType}
                    onChange={(event) => updateForm({ coilSlotType: event.target.value as CoilSlotType })}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    {slotTypeOptions.map((slotType) => <option key={slotType} value={slotType}>{slotType}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">线圈片数</span>
                  <input
                    value={form.coilSheets}
                    onChange={(event) => updateForm({ coilSheets: event.target.value })}
                    onFocus={selectInputValueOnFocus}
                    type="number"
                    min="0"
                    step="1"
                    className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-panel border border-line p-4">
              <div className="text-sm font-semibold text-ink" title="机筒 / 长螺丝">机筒、长螺丝与叶轮</div>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted">机筒长度 mm</span>
                  <input value={form.barrelLength} onChange={(event) => updateForm({ barrelLength: event.target.value })} type="number" min="0" step="0.1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">长螺丝补偿 mm</span>
                  <input value={form.longScrewExtraLength} onChange={(event) => updateForm({ longScrewExtraLength: event.target.value })} type="number" step="0.1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">叶轮型号</span>
                  <input value={form.impellerModel} onChange={(event) => updateForm({ impellerModel: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">叶轮厚度</span>
                  <input value={form.impellerThickness} onChange={(event) => updateForm({ impellerThickness: event.target.value })} type="number" min="0" step="0.1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">叶轮直径</span>
                  <input value={form.impellerDiameter} onChange={(event) => updateForm({ impellerDiameter: event.target.value })} type="number" min="0" step="0.1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">叶片数</span>
                  <input value={form.impellerBladeCount} onChange={(event) => updateForm({ impellerBladeCount: event.target.value })} onFocus={selectInputValueOnFocus} type="number" min="0" step="1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
              </div>
            </section>

            <section className="rounded-panel border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">备注与自定义字段</div>
                  <div className="mt-1 text-xs text-muted">用于保存客户或型号特有参数，配方和搜索都能读取。</div>
                </div>
                <Button type="button" size="sm" onClick={addCustomField} icon={<Plus size={14} />}>
                  新增字段
                </Button>
              </div>
              <label className="mt-3 block">
                <span className="text-xs font-medium text-muted">备注</span>
                <input value={form.note} onChange={(event) => updateForm({ note: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <div className="mt-3 space-y-2">
                {form.customFields.map((field) => (
                  <div key={field.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                    <input value={field.label} onChange={(event) => updateCustomField(field.id, { label: event.target.value })} placeholder="字段名称" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                    <input value={field.value} onChange={(event) => updateCustomField(field.id, { value: event.target.value })} placeholder="字段值" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                    <Button type="button" size="sm" variant="danger" onClick={() => removeCustomField(field.id)} icon={<Trash2 size={14} />}>
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="flex justify-end gap-2 border-t border-line p-5">
            <Button type="button" variant="ghost" onClick={onCloseEditor} disabled={saving}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={saving} icon={<Save size={15} />}>
              {saving ? '保存中' : '保存配置'}
            </Button>
          </div>
        </form>
      </SlideOver>
    </>
  );
}
