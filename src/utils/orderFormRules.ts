import { CostResult, Order, OrderItem, Recipe, RecipePart } from '../types';
import { createEmptyOrder, createOrderItem, HistoryPrice } from './orderStore';
import { roundMoney } from './businessRules';

function resourceId(entity: { id?: number; Id?: number }): number {
  return entity.id ?? entity['Id'] ?? 0;
}

type CostCalculator = (parts: RecipePart[]) => Promise<CostResult>;
type HistoryFinder = (recipeName: string) => Promise<HistoryPrice | null>;
type HistoryCache = Map<string, HistoryPrice | null>;

export type DraftOrderItem = OrderItem & { history?: HistoryPrice | null };

export function parseRecipeParts(partsJson: string): RecipePart[] {
  try {
    const parsed = JSON.parse(partsJson || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function resolveRecipeUnitCost(recipe: Recipe, calculateCost: CostCalculator): Promise<number> {
  const savedCost = Number(recipe.savedTotalCost || 0);
  if (savedCost > 0) return savedCost;

  const parts = parseRecipeParts(recipe.partsJson);
  if (parts.length === 0) return 0;
  try {
    const result = await calculateCost(parts);
    return Number.parseFloat(result.totalCost) || 0;
  } catch {
    return 0;
  }
}

export async function buildDraftOrderItem(input: {
  recipe: Recipe;
  qty: number;
  calculateCost: CostCalculator;
  findHistoryPrice: HistoryFinder;
  historyCache: HistoryCache;
}): Promise<DraftOrderItem> {
  const { recipe, calculateCost, findHistoryPrice, historyCache } = input;
  const qty = Math.max(1, Number(input.qty || 1));
  const unitCost = await resolveRecipeUnitCost(recipe, calculateCost);
  const recipeName = recipe.name;
  const item = createOrderItem(recipeName, recipe.partsJson, qty, unitCost, resourceId(recipe), recipe.spec);

  let history: HistoryPrice | null;
  if (historyCache.has(recipeName)) {
    history = historyCache.get(recipeName)!;
  } else {
    history = await findHistoryPrice(recipeName);
    historyCache.set(recipeName, history);
  }
  return { ...item, history };
}

export function removeDraftOrderItem(items: DraftOrderItem[], id: string): DraftOrderItem[] {
  return items.filter(item => item.id !== id);
}

export function updateDraftOrderItemQty(items: DraftOrderItem[], id: string, qty: number): DraftOrderItem[] {
  return items.map(item => (item.id === id ? { ...item, qty: Math.max(1, Number(qty || 1)) } : item));
}

export function updateDraftOrderItemMargin(items: DraftOrderItem[], id: string, margin: number): DraftOrderItem[] {
  return items.map(item => {
    if (item.id !== id) return item;
    const profitMargin = Math.max(0.01, Number(margin || 0));
    const unitPrice = roundMoney(item.unitCost * profitMargin);
    return { ...item, profitMargin, unitPrice };
  });
}

export function updateDraftOrderItemPrice(items: DraftOrderItem[], id: string, price: number): DraftOrderItem[] {
  return items.map(item => {
    if (item.id !== id) return item;
    const unitPrice = Math.max(0, Number(price || 0));
    const profitMargin = item.unitCost > 0 ? roundMoney(unitPrice / item.unitCost) : 1;
    return { ...item, unitPrice, profitMargin };
  });
}

export function buildOrderForSubmit(input: {
  customerName: string;
  contractNo: string;
  remark: string;
  editOrderId?: string | null;
  draftItems: DraftOrderItem[];
  orderTotals: { totalCost: number; totalPrice: number; totalProfit: number };
}): Order {
  const order = createEmptyOrder(
    input.customerName,
    input.remark || undefined,
    input.contractNo || undefined,
  );
  if (input.editOrderId) order.id = input.editOrderId;

  order.items = input.draftItems;
  order.totalCost = input.orderTotals.totalCost;
  order.totalPrice = input.orderTotals.totalPrice;
  order.totalProfit = input.orderTotals.totalProfit;
  return order;
}

export function canAdvanceOrderStep(activeStep: number, customerName: string, itemCount: number): boolean {
  if (activeStep === 0) return customerName.trim().length > 0;
  if (activeStep === 1) return itemCount > 0;
  return true;
}
