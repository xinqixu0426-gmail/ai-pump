import { Part, Recipe, RecipePart } from '../types';
import { parseRecipePartsJson } from './recipeListRules';

export interface StockCheck {
  name: string;
  model: string;
  supplier: string;
  qtyNeeded: number;
  currentStock: number;
  sufficient: boolean;
  partId?: number;
}

export interface StockDeduction {
  partId: number;
  deductQty: number;
}

export function buildRecipeStockChecks(recipe: Recipe, parts: Part[], produceQty: number): StockCheck[] {
  const qty = Math.max(1, Number(produceQty || 1));
  const recipeParts = parseRecipePartsJson(recipe.partsJson);

  return recipeParts.map((recipePart: RecipePart) => {
    const totalNeeded = Number(recipePart.qty || 0) * qty;
    const matchedPart = parts.find(part => part.model === recipePart.model && part.supplier === recipePart.supplier)
      || parts.find(part => part.model === recipePart.model);
    const currentStock = matchedPart ? Number(matchedPart.stock || 0) : 0;

    return {
      name: recipePart.name || recipePart.model,
      model: recipePart.model,
      supplier: recipePart.supplier,
      qtyNeeded: totalNeeded,
      currentStock,
      sufficient: currentStock >= totalNeeded,
      partId: matchedPart?.Id,
    };
  });
}

export function stockChecksAllSufficient(checks: StockCheck[]): boolean {
  return checks.every(check => check.sufficient);
}

export function stockChecksError(checks: StockCheck[]): string {
  const insufficient = checks.filter(check => !check.sufficient);
  if (insufficient.length > 0) {
    return `库存不足：${insufficient.map(check => `${check.name}(需${check.qtyNeeded}，仅${check.currentStock})`).join('、')}`;
  }

  const missingParts = checks.filter(check => !check.partId);
  if (missingParts.length > 0) {
    return `以下配件在零件表中不存在：${missingParts.map(check => check.name).join('、')}`;
  }

  return '';
}

export function stockDeductionsFromChecks(checks: StockCheck[]): StockDeduction[] {
  return checks
    .filter(check => check.partId)
    .map(check => ({ partId: check.partId!, deductQty: check.qtyNeeded }));
}
