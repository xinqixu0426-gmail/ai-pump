import type { OrderItem } from './orders'
import type { Recipe } from './recipes'
import type { RecipeConfigurationSnapshot, RecipeConfigurationWarning } from './recipe-configurations'

export function buildPendingOrderItem(
  recipe: Recipe,
  qty: string | number,
  profitMargin: string | number,
  createItem: (recipe: Recipe, qty: number, profitMargin: number) => OrderItem,
): OrderItem

export function applyOrderItemPreview(
  item: OrderItem,
  expectedId: string,
  preview: { unitCost: number; warnings?: RecipeConfigurationWarning[]; configurationSnapshot?: RecipeConfigurationSnapshot },
): OrderItem
export function applyOrderItemPreview(
  item: OrderItem | null,
  expectedId: string,
  preview: { unitCost: number; warnings?: RecipeConfigurationWarning[]; configurationSnapshot?: RecipeConfigurationSnapshot },
): OrderItem | null

export function rollbackOrderItemConfiguration(
  item: OrderItem,
  expectedId: string,
  previousItem: OrderItem,
): OrderItem
export function rollbackOrderItemConfiguration(
  item: OrderItem | null,
  expectedId: string,
  previousItem: OrderItem,
): OrderItem | null

export function appendPendingOrderItem(items: OrderItem[], pendingItem: OrderItem | null): OrderItem[]
export function removeOrderDraftItem(items: OrderItem[], itemId: string): OrderItem[]
export function removeCalculatingItemId(ids: Set<string>, itemId: string): Set<string>
