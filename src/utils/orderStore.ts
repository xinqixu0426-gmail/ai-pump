import { Order, OrderItem, PurchaseItem, TodoItem, RecipePart, Part } from '../types';

// ── 生成 ID ──────────────────────────────────────────
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── NocoDB 行 → Order 对象转换 ────────────────────────

interface OrderRow {
  Id: number;
  客户名称?: string;
  合同号?: string;
  备注?: string;
  订单状态?: string;
  型号列表JSON?: string;
  采购清单JSON?: string;
  采购TodoJSON?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
}

function rowToOrder(row: OrderRow): Order {
  const items = safeJsonParse<OrderItem[]>(row.型号列表JSON, []);
  // 兼容旧数据：如果 item 没有 unitCost 则补 0
  for (const it of items) {
    if (it.unitCost === undefined) it.unitCost = 0;
    if (it.profitMargin === undefined) it.profitMargin = 1.10;
    if (it.unitPrice === undefined) it.unitPrice = 0;
  }
  const totals = calcOrderTotals(items);
  return {
    id: String(row.Id),
    customerName: row.客户名称 || '',
    contractNo: row.合同号 || undefined,
    remark: row.备注 || undefined,
    status: (row.订单状态 as Order['status']) || '待采购',
    items,
    purchaseList: safeJsonParse<PurchaseItem[]>(row.采购清单JSON, []),
    todos: safeJsonParse<TodoItem[]>(row.采购TodoJSON, []),
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

// ── 后端代理请求封装 ────────────────────────────────
async function proxyRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return response.json();
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
    客户名称: order.customerName,
    合同号: order.contractNo || '',
    备注: order.remark || '',
    订单状态: order.status,
    型号列表JSON: JSON.stringify(order.items),
    采购清单JSON: JSON.stringify(order.purchaseList),
    采购TodoJSON: JSON.stringify(order.todos),
  };

  // 如果 id 是纯数字 → 已存在行，PATCH 更新
  const numId = Number(order.id);
  if (!isNaN(numId) && numId > 0) {
    record.Id = numId;
    await proxyRequest('/api/orders', {
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
  await proxyRequest('/api/orders', {
    method: 'DELETE',
    body: JSON.stringify([{ Id: numId }]),
  });
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

const DEFAULT_MARGIN = 1.10; // 10% 利润

export function createOrderItem(
  recipeName: string,
  partsJson: string,
  qty: number,
  unitCost: number,
  recipeId?: number,
  spec?: string,
  profitMargin: number = DEFAULT_MARGIN,
  unitPrice?: number
): OrderItem {
  const price = unitPrice ?? Math.round(unitCost * profitMargin * 100) / 100;
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
  return { totalCost: Math.round(totalCost * 100) / 100, totalPrice: Math.round(totalPrice * 100) / 100, totalProfit: Math.round((totalPrice - totalCost) * 100) / 100 };
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
  const orders = await getAllOrders();
  // 按时间降序
  orders.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  for (const order of orders) {
    for (const item of order.items) {
      if (item.recipeName === recipeName && item.unitPrice > 0) {
        return {
          unitPrice: item.unitPrice,
          unitCost: item.unitCost,
          profitMargin: item.profitMargin,
          customerName: order.customerName,
          date: order.updatedAt,
        };
      }
    }
  }
  return null;
}

// ── 汇总算法（纯计算，无副作用） ─────────────────────

export function buildPurchaseList(items: OrderItem[], allParts: Part[]): PurchaseItem[] {
  const partIndex: Map<string, Part> = new Map();
  const partByModel: Map<string, Part> = new Map();
  for (const p of allParts) {
    const m = p.model;
    const s = p.supplier;
    if (m) {
      partIndex.set(`${m}|${s}`, p);
      if (!partByModel.has(m)) partByModel.set(m, p);
    }
  }

  const merged: Map<string, { part: RecipePart; totalQty: number; supplier: string }> = new Map();
  for (const item of items) {
    let parts: RecipePart[] = [];
    try { parts = JSON.parse(item.partsJson); } catch { continue; }
    for (const rp of parts) {
      const key = rp.model;
      const existing = merged.get(key);
      if (existing) {
        existing.totalQty += rp.qty * item.qty;
        if (!existing.supplier && rp.supplier) existing.supplier = rp.supplier;
      } else {
        merged.set(key, { part: rp, totalQty: rp.qty * item.qty, supplier: rp.supplier || '' });
      }
    }
  }

  const result: PurchaseItem[] = [];
  for (const [, { part, totalQty, supplier }] of merged) {
    const dbPart = partIndex.get(`${part.model}|${supplier}`) ?? partByModel.get(part.model) ?? null;
    const currentStock = dbPart?.stock ?? 0;
    const needToBuy = Math.max(0, totalQty - currentStock);
    result.push({
      model: part.model, name: part.name, supplier, totalQty, currentStock, needToBuy, purchased: false, partId: dbPart?.Id,
    });
  }

  result.sort((a, b) => a.supplier.localeCompare(b.supplier));
  return result;
}

export function buildTodos(purchaseList: PurchaseItem[]): TodoItem[] {
  const bySupplier: Map<string, PurchaseItem[]> = new Map();
  for (const p of purchaseList) {
    if (p.needToBuy <= 0) continue;
    const arr = bySupplier.get(p.supplier) ?? [];
    arr.push(p);
    bySupplier.set(p.supplier, arr);
  }
  const todos: TodoItem[] = [];
  for (const [supplier, parts] of bySupplier) {
    const detail = parts.map((p) => `${p.model}×${p.needToBuy}`).join(', ');
    todos.push({ id: genId(), supplier, description: `联系【${supplier}】采购：${detail}`, done: false });
  }
  return todos;
}

// ── 入库辅助 ─────────────────────────────────────────

export function calcStockAdditions(purchaseList: PurchaseItem[]): Array<{ partId: number; addQty: number; currentStock: number }> {
  return purchaseList
    .filter((p) => p.needToBuy > 0 && p.partId != null)
    .map((p) => ({ partId: p.partId!, addQty: p.needToBuy, currentStock: p.currentStock }));
}
