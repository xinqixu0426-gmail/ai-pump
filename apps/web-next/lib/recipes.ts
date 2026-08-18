import type { ApiResponse } from './api';
import { proxyFetch, proxyRequest } from './api';

function createIdempotencyKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export type RecipePart = {
  model: string;
  name?: string;
  supplier?: string;
  qty?: number;
  snapshotPrice?: number;
  formula?: string;
  source?: string;
  costSource?: string;
  dynamicRule?: string;
  barrelLength?: number;
  longScrewExtraLength?: number;
  screwLength?: number;
  baseSnapshotPrice?: number;
  bundleBaseLength?: number;
  bundleStepMm?: number;
  bundleStepAmount?: number;
  barrelExtraCost?: number;
  packagingMaterial?: string;
  floatAccessoryType?: string;
  floatAccessoryDelta?: number;
  cableAccessoryType?: string;
  cableAssembly?: boolean;
  cableLength?: number;
  cableUnitPrice?: number;
  cableAccessoryName?: string;
  cableAccessoryFee?: number;
  inventoryQty?: number;
  inventoryUnit?: 'm';
  inventoryType?: string;
  cablePriceSource?: string;
  cableAccessorySource?: string;
  formulaVersion?: string;
  pricingComplete?: boolean;
  componentType?: 'standard' | 'stainlessStretchBarrel' | 'subassembly';
  subassemblyContents?: SubassemblyContentInput[];
  packingRole?: 'container' | 'foam' | 'pearlCotton' | 'fixed';
};

export type RecipeCurrentCostDetail = {
  name?: string;
  model?: string;
  supplier?: string;
  price?: string | number;
  qty?: string | number;
  subtotal?: string | number;
  source?: string;
};

export type RecipeCurrentCostResult = {
  recipeId: number;
  recipeName?: string;
  recipeSpec?: string;
  totalCost: number;
  itemCount: number;
  details: RecipeCurrentCostDetail[];
  missingParts: string[];
  fetchedAt: string;
};

export type RecipeCurrentTotalCost = {
  recipeId: number;
  currentTotalCost: number | null;
  savedTotalCost: number | null;
  difference: number | null;
  partsCost: number | null;
  partialPartsCost: number;
  partialTotalCost: number;
  laborCost: number;
  itemCount: number;
  missingParts: string[];
  costComplete: boolean;
  warnings: string[];
  fetchedAt?: string;
};

export type CableAccessoryType = 'standard' | 'xinjie';
export type SurfaceTreatmentMode = 'none' | 'painting' | 'electrophoresis' | 'electrophoresis_powder_coating' | 'powder_coating' | 'custom';

export type Recipe = {
  id: number;
  name: string;
  spec: string;
  partsJson: string;
  savedTotalCost?: number;
  savedCostDetails?: string;
  templateId?: number | null;
  coilSpec?: string;
  coilSheets?: number;
  coilMaterial?: string;
  coilSlotType?: '小眼' | '国标眼';
  coilWireWeight?: number | null;
  hasFloat?: number;
  floatWire?: string;
  floatAccessoryType?: CableAccessoryType;
  hasCable?: number;
  cableLength?: number;
  cableWire?: string;
  cableAccessoryType?: CableAccessoryType;
  boxType?: string;
  packingPartsJson?: string;
  extraPartsJson?: string;
  customBarrelLength?: number | null;
  longScrewExtraLength?: number;
  modelVariantId?: number | null;
  impellerModel?: string;
  impellerThickness?: number | null;
  impellerDiameter?: number | null;
  impellerBladeCount?: number | null;
  assemblyWage?: number;
  packingWage?: number;
  paintingWage?: number | null;
  surfaceTreatmentMode?: SurfaceTreatmentMode;
  surfaceTreatmentCost?: number;
  managementFee?: number;
  technicalDataJson?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PumpShellTemplate = {
  id: number;
  shellModel: string;
  description?: string;
  partsJson?: string;
  rotorParamsJson?: string;
  shellComponentsJson?: string;
  assemblyWage?: number;
  packingWage?: number;
  paintingWage?: number | null;
  surfaceTreatmentMode?: SurfaceTreatmentMode;
  surfaceTreatmentCost?: number;
  costMode?: string;
  bundleCost?: number;
  bundleNote?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TemplatePartInput = {
  name: string;
  model: string;
  qty: number;
  supplier?: string;
};

export type SubassemblyContentInput = {
  name: string;
  qty: number;
  referenceUnitPrice?: number | null;
  note?: string;
};

export type ShellComponentInput = {
  name: string;
  model?: string;
  supplier?: string;
  qty: number;
  unitCost: number;
  pricingMode: 'fixed' | 'lengthCm';
  included: boolean;
  optional?: boolean;
  componentType?: 'standard' | 'stainlessStretchBarrel' | 'subassembly';
  subassemblyContents?: SubassemblyContentInput[];
  note?: string;
};

export type PumpModelVariant = {
  id: number;
  modelName: string;
  templateId: number;
  coilSpec?: string;
  coilSheets?: number;
  coilMaterial?: string;
  coilSlotType?: '小眼' | '国标眼';
  barrelLength?: number | null;
  longScrewExtraLength?: number;
  impellerModel?: string;
  impellerThickness?: number | null;
  impellerDiameter?: number | null;
  impellerBladeCount?: number | null;
  note?: string;
  customFieldsJson?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CoilSpecOption = {
  spec: string;
  commonName?: string;
  diameterMm?: number;
  materials?: string[];
  slotTypes?: string[];
  variants?: Array<{ material: string; slotType: string; sheets: number[] }>;
};

export type RecipeBomDraftResult = {
  parts: RecipePart[];
  shellPrice: number;
  templateParts: RecipePart[];
  shellComponents: unknown[];
  coilSnapshot?: {
    totalCost: number;
    material?: string;
    unitPrice?: number;
    wireWeight?: number;
    wireGauge?: string;
    source?: string;
    formula?: string;
    defaultCapacitor?: string;
  } | null;
  capacitorModel: string;
  customBarrelLength?: number | null;
  longScrewExtraLength: number;
};

export type RecipeCostDraftResult = {
  parts: RecipePart[];
  partsCost: number;
  laborCost: number;
  savedTotalCost: number;
  savedCostDetails: string;
};

export type RecipeInventoryItem = {
  name: string;
  model: string;
  supplier?: string;
  currentStock: number;
  partId?: number;
  coilId?: number;
  inventoryType: 'part' | 'coil';
  status: 'in_stock' | 'out_of_stock' | 'missing';
};

export type RecipeInventoryStatusResult = {
  recipe: Recipe;
  items: RecipeInventoryItem[];
};

export type RecipeSelectionDraft = {
  model: string;
  supplier?: string;
  qty?: number | string;
  packagingMaterial?: string;
  packingRole?: 'container' | 'foam' | 'pearlCotton' | 'fixed';
  costSource?: '' | 'manual';
  snapshotPrice?: number | string;
};

export type RecipeModelVariantDraft = {
  name: string;
  spec: string;
  templateId: number;
  modelVariantId: number;
  coilSpec: string;
  coilSheets: number;
  coilMaterial: string;
  coilSlotType: '小眼' | '国标眼';
  coilWireWeight?: number | null;
  customBarrelLength: number | null;
  longScrewExtraLength: number;
  impellerModel: string;
  impellerThickness: number | null;
  impellerDiameter: number | null;
  impellerBladeCount: number | null;
  assemblyWage: number;
  packingWage: number;
  paintingWage: number | null;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: number;
};

export type RecipeModelVariantDraftResult = {
  recipeDraft: RecipeModelVariantDraft;
  variant: PumpModelVariant;
  template: PumpShellTemplate | null;
};

export type RecipeTemplateDraft = Pick<
  RecipeModelVariantDraft,
  'templateId' | 'assemblyWage' | 'packingWage' | 'paintingWage' | 'surfaceTreatmentMode' | 'surfaceTreatmentCost'
> & {
  name?: string;
  spec?: string;
  partsJson?: string;
};

export type RecipeTemplateDraftResult = {
  template: PumpShellTemplate;
  recipeDraft: RecipeTemplateDraft;
  parts: RecipePart[];
  rotorParams: Record<string, unknown>;
  cost?: unknown;
};

type RecipeRow = Partial<Recipe> & {
  Id?: number;
  CreatedAt?: string;
  UpdatedAt?: string;
};

type TemplateRow = Partial<PumpShellTemplate> & {
  Id?: number;
  CreatedAt?: string;
  UpdatedAt?: string;
};

type VariantRow = Partial<PumpModelVariant> & {
  Id?: number;
  CreatedAt?: string;
  UpdatedAt?: string;
};

export type RecipeCopperRiskLevel = 'none' | 'watch' | 'review' | 'critical' | 'missing';

export type RecipeCopperRisk = {
  label: string;
  detail: string;
  level: RecipeCopperRiskLevel;
  savedCopperPricePerKg?: number;
  currentCopperPricePerKg?: number;
  diffPerTon?: number;
};

export type RecipeDataset = {
  recipes: Recipe[];
  templates: PumpShellTemplate[];
  variants: PumpModelVariant[];
  currentCopperPricePerKg: number | null;
  currentCosts: RecipeCurrentTotalCost[];
};

function rowId(row: { id?: number; Id?: number }): number {
  return row.id ?? row.Id ?? 0;
}

export function rowToRecipe(row: RecipeRow): Recipe {
  return {
    id: rowId(row),
    name: row.name || '',
    spec: row.spec || '',
    partsJson: row.partsJson || '[]',
    savedTotalCost: Number(row.savedTotalCost) || 0,
    savedCostDetails: row.savedCostDetails || '',
    templateId: row.templateId ?? null,
    coilSpec: row.coilSpec || '',
    coilSheets: Number(row.coilSheets) || 0,
    coilMaterial: row.coilMaterial || '钢带',
    coilSlotType: row.coilSlotType === '国标眼' ? '国标眼' : '小眼',
    coilWireWeight: row.coilWireWeight == null ? null : Number(row.coilWireWeight),
    hasFloat: Number(row.hasFloat) || 0,
    floatWire: row.floatWire || '',
    floatAccessoryType: (row.floatAccessoryType as CableAccessoryType) || 'standard',
    hasCable: Number(row.hasCable) || 0,
    cableLength: Number(row.cableLength) || 0,
    cableWire: row.cableWire || '',
    cableAccessoryType: (row.cableAccessoryType as CableAccessoryType) || 'standard',
    boxType: row.boxType || '',
    packingPartsJson: row.packingPartsJson || '[]',
    extraPartsJson: row.extraPartsJson || '[]',
    customBarrelLength: row.customBarrelLength == null ? null : Number(row.customBarrelLength),
    longScrewExtraLength: Number(row.longScrewExtraLength) || 0,
    modelVariantId: row.modelVariantId ?? null,
    impellerModel: row.impellerModel || '',
    impellerThickness: row.impellerThickness == null ? null : Number(row.impellerThickness),
    impellerDiameter: row.impellerDiameter == null ? null : Number(row.impellerDiameter),
    impellerBladeCount: row.impellerBladeCount == null ? null : Number(row.impellerBladeCount),
    assemblyWage: Number(row.assemblyWage) || 0,
    packingWage: Number(row.packingWage) || 0,
    paintingWage: row.paintingWage == null ? null : Number(row.paintingWage) || 0,
    surfaceTreatmentMode: row.surfaceTreatmentMode || 'none',
    surfaceTreatmentCost: Number(row.surfaceTreatmentCost) || 0,
    managementFee: Number(row.managementFee) || 0,
    technicalDataJson: row.technicalDataJson || '{}',
    createdAt: row.createdAt || row.CreatedAt,
    updatedAt: row.updatedAt || row.UpdatedAt,
  };
}

export function rowToTemplate(row: TemplateRow): PumpShellTemplate {
  return {
    id: rowId(row),
    shellModel: row.shellModel || '',
    description: row.description || '',
    partsJson: row.partsJson || '[]',
    rotorParamsJson: row.rotorParamsJson || '{}',
    shellComponentsJson: row.shellComponentsJson || '[]',
    assemblyWage: Number(row.assemblyWage) || 0,
    packingWage: Number(row.packingWage) || 0,
    paintingWage: row.paintingWage == null ? null : Number(row.paintingWage) || 0,
    surfaceTreatmentMode: row.surfaceTreatmentMode || (row.paintingWage == null ? 'none' : 'painting'),
    surfaceTreatmentCost: Number(row.surfaceTreatmentCost ?? row.paintingWage) || 0,
    costMode: row.costMode || 'components',
    bundleCost: Number(row.bundleCost) || 0,
    bundleNote: row.bundleNote || '',
    createdAt: row.createdAt || row.CreatedAt,
    updatedAt: row.updatedAt || row.UpdatedAt,
  };
}

export function rowToVariant(row: VariantRow): PumpModelVariant {
  return {
    id: rowId(row),
    modelName: row.modelName || '',
    templateId: Number(row.templateId) || 0,
    coilSpec: row.coilSpec || '',
    coilSheets: Number(row.coilSheets) || 0,
    coilMaterial: row.coilMaterial || '钢带',
    coilSlotType: row.coilSlotType === '国标眼' ? '国标眼' : '小眼',
    barrelLength: row.barrelLength == null ? null : Number(row.barrelLength),
    longScrewExtraLength: Number(row.longScrewExtraLength) || 0,
    impellerModel: row.impellerModel || '',
    impellerThickness: row.impellerThickness == null ? null : Number(row.impellerThickness),
    impellerDiameter: row.impellerDiameter == null ? null : Number(row.impellerDiameter),
    impellerBladeCount: row.impellerBladeCount == null ? null : Number(row.impellerBladeCount),
    note: row.note || '',
    customFieldsJson: row.customFieldsJson || '[]',
    createdAt: row.createdAt || row.CreatedAt,
    updatedAt: row.updatedAt || row.UpdatedAt,
  };
}

export function parseRecipePartsJson(partsJson?: string): RecipePart[] {
  if (!partsJson) return [];
  try {
    const parsed = JSON.parse(partsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function validRecipeParts(parts: RecipePart[]): RecipePart[] {
  return parts.filter((part) => part && part.model);
}

export function recipePartsOverview(parts: RecipePart[]): string {
  return parts.length > 0
    ? parts.slice(0, 4).map((part) => `${part.model}x${part.qty ?? 1}`).join(', ')
    : '-';
}

function parseSavedCopperPricePerKg(parts: RecipePart[]): number | null {
  const coil = parts.find((part) => part?.name === '线圈转子' && part.formula);
  if (!coil?.formula) return null;
  const terms = coil.formula.split('+').map((term) => term.trim());
  const copperTerm = terms[1] || '';
  const match = copperTerm.match(/[x*×]\s*([\d.]+)/);
  const value = match ? Number.parseFloat(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function buildRecipeCopperRisk(parts: RecipePart[], currentCopperPricePerKg?: number | null): RecipeCopperRisk {
  const savedCopperPricePerKg = parseSavedCopperPricePerKg(parts);
  const current = Number(currentCopperPricePerKg);

  if (!savedCopperPricePerKg || !Number.isFinite(current) || current <= 0) {
    return { label: '无铜价快照', detail: '保存配方时没有可比铜价', level: 'missing' };
  }

  const diffPerTon = Math.round((current - savedCopperPricePerKg) * 1000);
  const absDiff = Math.abs(diffPerTon);
  const direction = diffPerTon >= 0 ? '上涨' : '下跌';

  if (absDiff >= 10000) {
    return { label: `铜价${direction} ¥${absDiff.toLocaleString('zh-CN')}/吨`, detail: '强提醒：建议重新核算成本', level: 'critical', savedCopperPricePerKg, currentCopperPricePerKg: current, diffPerTon };
  }
  if (absDiff >= 5000) {
    return { label: `铜价${direction} ¥${absDiff.toLocaleString('zh-CN')}/吨`, detail: '建议复核线圈成本', level: 'review', savedCopperPricePerKg, currentCopperPricePerKg: current, diffPerTon };
  }
  if (absDiff >= 3000) {
    return { label: `铜价${direction} ¥${absDiff.toLocaleString('zh-CN')}/吨`, detail: '关注铜价波动', level: 'watch', savedCopperPricePerKg, currentCopperPricePerKg: current, diffPerTon };
  }
  return { label: '铜价正常', detail: `波动 ¥${absDiff.toLocaleString('zh-CN')}/吨`, level: 'none', savedCopperPricePerKg, currentCopperPricePerKg: current, diffPerTon };
}

export function getRecipeLaborTotal(recipe: Recipe): number {
  const surfaceTreatmentCost = recipe.surfaceTreatmentCost ?? recipe.paintingWage ?? 0;
  let laborTotal =
    (recipe.assemblyWage || 0) +
    (recipe.packingWage || 0) +
    surfaceTreatmentCost +
    (recipe.managementFee || 0);

  if (laborTotal === 0 && recipe.savedCostDetails) {
    recipe.savedCostDetails.split('\n').forEach((line) => {
      if (line.includes('工资') || line.includes('费用')) {
        const match = line.match(/(.+?):\s*¥([\d.]+)/);
        if (match) laborTotal += Number.parseFloat(match[2]) || 0;
      }
    });
  }

  return laborTotal;
}

export function getRecipeSavedTotal(recipe: Recipe): number | null {
  const saved = Number(recipe.savedTotalCost);
  return Number.isFinite(saved) && saved > 0 ? saved : null;
}

export function recipeCopperRiskClassName(level: RecipeCopperRiskLevel): string {
  if (level === 'critical') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (level === 'review') return 'border-orange-200 bg-orange-50 text-orange-700';
  if (level === 'watch') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (level === 'missing') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

export function buildTemplateNameMap(templates: PumpShellTemplate[]): Map<number, string> {
  return new Map(templates.map((template) => [template.id, template.shellModel]));
}

export async function getAllRecipes(): Promise<Recipe[]> {
  const result = await proxyRequest<ApiResponse<RecipeRow[]>>('/api/recipes');
  if (!result.success) throw new Error(result.error || '配方加载失败');
  return (result.data || []).map(rowToRecipe);
}

export async function getAllTemplates(): Promise<PumpShellTemplate[]> {
  const result = await proxyRequest<ApiResponse<TemplateRow[]>>('/api/templates');
  if (!result.success) throw new Error(result.error || '泵壳模板加载失败');
  return (result.data || []).map(rowToTemplate);
}

export type TemplateInput = {
  shellModel: string;
  description?: string;
  partsJson: string;
  shellComponentsJson: string;
  rotorParamsJson?: string;
  assemblyWage: number;
  packingWage: number;
  paintingWage?: number | null;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: number;
  costMode: 'components' | 'bundle';
  bundleCost: number;
  bundleNote: string;
};

export async function createTemplate(input: TemplateInput): Promise<PumpShellTemplate> {
  const result = await proxyRequest<ApiResponse<TemplateRow>>('/api/templates', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey('template-create'),
    },
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '泵壳模板创建失败');
  return rowToTemplate(result.data);
}

export async function updateTemplate(template: PumpShellTemplate, input: TemplateInput): Promise<PumpShellTemplate> {
  if (!template.updatedAt) throw new Error('模板版本缺失，请刷新后再保存');
  const result = await proxyRequest<ApiResponse<TemplateRow>>(`/api/templates/${template.id}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`template-update:${template.id}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: template.updatedAt,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '泵壳模板保存失败');
  return rowToTemplate(result.data);
}

export async function deleteTemplate(template: PumpShellTemplate): Promise<void> {
  if (!template.updatedAt) throw new Error('模板版本缺失，请刷新后再删除');
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/templates/${template.id}`, {
    method: 'DELETE',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`template-delete:${template.id}`),
    },
    body: JSON.stringify({ expectedUpdatedAt: template.updatedAt }),
  });
  if (!result.success) throw new Error(result.error || '泵壳模板删除失败');
}

export async function getAllModelVariants(): Promise<PumpModelVariant[]> {
  const result = await proxyRequest<ApiResponse<VariantRow[]>>('/api/model-variants');
  if (!result.success) throw new Error(result.error || '型号变体加载失败');
  return (result.data || []).map(rowToVariant);
}

export async function getCoilSpecOptions(): Promise<CoilSpecOption[]> {
  const result = await proxyRequest<ApiResponse<CoilSpecOption[]>>('/api/coils/specs');
  if (!result.success) throw new Error(result.error || '线圈规格加载失败');
  return result.data || [];
}

export async function getCopperPrice(): Promise<number | null> {
  const result = await proxyRequest<ApiResponse<{ livePricePerKg?: string | number; dbPrice?: string | number | null }>>('/api/copper-price');
  if (!result.success || !result.data) return null;
  const dbPrice = Number(result.data.dbPrice || 0);
  const livePricePerKg = Number(result.data.livePricePerKg || 0);
  return dbPrice > 0 ? dbPrice : livePricePerKg > 0 ? livePricePerKg : null;
}

export async function getRecipeDataset(): Promise<RecipeDataset> {
  const [recipes, templates, variants, currentCopperPricePerKg, currentCosts] = await Promise.all([
    getAllRecipes(),
    getAllTemplates(),
    getAllModelVariants(),
    getCopperPrice().catch(() => null),
    getAllRecipeCurrentCosts(),
  ]);
  return { recipes, templates, variants, currentCopperPricePerKg, currentCosts };
}

export async function getAllRecipeCurrentCosts(): Promise<RecipeCurrentTotalCost[]> {
  const result = await proxyRequest<ApiResponse<{ asOf: string; items: RecipeCurrentTotalCost[] }>>('/api/recipes/current-costs');
  if (!result.success || !result.data) throw new Error(result.error || '配方当日成本计算失败');
  return (result.data.items || []).map((item) => ({
    ...item,
    recipeId: Number(item.recipeId),
    currentTotalCost: item.currentTotalCost == null ? null : Number(item.currentTotalCost),
    savedTotalCost: item.savedTotalCost == null ? null : Number(item.savedTotalCost),
    difference: item.difference == null ? null : Number(item.difference),
    partsCost: item.partsCost == null ? null : Number(item.partsCost),
    partialPartsCost: Number(item.partialPartsCost) || 0,
    partialTotalCost: Number(item.partialTotalCost) || 0,
    laborCost: Number(item.laborCost) || 0,
    itemCount: Number(item.itemCount) || 0,
    missingParts: Array.isArray(item.missingParts) ? item.missingParts : [],
    costComplete: item.costComplete !== false && !(item.missingParts || []).length && item.currentTotalCost != null,
    warnings: Array.isArray(item.warnings) ? item.warnings : [],
    fetchedAt: result.data?.asOf,
  }));
}

export async function previewRecipeBomDraft(input: {
  templateId?: number | null;
  modelVariantId?: number | null;
  customBarrelLength?: number | string | null;
  longScrewExtraLength?: number | string;
  coilSpec?: string;
  coilSheets?: number | string;
  coilMaterial?: string;
  coilSlotType?: '小眼' | '国标眼';
  coilWireWeight?: number | string | null;
  optionalParts?: RecipePart[];
  hasFloat?: boolean | number;
  floatWire?: string;
  floatAccessoryType?: CableAccessoryType;
  hasCable?: boolean | number;
  cableLength?: number | string;
  cableWire?: string;
  cableAccessoryType?: CableAccessoryType;
  packingParts?: RecipePart[];
}): Promise<RecipeBomDraftResult> {
  const result = await proxyRequest<ApiResponse<RecipeBomDraftResult>>('/api/recipes/bom-draft', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '生成配方 BOM 草稿失败');
  return result.data;
}

export async function applyModelVariantDraft(modelVariantId: number): Promise<RecipeModelVariantDraftResult> {
  const result = await proxyRequest<ApiResponse<RecipeModelVariantDraftResult>>('/api/recipes/model-variant-draft', {
    method: 'POST',
    body: JSON.stringify({ modelVariantId }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '应用常用配置失败');
  return {
    ...result.data,
    variant: rowToVariant(result.data.variant),
    template: result.data.template ? rowToTemplate(result.data.template) : null,
  };
}

export async function getTemplateRecipeDraft(templateId: number): Promise<RecipeTemplateDraftResult> {
  const result = await proxyRequest<ApiResponse<RecipeTemplateDraftResult>>(`/api/templates/${templateId}/default-recipe`);
  if (!result.success || !result.data) throw new Error(result.error || '应用泵壳模板失败');
  return {
    ...result.data,
    template: rowToTemplate(result.data.template),
  };
}

export async function previewRecipeCostDraft(input: {
  parts: RecipePart[];
  assemblyWage?: number;
  packingWage?: number;
  surfaceTreatmentMode?: string;
  surfaceTreatmentCost?: number;
  managementFee?: number;
  coilMaterial?: string;
  coilSlotType?: '小眼' | '国标眼';
  customBarrelLength?: number | string | null;
  longScrewExtraLength?: number | string;
  enableLongScrewByBarrelLength?: boolean;
}): Promise<RecipeCostDraftResult> {
  const result = await proxyRequest<ApiResponse<RecipeCostDraftResult>>('/api/recipes/cost-draft', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '生成配方成本快照失败');
  return result.data;
}

export async function getRecipeCurrentCost(recipeId: number): Promise<RecipeCurrentCostResult> {
  const result = await proxyRequest<ApiResponse<{
    recipeId?: number | string;
    recipeName?: string;
    recipeSpec?: string;
    totalCost?: string | number;
    itemCount?: number;
    details?: RecipeCurrentCostDetail[];
    missingParts?: string[];
  }>>(`/api/recipes/${recipeId}/cost`);
  if (!result.success || !result.data) throw new Error(result.error || '配方当前成本计算失败');
  return {
    recipeId,
    recipeName: result.data.recipeName,
    recipeSpec: result.data.recipeSpec,
    totalCost: Number(result.data.totalCost) || 0,
    itemCount: Number(result.data.itemCount) || 0,
    details: Array.isArray(result.data.details) ? result.data.details : [],
    missingParts: Array.isArray(result.data.missingParts) ? result.data.missingParts : [],
    fetchedAt: new Date().toISOString(),
  };
}

export async function getRecipeInventoryStatus(recipeId: number): Promise<RecipeInventoryStatusResult> {
  const result = await proxyRequest<ApiResponse<RecipeInventoryStatusResult>>(`/api/recipes/${recipeId}/inventory-status`);
  if (!result.success || !result.data) throw new Error(result.error || '库存状态读取失败');
  return {
    ...result.data,
    recipe: rowToRecipe(result.data.recipe),
  };
}

export type RecipeSaveInput = {
  name: string;
  spec: string;
  partsJson: string;
  savedTotalCost: number;
  savedCostDetails: string;
  templateId: number | null;
  coilSpec: string;
  coilSheets: number;
  coilMaterial: string;
  coilSlotType: '小眼' | '国标眼';
  hasFloat?: number;
  floatWire?: string;
  floatAccessoryType?: CableAccessoryType;
  hasCable?: number;
  cableLength?: number;
  cableWire?: string;
  cableAccessoryType?: CableAccessoryType;
  packingPartsJson?: string;
  extraPartsJson?: string;
  customBarrelLength?: number | null;
  longScrewExtraLength?: number;
  modelVariantId?: number | null;
  impellerModel?: string;
  impellerThickness?: number | null;
  impellerDiameter?: number | null;
  impellerBladeCount?: number | null;
  technicalDataJson?: string;
  assemblyWage: number;
  packingWage: number;
  paintingWage?: number | null;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: number;
  managementFee: number;
  capabilityId?: string;
  preview?: boolean;
  requiresConfirmation?: boolean;
  suggestedIdempotencyKey?: string;
  previewHash?: string;
  recipeId?: number;
  expectedUpdatedAt?: string;
  changes?: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
};

export type RecipeTechnicalFileSummary = {
  model?: string;
  testReportNo?: string;
  testDate?: string;
  testPointCount?: number;
};

export type RecipeTechnicalFile = {
  id: number;
  recipeId: number;
  originalName: string;
  mimeType: string;
  fileSize: number;
  fileSha256: string;
  reportType: string;
  summary: RecipeTechnicalFileSummary;
  createdAt?: string;
  updatedAt?: string;
};

export async function getRecipeTechnicalFiles(recipeId: number): Promise<RecipeTechnicalFile[]> {
  const result = await proxyRequest<ApiResponse<RecipeTechnicalFile[]>>(`/api/recipes/${recipeId}/technical-files`);
  if (!result.success) throw new Error(result.error || '测试报告加载失败');
  return result.data || [];
}

export async function uploadRecipeTechnicalFile(
  recipeId: number,
  file: File,
  expectedUpdatedAt?: string,
): Promise<RecipeTechnicalFile> {
  const body = new FormData();
  body.append('file', file);
  if (expectedUpdatedAt) body.append('expectedUpdatedAt', expectedUpdatedAt);
  const result = await proxyRequest<ApiResponse<RecipeTechnicalFile>>(`/api/recipes/${recipeId}/technical-files`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`recipe-technical-file-upload:${recipeId}`),
    },
    body,
  });
  if (!result.success || !result.data) throw new Error(result.error || '测试报告上传失败');
  return result.data;
}

export async function downloadRecipeTechnicalFile(recipeId: number, file: RecipeTechnicalFile): Promise<void> {
  const response = await proxyFetch(`/api/recipes/${recipeId}/technical-files/${file.id}/download`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.originalName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function deleteRecipeTechnicalFile(
  recipeId: number,
  fileId: number,
  expectedUpdatedAt?: string,
): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/recipes/${recipeId}/technical-files/${fileId}`, {
    method: 'DELETE',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`recipe-technical-file-delete:${fileId}`),
    },
    body: JSON.stringify({ expectedUpdatedAt }),
  });
  if (!result.success) throw new Error(result.error || '测试报告删除失败');
}

export type RecipeSavePayloadDraftInput = {
  recipeId?: number;
  expectedUpdatedAt?: string;
  form: {
    name: string;
    spec: string;
    templateId?: number | string | null;
    coilSpec?: string;
    coilSheets?: number | string;
    coilMaterial?: string;
    coilSlotType?: '小眼' | '国标眼';
    coilWireWeight?: number | string | null;
    hasFloat?: boolean;
    floatWire?: string;
    floatAccessoryType?: CableAccessoryType;
    hasCable?: boolean;
    cableLength?: number | string;
    cableWire?: string;
    cableAccessoryType?: CableAccessoryType;
    customBarrelLength?: number | string | null;
    longScrewExtraLength?: number | string;
    modelVariantId?: number | string | null;
    impellerModel?: string;
    impellerThickness?: number | string | null;
    impellerDiameter?: number | string | null;
    impellerBladeCount?: number | string | null;
    assemblyWage?: number | string;
    packingWage?: number | string;
    surfaceTreatmentMode?: SurfaceTreatmentMode;
    surfaceTreatmentCost?: number | string;
    managementFee?: number | string;
  };
  costDraft: RecipeCostDraftResult;
  packingParts?: RecipeSelectionDraft[];
  optionalParts?: RecipeSelectionDraft[];
  technicalData?: Record<string, unknown>;
};

export async function buildRecipeSavePayloadDraft(input: RecipeSavePayloadDraftInput): Promise<RecipeSaveInput> {
  const result = await proxyRequest<ApiResponse<RecipeSaveInput>>('/api/recipes/save-payload-draft', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '生成配方保存草稿失败');
  return result.data;
}

export async function createRecipe(input: RecipeSaveInput): Promise<Recipe> {
  const result = await proxyRequest<ApiResponse<RecipeRow>>('/api/recipes', {
    method: 'POST',
    headers: {
      'Idempotency-Key': input.suggestedIdempotencyKey || createIdempotencyKey('recipe-create'),
    },
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '配方创建失败');
  return rowToRecipe(result.data);
}

export async function updateRecipe(id: number, input: RecipeSaveInput): Promise<Recipe> {
  const result = await proxyRequest<ApiResponse<RecipeRow>>(`/api/recipes/${id}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': input.suggestedIdempotencyKey || createIdempotencyKey(`recipe-update:${id}`),
    },
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '配方保存失败');
  return rowToRecipe(result.data);
}

export async function deleteRecipe(id: number, expectedUpdatedAt?: string): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/recipes/${id}`, {
    method: 'DELETE',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`recipe-delete:${id}`),
    },
    body: JSON.stringify({ expectedUpdatedAt }),
  });
  if (!result.success) throw new Error(result.error || '配方删除失败');
}

export type ModelVariantInput = {
  modelName: string;
  templateId: number;
  coilSpec?: string;
  coilSheets?: number;
  coilMaterial?: string;
  coilSlotType?: '小眼' | '国标眼';
  barrelLength?: number | null;
  longScrewExtraLength?: number;
  impellerModel?: string;
  impellerThickness?: number | null;
  impellerDiameter?: number | null;
  impellerBladeCount?: number | null;
  note?: string;
  customFieldsJson?: string;
};

export async function createModelVariant(input: ModelVariantInput): Promise<PumpModelVariant> {
  const result = await proxyRequest<ApiResponse<VariantRow>>('/api/model-variants', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey('model-variant-create'),
    },
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '常用配置创建失败');
  return rowToVariant(result.data);
}

export async function updateModelVariant(variant: PumpModelVariant, input: ModelVariantInput): Promise<PumpModelVariant> {
  const result = await proxyRequest<ApiResponse<VariantRow>>(`/api/model-variants/${variant.id}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`model-variant-update:${variant.id}`),
    },
    body: JSON.stringify({ ...input, expectedUpdatedAt: variant.updatedAt }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '常用配置保存失败');
  return rowToVariant(result.data);
}

export async function deleteModelVariant(variant: PumpModelVariant): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/model-variants/${variant.id}`, {
    method: 'DELETE',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`model-variant-delete:${variant.id}`),
    },
    body: JSON.stringify({ expectedUpdatedAt: variant.updatedAt }),
  });
  if (!result.success) throw new Error(result.error || '常用配置删除失败');
}
