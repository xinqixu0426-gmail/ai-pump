'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'motion/react';
import { CircleAlert, Plus, RefreshCw, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { getAllCustomers, type Customer } from '@/lib/customers';
import {
  calcOrderTotals,
  createOrder,
  createOrderItemFromRecipe,
  createOrderItemWithUnitCost,
  getRecipeCurrentPartsCost,
  getAllOrders,
  type Order,
  type OrderItem,
  type OrderStatus,
} from '@/lib/orders';
import { getAllRecipes, type Recipe } from '@/lib/recipes';
import { dateShort, money } from '@/lib/format';
import { FadePanel } from '@/components/motion/fade-panel';
import { PresenceRow } from '@/components/motion/presence-row';
import { OrderDetailDrawer } from '@/components/order-detail-drawer';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { BusinessAlertsBanner } from '@/components/business-alerts-banner';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';

const statusOptions: Array<{ value: OrderStatus | '全部'; label: string }> = [
  { value: '全部', label: '全部' },
  { value: '待采购', label: '待采购' },
  { value: '采购中', label: '采购中' },
  { value: '已完成', label: '已完成' },
];

const statusTones: Record<OrderStatus, StatusBadgeTone> = {
  待采购: 'amber',
  采购中: 'blue',
  已完成: 'green',
};

function statLabel(value: string, sub: string) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  );
}

function customerMarginMultiplier(customer: Customer | undefined): number {
  return 1 + Math.max(0, Number(customer?.defaultMargin) || 0);
}

export function OrdersView() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [auxLoading, setAuxLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<OrderStatus | '全部'>('全部');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [remark, setRemark] = useState('');
  const [recipeId, setRecipeId] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [itemMargin, setItemMargin] = useState('1.10');
  const [draftItems, setDraftItems] = useState<OrderItem[]>([]);

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await getAllOrders();
      setOrders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '订单加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadAuxiliary() {
    if (customers.length > 0 && recipes.length > 0) return;
    setAuxLoading(true);
    try {
      const [nextCustomers, nextRecipes] = await Promise.all([getAllCustomers(), getAllRecipes()]);
      setCustomers(nextCustomers);
      setRecipes(nextRecipes);
      const firstCustomer = nextCustomers[0];
      setCustomerId((current) => current || (firstCustomer ? String(firstCustomer.id) : ''));
      setItemMargin((current) => current || customerMarginMultiplier(firstCustomer).toFixed(2));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '订单表单数据加载失败');
    } finally {
      setAuxLoading(false);
    }
  }

  function openCreateDrawer() {
    setFormError(null);
    setContractNo('');
    setRemark('');
    setRecipeId('');
    setItemQty('1');
    setDraftItems([]);
    setDrawerOpen(true);
    void loadAuxiliary();
  }

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = status === '全部' || order.status === status;
      const text = `${order.customerName} ${order.contractNo || ''} ${order.remark || ''}`.toLowerCase();
      return matchesStatus && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [orders, query, status]);

  const stats = useMemo(() => {
    const pending = orders.filter((order) => order.status === '待采购').length;
    const purchasing = orders.filter((order) => order.status === '采购中').length;
    const totalPrice = orders.reduce((sum, order) => sum + order.totalPrice, 0);
    const totalProfit = orders.reduce((sum, order) => sum + order.totalProfit, 0);
    return { pending, purchasing, totalPrice, totalProfit };
  }, [orders]);

  const selectedFreshOrder = selectedOrder
    ? orders.find((order) => order.id === selectedOrder.id) || selectedOrder
    : null;

  const selectedCustomer = customers.find((customer) => String(customer.id) === customerId);
  const selectedRecipe = recipes.find((recipe) => String(recipe.id) === recipeId);
  const draftTotals = useMemo(() => calcOrderTotals(draftItems), [draftItems]);

  function onCustomerChange(nextId: string) {
    setCustomerId(nextId);
    const customer = customers.find((item) => String(item.id) === nextId);
    setItemMargin(customerMarginMultiplier(customer).toFixed(2));
  }

  async function addDraftItem() {
    if (!selectedRecipe) {
      setFormError('请先选择配方');
      return;
    }
    setAuxLoading(true);
    setFormError(null);
    try {
      const savedCost = Number(selectedRecipe.savedTotalCost || 0);
      const unitCost = savedCost > 0 ? savedCost : await getRecipeCurrentPartsCost(selectedRecipe.id);
      const item = savedCost > 0
        ? createOrderItemFromRecipe(selectedRecipe, Number(itemQty), Number(itemMargin))
        : createOrderItemWithUnitCost(selectedRecipe, Number(itemQty), Number(itemMargin), unitCost);
      setDraftItems((current) => [...current, item]);
      setItemQty('1');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '订单产品成本计算失败');
    } finally {
      setAuxLoading(false);
    }
  }

  function updateDraftItem(id: string, patch: Partial<Pick<OrderItem, 'qty' | 'profitMargin' | 'unitPrice'>>) {
    setDraftItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const nextQty = patch.qty == null ? item.qty : Math.max(1, Number(patch.qty) || 1);
      const nextMargin = patch.profitMargin == null ? item.profitMargin : Math.max(0.01, Number(patch.profitMargin) || 1);
      const unitPrice = patch.unitPrice == null ? item.unitPrice : Math.max(0, Number(patch.unitPrice) || 0);
      return {
        ...item,
        qty: nextQty,
        profitMargin: patch.unitPrice == null ? nextMargin : (item.unitCost > 0 ? unitPrice / item.unitCost : nextMargin),
        unitPrice: patch.unitPrice == null ? Math.round(item.unitCost * nextMargin * 100) / 100 : unitPrice,
      };
    }));
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const customerName = selectedCustomer?.name || '';
    if (!customerName) {
      setFormError('请选择客户');
      return;
    }
    if (draftItems.length === 0) {
      setFormError('至少添加一个订单产品');
      return;
    }

    setSaving(true);
    setFormError(null);
    setError(null);

    try {
      const created = await createOrder({
        customerName,
        contractNo,
        remark,
        items: draftItems,
      });
      await load(true);
      setDrawerOpen(false);
      if (created.purchaseList.some((item) => Number(item.needToBuy || 0) > 0)) {
        router.push('/purchase');
        return;
      }
      setSelectedOrder(created);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '订单创建失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <FadePanel className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Orders</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">订单</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            订单列表、详情和创建流程都走标准 API；新建订单会先生成采购计划，再写入订单。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => void load(true)}
            disabled={refreshing || saving}
            icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}
          >
            刷新
          </Button>
          <Button variant="primary" onClick={openCreateDrawer} disabled={saving} icon={<Plus size={15} />}>
            新建订单
          </Button>
        </div>
      </FadePanel>

      <BusinessAlertsBanner scope="order" />

      <div className="grid gap-3 md:grid-cols-4">
        <FadePanel delay={0.02} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(String(orders.length), '订单总数')}
        </FadePanel>
        <FadePanel delay={0.04} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(String(stats.pending + stats.purchasing), '待处理订单')}
        </FadePanel>
        <FadePanel delay={0.06} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(money(stats.totalPrice), '总销售额')}
        </FadePanel>
        <FadePanel delay={0.08} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(money(stats.totalProfit), '总利润')}
        </FadePanel>
      </div>

      <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3">
            <Search size={16} className="text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索客户、合同号或备注"
              className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-muted" />
            <SegmentedControl
              value={status}
              options={statusOptions}
              onChange={setStatus}
              ariaLabel="订单状态筛选"
            />
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 p-5 text-sm text-rose-700">
            <CircleAlert size={16} />
            {error}
          </div>
        ) : loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-sm font-medium text-ink">没有匹配的订单</div>
            <div className="mt-1 text-sm text-muted">调整筛选条件或刷新后再看。</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-[28%] border-b border-line px-4 py-3">客户</th>
                  <th className="w-[14%] border-b border-line px-4 py-3">合同号</th>
                  <th className="w-[10%] border-b border-line px-4 py-3">状态</th>
                  <th className="w-[8%] border-b border-line px-4 py-3 text-right">产品数</th>
                  <th className="w-[14%] border-b border-line px-4 py-3 text-right">销售额</th>
                  <th className="w-[14%] border-b border-line px-4 py-3 text-right">利润</th>
                  <th className="w-[12%] border-b border-line px-4 py-3">创建</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {filteredOrders.map((order) => (
                    <PresenceRow
                      key={order.id}
                      className="group cursor-pointer transition hover:bg-slate-50"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <td className="border-b border-line px-4 py-3">
                        <div className="font-medium text-ink">{order.customerName || '未命名客户'}</div>
                        <div className="mt-0.5 max-w-[280px] truncate text-xs text-muted">{order.remark || '无备注'}</div>
                      </td>
                      <td className="border-b border-line px-4 py-3 text-muted">{order.contractNo || '-'}</td>
                      <td className="border-b border-line px-4 py-3 whitespace-nowrap">
                        <StatusBadge tone={statusTones[order.status]}>{order.status}</StatusBadge>
                      </td>
                      <td className="border-b border-line px-4 py-3 text-right text-muted">{order.items.length}</td>
                      <td className="border-b border-line px-4 py-3 text-right font-medium text-ink">{money(order.totalPrice)}</td>
                      <td className="border-b border-line px-4 py-3 text-right text-muted">{money(order.totalProfit)}</td>
                      <td className="border-b border-line px-4 py-3 text-muted">{dateShort(order.createdAt)}</td>
                    </PresenceRow>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </FadePanel>

      <OrderDetailDrawer
        order={selectedFreshOrder}
        open={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        onSaved={() => void load(true)}
      />

      <SlideOver open={drawerOpen} onClose={() => !saving && setDrawerOpen(false)}>
        <form onSubmit={submitOrder} className="flex min-h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Order</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">新建订单</h2>
            </div>
            <button
              type="button"
              aria-label="关闭"
              disabled={saving}
              onClick={() => setDrawerOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-5 p-5">
            {formError ? (
              <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <CircleAlert size={16} />
                {formError}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">客户</span>
                <select
                  value={customerId}
                  onChange={(event) => onCustomerChange(event.target.value)}
                  disabled={auxLoading}
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
                >
                  <option value="">{auxLoading ? '加载客户中' : '选择客户'}</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={String(customer.id)}>{customer.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-ink">合同号</span>
                <input
                  value={contractNo}
                  onChange={(event) => setContractNo(event.target.value)}
                  className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  placeholder="可选"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-ink">备注</span>
              <textarea
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                rows={3}
                className="mt-2 w-full resize-none rounded-md border border-line px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                placeholder="交付要求、合同备注等"
              />
            </label>

            <div className="rounded-panel border border-line">
              <div className="border-b border-line p-4">
                <div className="text-sm font-semibold text-ink">添加产品</div>
                <div className="mt-1 text-xs text-muted">成本优先使用配方保存成本；保存成本为空时调用后端当前配件价作为参考。</div>
              </div>
              <div className="grid gap-3 p-4 lg:grid-cols-[1fr_96px_120px_auto] lg:items-end">
                <label className="block">
                  <span className="text-sm font-medium text-ink">配方</span>
                  <select
                    value={recipeId}
                    onChange={(event) => setRecipeId(event.target.value)}
                    disabled={auxLoading}
                    className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
                  >
                    <option value="">{auxLoading ? '加载配方中' : '选择配方'}</option>
                    {recipes.map((recipe) => (
                      <option key={recipe.id} value={String(recipe.id)}>
                        {recipe.name} {recipe.spec ? ` / ${recipe.spec}` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-ink">数量</span>
                  <input
                    value={itemQty}
                    onChange={(event) => setItemQty(event.target.value)}
                    type="number"
                    min="1"
                    step="1"
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-ink">加价倍数</span>
                  <input
                    value={itemMargin}
                    onChange={(event) => setItemMargin(event.target.value)}
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>

                <Button type="button" onClick={() => void addDraftItem()} disabled={auxLoading || saving} icon={<Plus size={15} />}>
                  {auxLoading ? '计算中' : '添加'}
                </Button>
              </div>
            </div>

            {draftItems.length > 0 ? (
              <div className="overflow-x-auto rounded-panel border border-line">
                <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                    <tr>
                      <th className="border-b border-line px-4 py-3">产品</th>
                      <th className="border-b border-line px-4 py-3 text-right">数量</th>
                      <th className="border-b border-line px-4 py-3 text-right">成本</th>
                      <th className="border-b border-line px-4 py-3 text-right">加价</th>
                      <th className="border-b border-line px-4 py-3 text-right">单价</th>
                      <th className="border-b border-line px-4 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftItems.map((item) => (
                      <tr key={item.id}>
                        <td className="border-b border-line px-4 py-3">
                          <div className="font-medium text-ink">{item.recipeName}</div>
                          <div className="mt-0.5 text-xs text-muted">{item.spec || '-'}</div>
                        </td>
                        <td className="border-b border-line px-4 py-3 text-right">
                          <input
                            value={item.qty}
                            onChange={(event) => updateDraftItem(item.id, { qty: Number(event.target.value) })}
                            type="number"
                            min="1"
                            className="h-8 w-20 rounded-md border border-line px-2 text-right text-sm outline-none"
                          />
                        </td>
                        <td className="border-b border-line px-4 py-3 text-right text-muted">{money(item.unitCost)}</td>
                        <td className="border-b border-line px-4 py-3 text-right">
                          <input
                            value={Number(item.profitMargin).toFixed(2)}
                            onChange={(event) => updateDraftItem(item.id, { profitMargin: Number(event.target.value) })}
                            type="number"
                            min="0.01"
                            step="0.01"
                            className="h-8 w-24 rounded-md border border-line px-2 text-right text-sm outline-none"
                          />
                        </td>
                        <td className="border-b border-line px-4 py-3 text-right">
                          <input
                            value={item.unitPrice}
                            onChange={(event) => updateDraftItem(item.id, { unitPrice: Number(event.target.value) })}
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 w-28 rounded-md border border-line px-2 text-right text-sm outline-none"
                          />
                        </td>
                        <td className="border-b border-line px-4 py-3">
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="danger"
                              type="button"
                              onClick={() => setDraftItems((current) => current.filter((next) => next.id !== item.id))}
                              icon={<Trash2 size={14} />}
                            >
                              删除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="grid gap-3 rounded-panel border border-line bg-slate-50 p-4 text-sm md:grid-cols-3">
              <div>
                <div className="text-xs text-muted">总成本</div>
                <div className="mt-1 font-semibold text-ink">{money(draftTotals.totalCost)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">总销售额</div>
                <div className="mt-1 font-semibold text-ink">{money(draftTotals.totalPrice)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">预计利润</div>
                <div className="mt-1 font-semibold text-ink">{money(draftTotals.totalProfit)}</div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-line p-5">
            <Button type="button" variant="ghost" onClick={() => setDrawerOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={saving || auxLoading} icon={<Save size={15} />}>
              {saving ? '创建中' : '创建订单'}
            </Button>
          </div>
        </form>
      </SlideOver>
    </div>
  );
}
