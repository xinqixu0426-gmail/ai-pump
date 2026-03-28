import { Order, OrderItem, PurchaseItem, TodoItem, RecipePart, Part } from '../types';

const STORAGE_KEY = 'pump_orders';

// ── 生成 ID ──────────────────────────────────────────
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── localStorage CRUD ─────────────────────────────────

export function getAllOrders(): Order[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getOrder(id: string): Order | null {
  return getAllOrders().find((o) => o.id === id) ?? null;
}

export function saveOrder(order: Order): void {
  const orders = getAllOrders();
  const idx = orders.findIndex((o) => o.id === order.id);
  if (idx >= 0) {
    orders[idx] = { ...order, updatedAt: new Date().toISOString() };
  } else {
    orders.push(order);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

export function deleteOrder(id: string): void {
  const orders = getAllOrders().filter((o) => o.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

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
    createdAt: now,
    updatedAt: now,
  };
}

export function createOrderItem(
  recipeName: string,
  partsJson: string,
  qty: number,
  recipeId?: number,
  spec?: string
): OrderItem {
  return {
    id: genId(),
    recipeId,
    recipeName,
    spec,
    qty,
    partsJson,
  };
}

// ── 汇总算法 ─────────────────────────────────────────

/**
 * 根据订单型号列表 + 当前 Parts 库存，生成采购汇总清单
 */
export function buildPurchaseList(items: OrderItem[], allParts: Part[]): PurchaseItem[] {
  // 建立 (model+supplier) → Part 索引
  const partIndex: Map<string, Part> = new Map();
  const partByModel: Map<string, Part> = new Map();
  for (const p of allParts) {
    const m = (p.型号 || p.model || '').trim();
    const s = (p.供应商 || p.supplier || '').trim();
    if (m) {
      partIndex.set(`${m}|${s}`, p);
      // 型号唯一时记录，用于回退
      if (!partByModel.has(m)) partByModel.set(m, p);
    }
  }

  // 合并零件需求量
  const merged: Map<string, { part: RecipePart; totalQty: number }> = new Map();
  for (const item of items) {
    let parts: RecipePart[] = [];
    try {
      parts = JSON.parse(item.partsJson);
    } catch {
      continue;
    }
    for (const rp of parts) {
      const key = `${rp.model}|${rp.supplier}`;
      const existing = merged.get(key);
      if (existing) {
        existing.totalQty += rp.qty * item.qty;
      } else {
        merged.set(key, { part: rp, totalQty: rp.qty * item.qty });
      }
    }
  }

  // 对比库存
  const result: PurchaseItem[] = [];
  for (const [key, { part, totalQty }] of merged) {
    const dbPart =
      partIndex.get(key) ??
      partByModel.get(part.model) ??
      null;
    const currentStock = Number(dbPart?.库存 ?? dbPart?.stock ?? 0);
    const needToBuy = Math.max(0, totalQty - currentStock);
    result.push({
      model: part.model,
      name: part.name,
      supplier: part.supplier,
      totalQty,
      currentStock,
      needToBuy,
      purchased: false,
      partId: dbPart?.Id,
    });
  }

  // 按供应商排序方便阅读
  result.sort((a, b) => a.supplier.localeCompare(b.supplier));
  return result;
}

/**
 * 根据采购清单生成按供应商分组的 to-do 列表
 * 只对 needToBuy > 0 的条目生成 to-do
 */
export function buildTodos(purchaseList: PurchaseItem[]): TodoItem[] {
  const bySupplier: Map<string, PurchaseItem[]> = new Map();
  for (const p of purchaseList) {
    if (p.needToBuy <= 0) continue;
    const existing = bySupplier.get(p.supplier) ?? [];
    existing.push(p);
    bySupplier.set(p.supplier, existing);
  }

  const todos: TodoItem[] = [];
  for (const [supplier, parts] of bySupplier) {
    const detail = parts.map((p) => `${p.model}×${p.needToBuy}`).join(', ');
    todos.push({
      id: genId(),
      supplier,
      description: `联系【${supplier}】采购：${detail}`,
      done: false,
    });
  }
  return todos;
}

// ── 入库操作 ─────────────────────────────────────────

/**
 * 返回需要调用 updatePart 的入库操作列表
 * 调用方自行执行，避免 orderStore 依赖 api
 */
export function calcStockAdditions(
  purchaseList: PurchaseItem[]
): Array<{ partId: number; addQty: number; currentStock: number }> {
  return purchaseList
    .filter((p) => p.needToBuy > 0 && p.partId != null)
    .map((p) => ({
      partId: p.partId!,
      addQty: p.needToBuy,
      currentStock: p.currentStock,
    }));
}
