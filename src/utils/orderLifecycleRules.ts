import { Order, OrderStatus, PurchaseItem } from '../types';

export const ORDER_STATUS_COLOR: Record<OrderStatus, 'warning' | 'info' | 'success'> = {
  待采购: 'warning',
  采购中: 'info',
  已完成: 'success',
};

export interface OrderKpis {
  pending: number;
  completed: number;
  totalRevenue: number;
  totalProfit: number;
}

export interface OrderPurchaseProgress {
  needCount: number;
  purchasedCount: number;
}

export function buildOrderKpis(orders: Order[]): OrderKpis {
  return {
    pending: orders.filter(order => order.status === '待采购' || order.status === '采购中').length,
    completed: orders.filter(order => order.status === '已完成').length,
    totalRevenue: orders.reduce((sum, order) => sum + (order.totalPrice || 0), 0),
    totalProfit: orders.reduce((sum, order) => sum + (order.totalProfit || 0), 0),
  };
}

export function orderPurchaseProgress(order: Order): OrderPurchaseProgress {
  const needCount = order.purchaseList.filter(item => item.needToBuy > 0).length;
  const purchasedCount = order.purchaseList.filter(item => item.needToBuy > 0 && item.purchased).length;
  return { needCount, purchasedCount };
}

export function filterOrders(input: {
  orders: Order[];
  customer?: string | null;
  status?: OrderStatus | '全部';
  searchQuery?: string;
}): Order[] {
  const q = String(input.searchQuery || '').trim().toLowerCase();
  return input.orders.filter(order => {
    const matchCustomer = !input.customer || order.customerName === input.customer;
    const matchStatus = !input.status || input.status === '全部' || order.status === input.status;
    const matchSearch = !q
      || order.customerName.toLowerCase().includes(q)
      || (order.contractNo || '').toLowerCase().includes(q)
      || order.items.some(item => item.recipeName.toLowerCase().includes(q));
    return matchCustomer && matchStatus && matchSearch;
  });
}

export function sortOrders(orders: Order[], orderBy: string, direction: 'asc' | 'desc'): Order[] {
  return [...orders].sort((a, b) => {
    const aVal = a[orderBy as keyof Order];
    const bVal = b[orderBy as keyof Order];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return direction === 'asc' ? -1 : 1;
    if (bVal == null) return direction === 'asc' ? 1 : -1;
    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  });
}

export function updateOrderStatus(order: Order, status: OrderStatus, updatedAt = new Date().toISOString()): Order {
  return { ...order, status, updatedAt };
}

export function togglePurchaseItem(order: Order, model: string, supplier: string, updatedAt = new Date().toISOString()): Order {
  return {
    ...order,
    purchaseList: order.purchaseList.map(item => (
      item.model === model && item.supplier === supplier
        ? { ...item, purchased: !item.purchased }
        : item
    )),
    updatedAt,
  };
}

export function toggleTodoItem(order: Order, id: string, updatedAt = new Date().toISOString()): Order {
  return {
    ...order,
    todos: order.todos.map(item => (
      item.id === id ? { ...item, done: !item.done } : item
    )),
    updatedAt,
  };
}

export function stockAdditionsFromPurchaseList(purchaseList: PurchaseItem[]): Array<{ partId: number; addQty: number }> {
  return purchaseList
    .filter(item => item.needToBuy > 0 && item.partId != null)
    .map(item => ({ partId: item.partId!, addQty: item.needToBuy }));
}

export function completePurchaseOrder(order: Order, updatedAt = new Date().toISOString()): {
  order: Order;
  additions: Array<{ partId: number; addQty: number }>;
} {
  const additions = stockAdditionsFromPurchaseList(order.purchaseList);
  return {
    additions,
    order: {
      ...order,
      status: '已完成',
      purchaseList: order.purchaseList.map(item => ({ ...item, purchased: true })),
      updatedAt,
    },
  };
}
