'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock3, RefreshCw, Search } from 'lucide-react';
import {
  getBusinessChanges,
  type BusinessChange,
  type BusinessChangeDomain,
  type BusinessChangeEventType,
  type BusinessChangePage,
} from '@/lib/business-changes';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';

const domainLabels: Record<BusinessChangeDomain, string> = {
  order: '订单', quotation: '报价', purchasing: '采购', part: '零件', recipe: '配方', template: '泵壳模板', coil: '线圈', customer: '客户',
  model_variant: '型号变体', quality: '质量规则', rotor: '转子档案', settings: '业务设置', file: '文件资料', knowledge: '知识资料', workflow: '业务工作流',
};

const eventMeta: Record<BusinessChangeEventType, { label: string; tone: StatusBadgeTone }> = {
  created: { label: '创建', tone: 'green' },
  updated: { label: '修改', tone: 'blue' },
  deleted: { label: '删除', tone: 'red' },
  status_changed: { label: '状态变化', tone: 'amber' },
  inventory_changed: { label: '库存变化', tone: 'orange' },
  converted: { label: '业务转换', tone: 'purple' },
};

const domainHref: Partial<Record<BusinessChangeDomain, string>> = {
  order: '/orders', quotation: '/quotations', purchasing: '/purchase', part: '/parts', recipe: '/recipes', template: '/recipes', coil: '/coils', customer: '/customers',
  model_variant: '/recipes', quality: '/dashboard', rotor: '/rotor', settings: '/setup', file: '/dashboard', knowledge: '/dashboard', workflow: '/dashboard',
};

function valueText(value: unknown) {
  if (value === null || value === undefined || value === '') return '空';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

function changeText(change: Record<string, unknown>) {
  if (change.description) return String(change.description);
  const field = String(change.field || '业务内容');
  if ('from' in change || 'to' in change) return `${field}：${valueText(change.from)} → ${valueText(change.to)}`;
  return field;
}

function EventCard({ event, onOpen }: { event: BusinessChange; onOpen: (href: string) => void }) {
  const meta = eventMeta[event.eventType];
  const primary = event.entities.find((entity) => entity.role === 'primary') || event.entities[0];
  const href = primary ? domainHref[primary.entityType] : undefined;
  return (
    <article className="rounded-panel border border-line bg-white p-4 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            <StatusBadge tone="slate">{domainLabels[event.primaryDomain]}</StatusBadge>
            {event.sourceType === 'order_revision_backfill' ? <StatusBadge tone="purple">历史补录</StatusBadge> : null}
          </div>
          <h2 className="mt-2 text-sm font-semibold leading-6 text-ink">{event.summary}</h2>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span>{new Date(event.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</span>
            <span>{event.actor}</span>
            <span>{event.capabilityId}</span>
          </div>
        </div>
        {href ? <Button variant="ghost" size="sm" onClick={() => onOpen(href)}>打开{domainLabels[primary.entityType]}页面</Button> : null}
      </div>
      {event.reason ? <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">修改原因：{event.reason}</div> : null}
      <div className="mt-3 space-y-1 text-sm text-slate-700">
        {event.changes.slice(0, 8).map((change, index) => <div key={`${event.id}-${index}`}>• {changeText(change)}</div>)}
        {event.changes.length > 8 ? <div className="text-xs text-muted">另有 {event.changes.length - 8} 项关联变化</div> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {event.entities.map((entity) => <StatusBadge key={`${entity.entityType}-${entity.entityId}`} tone={entity.role === 'primary' ? 'blue' : 'slate'}>{entity.entityLabel}</StatusBadge>)}
      </div>
    </article>
  );
}

export function BusinessChangeView() {
  const router = useRouter();
  const [period, setPeriod] = useState<'today' | 'yesterday' | 'last7days' | 'last30days' | 'all'>('today');
  const [domain, setDomain] = useState<BusinessChangeDomain | ''>('');
  const [eventType, setEventType] = useState<BusinessChangeEventType | ''>('');
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<BusinessChangePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (keywordValue = query) => {
    setLoading(true);
    setError('');
    try {
      setPage(await getBusinessChanges({ period, domain, eventType, keyword: keywordValue, limit: 100 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '业务变更历史加载失败');
    } finally {
      setLoading(false);
    }
  }, [domain, eventType, period, query]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader title="业务变更中心" description="查看 AI 能够追溯的正式业务修改。这里记录业务事实，不依赖 AI 对话是否保留。" actions={<Button onClick={() => void load()} disabled={loading} icon={<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />}>刷新</Button>} />
      <section className="grid gap-3 rounded-panel border border-line bg-white p-4 shadow-panel md:grid-cols-4">
        <Select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
          <option value="today">今天（北京时间）</option><option value="yesterday">昨天</option><option value="last7days">最近7天</option><option value="last30days">最近30天</option><option value="all">全部时间</option>
        </Select>
        <Select value={domain} onChange={(event) => setDomain(event.target.value as BusinessChangeDomain | '')}>
          <option value="">全部业务</option>{Object.entries(domainLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select value={eventType} onChange={(event) => setEventType(event.target.value as BusinessChangeEventType | '')}>
          <option value="">全部变化</option>{Object.entries(eventMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
        </Select>
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const nextQuery = keyword.trim(); setQuery(nextQuery); void load(nextQuery); }}>
          <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="对象、原因或字段" className="min-w-0 flex-1" />
          <Button type="submit" icon={<Search size={15} />} aria-label="搜索业务变更">查询</Button>
        </form>
      </section>
      {page ? <div className="flex items-center gap-2 text-sm text-muted"><Clock3 size={15} /><span>符合条件 {page.total} 条；数据截至 {new Date(page.asOf).toLocaleTimeString('zh-CN', { hour12: false })}</span></div> : null}
      {error ? <div className="rounded-panel border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
      {loading && !page ? <div className="h-40 animate-pulse rounded-panel bg-slate-100" /> : null}
      {!loading && page?.items.length === 0 ? <div className="rounded-panel border border-dashed border-line bg-white p-10 text-center text-sm text-muted">当前筛选范围内没有正式业务变更。</div> : null}
      <div className="space-y-3">{page?.items.map((event) => <EventCard key={event.id} event={event} onOpen={(href) => router.push(href)} />)}</div>
    </div>
  );
}
