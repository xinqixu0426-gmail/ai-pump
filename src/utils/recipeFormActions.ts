import { PartSelection, PumpModelVariant } from '../types';
import { DEFAULT_COIL_MATERIAL } from './businessRules';

export interface ImpellerFields {
  impellerModel: string;
  impellerThickness: string;
  impellerDiameter: string;
  impellerBladeCount: string;
}

export function emptyImpellerFields(): ImpellerFields {
  return {
    impellerModel: '',
    impellerThickness: '',
    impellerDiameter: '',
    impellerBladeCount: '',
  };
}

export function impellerFieldsFromVariant(variant: PumpModelVariant): ImpellerFields {
  return {
    impellerModel: variant.impellerModel || '',
    impellerThickness: variant.impellerThickness ? String(variant.impellerThickness) : '',
    impellerDiameter: variant.impellerDiameter ? String(variant.impellerDiameter) : '',
    impellerBladeCount: variant.impellerBladeCount ? String(variant.impellerBladeCount) : '',
  };
}

export function recipeFieldsFromVariant(variant: PumpModelVariant) {
  return {
    recipeName: variant.modelName,
    recipeSpec: variant.note || '',
    selectedTemplateId: variant.templateId,
    coilSpec: variant.coilSpec || '',
    coilMaterial: variant.coilMaterial || DEFAULT_COIL_MATERIAL,
    coilSheets: variant.coilSheets ? String(variant.coilSheets) : '',
    customBarrelLength: variant.barrelLength ? String(variant.barrelLength) : '',
    ...impellerFieldsFromVariant(variant),
  };
}

export function addOptionalPart<T extends PartSelection & { id: number }>(parts: T[], id: number): T[] {
  return [...parts, { id, model: '', supplier: '', qty: 1 } as T];
}

export function updateOptionalPart<T extends PartSelection & { id: number }>(
  parts: T[],
  id: number,
  field: keyof PartSelection,
  value: string | number
): T[] {
  return parts.map((part) => {
    if (part.id !== id) return part;
    const updated = { ...part, [field]: value };
    if (field === 'model') {
      updated.supplier = '';
      updated.snapshotPrice = undefined;
      updated.costSource = undefined;
    }
    if (field === 'supplier') {
      updated.snapshotPrice = undefined;
      updated.costSource = undefined;
    }
    return updated;
  });
}

export function removeOptionalPart<T extends PartSelection & { id: number }>(parts: T[], id: number): T[] {
  return parts.filter((part) => part.id !== id);
}
