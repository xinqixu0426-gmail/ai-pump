'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, DatabaseZap, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { FadePanel } from '@/components/motion/fade-panel';
import {
  businessAlertClassName,
  getBusinessAlerts,
  getDataQualitySummary,
  qualitySeverityClassName,
  type BusinessAlertsSummary,
  type DataQualitySummary,
  type QualityIssueGroup,
  type QualitySeverity,
} from '@/lib/quality';

function severityTone(severity: QualitySeverity): StatusBadgeTone {
  if (severity === 'danger') return 'red';
  if (severity === 'warning') return 'amber';
  return 'blue';
}

function issueIcon(group: QualityIssueGroup) {
  if (group.severity === 'danger') return <CircleAlert size={16} />;
  if (group.severity === 'warning') return <AlertTriangle size={16} />;
  return <CheckCircle2 size={16} />;
}

type QualityViewProps = {
  embedded?: boolean;
  refreshKey?: number;
  onScoreChange?: (score: number) => void;
  onRefreshComplete?: () => void;
};

export function QualityView({ embedded = false, refreshKey = 0, onScoreChange, onRefreshComplete }: QualityViewProps) {
  const [summary, setSummary] = useState<DataQualitySummary | null>(null);
  const [businessAlerts, setBusinessAlerts] = useState<BusinessAlertsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeKey, setActiveKey] = useState<string>('all');

  async function load(force = false) {
    setError('');
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const [quality, alerts] = await Promise.all([getDataQualitySummary(), getBusinessAlerts()]);
      setSummary(quality);
      setBusinessAlerts(alerts);
      onScoreChange?.(quality.score);
    } catch (err) {
      setError(err instanceof Error ? err.message : '数据质量加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
      onRefreshComplete?.();
    }
  }

  useEffect(() => {
    void load();
  }, [refreshKey]);

  const visibleGroups = useMemo(() => {
    const groups = (summary?.issues || []).filter((group) => group.count > 0);
    if (activeKey === 'all') return groups;
    return groups.filter((group) => group.key === activeKey);
  }, [activeKey, summary]);
  const topBusinessAlerts = businessAlerts?.topAlerts || [];

  return (
    <div className="space-y-5">
      {!embedded ? (
        <FadePanel className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Data Quality</div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">数据质量</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              检查零件、配方、模板、线圈、客户和报价的基础资料完整性，提前发现会影响 AI 编排、成本核算和采购计划的问题。
            </p>
          </div>
          <Button onClick={() => void load(true)} disabled={refreshing} icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}>
            刷新
          </Button>
        </FadePanel>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 rounded-panel border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <CircleAlert size={16} />
          {error}
        </div>
      ) : null}

      {loading || !summary ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-panel bg-slate-100" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
              <FadePanel delay={0.02} className="rounded-panel border border-line bg-white p-4 shadow-panel">
                <div className="text-2xl font-semibold text-ink">{summary.totals.issueCount}</div>
                <div className="mt-1 text-xs text-muted">问题总数</div>
              </FadePanel>
              <FadePanel delay={0.04} className="rounded-panel border border-line bg-white p-4 shadow-panel">
                <div className="text-2xl font-semibold text-rose-700">{summary.totals.dangerCount}</div>
                <div className="mt-1 text-xs text-muted">高风险</div>
              </FadePanel>
              <FadePanel delay={0.06} className="rounded-panel border border-line bg-white p-4 shadow-panel">
                <div className="text-2xl font-semibold text-amber-700">{summary.totals.warningCount}</div>
                <div className="mt-1 text-xs text-muted">需关注</div>
              </FadePanel>
              <FadePanel delay={0.08} className="rounded-panel border border-line bg-white p-4 shadow-panel">
                <div className="text-2xl font-semibold text-ink">{businessAlerts?.totals.all || 0}</div>
                <div className="mt-1 text-xs text-muted">经营提醒</div>
              </FadePanel>
          </div>

          <FadePanel className="rounded-panel border border-line bg-white p-4 shadow-panel">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveKey('all')}
                className={`rounded-md border px-3 py-1.5 text-sm ${activeKey === 'all' ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:bg-slate-50'}`}
              >
                全部问题
              </button>
              {summary.issues.filter((group) => group.count > 0).map((group) => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setActiveKey(group.key)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${activeKey === group.key ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:bg-slate-50'}`}
                >
                  {group.title} · {group.count}
                </button>
              ))}
            </div>
          </FadePanel>

          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <div className="space-y-4">
              {visibleGroups.length === 0 ? (
                <FadePanel className="rounded-panel border border-emerald-200 bg-emerald-50 p-8 text-center text-emerald-800">
                  <CheckCircle2 size={28} className="mx-auto" />
                  <div className="mt-3 text-sm font-semibold">当前筛选下没有问题</div>
                </FadePanel>
              ) : visibleGroups.map((group) => (
                <FadePanel key={group.key} className="rounded-panel border border-line bg-white shadow-panel">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {issueIcon(group)}
                        {group.title}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted">{group.suggestion}</div>
                    </div>
                    <StatusBadge tone={severityTone(group.severity)}>{group.count} 项</StatusBadge>
                  </div>
                  <div className="divide-y divide-line">
                    {group.items.slice(0, 12).map((item) => (
                      <div key={`${group.key}-${item.id}-${item.desc}`} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-ink">{item.title}</div>
                          <div className="mt-1 text-xs leading-5 text-muted">{item.desc}</div>
                        </div>
                        <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={() => { window.location.href = item.path; }}>
                          处理
                        </Button>
                      </div>
                    ))}
                    {group.count > 12 ? <div className="px-4 py-3 text-xs text-muted">仅显示前 12 项，共 {group.count} 项</div> : null}
                  </div>
                </FadePanel>
              ))}
            </div>

            <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                <div>
                  <div className="text-sm font-semibold text-ink">优先处理</div>
                  <div className="mt-1 text-xs text-muted">按风险和数量排序</div>
                </div>
                <DatabaseZap size={18} className="text-muted" />
              </div>
              <div className="space-y-2 p-4">
                {summary.topIssues.length === 0 ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">暂无优先问题</div>
                ) : summary.topIssues.map((group) => (
                  <div key={group.key} className={`rounded-md border p-3 ${qualitySeverityClassName(group.severity)}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold">{group.title}</div>
                      <div className="text-sm font-semibold">{group.count}</div>
                    </div>
                    <div className="mt-1 text-xs leading-5 opacity-80">{group.suggestion}</div>
                  </div>
                ))}
              </div>
            </FadePanel>

            {topBusinessAlerts.length > 0 ? (
              <FadePanel className="rounded-panel border border-line bg-white shadow-panel xl:col-start-2">
                <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                  <div>
                    <div className="text-sm font-semibold text-ink">经营提醒</div>
                    <div className="mt-1 text-xs text-muted">报价和订单需要跟进的风险</div>
                  </div>
                  <AlertTriangle size={18} className="text-muted" />
                </div>
                <div className="space-y-2 p-4">
                  {topBusinessAlerts.map((alert) => (
                    <div key={`${alert.scope}-${alert.entityId}-${alert.title}`} className={`rounded-md border p-3 ${businessAlertClassName(alert.severity)}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{alert.title}</div>
                          <div className="mt-1 text-xs leading-5 opacity-85">{alert.detail}</div>
                          <div className="mt-1 text-xs leading-5 opacity-85">{alert.action}</div>
                        </div>
                        <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={() => { window.location.href = alert.path; }}>
                          处理
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </FadePanel>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
