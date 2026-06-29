import { Customer, Order, OrderItem, Quotation, QuotationItem, Recipe, RecipeCostDraftResult, RecipePart } from '../types';
import { DEFAULT_COIL_MATERIAL } from './businessRules';
import { buildOrderBomFromQuotation } from './quotationOrderBom';
import { parseJsonArray } from './quotationRules';

type PriceGetter = (model: string, supplier?: string) => number;
type CableAccessoryFeeGetter = (model: string, supplier: string, accessoryType: 'standard' | 'xinjie') => number;
type CableAccessoryNameGetter = (model: string, supplier: string, accessoryType: 'standard' | 'xinjie') => string;
type CostDraftPreviewer = (input: {
  parts: RecipePart[];
  customBarrelLength?: number | null;
  assemblyWage?: number;
  packingWage?: number;
  surfaceTreatmentMode?: string;
  surfaceTreatmentCost?: number;
  managementFee?: number;
  coilMaterial?: string;
}) => Promise<RecipeCostDraftResult>;
type EmptyOrderFactory = (customerName: string, remark?: string, contractNo?: string) => Order;

export async function buildOrderItemsFromQuotation(input: {
  quotationItems: QuotationItem[];
  recipes: Recipe[];
  getPrice: PriceGetter;
  getCableAccessoryFee: CableAccessoryFeeGetter;
  getCableAccessoryName: CableAccessoryNameGetter;
  previewRecipeCostDraft: CostDraftPreviewer;
}): Promise<OrderItem[]> {
  const { quotationItems, recipes, getPrice, getCableAccessoryFee, getCableAccessoryName, previewRecipeCostDraft } = input;
  return Promise.all(quotationItems.map(async (item) => {
    const recipe = recipes.find(r => r.Id === Number(item.baseRecipeId));
    const baseParts = buildOrderBomFromQuotation({
      baseParts: parseJsonArray<RecipePart>(recipe?.partsJson),
      overrides: item.overrides || {},
      getPrice,
      getCableAccessoryFee,
      getCableAccessoryName,
    });

    let partsJson = JSON.stringify(baseParts);
    if (baseParts.length > 0) {
      try {
        const draft = await previewRecipeCostDraft({
          parts: baseParts,
          customBarrelLength: item.overrides?.customBarrelLength ?? recipe?.customBarrelLength,
          assemblyWage: recipe?.assemblyWage || 0,
          packingWage: recipe?.packingWage || 0,
          surfaceTreatmentMode: recipe?.surfaceTreatmentMode || 'none',
          surfaceTreatmentCost: recipe?.surfaceTreatmentCost || 0,
          managementFee: recipe?.managementFee || 0,
          coilMaterial: recipe?.coilMaterial || DEFAULT_COIL_MATERIAL,
        });
        partsJson = JSON.stringify(draft.parts);
      } catch {
        partsJson = JSON.stringify(baseParts);
      }
    }

    return {
      id: item.id,
      recipeId: item.baseRecipeId || undefined,
      recipeName: item.baseRecipeName,
      qty: item.qty,
      partsJson,
      unitCost: item.unitCost,
      profitMargin: item.margin,
      unitPrice: item.unitPrice,
    };
  }));
}

export async function buildOrderFromQuotation(input: {
  quotation: Quotation;
  customers: Customer[];
  recipes: Recipe[];
  getPrice: PriceGetter;
  getCableAccessoryFee: CableAccessoryFeeGetter;
  getCableAccessoryName: CableAccessoryNameGetter;
  previewRecipeCostDraft: CostDraftPreviewer;
  createEmptyOrder: EmptyOrderFactory;
}): Promise<Order> {
  const { quotation, customers, createEmptyOrder } = input;
  const customer = customers.find(item => item.Id === quotation.customerId);
  const orderItems = await buildOrderItemsFromQuotation({
    quotationItems: parseJsonArray<QuotationItem>(quotation.itemsJson),
    recipes: input.recipes,
    getPrice: input.getPrice,
    getCableAccessoryFee: input.getCableAccessoryFee,
    getCableAccessoryName: input.getCableAccessoryName,
    previewRecipeCostDraft: input.previewRecipeCostDraft,
  });
  const order = createEmptyOrder(
    customer ? customer.name : 'Unknown',
    `由报价单转化: ${quotation.remark}`,
    ''
  );
  return { ...order, items: orderItems };
}
