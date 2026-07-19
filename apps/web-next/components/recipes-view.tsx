'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence } from 'motion/react';
import { CircleAlert, Copy, Eye, GitCompare, Layers3, Package, Pencil, Play, Plus, RefreshCw, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { PresenceRow } from '@/components/motion/presence-row';
import { SlideOver } from '@/components/motion/slide-over';
import { BomTableDialog } from '@/components/recipe/BomTableDialog';
import { CostResultCard } from '@/components/recipe/CostResultCard';
import { CostSummaryPanel } from '@/components/recipe/CostSummaryPanel';
import { RecipeDataTable } from '@/components/recipe/RecipeDataTable';
import { RecipeSection as WorkspaceSection } from '@/components/recipe/RecipeSection';
import { TemplateMatchSummary } from '@/components/recipe/TemplateMatchSummary';
import { TechnicalDataEditor } from '@/components/technical-data-editor';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { getAllCoils, type CoilRecord } from '@/lib/coils';
import { dateShort, money } from '@/lib/format';
import { getAllParts, type Part } from '@/lib/parts';
import {
  buildRecipeSavePayloadDraft,
  buildRecipeCopperRisk,
  buildTemplateNameMap,
  checkRecipeProduction,
  createModelVariant,
  createRecipe,
  createTemplate,
  deleteModelVariant,
  deleteRecipe,
  deleteTemplate,
  getCoilSpecOptions,
  getRecipeCurrentCost,
  getRecipeDataset,
  getRecipeLaborTotal,
  getRecipeSavedTotal,
  getTemplateRecipeDraft,
  parseRecipePartsJson,
  previewRecipeBomDraft,
  previewRecipeCostDraft,
  produceRecipe,
  recipePartsOverview,
  updateModelVariant,
  updateRecipe,
  updateTemplate,
  validRecipeParts,
  type CableAccessoryType,
  type CoilSpecOption,
  type ModelVariantInput,
  type PumpModelVariant,
  type PumpShellTemplate,
  type Recipe,
  type RecipeBomDraftResult,
  type RecipeCurrentCostResult,
  type RecipeCurrentTotalCost,
  type RecipePart,
  type RecipeProductionDraft,
  type ShellComponentInput,
  type SurfaceTreatmentMode,
  type TemplateInput,
  type TemplatePartInput,
} from '@/lib/recipes';
import { buildTechnicalReferenceFields, findShellMetaForTemplate } from '@/lib/technical-references';
import { parseTechnicalDataJson, type RecipeTechnicalData } from '@/lib/technical-data';

type RecipeFilter = 'all' | 'risk' | 'missingCost' | 'float' | 'cable';
type RecipeSection = 'recipes' | 'templates' | 'variants';

const quickFilters: Array<{ value: RecipeFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'risk', label: '铜价风险' },
  { value: 'missingCost', label: '无保存成本' },
  { value: 'float', label: '带浮球' },
  { value: 'cable', label: '带电缆' },
];

const sectionOptions: Array<{ value: RecipeSection; label: string }> = [
  { value: 'recipes', label: '配方' },
  { value: 'templates', label: '泵壳模板' },
];

function copperRiskTone(level: string): StatusBadgeTone {
  if (level === 'critical') return 'red';
  if (level === 'review') return 'orange';
  if (level === 'watch') return 'amber';
  if (level === 'missing') return 'slate';
  return 'green';
}

type TemplateRotorParamKey =
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

type TemplateRotorParamsState = Record<TemplateRotorParamKey, string>;

const templateRotorParamFields: Array<{ key: TemplateRotorParamKey; label: string; unit?: string; type?: 'text' | 'number' }> = [
  { key: 'upper_bearing', label: '上轴承', type: 'text' },
  { key: 'lower_bearing', label: '下轴承', type: 'text' },
  { key: 'piece_count', label: '转子片数', unit: '片' },
  { key: 'rotor_dia', label: '转子直径', unit: 'mm' },
  { key: 'bearing_span', label: '开档', unit: 'mm' },
  { key: 'stack_offset', label: '定位', unit: 'mm' },
  { key: 'oil_seal_dia', label: '油封孔径', unit: 'mm' },
  { key: 'impeller_dia', label: '叶轮孔径', unit: 'mm' },
  { key: 'impeller_span', label: '叶轮开档', unit: 'mm' },
  { key: 'impeller_depth', label: '叶轮深度', unit: 'mm' },
  { key: 'thread_length', label: '螺纹长度', unit: 'mm' },
  { key: 'thread_dia', label: '螺纹直径', unit: 'mm' },
];

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-panel border border-line bg-white p-4 shadow-panel">
      <div className="text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

function surfaceTreatmentLabel(mode?: string): string {
  return templateSurfaceTreatmentOptions.find((option) => option.value === mode)?.label || '无';
}

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

type RecipeFormState = {
  name: string;
  spec: string;
  templateId: string;
  variantId: string;
  coilSpec: string;
  coilSheets: string;
  coilMaterial: string;
  coilWireWeight: string;
  hasFloat: boolean;
  floatWire: string;
  floatAccessoryType: CableAccessoryType;
  hasCable: boolean;
  cableLength: string;
  cableWire: string;
  cableAccessoryType: CableAccessoryType;
  customBarrelLength: string;
  longScrewExtraLength: string;
  impellerModel: string;
  impellerThickness: string;
  impellerDiameter: string;
  impellerBladeCount: string;
  assemblyWage: string;
  packingWage: string;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: string;
  managementFee: string;
  technicalData: RecipeTechnicalData;
};

type RecipeSelection = {
  id: string;
  model: string;
  supplier: string;
  qty: string;
  packagingMaterial: string;
  costSource: '' | 'manual';
  snapshotPrice: string;
};

type TemplatePartRow = {
  name?: string;
  model?: string;
  supplier?: string;
  qty?: number;
};

type ShellComponentRow = {
  name?: string;
  model?: string;
  qty?: number;
  unitCost?: number;
  pricingMode?: string;
  included?: boolean;
  optional?: boolean;
  note?: string;
};

type TemplatePartFormRow = TemplatePartInput & {
  id: string;
};

type ShellComponentFormRow = ShellComponentInput & {
  id: string;
};

type TemplateFormState = {
  shellModel: string;
  description: string;
  assemblyWage: string;
  packingWage: string;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: string;
  costMode: 'components' | 'bundle';
  bundleCost: string;
  bundleNote: string;
  partRows: TemplatePartFormRow[];
  componentRows: ShellComponentFormRow[];
  rotorParams: TemplateRotorParamsState;
};

const templateCostModeOptions: Array<{ value: TemplateFormState['costMode']; label: string }> = [
  { value: 'bundle', label: '泵壳套件' },
  { value: 'components', label: '自由搭配' },
];

const templateSurfaceTreatmentOptions: Array<{ value: SurfaceTreatmentMode; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'painting', label: '喷漆' },
  { value: 'electrophoresis', label: '电泳' },
  { value: 'electrophoresis_powder_coating', label: '电泳+喷塑' },
  { value: 'powder_coating', label: '整体喷塑' },
];

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
  barrelLength: string;
  longScrewExtraLength: string;
  impellerModel: string;
  impellerThickness: string;
  impellerDiameter: string;
  impellerBladeCount: string;
  note: string;
  customFields: VariantCustomField[];
};

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

const emptyVariantForm: VariantFormState = {
  modelName: '',
  templateId: '',
  coilSpec: '',
  coilSheets: '',
  coilMaterial: '钢带',
  barrelLength: '',
  longScrewExtraLength: '0',
  impellerModel: '',
  impellerThickness: '',
  impellerDiameter: '',
  impellerBladeCount: '',
  note: '',
  customFields: [],
};

function defaultTemplateParts(): TemplatePartFormRow[] {
  return ['花板轴承', '油缸轴承', '机械油封', '骨架油封'].map((name) => ({
    id: nextSelectionId(),
    name,
    model: '',
    qty: 1,
    supplier: '',
  }));
}

function defaultShellComponents(): ShellComponentFormRow[] {
  return ['上帽', '机筒', '花板', '油缸', '泵头', '叶轮', '底座', '法兰'].map((name) => ({
    id: nextSelectionId(),
    name,
    model: '',
    qty: name === '机筒' ? 15 : 1,
    unitCost: 0,
    pricingMode: name === '机筒' ? 'lengthCm' : 'fixed',
    included: name !== '法兰',
    optional: name === '法兰',
    note: '',
  }));
}

function emptyTemplateRotorParams(): TemplateRotorParamsState {
  return templateRotorParamFields.reduce((params, field) => {
    params[field.key] = '';
    return params;
  }, {} as TemplateRotorParamsState);
}

function emptyTemplateForm(): TemplateFormState {
  return {
    shellModel: '',
    description: '',
    assemblyWage: '0',
    packingWage: '0',
    surfaceTreatmentMode: 'none',
    surfaceTreatmentCost: '0',
    costMode: 'components',
    bundleCost: '0',
    bundleNote: '',
    partRows: defaultTemplateParts(),
    componentRows: defaultShellComponents(),
    rotorParams: emptyTemplateRotorParams(),
  };
}

const emptyForm: RecipeFormState = {
  name: '',
  spec: '',
  templateId: '',
  variantId: '',
  coilSpec: '',
  coilSheets: '',
  coilMaterial: '钢带',
  coilWireWeight: '',
  hasFloat: false,
  floatWire: '',
  floatAccessoryType: 'standard',
  hasCable: false,
  cableLength: '',
  cableWire: '',
  cableAccessoryType: 'standard',
  customBarrelLength: '',
  longScrewExtraLength: '0',
  impellerModel: '',
  impellerThickness: '',
  impellerDiameter: '',
  impellerBladeCount: '',
  assemblyWage: '0',
  packingWage: '0',
  surfaceTreatmentMode: 'none',
  surfaceTreatmentCost: '0',
  managementFee: '0',
  technicalData: {},
};

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextSelectionId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseSelections(value?: string, packaging = false): RecipeSelection[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((part) => part?.model)
      .map((part) => ({
        id: nextSelectionId(),
        model: String(part.model || ''),
        supplier: String(part.supplier || ''),
        qty: String(part.qty || 1),
        packagingMaterial: String(part.packagingMaterial || (packaging ? '纸箱' : '')),
        costSource: part.costSource === 'manual' ? 'manual' : '',
        snapshotPrice: part.snapshotPrice == null ? '' : String(part.snapshotPrice),
      }));
  } catch {
    return [];
  }
}

function parseJsonArray<T>(value?: string): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseVariantCustomFields(value?: string): VariantCustomField[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => ({
        id: `field-${index}-${Date.now()}`,
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

function templateFormFromTemplate(template: PumpShellTemplate): TemplateFormState {
  const partRows = parseJsonArray<TemplatePartRow>(template.partsJson).map((part) => ({
    id: nextSelectionId(),
    name: part.name || '',
    model: part.model || '',
    qty: Number(part.qty || 1),
    supplier: part.supplier || '',
  }));
  const componentRows: ShellComponentFormRow[] = parseJsonArray<ShellComponentRow>(template.shellComponentsJson).map((component) => ({
    id: nextSelectionId(),
    name: component.name || '',
    model: component.model || '',
    qty: Number(component.qty || 1),
    unitCost: Number(component.unitCost || 0),
    pricingMode: component.pricingMode === 'lengthCm' ? 'lengthCm' as const : 'fixed' as const,
    included: component.included !== false,
    optional: Boolean(component.optional),
    note: component.note || '',
  }));
  const rotorParams = emptyTemplateRotorParams();
  try {
    const parsed = JSON.parse(template.rotorParamsJson || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      templateRotorParamFields.forEach((field) => {
        const value = parsed[field.key];
        rotorParams[field.key] = value == null ? '' : String(value);
      });
    }
  } catch {
    // Invalid saved rotor params are ignored in the form.
  }

  return {
    shellModel: template.shellModel || '',
    description: template.description || '',
    assemblyWage: String(template.assemblyWage || 0),
    packingWage: String(template.packingWage || 0),
    surfaceTreatmentMode: template.surfaceTreatmentMode || (template.paintingWage == null ? 'none' : 'painting'),
    surfaceTreatmentCost: String(template.surfaceTreatmentCost ?? template.paintingWage ?? 0),
    costMode: template.costMode === 'bundle' ? 'bundle' : 'components',
    bundleCost: String(template.bundleCost || 0),
    bundleNote: template.bundleNote || '',
    partRows: partRows.length > 0 ? partRows : defaultTemplateParts(),
    componentRows: componentRows.length > 0 ? componentRows : defaultShellComponents(),
    rotorParams,
  };
}

function templateFormToInput(form: TemplateFormState): TemplateInput {
  const partsPayload: TemplatePartInput[] = form.partRows
    .filter((row) => row.name.trim() && row.model.trim())
    .map((row) => ({
      name: row.name.trim(),
      model: row.model.trim(),
      supplier: row.supplier?.trim() || '',
      qty: numberValue(String(row.qty)) || 1,
    }));
  const componentsPayload: ShellComponentInput[] = form.costMode === 'components'
    ? form.componentRows
        .filter((row) => row.name.trim())
        .map((row) => ({
          name: row.name.trim(),
          model: row.model?.trim() || '',
          qty: numberValue(String(row.qty)) || 1,
          unitCost: Math.max(0, numberValue(String(row.unitCost))),
          pricingMode: row.pricingMode === 'lengthCm' ? 'lengthCm' : 'fixed',
          included: row.included !== false,
          optional: Boolean(row.optional),
          note: row.note?.trim() || '',
        }))
    : [];
  const rotorParamsPayload = templateRotorParamFields.reduce<Record<string, string>>((payload, field) => {
    const value = form.rotorParams[field.key].trim();
    if (value) payload[field.key] = value;
    return payload;
  }, {});

  return {
    shellModel: form.shellModel.trim(),
    description: form.description.trim(),
    partsJson: JSON.stringify(partsPayload),
    shellComponentsJson: JSON.stringify(componentsPayload),
    rotorParamsJson: JSON.stringify(rotorParamsPayload),
    assemblyWage: Math.max(0, numberValue(form.assemblyWage)),
    packingWage: Math.max(0, numberValue(form.packingWage)),
    paintingWage: form.surfaceTreatmentMode === 'none' ? null : Math.max(0, numberValue(form.surfaceTreatmentCost)),
    surfaceTreatmentMode: form.surfaceTreatmentMode,
    surfaceTreatmentCost: form.surfaceTreatmentMode === 'none' ? 0 : Math.max(0, numberValue(form.surfaceTreatmentCost)),
    costMode: form.costMode,
    bundleCost: form.costMode === 'bundle' ? Math.max(0, numberValue(form.bundleCost)) : 0,
    bundleNote: form.costMode === 'bundle' ? form.bundleNote.trim() : '',
  };
}

function selectionToRecipeParts(parts: RecipeSelection[], packaging = false): RecipePart[] {
  return parts
    .filter((part) => part.model.trim())
    .map((part) => ({
      model: part.model.trim(),
      supplier: part.supplier.trim(),
      qty: numberValue(part.qty) || 1,
      ...(packaging ? { packagingMaterial: part.packagingMaterial.trim() || '纸箱' } : {}),
      ...(part.costSource === 'manual'
        ? { snapshotPrice: numberValue(part.snapshotPrice), costSource: 'manual' }
        : {}),
    }));
}

function wireOptions(parts: Part[], prefix: string): string[] {
  const values = new Set<string>();
  parts.forEach((part) => {
    if (!part.model.startsWith(prefix)) return;
    const value = part.model.slice(prefix.length).trim();
    if (value) values.add(value);
  });
  return Array.from(values).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function normalizeWireGauge(value: unknown): string {
  return String(value ?? '').trim().replace(/^线径/, '');
}

function matchWireOption(options: string[], wireGauge: unknown): string {
  const normalizedGauge = normalizeWireGauge(wireGauge);
  if (!normalizedGauge) return '';
  return options.find((option) => normalizeWireGauge(option) === normalizedGauge)
    || options.find((option) => normalizeWireGauge(option).includes(normalizedGauge))
    || normalizedGauge;
}

function recipePartKey(part: RecipePart): string {
  const name = String(part.name || '').trim();
  if (name) return `name:${name.replace(/\s+/g, '')}`;
  if (part.dynamicRule) return `rule:${part.dynamicRule}`;
  if (part.packagingMaterial) return `packing:${String(part.packagingMaterial).trim()}`;
  return `model:${String(part.model || '').trim().replace(/\s+/g, '')}`;
}

function recipePartSubtotal(part?: RecipePart): number {
  return Number(part?.snapshotPrice || 0) * Number(part?.qty || 0);
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

function partCostSourceLabel(part?: RecipePart): string {
  if (!part) return '待匹配';
  if (part.costSource === 'manual') return '手输价';
  if (part.source === 'pump_shell_template') return '模板价';
  if (part.source === 'manual') return '手输价';
  if (part.name === '线圈转子') return '线圈计算';
  if (part.dynamicRule === 'longScrewByBarrelLength') return '长度计算';
  return '目录价';
}

function partCostLine(part?: RecipePart): string {
  if (!part) return '未生成成本';
  const unitPrice = Number(part.snapshotPrice || 0);
  const qty = Number(part.qty || 0);
  return `${partCostSourceLabel(part)} ${money(unitPrice)} × ${qty || 0} = ${money(unitPrice * qty)}`;
}

function partFormulaLine(part?: RecipePart): string {
  if (!part) return '';
  if (part.formula) return part.formula;
  if (part.dynamicRule === 'longScrewByBarrelLength') {
    return `长螺丝长度=${part.barrelLength || 0}+${part.longScrewExtraLength || 0}=${part.screwLength || 0}mm`;
  }
  return '';
}

function coilWireWeightFromFormula(formula?: string): string {
  const match = String(formula || '').match(/\+\s*([0-9]+(?:\.[0-9]+)?)\s*×/);
  return match?.[1] || '';
}

function savedCoilWireWeight(recipe: Recipe): string {
  if (recipe.coilWireWeight != null && Number(recipe.coilWireWeight) > 0) return String(recipe.coilWireWeight);
  const coilPart = parseRecipePartsJson(recipe.partsJson).find((part) => part.name === '线圈转子' && part.formula);
  return coilWireWeightFromFormula(coilPart?.formula);
}

function findDraftPart(draft: RecipeBomDraftResult | null, selection: RecipeSelection): RecipePart | undefined {
  if (!draft || !selection.model.trim()) return undefined;
  const model = selection.model.trim();
  const supplier = selection.supplier.trim();
  return draft.parts.find((part) => (
    part.model === model
    && (!supplier || String(part.supplier || '') === supplier)
    && Number(part.qty || 1) === (numberValue(selection.qty) || 1)
  )) || draft.parts.find((part) => part.model === model && (!supplier || String(part.supplier || '') === supplier));
}

function isDynamicDraftPart(part: RecipePart): boolean {
  const text = `${part.name || ''}${part.model || ''}`;
  return part.name === '线圈转子'
    || part.name === '电容'
    || text.includes('浮球')
    || text.includes('电缆')
    || text.includes('纸箱')
    || text.includes('泡沫')
    || Boolean(part.packagingMaterial);
}

function bomPartsCost(draft: RecipeBomDraftResult | null): number {
  return draft ? draft.parts.reduce((sum, part) => sum + recipePartSubtotal(part), 0) : 0;
}

function liveRecipeTotal(draft: RecipeBomDraftResult | null, form: RecipeFormState): number {
  if (!draft) return 0;
  return bomPartsCost(draft)
    + numberValue(form.assemblyWage)
    + numberValue(form.packingWage)
    + (form.surfaceTreatmentMode === 'none' ? 0 : numberValue(form.surfaceTreatmentCost))
    + numberValue(form.managementFee);
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

function formFromRecipe(recipe: Recipe): RecipeFormState {
  return {
    name: recipe.name,
    spec: recipe.spec,
    templateId: recipe.templateId ? String(recipe.templateId) : '',
    variantId: recipe.modelVariantId ? String(recipe.modelVariantId) : '',
    coilSpec: recipe.coilSpec || '',
    coilSheets: recipe.coilSheets ? String(recipe.coilSheets) : '',
    coilMaterial: recipe.coilMaterial || '钢带',
    coilWireWeight: savedCoilWireWeight(recipe),
    hasFloat: Boolean(recipe.hasFloat),
    floatWire: recipe.floatWire || '',
    floatAccessoryType: recipe.floatAccessoryType || 'standard',
    hasCable: Boolean(recipe.hasCable),
    cableLength: recipe.cableLength ? String(recipe.cableLength) : '',
    cableWire: recipe.cableWire || '',
    cableAccessoryType: recipe.cableAccessoryType || 'standard',
    customBarrelLength: recipe.customBarrelLength ? String(recipe.customBarrelLength) : '',
    longScrewExtraLength: '0',
    impellerModel: recipe.impellerModel || '',
    impellerThickness: recipe.impellerThickness ? String(recipe.impellerThickness) : '',
    impellerDiameter: recipe.impellerDiameter ? String(recipe.impellerDiameter) : '',
    impellerBladeCount: recipe.impellerBladeCount ? String(recipe.impellerBladeCount) : '',
    assemblyWage: String(recipe.assemblyWage || 0),
    packingWage: String(recipe.packingWage || 0),
    surfaceTreatmentMode: (recipe.surfaceTreatmentMode as RecipeFormState['surfaceTreatmentMode']) || 'none',
    surfaceTreatmentCost: String(recipe.surfaceTreatmentCost || 0),
    managementFee: String(recipe.managementFee || 0),
    technicalData: parseTechnicalDataJson(recipe.technicalDataJson),
  };
}

export function RecipesView() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [currentCosts, setCurrentCosts] = useState<RecipeCurrentTotalCost[]>([]);
  const [templates, setTemplates] = useState<PumpShellTemplate[]>([]);
  const [variants, setVariants] = useState<PumpModelVariant[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [currentCopperPricePerKg, setCurrentCopperPricePerKg] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<RecipeSection>('recipes');
  const [query, setQuery] = useState('');
  const [templateId, setTemplateId] = useState('全部');
  const [quickFilter, setQuickFilter] = useState<RecipeFilter>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [detailRecipe, setDetailRecipe] = useState<Recipe | null>(null);
  const [detailCurrentCost, setDetailCurrentCost] = useState<RecipeCurrentCostResult | null>(null);
  const [detailCurrentCostLoading, setDetailCurrentCostLoading] = useState(false);
  const [detailCurrentCostError, setDetailCurrentCostError] = useState<string | null>(null);
  const [produceQty, setProduceQty] = useState('1');
  const [productionDraft, setProductionDraft] = useState<RecipeProductionDraft | null>(null);
  const [productionLoading, setProductionLoading] = useState(false);
  const [productionError, setProductionError] = useState<string | null>(null);
  const [productionSuccess, setProductionSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<RecipeFormState>(emptyForm);
  const [optionalParts, setOptionalParts] = useState<RecipeSelection[]>([]);
  const [packingParts, setPackingParts] = useState<RecipeSelection[]>([]);
  const [bomDraft, setBomDraft] = useState<RecipeBomDraftResult | null>(null);
  const [bomDraftLoading, setBomDraftLoading] = useState(false);
  const [bomDraftError, setBomDraftError] = useState<string | null>(null);
  const [templateMatchDialogOpen, setTemplateMatchDialogOpen] = useState(false);
  const [bomDetailsOpen, setBomDetailsOpen] = useState(false);
  const [variantDrawerOpen, setVariantDrawerOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<PumpModelVariant | null>(null);
  const [variantForm, setVariantForm] = useState<VariantFormState>(emptyVariantForm);
  const [variantQuery, setVariantQuery] = useState('');
  const [variantTemplateFilter, setVariantTemplateFilter] = useState('');
  const [coilSpecs, setCoilSpecs] = useState<CoilSpecOption[]>([]);
  const [coilRecords, setCoilRecords] = useState<CoilRecord[]>([]);
  const [templateDetail, setTemplateDetail] = useState<PumpShellTemplate | null>(null);
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PumpShellTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(emptyTemplateForm());
  const bomDraftRequestRef = useRef(0);

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      const [data, partRows] = await Promise.all([getRecipeDataset(), getAllParts()]);
      setRecipes(data.recipes);
      setCurrentCosts(data.currentCosts);
      setTemplates(data.templates);
      setVariants(data.variants);
      setParts(partRows);
      setCurrentCopperPricePerKg(data.currentCopperPricePerKg);
      void getCoilSpecOptions().then(setCoilSpecs).catch(() => setCoilSpecs([]));
      void getAllCoils().then(setCoilRecords).catch(() => setCoilRecords([]));
    } catch (err) {
      setError(err instanceof Error ? err.message : '配方加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const templateNameMap = useMemo(() => buildTemplateNameMap(templates), [templates]);
  const currentCostMap = useMemo(() => new Map(currentCosts.map((item) => [item.recipeId, item])), [currentCosts]);

  const recipeRows = useMemo(() => {
    return recipes.map((recipe) => {
      const parts = validRecipeParts(parseRecipePartsJson(recipe.partsJson));
      const copperRisk = buildRecipeCopperRisk(parts, currentCopperPricePerKg);
      return {
        recipe,
        parts,
        partCount: parts.length,
        overview: recipePartsOverview(parts),
        savedTotal: getRecipeSavedTotal(recipe),
        currentCost: currentCostMap.get(recipe.id) || null,
        laborTotal: getRecipeLaborTotal(recipe),
        templateName: recipe.templateId ? templateNameMap.get(recipe.templateId) || '' : '',
        copperRisk,
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
        (quickFilter === 'float' && Boolean(recipe.hasFloat)) ||
        (quickFilter === 'cable' && Boolean(recipe.hasCable));
      return matchesTemplate && matchesQuick && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [query, quickFilter, recipeRows, templateId]);

  const stats = useMemo(() => {
    const totalSavedCost = recipeRows.reduce((sum, row) => sum + (row.savedTotal || 0), 0);
    const riskyCount = recipeRows.filter((row) => ['watch', 'review', 'critical'].includes(row.copperRisk.level)).length;
    const missingCostCount = recipeRows.filter((row) => !row.savedTotal).length;
    return { totalSavedCost, riskyCount, missingCostCount };
  }, [recipeRows]);

  const compareRecipes = useMemo(() => {
    return compareIds
      .map((id) => recipes.find((recipe) => recipe.id === id))
      .filter(Boolean) as Recipe[];
  }, [compareIds, recipes]);

  const comparePartRows = useMemo(() => {
    if (compareRecipes.length !== 2) return [];
    return buildComparePartRows(
      validRecipeParts(parseRecipePartsJson(compareRecipes[0].partsJson)),
      validRecipeParts(parseRecipePartsJson(compareRecipes[1].partsJson))
    );
  }, [compareRecipes]);

  const detailParts = useMemo(() => {
    return detailRecipe ? validRecipeParts(parseRecipePartsJson(detailRecipe.partsJson)) : [];
  }, [detailRecipe]);

  useEffect(() => {
    if (!detailRecipe) {
      setDetailCurrentCost(null);
      setDetailCurrentCostError(null);
      setDetailCurrentCostLoading(false);
      return;
    }

    let cancelled = false;
    setDetailCurrentCostLoading(true);
    setDetailCurrentCostError(null);
    void getRecipeCurrentCost(detailRecipe.id)
      .then((result) => {
        if (!cancelled) setDetailCurrentCost(result);
      })
      .catch((err) => {
        if (!cancelled) setDetailCurrentCostError(err instanceof Error ? err.message : '当前成本读取失败');
      })
      .finally(() => {
        if (!cancelled) setDetailCurrentCostLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailRecipe]);

  const detailTechnicalEntries = useMemo(() => {
    if (!detailRecipe) return [];
    const technicalData = parseTechnicalDataJson(detailRecipe.technicalDataJson);
    const fixedEntries = Object.entries(technicalData)
      .filter(([key, value]) => key !== 'customFields' && String(value ?? '').trim())
      .map(([key, value]) => ({ id: key, label: key, value: String(value), unit: '' }));
    const customFields = Array.isArray(technicalData.customFields)
      ? technicalData.customFields
          .map((field, index) => ({
            id: String(field?.id || `custom-${index}`),
            label: String(field?.label || ''),
            value: String(field?.value || ''),
            unit: String(field?.unit || ''),
          }))
          .filter((field) => field.label || field.value || field.unit)
      : [];
    return [...fixedEntries, ...customFields];
  }, [detailRecipe]);

  const detailSavedTotal = detailRecipe ? getRecipeSavedTotal(detailRecipe) : null;
  const detailCurrentTotal = detailCurrentCost ? Number(detailCurrentCost.totalCost || 0) : null;
  const detailCostDiff = detailCurrentTotal != null && detailSavedTotal != null
    ? detailCurrentTotal - detailSavedTotal
    : null;
  const detailSavedAt = detailRecipe ? dateTimeShort(detailRecipe.updatedAt || detailRecipe.createdAt) : '-';
  const detailCurrentAt = detailCurrentCost ? dateTimeShort(detailCurrentCost.fetchedAt) : '-';
  const detailPartCompareRows = useMemo(() => {
    return detailParts.map((part, index) => {
      const current = detailCurrentCost?.details?.[index];
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
  }, [detailCurrentCost, detailParts]);

  const templateRows = useMemo(() => {
    return templates.map((template) => {
      const fixedParts = parseJsonArray<TemplatePartRow>(template.partsJson);
      const shellComponents = parseJsonArray<ShellComponentRow>(template.shellComponentsJson);
      const costMode = template.costMode === 'bundle' ? 'bundle' : 'components';
      const shellCost = costMode === 'bundle'
        ? Number(template.bundleCost || 0)
        : shellComponents
            .filter((component) => component.included !== false)
            .reduce((sum, component) => sum + Number(component.unitCost || 0) * Number(component.qty || 1), 0);
      return {
        template,
        fixedParts,
        shellComponents,
        costMode,
        shellCost,
        laborCost: Number(template.assemblyWage || 0) + Number(template.packingWage || 0),
      };
    });
  }, [templates]);

  const selectedVariantCoil = coilSpecs.find((spec) => spec.spec === variantForm.coilSpec);
  const variantMaterialOptions = selectedVariantCoil?.materials?.length ? selectedVariantCoil.materials : ['钢带'];

  const filteredVariants = useMemo(() => {
    const normalizedQuery = variantQuery.trim().toLowerCase();
    return variants.filter((variant) => {
      if (variantTemplateFilter && String(variant.templateId) !== variantTemplateFilter) return false;
      if (!normalizedQuery) return true;
      const customText = parseVariantCustomFields(variant.customFieldsJson).map((field) => `${field.label} ${field.value}`).join(' ');
      const text = [
        variant.modelName,
        templateNameMap.get(variant.templateId),
        variant.coilSpec,
        variant.coilSheets,
        variant.coilMaterial,
        variant.impellerModel,
        variant.note,
        customText,
      ].join(' ').toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [templateNameMap, variantQuery, variantTemplateFilter, variants]);

  const formTemplate = templates.find((template) => String(template.id) === form.templateId);
  const formShellMeta = useMemo(() => findShellMetaForTemplate(formTemplate, parts), [formTemplate, parts]);
  const hasStainlessBarrel = formShellMeta?.isStainless === true;
  const technicalReferenceFields = useMemo(
    () => buildTechnicalReferenceFields({ shellMetaInfo: formShellMeta, selectedTemplate: formTemplate || null }),
    [formShellMeta, formTemplate]
  );
  const selectedFormCoilSpec = coilSpecs.find((spec) => spec.spec === form.coilSpec);
  const formMaterialOptions = selectedFormCoilSpec?.materials?.length ? selectedFormCoilSpec.materials : ['钢带'];
  const coilWireWeightOptions = useMemo(() => (
    Array.from(new Set(coilRecords
      .filter((coil) => (!form.coilSpec || coil.spec === form.coilSpec) && (!form.coilMaterial || coil.material === form.coilMaterial))
      .map((coil) => Number(coil.wireWeight || 0))
      .filter((weight) => weight > 0)
      .map((weight) => String(weight))))
      .sort((a, b) => Number(a) - Number(b))
  ), [coilRecords, form.coilMaterial, form.coilSpec]);
  const floatWireOptions = useMemo(() => wireOptions(parts, '浮球-线径'), [parts]);
  const cableWireOptions = useMemo(() => wireOptions(parts, '电缆-线径'), [parts]);
  const partModelOptions = useMemo(
    () => Array.from(new Set(parts.filter((part) => part.category !== '包装').map((part) => part.model).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    [parts]
  );
  const shellCatalogOptions = useMemo(() => {
    const grouped = new Map<string, Part[]>();
    parts
      .filter((part) => part.category === '泵壳' && part.model.trim())
      .forEach((part) => {
        const rows = grouped.get(part.model) || [];
        rows.push(part);
        grouped.set(part.model, rows);
      });
    return Array.from(grouped.entries())
      .map(([model, rows]) => ({
        model,
        rows: rows.sort((left, right) => left.price - right.price),
      }))
      .sort((left, right) => left.model.localeCompare(right.model, 'zh-Hans-CN'));
  }, [parts]);
  const selectedTemplateShellParts = useMemo(
    () => shellCatalogOptions.find((option) => option.model === templateForm.shellModel)?.rows || [],
    [shellCatalogOptions, templateForm.shellModel]
  );
  const packingModelOptions = useMemo(
    () => Array.from(new Set(parts.filter((part) => part.category === '包装').map((part) => part.model).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    [parts]
  );
  const optionalPartsKey = useMemo(() => JSON.stringify(optionalParts), [optionalParts]);
  const packingPartsKey = useMemo(() => JSON.stringify(packingParts), [packingParts]);
  const liveTotal = useMemo(() => liveRecipeTotal(bomDraft, form), [bomDraft, form]);
  const relatedBomParts = useMemo(() => {
    if (!bomDraft) return [];
    const manualModels = new Set([...optionalParts, ...packingParts].map((part) => part.model.trim()).filter(Boolean));
    return bomDraft.parts.filter((part) => !manualModels.has(part.model) && !isDynamicDraftPart(part));
  }, [bomDraft, optionalParts, packingParts]);
  const relatedBomPartsCost = useMemo(
    () => relatedBomParts.reduce((sum, part) => sum + recipePartSubtotal(part), 0),
    [relatedBomParts]
  );
  const optionalPartsCost = useMemo(() => optionalParts.reduce((sum, part) => sum + recipePartSubtotal(findDraftPart(bomDraft, part)), 0), [bomDraft, optionalParts]);
  const packingPartsCost = useMemo(() => packingParts.reduce((sum, part) => sum + recipePartSubtotal(findDraftPart(bomDraft, part)), 0), [bomDraft, packingParts]);
  const laborAndManagementCost = useMemo(() => (
    numberValue(form.assemblyWage) + numberValue(form.packingWage) + numberValue(form.managementFee)
  ), [form.assemblyWage, form.managementFee, form.packingWage]);
  const surfaceTreatmentPreviewCost = form.surfaceTreatmentMode === 'none' ? 0 : numberValue(form.surfaceTreatmentCost);
  const laborCostWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (numberValue(form.assemblyWage) <= 0) warnings.push('安装工资未填写或为 0，人工成本可能漏算');
    if (numberValue(form.packingWage) <= 0) warnings.push('打包工资未填写或为 0，人工成本可能漏算');
    if (numberValue(form.managementFee) <= 0) warnings.push('管理费未填写或为 0，管理成本可能漏算');
    if (form.surfaceTreatmentMode === 'none') {
      warnings.push('表面处理未启用；如需要喷漆或其他处理，成本可能漏算');
    } else if (numberValue(form.surfaceTreatmentCost) <= 0) {
      warnings.push('表面处理费用未填写或为 0，表面处理成本可能漏算');
    }
    return warnings;
  }, [form.assemblyWage, form.managementFee, form.packingWage, form.surfaceTreatmentCost, form.surfaceTreatmentMode]);
  const laborCostComplete = laborCostWarnings.length === 0;
  const missingConfigHints = useMemo(() => {
    const hints: string[] = [];
    if (!form.name.trim()) hints.push('未填写配方名称');
    if (!form.templateId) hints.push('未选择泵壳模板');
    if (!form.coilSpec || !form.coilSheets) hints.push('线圈规格或片数不完整');
    if (form.hasCable && (!form.cableWire || !form.cableLength)) hints.push('电缆线径或长度不完整');
    if (form.hasFloat && !form.floatWire) hints.push('浮球线径未填写');
    if (bomDraftError) hints.push(bomDraftError);
    return hints;
  }, [bomDraftError, form.cableLength, form.cableWire, form.coilSheets, form.coilSpec, form.floatWire, form.hasCable, form.hasFloat, form.name, form.templateId]);
  const costWarningHints = useMemo(() => {
    const hints: string[] = [];
    if (packingParts.length === 0) hints.push('尚未配置包装材料，成本可能不完整');
    if (!relatedBomParts.length) hints.push('尚未匹配模板 BOM，配件成本可能不完整');
    if (!bomDraft?.coilSnapshot) hints.push('尚未生成线圈成本，线圈成本可能不完整');
    hints.push(...laborCostWarnings);
    return hints;
  }, [bomDraft?.coilSnapshot, laborCostWarnings, packingParts.length, relatedBomParts.length]);
  const recipeSaveBlockedByWarnings = costWarningHints.length > 0;
  const configurationStatus = useMemo(() => {
    const floatReady = !form.hasFloat || Boolean(form.floatWire);
    const cableReady = !form.hasCable || Boolean(form.cableWire && form.cableLength);
    const checks = [
      { label: '基础信息', done: Boolean(form.name.trim() && form.templateId) },
      { label: '模板 BOM', done: relatedBomParts.length > 0 },
      { label: '线圈成本', done: Boolean(form.coilSpec && form.coilSheets && bomDraft?.coilSnapshot) },
      { label: '浮球/电缆', done: floatReady && cableReady },
      { label: '包装', done: packingParts.length > 0 || Boolean(bomDraft?.parts.some((part) => String(part.name || part.model || '').includes('包装') || String(part.name || part.model || '').includes('纸箱'))) },
      { label: '人工管理', done: laborCostComplete },
    ];
    const completedItems = checks.filter((item) => item.done).map((item) => item.label);
    const pendingItems = checks.filter((item) => !item.done).map((item) => item.label);
    return {
      completedItems,
      pendingItems,
      completionPercent: Math.round((completedItems.length / checks.length) * 100),
    };
  }, [
    bomDraft,
    form.assemblyWage,
    form.cableLength,
    form.cableWire,
    form.coilSheets,
    form.coilSpec,
    form.floatWire,
    form.hasCable,
    form.hasFloat,
    form.managementFee,
    form.name,
    form.packingWage,
    form.templateId,
    laborCostComplete,
    packingParts.length,
    relatedBomParts.length,
  ]);

  useEffect(() => {
    if (!drawerOpen) return;
    if (!canPreviewBomDraft()) {
      setBomDraft(null);
      setBomDraftError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void buildBomDraft({ silent: true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    drawerOpen,
    form.templateId,
    form.variantId,
    form.customBarrelLength,
    form.longScrewExtraLength,
    form.coilSpec,
    form.coilSheets,
    form.coilMaterial,
    form.coilWireWeight,
    form.hasFloat,
    form.floatWire,
    form.floatAccessoryType,
    form.hasCable,
    form.cableLength,
    form.cableWire,
    form.cableAccessoryType,
    form.assemblyWage,
    form.packingWage,
    form.surfaceTreatmentMode,
    form.surfaceTreatmentCost,
    form.managementFee,
    hasStainlessBarrel,
    optionalPartsKey,
    packingPartsKey,
  ]);

  useEffect(() => {
    const wireGauge = bomDraft?.coilSnapshot?.wireGauge;
    if (!drawerOpen || !wireGauge) return;
    const nextFloatWire = matchWireOption(floatWireOptions, wireGauge);
    const nextCableWire = matchWireOption(cableWireOptions, wireGauge);
    if (!nextFloatWire && !nextCableWire) return;

    setForm((current) => {
      const patch: Partial<RecipeFormState> = {};
      if (nextFloatWire && normalizeWireGauge(current.floatWire) !== normalizeWireGauge(nextFloatWire)) {
        patch.floatWire = nextFloatWire;
      }
      if (nextCableWire && normalizeWireGauge(current.cableWire) !== normalizeWireGauge(nextCableWire)) {
        patch.cableWire = nextCableWire;
      }
      return Object.keys(patch).length > 0 ? { ...current, ...patch } : current;
    });
  }, [bomDraft?.coilSnapshot?.wireGauge, cableWireOptions, drawerOpen, floatWireOptions]);

  function updateForm(patch: Partial<RecipeFormState>, invalidateBom = true) {
    setForm((current) => ({ ...current, ...patch }));
    if (invalidateBom) setBomDraftError(null);
  }

  function scrollToCostWarningTarget() {
    const targetId = laborCostWarnings.length > 0
      ? 'recipe-labor-section'
      : packingParts.length === 0
        ? 'recipe-optional-packing-section'
        : 'recipe-basic-section';
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function defaultSupplierForModel(model: string, category?: string): string {
    const candidates = parts
      .filter((part) => part.model === model && (!category || part.category === category))
      .filter((part) => String(part.supplier || '').trim());
    if (candidates.length === 0) return '';
    return candidates.reduce((lowest, part) => Number(part.price || 0) < Number(lowest.price || 0) ? part : lowest, candidates[0]).supplier || '';
  }

  function openCreateDrawer() {
    setEditingRecipe(null);
    setForm(emptyForm);
    setOptionalParts([]);
    setPackingParts([]);
    setBomDraft(null);
    setBomDraftError(null);
    setTemplateMatchDialogOpen(false);
    setBomDetailsOpen(false);
    setFormError(null);
    setDrawerOpen(true);
  }

  function openEditDrawer(recipe: Recipe) {
    setEditingRecipe(recipe);
    setForm(formFromRecipe(recipe));
    setOptionalParts(parseSelections(recipe.extraPartsJson));
    setPackingParts(parseSelections(recipe.packingPartsJson, true));
    setBomDraft({
      parts: validRecipeParts(parseRecipePartsJson(recipe.partsJson)),
      shellPrice: 0,
      templateParts: [],
      shellComponents: [],
      coilSnapshot: null,
      capacitorModel: '',
      customBarrelLength: recipe.customBarrelLength ?? null,
      longScrewExtraLength: 0,
    });
    setBomDraftError(null);
    setTemplateMatchDialogOpen(false);
    setBomDetailsOpen(false);
    setFormError(null);
    setDrawerOpen(true);
  }

  function openCloneRecipe(recipe: Recipe) {
    setEditingRecipe(null);
    setForm({
      ...formFromRecipe(recipe),
      name: `${recipe.name || '未命名配方'} - 副本`,
      variantId: '',
    });
    setOptionalParts(parseSelections(recipe.extraPartsJson));
    setPackingParts(parseSelections(recipe.packingPartsJson, true));
    setBomDraft({
      parts: validRecipeParts(parseRecipePartsJson(recipe.partsJson)),
      shellPrice: 0,
      templateParts: [],
      shellComponents: [],
      coilSnapshot: null,
      capacitorModel: '',
      customBarrelLength: recipe.customBarrelLength ?? null,
      longScrewExtraLength: 0,
    });
    setBomDraftError(null);
    setTemplateMatchDialogOpen(false);
    setBomDetailsOpen(false);
    setFormError(null);
    setDrawerOpen(true);
  }

  async function onTemplateChange(nextTemplateId: string) {
    const templateId = Number(nextTemplateId);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      updateForm({
        templateId: nextTemplateId,
        variantId: '',
        customBarrelLength: '',
        longScrewExtraLength: '0',
        impellerModel: '',
        impellerThickness: '',
        impellerDiameter: '',
        impellerBladeCount: '',
        assemblyWage: '0',
        packingWage: '0',
        surfaceTreatmentMode: 'none',
        surfaceTreatmentCost: '0',
      });
      setBomDraft(null);
      setBomDraftError(null);
      return;
    }

    try {
      const nextTemplate = templates.find((template) => template.id === templateId);
      const nextShellMeta = findShellMetaForTemplate(nextTemplate, parts);
      const nextHasStainlessBarrel = nextShellMeta?.isStainless === true;
      const { recipeDraft } = await getTemplateRecipeDraft(templateId);
      updateForm({
        templateId: String(recipeDraft.templateId),
        variantId: '',
        ...(!nextHasStainlessBarrel ? { customBarrelLength: '', longScrewExtraLength: '0' } : {}),
        impellerModel: '',
        impellerThickness: '',
        impellerDiameter: '',
        impellerBladeCount: '',
        assemblyWage: String(recipeDraft.assemblyWage || 0),
        packingWage: String(recipeDraft.packingWage || 0),
        surfaceTreatmentMode: recipeDraft.surfaceTreatmentMode || 'none',
        surfaceTreatmentCost: String(recipeDraft.surfaceTreatmentCost || 0),
      });
      setBomDraftError(null);
      setFormError(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '应用泵壳模板失败');
    }
  }


  function addOptionalPart() {
    setOptionalParts((current) => [
      ...current,
      { id: nextSelectionId(), model: '', supplier: '', qty: '1', packagingMaterial: '', costSource: '', snapshotPrice: '' },
    ]);
    setBomDraftError(null);
  }

  function addPackingPart() {
    setPackingParts((current) => [
      ...current,
      { id: nextSelectionId(), model: '', supplier: '', qty: '1', packagingMaterial: '', costSource: '', snapshotPrice: '' },
    ]);
    setBomDraftError(null);
  }

  function updateOptionalPart(id: string, patch: Partial<RecipeSelection>) {
    setOptionalParts((current) => current.map((part) => {
      if (part.id !== id) return part;
      const next = { ...part, ...patch };
      if (patch.model !== undefined && patch.supplier === undefined) {
        next.supplier = defaultSupplierForModel(String(patch.model || ''));
        next.snapshotPrice = '';
        next.costSource = '';
      }
      if (patch.supplier !== undefined) {
        next.snapshotPrice = '';
        next.costSource = '';
      }
      return next;
    }));
    setBomDraftError(null);
  }

  function updatePackingPart(id: string, patch: Partial<RecipeSelection>) {
    setPackingParts((current) => current.map((part) => {
      if (part.id !== id) return part;
      const next = { ...part, ...patch };
      if (patch.model !== undefined && patch.supplier === undefined) {
        next.supplier = defaultSupplierForModel(String(patch.model || ''), '包装');
        next.snapshotPrice = '';
        next.costSource = '';
      }
      if (patch.supplier !== undefined) {
        next.snapshotPrice = '';
        next.costSource = '';
      }
      return next;
    }));
    setBomDraftError(null);
  }

  function removeOptionalPart(id: string) {
    setOptionalParts((current) => current.filter((part) => part.id !== id));
    setBomDraftError(null);
  }

  function removePackingPart(id: string) {
    setPackingParts((current) => current.filter((part) => part.id !== id));
    setBomDraftError(null);
  }

  function toggleCompareRecipe(id: number) {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current.slice(-1), id];
    });
  }

  async function refreshProductionCheck(recipe: Recipe, qtyValue = produceQty) {
    const qty = Math.max(1, Number(qtyValue || 1));
    setProductionLoading(true);
    setProductionError(null);
    try {
      const draft = await checkRecipeProduction(recipe.id, qty);
      setProductionDraft(draft);
    } catch (err) {
      setProductionDraft(null);
      setProductionError(err instanceof Error ? err.message : '库存预检失败');
    } finally {
      setProductionLoading(false);
    }
  }

  function openRecipeDetail(recipe: Recipe) {
    setDetailRecipe(recipe);
    setProduceQty('1');
    setProductionDraft(null);
    setProductionError(null);
    setProductionSuccess(null);
    void refreshProductionCheck(recipe, '1');
  }

  async function submitProduction() {
    if (!detailRecipe) return;
    const qty = Math.max(1, Number(produceQty || 1));
    if (!window.confirm(`确认按配方「${detailRecipe.name || detailRecipe.id}」生产 ${qty} 台并扣减库存？`)) return;

    setProductionLoading(true);
    setProductionError(null);
    try {
      const draft = await produceRecipe(detailRecipe.id, qty);
      setProductionDraft(draft);
      setProductionSuccess(`已完成生产扣库存：${qty} 台`);
      await load(true);
    } catch (err) {
      setProductionError(err instanceof Error ? err.message : '生产扣库存失败');
    } finally {
      setProductionLoading(false);
    }
  }

  function openCreateVariant() {
    setEditingVariant(null);
    setVariantForm(emptyVariantForm);
    setFormError(null);
    setVariantDrawerOpen(true);
  }

  function openEditVariant(variant: PumpModelVariant) {
    setEditingVariant(variant);
    setVariantForm(variantFormFromVariant(variant));
    setFormError(null);
    setVariantDrawerOpen(true);
  }

  function openCloneVariant(variant: PumpModelVariant) {
    setEditingVariant(null);
    setVariantForm(variantFormFromVariant(variant, `${variant.modelName || ''}-复用`));
    setFormError(null);
    setVariantDrawerOpen(true);
  }

  function updateVariantForm(patch: Partial<VariantFormState>) {
    setVariantForm((current) => ({ ...current, ...patch }));
  }

  function addVariantCustomField() {
    setVariantForm((current) => ({
      ...current,
      customFields: [...current.customFields, { id: nextSelectionId(), label: '', value: '' }],
    }));
  }

  function updateVariantCustomField(id: string, patch: Partial<VariantCustomField>) {
    setVariantForm((current) => ({
      ...current,
      customFields: current.customFields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    }));
  }

  function removeVariantCustomField(id: string) {
    setVariantForm((current) => ({
      ...current,
      customFields: current.customFields.filter((field) => field.id !== id),
    }));
  }

  async function submitVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!variantForm.modelName.trim()) {
      setFormError('配置名称不能为空');
      return;
    }
    if (!variantForm.templateId) {
      setFormError('请选择泵壳模板');
      return;
    }
    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      const input = variantFormToInput(variantForm);
      if (editingVariant) await updateModelVariant(editingVariant.id, input);
      else await createModelVariant(input);
      await load(true);
      setVariantDrawerOpen(false);
      setActiveSection('variants');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '常用配置保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeVariant(variant: PumpModelVariant) {
    if (!window.confirm(`确定删除常用配置「${variant.modelName || variant.id}」？已创建的配方不会被删除。`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteModelVariant(variant.id);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '常用配置删除失败');
    } finally {
      setSaving(false);
    }
  }

  function openCreateTemplate() {
    setEditingTemplate(null);
    setTemplateForm(emptyTemplateForm());
    setFormError(null);
    setTemplateDrawerOpen(true);
  }

  function openEditTemplate(template: PumpShellTemplate) {
    setEditingTemplate(template);
    setTemplateForm(templateFormFromTemplate(template));
    setFormError(null);
    setTemplateDrawerOpen(true);
  }

  function updateTemplateForm(patch: Partial<TemplateFormState>) {
    setTemplateForm((current) => ({ ...current, ...patch }));
  }

  function selectTemplateShell(shellModel: string) {
    const referencePrice = shellCatalogOptions
      .find((option) => option.model === shellModel)
      ?.rows.find((part) => part.price > 0)?.price;
    setTemplateForm((current) => ({
      ...current,
      shellModel,
      bundleCost: current.costMode === 'bundle' && referencePrice != null
        ? String(referencePrice)
        : current.bundleCost,
    }));
  }

  function selectTemplateCostMode(costMode: TemplateFormState['costMode']) {
    const referencePrice = selectedTemplateShellParts.find((part) => part.price > 0)?.price;
    setTemplateForm((current) => ({
      ...current,
      costMode,
      bundleCost: costMode === 'bundle' && numberValue(current.bundleCost) <= 0 && referencePrice != null
        ? String(referencePrice)
        : current.bundleCost,
    }));
  }

  function updateTemplateRotorParam(key: TemplateRotorParamKey, value: string) {
    setTemplateForm((current) => ({
      ...current,
      rotorParams: {
        ...current.rotorParams,
        [key]: value,
      },
    }));
  }

  function addTemplatePartRow() {
    setTemplateForm((current) => ({
      ...current,
      partRows: [...current.partRows, { id: nextSelectionId(), name: '', model: '', qty: 1, supplier: '' }],
    }));
  }

  function updateTemplatePartRow(id: string, patch: Partial<TemplatePartFormRow>) {
    setTemplateForm((current) => ({
      ...current,
      partRows: current.partRows.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.model !== undefined && patch.supplier === undefined) {
          next.supplier = defaultSupplierForModel(String(patch.model || ''));
        }
        return next;
      }),
    }));
  }

  function removeTemplatePartRow(id: string) {
    setTemplateForm((current) => ({
      ...current,
      partRows: current.partRows.filter((row) => row.id !== id),
    }));
  }

  function addShellComponentRow() {
    setTemplateForm((current) => ({
      ...current,
      componentRows: [...current.componentRows, {
        id: nextSelectionId(),
        name: '',
        model: '',
        qty: 1,
        unitCost: 0,
        pricingMode: 'fixed',
        included: true,
        optional: false,
        note: '',
      }],
    }));
  }

  function updateShellComponentRow(id: string, patch: Partial<ShellComponentFormRow>) {
    setTemplateForm((current) => ({
      ...current,
      componentRows: current.componentRows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  }

  function removeShellComponentRow(id: string) {
    setTemplateForm((current) => ({
      ...current,
      componentRows: current.componentRows.filter((row) => row.id !== id),
    }));
  }

  async function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateForm.shellModel.trim()) {
      setFormError('请从零件库选择泵壳型号');
      return;
    }
    const input = templateFormToInput(templateForm);
    if (JSON.parse(input.partsJson).length === 0) {
      setFormError('至少需要一个固定配件');
      return;
    }
    if (input.costMode === 'bundle' && input.bundleCost <= 0) {
      setFormError('泵壳套件模式需要填写套件价格');
      return;
    }
    if (input.costMode === 'components' && JSON.parse(input.shellComponentsJson).filter((row: ShellComponentInput) => row.included !== false).length === 0) {
      setFormError('自由搭配模式至少需要一个计入成本的组件');
      return;
    }
    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      if (editingTemplate) await updateTemplate(editingTemplate.id, input);
      else await createTemplate(input);
      await load(true);
      setTemplateDrawerOpen(false);
      setActiveSection('templates');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '泵壳模板保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate(template: PumpShellTemplate) {
    if (!window.confirm(`确定删除泵壳模板「${template.shellModel || template.id}」？如果已有配方引用，后端会拒绝删除。`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTemplate(template.id);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '泵壳模板删除失败');
    } finally {
      setSaving(false);
    }
  }

  function canPreviewBomDraft() {
    return Boolean(form.templateId || optionalParts.length > 0 || packingParts.length > 0 || form.hasFloat || form.hasCable || form.coilSpec || form.coilSheets);
  }

  async function buildBomDraft(options: { silent?: boolean } = {}) {
    if (!canPreviewBomDraft()) {
      if (!options.silent) setFormError('请先选择泵壳模板，或至少添加一个选配/包装/电缆配置');
      setBomDraft(null);
      setBomDraftError(null);
      return null;
    }
    const requestId = ++bomDraftRequestRef.current;
    setBomDraftLoading(true);
    if (!options.silent) setFormError(null);
    setBomDraftError(null);
    try {
      const draft = await previewRecipeBomDraft({
        templateId: Number(form.templateId),
        modelVariantId: form.variantId ? Number(form.variantId) : null,
        customBarrelLength: hasStainlessBarrel ? form.customBarrelLength || null : null,
        longScrewExtraLength: hasStainlessBarrel ? form.longScrewExtraLength || 0 : 0,
        coilSpec: form.coilSpec,
        coilSheets: form.coilSheets,
        coilMaterial: form.coilMaterial,
        coilWireWeight: form.coilWireWeight || null,
        optionalParts: selectionToRecipeParts(optionalParts),
        hasFloat: form.hasFloat,
        floatWire: form.floatWire,
        floatAccessoryType: form.floatAccessoryType,
        floatAccessoryDelta: 0,
        hasCable: form.hasCable,
        cableLength: form.cableLength,
        cableWire: form.cableWire,
        cableAccessoryType: form.cableAccessoryType,
        packingParts: selectionToRecipeParts(packingParts, true),
      });
      if (requestId !== bomDraftRequestRef.current) return draft;
      setBomDraft(draft);
      return draft;
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成 BOM 草稿失败';
      if (requestId === bomDraftRequestRef.current) {
        if (options.silent) setBomDraftError(message);
        else setFormError(message);
      }
      return null;
    } finally {
      if (requestId === bomDraftRequestRef.current) setBomDraftLoading(false);
    }
  }

  async function submitRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError('配方名称不能为空');
      return;
    }
    if (recipeSaveBlockedByWarnings) {
      setFormError('存在成本警告，请处理后再保存配方');
      scrollToCostWarningTarget();
      return;
    }
    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      const draft = await buildBomDraft();
      if (!draft) return;
      const costDraft = await previewRecipeCostDraft({
        parts: draft.parts,
        assemblyWage: numberValue(form.assemblyWage),
        packingWage: numberValue(form.packingWage),
        surfaceTreatmentMode: form.surfaceTreatmentMode,
        surfaceTreatmentCost: form.surfaceTreatmentMode === 'none' ? 0 : numberValue(form.surfaceTreatmentCost),
        managementFee: numberValue(form.managementFee),
        coilMaterial: form.coilMaterial || '钢带',
        customBarrelLength: (draft.customBarrelLength ?? form.customBarrelLength) || null,
        longScrewExtraLength: draft.longScrewExtraLength ?? numberValue(form.longScrewExtraLength),
      });

      const payload = await buildRecipeSavePayloadDraft({
        form: {
          name: form.name,
          spec: form.spec,
          templateId: form.templateId || null,
          coilSpec: form.coilSpec,
          coilSheets: form.coilSheets,
          coilMaterial: form.coilMaterial,
          coilWireWeight: form.coilWireWeight || null,
          hasFloat: form.hasFloat,
          floatWire: form.floatWire,
          floatAccessoryType: form.floatAccessoryType,
          hasCable: form.hasCable,
          cableLength: form.cableLength,
          cableWire: form.cableWire,
          cableAccessoryType: form.cableAccessoryType,
          customBarrelLength: hasStainlessBarrel ? form.customBarrelLength || null : null,
          modelVariantId: form.variantId || null,
          impellerModel: form.impellerModel,
          impellerThickness: form.impellerThickness || null,
          impellerDiameter: form.impellerDiameter || null,
          impellerBladeCount: form.impellerBladeCount || null,
          assemblyWage: form.assemblyWage,
          packingWage: form.packingWage,
          surfaceTreatmentMode: form.surfaceTreatmentMode,
          surfaceTreatmentCost: form.surfaceTreatmentCost,
          managementFee: form.managementFee,
        },
        costDraft,
        packingParts,
        optionalParts,
        technicalData: form.technicalData,
      });

      if (editingRecipe) await updateRecipe(editingRecipe.id, payload);
      else await createRecipe(payload);
      await load(true);
      setDrawerOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '配方保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeRecipe(recipe: Recipe) {
    if (!window.confirm(`确定删除配方「${recipe.name || recipe.id}」？`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteRecipe(recipe.id);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '配方删除失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <FadePanel className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Recipes</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">配方</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            选择泵壳、线圈转子和选配后直接生成 BOM 与成本；泵壳模板只维护稳定的固定搭配。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => void load(true)}
            disabled={refreshing || saving}
            icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}
          >
            刷新
          </Button>
          {activeSection === 'variants' ? (
            <Button variant="primary" onClick={openCreateVariant} disabled={saving} icon={<Plus size={15} />}>
              新建配置
            </Button>
          ) : activeSection === 'templates' ? (
            <Button variant="primary" onClick={openCreateTemplate} disabled={saving} icon={<Plus size={15} />}>
              新建模板
            </Button>
          ) : activeSection === 'recipes' ? (
            <Button variant="primary" onClick={openCreateDrawer} disabled={saving} icon={<Plus size={15} />}>
              新建配方
            </Button>
          ) : null}
        </div>
      </FadePanel>

      <FadePanel delay={0.01} className="flex flex-col gap-3 rounded-panel border border-line bg-white p-3 shadow-panel md:flex-row md:items-center md:justify-between">
        <SegmentedControl value={activeSection} options={sectionOptions} onChange={setActiveSection} ariaLabel="配方功能区" />
        <div className="text-xs text-muted">
          配方 {recipes.length} 个 / 泵壳模板 {templates.length} 套
        </div>
      </FadePanel>

      <div className="grid gap-3 md:grid-cols-4">
        <FadePanel delay={0.02}>
          <StatCard value={String(recipes.length)} label="配方数量" />
        </FadePanel>
        <FadePanel delay={0.04}>
          <StatCard value={money(stats.totalSavedCost)} label="保存成本合计" />
        </FadePanel>
        <FadePanel delay={0.06}>
          <StatCard value={String(stats.riskyCount)} label="铜价需关注" />
        </FadePanel>
        <FadePanel delay={0.08}>
          <StatCard value={String(stats.missingCostCount)} label="无保存成本" />
        </FadePanel>
      </div>

      {activeSection === 'recipes' ? (
      <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3">
            <Search size={16} className="text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索配方、规格、模板、线圈或零件"
              className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            {compareIds.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setCompareIds([])}>
                清空对比
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => setCompareOpen(true)}
              disabled={compareIds.length !== 2}
              icon={<GitCompare size={14} />}
            >
              对比 {compareIds.length}/2
            </Button>
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-muted" />
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                className="h-9 min-w-36 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 hover:bg-slate-50"
              >
                <option value="全部">全部模板</option>
                {templates.map((template) => (
                  <option key={template.id} value={String(template.id)}>{template.shellModel}</option>
                ))}
              </select>
            </div>
            <SegmentedControl value={quickFilter} options={quickFilters} onChange={setQuickFilter} ariaLabel="配方快速筛选" />
          </div>
        </div>

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] table-fixed border-separate border-spacing-0 text-left text-sm">
              <thead className="whitespace-nowrap bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-12 border-b border-line px-4 py-3">对比</th>
                  <th className="w-36 border-b border-line px-4 py-3">配方</th>
                  <th className="w-40 border-b border-line px-4 py-3">模板/线圈</th>
                  <th className="w-20 border-b border-line px-4 py-3 text-right">保存成本</th>
                  <th className="w-20 border-b border-line px-4 py-3 text-right">当日成本</th>
                  <th className="w-20 border-b border-line px-4 py-3 text-right" title="当日成本 - 保存成本">成本差额</th>
                  <th className="w-[72px] border-b border-line px-4 py-3 text-right">人工/管理</th>
                  <th className="w-24 border-b border-line px-4 py-3">铜价</th>
                  <th className="w-16 border-b border-line px-4 py-3">创建</th>
                  <th className="w-44 border-b border-line px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {filteredRows.map((row) => (
                    <PresenceRow key={row.recipe.id} className="transition-colors hover:bg-slate-50">
                      <td className="border-b border-line px-4 py-3">
                        <input
                          type="checkbox"
                          checked={compareIds.includes(row.recipe.id)}
                          onChange={() => toggleCompareRecipe(row.recipe.id)}
                          aria-label={`选择对比${row.recipe.name || row.recipe.id}`}
                          className="h-4 w-4 rounded border-line text-ink"
                        />
                      </td>
                      <td className="border-b border-line px-4 py-3">
                        <div className="font-medium text-ink">{row.recipe.name || '未命名配方'}</div>
                        <div className="mt-0.5 max-w-[260px] truncate text-xs text-muted">{row.recipe.spec || '-'}</div>
                      </td>
                      <td className="border-b border-line px-4 py-3">
                        <div className="text-ink">{row.templateName || '-'}</div>
                        <div className="mt-0.5 text-xs text-muted">
                          {[row.recipe.coilSpec, row.recipe.coilSheets, row.recipe.coilMaterial].filter(Boolean).join(' / ') || '无线圈快照'}
                        </div>
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-4 py-3 text-right font-medium text-ink">
                        {row.savedTotal ? money(row.savedTotal) : '-'}
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-4 py-3 text-right font-medium text-ink">
                        {row.currentCost ? money(row.currentCost.currentTotalCost) : '-'}
                      </td>
                      <td className={`whitespace-nowrap border-b border-line px-4 py-3 text-right font-medium ${
                        Number(row.currentCost?.difference || 0) > 0
                          ? 'text-rose-700'
                          : Number(row.currentCost?.difference || 0) < 0
                            ? 'text-emerald-700'
                            : 'text-muted'
                      }`}>
                        {signedMoney(row.currentCost?.difference)}
                      </td>
                      <td className="border-b border-line px-4 py-3 text-right text-muted">{money(row.laborTotal)}</td>
                      <td className="border-b border-line px-4 py-3 whitespace-nowrap">
                        <StatusBadge tone={copperRiskTone(row.copperRisk.level)}>{row.copperRisk.label}</StatusBadge>
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-4 py-3 text-muted">{dateShort(row.recipe.createdAt)}</td>
                      <td className="border-b border-line px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button className="w-8 px-0" size="sm" variant="ghost" aria-label={`查看${row.recipe.name || '配方'}详情`} title="查看详情" disabled={saving} onClick={() => openRecipeDetail(row.recipe)} icon={<Eye size={14} />} />
                          <Button className="w-8 px-0" size="sm" variant="ghost" aria-label={`编辑${row.recipe.name || '配方'}`} title="编辑" disabled={saving} onClick={() => openEditDrawer(row.recipe)} icon={<Pencil size={14} />} />
                          <Button className="w-8 px-0" size="sm" variant="ghost" aria-label={`复制${row.recipe.name || '配方'}`} title="复制" disabled={saving} onClick={() => openCloneRecipe(row.recipe)} icon={<Copy size={14} />} />
                          <Button className="w-8 px-0" size="sm" variant="danger" aria-label={`删除${row.recipe.name || '配方'}`} title="删除" disabled={saving} onClick={() => void removeRecipe(row.recipe)} icon={<Trash2 size={14} />} />
                        </div>
                      </td>
                    </PresenceRow>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </FadePanel>
      ) : null}

      {activeSection === 'templates' ? (
        <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
          <div className="flex items-center justify-between gap-3 border-b border-line p-4">
            <div>
              <div className="text-sm font-semibold text-ink">泵壳模板</div>
              <div className="mt-1 text-xs text-muted">模板决定泵壳固定配件、计价方式、安装/打包工资和表面处理，可在当前页面新建、编辑和删除。</div>
            </div>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{templates.length} 套</span>
          </div>
          {templates.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted">暂无泵壳模板</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                  <tr>
                    <th className="border-b border-line px-4 py-3">泵壳型号</th>
                    <th className="border-b border-line px-4 py-3">说明</th>
                    <th className="border-b border-line px-4 py-3">成本模式</th>
                    <th className="border-b border-line px-4 py-3 text-right">泵壳成本</th>
                    <th className="border-b border-line px-4 py-3 text-right">人工/表面处理</th>
                    <th className="border-b border-line px-4 py-3 text-right">固定配件</th>
                    <th className="border-b border-line px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {templateRows.map((row) => (
                    <tr key={row.template.id} className="transition-colors duration-150 hover:bg-slate-50">
                      <td className="border-b border-line px-4 py-3 font-medium text-ink">{row.template.shellModel || '-'}</td>
                      <td className="border-b border-line px-4 py-3 text-muted">{row.template.description || '-'}</td>
                      <td className="border-b border-line px-4 py-3">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                          {row.costMode === 'bundle' ? '泵壳套件' : '自由搭配'}
                        </span>
                      </td>
                      <td className="border-b border-line px-4 py-3 text-right font-medium text-ink">{money(row.shellCost)}</td>
                      <td className="border-b border-line px-4 py-3 text-right text-muted">
                        <div>{money(row.laborCost)}</div>
                        <div className="mt-0.5 text-xs">{surfaceTreatmentLabel(row.template.surfaceTreatmentMode)} · {money(row.template.surfaceTreatmentCost || 0)}</div>
                      </td>
                      <td className="border-b border-line px-4 py-3 text-right text-muted">{row.fixedParts.length}</td>
                      <td className="border-b border-line px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setTemplateDetail(row.template)} icon={<Eye size={14} />}>
                            明细
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openEditTemplate(row.template)} disabled={saving} icon={<Pencil size={14} />}>
                            编辑
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => void removeTemplate(row.template)} disabled={saving} icon={<Trash2 size={14} />}>
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </FadePanel>
      ) : null}

      {activeSection === 'variants' ? (
        <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
          <div className="flex flex-col gap-3 border-b border-line p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3">
              <Search size={16} className="text-muted" />
              <input
                value={variantQuery}
                onChange={(event) => setVariantQuery(event.target.value)}
                placeholder="搜索配置、线圈、叶轮、备注或自定义字段"
                className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-muted" />
              <select
                value={variantTemplateFilter}
                onChange={(event) => setVariantTemplateFilter(event.target.value)}
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
                          {variant.coilSpec ? `${variant.coilSpec} / ${variant.coilSheets || 0}片 / ${variant.coilMaterial || '钢带'}` : '-'}
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
                            <Button size="sm" variant="ghost" onClick={() => openCloneVariant(variant)} disabled={saving} icon={<Copy size={14} />}>
                              复用
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEditVariant(variant)} disabled={saving} icon={<Pencil size={14} />}>
                              编辑
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => void removeVariant(variant)} disabled={saving} icon={<Trash2 size={14} />}>
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

      <SlideOver open={Boolean(detailRecipe)} onClose={() => setDetailRecipe(null)} size="workspace">
        {detailRecipe ? (
          <div className="flex min-h-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-line p-5">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Recipe Detail</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{detailRecipe.name || '未命名配方'}</h2>
                <div className="mt-1 text-sm text-muted">{detailRecipe.spec || '无规格'}</div>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setDetailRecipe(null)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-5 p-5">
              <section className="grid gap-3 md:grid-cols-5">
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">保存成本</div>
                  <div className="mt-1 text-xl font-semibold text-ink">{detailSavedTotal ? money(detailSavedTotal) : '-'}</div>
                  <div className="mt-1 text-xs text-muted">保存 {detailSavedAt}</div>
                </div>
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">当前参考</div>
                  <div className="mt-1 text-xl font-semibold text-ink">{detailCurrentTotal != null ? money(detailCurrentTotal) : '-'}</div>
                  <div className="mt-1 text-xs text-muted">{detailCurrentCostLoading ? '读取中' : `读取 ${detailCurrentAt}`}</div>
                </div>
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">成本差额</div>
                  <div className={`mt-1 text-xl font-semibold ${Number(detailCostDiff || 0) > 0 ? 'text-rose-700' : Number(detailCostDiff || 0) < 0 ? 'text-emerald-700' : 'text-ink'}`}>
                    {detailCostDiff != null ? money(detailCostDiff) : '-'}
                  </div>
                  <div className="mt-1 text-xs text-muted">当前 - 保存</div>
                </div>
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">BOM 项数</div>
                  <div className="mt-1 text-xl font-semibold text-ink">{detailParts.length}</div>
                  <div className="mt-1 text-xs text-muted">{detailCurrentCost?.missingParts?.length ? `${detailCurrentCost.missingParts.length} 项缺当前价` : '当前价已匹配'}</div>
                </div>
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">泵壳模板</div>
                  <div className="mt-1 truncate text-xl font-semibold text-ink">
                    {detailRecipe.templateId ? templateNameMap.get(detailRecipe.templateId) || '-' : '-'}
                  </div>
                </div>
              </section>

              {detailCurrentCostError ? (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <CircleAlert size={16} />
                  {detailCurrentCostError}
                </div>
              ) : null}

              <section className="rounded-panel border border-line">
                <div className="border-b border-line p-4 text-sm font-semibold text-ink">关键参数</div>
                <div className="grid gap-3 p-4 text-sm md:grid-cols-2">
                  <div className="text-muted">线圈：<span className="text-ink">{[detailRecipe.coilSpec, detailRecipe.coilSheets ? `${detailRecipe.coilSheets}片` : '', detailRecipe.coilMaterial].filter(Boolean).join(' / ') || '-'}</span></div>
                  <div className="text-muted">机筒长度：<span className="text-ink">{detailRecipe.customBarrelLength ? `${detailRecipe.customBarrelLength} mm` : '-'}</span></div>
                  <div className="text-muted">叶轮：<span className="text-ink">{[detailRecipe.impellerModel, detailRecipe.impellerThickness ? `${detailRecipe.impellerThickness}厚` : '', detailRecipe.impellerDiameter ? `直径${detailRecipe.impellerDiameter}` : '', detailRecipe.impellerBladeCount ? `${detailRecipe.impellerBladeCount}片` : ''].filter(Boolean).join(' / ') || '-'}</span></div>
                  <div className="text-muted">动态配置：<span className="text-ink">{[detailRecipe.hasFloat ? `浮球 ${detailRecipe.floatWire || '-'}` : '', detailRecipe.hasCable ? `电缆 ${detailRecipe.cableWire || '-'} ${detailRecipe.cableLength || 0}m` : ''].filter(Boolean).join(' / ') || '-'}</span></div>
                </div>
              </section>

              {detailTechnicalEntries.length > 0 ? (
                <section className="rounded-panel border border-line">
                  <div className="border-b border-line p-4 text-sm font-semibold text-ink">技术参数</div>
                  <div className="grid gap-3 p-4 text-sm md:grid-cols-2">
                    {detailTechnicalEntries.map((entry) => (
                      <div key={entry.id} className="text-muted">
                        {entry.label || '参数'}：<span className="text-ink">{entry.value || '-'}</span>{entry.unit ? ` ${entry.unit}` : ''}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="rounded-panel border border-line">
                <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                  <div className="text-sm font-semibold text-ink">BOM 快照</div>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{detailParts.length} 项</span>
                </div>
                {detailParts.length === 0 ? (
                  <div className="p-5 text-sm text-muted">暂无 BOM 快照</div>
                ) : (
                  <div className="max-h-80 overflow-auto">
                    <table className="min-w-[1120px] border-separate border-spacing-0 text-left text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
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
                        {detailPartCompareRows.map((row, index) => {
                          const part = row.part;
                          return (
                            <tr key={`${part.model}-${part.supplier || ''}-${index}`} className="transition-colors duration-150 hover:bg-slate-50">
                              <td className="border-b border-line px-4 py-3 font-medium text-ink">{part.name || part.model || '-'}</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{part.model || '-'}</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{part.supplier || '-'}</td>
                              <td className="border-b border-line px-4 py-3 text-right text-muted">{row.qty || 1}</td>
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
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-panel border border-line">
                <div className="border-b border-line p-4">
                  <div className="text-sm font-semibold text-ink">生产扣库存</div>
                  <div className="mt-1 text-xs text-muted">预检和扣减都由后端执行，前端只展示结果。</div>
                </div>
                <div className="space-y-4 p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block">
                      <span className="text-xs font-medium text-muted">生产数量</span>
                      <input
                        value={produceQty}
                        onChange={(event) => setProduceQty(event.target.value)}
                        type="number"
                        min="1"
                        step="1"
                        className="mt-1 h-9 w-32 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                      />
                    </label>
                    <Button type="button" onClick={() => void refreshProductionCheck(detailRecipe)} disabled={productionLoading} icon={<RefreshCw size={14} className={productionLoading ? 'animate-spin' : ''} />}>
                      预检库存
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => void submitProduction()}
                      disabled={productionLoading || !productionDraft?.canProduce}
                      icon={<Play size={14} />}
                    >
                      确认生产
                    </Button>
                  </div>

                  {productionError ? (
                    <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{productionError}</div>
                  ) : null}
                  {productionSuccess ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{productionSuccess}</div>
                  ) : null}

                  {productionDraft ? (
                    <div className="overflow-x-auto rounded-md border border-line">
                      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                          <tr>
                            <th className="border-b border-line px-3 py-2">配件</th>
                            <th className="border-b border-line px-3 py-2 text-right">需用</th>
                            <th className="border-b border-line px-3 py-2 text-right">库存</th>
                            <th className="border-b border-line px-3 py-2">状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {productionDraft.checks.map((check, index) => (
                            <tr key={`${check.model}-${index}`} className={check.sufficient ? '' : 'bg-rose-50/60'}>
                              <td className="border-b border-line px-3 py-2">
                                <div className="font-medium text-ink">{check.name || check.model || '-'}</div>
                                <div className="text-xs text-muted">{check.model || '-'}{check.supplier ? ` / ${check.supplier}` : ''}</div>
                              </td>
                              <td className="border-b border-line px-3 py-2 text-right text-muted">{check.qtyNeeded}</td>
                              <td className="border-b border-line px-3 py-2 text-right text-muted">{check.partId ? check.currentStock : '未找到'}</td>
                              <td className="border-b border-line px-3 py-2">
                                <StatusBadge tone={check.sufficient ? 'green' : 'red'}>
                                  {check.partId ? (check.sufficient ? '充足' : `缺 ${check.qtyNeeded - check.currentStock}`) : '零件缺失'}
                                </StatusBadge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </SlideOver>

      <SlideOver open={compareOpen} onClose={() => setCompareOpen(false)}>
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
              onClick={() => setCompareOpen(false)}
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
                          ['线圈', [compareRecipes[0].coilSpec, compareRecipes[0].coilSheets ? `${compareRecipes[0].coilSheets}片` : '', compareRecipes[0].coilMaterial].filter(Boolean).join(' / ') || '-', [compareRecipes[1].coilSpec, compareRecipes[1].coilSheets ? `${compareRecipes[1].coilSheets}片` : '', compareRecipes[1].coilMaterial].filter(Boolean).join(' / ') || '-'],
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

      <SlideOver open={templateDrawerOpen} onClose={() => !saving && setTemplateDrawerOpen(false)} size="workspace">
        <form onSubmit={submitTemplate} className="flex min-h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Template</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
                {editingTemplate ? '编辑泵壳模板' : '新建泵壳模板'}
              </h2>
            </div>
            <button
              type="button"
              aria-label="关闭"
              disabled={saving}
              onClick={() => setTemplateDrawerOpen(false)}
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

            <section className="rounded-panel border border-line p-4">
              <div className="text-sm font-semibold text-ink">选择泵壳</div>
              <div className="mt-1 text-xs text-muted">模板必须对应零件库中“泵壳”分类下的一个型号。</div>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-ink">零件库泵壳型号</span>
                  <select
                    value={templateForm.shellModel}
                    onChange={(event) => selectTemplateShell(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    <option value="">请选择泵壳型号</option>
                    {templateForm.shellModel && !shellCatalogOptions.some((option) => option.model === templateForm.shellModel) ? (
                      <option value={templateForm.shellModel}>{templateForm.shellModel}（零件库中未找到）</option>
                    ) : null}
                    {shellCatalogOptions.map((option) => {
                      const hasTemplate = templates.some((template) => template.shellModel === option.model && template.id !== editingTemplate?.id);
                      const prices = option.rows.filter((part) => part.price > 0).map((part) => part.price);
                      const priceText = prices.length > 0 ? money(Math.min(...prices)) : '未定价';
                      return (
                        <option key={option.model} value={option.model} disabled={hasTemplate}>
                          {option.model} · {priceText}{hasTemplate ? ' · 已有模板' : ''}
                        </option>
                      );
                    })}
                  </select>
                  {shellCatalogOptions.length === 0 ? (
                    <span className="mt-2 block text-xs text-amber-700">零件库暂无泵壳，请先在零件页新增并选择“泵壳”分类。</span>
                  ) : null}
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-ink">说明</span>
                  <input
                    value={templateForm.description}
                    onChange={(event) => updateTemplateForm({ description: event.target.value })}
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>
              </div>
              {selectedTemplateShellParts.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-muted">
                  <span className="font-medium text-ink">零件库参考价格</span>
                  {selectedTemplateShellParts.map((part) => (
                    <span key={part.id}>{part.supplier || '未填写供应商'}：{money(part.price)}</span>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="rounded-panel border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">固定配件</div>
                  <div className="mt-1 text-xs text-muted">轴承、油封、螺丝等固定装配件，保存到 partsJson。</div>
                </div>
                <Button type="button" size="sm" onClick={addTemplatePartRow} icon={<Plus size={14} />}>添加配件</Button>
              </div>
              <div className="mt-3 space-y-2">
                {templateForm.partRows.map((row) => (
                  <div key={row.id} className="grid gap-2 lg:grid-cols-[minmax(130px,1fr)_minmax(180px,1.2fr)_minmax(120px,0.8fr)_96px_auto]">
                    <input value={row.name} onChange={(event) => updateTemplatePartRow(row.id, { name: event.target.value })} placeholder="名称" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                    <input value={row.model} onChange={(event) => updateTemplatePartRow(row.id, { model: event.target.value })} placeholder="型号" list="template-part-model-options" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                    <input value={row.supplier || ''} onChange={(event) => updateTemplatePartRow(row.id, { supplier: event.target.value })} placeholder="供应商" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                    <input value={String(row.qty)} onChange={(event) => updateTemplatePartRow(row.id, { qty: numberValue(event.target.value) })} type="number" min="0" step="0.01" placeholder="数量" className="h-9 min-w-[88px] rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                    <Button type="button" size="sm" variant="danger" onClick={() => removeTemplatePartRow(row.id)} icon={<Trash2 size={14} />}>删除</Button>
                  </div>
                ))}
              </div>
              <datalist id="template-part-model-options">
                {partModelOptions.map((model) => <option key={model} value={model} />)}
              </datalist>
            </section>

            <section className="rounded-panel border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">泵壳计价方式</div>
                  <div className="mt-1 text-xs text-muted">泵壳套件按整套价格计算；自由搭配按组件逐项汇总。</div>
                </div>
                <SegmentedControl
                  value={templateForm.costMode}
                  options={templateCostModeOptions}
                  onChange={selectTemplateCostMode}
                  ariaLabel="泵壳计价方式"
                />
              </div>
              {templateForm.costMode === 'bundle' ? (
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-ink">泵壳套件价格</span>
                    <input value={templateForm.bundleCost} onChange={(event) => updateTemplateForm({ bundleCost: event.target.value })} type="number" min="0" step="0.01" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                    <span className="mt-1 block text-xs text-muted">选择泵壳型号时默认带入零件库最低有效价格，可在模板中覆盖。</span>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-ink">备注</span>
                    <input
                      value={templateForm.bundleNote}
                      onChange={(event) => updateTemplateForm({ bundleNote: event.target.value })}
                      className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                      placeholder="填写套件计价或配置说明"
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <div className="flex justify-end">
                    <Button type="button" size="sm" onClick={addShellComponentRow} icon={<Plus size={14} />}>添加组件</Button>
                  </div>
                  {templateForm.componentRows.map((row) => (
                    <div key={row.id} className="grid gap-2 xl:grid-cols-[minmax(120px,1fr)_minmax(150px,1fr)_88px_100px_120px_82px_auto]">
                      <input value={row.name} onChange={(event) => updateShellComponentRow(row.id, { name: event.target.value })} placeholder="组件" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                      <input value={row.model || ''} onChange={(event) => updateShellComponentRow(row.id, { model: event.target.value })} placeholder="型号" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                      <input value={String(row.qty)} onChange={(event) => updateShellComponentRow(row.id, { qty: numberValue(event.target.value) })} type="number" min="0" step="0.01" placeholder="数量" className="h-9 min-w-[88px] rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                      <input value={String(row.unitCost)} onChange={(event) => updateShellComponentRow(row.id, { unitCost: numberValue(event.target.value) })} type="number" min="0" step="0.01" placeholder="单价" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                      <select value={row.pricingMode} onChange={(event) => updateShellComponentRow(row.id, { pricingMode: event.target.value as ShellComponentInput['pricingMode'] })} className="h-9 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400">
                        <option value="fixed">固定</option>
                        <option value="lengthCm">按长度</option>
                      </select>
                      <label className="flex h-9 items-center justify-center gap-1 rounded-md border border-line px-2 text-xs text-muted">
                        <input type="checkbox" checked={row.included !== false} onChange={(event) => updateShellComponentRow(row.id, { included: event.target.checked })} />
                        计入
                      </label>
                      <Button type="button" size="sm" variant="danger" onClick={() => removeShellComponentRow(row.id)} icon={<Trash2 size={14} />}>删除</Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-panel border border-line p-4">
              <div className="text-sm font-semibold text-ink">转子出图备用参数</div>
              <div className="mt-1 text-xs text-muted">选择该模板出图时自动带入；留空则继续读取泵壳零件默认参数。</div>
              <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                {templateRotorParamFields.map((field) => (
                  <label key={field.key} className="block">
                    <span className="text-xs font-medium text-muted">{field.label}</span>
                    <div className="mt-1 flex rounded-md border border-line bg-white focus-within:border-slate-400">
                      <input
                        value={templateForm.rotorParams[field.key]}
                        onChange={(event) => updateTemplateRotorParam(field.key, event.target.value)}
                        type={field.type === 'text' ? 'text' : 'number'}
                        min={field.type === 'text' ? undefined : '0'}
                        step={field.type === 'text' ? undefined : '0.1'}
                        className="h-9 min-w-0 flex-1 rounded-md border-0 px-3 text-sm text-ink outline-none"
                      />
                      {field.unit ? <span className="flex h-9 items-center border-l border-line bg-slate-50 px-2 text-xs text-muted">{field.unit}</span> : null}
                    </div>
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-panel border border-line p-4">
              <div className="text-sm font-semibold text-ink">人工与表面处理</div>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="block">
                  <span className="text-xs font-medium text-muted">安装工资</span>
                  <input value={templateForm.assemblyWage} onChange={(event) => updateTemplateForm({ assemblyWage: event.target.value })} type="number" min="0" step="0.01" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">打包工资</span>
                  <input value={templateForm.packingWage} onChange={(event) => updateTemplateForm({ packingWage: event.target.value })} type="number" min="0" step="0.01" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">表面处理</span>
                  <select
                    value={templateForm.surfaceTreatmentMode}
                    onChange={(event) => {
                      const surfaceTreatmentMode = event.target.value as SurfaceTreatmentMode;
                      updateTemplateForm({
                        surfaceTreatmentMode,
                        surfaceTreatmentCost: surfaceTreatmentMode === templateForm.surfaceTreatmentMode ? templateForm.surfaceTreatmentCost : '0',
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
                    value={templateForm.surfaceTreatmentCost}
                    onChange={(event) => updateTemplateForm({ surfaceTreatmentCost: event.target.value })}
                    disabled={templateForm.surfaceTreatmentMode === 'none'}
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:bg-slate-50 disabled:text-muted"
                  />
                </label>
              </div>
            </section>
          </div>

          <div className="flex justify-end gap-2 border-t border-line p-5">
            <Button type="button" variant="ghost" onClick={() => setTemplateDrawerOpen(false)} disabled={saving}>取消</Button>
            <Button type="submit" variant="primary" disabled={saving} icon={<Save size={15} />}>{saving ? '保存中' : '保存模板'}</Button>
          </div>
        </form>
      </SlideOver>

      {templateDetail ? (
        <SlideOver open={Boolean(templateDetail)} onClose={() => setTemplateDetail(null)}>
          <div className="flex min-h-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-line p-5">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Template</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{templateDetail.shellModel}</h2>
                <div className="mt-1 text-sm text-muted">{templateDetail.description || '无说明'}</div>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setTemplateDetail(null)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-5 p-5">
              <section className="rounded-panel border border-line">
                <div className="border-b border-line p-4 text-sm font-semibold text-ink">固定配件</div>
                <div className="divide-y divide-line">
                  {parseJsonArray<TemplatePartRow>(templateDetail.partsJson).length === 0 ? (
                    <div className="p-4 text-sm text-muted">暂无固定配件</div>
                  ) : parseJsonArray<TemplatePartRow>(templateDetail.partsJson).map((part, index) => (
                    <div key={`${part.name}-${index}`} className="grid gap-2 p-3 text-sm md:grid-cols-[1fr_1fr_1fr_auto]">
                      <span className="font-medium text-ink">{part.name || '-'}</span>
                      <span className="text-muted">{part.model || '-'}</span>
                      <span className="text-muted">{part.supplier || '-'}</span>
                      <span className="text-muted">x{part.qty || 1}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-panel border border-line">
                <div className="border-b border-line p-4 text-sm font-semibold text-ink">泵壳计价</div>
                <div className="divide-y divide-line">
                  {templateDetail.costMode === 'bundle' ? (
                    <div className="p-4 text-sm text-ink">
                      <div>泵壳套件价格：{money(templateDetail.bundleCost || 0)}</div>
                      <div className="mt-1 text-muted">备注：{templateDetail.bundleNote || '-'}</div>
                    </div>
                  ) : parseJsonArray<ShellComponentRow>(templateDetail.shellComponentsJson).length === 0 ? (
                    <div className="p-4 text-sm text-muted">暂无组件明细</div>
                  ) : parseJsonArray<ShellComponentRow>(templateDetail.shellComponentsJson).map((component, index) => (
                    <div key={`${component.name}-${index}`} className="grid gap-2 p-3 text-sm md:grid-cols-[1fr_1fr_auto_auto_auto]">
                      <span className="font-medium text-ink">{component.name || '-'}</span>
                      <span className="text-muted">{component.model || '-'}</span>
                      <span className="text-muted">x{component.qty || 1}</span>
                      <span className="text-muted">{money(component.unitCost || 0)}</span>
                      <span className="text-muted">{component.pricingMode === 'lengthCm' ? '按长度' : '固定'}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-panel border border-line p-4">
                <div className="text-sm font-semibold text-ink">表面处理</div>
                <div className="mt-2 text-sm text-muted">{surfaceTreatmentLabel(templateDetail.surfaceTreatmentMode)} · {money(templateDetail.surfaceTreatmentCost || 0)}</div>
              </section>
            </div>
          </div>
        </SlideOver>
      ) : null}

      <SlideOver open={variantDrawerOpen} onClose={() => !saving && setVariantDrawerOpen(false)}>
        <form onSubmit={submitVariant} className="flex min-h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Variant</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
                {editingVariant ? '编辑常用配置' : '新建常用配置'}
              </h2>
            </div>
            <button
              type="button"
              aria-label="关闭"
              disabled={saving}
              onClick={() => setVariantDrawerOpen(false)}
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
                  value={variantForm.modelName}
                  onChange={(event) => updateVariantForm({ modelName: event.target.value })}
                  className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  placeholder="例如：4QGD1.2-50-0.37"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">共用泵壳模板</span>
                <select
                  value={variantForm.templateId}
                  onChange={(event) => updateVariantForm({ templateId: event.target.value })}
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
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted">线圈规格</span>
                  <select
                    value={variantForm.coilSpec}
                    onChange={(event) => updateVariantForm({ coilSpec: event.target.value, coilSheets: '' })}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    <option value="">不预设</option>
                    {coilSpecs.map((spec) => <option key={spec.spec} value={spec.spec}>{spec.spec}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">材质</span>
                  <select
                    value={variantForm.coilMaterial}
                    onChange={(event) => updateVariantForm({ coilMaterial: event.target.value })}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    {variantMaterialOptions.map((material) => <option key={material} value={material}>{material}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">线圈片数</span>
                  <input
                    value={variantForm.coilSheets}
                    onChange={(event) => updateVariantForm({ coilSheets: event.target.value })}
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
                  <input value={variantForm.barrelLength} onChange={(event) => updateVariantForm({ barrelLength: event.target.value })} type="number" min="0" step="0.1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">长螺丝补偿 mm</span>
                  <input value={variantForm.longScrewExtraLength} onChange={(event) => updateVariantForm({ longScrewExtraLength: event.target.value })} type="number" step="0.1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">叶轮型号</span>
                  <input value={variantForm.impellerModel} onChange={(event) => updateVariantForm({ impellerModel: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">叶轮厚度</span>
                  <input value={variantForm.impellerThickness} onChange={(event) => updateVariantForm({ impellerThickness: event.target.value })} type="number" min="0" step="0.1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">叶轮直径</span>
                  <input value={variantForm.impellerDiameter} onChange={(event) => updateVariantForm({ impellerDiameter: event.target.value })} type="number" min="0" step="0.1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">叶片数</span>
                  <input value={variantForm.impellerBladeCount} onChange={(event) => updateVariantForm({ impellerBladeCount: event.target.value })} type="number" min="0" step="1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
              </div>
            </section>

            <section className="rounded-panel border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">备注与自定义字段</div>
                  <div className="mt-1 text-xs text-muted">用于保存客户或型号特有参数，配方和搜索都能读取。</div>
                </div>
                <Button type="button" size="sm" onClick={addVariantCustomField} icon={<Plus size={14} />}>
                  新增字段
                </Button>
              </div>
              <label className="mt-3 block">
                <span className="text-xs font-medium text-muted">备注</span>
                <input value={variantForm.note} onChange={(event) => updateVariantForm({ note: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <div className="mt-3 space-y-2">
                {variantForm.customFields.map((field) => (
                  <div key={field.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                    <input value={field.label} onChange={(event) => updateVariantCustomField(field.id, { label: event.target.value })} placeholder="字段名称" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                    <input value={field.value} onChange={(event) => updateVariantCustomField(field.id, { value: event.target.value })} placeholder="字段值" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                    <Button type="button" size="sm" variant="danger" onClick={() => removeVariantCustomField(field.id)} icon={<Trash2 size={14} />}>
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="flex justify-end gap-2 border-t border-line p-5">
            <Button type="button" variant="ghost" onClick={() => setVariantDrawerOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={saving} icon={<Save size={15} />}>
              {saving ? '保存中' : '保存配置'}
            </Button>
          </div>
        </form>
      </SlideOver>

      <SlideOver open={drawerOpen} onClose={() => !saving && setDrawerOpen(false)} size="workspace">
        <form onSubmit={submitRecipe} className="flex min-h-full flex-col bg-slate-50">
          <div className="border-b border-line bg-white">
            <div className="mx-auto flex max-w-7xl items-start justify-between gap-4 px-6 py-5">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Recipe Workspace</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                  {editingRecipe ? '编辑配方' : '新建配方'}
                </h2>
                <p className="mt-2 text-sm text-muted">配置产品型号、BOM 物料和加工费用，系统会自动生成成本预览。</p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                disabled={saving}
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1">
            <div className="mx-auto max-w-7xl px-6 py-6">
            {formError ? (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <CircleAlert size={16} />
                {formError}
              </div>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-4">
            <WorkspaceSection
              id="recipe-basic-section"
              title="1. 泵壳与产品"
              description="选择泵壳模板并填写产品名称；模板固定搭配会自动进入 BOM。"
              status={form.name.trim() && form.templateId ? 'complete' : 'warning'}
              badge={form.name.trim() && form.templateId ? '已完成' : '待完善'}
              badgeTone={form.name.trim() && form.templateId ? 'green' : 'amber'}
            >
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="block md:col-span-2">
                    <span className="text-xs font-medium text-muted">配方名称</span>
                    <input
                      value={form.name}
                      onChange={(event) => updateForm({ name: event.target.value })}
                      className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                      placeholder="例如：1500W 不锈钢泵"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-muted">规格</span>
                    <input
                      value={form.spec}
                      onChange={(event) => updateForm({ spec: event.target.value })}
                      className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                      placeholder="可选"
                    />
                  </label>
                </div>

                <div>
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-muted">泵壳模板</span>
                    <select
                      value={form.templateId}
                      onChange={(event) => void onTemplateChange(event.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                    >
                      <option value="">选择模板</option>
                      {templates.map((template) => (
                        <option key={template.id} value={String(template.id)}>{template.shellModel}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {hasStainlessBarrel ? (
                  <div className="grid items-end gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-medium text-muted">机筒长度 mm</span>
                      <input
                        value={form.customBarrelLength}
                        onChange={(event) => updateForm({ customBarrelLength: event.target.value })}
                        type="number"
                        min="0"
                        step="1"
                        className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                        placeholder="可选"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-muted">长螺丝补偿 mm</span>
                      <input
                        value={form.longScrewExtraLength}
                        onChange={(event) => updateForm({ longScrewExtraLength: event.target.value })}
                        type="number"
                        min="0"
                        step="1"
                        className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </WorkspaceSection>

            <div title="模板 / 型号零配件">
              <TemplateMatchSummary
                parts={relatedBomParts}
                total={relatedBomPartsCost}
                onOpenAll={() => setTemplateMatchDialogOpen(true)}
                getSubtotal={recipePartSubtotal}
                getSourceLabel={partCostSourceLabel}
              />
            </div>

            <WorkspaceSection
              title="2. 线圈转子"
              description="选择线圈规格和线重候选；客户指定线重可直接输入并由后端重算。"
              status={bomDraft?.coilSnapshot ? 'complete' : 'warning'}
              badge="自动计算"
              badgeTone="blue"
            >
              <div className="grid items-end gap-3 md:grid-cols-[1.2fr_0.55fr_0.7fr_0.85fr]">
                <label className="block">
                  <span className="text-xs font-medium text-muted">线圈规格</span>
                  <select
                    value={form.coilSpec}
                    onChange={(event) => updateForm({ coilSpec: event.target.value, coilSheets: '', coilWireWeight: '' })}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    <option value="">选择规格</option>
                    {coilSpecs.map((spec) => <option key={spec.spec} value={spec.spec}>{spec.spec}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">片数</span>
                  <input
                    value={form.coilSheets}
                    onChange={(event) => updateForm({ coilSheets: event.target.value })}
                    type="number"
                    min="0"
                    step="1"
                    className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">材质</span>
                  <select
                    value={form.coilMaterial}
                    onChange={(event) => updateForm({ coilMaterial: event.target.value, coilWireWeight: '' })}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    {formMaterialOptions.map((material) => <option key={material} value={material}>{material}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">线重 kg</span>
                  <input
                    value={form.coilWireWeight}
                    onChange={(event) => updateForm({ coilWireWeight: event.target.value })}
                    list="recipe-coil-wire-weight-options"
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="默认 / 客户指定"
                    className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>
                <datalist id="recipe-coil-wire-weight-options">
                  {coilWireWeightOptions.map((weight) => <option key={weight} value={weight} />)}
                </datalist>
                <CostResultCard
                  className="md:col-span-2"
                  label="线圈成本"
                  tone="blue"
                  badge="自动计算"
                  badgeTone="blue"
                  value={bomDraft?.coilSnapshot ? money(bomDraft.coilSnapshot.totalCost || 0) : '-'}
                  note={bomDraft?.coilSnapshot
                    ? `${bomDraft.coilSnapshot.source || '计算'}${bomDraft.coilSnapshot.wireWeight ? `，线重 ${bomDraft.coilSnapshot.wireWeight}kg` : ''}`
                    : '填写规格和片数后自动计算'}
                />
                <CostResultCard
                  label="计算过程"
                  tone="slate"
                  value={<span className="block break-all font-mono text-xs leading-5">{bomDraft?.coilSnapshot?.formula || '-'}</span>}
                />
                <CostResultCard
                  label="自动关联电容（自动电容）"
                  tone="green"
                  badge="系统推荐"
                  badgeTone="green"
                  value={<span className="text-sm">{bomDraft?.capacitorModel || '-'}</span>}
                  note={bomDraft?.coilSnapshot?.defaultCapacitor ? `线圈默认 ${bomDraft.coilSnapshot.defaultCapacitor}μF` : undefined}
                />
              </div>
            </WorkspaceSection>

            <WorkspaceSection
              title="3. 浮球与电缆"
              description="动态配置会进入 BOM 草稿，并实时影响成本预览。"
              status={(!form.hasFloat && !form.hasCable) || (!missingConfigHints.some((hint) => hint.includes('浮球') || hint.includes('电缆'))) ? 'default' : 'warning'}
              badge={!form.hasFloat && !form.hasCable ? '未启用' : '已配置'}
              badgeTone={!form.hasFloat && !form.hasCable ? 'gray' : 'green'}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-line p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={form.hasFloat}
                      onChange={(event) => updateForm({ hasFloat: event.target.checked })}
                      className="h-4 w-4 rounded border-line"
                    />
                    浮球
                  </label>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-medium text-muted">线径</span>
                      <input
                        value={form.floatWire}
                        onChange={(event) => updateForm({ floatWire: event.target.value })}
                        list="recipe-float-wire-options"
                        disabled={!form.hasFloat}
                        className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-muted">类型</span>
                      <select
                        value={form.floatAccessoryType}
                        onChange={(event) => updateForm({ floatAccessoryType: event.target.value as CableAccessoryType })}
                        disabled={!form.hasFloat}
                        className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
                      >
                        <option value="standard">普通</option>
                        <option value="xinjie">新界式</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="rounded-md border border-line p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={form.hasCable}
                      onChange={(event) => updateForm({ hasCable: event.target.checked })}
                      className="h-4 w-4 rounded border-line"
                    />
                    电缆
                  </label>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <label className="block">
                      <span className="text-xs font-medium text-muted">线径</span>
                      <input
                        value={form.cableWire}
                        onChange={(event) => updateForm({ cableWire: event.target.value })}
                        list="recipe-cable-wire-options"
                        disabled={!form.hasCable}
                        className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-muted">长度 m</span>
                      <input
                        value={form.cableLength}
                        onChange={(event) => updateForm({ cableLength: event.target.value })}
                        type="number"
                        min="0"
                        step="0.1"
                        disabled={!form.hasCable}
                        className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-muted">配件</span>
                      <select
                        value={form.cableAccessoryType}
                        onChange={(event) => updateForm({ cableAccessoryType: event.target.value as CableAccessoryType })}
                        disabled={!form.hasCable}
                        className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
                      >
                        <option value="standard">普通</option>
                        <option value="xinjie">新界式</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>
              <datalist id="recipe-float-wire-options">
                {floatWireOptions.map((wire) => <option key={wire} value={wire} />)}
              </datalist>
              <datalist id="recipe-cable-wire-options">
                {cableWireOptions.map((wire) => <option key={wire} value={wire} />)}
              </datalist>
            </WorkspaceSection>

            <WorkspaceSection
              id="recipe-optional-packing-section"
              title="4. 包装与其他配件"
              description="额外物料和包装项默认弱化，添加后会参与 BOM 和成本草稿。"
              summary={`${optionalParts.length + packingParts.length} 项，${money(optionalPartsCost + packingPartsCost)}`}
              status={packingParts.length > 0 ? 'complete' : 'warning'}
              badge={packingParts.length > 0 ? `${optionalParts.length + packingParts.length} 项` : '待完善'}
              badgeTone={packingParts.length > 0 ? 'green' : 'amber'}
              defaultOpen
              muted
              action={<Button type="button" size="sm" onClick={addOptionalPart} disabled={saving} icon={<Plus size={14} />}>添加选配件</Button>}
            >
              <div className="space-y-5">
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">选配件</div>
                      <div className="mt-1 text-xs text-slate-500">保存到 extraPartsJson，可添加电容、密封件、螺丝、铭牌等额外物料。</div>
                    </div>
                    <Button type="button" size="sm" onClick={addOptionalPart} disabled={saving} icon={<Plus size={14} />}>添加选配件</Button>
                  </div>
                  <RecipeDataTable
                    kind="optional"
                    rows={optionalParts}
                    disabled={saving}
                    modelListId="recipe-part-model-options"
                    emptyText="暂无选配件，可添加电容、密封件、螺丝、铭牌等额外物料"
                    onAdd={addOptionalPart}
                    onUpdate={updateOptionalPart}
                    onRemove={removeOptionalPart}
                    getAmount={(part) => recipePartSubtotal(findDraftPart(bomDraft, part))}
                    getCostLine={(part) => partCostLine(findDraftPart(bomDraft, part))}
                    getFormula={(part) => partFormulaLine(findDraftPart(bomDraft, part))}
                    formulaLabel="公式:"
                  />
                </div>

                <div className="border-t border-line pt-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">包装材料</div>
                      <div className="mt-1 text-xs text-slate-500">保存到 packingPartsJson，可添加纸箱、泡沫、说明书、标签等包装项。</div>
                    </div>
                    <Button type="button" size="sm" onClick={addPackingPart} disabled={saving} icon={<Plus size={14} />}>
                      添加包装
                    </Button>
                  </div>
                  <RecipeDataTable
                    kind="packing"
                    rows={packingParts}
                    disabled={saving}
                    modelListId="recipe-packing-model-options"
                    emptyText="暂无包装材料，可添加纸箱、泡沫、说明书、标签等包装项"
                    onAdd={addPackingPart}
                    onUpdate={updatePackingPart}
                    onRemove={removePackingPart}
                    getAmount={(part) => recipePartSubtotal(findDraftPart(bomDraft, part))}
                    getCostLine={(part) => partCostLine(findDraftPart(bomDraft, part))}
                    getFormula={(part) => partFormulaLine(findDraftPart(bomDraft, part))}
                    formulaLabel="公式:"
                  />
                </div>
              </div>
              <datalist id="recipe-part-model-options">
                {partModelOptions.map((model) => <option key={model} value={model} />)}
              </datalist>
              <datalist id="recipe-packing-model-options">
                {packingModelOptions.map((model) => <option key={model} value={model} />)}
              </datalist>
            </WorkspaceSection>

            <WorkspaceSection
              id="recipe-labor-section"
              title="5. 人工与费用"
              description="模板会带入默认人工，配方可覆盖。"
              summary={money(laborAndManagementCost + surfaceTreatmentPreviewCost)}
              status={laborCostComplete ? 'complete' : 'warning'}
              badge={laborCostComplete ? money(laborAndManagementCost + surfaceTreatmentPreviewCost) : '待完善'}
              badgeTone={laborCostComplete ? 'green' : 'amber'}
              defaultOpen={false}
              muted
            >
              {laborCostWarnings.length > 0 ? (
                <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <div className="font-semibold">以下费用可能漏算</div>
                  <div className="mt-1 space-y-1">
                    {laborCostWarnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-5">
                <label className="block">
                  <span className="text-sm font-medium text-ink">安装工资</span>
                  <input
                    value={form.assemblyWage}
                    onChange={(event) => updateForm({ assemblyWage: event.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-ink">打包工资</span>
                  <input
                    value={form.packingWage}
                    onChange={(event) => updateForm({ packingWage: event.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-ink">管理费</span>
                  <input
                    value={form.managementFee}
                    onChange={(event) => updateForm({ managementFee: event.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-ink">表面处理</span>
                  <select
                    value={form.surfaceTreatmentMode}
                    onChange={(event) => updateForm({ surfaceTreatmentMode: event.target.value as RecipeFormState['surfaceTreatmentMode'] })}
                    className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    <option value="none">无</option>
                    <option value="painting">喷漆</option>
                    <option value="electrophoresis">电泳</option>
                    <option value="electrophoresis_powder_coating">电泳+喷塑</option>
                    <option value="powder_coating">整体喷塑</option>
                    <option value="custom">自定义</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-ink">表面处理费用</span>
                  <input
                    value={form.surfaceTreatmentCost}
                    onChange={(event) => updateForm({ surfaceTreatmentCost: event.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={form.surfaceTreatmentMode === 'none'}
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
                  />
                </label>
              </div>
            </WorkspaceSection>

            <TechnicalDataEditor
              value={form.technicalData}
              onChange={(technicalData) => updateForm({ technicalData }, false)}
              referenceFields={technicalReferenceFields}
              impellerModel={form.impellerModel}
              impellerThickness={form.impellerThickness}
              impellerDiameter={form.impellerDiameter}
              impellerBladeCount={form.impellerBladeCount}
              onImpellerChange={(patch) => updateForm(patch)}
            />
              </div>

              <CostSummaryPanel
                bomCount={bomDraft?.parts.length || 0}
                loading={bomDraftLoading}
                saving={saving}
                total={liveTotal}
                coilCost={Number(bomDraft?.coilSnapshot?.totalCost || 0)}
                templatePartsCost={relatedBomPartsCost}
                optionalPartsCost={optionalPartsCost}
                packingPartsCost={packingPartsCost}
                laborAndManagementCost={laborAndManagementCost}
                surfaceTreatmentCost={surfaceTreatmentPreviewCost}
                missingConfigHints={missingConfigHints}
                costWarningHints={costWarningHints}
                completedItems={configurationStatus.completedItems}
                pendingItems={configurationStatus.pendingItems}
                completionPercent={configurationStatus.completionPercent}
                onRefresh={() => void buildBomDraft()}
                onOpenBom={() => setBomDetailsOpen(true)}
                onGoToCostWarnings={scrollToCostWarningTarget}
              />
            </div>
            </div>
          </div>

          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-white/80 p-5 backdrop-blur">
            <Button type="button" variant="ghost" onClick={() => setDrawerOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || recipeSaveBlockedByWarnings}
              title={recipeSaveBlockedByWarnings ? '存在成本警告，请处理后再保存配方' : undefined}
              icon={<Save size={15} />}
            >
              {saving ? '保存中' : recipeSaveBlockedByWarnings ? '处理警告后保存' : '保存配方'}
            </Button>
          </div>
        </form>
      </SlideOver>

      <BomTableDialog
        open={bomDetailsOpen}
        parts={bomDraft?.parts || []}
        total={liveTotal}
        onClose={() => setBomDetailsOpen(false)}
        getSubtotal={recipePartSubtotal}
        getSourceLabel={partCostSourceLabel}
        getFormula={partFormulaLine}
      />
      <BomTableDialog
        open={templateMatchDialogOpen}
        title="模板匹配明细"
        parts={relatedBomParts}
        total={relatedBomPartsCost}
        onClose={() => setTemplateMatchDialogOpen(false)}
        getSubtotal={recipePartSubtotal}
        getSourceLabel={partCostSourceLabel}
        getFormula={partFormulaLine}
      />
    </div>
  );
}
