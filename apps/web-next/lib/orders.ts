import type { ApiResponse } from './api';
import { proxyRequest } from './api';
import type { Recipe } from './recipes';

export type OrderStatus = '待确认' | '待采购' | '采购中' | '采购完成' | '已关闭' | '已取消';

export type OrderItem = {
  id: string;
  recipeId?: number;
  recipeName: string;
  spec?: string;
  qty: number;
  unitCost: number;
  unitPrice: number;
  profitMargin: number;
  partsJson: string;
};

export type PurchaseItem = {
  model: string;
  name: string;
  supplier: string;
  totalQty: number;
  currentStock: number;
  needToBuy: number;
  plannedQty?: number;
  orderedQty?: number;
  receivedQty?: number;
  stockedQty?: number;
  purchasePrice?: number;
  actualSupplier?: string;
  orderedAt?: string | null;
  receivedAt?: string | null;
  stockedAt?: string | null;
  identityKey?: string;
  stockInHistory?: Array<{ receiptId: string; qty: number; at: string }>;
  purchased?: boolean;
  partId?: number;
  coilId?: number;
  inventoryType?: 'part' | 'coil' | 'none';
  purchaseUnit?: string;
  stockQtyPerUnit?: number;
  specification?: string;
  cableLength?: number;
  cableAccessoryType?: string;
  cableAccessoryName?: string;
};

export type TodoItem = {
  id: string;
  supplier: string;
  description: string;
  done?: boolean;
};

export type Order = {
  id: string;
  customerName: string;
  contractNo?: string;
  remark?: string;
  status: OrderStatus;
  items: OrderItem[];
  purchaseList: PurchaseItem[];
  todos: TodoItem[];
  purchaseCompletedAt?: string | null;
  purchaseReceiptId?: string | null;
  statusReason?: string;
  statusChangedAt?: string | null;
  closedAt?: string | null;
  cancelledAt?: string | null;
  totalCost: number;
  totalPrice: number;
  totalProfit: number;
  createdAt: string;
  updatedAt: string;
};

type OrderRow = {
  id?: number;
  Id?: number;
  customerName?: string;
  contractNo?: string;
  remark?: string;
  status?: OrderStatus;
  itemsJson?: string;
  purchaseListJson?: string;
  todosJson?: string;
  purchaseCompletedAt?: string | null;
  purchaseReceiptId?: string | null;
  statusReason?: string;
  statusChangedAt?: string | null;
  closedAt?: string | null;
  cancelledAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
};

export function safeJsonParse<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function calcOrderTotals(items: OrderItem[]) {
  const totalCost = items.reduce((sum, item) => sum + (Number(item.unitCost) || 0) * (Number(item.qty) || 0), 0);
  const totalPrice = items.reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.qty) || 0), 0);
  return {
    totalCost: roundMoney(totalCost),
    totalPrice: roundMoney(totalPrice),
    totalProfit: roundMoney(totalPrice - totalCost),
  };
}

export function rowToOrder(row: OrderRow): Order {
  const items = safeJsonParse<OrderItem[]>(row.itemsJson, []).map((item) => ({
    ...item,
    qty: Number(item.qty) || 0,
    unitCost: Number(item.unitCost) || 0,
    unitPrice: Number(item.unitPrice) || 0,
    profitMargin: Number(item.profitMargin) || 1.1,
  }));
  const totals = calcOrderTotals(items);
  const id = row.id ?? row.Id ?? 0;
  const now = new Date().toISOString();

  return {
    id: String(id),
    customerName: row.customerName || '',
    contractNo: row.contractNo || undefined,
    remark: row.remark || undefined,
    status: row.status || '待确认',
    items,
    purchaseList: safeJsonParse<PurchaseItem[]>(row.purchaseListJson, []),
    todos: safeJsonParse<TodoItem[]>(row.todosJson, []),
    purchaseCompletedAt: row.purchaseCompletedAt || null,
    purchaseReceiptId: row.purchaseReceiptId || null,
    statusReason: row.statusReason || '',
    statusChangedAt: row.statusChangedAt || null,
    closedAt: row.closedAt || null,
    cancelledAt: row.cancelledAt || null,
    totalCost: totals.totalCost,
    totalPrice: totals.totalPrice,
    totalProfit: totals.totalProfit,
    createdAt: row.createdAt || row.CreatedAt || now,
    updatedAt: row.updatedAt || row.UpdatedAt || now,
  };
}

export async function getAllOrders(): Promise<Order[]> {
  const result = await proxyRequest<ApiResponse<OrderRow[]>>('/api/orders');
  if (!result.success) throw new Error(result.error || '订单加载失败');
  return (result.data || []).map(rowToOrder);
}

export function createOrderItemFromRecipe(recipe: Recipe, qty: number, profitMargin: number): OrderItem {
  const unitCost = Math.max(0, Number(recipe.savedTotalCost) || 0);
  return createOrderItemWithUnitCost(recipe, qty, profitMargin, unitCost);
}

export function createOrderItemWithUnitCost(recipe: Recipe, qty: number, profitMargin: number, unitCost: number): OrderItem {
  const margin = Math.max(0.01, Number(profitMargin) || 1.1);
  return {
    id: genId(),
    recipeId: recipe.id,
    recipeName: recipe.name,
    spec: recipe.spec,
    qty: Math.max(1, Number(qty) || 1),
    unitCost: roundMoney(unitCost),
    unitPrice: roundMoney(unitCost * margin),
    profitMargin: margin,
    partsJson: recipe.partsJson || '[]',
  };
}

export async function getRecipeCurrentPartsCost(recipeId: number): Promise<number> {
  const result = await proxyRequest<ApiResponse<{ totalCost?: string | number }>>(`/api/recipes/${recipeId}/cost`);
  if (!result.success || !result.data) throw new Error(result.error || '配方当前成本计算失败');
  return roundMoney(Number(result.data.totalCost) || 0);
}

export async function generatePurchasePlan(items: OrderItem[]): Promise<{ purchaseList: PurchaseItem[]; todos: TodoItem[] }> {
  const result = await proxyRequest<ApiResponse<{ purchaseList: PurchaseItem[]; todos: TodoItem[] }>>('/api/orders/purchase-plan', {
    method: 'POST',
    body: JSON.stringify({
      items: items.map((item) => ({
        partsJson: item.partsJson,
        qty: item.qty,
      })),
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '采购计划生成失败');
  return result.data;
}

export async function createOrder(input: {
  customerName: string;
  contractNo?: string;
  remark?: string;
  items: OrderItem[];
  purchaseList?: PurchaseItem[];
  todos?: TodoItem[];
}): Promise<Order> {
  const payload = await buildOrderSavePayloadDraft({
    customerName: input.customerName,
    contractNo: input.contractNo,
    remark: input.remark,
    status: '待确认',
    items: input.items,
    purchaseList: input.purchaseList,
    todos: input.todos,
  });

  const result = await proxyRequest<ApiResponse<OrderRow>>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!result.success || !result.data) throw new Error(result.error || '订单创建失败');
  return rowToOrder(result.data);
}

export async function saveOrder(order: Order): Promise<Order> {
  const id = Number(order.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('非法订单 ID');
  const payload = await buildOrderSavePayloadDraft(order);

  const result = await proxyRequest<ApiResponse<OrderRow>>(`/api/orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!result.success || !result.data) throw new Error(result.error || '保存订单失败');
  return rowToOrder(result.data);
}

function orderId(order: Order): number {
  const id = Number(order.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('非法订单 ID');
  return id;
}

export async function buildOrderSavePayloadDraft(input: {
  customerName: string;
  contractNo?: string;
  remark?: string;
  status?: OrderStatus;
  items: OrderItem[];
  purchaseList?: PurchaseItem[];
  todos?: TodoItem[];
}): Promise<Record<string, unknown>> {
  const result = await proxyRequest<ApiResponse<Record<string, unknown>>>('/api/orders/save-payload-draft', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '生成订单保存草稿失败');
  return result.data;
}

export async function setOrderStatus(order: Order, status: OrderStatus, reason?: string): Promise<Order> {
  const result = await proxyRequest<ApiResponse<OrderRow>>(`/api/orders/${orderId(order)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '订单状态更新失败');
  return rowToOrder(result.data);
}

export function orderPurchaseProgress(order: Order) {
  const required = order.purchaseList.filter((item) => Number(item.plannedQty ?? item.needToBuy) > 0);
  return required.reduce((result, item) => {
    result.plannedQty += Number(item.plannedQty ?? item.needToBuy) || 0;
    result.orderedQty += Number(item.orderedQty ?? (item.purchased ? item.needToBuy : 0)) || 0;
    result.receivedQty += Number(item.receivedQty) || 0;
    result.stockedQty += Number(item.stockedQty) || 0;
    return result;
  }, { needCount: required.length, plannedQty: 0, orderedQty: 0, receivedQty: 0, stockedQty: 0 });
}

export async function updateOrderPurchaseItem(
  order: Order,
  item: PurchaseItem,
  progress: {
    orderedQty: number;
    receivedQty: number;
    stockedQty: number;
    purchasePrice?: number;
    actualSupplier?: string;
    allowOverPurchase?: boolean;
  }
): Promise<{
  order: Order;
  stockAddition: {
    inventoryType: 'part' | 'coil' | 'none';
    partId: number | null;
    coilId: number | null;
    addQty: number;
    inventoryAddQty: number;
    receiptId: string;
  } | null;
}> {
  const result = await proxyRequest<ApiResponse<{
    order: OrderRow;
    stockAddition: {
      inventoryType: 'part' | 'coil' | 'none';
      partId: number | null;
      coilId: number | null;
      addQty: number;
      inventoryAddQty: number;
      receiptId: string;
    } | null;
  }>>(`/api/orders/${orderId(order)}/purchase-items/progress`, {
    method: 'POST',
    body: JSON.stringify({
      identityKey: item.identityKey,
      model: item.model,
      supplier: item.supplier || '',
      ...progress,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '采购进度保存失败');
  return {
    order: rowToOrder(result.data.order),
    stockAddition: result.data.stockAddition || null,
  };
}

export async function toggleOrderPurchaseItem(order: Order, item: Pick<PurchaseItem, 'model' | 'supplier'>, purchased?: boolean): Promise<Order> {
  const result = await proxyRequest<ApiResponse<OrderRow>>(`/api/orders/${orderId(order)}/purchase-items/toggle`, {
    method: 'POST',
    body: JSON.stringify({ model: item.model, supplier: item.supplier || '', ...(purchased === undefined ? {} : { purchased }) }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '采购项更新失败');
  return rowToOrder(result.data);
}

export async function toggleOrderTodoItem(order: Order, todoId: string, done?: boolean): Promise<Order> {
  const result = await proxyRequest<ApiResponse<OrderRow>>(`/api/orders/${orderId(order)}/todos/toggle`, {
    method: 'POST',
    body: JSON.stringify({ todoId, ...(done === undefined ? {} : { done }) }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '待办更新失败');
  return rowToOrder(result.data);
}

export type PurchaseStockAddition = {
  inventoryType: 'part' | 'coil' | 'none';
  resourceId: number | null;
  partId: number | null;
  coilId: number | null;
  addQty: number;
  inventoryAddQty: number;
  purchaseUnit: string;
};

export async function completeOrderPurchase(order: Order): Promise<{ order: Order; additions: PurchaseStockAddition[] }> {
  const result = await proxyRequest<ApiResponse<{ order: OrderRow; additions: PurchaseStockAddition[] }>>(
    `/api/orders/${orderId(order)}/complete-purchase`,
    { method: 'POST' }
  );
  if (!result.success || !result.data) throw new Error(result.error || '入库失败');
  return {
    order: rowToOrder(result.data.order),
    additions: result.data.additions || [],
  };
}
