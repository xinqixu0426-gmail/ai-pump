import type { ApiResponse } from './api';
import { proxyRequest } from './api';
import type { Part } from './parts';
import type { Recipe, SurfaceTreatmentMode } from './recipes';

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
  model?: string;
  supplier?: string;
  qty?: number;
  packagingMaterial?: string;
  packingRole?: RecipePackingRole;
  snapshotPrice?: number;
  costSource?: string;
};

export type RecipePackingOption = Required<Pick<RecipePackingPart, 'model' | 'supplier' | 'packagingMaterial' | 'packingRole'>> & {
  price: number;
};

export type RecipeConfigurationPreview = {
  unitCost: number;
  parts: Array<Record<string, unknown>>;
  costSnapshot: Record<string, unknown>;
  warnings: RecipeConfigurationWarning[];
};

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export function inferPackingMaterial(model: string): string {
  if (model.includes('木箱')) return '木箱';
  if (model.includes('彩印') || model.includes('彩箱')) return '彩印箱';
  if (model.includes('牛皮') || model.includes('纸箱')) return '牛皮纸箱';
  if (model.includes('泡沫')) return '泡沫';
  if (model.includes('珍珠棉')) return '珍珠棉';
  if (model.includes('商标') || model.includes('贴纸')) return '商标';
  if (model.includes('说明书')) return '说明书';
  if (model.includes('包装')) return '纸箱';
  return '其他包材';
}

export function packingMaterialForPart(part: RecipePackingPart): string {
  const identity = `${part.model || ''} ${part.supplier || ''}`;
  return part.packagingMaterial || inferPackingMaterial(identity);
}

export function inferPackingRole(part: RecipePackingPart): RecipePackingRole {
  if (part.packingRole) return part.packingRole;
  const identity = `${part.model || ''} ${part.packagingMaterial || ''}`;
  if (identity.includes('珍珠棉')) return 'pearlCotton';
  if (identity.includes('泡沫')) return 'foam';
  if (identity.includes('说明书') || identity.includes('贴纸') || identity.includes('商标')) return 'fixed';
  if (identity.includes('木箱') || identity.includes('纸箱') || identity.includes('外包装')) return 'container';
  return 'fixed';
}

export function normalizePackingParts(value: unknown): RecipePackingPart[] {
  return parseJsonArray<RecipePackingPart>(value)
    .filter(part => part?.model)
    .map(part => {
      const packagingMaterial = packingMaterialForPart(part);
      return {
        ...part,
        supplier: part.supplier || '',
        qty: Number(part.qty || 1),
        packagingMaterial,
        packingRole: inferPackingRole({ ...part, packagingMaterial }),
      };
    });
}

export function packingOptionKey(option: Pick<RecipePackingOption, 'model' | 'supplier' | 'packagingMaterial' | 'price'>): string {
  return `${option.model}||${option.supplier}||${option.packagingMaterial}||${option.price}`;
}

export function packingPartFromOption(option: RecipePackingOption): RecipePackingPart {
  return {
    model: option.model,
    supplier: option.supplier,
    qty: 1,
    packagingMaterial: option.packagingMaterial,
    packingRole: option.packingRole,
  };
}

export function buildPackingOptions(parts: Part[], recipes: Recipe[]): RecipePackingOption[] {
  const options = new Map<string, RecipePackingOption>();
  const addOption = (packing: RecipePackingPart, price = 0) => {
    const model = packing.model || '';
    if (!model) return;
    const packagingMaterial = packingMaterialForPart(packing);
    const option: RecipePackingOption = {
      model,
      supplier: packing.supplier || '',
      price: Number(price || 0),
      packagingMaterial,
      packingRole: inferPackingRole({ ...packing, packagingMaterial }),
    };
    options.set(packingOptionKey(option), option);
  };

  parts.forEach(part => {
    const model = part.model || '';
    const looksLikePacking = part.category === '包装'
      || model.includes('木箱')
      || model.includes('纸箱')
      || model.includes('泡沫')
      || model.includes('珍珠棉')
      || model.includes('包装');
    if (!looksLikePacking) return;
    addOption({
      model,
      supplier: part.supplier || '',
      packagingMaterial: inferPackingMaterial(`${model} ${part.notes || ''}`),
      packingRole: part.subcategory === '外包装'
        ? 'container'
        : part.subcategory === '固定包材'
          ? 'fixed'
          : undefined,
    }, Number(part.price || 0));
  });

  recipes.forEach(recipe => {
    normalizePackingParts(recipe.packingPartsJson).forEach(packing => {
      const catalogPrice = parts.find(part => (
        part.model === packing.model
        && (!packing.supplier || part.supplier === packing.supplier)
      ))?.price;
      addOption(packing, Number(packing.snapshotPrice ?? catalogPrice ?? 0));
    });
    if (recipe.boxType) {
      addOption({
        model: recipe.boxType,
        supplier: '',
        packagingMaterial: inferPackingMaterial(recipe.boxType),
        packingRole: 'container',
      });
    }
  });

  return Array.from(options.values()).sort((a, b) => (
    a.packingRole.localeCompare(b.packingRole)
    || a.packagingMaterial.localeCompare(b.packagingMaterial, 'zh-Hans-CN')
    || a.model.localeCompare(b.model, 'zh-Hans-CN')
  ));
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
  const nextParts = normalizePackingParts(overrides.packingPartsJson)
    .filter(part => inferPackingRole(part) !== role);
  if (option) nextParts.push(packingPartFromOption(option));
  const container = nextParts.find(part => inferPackingRole(part) === 'container');
  return {
    ...overrides,
    boxType: container?.model || '',
    packingPartsJson: JSON.stringify(nextParts),
  };
}

export function configurationSummary(configuration?: RecipeConfigurationOverrides | RecipeConfigurationSnapshot | null): string[] {
  if (!configuration) return [];
  const packing = normalizePackingParts(configuration.packingPartsJson);
  const container = packing.find(part => inferPackingRole(part) === 'container');
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
  const baseContainer = normalizePackingParts(base.packingPartsJson).find(part => inferPackingRole(part) === 'container')?.model || '';
  const nextContainer = normalizePackingParts(configuration.packingPartsJson).find(part => inferPackingRole(part) === 'container')?.model || '';
  if (baseContainer !== nextContainer) differences.push(`包装 ${baseContainer || '无'}→${nextContainer || '无'}`);
  return differences;
}
