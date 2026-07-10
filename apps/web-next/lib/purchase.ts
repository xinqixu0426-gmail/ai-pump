import type { ApiResponse } from './api';
import { proxyRequest } from './api';
import { getAllOrders, type Order, type PurchaseItem } from './orders';

export type PurchaseFilter = 'pending' | 'partial' | 'purchased' | 'all';

export type AffectedPurchase = {
  order: Order;
  item: PurchaseItem;
};

export type PurchaseTask = {
  key: string;
  supplier: string;
  supplierLabel: string;
  model: string;
  name: string;
  totalNeed: number;
  purchasedNeed: number;
  pendingNeed: number;
  orderCount: number;
  affected: AffectedPurchase[];
};

export type PurchaseStats = {
  activeOrderCount: number;
  supplierCount: number;
  taskCount: number;
  pendingTaskCount: number;
  purchasedNeed: number;
  pendingNeed: number;
  totalNeed: number;
};

export function supplierLabel(supplier: string) {
  return supplier?.trim() || '未指定供应商';
}

export function taskStatus(task: PurchaseTask): Exclude<PurchaseFilter, 'all'> {
  if (task.pendingNeed <= 0) return 'purchased';
  if (task.purchasedNeed > 0) return 'partial';
  return 'pending';
}

export function statusText(status: PurchaseFilter) {
  if (status === 'purchased') return '已采购';
  if (status === 'partial') return '部分已采';
  if (status === 'pending') return '待采购';
  return '全部';
}

export function buildPurchaseTasks(orders: Order[]): PurchaseTask[] {
  const map = new Map<string, PurchaseTask>();
  const activeOrders = orders.filter((order) => order.status !== '已完成');

  for (const order of activeOrders) {
    for (const item of order.purchaseList) {
      const need = Number(item.needToBuy || 0);
      if (need <= 0) continue;

      const supplier = item.supplier || '';
      const key = `${supplier}||${item.model}`;
      const existing = map.get(key);

      if (existing) {
        existing.totalNeed += need;
        existing.purchasedNeed += item.purchased ? need : 0;
        existing.pendingNeed += item.purchased ? 0 : need;
        existing.affected.push({ order, item });
        existing.orderCount = new Set(existing.affected.map((entry) => entry.order.id)).size;
      } else {
        map.set(key, {
          key,
          supplier,
          supplierLabel: supplierLabel(supplier),
          model: item.model,
          name: item.name || item.model,
          totalNeed: need,
          purchasedNeed: item.purchased ? need : 0,
          pendingNeed: item.purchased ? 0 : need,
          orderCount: 1,
          affected: [{ order, item }],
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    const supplierCompare = a.supplierLabel.localeCompare(b.supplierLabel, 'zh-CN');
    if (supplierCompare !== 0) return supplierCompare;
    if (a.pendingNeed !== b.pendingNeed) return b.pendingNeed - a.pendingNeed;
    return a.model.localeCompare(b.model, 'zh-CN');
  });
}

export function buildPurchaseStats(orders: Order[], tasks: PurchaseTask[]): PurchaseStats {
  const activeOrders = orders.filter((order) => order.status !== '已完成');
  const suppliers = new Set(tasks.map((task) => task.supplierLabel));
  const pendingTasks = tasks.filter((task) => task.pendingNeed > 0);
  const purchasedNeed = tasks.reduce((sum, task) => sum + task.purchasedNeed, 0);
  const totalNeed = tasks.reduce((sum, task) => sum + task.totalNeed, 0);
  const pendingNeed = tasks.reduce((sum, task) => sum + task.pendingNeed, 0);

  return {
    activeOrderCount: activeOrders.filter((order) =>
      order.purchaseList.some((item) => Number(item.needToBuy || 0) > 0)
    ).length,
    supplierCount: suppliers.size,
    taskCount: tasks.length,
    pendingTaskCount: pendingTasks.length,
    purchasedNeed,
    pendingNeed,
    totalNeed,
  };
}

export async function getPurchaseOrders(): Promise<Order[]> {
  return getAllOrders();
}

export async function applyPurchaseTask(task: PurchaseTask, purchased: boolean): Promise<void> {
  const result = await proxyRequest<ApiResponse<{ updatedCount: number }>>('/api/orders/purchase-items/batch', {
    method: 'POST',
    body: JSON.stringify({
      model: task.model,
      supplier: task.supplier,
      purchased,
    }),
  });
  if (!result.success) throw new Error(result.error || '采购状态保存失败');
}
