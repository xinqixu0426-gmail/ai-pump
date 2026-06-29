import { CableAccessoryType, DynamicCostOverrides, RecipePart } from '../types';
import { inferPackingMaterial, wireModel } from './businessRules';

type PriceGetter = (model: string, supplier?: string) => number;
type CableAccessoryFeeGetter = (model: string, supplier: string, accessoryType: CableAccessoryType) => number;
type CableAccessoryNameGetter = (model: string, supplier: string, accessoryType: CableAccessoryType) => string;

function isFloatPart(part: RecipePart): boolean {
  return part.model.startsWith('浮球-') || part.name.includes('浮球');
}

function isCablePart(part: RecipePart): boolean {
  return part.model.startsWith('电缆-') || part.model === '电缆配件费' || part.name.includes('电缆');
}

function isPackingPart(part: RecipePart): boolean {
  return !!part.packagingMaterial
    || part.name.includes('木箱')
    || part.name.includes('纸箱')
    || part.model.includes('木箱')
    || part.model.includes('纸箱');
}

function hasOverride(overrides: DynamicCostOverrides, key: keyof DynamicCostOverrides): boolean {
  return overrides[key] !== undefined;
}

export function buildOrderBomFromQuotation(input: {
  baseParts: RecipePart[];
  overrides: DynamicCostOverrides;
  getPrice: PriceGetter;
  getCableAccessoryFee: CableAccessoryFeeGetter;
  getCableAccessoryName: CableAccessoryNameGetter;
}): RecipePart[] {
  const { baseParts, overrides, getPrice, getCableAccessoryFee, getCableAccessoryName } = input;
  const shouldReplaceFloat = hasOverride(overrides, 'hasFloat') || hasOverride(overrides, 'floatWire') || hasOverride(overrides, 'floatAccessoryType');
  const shouldReplaceCable = hasOverride(overrides, 'hasCable') || hasOverride(overrides, 'cableLength') || hasOverride(overrides, 'cableWire') || hasOverride(overrides, 'cableAccessoryType');
  const shouldReplacePacking = hasOverride(overrides, 'packingPartsJson') || hasOverride(overrides, 'boxType');

  const parts = baseParts.filter(part => {
    if (shouldReplaceFloat && isFloatPart(part)) return false;
    if (shouldReplaceCable && isCablePart(part)) return false;
    if (shouldReplacePacking && isPackingPart(part)) return false;
    return true;
  });

  if (overrides.hasFloat) {
    const floatWire = String(overrides.floatWire || '');
    const model = wireModel('浮球', floatWire);
    const accessoryType = overrides.floatAccessoryType || 'standard';
    parts.push({
      model,
      name: accessoryType === 'xinjie' ? '浮球-新界式' : '浮球',
      supplier: '',
      qty: 1,
      snapshotPrice: getPrice(model, ''),
      floatAccessoryType: accessoryType,
    });
  }

  if (overrides.hasCable && Number(overrides.cableLength || 0) > 0) {
    const cableWire = String(overrides.cableWire || '');
    const model = wireModel('电缆', cableWire);
    const accessoryType = overrides.cableAccessoryType || 'standard';
    parts.push({
      model,
      name: '电缆线',
      supplier: '',
      qty: Number(overrides.cableLength || 0),
      snapshotPrice: getPrice(model, ''),
    });
    parts.push({
      model: '电缆配件费',
      name: getCableAccessoryName(model, '', accessoryType),
      supplier: '',
      qty: 1,
      snapshotPrice: getCableAccessoryFee(model, '', accessoryType),
      cableAccessoryType: accessoryType,
    });
  }

  let packingParts: Array<Partial<RecipePart>> = [];
  if (overrides.packingPartsJson) {
    try {
      const parsed = JSON.parse(overrides.packingPartsJson);
      packingParts = Array.isArray(parsed) ? parsed : [];
    } catch {
      packingParts = [];
    }
  } else if (overrides.boxType) {
    packingParts = [{ model: overrides.boxType, supplier: '', qty: 1 }];
  }

  packingParts.forEach(part => {
    const model = part.model || '';
    if (!model) return;
    const supplier = part.supplier || '';
    const packagingMaterial = inferPackingMaterial(model, part.packagingMaterial);
    parts.push({
      model,
      name: `${model}（${packagingMaterial}）`,
      supplier,
      qty: Number(part.qty || 1),
      snapshotPrice: part.snapshotPrice !== undefined ? Number(part.snapshotPrice || 0) : getPrice(model, supplier),
      packagingMaterial,
      ...(part.costSource === 'manual' ? { costSource: 'manual', source: 'manual' } : {}),
    });
  });

  return parts;
}
