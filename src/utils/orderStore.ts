import { Order, OrderItem, PurchaseItem, TodoItem } from '../types';
import { proxyRequest } from './api';
import { DEFAULT_ORDER_MARGIN, roundMoney } from './businessRules';

// ── 生成 ID ──────────────────────────────────────────
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── 后端行 → Order 对象转换 ──────────────────────────

// 后端 orderRow() 适配器输出的字段（camelCase）
interface OrderRow {
  Id: number;
  customerName: string;
  contractNo?: string;
  remark?: string;
  status?: string;
  itemsJson?: string;
  purchaseListJson?: string;
  todosJson?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
}

function rowToOrder(row: OrderRow): Order {
  const items = safeJsonParse<OrderItem[]>(row.itemsJson, []);
  // 兼容旧数据：如果 item 没有 unitCost 则补 0
  for (const it of items) {
    if (it.unitCost === undefined) it.unitCost = 0;
    if (it.profitMargin === undefined) it.profitMargin = DEFAULT_ORDER_MARGIN;
    if (it.unitPrice === undefined) it.unitPrice = 0;
  }
  const totals = calcOrderTotals(items);
  return {
    id: String(row.Id),
    customerName: row.customerName || '',
    contractNo: row.contractNo || undefined,
    remark: row.remark || undefined,
    status: (row.status as Order['status']) || '待采购',
    items,
    purchaseList: safeJsonParse<PurchaseItem[]>(row.purchaseListJson, []),
    todos: safeJsonParse<TodoItem[]>(row.todosJson, []),
    totalCost: totals.totalCost,
    totalPrice: totals.totalPrice,
    totalProfit: totals.totalProfit,
    createdAt: row.CreatedAt || new Date().toISOString(),
    updatedAt: row.UpdatedAt || new Date().toISOString(),
  };
}

function safeJsonParse<T>(str: string | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── 订单 CRUD（走后端 /api/orders 代理）──────────────

export async function getAllOrders(): Promise<Order[]> {
  const res = await proxyRequest<{ success: boolean; data: OrderRow[] }>('/api/orders');
  return (res.data || []).map(rowToOrder);
}

export async function getOrder(id: string): Promise<Order | null> {
  try {
    const res = await proxyRequest<{ success: boolean; data: OrderRow }>(`/api/orders/${id}`);
    return res.data ? rowToOrder(res.data) : null;
  } catch {
    return null;
  }
}

export async function saveOrder(order: Order): Promise<Order> {
  const record: Record<string, unknown> = {
    customerName: order.customerName,
    contractNo: order.contractNo || '',
    remark: order.remark || '',
    status: order.status,
    itemsJson: JSON.stringify(order.items),
    purchaseListJson: JSON.stringify(order.purchaseList),
    todosJson: JSON.stringify(order.todos),
  };

  // 如果 id 是纯数字 → 已存在行，PATCH 更新
  const numId = Number(order.id);
  if (!isNaN(numId) && numId > 0) {
    await proxyRequest(`/api/orders/${numId}`, {
      method: 'PATCH',
      body: JSON.stringify(record),
    });
    return { ...order, updatedAt: new Date().toISOString() };
  }

  // 新建行
  const res = await proxyRequest<{ success: boolean; data: OrderRow }>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(record),
  });
  return { ...order, id: String(res.data.Id), createdAt: res.data.CreatedAt || order.createdAt };
}

export async function deleteOrder(id: string): Promise<void> {
  const numId = Number(id);
  if (isNaN(numId)) return;
  await proxyRequest(`/api/orders/${numId}`, { method: 'DELETE' });
}

// ── 工厂函数（保持同步，不涉及网络） ─────────────────

export function createEmptyOrder(customerName: string, remark?: string, contractNo?: string): Order {
  const now = new Date().toISOString();
  return {
    id: genId(),
    customerName,
    contractNo,
    remark,
    status: '待采购',
    items: [],
    purchaseList: [],
    todos: [],
    totalCost: 0,
    totalPrice: 0,
    totalProfit: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function createOrderItem(
  recipeName: string,
  partsJson: string,
  qty: number,
  unitCost: number,
  recipeId?: number,
  spec?: string,
  profitMargin: number = DEFAULT_ORDER_MARGIN,
  unitPrice?: number
): OrderItem {
  const price = unitPrice ?? roundMoney(unitCost * profitMargin);
  return { id: genId(), recipeId, recipeName, spec, qty, partsJson, unitCost, profitMargin, unitPrice: price };
}

/** 计算订单汇总数据 */
export function calcOrderTotals(items: OrderItem[]): { totalCost: number; totalPrice: number; totalProfit: number } {
  let totalCost = 0;
  let totalPrice = 0;
  for (const it of items) {
    totalCost += it.unitCost * it.qty;
    totalPrice += it.unitPrice * it.qty;
  }
  return { totalCost: roundMoney(totalCost), totalPrice: roundMoney(totalPrice), totalProfit: roundMoney(totalPrice - totalCost) };
}

// ── 历史价格查询 ─────────────────────────────

export interface HistoryPrice {
  unitPrice: number;
  unitCost: number;
  profitMargin: number;
  customerName: string;
  date: string;
}

/** 从历史订单中查找相同配方名称的最近一次出厂价 */
export async function findHistoryPrice(recipeName: string): Promise<HistoryPrice | null> {
  try {
    const res = await proxyRequest<{ success: boolean; data: HistoryPrice | null }>(
      `/api/orders/history-price/${encodeURIComponent(recipeName)}`
    );
    return res.data || null;
  } catch {
    return null;
  }
}

// ── 入库辅助 ─────────────────────────────────────────

export function calcStockAdditions(purchaseList: PurchaseItem[]): Array<{ partId: number; addQty: number }> {
  return purchaseList
    .filter((p) => p.needToBuy > 0 && p.partId != null)
    .map((p) => ({ partId: p.partId!, addQty: p.needToBuy }));
}
