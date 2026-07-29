'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleAlert, ClipboardList, UserRound } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import type {
  ManagementActionCategory,
  ManagementActionCenter,
  ManagementActionPriority,
} from '@/lib/dashboard';

type Props = {
  center: ManagementActionCenter | null;
  loading: boolean;
  error: string | null;
};

const priorityOptions: Array<{ value: 'all' | ManagementActionPriority; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'critical', label: '紧急' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '普通' },
  { value: 'low', label: '低' },
];

const categoryOptions: Array<{ value: 'all' | ManagementActionCategory; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'order_readiness', label: '订单准备' },
  { value: 'business_risk', label: '经营风险' },
  { value: 'data_quality', label: '数据质量' },
  { value: 'rule_learning', label: '规则学习' },
  { value: 'knowledge_health', label: '知识健康' },
];

const priorityMeta: Record<ManagementActionPriority, { label: string; tone: StatusBadgeTone; border: string }> = {
  critical: { label: '紧急', tone: 'red', border: 'border-l-rose-500' },
  high: { label: '高优先级', tone: 'orange', border: 'border-l-orange-400' },
  medium: { label: '普通', tone: 'amber', border: 'border-l-amber-400' },
  low: { label: '低', tone: 'slate', border: 'border-l-slate-300' },
};

export function ManagementActionCenterView({ center, loading, error }: Props) {
  const [priority, setPriority] = useState<'all' | ManagementActionPriority>('all');
  const [category, setCategory] = useState<'all' | ManagementActionCategory>('all');
  const items = useMemo(() => (
    (center?.items || []).filter(item => (
      (priority === 'all' || item.priority === priority)
      && (category === 'all' || item.category === category)
    ))
  ), [center, priority, category]);

  if (loading && !center) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-panel bg-slate-100" />
        {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-panel bg-slate-100" />)}
      </div>
    );
  }

  if (error && !center) {
    return (
      <div className="flex items-center gap-2 rounded-panel border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        <CircleAlert size={16} />
        {error}
      </div>
    );
  }

  if (!center) return null;

  return (
    <div className="space-y-4">
      <section className="border-y border-line bg-white">
        <div className="grid grid-cols-2 divide-x divide-y divide-line md:grid-cols-5 md:divide-y-0">
          {[
            ['待办总数', center.metrics.total],
            ['紧急', center.metrics.critical],
            ['高优先级', center.metrics.high],
            ['普通', center.metrics.medium],
            ['低优先级', center.metrics.low],
          ].map(([label, value]) => (
            <div key={label} className="px-4 py-3">
              <div className="text-xl font-semibold text-ink">{value}</div>
              <div className="mt-1 text-xs text-muted">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-b border-line pb-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ClipboardList size={16} />
            管理待办
          </div>
          <div className="mt-1 text-xs text-muted">{center.summary}</div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="max-w-full overflow-x-auto pb-1 sm:pb-0">
            <SegmentedControl
              value={priority}
              options={priorityOptions}
              onChange={setPriority}
              ariaLabel="待办优先级筛选"
              className="w-max"
            />
          </div>
          <select
            value={category}
            onChange={event => setCategory(event.target.value as 'all' | ManagementActionCategory)}
            aria-label="待办来源筛选"
            className="h-9 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
          >
            {categoryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </section>

      {items.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center border-y border-line text-center">
          <CheckCircle2 size={28} className="text-emerald-600" />
          <div className="mt-3 text-sm font-semibold text-ink">当前筛选下没有待办</div>
          <div className="mt-1 text-xs text-muted">系统不会为了凑数量生成重复任务。</div>
        </div>
      ) : (
        <div className="divide-y divide-line border-y border-line bg-white">
          {items.map(item => {
            const meta = priorityMeta[item.priority];
            return (
              <div key={item.id} className={`border-l-4 px-4 py-4 ${meta.border}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={meta.tone} className="h-6 min-w-0 px-2">{meta.label}</StatusBadge>
                      <StatusBadge tone="slate" className="h-6 min-w-0 px-2">{item.categoryLabel}</StatusBadge>
                      <div className="min-w-0 text-sm font-semibold text-ink">{item.title}</div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-700">{item.detail}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                      <span className="inline-flex items-center gap-1"><UserRound size={13} />{item.owner || '待指定'}</span>
                      {item.count > 1 ? <span>涉及 {item.count} 项</span> : null}
                      <span>来源：{item.categoryLabel}</span>
                    </div>
                  </div>
                  <a
                    href={item.path}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink transition hover:bg-slate-50"
                  >
                    {item.action || '查看处理'}
                    <ArrowUpRight size={14} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {center.metrics.critical > 0 ? (
        <div className="flex items-start gap-2 border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          紧急项代表业务数据阻塞或系统健康异常，应先处理；它不是系统自动执行的任务。
        </div>
      ) : null}
    </div>
  );
}
