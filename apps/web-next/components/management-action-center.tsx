'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ClipboardList,
  History,
  ListOrdered,
  RotateCcw,
} from 'lucide-react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import type {
  ManagementActionCategory,
  ManagementActionCenter,
  ManagementActionItem,
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

const resolutionMeta = {
  navigate: { label: '打开页面', tone: 'slate' as StatusBadgeTone },
  confirmable: { label: 'AI 可确认', tone: 'blue' as StatusBadgeTone },
  needs_input: { label: '需要判断', tone: 'amber' as StatusBadgeTone },
  monitor: { label: '等待变化', tone: 'slate' as StatusBadgeTone },
};

function itemResolution(item: ManagementActionItem): NonNullable<ManagementActionItem['resolution']> {
  return item.resolution || {
    mode: 'navigate',
    title: item.action || '查看处理',
    instruction: '打开对应业务页面，按当前问题完成处理。',
    expectedResult: '',
    path: item.path,
    canAiConfirm: false,
    confirmation: null,
  };
}

function aiResolutionHref(item: ManagementActionCenter['items'][number]): string {
  const prompt = `请处理管理待办“${item.title}”（${item.id}）。先刷新今日执行队列和对应处理方案；如果当前步骤仍可由系统安全执行，请发起确认卡片，不要跳过确认。`;
  return `/ai?prompt=${encodeURIComponent(prompt)}`;
}

function durationLabel(fromValue: string | null | undefined, toValue: string | null | undefined): string {
  const from = new Date(fromValue || '').getTime();
  const to = new Date(toValue || '').getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return '刚刚出现';
  const minutes = Math.max(1, Math.floor((to - from) / 60000));
  if (minutes < 60) return `持续 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `持续 ${hours} 小时`;
  return `持续 ${Math.floor(hours / 24)} 天`;
}

export function ManagementActionCenterView({ center, loading, error }: Props) {
  const [priority, setPriority] = useState<'all' | ManagementActionPriority>('all');
  const [category, setCategory] = useState<'all' | ManagementActionCategory>('all');
  const items = useMemo(() => (
    (center?.items || []).filter(item => (
      (priority === 'all' || item.priority === priority)
      && (category === 'all' || item.category === category)
    ))
  ), [center, priority, category]);
  const executionQueue = center?.executionQueue;
  const progress = center?.progress;

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

      {progress ? (
        <section className="border-y border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <CheckCircle2 size={16} />
              自动复查进展
            </div>
            <div className="mt-1 text-xs leading-5 text-muted">{progress.summary}</div>
          </div>
          <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="px-4 py-3">
              <div className="text-xl font-semibold text-emerald-700">{progress.resolvedCount}</div>
              <div className="mt-1 text-xs text-muted">最近 {progress.windowHours} 小时自动归档</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xl font-semibold text-ink">{progress.unresolvedCount}</div>
              <div className="mt-1 text-xs text-muted">
                当前仍待处理{progress.blockedCount > 0 ? `，${progress.blockedCount} 项暂时受阻` : ''}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xl font-semibold text-amber-700">{progress.recurringCount}</div>
              <div className="mt-1 text-xs text-muted">当前或近期反复出现</div>
            </div>
          </div>
        </section>
      ) : null}

      {executionQueue && executionQueue.items.length > 0 ? (
        <section className="border-y border-line bg-white">
          <div className="flex flex-col gap-1 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <ListOrdered size={16} />
                今日执行队列
              </div>
              <div className="mt-1 text-xs leading-5 text-muted">{executionQueue.summary}</div>
            </div>
            {executionQueue.remainingCount > 0 ? (
              <div className="shrink-0 text-xs text-muted">
                其余 {executionQueue.remainingCount} 项保留在完整待办
              </div>
            ) : null}
          </div>
          <div className="divide-y divide-line">
            {executionQueue.items.map(item => {
              const meta = priorityMeta[item.priority];
              const plan = itemResolution(item);
              const resolution = resolutionMeta[plan.mode];
              return (
                <div key={item.id} className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center ${item.rank === 1 ? 'bg-slate-50' : ''}`}>
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">
                      {item.rank}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={item.rank === 1 ? 'red' : meta.tone}>{item.queueLabel}</StatusBadge>
                        <div className="min-w-0 text-sm font-semibold text-ink">{item.title}</div>
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted">{item.reasons.join(' · ')}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <StatusBadge tone={resolution.tone}>{resolution.label}</StatusBadge>
                        <span className="font-medium text-slate-700">下一步：{plan.title}</span>
                      </div>
                      {plan.expectedResult ? (
                        <div className="mt-1 text-xs leading-5 text-muted">完成后：{plan.expectedResult}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <a
                      href={plan.path || item.path}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink transition hover:bg-slate-50"
                    >
                      {plan.mode === 'confirmable' ? '查看依据' : plan.title}
                      <ArrowUpRight size={14} />
                    </a>
                    {plan.canAiConfirm ? (
                      <a
                        href={aiResolutionHref(item)}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800"
                      >
                        <Bot size={15} />
                        交给 AI
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 border-b border-line pb-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ClipboardList size={16} />
            完整待办
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
            const plan = itemResolution(item);
            const resolution = resolutionMeta[plan.mode];
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
                      {item.count > 1 ? <span>涉及 {item.count} 项</span> : null}
                      {item.lifecycle ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock3 size={13} />
                          {durationLabel(item.lifecycle.activeSince, center.generatedAt)}
                        </span>
                      ) : null}
                      {item.lifecycle && item.lifecycle.occurrenceCount > 1 ? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <RotateCcw size={13} />
                          第 {item.lifecycle.occurrenceCount} 次出现
                        </span>
                      ) : null}
                      <span>来源：{item.categoryLabel}</span>
                      <span>处理方式：{resolution.label}</span>
                    </div>
                  </div>
                  <a
                    href={plan.path || item.path}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink transition hover:bg-slate-50"
                  >
                    {plan.title || item.action || '查看处理'}
                    <ArrowUpRight size={14} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(progress?.resolvedItems || center.lifecycle.recentResolved).length > 0 ? (
        <section className="border-y border-line bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <History size={16} />
              自动归档记录
            </div>
            <div className="text-xs text-muted">
              {progress
                ? `最近 ${progress.windowHours} 小时已解决 ${progress.resolvedCount} 项`
                : `累计已消失 ${center.lifecycle.resolvedCount} 项`}
            </div>
          </div>
          <div className="divide-y divide-line">
            {(progress?.resolvedItems || center.lifecycle.recentResolved).map(item => (
              <div key={item.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{item.title}</div>
                  <div className="mt-1 text-xs text-muted">
                    {durationLabel(item.activeSince, item.resolvedAt)}
                    {item.occurrenceCount > 1 ? `，累计出现 ${item.occurrenceCount} 次` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-emerald-700">当前检查已不再出现</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {center.lifecycle.lastError ? (
        <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          生命周期后台核对异常：{center.lifecycle.lastError}
        </div>
      ) : null}

      {center.metrics.critical > 0 ? (
        <div className="flex items-start gap-2 border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          紧急项代表业务数据阻塞或系统健康异常，应先处理；它不是系统自动执行的任务。
        </div>
      ) : null}
    </div>
  );
}
