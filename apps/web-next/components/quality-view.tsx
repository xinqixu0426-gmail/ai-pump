'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookCheck, CheckCircle2, CircleAlert, DatabaseZap, History, ListChecks, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { FadePanel } from '@/components/motion/fade-panel';
import {
  businessAlertClassName,
  getBusinessAlerts,
  getDataQualitySummary,
  getFactoryRuleCompliance,
  getFactoryRuleCandidates,
  getFactoryRuleEvents,
  getFactoryRuleImpact,
  qualitySeverityClassName,
  refreshFactoryRuleCandidates,
  reviewFactoryRuleCandidate,
  type BusinessAlertsSummary,
  type DataQualitySummary,
  type FactoryRuleCandidate,
  type FactoryRuleCompliance,
  type FactoryRuleEvent,
  type FactoryRuleImpact,
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

const ruleEventLabels: Record<string, string> = {
  baseline: '建立历史基线',
  created: '生成候选规则',
  evidence_changed: '证据发生变化',
  approved: '批准规则',
  rejected: '驳回规则',
  reopened: '恢复候选审核',
  stale: '规则自动失效',
  reactivated: '规则重新激活',
};

type QualityViewProps = {
  embedded?: boolean;
  refreshKey?: number;
  onScoreChange?: (score: number) => void;
  onRefreshComplete?: () => void;
};

export function QualityView({ embedded = false, refreshKey = 0, onScoreChange, onRefreshComplete }: QualityViewProps) {
  const [summary, setSummary] = useState<DataQualitySummary | null>(null);
  const [businessAlerts, setBusinessAlerts] = useState<BusinessAlertsSummary | null>(null);
  const [ruleCandidates, setRuleCandidates] = useState<FactoryRuleCandidate[]>([]);
  const [ruleCompliance, setRuleCompliance] = useState<FactoryRuleCompliance | null>(null);
  const [ruleEvents, setRuleEvents] = useState<FactoryRuleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeKey, setActiveKey] = useState<string>('all');
  const [ruleRefreshing, setRuleRefreshing] = useState(false);
  const [ruleReviewingId, setRuleReviewingId] = useState<number | null>(null);
  const [ruleImpactLoadingId, setRuleImpactLoadingId] = useState<number | null>(null);
  const [expandedRuleImpactId, setExpandedRuleImpactId] = useState<number | null>(null);
  const [ruleImpacts, setRuleImpacts] = useState<Record<number, FactoryRuleImpact>>({});

  async function load(force = false) {
    setError('');
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const [quality, alerts, candidates, compliance, events] = await Promise.all([
        getDataQualitySummary(),
        getBusinessAlerts(),
        getFactoryRuleCandidates(),
        getFactoryRuleCompliance(),
        getFactoryRuleEvents({ limit: 20 }),
      ]);
      setSummary(quality);
      setBusinessAlerts(alerts);
      setRuleCandidates(candidates);
      setRuleCompliance(compliance);
      setRuleEvents(events);
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
  const approvedRuleCandidates = ruleCandidates.filter((candidate) => candidate.status === 'approved');
  const ruleCandidatesNeedingReview = ruleCandidates.filter((candidate) => candidate.needsReview);
  const ruleReviewQueue = ruleCandidates.filter((candidate) => candidate.status === 'candidate' || candidate.needsReview);
  const learnedSpecialCaseCount = ruleCandidates.reduce((total, candidate) => total + candidate.specialCaseCount, 0);

  async function refreshRuleCandidates() {
    setRuleRefreshing(true);
    setError('');
    try {
      const result = await refreshFactoryRuleCandidates();
      setRuleCandidates(result.candidates);
      const [compliance, events] = await Promise.all([
        getFactoryRuleCompliance(),
        getFactoryRuleEvents({ limit: 20 }),
      ]);
      setRuleCompliance(compliance);
      setRuleEvents(events);
      setRuleImpacts({});
      setExpandedRuleImpactId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '候选规则归纳失败');
    } finally {
      setRuleRefreshing(false);
    }
  }

  async function loadRuleImpact(candidate: FactoryRuleCandidate): Promise<FactoryRuleImpact> {
    const existing = ruleImpacts[candidate.id];
    if (existing) return existing;
    setRuleImpactLoadingId(candidate.id);
    try {
      const impact = await getFactoryRuleImpact(candidate.id);
      setRuleImpacts((current) => ({ ...current, [candidate.id]: impact }));
      return impact;
    } finally {
      setRuleImpactLoadingId(null);
    }
  }

  async function toggleRuleImpact(candidate: FactoryRuleCandidate) {
    if (expandedRuleImpactId === candidate.id) {
      setExpandedRuleImpactId(null);
      return;
    }
    setError('');
    try {
      await loadRuleImpact(candidate);
      setExpandedRuleImpactId(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '规则影响分析失败');
    }
  }

  async function reviewRuleCandidate(candidate: FactoryRuleCandidate, status: 'approved' | 'rejected') {
    const action = status === 'approved' ? '批准' : '驳回';
    setError('');
    try {
      const impact = status === 'approved' ? await loadRuleImpact(candidate) : null;
      const impactSummary = impact
        ? `\n影响范围：同模板 ${impact.summary.totalRecipes} 个配方，其中 ${impact.summary.needsReviewCount} 个需要复核，${impact.summary.specialCaseCount} 个特殊情况。`
        : '';
      if (!window.confirm(`确定${action}候选规则「${candidate.title}」？${impactSummary}`)) return;
      setRuleReviewingId(candidate.id);
      const updated = await reviewFactoryRuleCandidate(candidate.id, { status });
      const [candidates, compliance, events] = await Promise.all([
        getFactoryRuleCandidates(),
        getFactoryRuleCompliance(),
        getFactoryRuleEvents({ limit: 20 }),
      ]);
      setRuleCandidates(candidates);
      setRuleCompliance(compliance);
      setRuleEvents(events);
    } catch (err) {
      setError(err instanceof Error ? err.message : '候选规则审核失败');
    } finally {
      setRuleReviewingId(null);
    }
  }

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

          <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
            <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <BookCheck size={17} />
                  候选业务规则
                </div>
                <div className="mt-1 text-xs leading-5 text-muted">
                  同类高频项反馈保存后会自动归纳；至少 2 个配方确认才生成候选，批准后参与配方检查并自动更新规则知识。
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => void refreshRuleCandidates()}
                disabled={ruleRefreshing}
                icon={<Sparkles size={15} className={ruleRefreshing ? 'animate-pulse' : ''} />}
              >
                {ruleRefreshing ? '核对中' : '重新核对规则'}
              </Button>
            </div>
            <div className="grid border-b border-line sm:grid-cols-4">
              <div className="px-4 py-3">
                <div className="text-lg font-semibold text-ink">{ruleReviewQueue.length}</div>
                <div className="text-xs text-muted">待审核</div>
              </div>
              <div className="border-t border-line px-4 py-3 sm:border-l sm:border-t-0">
                <div className="text-lg font-semibold text-emerald-700">{approvedRuleCandidates.length}</div>
                <div className="text-xs text-muted">已批准</div>
              </div>
              <div className="border-t border-line px-4 py-3 sm:border-l sm:border-t-0">
                <div className="text-lg font-semibold text-ink">{ruleCandidates.length}</div>
                <div className="text-xs text-muted">累计规则</div>
              </div>
              <div className="border-t border-line px-4 py-3 sm:border-l sm:border-t-0">
                <div className="text-lg font-semibold text-orange-700">{learnedSpecialCaseCount}</div>
                <div className="text-xs text-muted">特殊情况证据</div>
              </div>
            </div>
            {ruleReviewQueue.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">
                暂无待审核规则。先在配方智能检查中确认同类高频项，积累到 2 个不同配方后再归纳。
              </div>
            ) : (
              <div className="divide-y divide-line">
                {ruleReviewQueue.map((candidate) => (
                  <div key={candidate.id} className="p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-ink">{candidate.title}</div>
                          <StatusBadge tone="green">确认 {candidate.supportCount}</StatusBadge>
                          <StatusBadge tone="blue">特殊 {candidate.specialCaseCount}</StatusBadge>
                          <StatusBadge tone="slate">忽略 {candidate.ignoredCount}</StatusBadge>
                          <StatusBadge tone={candidate.confidenceLevel === 'high' ? 'green' : candidate.confidenceLevel === 'medium' ? 'amber' : 'orange'}>
                            置信度 {Math.round(candidate.confidenceScore * 100)}%
                          </StatusBadge>
                          {candidate.needsReview ? <StatusBadge tone="red">需重新审核</StatusBadge> : null}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-muted">{candidate.content}</div>
                        <div className="mt-2 text-xs text-slate-600">
                          证据：{candidate.evidence.map((item) => item.recipeName).join('、')}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={ruleImpactLoadingId === candidate.id}
                          icon={<ListChecks size={14} />}
                          onClick={() => void toggleRuleImpact(candidate)}
                        >
                          {ruleImpactLoadingId === candidate.id
                            ? '分析中'
                            : expandedRuleImpactId === candidate.id
                              ? '收起影响'
                              : '查看影响'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={ruleReviewingId === candidate.id}
                          icon={<XCircle size={14} />}
                          onClick={() => void reviewRuleCandidate(candidate, 'rejected')}
                        >
                          驳回
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={ruleReviewingId === candidate.id}
                          icon={<CheckCircle2 size={14} />}
                          onClick={() => void reviewRuleCandidate(candidate, 'approved')}
                        >
                          批准
                        </Button>
                      </div>
                    </div>
                    {expandedRuleImpactId === candidate.id && ruleImpacts[candidate.id] ? (
                      <div className="mt-4 border-t border-line pt-4">
                        <div className="grid gap-3 sm:grid-cols-4">
                          {[
                            ['已符合', ruleImpacts[candidate.id].summary.compliantCount, 'text-emerald-700'],
                            ['需要复核', ruleImpacts[candidate.id].summary.needsReviewCount, 'text-amber-700'],
                            ['特殊情况', ruleImpacts[candidate.id].summary.specialCaseCount, 'text-sky-700'],
                            ['已忽略', ruleImpacts[candidate.id].summary.ignoredCount, 'text-slate-700'],
                          ].map(([label, value, tone]) => (
                            <div key={String(label)}>
                              <div className={`text-lg font-semibold ${tone}`}>{value}</div>
                              <div className="text-xs text-muted">{label}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 text-xs leading-5 text-muted">
                          {ruleImpacts[candidate.id].guidance}
                        </div>
                        {ruleImpacts[candidate.id].groups.needsReview.length > 0 ? (
                          <div className="mt-2 text-xs leading-5 text-amber-800">
                            需要复核：{ruleImpacts[candidate.id].groups.needsReview.map((item) => item.recipeName).join('、')}
                          </div>
                        ) : null}
                        {ruleImpacts[candidate.id].groups.specialCases.length > 0 ? (
                          <div className="mt-1 text-xs leading-5 text-sky-800">
                            特殊情况：{ruleImpacts[candidate.id].groups.specialCases.map((item) => item.recipeName).join('、')}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {ruleCandidatesNeedingReview.length > 0 ? (
              <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                {ruleCandidatesNeedingReview.length} 条已批准规则出现忽略证据或置信度下降，继续作为复核建议，但应重新审核后再长期使用。
              </div>
            ) : null}
          </FadePanel>

          <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
            <div className="border-b border-line p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <History size={17} />
                规则变更记录
              </div>
              <div className="mt-1 text-xs leading-5 text-muted">
                保留候选生成、证据变化、审核和失效记录，用于追溯规则为什么变成当前状态。
              </div>
            </div>
            {ruleEvents.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">暂无规则变更记录。</div>
            ) : (
              <div className="divide-y divide-line">
                {ruleEvents.map((event) => (
                  <div key={event.id} className="px-4 py-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink">
                            {event.ruleTitle || event.ruleKey}
                          </span>
                          <StatusBadge tone={event.eventType === 'approved' || event.eventType === 'reactivated'
                            ? 'green'
                            : event.eventType === 'stale' || event.eventType === 'rejected'
                              ? 'red'
                              : 'blue'}
                          >
                            {ruleEventLabels[event.eventType] || event.eventType}
                          </StatusBadge>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted">
                          {event.previousStatus && event.newStatus && event.previousStatus !== event.newStatus
                            ? `${event.previousStatus} → ${event.newStatus} · `
                            : ''}
                          {event.note || '系统记录规则状态变化'}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-slate-500">
                        {new Date(event.createdAt).toLocaleString('zh-CN')} · {event.actor}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FadePanel>

          <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
            <div className="border-b border-line p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <ListChecks size={17} />
                已批准规则执行情况
              </div>
              <div className="mt-1 text-xs leading-5 text-muted">
                自动扫描当前配方是否符合已批准规则，只提示待复核项，不会自动修改配方。
              </div>
            </div>
            <div className="grid border-b border-line sm:grid-cols-4">
              {[
                ['已批准规则', ruleCompliance?.summary.approvedRuleCount || 0, 'text-ink'],
                ['涉及规则问题', ruleCompliance?.summary.ruleViolationCount || 0, 'text-amber-700'],
                ['受影响配方', ruleCompliance?.summary.affectedRecipeCount || 0, 'text-rose-700'],
                ['已记录例外', ruleCompliance?.summary.exceptionCount || 0, 'text-sky-700'],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="border-t border-line px-4 py-3 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0">
                  <div className={`text-lg font-semibold ${tone}`}>{value}</div>
                  <div className="text-xs text-muted">{label}</div>
                </div>
              ))}
            </div>
            {!ruleCompliance || ruleCompliance.summary.approvedRuleCount === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">
                暂无已批准规则。候选规则批准后，系统会在这里持续监控执行情况。
              </div>
            ) : ruleCompliance.summary.ruleViolationCount === 0 ? (
              <div className="px-4 py-5 text-sm text-emerald-700">
                当前已批准规则没有发现未处理的配方缺项。
              </div>
            ) : (
              <div className="divide-y divide-line">
                {ruleCompliance.rules.filter((rule) => rule.summary.needsReviewCount > 0).map((rule) => (
                  <div key={rule.candidate.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-ink">{rule.candidate.title}</div>
                      <StatusBadge tone="amber">待复核 {rule.summary.needsReviewCount}</StatusBadge>
                      {rule.candidate.needsReview ? <StatusBadge tone="red">证据需复审</StatusBadge> : null}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted">
                      需要复核：{rule.groups.needsReview.map((item) => item.recipeName).join('、')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FadePanel>

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
