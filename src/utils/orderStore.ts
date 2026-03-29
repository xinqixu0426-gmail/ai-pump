import { NOCO_CONFIG, Order, OrderItem, PurchaseItem, TodoItem, RecipePart, Part } from '../types';
import { apiRequest } from './api';

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
  return {
    id: String(row.Id),
    customerName: row.客户名称 || '',
    contractNo: row.合同号 || undefined,
    remark: row.备注 || undefined,
    status: (row.订单状态 as Order['status']) || '待采购',
    items: safeJsonParse<OrderItem[]>(row.型号列表JSON, []),
    purchaseList: safeJsonParse<PurchaseItem[]>(row.采购清单JSON, []),
    todos: safeJsonParse<TodoItem[]>(row.采购TodoJSON, []),
    createdAt: row.CreatedAt || new Date().toISOString(),
    updatedAt: row.UpdatedAt || new Date().toISOString(),
  };
}

function safeJsonParse<T>(str: string | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── NocoDB CRUD ──────────────────────────────────────

const TABLE = NOCO_CONFIG.ordersTable;

/** 递归分页抓取 */
async function fetchAllRows(): Promise<OrderRow[]> {
  const PAGE_SIZE = 100;
  let offset = 0;
  const all: OrderRow[] = [];
  while (true) {
    const data = await apiRequest<{ list: OrderRow[] }>(
      `/api/v2/tables/${TABLE}/records?limit=${PAGE_SIZE}&offset=${offset}`
    );
    const list = data.list || [];
    if (list.length === 0) break;
    all.push(...list);
    if (list.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export async function getAllOrders(): Promise<Order[]> {
  const rows = await fetchAllRows();
  return rows.map(rowToOrder);
}

export async function getOrder(id: string): Promise<Order | null> {
  try {
    const data = await apiRequest<{ list: OrderRow[] }>(
      `/api/v2/tables/${TABLE}/records?where=(Id,eq,${id})`
    );
    const row = data.list?.[0];
    return row ? rowToOrder(row) : null;
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
    await apiRequest(`/api/v2/tables/${TABLE}/records`, {
      method: 'PATCH',
      body: JSON.stringify(record),
    });
    return { ...order, updatedAt: new Date().toISOString() };
  }

  // 新建行
  const created = await apiRequest<OrderRow>(`/api/v2/tables/${TABLE}/records`, {
    method: 'POST',
    body: JSON.stringify(record),
  });
  return { ...order, id: String(created.Id), createdAt: created.CreatedAt || order.createdAt };
}

export async function deleteOrder(id: string): Promise<void> {
  const numId = Number(id);
  if (isNaN(numId)) return;
  await apiRequest(`/api/v2/tables/${TABLE}/records`, {
    method: 'DELETE',
    body: JSON.stringify([{ Id: numId }]),
  });
}

// ── 工厂函数（保持同步，不涉及网络） ─────────────────

export function createEmptyOrder(customerName: string, remark?: string, contractNo?: string): Order {
  const now = new Date().toISOString();
  return {
    id: genId(), // 临时 id，saveOrder 时会被真 Id 替换
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
  return { id: genId(), recipeId, recipeName, spec, qty, partsJson };
}

// ── 汇总算法（纯计算，无副作用） ─────────────────────

export function buildPurchaseList(items: OrderItem[], allParts: Part[]): PurchaseItem[] {
  const partIndex: Map<string, Part> = new Map();
  const partByModel: Map<string, Part> = new Map();
  for (const p of allParts) {
    const m = (p.型号 || p.model || '').trim();
    const s = (p.供应商 || p.supplier || '').trim();
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
    const currentStock = Number(dbPart?.库存 ?? dbPart?.stock ?? 0);
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
