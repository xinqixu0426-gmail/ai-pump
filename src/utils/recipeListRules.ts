import { CostResult, Recipe, RecipePart } from '../types';

export interface RecipeListData {
  overview: string;
  cost: string;
  costResult: CostResult;
  copperRisk: RecipeCopperRisk;
}

export type RecipeCostCalculator = (parts: RecipePart[]) => Promise<CostResult>;

export type CopperRiskLevel = 'none' | 'watch' | 'review' | 'critical' | 'missing';

export interface RecipeCopperRisk {
  label: string;
  detail: string;
  level: CopperRiskLevel;
  savedCopperPricePerKg?: number;
  currentCopperPricePerKg?: number;
  diffPerTon?: number;
}

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

function parseSavedCopperPricePerKg(parts: RecipePart[]): number | null {
  const coil = parts.find(part => part?.name === '线圈转子' && part.formula);
  if (!coil?.formula) return null;

  const terms = coil.formula.split('+').map(term => term.trim());
  const copperTerm = terms[1] || '';
  const match = copperTerm.match(/[×x*]\s*([\d.]+)/);
  const value = match ? Number.parseFloat(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function buildRecipeCopperRisk(parts: RecipePart[], currentCopperPricePerKg?: number | null): RecipeCopperRisk {
  const savedCopperPricePerKg = parseSavedCopperPricePerKg(parts);
  const current = Number(currentCopperPricePerKg);

  if (!savedCopperPricePerKg || !Number.isFinite(current) || current <= 0) {
    return { label: '无铜价快照', detail: '保存配方时没有可比铜价', level: 'missing' };
  }

  const diffPerTon = Math.round((current - savedCopperPricePerKg) * 1000);
  const absDiff = Math.abs(diffPerTon);
  const direction = diffPerTon >= 0 ? '上涨' : '下跌';

  if (absDiff >= 10000) {
    return {
      label: `铜价${direction} ¥${absDiff.toLocaleString('zh-CN')}/吨`,
      detail: '强提醒：建议重新核算成本',
      level: 'critical',
      savedCopperPricePerKg,
      currentCopperPricePerKg: current,
      diffPerTon,
    };
  }

  if (absDiff >= 5000) {
    return {
      label: `铜价${direction} ¥${absDiff.toLocaleString('zh-CN')}/吨`,
      detail: '建议复核线圈成本',
      level: 'review',
      savedCopperPricePerKg,
      currentCopperPricePerKg: current,
      diffPerTon,
    };
  }

  if (absDiff >= 3000) {
    return {
      label: `铜价${direction} ¥${absDiff.toLocaleString('zh-CN')}/吨`,
      detail: '关注铜价波动',
      level: 'watch',
      savedCopperPricePerKg,
      currentCopperPricePerKg: current,
      diffPerTon,
    };
  }

  return {
    label: '铜价正常',
    detail: `波动 ¥${absDiff.toLocaleString('zh-CN')}/吨`,
    level: 'none',
    savedCopperPricePerKg,
    currentCopperPricePerKg: current,
    diffPerTon,
  };
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
    copperRisk: buildRecipeCopperRisk(validParts),
    costResult: {
      totalCost: String(fallbackCost),
      snapshotTotalCost: fallbackCost.toFixed(2),
      itemCount: validParts.length,
      details: [],
      missingParts: [],
    },
  };
}

export async function buildRecipeListData(recipe: Recipe, calculateCost: RecipeCostCalculator, currentCopperPricePerKg?: number | null): Promise<RecipeListData> {
  const validParts = validRecipeParts(parseRecipePartsJson(recipe.partsJson));
  const overview = recipePartsOverview(validParts);
  const copperRisk = buildRecipeCopperRisk(validParts, currentCopperPricePerKg);
  try {
    const costResult = await calculateCost(validParts);
    const costNum = Number.parseFloat(costResult.totalCost);
    const totalCost = getRecipeSavedTotal(recipe) ?? ((Number.isNaN(costNum) ? 0 : costNum) + getRecipeLaborTotal(recipe));
    return {
      overview,
      cost: `¥${totalCost.toFixed(2)}`,
      copperRisk,
      costResult: {
        ...costResult,
        snapshotTotalCost: getRecipeSavedTotal(recipe)?.toFixed(2),
      },
    };
  } catch {
    return {
      ...buildRecipeListFallbackData(recipe, validParts),
      copperRisk,
    };
  }
}
