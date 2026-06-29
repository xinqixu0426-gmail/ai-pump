import { CableAccessoryType, PartSelection, Recipe, RecipePart, SurfaceTreatmentMode } from '../types';
import { RecipeTechnicalData } from '../components/recipe/StepTechnicalData';
import { DEFAULT_COIL_MATERIAL } from './businessRules';
import { previewRecipeCostDraft } from './api';
import { buildRecipePayload } from './recipePayload';

export interface PrepareRecipeSubmissionInput {
  recipeName: string;
  recipeSpec: string;
  recipeParts: RecipePart[];
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
  effectiveBarrelLength: string | number | null;
  effectiveLongScrewExtraLength: string | number;
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

export function buildRecipeCostDraftPayload(input: Pick<
  PrepareRecipeSubmissionInput,
  'recipeParts' | 'assemblyWage' | 'packingWage' | 'surfaceTreatmentMode' | 'surfaceTreatmentCost' | 'managementFee' | 'coilMaterial' | 'effectiveBarrelLength' | 'effectiveLongScrewExtraLength'
>) {
  return {
    parts: input.recipeParts,
    assemblyWage: input.assemblyWage,
    packingWage: input.packingWage,
    surfaceTreatmentMode: input.surfaceTreatmentMode,
    surfaceTreatmentCost: input.surfaceTreatmentMode === 'none' ? 0 : input.surfaceTreatmentCost,
    managementFee: input.managementFee,
    coilMaterial: input.coilMaterial || DEFAULT_COIL_MATERIAL,
    customBarrelLength: input.effectiveBarrelLength,
    longScrewExtraLength: input.effectiveLongScrewExtraLength,
  };
}

export async function prepareRecipeSubmission(input: PrepareRecipeSubmissionInput): Promise<Omit<Recipe, 'Id'>> {
  const costDraft = await previewRecipeCostDraft(buildRecipeCostDraftPayload(input));
  return buildRecipePayload({
    ...input,
    recipeParts: costDraft.parts,
    costDraft,
  });
}
