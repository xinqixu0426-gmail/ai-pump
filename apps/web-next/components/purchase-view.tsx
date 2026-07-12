'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { CircleAlert, PackageCheck, RefreshCw, Search, ShoppingCart, Truck } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { PresenceRow } from '@/components/motion/presence-row';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import {
  applyPurchaseTask,
  buildPurchaseStats,
  buildPurchaseTasks,
  getPurchaseOrders,
  statusText,
  taskStatus,
  type PurchaseFilter,
  type PurchaseTask,
} from '@/lib/purchase';
import type { Order } from '@/lib/orders';

const filterOptions: Array<{ value: PurchaseFilter; label: string }> = [
  { value: 'pending', label: '待采购' },
  { value: 'partial', label: '部分已采' },
  { value: 'purchased', label: '已采购' },
  { value: 'all', label: '全部' },
];

const statusTones: Record<Exclude<PurchaseFilter, 'all'>, StatusBadgeTone> = {
  pending: 'amber',
  partial: 'blue',
  purchased: 'green',
};

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-panel border border-line bg-white p-4 shadow-panel">
      <div className="text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

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
      const text = `${task.supplierLabel} ${task.model} ${task.name}`.toLowerCase();
      return (filter === 'all' || status === filter) && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [filter, query, tasks]);

  async function saveTask(task: PurchaseTask, purchased: boolean) {
    setSavingKey(task.key);
    setError(null);

    try {
      await applyPurchaseTask(task, purchased);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '采购状态保存失败');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-5">
      <FadePanel className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Purchase</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">采购中心</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            按供应商和型号汇总订单采购项，保存后硬刷新订单数据，保持采购状态和订单详情一致。
          </p>
        </div>
        <Button
          onClick={() => void load(true)}
          disabled={refreshing || Boolean(savingKey)}
          icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}
        >
          刷新
        </Button>
      </FadePanel>

      <div className="grid gap-3 md:grid-cols-4">
        <FadePanel delay={0.02}>
          <StatCard value={String(stats.activeOrderCount)} label="涉及订单" />
        </FadePanel>
        <FadePanel delay={0.04}>
          <StatCard value={String(stats.supplierCount)} label="供应商" />
        </FadePanel>
        <FadePanel delay={0.06}>
          <StatCard value={`${stats.purchasedNeed}/${stats.totalNeed || 0}`} label="采购进度" />
        </FadePanel>
        <FadePanel delay={0.08}>
          <StatCard value={String(stats.pendingTaskCount)} label="待处理任务" />
        </FadePanel>
      </div>

      <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3">
            <Search size={16} className="text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索供应商、型号或名称"
              className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
            />
          </div>

          <SegmentedControl value={filter} options={filterOptions} onChange={setFilter} ariaLabel="采购状态筛选" />
        </div>

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
          <div className="p-10 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-muted">
              <ShoppingCart size={18} />
            </div>
            <div className="mt-3 text-sm font-medium text-ink">没有匹配的采购任务</div>
            <div className="mt-1 text-sm text-muted">调整筛选条件或刷新后再看。</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="border-b border-line px-4 py-3">供应商</th>
                  <th className="border-b border-line px-4 py-3">物料</th>
                  <th className="border-b border-line px-4 py-3">状态</th>
                  <th className="border-b border-line px-4 py-3 text-right">总需求</th>
                  <th className="border-b border-line px-4 py-3 text-right">待采</th>
                  <th className="border-b border-line px-4 py-3 text-right">订单</th>
                  <th className="border-b border-line px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {filteredTasks.map((task) => {
                    const saving = savingKey === task.key;
                    const completed = taskStatus(task) === 'purchased';

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
                          <div className="mt-0.5 text-xs text-muted">{task.name}</div>
                        </td>
                        <td className="border-b border-line px-4 py-3">
                          <TaskStatusBadge task={task} />
                        </td>
                        <td className="border-b border-line px-4 py-3 text-right text-muted">{task.totalNeed}</td>
                        <td className="border-b border-line px-4 py-3 text-right font-medium text-ink">{task.pendingNeed}</td>
                        <td className="border-b border-line px-4 py-3 text-right text-muted">{task.orderCount}</td>
                        <td className="border-b border-line px-4 py-3">
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant={completed ? 'ghost' : 'primary'}
                              disabled={saving || Boolean(savingKey && savingKey !== task.key)}
                              onClick={() => void saveTask(task, !completed)}
                              icon={completed ? undefined : <PackageCheck size={14} />}
                            >
                              {saving ? '保存中' : completed ? '取消已采' : '标记已采'}
                            </Button>
                          </div>
                        </td>
                      </PresenceRow>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </FadePanel>
    </div>
  );
}
