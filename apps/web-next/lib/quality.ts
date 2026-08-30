import { createIdempotencyKey, proxyRequest, type ApiResponse } from './api';
import type { RecipePart } from './recipes';

export type QualitySeverity = 'danger' | 'warning' | 'info';

export type QualityIssueItem = {
  kind: string;
  id: string;
  title: string;
  desc: string;
  path: string;
  meta?: Record<string, unknown>;
};

export type QualityIssueGroup = {
  key: string;
  title: string;
  severity: QualitySeverity;
  count: number;
  suggestion: string;
  items: QualityIssueItem[];
};

export type DataQualitySummary = {
  generatedAt: string;
  score: number;
  totals: {
    parts: number;
    recipes: number;
    templates: number;
    variants: number;
    coils: number;
    customers: number;
    quotations: number;
    issueCount: number;
    dangerCount: number;
    warningCount: number;
  };
  issues: QualityIssueGroup[];
  topIssues: QualityIssueGroup[];
};

export type BusinessAlertSeverity = 'high' | 'medium' | 'low';
export type BusinessAlertScope = 'quotation' | 'order';

export type BusinessAlert = {
  severity: BusinessAlertSeverity;
  scope: BusinessAlertScope;
  entityId: string;
  title: string;
  detail: string;
  action: string;
  path: string;
};

export type BusinessAlertsSummary = {
  generatedAt: string;
  totals: {
    high: number;
    medium: number;
    low: number;
    all: number;
  };
  alerts: BusinessAlert[];
  topAlerts: BusinessAlert[];
};

export type RecipeAnalysisSeverity = 'danger' | 'warning' | 'info';
export type RecipeAnalysisConfidence = 'high' | 'medium' | 'low';
export type RecipeAnalysisFeedbackDecision = 'confirmed' | 'ignored' | 'special_case' | 'review';

export type RecipeAnalysisFeedback = {
  id: number;
  recipeId?: number;
  findingKey?: string;
  findingType?: string;
  decision: RecipeAnalysisFeedbackDecision;
  note: string;
  updatedAt: string | null;
  outdated?: boolean;
  outdatedReason?: string;
  ruleLearning?: {
    refreshed: true;
    minimumEvidence: number;
    minimumConfidence: number;
    stats: { created: number; updated: number; stale: number; suspended: number; active: number; driftedEvidence: number; outdatedEvidence: number };
    candidateCount: number;
  };
};

export type RecipeAnalysisMissingItem = {
  key: string;
  type: 'configuration_conflict' | 'peer_pattern' | 'factory_rule';
  severity: RecipeAnalysisSeverity;
  confidence: RecipeAnalysisConfidence;
  title: string;
  explanation: string;
  role?: string;
  suggestedModels?: string[];
  prevalence?: number;
  evidence: Array<string | {
    source?: string;
    ruleId?: number;
    ruleTitle?: string;
    evidenceCount?: number;
    approvedAt?: string | null;
    reviewNote?: string;
    recipeId?: number;
    recipeName?: string;
    model?: string;
    score?: number;
  }>;
  rule?: {
    id: number;
    ruleKey: string;
    title: string;
    content: string;
    findingKey: string;
    role: string;
    evidenceCount: number;
    approvedAt: string | null;
    reviewNote: string;
  };
  feedback?: RecipeAnalysisFeedback | null;
};

export type RecipeAnalysisPriceAlert = {
  key: string;
  type: 'catalog_price_difference' | 'peer_price_outlier';
  severity: 'warning' | 'info';
  confidence: RecipeAnalysisConfidence;
  title: string;
  model: string;
  role: string;
  currentPrice: number;
  referenceMedian: number;
  referenceMin: number;
  referenceMax: number;
  difference: number;
  differencePercent: number;
  explanation: string;
  evidence: Array<Record<string, unknown>>;
  feedback?: RecipeAnalysisFeedback | null;
};

export type RecipeAnalysisFinding = RecipeAnalysisMissingItem | RecipeAnalysisPriceAlert;

export type FactoryRuleCandidateStatus = 'candidate' | 'approved' | 'rejected' | 'stale';

export type FactoryRuleCandidate = {
  id: number;
  ruleKey: string;
  title: string;
  content: string;
  scopeType: string;
  scopeRef: string;
  findingKey: string;
  findingType: string;
  evidenceCount: number;
  evidence: Array<{
    recipeId: number;
    recipeName: string;
    feedbackId: number;
    note: string;
    findingTitle: string;
    confirmedAt: string | null;
  }>;
  supportCount: number;
  specialCaseCount: number;
  ignoredCount: number;
  driftedCount: number;
  outdatedCount: number;
  confidenceScore: number;
  confidenceLevel: RecipeAnalysisConfidence;
  approvalEligible: boolean;
  approvalBlockers: string[];
  approvalRequirements: {
    minimumSupport: number;
    minimumConfidence: number;
  };
  learningEvidence: {
    supporting: Array<Record<string, unknown>>;
    specialCases: Array<Record<string, unknown>>;
    ignored: Array<Record<string, unknown>>;
    drifted: Array<Record<string, unknown>>;
    outdated: Array<Record<string, unknown>>;
  };
  status: FactoryRuleCandidateStatus;
  needsReview: boolean;
  learningUpdatedAt: string | null;
  reviewNote: string;
  approvedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  knowledgeSync?: {
    candidateId: number;
    candidateStatus: FactoryRuleCandidateStatus;
    action: 'inserted' | 'updated' | 'unchanged' | 'deleted' | 'absent';
    ftsEnabled: boolean;
    knowledgeEntry: {
      id: number;
      title: string;
      syncedAt: string;
    } | null;
  };
};

export type FactoryRuleEvent = {
  id: number;
  candidateId: number;
  ruleKey: string;
  ruleTitle: string;
  eventType: 'baseline' | 'created' | 'evidence_changed' | 'approved' | 'rejected' | 'reopened' | 'stale' | 'reactivated' | 'restored' | string;
  previousStatus: FactoryRuleCandidateStatus | null;
  newStatus: FactoryRuleCandidateStatus | null;
  actor: string;
  note: string;
  snapshot: Record<string, unknown>;
  createdAt: string;
};

export type FactoryRuleRestoreResult = {
  candidate: FactoryRuleCandidate;
  restoredFromEvent: FactoryRuleEvent;
  knowledgeSync: NonNullable<FactoryRuleCandidate['knowledgeSync']>;
};

export type FactoryRuleImpactItem = {
  recipeId: number;
  recipeName: string;
  spec: string;
  hasRequiredRole: boolean;
  decision: RecipeAnalysisFeedbackDecision;
  originalDecision: RecipeAnalysisFeedbackDecision;
  note: string;
  feedbackUpdatedAt: string | null;
  recipeUpdatedAt: string | null;
  feedbackOutdated: boolean;
};

export type FactoryRuleImpact = {
  generatedAt: string;
  candidate: FactoryRuleCandidate;
  scope: {
    templateId: number;
    templateName: string;
    requiredRole: string;
  };
  summary: {
    totalRecipes: number;
    compliantCount: number;
    needsReviewCount: number;
    specialCaseCount: number;
    ignoredCount: number;
    outdatedFeedbackCount: number;
    attentionRate: number;
  };
  groups: {
    compliant: FactoryRuleImpactItem[];
    needsReview: FactoryRuleImpactItem[];
    specialCases: FactoryRuleImpactItem[];
    ignored: FactoryRuleImpactItem[];
  };
  guidance: string;
};

export type FactoryRuleCompliance = {
  generatedAt: string;
  summary: {
    approvedRuleCount: number;
    rulesWithViolations: number;
    rulesNeedingEvidenceReview: number;
    affectedRecipeCount: number;
    ruleViolationCount: number;
    exceptionCount: number;
    checkedRecipeRulePairs: number;
  };
  affectedRecipes: Array<{
    recipeId: number;
    recipeName: string;
    spec: string;
    ruleIds: number[];
    ruleTitles: string[];
  }>;
  rules: Array<{
    candidate: FactoryRuleCandidate;
    scope: FactoryRuleImpact['scope'];
    summary: FactoryRuleImpact['summary'];
    groups: FactoryRuleImpact['groups'];
    status: 'attention' | 'compliant';
    guidance: string;
  }>;
  guidance: string;
};

export type FactoryLearningHealthStatus = 'active' | 'outdated' | 'drifted' | 'archived';

export type FactoryLearningHealth = {
  generatedAt: string;
  summary: {
    totalEvidenceCount: number;
    activeEvidenceCount: number;
    recheckEvidenceCount: number;
    outdatedEvidenceCount: number;
    driftedEvidenceCount: number;
    archivedEvidenceCount: number;
    affectedRecipeCount: number;
    confirmedCount: number;
    specialCaseCount: number;
    ignoredCount: number;
  };
  items: Array<{
    feedbackId: number;
    recipeId: number;
    recipeName: string;
    findingKey: string;
    findingType: string;
    findingTitle: string;
    decision: Exclude<RecipeAnalysisFeedbackDecision, 'review'>;
    note: string;
    status: FactoryLearningHealthStatus;
    reason: string;
    needsRecheck: boolean;
    templateIdAtDecision: number | null;
    templateNameAtDecision: string;
    currentTemplateId: number | null;
    currentTemplateName: string;
    recipeUpdatedAtAtDecision: string | null;
    currentRecipeUpdatedAt: string | null;
    legacyContext: boolean;
    decidedAt: string | null;
  }>;
  guidance: string;
};

export type RecipeConfigurationAnalysis = {
  version: string;
  generatedAt: string;
  mode: 'draft' | 'saved_recipe';
  advisoryOnly: true;
  recipe: {
    id: number | null;
    name: string;
    spec: string;
    templateId: number | null;
    savedTotalCost: number;
    partCount: number;
  };
  summary: {
    similarRecipeCount: number;
    definiteIssueCount: number;
    reviewSuggestionCount: number;
    appliedFactoryRuleCount: number;
    factoryRuleAlertCount: number;
    priceAlertCount: number;
    highConfidenceAlertCount: number;
    suppressedFindingCount: number;
    outdatedFeedbackCount: number;
  };
  similarRecipes: Array<{
    id: number;
    name: string;
    spec: string;
    score: number;
    confidence: RecipeAnalysisConfidence;
    reasons: string[];
    sharedRoles: string[];
    targetOnlyRoles: string[];
    referenceOnlyRoles: string[];
    savedTotalCost: number;
  }>;
  factoryRuleAlerts: RecipeAnalysisMissingItem[];
  missingItems: RecipeAnalysisMissingItem[];
  priceAlerts: RecipeAnalysisPriceAlert[];
  suppressedFindings: RecipeAnalysisFinding[];
  guidance: string[];
};

export type RecipeConfigurationAnalysisInput = {
  recipeId?: number;
  recipeName?: string;
  limit?: number;
  draft?: {
    id?: number;
    name: string;
    spec?: string;
    templateId?: number | null;
    coilId?: number | null;
    coilSchemeFamilyCode?: string;
    coilSpec?: string;
    coilSheets?: number;
    coilMaterial?: string;
    coilSlotType?: string;
    hasFloat?: boolean | number;
    floatWire?: string;
    hasCable?: boolean | number;
    cableLength?: number;
    savedTotalCost?: number;
    parts: RecipePart[];
  };
};

const recipeFeedbackVersions = new Map<number, string>();
const recipeFindingFeedbackVersions = new Map<string, string>();
const factoryRuleCandidateVersions = new Map<number, string>();
const factoryRuleEventCandidates = new Map<number, number>();

function recipeFindingVersionKey(recipeId: number, findingKey: string) {
  return `${recipeId}:${findingKey}`;
}

function rememberRecipeFeedbackVersion<T extends RecipeAnalysisFeedback>(
  feedback: T,
  recipeId?: number,
  findingKey?: string
): T {
  if (feedback.updatedAt) {
    recipeFeedbackVersions.set(feedback.id, feedback.updatedAt);
    const resolvedRecipeId = feedback.recipeId || recipeId;
    const resolvedFindingKey = feedback.findingKey || findingKey;
    if (resolvedRecipeId && resolvedFindingKey) {
      recipeFindingFeedbackVersions.set(
        recipeFindingVersionKey(resolvedRecipeId, resolvedFindingKey),
        feedback.updatedAt
      );
    }
  }
  return feedback;
}

function rememberAnalysisFeedbackVersions(analysis: RecipeConfigurationAnalysis) {
  for (const finding of [
    ...analysis.factoryRuleAlerts,
    ...analysis.missingItems,
    ...analysis.priceAlerts,
    ...analysis.suppressedFindings,
  ]) {
    if (finding.feedback) {
      rememberRecipeFeedbackVersion(
        finding.feedback,
        analysis.recipe.id || undefined,
        finding.key
      );
    }
  }
  return analysis;
}

function rememberFactoryRuleCandidateVersion<T extends FactoryRuleCandidate>(candidate: T): T {
  if (candidate.updatedAt) {
    factoryRuleCandidateVersions.set(candidate.id, candidate.updatedAt);
  }
  return candidate;
}

export async function getDataQualitySummary(): Promise<DataQualitySummary> {
  const result = await proxyRequest<ApiResponse<DataQualitySummary>>('/api/quality/summary');
  if (!result.success || !result.data) throw new Error(result.error || '数据质量加载失败');
  return result.data;
}

export async function getBusinessAlerts(): Promise<BusinessAlertsSummary> {
  const result = await proxyRequest<ApiResponse<BusinessAlertsSummary>>('/api/quality/business-alerts');
  if (!result.success || !result.data) throw new Error(result.error || '经营异常提醒加载失败');
  return result.data;
}

export async function analyzeRecipeConfiguration(input: RecipeConfigurationAnalysisInput): Promise<RecipeConfigurationAnalysis> {
  const result = await proxyRequest<ApiResponse<RecipeConfigurationAnalysis>>('/api/quality/recipe-analysis', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '配方智能检查失败');
  return rememberAnalysisFeedbackVersions(result.data);
}

export async function saveRecipeAnalysisFeedback(
  recipeId: number,
  input: {
    findingKey: string;
    findingType: string;
    decision: RecipeAnalysisFeedbackDecision;
    note?: string;
    findingSnapshot?: Record<string, unknown>;
  }
): Promise<RecipeAnalysisFeedback> {
  const result = await proxyRequest<ApiResponse<RecipeAnalysisFeedback>>(`/api/quality/recipes/${recipeId}/feedback`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`recipe-analysis-feedback:${recipeId}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: recipeFindingFeedbackVersions.get(
        recipeFindingVersionKey(recipeId, input.findingKey)
      ) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '检查反馈保存失败');
  return rememberRecipeFeedbackVersion(result.data, recipeId, input.findingKey);
}

export async function resolveRecipeAnalysisFeedback(
  feedbackId: number,
  input: { note?: string } = {}
): Promise<RecipeAnalysisFeedback & {
  resolved: true;
  previousDecision: Exclude<RecipeAnalysisFeedbackDecision, 'review'>;
  resolutionReason: 'template_drift' | 'content_outdated';
}> {
  const result = await proxyRequest<ApiResponse<RecipeAnalysisFeedback & {
    resolved: true;
    previousDecision: Exclude<RecipeAnalysisFeedbackDecision, 'review'>;
    resolutionReason: 'template_drift' | 'content_outdated';
  }>>(`/api/quality/recipe-feedback/${feedbackId}/resolve`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`recipe-analysis-feedback-resolve:${feedbackId}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: recipeFeedbackVersions.get(feedbackId) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '待复核反馈处理失败');
  return rememberRecipeFeedbackVersion(result.data);
}

export async function getFactoryRuleCandidates(): Promise<FactoryRuleCandidate[]> {
  const result = await proxyRequest<ApiResponse<FactoryRuleCandidate[]>>('/api/quality/rule-candidates');
  if (!result.success || !result.data) throw new Error(result.error || '候选规则加载失败');
  return result.data.map(rememberFactoryRuleCandidateVersion);
}

export async function getFactoryLearningHealth(limit = 100): Promise<FactoryLearningHealth> {
  const result = await proxyRequest<ApiResponse<FactoryLearningHealth>>(`/api/quality/rule-learning-health?limit=${limit}`);
  if (!result.success || !result.data) throw new Error(result.error || '学习证据健康状态加载失败');
  for (const item of result.data.items) {
    if (item.decidedAt) recipeFeedbackVersions.set(item.feedbackId, item.decidedAt);
  }
  return result.data;
}

export async function getFactoryRuleEvents(input: {
  candidateId?: number;
  limit?: number;
} = {}): Promise<FactoryRuleEvent[]> {
  const query = new URLSearchParams();
  if (input.candidateId) query.set('candidateId', String(input.candidateId));
  if (input.limit) query.set('limit', String(input.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const result = await proxyRequest<ApiResponse<FactoryRuleEvent[]>>(`/api/quality/rule-events${suffix}`);
  if (!result.success || !result.data) throw new Error(result.error || '规则变更记录加载失败');
  for (const event of result.data) {
    factoryRuleEventCandidates.set(event.id, event.candidateId);
  }
  return result.data;
}

export async function restoreFactoryRuleEvent(
  eventId: number,
  input: { restoreNote?: string } = {}
): Promise<FactoryRuleRestoreResult> {
  const result = await proxyRequest<ApiResponse<FactoryRuleRestoreResult>>(`/api/quality/rule-events/${eventId}/restore`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`factory-rule-event-restore:${eventId}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: factoryRuleCandidateVersions.get(
        factoryRuleEventCandidates.get(eventId) || 0
      ) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '规则审核状态恢复失败');
  rememberFactoryRuleCandidateVersion(result.data.candidate);
  return result.data;
}

export async function refreshFactoryRuleCandidates(): Promise<{
  minimumEvidence: number;
  minimumConfidence: number;
  stats: { created: number; updated: number; stale: number; suspended: number; active: number; driftedEvidence: number; outdatedEvidence: number };
  candidates: FactoryRuleCandidate[];
}> {
  const result = await proxyRequest<ApiResponse<{
    minimumEvidence: number;
    minimumConfidence: number;
    stats: { created: number; updated: number; stale: number; suspended: number; active: number; driftedEvidence: number; outdatedEvidence: number };
    candidates: FactoryRuleCandidate[];
  }>>('/api/quality/rule-candidates/refresh', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey('factory-rule-candidates-refresh'),
    },
  });
  if (!result.success || !result.data) throw new Error(result.error || '候选规则归纳失败');
  result.data.candidates.forEach(rememberFactoryRuleCandidateVersion);
  return result.data;
}

export async function getFactoryRuleImpact(id: number): Promise<FactoryRuleImpact> {
  const result = await proxyRequest<ApiResponse<FactoryRuleImpact>>(`/api/quality/rule-candidates/${id}/impact`);
  if (!result.success || !result.data) throw new Error(result.error || '规则影响分析失败');
  rememberFactoryRuleCandidateVersion(result.data.candidate);
  return result.data;
}

export async function getFactoryRuleCompliance(): Promise<FactoryRuleCompliance> {
  const result = await proxyRequest<ApiResponse<FactoryRuleCompliance>>('/api/quality/rule-compliance');
  if (!result.success || !result.data) throw new Error(result.error || '规则执行情况加载失败');
  result.data.rules.forEach(rule => rememberFactoryRuleCandidateVersion(rule.candidate));
  return result.data;
}

export async function reviewFactoryRuleCandidate(
  id: number,
  input: { status: 'candidate' | 'approved' | 'rejected'; reviewNote?: string }
): Promise<FactoryRuleCandidate> {
  const result = await proxyRequest<ApiResponse<FactoryRuleCandidate>>(`/api/quality/rule-candidates/${id}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`factory-rule-candidate-review:${id}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: factoryRuleCandidateVersions.get(id) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '候选规则审核失败');
  return rememberFactoryRuleCandidateVersion(result.data);
}

export function qualitySeverityClassName(severity: QualitySeverity): string {
  if (severity === 'danger') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
}

export function businessAlertClassName(severity: BusinessAlertSeverity): string {
  if (severity === 'high') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'medium') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
}
