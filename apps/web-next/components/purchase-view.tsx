'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { CircleAlert, PackageCheck, RefreshCw, ShoppingCart, Truck } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { PresenceRow } from '@/components/motion/presence-row';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ListToolbar } from '@/components/ui/list-toolbar';
import { MetricCard, MetricGrid } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { TableScrollArea } from '@/components/ui/table-scroll-area';
import {
  applyPurchaseTask,
  buildPurchaseBatchDraft,
  buildPurchaseStats,
  buildPurchaseTasks,
  getPurchaseOrders,
  purchaseSourceOrders,
  statusText,
  taskStatus,
  type PurchaseFilter,
  type PurchaseBatchDraft,
  type PurchaseTask,
} from '@/lib/purchase';
import type { Order } from '@/lib/orders';

const filterOptions: Array<{ value: PurchaseFilter; label: string }> = [
  { value: 'pending', label: '待采购' },
  { value: 'partial', label: '处理中' },
  { value: 'purchased', label: '已入库' },
  { value: 'all', label: '全部' },
];

const statusTones: Record<Exclude<PurchaseFilter, 'all'>, StatusBadgeTone> = {
  pending: 'amber',
  partial: 'blue',
  purchased: 'green',
};

function TaskStatusBadge({ task }: { task: PurchaseTask }) {
  const status = taskStatus(task);
  return (
    <StatusBadge tone={statusTones[status]}>{statusText(status)}</StatusBadge>
  );
}

export function PurchaseView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PurchaseFilter>('pending');
  const [confirmTarget, setConfirmTarget] = useState<{
    task: PurchaseTask;
    purchased: boolean;
    draft: PurchaseBatchDraft;
    totalChange: number;
  } | null>(null);

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      setOrders(await getPurchaseOrders());
    } catch (err) {
      setError(err instanceof Error ? err.message : '采购数据加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const tasks = useMemo(() => buildPurchaseTasks(orders), [orders]);
  const stats = useMemo(() => buildPurchaseStats(orders, tasks), [orders, tasks]);

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const status = taskStatus(task);
      const sourceText = purchaseSourceOrders(task)
        .map((order) => `${order.customerName} ${order.contractNo || ''} ${order.id}`)
        .join(' ');
      const text = `${task.supplierLabel} ${task.model} ${task.name} ${sourceText}`.toLowerCase();
      return (filter === 'all' || status === filter) && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [filter, query, tasks]);

  async function saveTask(task: PurchaseTask, purchased: boolean) {
    setSavingKey(task.key);
    setError(null);

    try {
      const draft = await buildPurchaseBatchDraft(task, purchased);
      if (draft.affectedOrders.length === 0) {
        throw new Error('当前采购任务已经变化，请刷新后重试');
      }
      const totalChange = draft.affectedOrders.reduce(
        (sum, order) => sum + Math.abs(order.afterOrderedQty - order.beforeOrderedQty),
        0
      );
      setConfirmTarget({ task, purchased, draft, totalChange });
    } catch (err) {
      setError(err instanceof Error ? err.message : '采购状态保存失败');
    } finally {
      setSavingKey(null);
    }
  }

  async function applyConfirmedTask() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    setSavingKey(target.task.key);
    setError(null);
    try {
      await applyPurchaseTask(target.task, target.purchased, target.draft);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '采购状态保存失败');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="采购中心"
        description="集中查看待采购、处理中和已入库物料。"
        actions={(
          <Button
            onClick={() => void load(true)}
            disabled={refreshing || Boolean(savingKey)}
            icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}
          >
            刷新
          </Button>
        )}
      />

      <MetricGrid>
        <MetricCard value={String(stats.activeOrderCount)} label="涉及订单" delay={0.02} />
        <MetricCard value={String(stats.supplierCount)} label="供应商" delay={0.04} />
        <MetricCard value={`${stats.purchasedNeed}/${stats.totalNeed || 0}`} label="已下单/计划" delay={0.06} />
        <MetricCard
          value={String(stats.pendingTaskCount)}
          label="待处理任务"
          tone={stats.pendingTaskCount > 0 ? 'attention' : 'default'}
          delay={0.08}
        />
      </MetricGrid>

      <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          searchLabel="搜索采购任务"
          placeholder="搜索供应商、型号、名称或来源订单"
          resultText={`显示 ${filteredTasks.length} / ${tasks.length} 项采购任务`}
          hasActiveFilters={Boolean(query.trim()) || filter !== 'pending'}
          onReset={() => {
            setQuery('');
            setFilter('pending');
          }}
          resetLabel="恢复默认"
          filters={<SegmentedControl value={filter} options={filterOptions} onChange={setFilter} ariaLabel="采购状态筛选" />}
        />

        {error ? (
          <div className="flex items-center gap-2 border-b border-line p-4 text-sm text-rose-700">
            <CircleAlert size={16} />
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
            ))}
          </div>
        ) : filteredTasks.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title={tasks.length === 0 ? '当前没有采购任务' : '当前筛选下没有采购任务'}
            description={tasks.length === 0 ? '订单产生缺料或待采购物料后，会自动汇总到这里。' : '可以调整搜索词、切换状态，或查看全部任务。'}
            action={tasks.length > 0 && !query.trim() && filter === 'pending' ? (
              <Button size="sm" variant="secondary" onClick={() => { setQuery(''); setFilter('all'); }}>查看全部任务</Button>
            ) : null}
          />
        ) : (
          <TableScrollArea label="采购任务列表">
            <table className="w-full min-w-[1240px] border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="border-b border-line px-4 py-3">供应商</th>
                  <th className="border-b border-line px-4 py-3">物料</th>
                  <th className="border-b border-line px-4 py-3">采购来源</th>
                  <th className="border-b border-line px-4 py-3">状态</th>
                  <th className="border-b border-line px-4 py-3 text-right">计划</th>
                  <th className="border-b border-line px-4 py-3 text-right">下单</th>
                  <th className="border-b border-line px-4 py-3 text-right">到货</th>
                  <th className="border-b border-line px-4 py-3 text-right">入库</th>
                  <th className="border-b border-line px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {filteredTasks.map((task) => {
                    const saving = savingKey === task.key;
                    const completed = taskStatus(task) === 'purchased';
                    const sourceOrders = purchaseSourceOrders(task);

                    return (
                      <PresenceRow key={task.key} className="transition-colors hover:bg-slate-50">
                        <td className="border-b border-line px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Truck size={15} className="text-muted" />
                            <span className="font-medium text-ink">{task.supplierLabel}</span>
                          </div>
                        </td>
                        <td className="border-b border-line px-4 py-3">
                          <div className="font-medium text-ink">{task.model}</div>
                          <div className="mt-0.5 text-xs text-muted">
                            {task.name}{task.specification ? ` · ${task.specification}` : ''}
                          </div>
                        </td>
                        <td className="border-b border-line px-4 py-3">
                          <div className="flex max-w-64 flex-wrap gap-1">
                            {sourceOrders.map((order) => (
                              <a
                                key={order.id}
                                href={`/orders?orderId=${encodeURIComponent(order.id)}&view=purchase`}
                                className="inline-flex max-w-40 items-center gap-1 rounded-full border border-line bg-slate-50 px-2 py-1 text-xs transition-colors hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                aria-label={`查看来源订单 ${order.contractNo || `#${order.id}`} 的采购明细`}
                              >
                                <span className="truncate font-medium text-ink">{order.customerName || '未填写客户'}</span>
                                <span className="shrink-0 text-muted">· {order.contractNo || `#${order.id}`}</span>
                              </a>
                            ))}
                          </div>
                        </td>
                        <td className="border-b border-line px-4 py-3">
                          <TaskStatusBadge task={task} />
                        </td>
                        <td className="border-b border-line px-4 py-3 text-right text-muted">{task.totalNeed}{task.purchaseUnit ? ` ${task.purchaseUnit}` : ''}</td>
                        <td className="border-b border-line px-4 py-3 text-right font-medium text-ink">{task.purchasedNeed}{task.purchaseUnit ? ` ${task.purchaseUnit}` : ''}</td>
                        <td className="border-b border-line px-4 py-3 text-right text-muted">{task.receivedNeed}{task.purchaseUnit ? ` ${task.purchaseUnit}` : ''}</td>
                        <td className="border-b border-line px-4 py-3 text-right text-muted">{task.stockedNeed}{task.purchaseUnit ? ` ${task.purchaseUnit}` : ''}</td>
                        <td className="border-b border-line px-4 py-3">
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={completed || task.purchasedNeed >= task.totalNeed || saving || Boolean(savingKey && savingKey !== task.key)}
                              onClick={() => void saveTask(task, true)}
                              icon={<PackageCheck size={14} />}
                            >
                              {saving ? '保存中' : completed ? '已入库' : task.purchasedNeed >= task.totalNeed ? '已下单' : '全部下单'}
                            </Button>
                          </div>
                        </td>
                      </PresenceRow>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </TableScrollArea>
        )}
      </FadePanel>
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={confirmTarget?.purchased ? '确认全部下单？' : '确认取消下单？'}
        description={confirmTarget
          ? `物料“${confirmTarget.task.model}”将影响 ${confirmTarget.draft.affectedOrders.length} 个订单，变更数量合计 ${confirmTarget.totalChange}${confirmTarget.task.purchaseUnit || ''}。确认后将立即更新这些订单的采购进度。`
          : ''}
        confirmLabel={confirmTarget?.purchased ? '确认下单' : '确认取消'}
        confirmVariant={confirmTarget?.purchased ? 'primary' : 'danger'}
        busy={Boolean(savingKey)}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => void applyConfirmedTask()}
      />
    </div>
  );
}
