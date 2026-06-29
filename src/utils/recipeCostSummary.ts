import { PartSelection, RecipePart } from '../types';
import { CoilCostSnapshot } from './recipeBomBuilder';

type PriceGetter = (model: string, supplier: string) => number;

export interface RecipeCostSummaryInput {
  allPartsPreview: RecipePart[];
  templateCost: number;
  selectedTemplate: unknown | null;
  coilResult: CoilCostSnapshot | null;
  optionalParts: Array<PartSelection & { id?: number }>;
  capacitorModel: string;
  configParts: RecipePart[];
  packingParts: Array<PartSelection & { id?: number }>;
  laborCost: number;
  getPriceByModelAndSupplier: PriceGetter;
}

export interface RecipeCostSummary {
  templateCost: number;
  showTemplateCost: boolean;
  coilCost: number;
  optionAndCapacitorCost: number;
  configCost: number;
  packingCost: number;
  laborCost: number;
  partsCost: number;
  totalCost: number;
}

export function calculateRecipeCostSummary(input: RecipeCostSummaryInput): RecipeCostSummary {
  const partsCost = input.allPartsPreview.reduce((sum, part) => (
    sum + Number(part.snapshotPrice || 0) * Number(part.qty || 1)
  ), 0);
  const optionalCost = input.optionalParts.reduce((sum, part) => (
    part.model ? sum + input.getPriceByModelAndSupplier(part.model, part.supplier) * Number(part.qty || 1) : sum
  ), 0);
  const capacitorCost = input.capacitorModel ? input.getPriceByModelAndSupplier(input.capacitorModel, '') : 0;
  const configCost = input.configParts.reduce((sum, part) => (
    sum + Number(part.snapshotPrice || 0) * Number(part.qty || 1)
  ), 0);
  const packingCost = input.packingParts.reduce((sum, part) => {
    if (!part.model) return sum;
    const price = part.costSource === 'manual'
      ? Number(part.snapshotPrice || 0)
      : input.getPriceByModelAndSupplier(part.model, part.supplier);
    return sum + price;
  }, 0);

  return {
    templateCost: input.templateCost,
    showTemplateCost: Boolean(input.selectedTemplate),
    coilCost: input.coilResult?.totalCost || 0,
    optionAndCapacitorCost: optionalCost + capacitorCost,
    configCost,
    packingCost,
    laborCost: input.laborCost,
    partsCost,
    totalCost: partsCost + input.laborCost,
  };
}
