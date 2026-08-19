'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ClipboardList, PackageCheck, RefreshCw, Save, ShoppingCart, X } from 'lucide-react';
import {
  buildCompleteOrderPurchaseDraft,
  buildOrderPurchaseItemProgressDraft,
  completeOrderPurchase,
  orderPurchaseProgress,
  setOrderStatus,
  toggleOrderTodoItem,
  updateOrderPurchaseItem,
  type CompletePurchaseDraft,
  type Order,
  type OrderInventoryDisposition,
  type OrderStatus,
  type PurchaseItemProgressDraft,
  type PurchaseItemProgressInput,
} from '@/lib/orders';
import { money } from '@/lib/format';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  getOrderReadiness,
  getOrderReadinessPlan,
  type OrderReadinessDetail,
  type OrderReadinessPlan,
  type OrderReadinessVerdict,
} from '@/lib/order-readiness';
import { replacePageLocation } from '@/lib/page-context';
import { OrderRequirementsPanel } from '@/components/order-requirements-panel';
import { OrderExecutionRecordsPanel } from '@/components/order-execution-records-panel';

type OrderDetailDrawerProps = {
  order: Order | null;
  open: boolean;
  initialTab?: TabKey;
  onClose: () => void;
  onSaved: () => void;
};

type TabKey = 'requirements' | 'readiness' | 'execution' | 'items' | 'purchase' | 'todos';

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

type PurchaseProgressConfirmTarget =
  | {
    kind: 'over-purchase';
    item: Order['purchaseList'][number];
    plannedQty: number;
    orderedQty: number;
  }
  | {
    kind: 'stock-addition';
    item: Order['purchaseList'][number];
    progressInput: PurchaseItemProgressInput;
    commandDraft: PurchaseItemProgressDraft;
  };

function purchaseItemKey(item: { identityKey?: string; model: string; supplier: string }) {
  return item.identityKey || `${item.model}|${item.supplier}`;
}

function purchasePriceDraftValue(item: Order['purchaseList'][number]) {
  if (item.purchasePriceRecorded || Number(item.purchasePrice || 0) > 0) {
    return String(Number(item.purchasePrice || 0));
  }
  return String(Number(item.referencePrice || 0));
}

function referencePriceSourceLabel(item: Order['purchaseList'][number]) {
  if (item.referencePriceSource === 'part_catalog') return '零件库';
  if (item.referencePriceSource === 'coil_total_cost') return '线圈页总成本';
  return '';
}

const tabOptions: Array<{ value: TabKey; label: string }> = [
  { value: 'requirements', label: '客户要求' },
  { value: 'readiness', label: '生产准备' },
  { value: 'execution', label: '执行档案' },
  { value: 'items', label: '型号' },
  { value: 'purchase', label: '采购' },
  { value: 'todos', label: '待办' },
];

const verdictMeta: Record<OrderReadinessVerdict, { label: string; tone: StatusBadgeTone }> = {
  ready: { label: '可生产', tone: 'green' },
  waiting_materials: { label: '待补料', tone: 'amber' },
  needs_review: { label: '待复核', tone: 'orange' },
  blocked: { label: '数据阻塞', tone: 'red' },
  not_applicable: { label: '不适用', tone: 'slate' },
};

function stepTone(status: string): StatusBadgeTone {
  if (status === 'pass' || status === 'available') return 'green';
  if (status === 'warning' || status === 'waiting' || status === 'needs_input') return 'amber';
  if (status === 'fail' || status === 'blocked') return 'red';
  return 'slate';
}

function modeLabel(mode: string) {
  if (mode === 'confirmable') return 'AI可确认';
  if (mode === 'manual') return '人工处理';
  if (mode === 'needs_input') return '需要决定';
  if (mode === 'monitor') return '等待跟进';
  return mode || '处理';
}

function ReadinessPanel({
  readiness,
  plan,
  loading,
  error,
  onRefresh,
}: {
  readiness: OrderReadinessDetail | null;
  plan: OrderReadinessPlan | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  if (loading && !readiness) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-md bg-slate-100" />)}
      </div>
    );
  }

  if (error && !readiness) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (!readiness) return null;
  const verdict = verdictMeta[readiness.verdict] || verdictMeta.not_applicable;
  const stepTitles = new Map((plan?.steps || []).map((item) => [item.id, item.title]));

  return (
    <div className="space-y-5">
      <section className="rounded-panel border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-ink">实时生产准备结论</div>
              <StatusBadge tone={verdict.tone}>{verdict.label}</StatusBadge>
            </div>
            <div className="mt-2 text-sm leading-6 text-muted">{readiness.summary}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="刷新生产准备检查"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
        <div className="grid gap-3 p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div><div className="text-xs text-muted">产品数量</div><div className="mt-1 font-semibold text-ink">{readiness.metrics.totalUnits} 台</div></div>
          <div><div className="text-xs text-muted">物料行</div><div className="mt-1 font-semibold text-ink">{readiness.metrics.materialLineCount}</div></div>
          <div><div className="text-xs text-muted">缺料项</div><div className="mt-1 font-semibold text-ink">{readiness.metrics.shortageLineCount}</div></div>
          <div><div className="text-xs text-muted">毛利</div><div className="mt-1 font-semibold text-ink">{money(readiness.metrics.grossProfit)}</div></div>
        </div>
      </section>

      {error ? <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</div> : null}

      <section>
        <div className="mb-2 text-sm font-semibold text-ink">六步检查依据</div>
        <div className="divide-y divide-line border-y border-line">
          {readiness.steps.map((item) => (
            <div key={item.key} className="flex items-start gap-3 py-3">
              <StatusBadge tone={stepTone(item.status)} className="h-5 min-w-12 px-2">
                {item.status === 'pass' ? '通过' : item.status === 'warning' ? '注意' : item.status === 'fail' ? '阻塞' : '跳过'}
              </StatusBadge>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{item.label}</div>
                <div className="mt-1 text-xs leading-5 text-muted">{item.summary}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {(readiness.blockers.length > 0 || readiness.warnings.length > 0) ? (
        <section>
          <div className="mb-2 text-sm font-semibold text-ink">问题明细</div>
          <div className="divide-y divide-line border-y border-line">
            {[...readiness.blockers, ...readiness.warnings].map((item, index) => (
              <div key={`${item.code}-${index}`} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={index < readiness.blockers.length ? 'red' : 'amber'} className="h-5 min-w-12 px-2">
                    {index < readiness.blockers.length ? '阻塞' : '复核'}
                  </StatusBadge>
                  <div className="text-sm font-medium text-ink">{item.title}</div>
                </div>
                <div className="mt-1 text-xs leading-5 text-muted">{item.detail}</div>
                <div className="mt-1 text-xs text-slate-700">建议：{item.action}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {readiness.shortages.length > 0 ? (
        <section>
          <div className="mb-2 text-sm font-semibold text-ink">实时缺料</div>
          <div className="overflow-x-auto rounded-panel border border-line">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">物料</th>
                  <th className="px-3 py-2 text-right">需求</th>
                  <th className="px-3 py-2 text-right">可用库存</th>
                  <th className="px-3 py-2 text-right">缺口</th>
                  <th className="px-3 py-2">采购阶段</th>
                </tr>
              </thead>
              <tbody>
                {readiness.shortages.map((item) => (
                  <tr key={item.identityKey || `${item.model}|${item.supplier}`} className="border-t border-line">
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{item.model}</div>
                      <div className="mt-0.5 text-xs text-muted">{item.supplier || '-'}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{item.requiredQty}</td>
                    <td className="px-3 py-2 text-right">{item.availableQty}</td>
                    <td className="px-3 py-2 text-right font-semibold text-rose-700">{item.shortageQty}{item.purchaseUnit}</td>
                    <td className="px-3 py-2 text-muted">{item.procurementStage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-ink">处理方案</div>
            <div className="mt-1 text-xs text-muted">{plan?.summary || '当前没有需要处理的步骤。'}</div>
          </div>
          <StatusBadge tone={plan?.planStatus === 'complete' ? 'green' : plan?.planStatus === 'needs_resolution' ? 'red' : 'amber'}>
            {plan?.steps.length || 0} 步
          </StatusBadge>
        </div>
        {plan?.steps.length ? (
          <div className="divide-y divide-line border-y border-line">
            {plan.steps.map((item) => {
              const dependencies = item.dependsOn.map((id) => stepTitles.get(id) || id);
              return (
                <div key={item.id} className="flex gap-3 py-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-900 text-xs font-semibold text-white">
                    {item.sequence}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-ink">{item.title}</div>
                      <StatusBadge tone={stepTone(item.status)} className="h-5 min-w-0 px-2">{modeLabel(item.mode)}</StatusBadge>
                      {item.status === 'blocked' ? <StatusBadge tone="red" className="h-5 min-w-0 px-2">有前置步骤</StatusBadge> : null}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted">{item.reason}</div>
                    <div className="mt-1 text-xs text-slate-700">完成标准：{item.expectedResult}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                      <span>负责人：{item.owner}</span>
                      {dependencies.length > 0 ? <span>前置：{dependencies.join('、')}</span> : null}
                      {item.path && item.path !== '/orders' ? (
                        <a href={item.path} className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-950">
                          打开处理页面
                          <ArrowUpRight size={12} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border-y border-line py-6 text-center text-sm text-muted">无需新增处理步骤</div>
        )}
      </section>
    </div>
  );
}

export function OrderDetailDrawer({ order, open, initialTab = 'items', onClose, onSaved }: OrderDetailDrawerProps) {
  const [localOrder, setLocalOrder] = useState<Order | null>(order);
  const [tab, setTab] = useState<TabKey>('items');
  const [confirmingPurchase, setConfirmingPurchase] = useState(false);
  const [completePurchaseDraft, setCompletePurchaseDraft] = useState<CompletePurchaseDraft | null>(null);
  const [purchaseDraftLoading, setPurchaseDraftLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progressDrafts, setProgressDrafts] = useState<Record<string, PurchaseProgressDraft>>({});
  const [readiness, setReadiness] = useState<OrderReadinessDetail | null>(null);
  const [readinessPlan, setReadinessPlan] = useState<OrderReadinessPlan | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState('');
  const [purchaseConfirmTarget, setPurchaseConfirmTarget] = useState<PurchaseProgressConfirmTarget | null>(null);
  const [closeDispositionTarget, setCloseDispositionTarget] = useState<{
    disposition: OrderInventoryDisposition;
    note: string;
  } | null>(null);
  const previousOrderIdRef = useRef<string | null>(null);
  const readinessRequestRef = useRef(0);
  const procurementVariance = useMemo(() => (localOrder?.purchaseList || []).reduce((sum, item) => {
    const plannedQty = Number(item.plannedQty ?? item.needToBuy ?? 0);
    const orderedQty = Number(item.orderedQty ?? (item.purchased ? plannedQty : 0));
    if (item.purchasePriceRecorded !== true || Number(item.referencePrice || 0) <= 0 || orderedQty <= 0) {
      return sum;
    }
    return sum + (Number(item.purchasePrice || 0) - Number(item.referencePrice || 0)) * orderedQty;
  }, 0), [localOrder?.purchaseList]);

  async function loadReadiness(orderId: string) {
    const requestId = ++readinessRequestRef.current;
    setReadinessLoading(true);
    setReadinessError('');
    try {
      const [nextReadiness, nextPlan] = await Promise.all([
        getOrderReadiness(orderId),
        getOrderReadinessPlan(orderId),
      ]);
      if (requestId !== readinessRequestRef.current) return;
      setReadiness(nextReadiness);
      setReadinessPlan(nextPlan);
    } catch (err) {
      if (requestId !== readinessRequestRef.current) return;
      setReadinessError(err instanceof Error ? err.message : '生产准备检查加载失败');
    } finally {
      if (requestId === readinessRequestRef.current) setReadinessLoading(false);
    }
  }

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
        purchasePrice: purchasePriceDraftValue(item),
        actualSupplier: item.actualSupplier || item.supplier || '',
      },
    ])));
    if (changedOrder) {
      setTab(initialTab);
      setConfirmingPurchase(false);
      setCompletePurchaseDraft(null);
      setPurchaseDraftLoading(false);
      setReadiness(null);
      setReadinessPlan(null);
      setPurchaseConfirmTarget(null);
      setCloseDispositionTarget(null);
    }
    if (order?.id) {
      void loadReadiness(order.id);
    } else {
      readinessRequestRef.current += 1;
      setReadinessLoading(false);
    }
    setMessage('');
    setError('');
  }, [order, initialTab]);

  function selectTab(nextTab: TabKey) {
    setTab(nextTab);
    if (localOrder) {
      replacePageLocation(`/orders?orderId=${localOrder.id}&view=${nextTab}`);
    }
  }

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

  async function handleStatus(
    status: OrderStatus,
    reason?: string,
    inventoryDisposition?: OrderInventoryDisposition,
    inventoryDispositionNote?: string
  ) {
    if (!localOrder) return;
    await runAction(
      () => setOrderStatus(localOrder, status, reason, inventoryDisposition, inventoryDispositionNote),
      `订单状态已更新为 ${status}`
    );
  }

  async function commitPurchaseProgress(
    item: Order['purchaseList'][number],
    progressInput: PurchaseItemProgressInput,
    commandDraft: PurchaseItemProgressDraft
  ) {
    if (!localOrder) return;
    setPurchaseConfirmTarget(null);
    setSaving(true);
    setError('');
    try {
      const result = await updateOrderPurchaseItem(
        localOrder,
        item,
        progressInput,
        commandDraft
      );
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

  async function handleSavePurchaseProgress(
    item: Order['purchaseList'][number],
    allowOverPurchase = false
  ) {
    if (!localOrder) return;
    const key = purchaseItemKey(item);
    const draft = progressDrafts[key];
    if (!draft) return;
    const plannedQty = Number(item.plannedQty ?? item.needToBuy) || 0;
    const orderedQty = Number(draft.orderedQty) || 0;
    if (orderedQty > plannedQty && !allowOverPurchase) {
      setPurchaseConfirmTarget({ kind: 'over-purchase', item, plannedQty, orderedQty });
      return;
    }

    setSaving(true);
    setError('');
    try {
      const progressInput: PurchaseItemProgressInput = {
        orderedQty,
        receivedQty: Number(draft.receivedQty) || 0,
        stockedQty: Number(draft.stockedQty) || 0,
        purchasePrice: Number(draft.purchasePrice) || 0,
        actualSupplier: draft.actualSupplier,
        allowOverPurchase,
      };
      const commandDraft = await buildOrderPurchaseItemProgressDraft(
        localOrder,
        item,
        progressInput
      );
      if (commandDraft.stockAddition) {
        setPurchaseConfirmTarget({
          kind: 'stock-addition',
          item,
          progressInput,
          commandDraft,
        });
        return;
      }
      await commitPurchaseProgress(item, progressInput, commandDraft);
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
      const result = await completeOrderPurchase(localOrder, completePurchaseDraft || undefined);
      setLocalOrder(result.order);
      setCompletePurchaseDraft(null);
      const inventoryCount = result.additions.filter((item) => item.inventoryType !== 'none').length;
      const nonStockCount = result.additions.length - inventoryCount;
      setMessage(
        `入库完成，更新 ${inventoryCount} 种物料库存`
        + (nonStockCount > 0 ? `，另完成 ${nonStockCount} 项非库存采购进度` : '')
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '入库失败');
    } finally {
      setSaving(false);
    }
  }

  async function openCompletePurchaseConfirmation() {
    if (!localOrder) return;
    setPurchaseDraftLoading(true);
    setError('');
    try {
      const draft = await buildCompleteOrderPurchaseDraft(localOrder);
      setCompletePurchaseDraft(draft);
      setConfirmingPurchase(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '入库预览生成失败');
    } finally {
      setPurchaseDraftLoading(false);
    }
  }

  const pendingPurchaseAdditions = useMemo(() => {
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
      .filter((item) => item.remainingQty > 0);
  }, [localOrder]);
  const purchaseAdditions = completePurchaseDraft?.additions || [];

  return (
    <>
    <SlideOver
      open={open && Boolean(localOrder)}
      onClose={onClose}
      size="workspace"
      closeOnBackdrop={false}
    >
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

          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <SegmentedControl
                value={tab}
                options={tabOptions}
                onChange={selectTab}
                ariaLabel="订单详情分区"
                className="w-max"
              />
            </div>
            <div className="hidden items-center gap-3 text-xs text-muted md:flex">
              <span className="inline-flex items-center gap-1"><PackageCheck size={14} /> {localOrder.items.length}</span>
              <span className="inline-flex items-center gap-1"><ShoppingCart size={14} /> {progress.stockedQty}/{progress.plannedQty}</span>
              <span className="inline-flex items-center gap-1"><ClipboardList size={14} /> {localOrder.todos.length}</span>
            </div>
          </div>

          <main className="flex-1 space-y-4 p-5">
            {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            {message && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>}

            {tab === 'readiness' && (
              <ReadinessPanel
                readiness={readiness}
                plan={readinessPlan}
                loading={readinessLoading}
                error={readinessError}
                onRefresh={() => {
                  if (localOrder) void loadReadiness(localOrder.id);
                }}
              />
            )}

            {tab === 'requirements' && (
              <OrderRequirementsPanel
                orderId={Number(localOrder.id)}
                contractNo={localOrder.contractNo}
                customerName={localOrder.customerName}
              />
            )}

            {tab === 'execution' && (
              <OrderExecutionRecordsPanel
                orderId={Number(localOrder.id)}
                contractNo={localOrder.contractNo}
                customerName={localOrder.customerName}
              />
            )}

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
                <div className="grid gap-3 rounded-panel border border-line bg-slate-50 p-4 text-sm md:grid-cols-4">
                  <div>锁定成本 <b className="text-ink">{money(localOrder.totalCost)}</b></div>
                  <div>采购价差 <b className={procurementVariance > 0 ? 'text-rose-700' : 'text-emerald-700'}>{money(procurementVariance)}</b></div>
                  <div>总出厂价 <b className="text-ink">{money(localOrder.totalPrice)}</b></div>
                  <div>调整后利润 <b className="text-ink">{money(localOrder.totalProfit - procurementVariance)}</b></div>
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
                        <th className="px-3 py-2 text-right">实际采购单价</th>
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
                            {(['orderedQty', 'receivedQty', 'stockedQty', 'purchasePrice'] as const).map((field) => {
                              const referenceSource = referencePriceSourceLabel(item);
                              return (
                                <td key={field} className="px-1.5 py-2 align-top">
                                  <input
                                    type="number"
                                    min="0"
                                    step={field === 'purchasePrice' ? '0.01' : '1'}
                                    value={draft?.[field] ?? '0'}
                                    disabled={saving || !editable}
                                    onChange={(event) => setDraft(field, event.target.value)}
                                    className="h-8 w-20 rounded-md border border-line px-2 text-right text-sm outline-none focus:border-sky-400 disabled:bg-slate-50"
                                  />
                                  {field === 'purchasePrice' ? (
                                    <div className="mt-1 whitespace-nowrap text-right text-[11px] text-muted">
                                      {referenceSource && Number(item.referencePrice || 0) > 0
                                        ? `参考 ${referenceSource} ¥${Number(item.referencePrice).toFixed(2)}`
                                        : '无参考价'}
                                    </div>
                                  ) : null}
                                </td>
                              );
                            })}
                            <td className="px-1.5 py-2 align-top">
                              <input
                                value={draft?.actualSupplier ?? ''}
                                disabled={saving || !editable}
                                onChange={(event) => setDraft('actualSupplier', event.target.value)}
                                className="h-8 w-28 rounded-md border border-line px-2 text-sm outline-none focus:border-sky-400 disabled:bg-slate-50"
                              />
                            </td>
                            <td className="px-3 py-2 text-right align-top">
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
                        <Checkbox
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
                        <Checkbox
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
            {(localOrder.status === '待采购' || localOrder.status === '采购中') && pendingPurchaseAdditions.length > 0 && (
              <Button
                variant="primary"
                disabled={saving || purchaseDraftLoading}
                onClick={() => void openCompletePurchaseConfirmation()}
              >
                {purchaseDraftLoading ? '生成入库预览...' : '全部到货并入库'}
              </Button>
            )}
            {localOrder.status === '采购完成' && (
              <>
                <Button
                  variant="primary"
                  disabled={saving}
                  onClick={() => setCloseDispositionTarget({
                    disposition: 'manual_outbound_confirmed',
                    note: '',
                  })}
                >
                  已领用出库并关闭
                </Button>
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    const note = window.prompt('请输入释放库存预留的原因');
                    if (note?.trim()) {
                      setCloseDispositionTarget({
                        disposition: 'reservation_released',
                        note: note.trim(),
                      });
                    }
                  }}
                >
                  释放预留并关闭
                </Button>
              </>
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
                  这是采购入库操作。请确认物料已实际到货；生产领用不会自动扣减库存，实际领料仍需在库存页面登记出库。
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
                        <th className="px-3 py-2">库存类型</th>
                        <th className="px-3 py-2">名称</th>
                        <th className="px-3 py-2">供应商</th>
                        <th className="px-3 py-2 text-right">当前库存</th>
                        <th className="px-3 py-2 text-right">入库数量</th>
                        <th className="px-3 py-2 text-right">入库后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseAdditions.map((item) => {
                        const inventoryType = item.inventoryType === 'coil'
                          ? '线圈'
                          : item.inventoryType === 'none'
                            ? '非库存项'
                            : '零件';
                        const tracksInventory = item.inventoryType !== 'none';
                        return (
                        <tr key={purchaseItemKey(item)} className="border-t border-line">
                          <td className="px-3 py-2 font-medium text-ink">{item.model}</td>
                          <td className="px-3 py-2 text-muted">{inventoryType}</td>
                          <td className="px-3 py-2 text-muted">{item.name || '-'}</td>
                          <td className="px-3 py-2 text-muted">{item.supplier || '-'}</td>
                          <td className="px-3 py-2 text-right text-muted">
                            {tracksInventory ? item.currentStock : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-ink">
                            +{item.addQty}{item.purchaseUnit ? ` ${item.purchaseUnit}` : ''}
                          </td>
                          <td className="px-3 py-2 text-right text-muted">
                            {tracksInventory ? item.stockAfter : '-'}
                          </td>
                        </tr>
                        );
                      })}
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
    <ConfirmDialog
      open={Boolean(purchaseConfirmTarget)}
      title={purchaseConfirmTarget?.kind === 'over-purchase'
        ? '确认超计划下单？'
        : '确认登记采购入库？'}
      description={purchaseConfirmTarget?.kind === 'over-purchase'
        ? `物料“${purchaseConfirmTarget.item.model}”的下单数量 ${purchaseConfirmTarget.orderedQty} 超过计划数量 ${purchaseConfirmTarget.plannedQty}。确认后系统会按超采数量保存采购进度。`
        : purchaseConfirmTarget?.kind === 'stock-addition' && purchaseConfirmTarget.commandDraft.stockAddition
          ? (() => {
            const addition = purchaseConfirmTarget.commandDraft.stockAddition;
            const inventoryLabel = addition.inventoryType === 'coil'
              ? '线圈库存'
              : addition.inventoryType === 'part'
                ? '零件库存'
                : '采购进度（非库存项）';
            const convertedQuantity = addition.inventoryAddQty !== addition.addQty
              ? `，折算库存增加 ${addition.inventoryAddQty}`
              : '';
            const stockAfter = addition.stockAfter === null
              ? ''
              : `，入库后库存 ${addition.stockAfter}`;
            return `物料“${purchaseConfirmTarget.item.model}”将登记入库 ${addition.addQty}${addition.purchaseUnit || ''}，并更新${inventoryLabel}${convertedQuantity}${stockAfter}。`;
          })()
          : ''}
      confirmLabel={purchaseConfirmTarget?.kind === 'over-purchase' ? '确认超采' : '确认入库'}
      confirmVariant={purchaseConfirmTarget?.kind === 'over-purchase' ? 'danger' : 'primary'}
      busy={saving}
      layer="top"
      onClose={() => setPurchaseConfirmTarget(null)}
      onConfirm={() => {
        const target = purchaseConfirmTarget;
        if (target?.kind === 'over-purchase') {
          setPurchaseConfirmTarget(null);
          void handleSavePurchaseProgress(target.item, true);
        } else if (target?.kind === 'stock-addition') {
          void commitPurchaseProgress(target.item, target.progressInput, target.commandDraft);
        }
      }}
    />
    <ConfirmDialog
      open={Boolean(closeDispositionTarget)}
      title={closeDispositionTarget?.disposition === 'manual_outbound_confirmed'
        ? '确认已完成领用出库？'
        : '确认释放库存预留？'}
      description={closeDispositionTarget?.disposition === 'manual_outbound_confirmed'
        ? '系统只记录仓库已经在线下完成领用出库，不会再次自动扣减库存。确认后订单关闭并释放其计划占用。'
        : `系统不会扣减库存，订单关闭后释放其计划占用。原因：${closeDispositionTarget?.note || '-'}`}
      confirmLabel="确认并关闭"
      confirmVariant={closeDispositionTarget?.disposition === 'manual_outbound_confirmed' ? 'primary' : 'danger'}
      busy={saving}
      layer="top"
      onClose={() => setCloseDispositionTarget(null)}
      onConfirm={() => {
        const target = closeDispositionTarget;
        if (!target) return;
        setCloseDispositionTarget(null);
        void handleStatus('已关闭', undefined, target.disposition, target.note);
      }}
    />
    </>
  );
}
