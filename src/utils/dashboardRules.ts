import { BusinessSummary, Order, OrderStatus, Part } from '../types';

export interface DashboardKpis {
  totalRevenue: number;
  totalProfit: number;
  pendingCount: number;
  lowStockParts: number;
}

export interface TrendPoint {
  name: string;
  value: number;
}

export interface DashboardTrends {
  revTrend: TrendPoint[];
  profTrend: TrendPoint[];
}

export interface DashboardWorkbenchItem {
  key: string;
  label: string;
  count: number;
  desc: string;
  path: string;
}

export interface DashboardSupplierFocus {
  supplier: string;
  pending: number;
  orderIds: Set<string>;
}

export interface DashboardWorkbench {
  items: DashboardWorkbenchItem[];
  supplierFocus: DashboardSupplierFocus[];
}

export function sameLocalDay(value?: string, now = new Date()): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

export function groupOrdersByStatus(orders: Order[]): Record<OrderStatus, Order[]> {
  const map: Record<OrderStatus, Order[]> = { 待采购: [], 采购中: [], 已完成: [] };
  for (const order of orders) {
    if (map[order.status]) map[order.status].push(order);
    else map['待采购'].push(order);
  }
  return map;
}

export function pendingPurchaseItemCount(orders: Order[]): number {
  return orders
    .filter(order => order.status !== '已完成')
    .reduce((sum, order) => (
      sum + order.purchaseList.filter(item => Number(item.needToBuy || 0) > 0 && !item.purchased).length
    ), 0);
}

export function outOfStockPartCount(parts: Part[]): number {
  return parts.filter(part => Number(part.stock || 0) === 0).length;
}

export function buildDashboardKpis(input: {
  businessSummary: BusinessSummary | null;
  orders: Order[];
  ordersByStatus: Record<OrderStatus, Order[]>;
  parts: Part[];
}): DashboardKpis {
  const { businessSummary, orders, ordersByStatus, parts } = input;
  if (businessSummary) {
    return {
      totalRevenue: businessSummary.financials.totalRevenue,
      totalProfit: businessSummary.financials.totalProfit,
      pendingCount: businessSummary.orders.active,
      lowStockParts: businessSummary.parts.lowStock + businessSummary.parts.outOfStock,
    };
  }

  const totalRevenue = orders.reduce((sum, order) => sum + (order.totalPrice || 0), 0);
  const totalProfit = orders.reduce((sum, order) => sum + (order.totalProfit || 0), 0);
  const pendingCount = ordersByStatus['待采购'].length + ordersByStatus['采购中'].length;
  const lowStockParts = parts.filter(part => {
    const stock = Number(part.stock || 0);
    return stock <= 5 && stock >= 0;
  }).length;
  return { totalRevenue, totalProfit, pendingCount, lowStockParts };
}

export function buildDashboardTrends(orders: Order[], limit = 15): DashboardTrends {
  const chronological = [...orders].reverse();
  return {
    revTrend: chronological.map((order, index) => ({ name: String(index), value: order.totalPrice || 0 })).slice(-limit),
    profTrend: chronological.map((order, index) => ({ name: String(index), value: order.totalProfit || 0 })).slice(-limit),
  };
}

export function buildDashboardWorkbench(input: {
  businessSummary: BusinessSummary | null;
  orders: Order[];
  parts: Part[];
  now?: Date;
}): DashboardWorkbench {
  const { businessSummary, orders, parts, now = new Date() } = input;
  if (businessSummary) {
    return {
      items: businessSummary.workbench.items.map(item => ({
        key: item.key,
        label: item.label,
        count: item.count,
        desc: item.desc,
        path: item.path,
      })),
      supplierFocus: businessSummary.workbench.supplierFocus.map(supplier => ({
        supplier: supplier.supplier,
        pending: supplier.pendingQty,
        orderIds: new Set(supplier.orderIds),
      })),
    };
  }

  const activeOrders = orders.filter(order => order.status !== '已完成');
  const purchaseOrders = activeOrders.filter(order =>
    order.purchaseList.some(item => Number(item.needToBuy || 0) > 0 && !item.purchased)
  );
  const readyToReceiveOrders = activeOrders.filter(order => {
    const needItems = order.purchaseList.filter(item => Number(item.needToBuy || 0) > 0);
    return needItems.length > 0 && needItems.every(item => item.purchased);
  });
  const outOfStockParts = parts.filter(part => Number(part.stock || 0) <= 0);
  const lowStockParts = parts.filter(part => Number(part.stock || 0) > 0 && Number(part.stock || 0) <= 5);
  const todayOrders = orders.filter(order => sameLocalDay(order.createdAt, now));

  const supplierMap = new Map<string, DashboardSupplierFocus>();
  for (const order of purchaseOrders) {
    for (const item of order.purchaseList) {
      if (Number(item.needToBuy || 0) <= 0 || item.purchased) continue;
      const supplier = item.supplier?.trim() || '未指定供应商';
      const current = supplierMap.get(supplier) || { supplier, pending: 0, orderIds: new Set<string>() };
      current.pending += Number(item.needToBuy || 0);
      current.orderIds.add(order.id);
      supplierMap.set(supplier, current);
    }
  }

  return {
    supplierFocus: [...supplierMap.values()].sort((a, b) => b.pending - a.pending).slice(0, 5),
    items: [
      {
        key: 'pending_purchase',
        label: '待采购',
        count: purchaseOrders.length,
        desc: '订单中仍有未采购零件',
        path: '/purchase',
      },
      {
        key: 'ready_to_receive',
        label: '可确认入库',
        count: readyToReceiveOrders.length,
        desc: '采购项已勾选完成，需订单内确认入库',
        path: '/orders',
      },
      {
        key: 'out_of_stock_parts',
        label: '缺货零件',
        count: outOfStockParts.length,
        desc: `另有 ${lowStockParts.length} 个低库存零件`,
        path: '/parts',
      },
      {
        key: 'today_orders',
        label: '今日新增订单',
        count: todayOrders.length,
        desc: '今天录入或转化的订单',
        path: '/orders',
      },
    ],
  };
}
