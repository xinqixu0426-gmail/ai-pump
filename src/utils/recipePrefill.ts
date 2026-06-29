import { CableAccessoryType, PartSelection, Recipe, RecipePart } from '../types';
import { inferPackingMaterial } from './businessRules';

export interface LegacyRecipePrefill {
  coilMaterial?: string;
  coilSpec?: string;
  coilSheets?: string;
  hasFloat?: boolean;
  floatWire?: string;
  floatAccessoryType?: CableAccessoryType;
  hasCable?: boolean;
  cableWire?: string;
  cableLength?: string;
  packingParts: PartSelection[];
  optionalParts: PartSelection[];
}

export function buildPackingSelectionsFromRecipe(source: Partial<Recipe>): PartSelection[] {
  let parsed: PartSelection[] = [];
  try {
    const value = JSON.parse(source.packingPartsJson || '[]');
    if (Array.isArray(value)) parsed = value;
  } catch {
    parsed = [];
  }
  if (parsed.length === 0 && source.boxType) {
    parsed = [{ model: source.boxType, supplier: '', qty: 1 }];
  }
  return parsed
    .filter(part => part?.model)
    .map(part => ({
      ...part,
      qty: 1,
      packagingMaterial: inferPackingMaterial(part.model, part.packagingMaterial),
    }));
}

export function buildOptionalSelectionsFromRecipe(source: Partial<Recipe>): PartSelection[] {
  try {
    const parsed = JSON.parse(source.extraPartsJson || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(part => part?.model)
      .map(part => ({
        model: part.model,
        supplier: part.supplier || '',
        qty: Number(part.qty || 1),
      }));
  } catch {
    return [];
  }
}

function wireInOptions(wire: string, options: string[]) {
  return options.includes(wire) ? wire : '';
}

export function parseLegacyRecipeParts(
  partsJson: string,
  floatWireOptions: string[],
  cableWireOptions: string[]
): LegacyRecipePrefill {
  const result: LegacyRecipePrefill = { packingParts: [], optionalParts: [] };
  let parts: RecipePart[] = [];
  try {
    const parsed = JSON.parse(partsJson || '[]');
    if (Array.isArray(parsed)) parts = parsed;
  } catch {
    return result;
  }

  parts.forEach(part => {
    if (part.name === '线圈转子') {
      if (part.material) result.coilMaterial = part.material;
      if (part.model && part.model.includes('-')) {
        const [spec, sheets] = part.model.split('-');
        result.coilSpec = spec.trim();
        result.coilSheets = sheets.trim();
      }
      return;
    }
    if (part.name === '浮球' || part.name === '浮球-新界式' || part.name === '浮球-普通铜套') {
      result.hasFloat = true;
      const wire = part.model.replace('浮球-线径', '');
      const selectedWire = wireInOptions(wire, floatWireOptions);
      if (selectedWire) result.floatWire = selectedWire;
      if (part.floatAccessoryType) result.floatAccessoryType = part.floatAccessoryType;
      return;
    }
    if (part.name === '电缆线') {
      result.hasCable = true;
      const wire = part.model.replace('电缆-线径', '');
      const selectedWire = wireInOptions(wire, cableWireOptions);
      if (selectedWire) result.cableWire = selectedWire;
      result.cableLength = String(part.qty || '');
      return;
    }
    if (part.name === '电缆接头配件') return;
    if (part.name === '纸箱' || part.name === '木箱') {
      result.packingParts.push({
        model: part.model,
        supplier: '',
        qty: 1,
        packagingMaterial: inferPackingMaterial(part.model, part.packagingMaterial),
      });
      return;
    }
    result.optionalParts.push({
      model: part.model,
      supplier: part.supplier,
      qty: part.qty,
    });
  });

  return result;
}
