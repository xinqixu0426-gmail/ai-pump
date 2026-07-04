import { CableAccessoryType, PartSelection } from '../types';
import { CoilCalcResult } from '../components/recipe/recipeFormConstants';
import { DEFAULT_COIL_MATERIAL, inferPackingMaterial } from './businessRules';

export interface RecipeBomDraftPayloadInput {
  selectedTemplateId: number | null;
  selectedModelVariantId: number | null;
  effectiveBarrelLength: string | number | null;
  effectiveLongScrewExtraLength: string | number;
  coilSpec: string;
  coilSheets: string;
  coilMaterial: string;
  coilResult: CoilCalcResult | null;
  capacitorModel: string;
  optionalParts: Array<PartSelection & { id?: number }>;
  hasFloat: boolean;
  floatWire: string;
  floatAccessoryType: CableAccessoryType;
  floatAccessoryDelta: number;
  hasCable: boolean;
  cableLength: string;
  cableWire: string;
  cableAccessoryType: CableAccessoryType;
  packingParts: Array<PartSelection & { id?: number }>;
}

export function shouldRequestRecipeBomDraft(input: Pick<RecipeBomDraftPayloadInput, 'selectedTemplateId' | 'optionalParts' | 'hasFloat' | 'hasCable' | 'packingParts'>): boolean {
  return !!input.selectedTemplateId
    || input.optionalParts.length > 0
    || input.hasFloat
    || input.hasCable
    || input.packingParts.length > 0;
}

export function buildRecipeBomDraftPayload(input: RecipeBomDraftPayloadInput) {
  return {
    templateId: input.selectedTemplateId,
    modelVariantId: input.selectedModelVariantId,
    customBarrelLength: input.effectiveBarrelLength,
    longScrewExtraLength: input.effectiveLongScrewExtraLength,
    coilSpec: input.coilSpec,
    coilSheets: input.coilSheets,
    coilMaterial: input.coilMaterial || DEFAULT_COIL_MATERIAL,
    coilResult: input.coilResult || undefined,
    capacitorModel: input.capacitorModel,
    optionalParts: input.optionalParts
      .filter(part => part.model)
      .map(part => ({
        model: part.model,
        supplier: part.supplier,
        qty: part.qty,
        ...(part.costSource === 'manual' ? { snapshotPrice: Number(part.snapshotPrice || 0), costSource: 'manual' } : {}),
      })),
    hasFloat: input.hasFloat,
    floatWire: input.floatWire,
    floatAccessoryType: input.floatAccessoryType,
    floatAccessoryDelta: input.floatAccessoryDelta,
    hasCable: input.hasCable,
    cableLength: input.cableLength,
    cableWire: input.cableWire,
    cableAccessoryType: input.cableAccessoryType,
    packingParts: input.packingParts
      .filter(part => part.model)
      .map(part => ({
        model: part.model,
        supplier: part.supplier,
        qty: part.qty,
        snapshotPrice: part.snapshotPrice,
        costSource: part.costSource,
        packagingMaterial: inferPackingMaterial(part.model || '', part.packagingMaterial),
      })),
  };
}
