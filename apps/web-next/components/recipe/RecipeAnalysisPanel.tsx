'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  EyeOff,
  Info,
  RotateCcw,
  Save,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { money } from '@/lib/format';
import type {
  FactoryLearningHealth,
  RecipeAnalysisFeedback,
  RecipeAnalysisFeedbackDecision,
  RecipeAnalysisFinding,
  RecipeAnalysisSeverity,
  RecipeConfigurationAnalysis,
} from '@/lib/quality';

export type RuleLearningImpact = NonNullable<RecipeAnalysisFeedback['ruleLearning']>;

type AnalysisFeedbackDraft = {
  finding: RecipeAnalysisFinding;
  decision: RecipeAnalysisFeedbackDecision;
  note: string;
};

type RecipeAnalysisPanelProps = {
  open: boolean;
  analysis: RecipeConfigurationAnalysis | null;
  analysisLoading: boolean;
  saveGateOpen: boolean;
  saving: boolean;
  feedbackEnabled: boolean;
  reviewEvidenceTargets: FactoryLearningHealth['items'];
  reviewEvidenceBatchTotal: number;
  reviewEvidenceCompletedCount: number;
  reviewEvidenceLoading: boolean;
  reviewEvidenceResolving: boolean;
  reviewEvidenceNotice: string | null;
  reviewEvidenceBatchCompleted: boolean;
  reviewRuleLearning: RuleLearningImpact | null;
  onClose: () => void;
  onSkipReviewEvidence: () => void;
  onResolveMissingReviewEvidence: () => void;
  onSaveFeedback: (
    finding: RecipeAnalysisFinding,
    decision: RecipeAnalysisFeedbackDecision,
    note: string
  ) => Promise<boolean>;
  onContinueSave: () => void;
  onReturnToQuality: () => void;
};

function recipeAnalysisTone(severity: RecipeAnalysisSeverity): StatusBadgeTone {
  if (severity === 'danger') return 'red';
  if (severity === 'warning') return 'amber';
  return 'blue';
}

function recipeAnalysisSeverityLabel(severity: RecipeAnalysisSeverity): string {
  if (severity === 'danger') return '确定问题';
  if (severity === 'warning') return '重点复核';
  return '建议复核';
}

function recipeAnalysisConfidenceLabel(confidence: 'high' | 'medium' | 'low'): string {
  if (confidence === 'high') return '高置信度';
  if (confidence === 'medium') return '中置信度';
  return '低置信度';
}

function dateTimeShort(value: string | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RecipeAnalysisPanel({
  open,
  analysis,
  analysisLoading,
  saveGateOpen,
  saving,
  feedbackEnabled,
  reviewEvidenceTargets,
  reviewEvidenceBatchTotal,
  reviewEvidenceCompletedCount,
  reviewEvidenceLoading,
  reviewEvidenceResolving,
  reviewEvidenceNotice,
  reviewEvidenceBatchCompleted,
  reviewRuleLearning,
  onClose,
  onSkipReviewEvidence,
  onResolveMissingReviewEvidence,
  onSaveFeedback,
  onContinueSave,
  onReturnToQuality,
}: RecipeAnalysisPanelProps) {
  const [feedbackDraft, setFeedbackDraft] = useState<AnalysisFeedbackDraft | null>(null);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const reviewEvidenceTarget = reviewEvidenceTargets[0] || null;
  const reviewTargetFinding = useMemo(() => {
    if (!analysis || !reviewEvidenceTarget) return null;
    return [
      ...analysis.factoryRuleAlerts,
      ...analysis.missingItems,
      ...analysis.priceAlerts,
      ...analysis.suppressedFindings,
    ].find((finding) => finding.key === reviewEvidenceTarget.findingKey) || null;
  }, [analysis, reviewEvidenceTarget]);

  useEffect(() => {
    if (open) return;
    setFeedbackDraft(null);
  }, [open]);

  useEffect(() => {
    if (!open || !reviewTargetFinding) return;
    const timer = window.setTimeout(() => {
      document.querySelector('[data-review-target="true"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, reviewTargetFinding]);

  function openFeedback(
    finding: RecipeAnalysisFinding,
    decision: RecipeAnalysisFeedbackDecision
  ) {
    setFeedbackDraft({
      finding,
      decision,
      note: finding.feedback?.note || '',
    });
  }

  async function saveFeedback() {
    if (!feedbackDraft) return;
    setFeedbackSaving(true);
    try {
      const saved = await onSaveFeedback(
        feedbackDraft.finding,
        feedbackDraft.decision,
        feedbackDraft.note
      );
      if (saved) setFeedbackDraft(null);
    } finally {
      setFeedbackSaving(false);
    }
  }

  function feedbackActions(finding: RecipeAnalysisFinding) {
    if (!feedbackEnabled) {
      return <div className="mt-3 text-xs text-muted">保存配方后可记录人工判断。</div>;
    }
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={finding.feedback?.decision === 'confirmed' ? 'primary' : 'secondary'}
          icon={<CheckCircle2 size={14} />}
          onClick={() => openFeedback(finding, 'confirmed')}
        >
          确认问题
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<EyeOff size={14} />}
          onClick={() => openFeedback(finding, 'ignored')}
        >
          忽略
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Info size={14} />}
          onClick={() => openFeedback(finding, 'special_case')}
        >
          特殊情况
        </Button>
      </div>
    );
  }

  return (
    <>
      <SlideOver open={open} onClose={onClose} size="wide">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-sky-700" />
              <h2 className="text-lg font-semibold text-ink">配方智能检查</h2>
            </div>
            <div className="mt-1 text-sm text-muted">{analysis?.recipe.name || '当前配方草稿'}</div>
          </div>
          <Button
            className="w-9 px-0"
            variant="ghost"
            aria-label="关闭配方智能检查"
            title="关闭"
            onClick={onClose}
            icon={<X size={16} />}
          />
        </div>

        {analysis && (
          <div className="max-h-[calc(100vh-9rem)] overflow-y-auto">
            <div className="grid border-b border-line sm:grid-cols-6">
              {[
                ['确定问题', analysis.summary.definiteIssueCount],
                ['工厂规则', `${analysis.summary.factoryRuleAlertCount}/${analysis.summary.appliedFactoryRuleCount}`],
                ['复核建议', analysis.summary.reviewSuggestionCount],
                ['价格提醒', analysis.summary.priceAlertCount],
                ['已收纳', analysis.summary.suppressedFindingCount],
                ['相似配方', analysis.summary.similarRecipeCount],
              ].map(([label, value]) => (
                <div key={String(label)} className="border-b border-line px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                  <div className="text-xs text-muted">{label}</div>
                  <div className="mt-1 text-xl font-semibold text-ink">{value}</div>
                </div>
              ))}
            </div>
            {analysis.summary.outdatedFeedbackCount > 0 ? (
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs leading-5 text-amber-800">
                有 {analysis.summary.outdatedFeedbackCount} 条历史反馈对应的配方内容已经变化，本次不再压住提醒。请按当前配置重新确认。
              </div>
            ) : null}
            {reviewEvidenceLoading ? (
              <div className="border-b border-sky-200 bg-sky-50 px-5 py-3 text-xs leading-5 text-sky-800">
                正在读取这次待复核任务的原始证据。
              </div>
            ) : null}
            {reviewEvidenceNotice ? (
              <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-xs leading-5 text-emerald-800">
                {reviewEvidenceNotice}
              </div>
            ) : null}
            {reviewRuleLearning ? (
              <div className="border-b border-sky-200 bg-sky-50 px-5 py-3 text-xs leading-5 text-sky-900">
                <div className="font-medium">规则学习已按本次判断刷新</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <span>当前活跃候选 {reviewRuleLearning.stats.active} 条</span>
                  <span>新生成 {reviewRuleLearning.stats.created} 条</span>
                  <span>重算现有候选 {reviewRuleLearning.stats.updated} 条</span>
                  <span>转为失效 {reviewRuleLearning.stats.stale} 条</span>
                  <span>撤回批准 {reviewRuleLearning.stats.suspended} 条</span>
                  <span>
                    仍隔离过期/漂移证据 {reviewRuleLearning.stats.outdatedEvidence}/{reviewRuleLearning.stats.driftedEvidence} 条
                  </span>
                </div>
                <div className="mt-1 text-sky-700">
                  这里只更新学习证据和候选规则，不会自动批准规则或修改配方。
                </div>
              </div>
            ) : null}
            {reviewEvidenceTarget && reviewEvidenceBatchTotal > 0 ? (
              <div className="border-b border-line bg-white px-5 py-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-ink">
                    待复核进度：第 {reviewEvidenceCompletedCount + 1} / {reviewEvidenceBatchTotal} 条
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted">已完成 {reviewEvidenceCompletedCount} 条</span>
                    {reviewEvidenceTargets.length > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<SkipForward size={14} />}
                        onClick={onSkipReviewEvidence}
                      >
                        暂时跳过
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-emerald-500 transition-[width] duration-200"
                    style={{
                      width: `${Math.round(reviewEvidenceCompletedCount / reviewEvidenceBatchTotal * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}
            {reviewEvidenceBatchCompleted && reviewEvidenceBatchTotal > 0 ? (
              <div className="flex flex-col gap-3 border-b border-emerald-200 bg-emerald-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium text-emerald-900">
                    本配方 {reviewEvidenceBatchTotal} 条待复核任务已全部完成
                  </div>
                  <div className="mt-1 text-xs leading-5 text-emerald-800">
                    任务参数已从地址中清除。返回数据质量看板后会重新读取最新健康状态。
                  </div>
                  <div className="mt-2 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-emerald-200">
                    <div className="h-full w-full bg-emerald-600" />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  icon={<ArrowLeft size={14} />}
                  onClick={onReturnToQuality}
                >
                  返回数据质量
                </Button>
              </div>
            ) : null}
            {reviewEvidenceTarget ? (
              analysisLoading ? (
                <div className="border-b border-sky-200 bg-sky-50 px-5 py-3 text-xs leading-5 text-sky-800">
                  正在按当前配方重新检查“{reviewEvidenceTarget.findingTitle}”。
                </div>
              ) : reviewTargetFinding ? (
                <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs leading-5 text-amber-900">
                  已定位原待复核提醒“{reviewEvidenceTarget.findingTitle}”。请根据当前配方重新选择确认问题、忽略或特殊情况。
                </div>
              ) : (
                <div className="flex flex-col gap-3 border-b border-emerald-200 bg-emerald-50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs leading-5 text-emerald-900">
                    原待复核提醒“{reviewEvidenceTarget.findingTitle}”在本次智能检查中已不再出现。确认后会保留历史记录，并将它移出学习证据待复核队列。
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    disabled={reviewEvidenceResolving}
                    icon={<Check size={14} />}
                    onClick={onResolveMissingReviewEvidence}
                  >
                    {reviewEvidenceResolving ? '处理中' : '确认已解决'}
                  </Button>
                </div>
              )
            ) : null}

            <div className="space-y-7 p-5">
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-ink">已批准工厂规则</h3>
                  <span className="text-xs text-muted">仅应用当前泵壳模板范围内的规则</span>
                </div>
                {analysis.factoryRuleAlerts.length === 0 ? (
                  <div className="border-y border-line py-4 text-sm text-muted">
                    已应用 {analysis.summary.appliedFactoryRuleCount} 条规则，没有发现需要复核的缺项。
                  </div>
                ) : (
                  <div className="divide-y divide-line border-y border-line">
                    {analysis.factoryRuleAlerts.map((item) => (
                      <div
                        key={item.key}
                        data-review-target={reviewEvidenceTarget?.findingKey === item.key ? 'true' : undefined}
                        className={`py-4 ${reviewEvidenceTarget?.findingKey === item.key ? 'rounded-md bg-amber-50 px-3 ring-1 ring-amber-200' : ''}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="amber">已批准规则</StatusBadge>
                          <StatusBadge tone="slate">{recipeAnalysisConfidenceLabel(item.confidence)}</StatusBadge>
                          {item.feedback?.decision === 'confirmed' && <StatusBadge tone="green">已确认</StatusBadge>}
                          {item.feedback?.outdated && <StatusBadge tone="orange">反馈已过期</StatusBadge>}
                          <div className="font-medium text-ink">{item.title}</div>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-muted">{item.explanation}</div>
                        {item.feedback?.outdatedReason ? (
                          <div className="mt-2 text-xs leading-5 text-amber-800">{item.feedback.outdatedReason}</div>
                        ) : null}
                        {item.rule && (
                          <div className="mt-2 text-xs text-slate-600">
                            规则：{item.rule.title} · {item.rule.evidenceCount} 个证据配方
                            {item.rule.approvedAt ? ` · 批准于 ${dateTimeShort(item.rule.approvedAt)}` : ''}
                          </div>
                        )}
                        {feedbackActions(item)}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-ink">配置与漏项</h3>
                  <span className="text-xs text-muted">只提供建议，不自动修改</span>
                </div>
                {analysis.missingItems.length === 0 ? (
                  <div className="border-y border-line py-4 text-sm text-muted">没有发现配置矛盾或高频漏项。</div>
                ) : (
                  <div className="divide-y divide-line border-y border-line">
                    {analysis.missingItems.map((item) => (
                      <div
                        key={item.key}
                        data-review-target={reviewEvidenceTarget?.findingKey === item.key ? 'true' : undefined}
                        className={`py-4 ${reviewEvidenceTarget?.findingKey === item.key ? 'rounded-md bg-amber-50 px-3 ring-1 ring-amber-200' : ''}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={recipeAnalysisTone(item.severity)}>{recipeAnalysisSeverityLabel(item.severity)}</StatusBadge>
                          <StatusBadge tone="slate">{recipeAnalysisConfidenceLabel(item.confidence)}</StatusBadge>
                          {item.feedback?.decision === 'confirmed' && <StatusBadge tone="green">已确认</StatusBadge>}
                          {item.feedback?.outdated && <StatusBadge tone="orange">反馈已过期</StatusBadge>}
                          <div className="font-medium text-ink">{item.title}</div>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-muted">{item.explanation}</div>
                        {item.feedback?.outdatedReason ? (
                          <div className="mt-2 text-xs leading-5 text-amber-800">{item.feedback.outdatedReason}</div>
                        ) : null}
                        {item.suggestedModels && item.suggestedModels.length > 0 && (
                          <div className="mt-2 text-xs text-slate-600">参考型号：{item.suggestedModels.join('、')}</div>
                        )}
                        {feedbackActions(item)}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold text-ink">价格提醒</h3>
                {analysis.priceAlerts.length === 0 ? (
                  <div className="border-y border-line py-4 text-sm text-muted">可比固定件中没有发现明显价格异常。</div>
                ) : (
                  <div className="divide-y divide-line border-y border-line">
                    {analysis.priceAlerts.map((alert) => (
                      <div
                        key={alert.key}
                        data-review-target={reviewEvidenceTarget?.findingKey === alert.key ? 'true' : undefined}
                        className={`py-4 ${reviewEvidenceTarget?.findingKey === alert.key ? 'rounded-md bg-amber-50 px-3 ring-1 ring-amber-200' : ''}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={recipeAnalysisTone(alert.severity)}>{recipeAnalysisSeverityLabel(alert.severity)}</StatusBadge>
                          {alert.feedback?.decision === 'confirmed' && <StatusBadge tone="green">已确认</StatusBadge>}
                          {alert.feedback?.outdated && <StatusBadge tone="orange">反馈已过期</StatusBadge>}
                          <div className="font-medium text-ink">{alert.title}</div>
                        </div>
                        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
                          <div><span className="text-muted">当前：</span><span className="font-medium text-ink">{money(alert.currentPrice)}</span></div>
                          <div><span className="text-muted">参考中位：</span><span className="font-medium text-ink">{money(alert.referenceMedian)}</span></div>
                          <div><span className="text-muted">参考范围：</span><span className="font-medium text-ink">{money(alert.referenceMin)} - {money(alert.referenceMax)}</span></div>
                          <div><span className="text-muted">偏差：</span><span className="font-medium text-ink">{alert.differencePercent > 0 ? '+' : ''}{alert.differencePercent}%</span></div>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-muted">{alert.explanation}</div>
                        {alert.feedback?.outdatedReason ? (
                          <div className="mt-2 text-xs leading-5 text-amber-800">{alert.feedback.outdatedReason}</div>
                        ) : null}
                        {feedbackActions(alert)}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {analysis.suppressedFindings.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-ink">已忽略与特殊情况</h3>
                  <div className="divide-y divide-line border-y border-line">
                    {analysis.suppressedFindings.map((finding) => (
                      <div
                        key={finding.key}
                        data-review-target={reviewEvidenceTarget?.findingKey === finding.key ? 'true' : undefined}
                        className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between ${reviewEvidenceTarget?.findingKey === finding.key ? 'rounded-md bg-amber-50 px-3 ring-1 ring-amber-200' : ''}`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone="slate">
                              {finding.feedback?.decision === 'special_case' ? '特殊情况' : '已忽略'}
                            </StatusBadge>
                            <div className="font-medium text-ink">{finding.title}</div>
                          </div>
                          {finding.feedback?.note && <div className="mt-2 text-sm text-muted">{finding.feedback.note}</div>}
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<RotateCcw size={14} />}
                          onClick={() => openFeedback(finding, 'review')}
                        >
                          恢复复核
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h3 className="mb-3 text-sm font-semibold text-ink">相似配方依据</h3>
                {analysis.similarRecipes.length === 0 ? (
                  <div className="border-y border-line py-4 text-sm text-muted">当前没有足够接近的历史配方，复核建议会更保守。</div>
                ) : (
                  <div className="divide-y divide-line border-y border-line">
                    {analysis.similarRecipes.map((item) => (
                      <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_100px_140px] sm:items-center">
                        <div>
                          <div className="font-medium text-ink">{item.name}</div>
                          <div className="mt-1 text-xs text-muted">{item.reasons.join('；') || 'BOM 结构相近'}</div>
                        </div>
                        <div className="text-sm text-muted">相似度 {Math.round(item.score * 100)}%</div>
                        <div className="text-sm text-muted">保存成本 {money(item.savedTotalCost)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
        {saveGateOpen && analysis && (
          <div className="sticky bottom-0 border-t border-line bg-white px-5 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-ink">
                  {analysis.summary.highConfidenceAlertCount > 0
                    ? `发现 ${analysis.summary.highConfidenceAlertCount} 项高置信度问题`
                    : '高置信度问题已经处理'}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {analysis.summary.highConfidenceAlertCount > 0
                    ? '建议先处理，或将客户定制记录为特殊情况；继续保存不会自动修改当前配方。'
                    : '普通复核建议不会阻止保存。'}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>返回修改</Button>
                <Button
                  variant="primary"
                  disabled={saving || feedbackSaving}
                  icon={<Save size={15} />}
                  onClick={onContinueSave}
                >
                  {analysis.summary.highConfidenceAlertCount > 0 ? '确认并继续保存' : '继续保存'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SlideOver>

      {feedbackDraft && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-4" role="presentation">
          <div
            className="w-full max-w-md rounded-md border border-line bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="analysis-feedback-title"
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 id="analysis-feedback-title" className="font-semibold text-ink">
                  {feedbackDraft.decision === 'confirmed' && '确认这是一项问题'}
                  {feedbackDraft.decision === 'ignored' && '忽略这条提醒'}
                  {feedbackDraft.decision === 'special_case' && '标记为特殊情况'}
                  {feedbackDraft.decision === 'review' && '恢复这条提醒'}
                </h2>
                <div className="mt-1 text-sm text-muted">{feedbackDraft.finding.title}</div>
              </div>
              <Button
                className="w-9 px-0"
                variant="ghost"
                aria-label="关闭反馈窗口"
                title="关闭"
                onClick={() => setFeedbackDraft(null)}
                icon={<X size={16} />}
              />
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="block">
                <span className="text-sm font-medium text-ink">说明（可选）</span>
                <textarea
                  value={feedbackDraft.note}
                  maxLength={500}
                  rows={4}
                  onChange={(event) => setFeedbackDraft({
                    ...feedbackDraft,
                    note: event.target.value,
                  })}
                  className="mt-2 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-slate-400"
                  placeholder="例如：这是菲律宾客户指定配置，只对当前配方适用"
                />
              </label>
              <div className="text-xs leading-5 text-muted">
                该判断只处理当前配方的这条提醒；同类高频项会自动计入候选规则证据，但不会自动批准或修改配方。
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <Button variant="ghost" onClick={() => setFeedbackDraft(null)}>取消</Button>
              <Button
                variant="primary"
                disabled={feedbackSaving}
                icon={feedbackDraft.decision === 'review' ? <RotateCcw size={15} /> : <Save size={15} />}
                onClick={() => void saveFeedback()}
              >
                {feedbackSaving ? '保存中' : '保存判断'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
