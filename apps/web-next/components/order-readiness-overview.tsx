'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, CircleCheckBig, Clock3, ShieldAlert, TriangleAlert } from 'lucide-react';
import type {
  OrderReadinessOverview,
  OrderReadinessOverviewItem,
  OrderReadinessVerdict,
} from '@/lib/order-readiness';
import { FadePanel } from '@/components/motion/fade-panel';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';

type ReadinessFilter = 'attention' | 'blocked' | 'waiting_materials' | 'needs_review' | 'ready';

const VERDICT_META: Record<OrderReadinessVerdict, { label: string; tone: StatusBadgeTone }> = {
  ready: { label: '可生产', tone: 'green' },
  waiting_materials: { label: '待补料', tone: 'amber' },
  needs_review: { label: '待复核', tone: 'orange' },
  blocked: { label: '数据阻塞', tone: 'red' },
  not_applicable: { label: '不适用', tone: 'slate' },
};

function primaryIssue(item: OrderReadinessOverviewItem) {
  if (item.blockers[0]) return item.blockers[0].title;
  if (item.shortages[0]) {
    const shortage = item.shortages[0];
    const extraCount = Math.max(0, item.shortageCount - 1);
    return `${shortage.model} 缺 ${shortage.shortageQty}${shortage.purchaseUnit}${extraCount ? `，另有 ${extraCount} 项` : ''}`;
  }
  if (item.warnings[0]) return item.warnings[0].title;
  return '当前检查项均已通过';
}

export function OrderReadinessOverviewView({
  overview,
  loading,
  error,
}: {
  overview: OrderReadinessOverview | null;
  loading: boolean;
  error: string | null;
}) {
  const [filter, setFilter] = useState<ReadinessFilter>('attention');
  const items = useMemo(() => {
    if (!overview) return [];
    if (filter === 'attention') return overview.items.filter((item) => !['ready', 'not_applicable'].includes(item.verdict));
    return overview.items.filter((item) => item.verdict === filter);
  }, [filter, overview]);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-panel border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        <TriangleAlert size={16} />
        {error}
      </div>
    );
  }

  if (loading || !overview) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-panel bg-slate-100" />)}
        </div>
        <div className="h-80 animate-pulse rounded-panel bg-slate-100" />
      </div>
    );
  }

  const filters: Array<{ value: ReadinessFilter; label: string; badge: number }> = [
    { value: 'attention', label: '需关注', badge: overview.metrics.attentionRequired },
    { value: 'blocked', label: '阻塞', badge: overview.metrics.blocked },
    { value: 'waiting_materials', label: '缺料', badge: overview.metrics.waitingMaterials },
    { value: 'needs_review', label: '复核', badge: overview.metrics.needsReview },
    { value: 'ready', label: '可生产', badge: overview.metrics.ready },
  ];

  const stats = [
    { label: '活动订单', value: overview.metrics.totalActiveOrders, note: '当前未关闭或取消', icon: Clock3, color: 'text-sky-700' },
    { label: '数据阻塞', value: overview.metrics.blocked, note: '先修订单或基础数据', icon: ShieldAlert, color: 'text-rose-700' },
    { label: '待补物料', value: overview.metrics.waitingMaterials, note: '库存尚未覆盖需求', icon: TriangleAlert, color: 'text-amber-700' },
    { label: '可生产', value: overview.metrics.ready, note: '库存和业务检查通过', icon: CircleCheckBig, color: 'text-emerald-700' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <FadePanel key={stat.label} delay={index * 0.02} className="rounded-panel border border-line bg-white p-4 shadow-panel">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-muted">{stat.label}</div>
                  <div className="mt-2 text-2xl font-semibold text-ink">{stat.value}</div>
                  <div className="mt-1 text-xs text-muted">{stat.note}</div>
                </div>
                <Icon size={18} className={stat.color} />
              </div>
            </FadePanel>
          );
        })}
      </div>

      <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">订单生产准备</div>
            <div className="mt-1 text-xs text-muted">{overview.summary}</div>
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="min-w-max">
              <SegmentedControl value={filter} options={filters} onChange={setFilter} ariaLabel="订单准备筛选" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[920px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-muted">
              <tr>
                <th className="border-b border-line px-4 py-3">订单</th>
                <th className="border-b border-line px-4 py-3">状态</th>
                <th className="border-b border-line px-4 py-3">主要问题</th>
                <th className="border-b border-line px-4 py-3">问题数</th>
                <th className="border-b border-line px-4 py-3">下一步</th>
                <th className="border-b border-line px-4 py-3 text-right">查看</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const verdict = VERDICT_META[item.verdict] || VERDICT_META.not_applicable;
                return (
                  <tr key={item.order.id} className="transition-colors hover:bg-slate-50">
                    <td className="border-b border-line px-4 py-3">
                      <div className="font-medium text-ink">#{item.order.id} · {item.order.customerName || '未命名客户'}</div>
                      <div className="mt-1 text-xs text-muted">{item.order.contractNo || '无合同号'} · {item.order.totalUnits} 台</div>
                    </td>
                    <td className="border-b border-line px-4 py-3">
                      <StatusBadge tone={verdict.tone}>{verdict.label}</StatusBadge>
                      <div className="mt-1 text-xs text-muted">{item.order.status}</div>
                    </td>
                    <td className="max-w-[300px] border-b border-line px-4 py-3 text-slate-700">{primaryIssue(item)}</td>
                    <td className="border-b border-line px-4 py-3 text-muted">
                      阻塞 {item.blockerCount} · 缺料 {item.shortageCount} · 复核 {item.warningCount}
                    </td>
                    <td className="border-b border-line px-4 py-3">
                      <div className="font-medium text-ink">{item.nextAction?.title || '无需处理'}</div>
                      {item.nextAction ? <div className="mt-1 text-xs text-muted">{item.nextAction.owner}</div> : null}
                    </td>
                    <td className="border-b border-line px-4 py-3 text-right">
                      <a
                        href={`/orders?orderId=${item.order.id}&view=readiness`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-slate-100 hover:text-ink"
                        aria-label={`查看订单 ${item.order.id}`}
                        title="查看订单"
                      >
                        <ArrowUpRight size={15} />
                      </a>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-sm text-muted">当前分类没有订单</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </FadePanel>
    </div>
  );
}
