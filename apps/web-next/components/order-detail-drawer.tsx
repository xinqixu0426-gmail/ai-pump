'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, PackageCheck, Save, ShoppingCart, X } from 'lucide-react';
import {
  completeOrderPurchase,
  orderPurchaseProgress,
  setOrderStatus,
  toggleOrderTodoItem,
  updateOrderPurchaseItem,
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
  待确认: 'slate',
  待采购: 'amber',
  采购中: 'blue',
  采购完成: 'green',
  已关闭: 'slate',
  已取消: 'red',
};

type PurchaseProgressDraft = {
  orderedQty: string;
  receivedQty: string;
  stockedQty: string;
  purchasePrice: string;
  actualSupplier: string;
};

function purchaseItemKey(item: { identityKey?: string; model: string; supplier: string }) {
  return item.identityKey || `${item.model}|${item.supplier}`;
}

const tabOptions: Array<{ value: TabKey; label: string }> = [
  { value: 'items', label: '型号' },
  { value: 'purchase', label: '采购' },
  { value: 'todos', label: '待办' },
];

export function OrderDetailDrawer({ order, open, onClose, onSaved }: OrderDetailDrawerProps) {
  const [localOrder, setLocalOrder] = useState<Order | null>(order);
  const [tab, setTab] = useState<TabKey>('items');
  const [confirmingPurchase, setConfirmingPurchase] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progressDrafts, setProgressDrafts] = useState<Record<string, PurchaseProgressDraft>>({});
  const previousOrderIdRef = useRef<string | null>(null);

  useEffect(() => {
    const nextOrderId = order?.id ?? null;
    const changedOrder = nextOrderId !== previousOrderIdRef.current;
    previousOrderIdRef.current = nextOrderId;
    setLocalOrder(order);
    setProgressDrafts(Object.fromEntries((order?.purchaseList || []).map((item) => [
      purchaseItemKey(item),
      {
        orderedQty: String(item.orderedQty ?? (item.purchased ? item.plannedQty ?? item.needToBuy : 0) ?? 0),
        receivedQty: String(item.receivedQty ?? 0),
        stockedQty: String(item.stockedQty ?? 0),
        purchasePrice: String(item.purchasePrice ?? 0),
        actualSupplier: item.actualSupplier || item.supplier || '',
      },
    ])));
    if (changedOrder) {
      setTab('items');
      setConfirmingPurchase(false);
    }
    setMessage('');
    setError('');
  }, [order]);

  const progress = useMemo(() => (
    localOrder
      ? orderPurchaseProgress(localOrder)
      : { needCount: 0, plannedQty: 0, orderedQty: 0, receivedQty: 0, stockedQty: 0 }
  ), [localOrder]);
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

  async function handleStatus(status: OrderStatus, reason?: string) {
    if (!localOrder) return;
    await runAction(() => setOrderStatus(localOrder, status, reason), `订单状态已更新为 ${status}`);
  }

  async function handleSavePurchaseProgress(item: Order['purchaseList'][number]) {
    if (!localOrder) return;
    const key = purchaseItemKey(item);
    const draft = progressDrafts[key];
    if (!draft) return;
    const plannedQty = Number(item.plannedQty ?? item.needToBuy) || 0;
    const orderedQty = Number(draft.orderedQty) || 0;
    const allowOverPurchase = orderedQty > plannedQty
      ? window.confirm(`下单数量 ${orderedQty} 超过计划数量 ${plannedQty}，确认超采吗？`)
      : false;
    if (orderedQty > plannedQty && !allowOverPurchase) return;

    setSaving(true);
    setError('');
    try {
      const result = await updateOrderPurchaseItem(localOrder, item, {
        orderedQty,
        receivedQty: Number(draft.receivedQty) || 0,
        stockedQty: Number(draft.stockedQty) || 0,
        purchasePrice: Number(draft.purchasePrice) || 0,
        actualSupplier: draft.actualSupplier,
        allowOverPurchase,
      });
      setLocalOrder(result.order);
      setMessage(result.stockAddition
        ? `已入库 ${result.stockAddition.addQty}，采购进度已保存`
        : '采购进度已保存');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '采购进度保存失败');
    } finally {
      setSaving(false);
    }
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
    return localOrder.purchaseList
      .map((item) => ({
        ...item,
        remainingQty: Math.max(
          0,
          Math.max(
            Number(item.plannedQty ?? item.needToBuy),
            Number(item.orderedQty || 0)
          ) - Number(item.stockedQty || 0)
        ),
      }))
      .filter((item) => item.remainingQty > 0 && item.partId);
  }, [localOrder]);

  return (
    <SlideOver open={open && Boolean(localOrder)} onClose={onClose} size="workspace">
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
              <span className="inline-flex items-center gap-1"><ShoppingCart size={14} /> {progress.stockedQty}/{progress.plannedQty}</span>
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
                <div className="grid gap-3 rounded-panel border border-line bg-slate-50 p-4 text-sm md:grid-cols-4">
                  <div>
                    <div className="text-xs text-muted">计划采购</div>
                    <div className="mt-1 font-semibold text-ink">{progress.plannedQty}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">已下单</div>
                    <div className="mt-1 font-semibold text-ink">{progress.orderedQty}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">已到货</div>
                    <div className="mt-1 font-semibold text-ink">{progress.receivedQty}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">已入库</div>
                    <div className="mt-1 font-semibold text-ink">{progress.stockedQty}</div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-panel border border-line">
                  <table className="min-w-[820px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-muted">
                      <tr>
                        <th className="px-3 py-2">型号</th>
                        <th className="px-3 py-2 text-right">计划</th>
                        <th className="px-3 py-2 text-right">下单</th>
                        <th className="px-3 py-2 text-right">到货</th>
                        <th className="px-3 py-2 text-right">入库</th>
                        <th className="px-3 py-2 text-right">采购单价</th>
                        <th className="px-3 py-2">实际供应商</th>
                        <th className="px-3 py-2 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {localOrder.purchaseList.map((item) => {
                        const key = purchaseItemKey(item);
                        const draft = progressDrafts[key];
                        const editable = localOrder.status === '待采购' || localOrder.status === '采购中';
                        const setDraft = (field: keyof PurchaseProgressDraft, value: string) => {
                          setProgressDrafts((current) => ({
                            ...current,
                            [key]: { ...current[key], [field]: value },
                          }));
                        };
                        return (
                          <tr key={key} className="border-t border-line">
                            <td className="px-3 py-2">
                              <div className="font-medium text-ink">{item.model}</div>
                              <div className="mt-0.5 text-xs text-muted">
                                {item.name} · {item.supplier || '-'}
                                {item.specification ? ` · ${item.specification}` : ''}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-medium">
                              {item.plannedQty ?? item.needToBuy}{item.purchaseUnit ? ` ${item.purchaseUnit}` : ''}
                            </td>
                            {(['orderedQty', 'receivedQty', 'stockedQty', 'purchasePrice'] as const).map((field) => (
                              <td key={field} className="px-1.5 py-2">
                              <input
                                type="number"
                                min="0"
                                step={field === 'purchasePrice' ? '0.01' : '1'}
                                value={draft?.[field] ?? '0'}
                                disabled={saving || !editable}
                                onChange={(event) => setDraft(field, event.target.value)}
                                className="h-8 w-16 rounded-md border border-line px-2 text-right text-sm outline-none focus:border-sky-400 disabled:bg-slate-50"
                              />
                              </td>
                            ))}
                            <td className="px-1.5 py-2">
                              <input
                                value={draft?.actualSupplier ?? ''}
                                disabled={saving || !editable}
                                onChange={(event) => setDraft('actualSupplier', event.target.value)}
                                className="h-8 w-28 rounded-md border border-line px-2 text-sm outline-none focus:border-sky-400 disabled:bg-slate-50"
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={saving || !editable || Number(item.plannedQty ?? item.needToBuy) <= 0}
                                onClick={() => void handleSavePurchaseProgress(item)}
                                icon={<Save size={14} />}
                              >
                                保存
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
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
            {localOrder.status === '待确认' && (
              <Button
                disabled={saving}
                onClick={() => void handleStatus('待采购')}
              >
                确认订单
              </Button>
            )}
            {(localOrder.status === '待采购' || localOrder.status === '采购中') && purchaseAdditions.length > 0 && (
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => setConfirmingPurchase(true)}
              >
                全部到货并入库
              </Button>
            )}
            {localOrder.status === '采购完成' && (
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => void handleStatus('已关闭')}
              >
                关闭订单
              </Button>
            )}
            {(['待确认', '待采购', '采购中'] as OrderStatus[]).includes(localOrder.status) && (
              <Button
                variant="danger"
                disabled={saving}
                onClick={() => {
                  const reason = window.prompt('请输入取消订单原因');
                  if (reason?.trim()) void handleStatus('已取消', reason.trim());
                }}
              >
                取消订单
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
                  <h3 className="mt-2 text-lg font-semibold tracking-tight text-ink">全部到货并入库</h3>
                  <div className="mt-1 text-sm text-muted">将剩余计划数量一次性登记为已下单、已到货和已入库，订单进入采购完成。</div>
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
                          <td className="px-3 py-2 text-right font-semibold text-ink">+{item.remainingQty}</td>
                          <td className="px-3 py-2 text-right text-muted">{Number(item.currentStock || 0) + item.remainingQty}</td>
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
