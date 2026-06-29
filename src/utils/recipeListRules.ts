import { CostResult, Recipe, RecipePart } from '../types';

export interface RecipeListData {
  overview: string;
  cost: string;
  costResult: CostResult;
}

export type RecipeCostCalculator = (parts: RecipePart[]) => Promise<CostResult>;

export function parseRecipePartsJson(partsJson?: string): RecipePart[] {
  try {
    const parsed = JSON.parse(partsJson || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function validRecipeParts(parts: RecipePart[]): RecipePart[] {
  return parts.filter(part => part && part.model);
}

export function recipePartsOverview(parts: RecipePart[]): string {
  return parts.length > 0
    ? parts.map(part => `${part.model}×${part.qty ?? 1}`).join(', ')
    : '-';
}

export function getRecipeLaborTotal(recipe: Recipe): number {
  const surfaceTreatmentCost = recipe.surfaceTreatmentCost ?? recipe.paintingWage ?? 0;
  let laborTotal =
    (recipe.assemblyWage || 0) +
    (recipe.packingWage || 0) +
    surfaceTreatmentCost +
    (recipe.managementFee || 0);

  if (laborTotal === 0 && recipe.savedCostDetails) {
    recipe.savedCostDetails.split('\n').forEach(line => {
      if (line.includes('工资') || line.includes('费用')) {
        const match = line.match(/(.+?):\s*¥([\d.]+)/);
        if (match) laborTotal += Number.parseFloat(match[2]) || 0;
      }
    });
  }

  return laborTotal;
}

export function getRecipeSavedTotal(recipe: Recipe): number | null {
  const saved = Number(recipe.savedTotalCost);
  return Number.isFinite(saved) && saved > 0 ? saved : null;
}

export function formatRecipeEntryTime(value?: string): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildRecipeListFallbackData(recipe: Recipe, validParts: RecipePart[]): RecipeListData {
  const fallbackCost = Number(recipe.savedTotalCost ?? 0);
  return {
    overview: recipePartsOverview(validParts),
    cost: `¥${fallbackCost.toFixed(2)}`,
    costResult: {
      totalCost: String(fallbackCost),
      snapshotTotalCost: fallbackCost.toFixed(2),
      itemCount: validParts.length,
      details: [],
      missingParts: [],
    },
  };
}

export async function buildRecipeListData(recipe: Recipe, calculateCost: RecipeCostCalculator): Promise<RecipeListData> {
  const validParts = validRecipeParts(parseRecipePartsJson(recipe.partsJson));
  const overview = recipePartsOverview(validParts);
  try {
    const costResult = await calculateCost(validParts);
    const costNum = Number.parseFloat(costResult.totalCost);
    const totalCost = getRecipeSavedTotal(recipe) ?? ((Number.isNaN(costNum) ? 0 : costNum) + getRecipeLaborTotal(recipe));
    return {
      overview,
      cost: `¥${totalCost.toFixed(2)}`,
      costResult: {
        ...costResult,
        snapshotTotalCost: getRecipeSavedTotal(recipe)?.toFixed(2),
      },
    };
  } catch {
    return buildRecipeListFallbackData(recipe, validParts);
  }
}
