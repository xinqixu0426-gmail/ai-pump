import { Order, PurchaseItem } from '../types';

export type PurchaseFilter = 'pending' | 'partial' | 'purchased' | 'all';

export interface AffectedPurchase {
  order: Order;
  item: PurchaseItem;
}
export interface PurchaseTask {
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
}
export interface GroupPurchaseConfirm {
  supplier: string;
  taskCount: number;
  totalNeed: number;
  pendingNeed: number;
  orderCount: number;
  purchased: boolean;
  savingKey: string;
  affected: AffectedPurchase[];
}

export interface PurchaseStats {
  activeOrderCount: number;
  supplierCount: number;
  taskCount: number;
  pendingTaskCount: number;
  purchasedNeed: number;
  pendingNeed: number;
  totalNeed: number;
}

export function supplierLabel(supplier: string) {
  return supplier?.trim() || '未指定供应商';
}

export function taskStatus(task: PurchaseTask): PurchaseFilter {
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

export function statusColor(status: PurchaseFilter): 'warning' | 'info' | 'success' | 'default' {
  if (status === 'purchased') return 'success';
  if (status === 'partial') return 'info';
  if (status === 'pending') return 'warning';
  return 'default';
}

export function buildPurchaseTasks(orders: Order[]): PurchaseTask[] {
  const map = new Map<string, PurchaseTask>();
  const activeOrders = orders.filter(order => order.status !== '已完成');

  for (const order of activeOrders) {
    for (const item of order.purchaseList) {
      if (Number(item.needToBuy || 0) <= 0) continue;
      const supplier = item.supplier || '';
      const key = `${supplier}||${item.model}`;
      const existing = map.get(key);
      const need = Number(item.needToBuy || 0);
      if (existing) {
        existing.totalNeed += need;
        if (item.purchased) existing.purchasedNeed += need;
        existing.pendingNeed += item.purchased ? 0 : need;
        existing.affected.push({ order, item });
        existing.orderCount = new Set(existing.affected.map(a => a.order.id)).size;
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
    const supplierCmp = a.supplierLabel.localeCompare(b.supplierLabel, 'zh');
    if (supplierCmp !== 0) return supplierCmp;
    if (a.pendingNeed !== b.pendingNeed) return b.pendingNeed - a.pendingNeed;
    return a.model.localeCompare(b.model, 'zh');
  });
}

export function buildPurchaseStats(orders: Order[], tasks: PurchaseTask[], supplierCount: number): PurchaseStats {
  const activeOrders = orders.filter(order => order.status !== '已完成');
  const pendingTasks = tasks.filter(task => task.pendingNeed > 0);
  const purchasedNeed = tasks.reduce((sum, task) => sum + task.purchasedNeed, 0);
  const totalNeed = tasks.reduce((sum, task) => sum + task.totalNeed, 0);
  const pendingNeed = tasks.reduce((sum, task) => sum + task.pendingNeed, 0);

  return {
    activeOrderCount: activeOrders.filter(order => order.purchaseList.some(item => Number(item.needToBuy || 0) > 0)).length,
    supplierCount,
    taskCount: tasks.length,
    pendingTaskCount: pendingTasks.length,
    purchasedNeed,
    pendingNeed,
    totalNeed,
  };
}
