import { PartSelection, Recipe, RecipeCostDraftResult, RecipePart, SurfaceTreatmentMode, CableAccessoryType } from '../types';
import { RecipeTechnicalData, stringifyTechnicalData } from '../components/recipe/StepTechnicalData';
import { DEFAULT_COIL_MATERIAL, inferPackingMaterial } from './businessRules';

export interface BuildRecipePayloadInput {
  recipeName: string;
  recipeSpec: string;
  recipeParts: RecipePart[];
  costDraft: RecipeCostDraftResult;
  selectedTemplateId: number | null;
  coilSpec: string;
  coilMaterial: string;
  coilSheets: string;
  hasFloat: boolean;
  floatWire: string;
  floatAccessoryType: CableAccessoryType;
  hasCable: boolean;
  cableLength: string;
  cableWire: string;
  cableAccessoryType: CableAccessoryType;
  packingParts: Array<PartSelection & { id?: number }>;
  customBarrelLength: string;
  selectedModelVariantId: number | null;
  impellerModel: string;
  impellerThickness: string;
  impellerDiameter: string;
  impellerBladeCount: string;
  technicalData: RecipeTechnicalData;
  optionalParts: Array<PartSelection & { id?: number }>;
  assemblyWage: number;
  packingWage: number;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: number;
  managementFee: number;
}

function numberOrNull(value: string): number | null {
  return value ? parseFloat(value) : null;
}

function intOrNull(value: string): number | null {
  return value ? parseInt(value) : null;
}

export function serializePackingParts(parts: Array<PartSelection & { id?: number }>): string {
  return JSON.stringify(
    parts.filter(part => part.model).map(part => ({
      model: part.model,
      supplier: part.supplier,
      qty: 1,
      packagingMaterial: inferPackingMaterial(part.model, part.packagingMaterial),
      ...(part.costSource === 'manual' ? { snapshotPrice: Number(part.snapshotPrice || 0), costSource: 'manual' } : {})
    }))
  );
}

export function serializeOptionalParts(parts: Array<PartSelection & { id?: number }>): string {
  return JSON.stringify(parts.filter(part => part.model).map(part => ({
    model: part.model,
    supplier: part.supplier,
    qty: part.qty,
    ...(part.costSource === 'manual' ? { snapshotPrice: Number(part.snapshotPrice || 0), costSource: 'manual' } : {}),
  })));
}

export function buildRecipePayload(input: BuildRecipePayloadInput): Omit<Recipe, 'Id'> {
  return {
    name: input.recipeName,
    spec: input.recipeSpec,
    partsJson: JSON.stringify(input.recipeParts),
    savedTotalCost: input.costDraft.savedTotalCost,
    savedCostDetails: input.costDraft.savedCostDetails,
    templateId: input.selectedTemplateId,
    coilSpec: input.coilSpec,
    coilMaterial: input.coilMaterial || DEFAULT_COIL_MATERIAL,
    coilSheets: input.coilSheets ? parseInt(input.coilSheets) : 0,
    hasFloat: input.hasFloat ? 1 : 0,
    floatWire: input.floatWire,
    floatAccessoryType: input.floatAccessoryType,
    hasCable: input.hasCable ? 1 : 0,
    cableLength: input.cableLength ? parseFloat(input.cableLength) : 0,
    cableWire: input.cableWire,
    cableAccessoryType: input.cableAccessoryType,
    packingPartsJson: serializePackingParts(input.packingParts),
    customBarrelLength: numberOrNull(input.customBarrelLength),
    modelVariantId: input.selectedModelVariantId,
    impellerModel: input.impellerModel,
    impellerThickness: numberOrNull(input.impellerThickness),
    impellerDiameter: numberOrNull(input.impellerDiameter),
    impellerBladeCount: intOrNull(input.impellerBladeCount),
    technicalDataJson: stringifyTechnicalData(input.technicalData),
    extraPartsJson: serializeOptionalParts(input.optionalParts),
    assemblyWage: input.assemblyWage,
    packingWage: input.packingWage,
    paintingWage: null,
    surfaceTreatmentMode: input.surfaceTreatmentMode,
    surfaceTreatmentCost: input.surfaceTreatmentMode === 'none' ? 0 : input.surfaceTreatmentCost,
    managementFee: input.managementFee,
  };
}
