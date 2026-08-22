import type { ApiResponse } from './api';
import { proxyRequest } from './api';
import type { Part } from './parts';
import type { Recipe, SurfaceTreatmentMode } from './recipes';
import {
  buildPackingOptionValues,
  findPackingOption as findPackingOptionValue,
  inferPackingMaterial as inferPackingMaterialValue,
  inferPackingSemantics,
  normalizePackingParts as normalizePackingPartsValue,
  resolvePackingPart as resolvePackingPartValue,
  updatePackingRoleValue,
} from './recipe-packing.cjs';

export type RecipeConfigurationOverrides = {
  hasFloat?: boolean;
  floatWire?: string;
  floatAccessoryType?: 'standard' | 'xinjie';
  hasCable?: boolean;
  cableLength?: number | string;
  cableWire?: string;
  cableAccessoryType?: 'standard' | 'xinjie';
  coilSpec?: string;
  coilSheets?: number | string;
  coilMaterial?: string;
  coilSlotType?: '小眼' | '国标眼';
  customBarrelLength?: number | string;
  boxType?: string;
  packingPartsJson?: string;
  surfaceTreatmentMode?: SurfaceTreatmentMode;
  surfaceTreatmentCost?: number | string;
};

export type RecipeConfigurationSnapshot = RecipeConfigurationOverrides & {
  hasFloat: boolean;
  hasCable: boolean;
  cableLength: number;
  coilSheets: number;
  customBarrelLength: number | null;
  packingPartsJson: string;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: number;
};

export type RecipeConfigurationWarning = {
  code: string;
  message: string;
};

export type RecipePackingRole = 'container' | 'foam' | 'pearlCotton' | 'fixed';

export type RecipePackingPart = {
  partId?: number;
  model?: string;
  supplier?: string;
  qty?: number;
  packagingMaterial?: string;
  packingRole?: RecipePackingRole;
  snapshotPrice?: number;
  costSource?: string;
};

export type RecipePackingOption = Required<Pick<RecipePackingPart, 'model' | 'supplier' | 'packagingMaterial' | 'packingRole'>> & {
  partId?: number;
  price: number;
};

export type RecipeConfigurationPreview = {
  unitCost: number;
  parts: Array<Record<string, unknown>>;
  costSnapshot: Record<string, unknown>;
  warnings: RecipeConfigurationWarning[];
  configurationPolicy?: Record<string, unknown> | null;
  configurationPolicyMode?: 'explicit' | 'legacy_open';
};

export function inferPackingMaterial(model: string): string {
  return inferPackingMaterialValue(model);
}

export function packingMaterialForPart(part: RecipePackingPart): string {
  return inferPackingSemantics(part).packagingMaterial;
}

export function inferPackingRole(part: RecipePackingPart): RecipePackingRole {
  return inferPackingSemantics(part).packingRole;
}

export function normalizePackingParts(value: unknown): RecipePackingPart[] {
  return normalizePackingPartsValue(value) as RecipePackingPart[];
}

export function resolvePackingPart(
  value: unknown,
  role: RecipePackingRole,
  boxType?: string,
): RecipePackingPart | undefined {
  return resolvePackingPartValue(value, role, boxType) as RecipePackingPart | undefined;
}

export function findPackingOption(
  options: RecipePackingOption[],
  packing?: RecipePackingPart | null,
): RecipePackingOption | undefined {
  return findPackingOptionValue(options, packing);
}

export function packingOptionKey(option: Pick<RecipePackingOption, 'partId' | 'model' | 'supplier' | 'packagingMaterial' | 'price'>): string {
  return `${option.partId || ''}||${option.model}||${option.supplier}||${option.packagingMaterial}||${option.price}`;
}

export function packingPartFromOption(option: RecipePackingOption): RecipePackingPart {
  return {
    ...(option.partId ? { partId: option.partId } : {}),
    model: option.model,
    supplier: option.supplier,
    qty: 1,
    packagingMaterial: option.packagingMaterial,
    packingRole: option.packingRole,
  };
}

export function buildPackingOptions(parts: Part[], recipes: Recipe[]): RecipePackingOption[] {
  return buildPackingOptionValues(parts, recipes) as RecipePackingOption[];
}

export function buildRecipeDefaultConfiguration(recipe: Recipe): RecipeConfigurationOverrides {
  return {
    hasFloat: Number(recipe.hasFloat || 0) === 1,
    floatWire: recipe.floatWire || '',
    floatAccessoryType: recipe.floatAccessoryType || 'standard',
    hasCable: Number(recipe.hasCable || 0) === 1,
    cableLength: recipe.cableLength || '',
    cableWire: recipe.cableWire || '',
    cableAccessoryType: recipe.cableAccessoryType || 'standard',
    coilSpec: recipe.coilSpec || '',
    coilSheets: recipe.coilSheets || '',
    coilMaterial: recipe.coilMaterial || '钢带',
    coilSlotType: recipe.coilSlotType || '小眼',
    customBarrelLength: recipe.customBarrelLength ?? '',
    boxType: recipe.boxType || '',
    packingPartsJson: recipe.packingPartsJson || '[]',
    surfaceTreatmentMode: recipe.surfaceTreatmentMode || 'none',
    surfaceTreatmentCost: recipe.surfaceTreatmentMode === 'none' ? 0 : Number(recipe.surfaceTreatmentCost || 0),
  };
}

export async function previewRecipeConfiguration(
  recipeId: number,
  overrides: RecipeConfigurationOverrides,
): Promise<RecipeConfigurationPreview> {
  const result = await proxyRequest<ApiResponse<RecipeConfigurationPreview>>(`/api/recipes/${recipeId}/cost-preview`, {
    method: 'POST',
    body: JSON.stringify({ overrides }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '配置成本重算失败');
  return {
    ...result.data,
    unitCost: Math.round((Number(result.data.unitCost) || 0) * 100) / 100,
    warnings: result.data.warnings || [],
  };
}

export function updatePackingRole(
  overrides: RecipeConfigurationOverrides,
  role: RecipePackingRole,
  option?: RecipePackingOption,
): RecipeConfigurationOverrides {
  return updatePackingRoleValue(overrides, role, option);
}

export function configurationSummary(configuration?: RecipeConfigurationOverrides | RecipeConfigurationSnapshot | null): string[] {
  if (!configuration) return [];
  const packing = normalizePackingParts(configuration.packingPartsJson);
  const container = resolvePackingPart(configuration.packingPartsJson, 'container', configuration.boxType);
  const extras = packing
    .filter(part => ['foam', 'pearlCotton'].includes(inferPackingRole(part)))
    .map(part => part.packagingMaterial || part.model)
    .filter(Boolean);
  return [
    `线圈 ${configuration.coilSpec || '-'}-${configuration.coilSheets || '-'}片`,
    configuration.hasCable ? `电缆 ${configuration.cableLength || 0}米` : '不带电缆',
    configuration.hasFloat ? '带浮球' : '不带浮球',
    `包装 ${container?.model || configuration.boxType || '未配置'}${extras.length ? ` + ${extras.join(' + ')}` : ''}`,
  ];
}

export function configurationDifferences(recipe: Recipe | undefined, configuration?: RecipeConfigurationOverrides | null): string[] {
  if (!recipe || !configuration) return [];
  const base = buildRecipeDefaultConfiguration(recipe);
  const differences: string[] = [];
  if (Boolean(base.hasFloat) !== Boolean(configuration.hasFloat)) differences.push(configuration.hasFloat ? '增加浮球' : '取消浮球');
  if (Number(base.cableLength || 0) !== Number(configuration.cableLength || 0)) {
    differences.push(`电缆 ${Number(base.cableLength || 0)}→${Number(configuration.cableLength || 0)}米`);
  }
  if (Number(base.coilSheets || 0) !== Number(configuration.coilSheets || 0)) {
    differences.push(`线圈 ${Number(base.coilSheets || 0)}→${Number(configuration.coilSheets || 0)}片`);
  }
  const baseContainer = resolvePackingPart(base.packingPartsJson, 'container', base.boxType)?.model || '';
  const nextContainer = resolvePackingPart(configuration.packingPartsJson, 'container', configuration.boxType)?.model || '';
  if (baseContainer !== nextContainer) differences.push(`包装 ${baseContainer || '无'}→${nextContainer || '无'}`);
  return differences;
}
