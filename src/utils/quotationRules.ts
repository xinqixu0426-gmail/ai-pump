import { Customer, Part, PartSelection, QuotationItem, Recipe, RecipePart } from '../types';
import {
  DEFAULT_COIL_MATERIAL,
  DEFAULT_QUOTATION_MARGIN,
  inferPackingMaterial,
  partPriceByModelAndSupplier,
} from './businessRules';

export type PackingSnapshot = PartSelection & { snapshotPrice?: number };

export function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export function getRecipePartSnapshotPrice(recipe: Recipe | undefined, model: string, supplier = '') {
  const recipeParts = parseJsonArray<RecipePart>(recipe?.partsJson);
  const matched = recipeParts.find((part) => {
    const sameModel = part.model === model || part.name === model;
    const sameSupplier = !supplier || (part.supplier || '') === supplier;
    return sameModel && sameSupplier;
  });
  return matched?.snapshotPrice !== undefined ? Number(matched.snapshotPrice || 0) : undefined;
}

export function normalizePackingPart(recipe: Recipe | undefined, part: Partial<PackingSnapshot>) {
  const legacyName = (part as Partial<PackingSnapshot> & { name?: string })?.name;
  const model = part?.model || legacyName || '';
  const supplier = part?.supplier || '';
  const snapshotPrice = part?.snapshotPrice !== undefined
    ? Number(part.snapshotPrice || 0)
    : getRecipePartSnapshotPrice(recipe, model, supplier);
  return {
    model,
    supplier,
    qty: Number(part?.qty || 1),
    packagingMaterial: inferPackingMaterial(model, part?.packagingMaterial),
    ...(snapshotPrice !== undefined ? { snapshotPrice } : {}),
  };
}

export function getPackingParts(recipe: Recipe | undefined) {
  const parsed = parseJsonArray<PackingSnapshot>(recipe?.packingPartsJson);
  if (parsed.length > 0) {
    return parsed.map((part) => normalizePackingPart(recipe, part)).filter((part) => part.model);
  }
  return recipe?.boxType ? [normalizePackingPart(recipe, { model: recipe.boxType, supplier: '', qty: 1 })] : [];
}

export function getCoilSnapshot(recipe: Recipe | undefined) {
  const recipeParts = parseJsonArray<RecipePart>(recipe?.partsJson);
  const coil = recipeParts.find((part) => part.name === '线圈转子');
  return {
    spec: recipe?.coilSpec || coil?.model?.split('-')?.[0] || '',
    sheets: recipe?.coilSheets || coil?.model?.split('-')?.[1] || '',
    material: recipe?.coilMaterial || coil?.material || DEFAULT_COIL_MATERIAL,
    unitPrice: coil?.unitPrice,
    cost: coil?.snapshotPrice,
    source: coil?.source,
    formula: coil?.formula,
  };
}

export function createQuotationItem(customer?: Customer): QuotationItem {
  return {
    id: Date.now().toString(),
    baseRecipeId: '',
    baseRecipeName: '',
    qty: 1,
    overrides: {},
    unitCost: 0,
    margin: customer ? customer.defaultMargin : DEFAULT_QUOTATION_MARGIN,
    unitPrice: 0,
    totalPrice: 0,
  };
}

export function applyCustomerMargin(items: QuotationItem[], customer: Customer) {
  return items.map(item => recalculateQuotationItem({
    ...item,
    margin: customer.defaultMargin,
    unitPrice: item.unitCost * (1 + customer.defaultMargin),
  }));
}

export function recalculateQuotationItem(item: QuotationItem): QuotationItem {
  return {
    ...item,
    totalPrice: item.unitPrice * item.qty,
  };
}

export function applyQuotationItemCost(item: QuotationItem, unitCost: number): QuotationItem {
  const unitPrice = unitCost * (1 + item.margin);
  return recalculateQuotationItem({ ...item, unitCost, unitPrice });
}

export function applyQuotationItemMargin(item: QuotationItem, margin: number): QuotationItem {
  const unitPrice = item.unitCost * (1 + margin);
  return recalculateQuotationItem({ ...item, margin, unitPrice });
}

export function applyQuotationItemUnitPrice(item: QuotationItem, unitPrice: number): QuotationItem {
  const margin = item.unitCost > 0 ? (unitPrice / item.unitCost) - 1 : item.margin;
  return recalculateQuotationItem({ ...item, unitPrice, margin });
}

export function buildRecipeDefaultOverrides(recipe: Recipe) {
  return {
    hasFloat: recipe.hasFloat === 1,
    floatWire: recipe.floatWire,
    hasCable: recipe.hasCable === 1,
    cableLength: recipe.cableLength,
    cableWire: recipe.cableWire,
    cableAccessoryType: recipe.cableAccessoryType || 'standard',
    coilSpec: recipe.coilSpec || '',
    coilSheets: recipe.coilSheets || 0,
    coilMaterial: recipe.coilMaterial || DEFAULT_COIL_MATERIAL,
    boxType: recipe.boxType || '',
    packingPartsJson: JSON.stringify(getPackingParts(recipe)),
    customBarrelLength: recipe.customBarrelLength || undefined,
  };
}

export function packingSummary(item: QuotationItem, parts: Part[]) {
  let packingParts = parseJsonArray<PackingSnapshot>(item.overrides?.packingPartsJson);
  if (packingParts.length === 0 && item.overrides?.boxType) {
    packingParts = [{ model: item.overrides.boxType, supplier: '', qty: 1 }];
  }
  const total = packingParts.reduce((sum, part) => {
    const price = part.snapshotPrice !== undefined
      ? Number(part.snapshotPrice || 0)
      : partPriceByModelAndSupplier(parts, part.model, part.supplier || '');
    return sum + price * (part.qty || 1);
  }, 0);
  const source = packingParts.some(part => part.snapshotPrice !== undefined) ? '快照' : '零件库';
  return {
    parts: packingParts,
    total,
    source,
    label: packingParts.length > 0
      ? packingParts.map(part => `${part.model}/${inferPackingMaterial(part.model, part.packagingMaterial)}`).join('、')
      : '无包装配置',
  };
}

export function calculateQuotationTotals(items: QuotationItem[]) {
  return {
    totalCost: items.reduce((sum, item) => sum + (item.unitCost * item.qty), 0),
    totalPrice: items.reduce((sum, item) => sum + item.totalPrice, 0),
  };
}
