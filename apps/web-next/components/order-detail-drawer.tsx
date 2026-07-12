'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ClipboardList, PackageCheck, ShoppingCart, X } from 'lucide-react';
import {
  completeOrderPurchase,
  orderPurchaseProgress,
  setOrderStatus,
  toggleOrderPurchaseItem,
  toggleOrderTodoItem,
  type Order,
  type OrderStatus,
} from '@/lib/orders';
import { money } from '@/lib/format';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { SegmentedControl } from '@/components/ui/segmented-control';

type OrderDetailDrawerProps = {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type TabKey = 'items' | 'purchase' | 'todos';

const statusTones: Record<OrderStatus, StatusBadgeTone> = {
  待采购: 'amber',
  采购中: 'blue',
  已完成: 'green',
};

const tabOptions: Array<{ value: TabKey; label: string }> = [
  { value: 'items', label: '型号' },
  { value: 'purchase', label: '采购' },
  { value: 'todos', label: '待办' },
];

export function OrderDetailDrawer({ order, open, onClose, onSaved }: OrderDetailDrawerProps) {
  const router = useRouter();
  const [localOrder, setLocalOrder] = useState<Order | null>(order);
  const [tab, setTab] = useState<TabKey>('items');
  const [confirmingPurchase, setConfirmingPurchase] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const previousOrderIdRef = useRef<string | null>(null);

  useEffect(() => {
    const nextOrderId = order?.id ?? null;
    const changedOrder = nextOrderId !== previousOrderIdRef.current;
    previousOrderIdRef.current = nextOrderId;
    setLocalOrder(order);
    if (changedOrder) {
      setTab('items');
      setConfirmingPurchase(false);
    }
    setMessage('');
    setError('');
  }, [order]);

  const progress = useMemo(() => (
    localOrder ? orderPurchaseProgress(localOrder) : { needCount: 0, purchasedCount: 0 }
  ), [localOrder]);
  const purchaseItemsToBuy = useMemo(() => (
    localOrder ? localOrder.purchaseList.filter((item) => Number(item.needToBuy || 0) > 0) : []
  ), [localOrder]);
  const allPurchaseItemsPurchased = purchaseItemsToBuy.length > 0 && purchaseItemsToBuy.every((item) => item.purchased);
  const todoItems = localOrder?.todos || [];
  const allTodosDone = todoItems.length > 0 && todoItems.every((todo) => todo.done);

  async function runAction(action: () => Promise<Order>, successMessage?: string): Promise<Order | null> {
    setSaving(true);
    setError('');
    try {
      const saved = await action();
      setLocalOrder(saved);
      setMessage(successMessage || '已保存');
      onSaved();
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(status: OrderStatus) {
    if (!localOrder) return;
    const saved = await runAction(() => setOrderStatus(localOrder, status), `订单状态已更新为 ${status}`);
    if (saved && status === '采购中') router.push('/purchase');
  }

  async function handleTogglePurchase(model: string, supplier: string) {
    if (!localOrder) return;
    await runAction(() => toggleOrderPurchaseItem(localOrder, { model, supplier }));
  }

  async function handleSetAllPurchaseItems(purchased: boolean) {
    if (!localOrder || purchaseItemsToBuy.length === 0) return;
    await runAction(async () => {
      let nextOrder = localOrder;
      for (const item of purchaseItemsToBuy) {
        nextOrder = await toggleOrderPurchaseItem(nextOrder, { model: item.model, supplier: item.supplier }, purchased);
      }
      return nextOrder;
    }, purchased ? '已全选采购项' : '已取消全部采购项');
  }

  async function handleToggleTodo(id: string) {
    if (!localOrder) return;
    await runAction(() => toggleOrderTodoItem(localOrder, id));
  }

  async function handleSetAllTodos(done: boolean) {
    if (!localOrder || todoItems.length === 0) return;
    await runAction(async () => {
      let nextOrder = localOrder;
      for (const todo of todoItems) {
        nextOrder = await toggleOrderTodoItem(nextOrder, todo.id, done);
      }
      return nextOrder;
    }, done ? '已全选待办' : '已取消全部待办');
  }

  async function handleCompletePurchase() {
    if (!localOrder) return;
    setSaving(true);
    setError('');
    try {
      const result = await completeOrderPurchase(localOrder);
      setLocalOrder(result.order);
      setMessage(`入库完成，更新 ${result.additions.length} 种零件库存`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '入库失败');
    } finally {
      setSaving(false);
    }
  }

  const purchaseAdditions = useMemo(() => {
    if (!localOrder) return [];
    return localOrder.purchaseList.filter((item) => Number(item.needToBuy || 0) > 0 && item.partId);
  }, [localOrder]);

  return (
    <SlideOver open={open && Boolean(localOrder)} onClose={onClose}>
      {localOrder && (
        <div className="flex min-h-full flex-col">
          <header className="border-b border-line px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight text-ink">{localOrder.customerName || '未命名客户'}</h2>
                  <StatusBadge tone={statusTones[localOrder.status]}>{localOrder.status}</StatusBadge>
                </div>
                <div className="mt-1 text-sm text-muted">
                  合同号：{localOrder.contractNo || '-'} · 产品 {localOrder.items.length} 项
                </div>
                {localOrder.remark && <div className="mt-1 text-sm text-muted">备注：{localOrder.remark}</div>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="关闭订单详情"
              >
                <X size={18} />
              </Button>
            </div>
          </header>

          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <SegmentedControl
              value={tab}
              options={tabOptions}
              onChange={setTab}
              ariaLabel="订单详情分区"
            />
            <div className="hidden items-center gap-3 text-xs text-muted md:flex">
              <span className="inline-flex items-center gap-1"><PackageCheck size={14} /> {localOrder.items.length}</span>
              <span className="inline-flex items-center gap-1"><ShoppingCart size={14} /> {progress.purchasedCount}/{progress.needCount}</span>
              <span className="inline-flex items-center gap-1"><ClipboardList size={14} /> {localOrder.todos.length}</span>
            </div>
          </div>

          <main className="flex-1 space-y-4 p-5">
            {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            {message && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

            {tab === 'items' && (
              <div className="space-y-3">
                {localOrder.items.map((item) => (
                  <div key={item.id} className="rounded-panel border border-line p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-ink">{item.recipeName}</div>
                      {item.spec && <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{item.spec}</span>}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-muted">x{item.qty}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-muted md:grid-cols-4">
                      <div>单台成本 <b className="text-ink">{money(item.unitCost)}</b></div>
                      <div>出厂价 <b className="text-ink">{money(item.unitPrice)}</b></div>
                      <div>利润率 <b className="text-ink">{Math.round(((item.profitMargin || 1) - 1) * 100)}%</b></div>
                      <div className="md:text-right">小计 <b className="text-ink">{money(item.unitPrice * item.qty)}</b></div>
                    </div>
                  </div>
                ))}
                <div className="grid gap-3 rounded-panel border border-line bg-slate-50 p-4 text-sm md:grid-cols-3">
                  <div>总成本 <b className="text-ink">{money(localOrder.totalCost)}</b></div>
                  <div>总出厂价 <b className="text-ink">{money(localOrder.totalPrice)}</b></div>
                  <div>总利润 <b className="text-ink">{money(localOrder.totalProfit)}</b></div>
                </div>
              </div>
            )}

            {tab === 'purchase' && (
              <div className="space-y-3">
                <div className="grid gap-3 rounded-panel border border-line bg-slate-50 p-4 text-sm md:grid-cols-3">
                  <div>
                    <div className="text-xs text-muted">需采购项</div>
                    <div className="mt-1 font-semibold text-ink">{progress.needCount}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">已标记采购</div>
                    <div className="mt-1 font-semibold text-ink">{progress.purchasedCount}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">确认入库项</div>
                    <div className="mt-1 font-semibold text-ink">{purchaseAdditions.length}</div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-panel border border-line">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-muted">
                      <tr>
                        <th className="px-3 py-2">型号</th>
                        <th className="px-3 py-2">名称</th>
                        <th className="px-3 py-2">供应商</th>
                        <th className="px-3 py-2 text-right">总量</th>
                        <th className="px-3 py-2 text-right">库存</th>
                        <th className="px-3 py-2 text-right">需采</th>
                        <th className="px-3 py-2 text-center">
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={allPurchaseItemsPurchased}
                              disabled={saving || purchaseItemsToBuy.length === 0}
                              onChange={(event) => void handleSetAllPurchaseItems(event.target.checked)}
                              className="h-4 w-4 rounded border-line"
                            />
                            全选
                          </label>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {localOrder.purchaseList.map((item) => (
                        <tr key={`${item.model}|${item.supplier}`} className="border-t border-line">
                          <td className="px-3 py-2 font-medium text-ink">{item.model}</td>
                          <td className="px-3 py-2 text-muted">{item.name}</td>
                          <td className="px-3 py-2 text-muted">{item.supplier || '-'}</td>
                          <td className="px-3 py-2 text-right">{item.totalQty}</td>
                          <td className="px-3 py-2 text-right">{item.currentStock}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={item.needToBuy > 0 ? 'font-semibold text-rose-600' : 'text-emerald-600'}>
                              {item.needToBuy > 0 ? item.needToBuy : '充足'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {item.needToBuy > 0 ? (
                              <input
                                type="checkbox"
                                checked={Boolean(item.purchased)}
                                disabled={saving}
                                onChange={() => void handleTogglePurchase(item.model, item.supplier)}
                                className="h-4 w-4 rounded border-line"
                              />
                            ) : (
                              <CheckCircle2 size={16} className="mx-auto text-emerald-500" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'todos' && (
              <div className="space-y-2">
                {localOrder.todos.length === 0 ? (
                  <div className="rounded-panel border border-line p-8 text-center text-sm text-muted">暂无采购待办</div>
                ) : (
                  <>
                    <div className="flex justify-end">
                      <label className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-muted">
                        <input
                          type="checkbox"
                          checked={allTodosDone}
                          disabled={saving || todoItems.length === 0}
                          onChange={(event) => void handleSetAllTodos(event.target.checked)}
                          className="h-4 w-4 rounded border-line"
                        />
                        全选完成
                      </label>
                    </div>
                    {localOrder.todos.map((todo) => (
                      <label key={todo.id} className="flex gap-3 rounded-panel border border-line p-3 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(todo.done)}
                          disabled={saving}
                          onChange={() => void handleToggleTodo(todo.id)}
                          className="mt-0.5 h-4 w-4 rounded border-line"
                        />
                        <span>
                          <span className={todo.done ? 'text-muted line-through' : 'text-ink'}>{todo.description}</span>
                          <span className="mt-1 block text-xs text-muted">供应商：{todo.supplier || '-'}</span>
                        </span>
                      </label>
                    ))}
                  </>
                )}
              </div>
            )}
          </main>

          <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4">
            {localOrder.status === '待采购' && (
              <Button
                disabled={saving}
                onClick={() => void handleStatus('采购中')}
              >
                开始采购
              </Button>
            )}
            {localOrder.status === '采购中' && (
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => setConfirmingPurchase(true)}
              >
                确认采购完成并入库
              </Button>
            )}
            <div className="ml-auto text-xs text-muted">{saving ? '保存中...' : '更改会立即保存并刷新列表'}</div>
          </footer>
        </div>
      )}

      <SlideOver open={confirmingPurchase} onClose={() => !saving && setConfirmingPurchase(false)}>
        {localOrder ? (
          <div className="flex min-h-full flex-col">
            <header className="border-b border-line px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Stock In</div>
                  <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">确认采购完成并入库</h3>
                  <div className="mt-1 text-sm text-muted">将把需采购数量加入对应零件库存，并把订单状态改为已完成。</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingPurchase(false)} aria-label="关闭入库确认">
                  <X size={18} />
                </Button>
              </div>
            </header>

            <main className="flex-1 space-y-4 p-5">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                这是库存写操作。请确认采购物料已实际到货，避免重复入库。
              </div>

              {purchaseAdditions.length === 0 ? (
                <div className="rounded-panel border border-line p-8 text-center text-sm text-muted">
                  没有需要入库的采购项。可以关闭此面板。
                </div>
              ) : (
                <div className="overflow-x-auto rounded-panel border border-line">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-muted">
                      <tr>
                        <th className="px-3 py-2">型号</th>
                        <th className="px-3 py-2">名称</th>
                        <th className="px-3 py-2">供应商</th>
                        <th className="px-3 py-2 text-right">当前库存</th>
                        <th className="px-3 py-2 text-right">入库数量</th>
                        <th className="px-3 py-2 text-right">入库后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseAdditions.map((item) => (
                        <tr key={`${item.model}|${item.supplier}`} className="border-t border-line">
                          <td className="px-3 py-2 font-medium text-ink">{item.model}</td>
                          <td className="px-3 py-2 text-muted">{item.name || '-'}</td>
                          <td className="px-3 py-2 text-muted">{item.supplier || '-'}</td>
                          <td className="px-3 py-2 text-right text-muted">{item.currentStock}</td>
                          <td className="px-3 py-2 text-right font-semibold text-ink">+{item.needToBuy}</td>
                          <td className="px-3 py-2 text-right text-muted">{Number(item.currentStock || 0) + Number(item.needToBuy || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </main>

            <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <Button variant="ghost" disabled={saving} onClick={() => setConfirmingPurchase(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={saving || purchaseAdditions.length === 0}
                onClick={() => {
                  setConfirmingPurchase(false);
                  void handleCompletePurchase();
                }}
              >
                {saving ? '入库中' : '确认入库'}
              </Button>
            </footer>
          </div>
        ) : null}
      </SlideOver>
    </SlideOver>
  );
}
