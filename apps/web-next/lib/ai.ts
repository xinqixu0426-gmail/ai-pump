'use client';

import {
  createIdempotencyKey,
  proxyFetch,
  proxyRequest,
  proxyStreamFetch,
  type ApiResponse,
} from './api';
import { confirmAiAssistantWriteProposal } from './ai-assistant-write-proposal-client.cjs';
import type { AiAssistantWriteCard } from './ai-assistant-write-proposal.cjs';
import type { AiPageContext } from './page-context';
import type { FactoryFile } from './files';

export type AiRole = 'user' | 'assistant';

export type AiChatMessage = {
  role: AiRole;
  content: string;
  attachments?: AiAttachment[];
  /** Candidate names from a previous verified turn; never carries IDs. */
  referenceEntities?: Array<{ entityType: string; canonicalName: string }>;
};

export type AiAttachment = Pick<
  FactoryFile,
  'id' | 'originalName' | 'detectedType' | 'mimeType' | 'fileSize' | 'downloadPath'
> & Partial<Pick<
  FactoryFile,
  'parserStatus' | 'parserSummary'
>>;

export type AiProviderPreference = 'default' | 'local' | 'deepseek' | 'kimi';

export type AiProviderOption = {
  value: AiProviderPreference;
  displayName: string;
  model: string;
  available: boolean;
  supportsImages: boolean;
};

export type AiCapabilities = {
  provider: 'auto' | 'local' | 'local-first' | 'deepseek' | 'kimi';
  displayName: string;
  model: string;
  supportsImages: boolean;
  supportsFiles: boolean;
  acceptedFileTypes: Array<'pdf' | 'spreadsheet' | 'image' | 'text'>;
  maxAttachments: number;
  maxFileSize: number;
  defaultProvider?: 'local' | 'deepseek';
  visionProvider?: 'local' | 'kimi' | null;
  fileProvider?: 'kimi' | null;
  providerOptions: AiProviderOption[];
};

export type AiProviderInfo = {
  provider: 'local' | 'deepseek' | 'kimi';
  displayName: string;
  model: string;
  routeReason: 'default' | 'local_primary' | 'local_fallback' | 'image' | 'file' | 'file_fallback' | 'vision_unavailable' | 'vision_fallback' | 'manual';
  fallback?: boolean;
  fallbackFrom?: 'local' | 'kimi';
};

export type AiTurnMetrics = {
  durationMs: number;
  firstContentMs: number | null;
  modelDurationMs: number | null;
  toolDurationMs: number;
  modelRequestCount: number;
  toolCallCount: number;
  tokensPerSecond: number | null;
  tokensPerSecondSource: 'provider_timings' | 'stream_observed' | 'usage_over_model_time' | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  requestId?: string | null;
  policyVersion?: number | string | null;
  routeClass?: 'SIMPLE_READ' | 'GENERAL' | string;
  judgeUsed?: boolean;
  selectedDomains?: string[];
  selectedCapabilities?: string[];
  exposedToolCount?: number;
  ontologyResolutionCount?: number;
  factCount?: number;
  goalCount?: number;
  goalStatuses?: string[];
  validatorResult?: string | null;
  writeProposalCreated?: boolean;
  writeExecuted?: boolean;
  timings?: Record<string, number>;
};

export type AiToolResult = {
  name: string;
  result: unknown;
};

export type AiKnowledgeSource = {
  kind: 'knowledge_snapshot';
  knowledgeEntryId: number;
  entryType: string;
  title: string;
  sourceTable: string;
  sourceId: string;
  syncedAt: string | null;
  sourceUpdatedAt: string | null;
  freshness: 'fresh' | 'pending_insert' | 'pending_update' | 'pending_delete';
  knowledgePath: string;
  sourcePath: string;
};

export type AiResultProvenance = {
  kind: 'live_business' | 'knowledge_snapshot';
  label: string;
  fetchedAt?: string;
  checkedAt?: string | null;
  hasPendingSources?: boolean;
};

export type AiConversationSummary = {
  id: number;
  title: string;
  messageCount: number;
  lastMessagePreview: string;
  createdAt: string;
  updatedAt: string;
};

export type AiConversationMessage = {
  id: number;
  conversationId: number;
  role: AiRole;
  content: string;
  metadata: {
    toolPlan?: AiToolPlan;
    toolCalls?: Array<{ name: string; args: unknown }>;
    toolResults?: AiToolResult[];
    attachments?: AiAttachment[];
    provider?: AiProviderInfo;
    metrics?: AiTurnMetrics;
    writeProposal?: AiWriteProposalHistory;
    referenceEntities?: Array<{ entityType: string; canonicalName: string }>;
  };
  createdAt: string;
  updatedAt: string;
};

export type AiConversationDetail = AiConversationSummary & {
  messages: AiConversationMessage[];
};

export type AiAnswerFeedbackRating = 'helpful' | 'incorrect' | 'outdated' | 'missing_source';
export type AiAnswerFeedbackStatus = 'open' | 'resolved';
export type AiV2FindingCategory = 'intent_understanding' | 'api_capability_design' | 'over_investigation' | 'missing_capability' | 'data_model' | 'answer_presentation' | 'performance' | 'stability' | 'other';
export type AiV2FindingStatus = 'open' | 'reviewed' | 'promoted' | 'dismissed';
export type AiV2Finding = {
  id: number;
  conversationId: number;
  userMessageId: number;
  assistantMessageId: number;
  category: AiV2FindingCategory | null;
  note: string;
  questionText: string;
  answerText: string;
  runtimeSnapshot: Record<string, unknown>;
  status: AiV2FindingStatus;
  createdAt: string;
  updatedAt: string;
  conversationDeleted: boolean;
};
export type AiV2FindingList = { items: AiV2Finding[]; limit: number };
export type FactoryAiRuleStatus = 'active' | 'disabled';
export type FactoryAiRuleScopeType = 'global' | 'domain' | 'object';
export type FactoryAiRuleType = 'answer_correction' | 'terminology' | 'fact_authority' | 'classification' | 'calculation' | 'workflow' | 'tool_selection' | 'answer_style';
export type FactoryAiRuleEffectiveStatus = 'effective' | 'pending_review' | 'scheduled' | 'expired' | 'conflicted' | 'shadowed' | 'duplicate' | 'out_of_scope' | 'disabled';
export type AiEvaluationReviewStatus = 'pending' | 'approved' | 'rejected';

export type FactoryAiRule = {
  id: number;
  sourceFeedbackId: number | null;
  title: string;
  triggerText: string;
  instruction: string;
  scopeType: FactoryAiRuleScopeType;
  domains: string[];
  objectType: string;
  objectRef: string;
  ruleType: FactoryAiRuleType;
  conflictGroup: string;
  priority: number;
  effectiveFrom: string | null;
  expiresAt: string | null;
  conflictKey: string;
  ruleVersion: number;
  evaluationCaseId: number | null;
  evaluationReviewStatus: AiEvaluationReviewStatus | null;
  evaluationEnabled: boolean;
  evaluationProposalHash: string;
  effectiveStatus: FactoryAiRuleEffectiveStatus | null;
  conflictWith: number[];
  status: FactoryAiRuleStatus;
  createdAt: string;
  updatedAt: string;
};

export type FactoryAiRuleList = {
  items: FactoryAiRule[];
  stats: {
    total: number;
    active: number;
    disabled: number;
    effective: number;
    pendingReview: number;
    scheduled: number;
    expired: number;
    conflicted: number;
    shadowed: number;
  };
};

export type AiAnswerFeedbackDiagnosis = {
  type: 'knowledge_outdated' | 'missing_citation' | 'knowledge_gap' | 'business_review';
  summary: string;
  checkedAt: string;
  knowledgePendingTotal: number;
  checkedSources: Array<AiKnowledgeSource & {
    currentStatus: 'fresh' | 'pending_insert' | 'pending_update' | 'pending_delete';
    currentTitle: string;
    currentSummary: string;
  }>;
  candidateSources: Array<{
    id: number;
    entryType: string;
    sourceTable: string;
    sourceId: string;
    title: string;
    summary: string;
  }>;
  actions: Array<{
    type: 'sync_knowledge' | 'review_candidates' | 'add_knowledge' | 'review_business_source' | 'retest';
    label: string;
  }>;
};

export type AiAnswerFeedback = {
  id: number;
  conversationId: number;
  conversationDeleted: boolean;
  messageId: number;
  rating: AiAnswerFeedbackRating;
  note: string;
  questionText: string;
  answerText: string;
  sources: AiKnowledgeSource[];
  diagnosis: AiAnswerFeedbackDiagnosis | null;
  diagnosedAt: string | null;
  retestAnswerText: string;
  retestSources: AiKnowledgeSource[];
  retestedAt: string | null;
  learningRule: FactoryAiRule | null;
  regressionCase: AiEvaluationCase | null;
  status: AiAnswerFeedbackStatus;
  resolutionNote: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiAnswerFeedbackList = {
  items: AiAnswerFeedback[];
  stats: {
    total: number;
    open: number;
    helpful: number;
    incorrect: number;
    outdated: number;
    missingSource: number;
  };
};

export type AiEvaluationCase = {
  id: number;
  caseKey: string;
  title: string;
  category: string;
  question: string;
  evaluatorType: 'rules';
  config: Record<string, unknown>;
  enabled: boolean;
  releaseGateEnabled: boolean;
  sortOrder: number;
  sourceType: 'system' | 'feedback';
  sourceFeedbackId: number | null;
  reviewStatus: AiEvaluationReviewStatus;
  confidenceScore: number;
  generationNote: string;
  proposalHash: string;
  reviewNote: string;
  reviewedAt: string | null;
  learningRuleStatus?: FactoryAiRuleStatus | null;
  createdAt: string;
  updatedAt: string;
};

export type AiEvaluationRun = {
  id: number;
  status: 'running' | 'completed' | 'failed';
  totalCount: number;
  passedCount: number;
  failedCount: number;
  reviewCount: number;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiEvaluationCheck = {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type AiEvaluationResult = {
  id: number;
  runId: number;
  caseId: number;
  caseTitle?: string;
  caseCategory?: string;
  status: 'passed' | 'failed' | 'review';
  answerText: string;
  toolResults: AiToolResult[];
  sources: AiKnowledgeSource[];
  checks: AiEvaluationCheck[];
  errorText: string;
  createdAt: string;
  updatedAt: string;
};

export type AiEvaluationOverview = {
  cases: AiEvaluationCase[];
  systemCases: AiEvaluationCase[];
  feedbackCases: AiEvaluationCase[];
  caseStats: {
    enabled: number;
    systemTotal: number;
    systemEnabled: number;
    releaseEnabled: number;
    feedbackTotal: number;
    feedbackApproved: number;
    feedbackPending: number;
    feedbackRejected: number;
  };
  latestRun: AiEvaluationRun | null;
  latestRunMatchesConfiguration: boolean;
  results: AiEvaluationResult[];
};

export type AiHealthSnapshot = {
  generatedAt: string;
  status: 'healthy' | 'attention';
  capabilityId: 'ai.health.read';
  provider: {
    mode: 'auto' | 'local' | 'local-first' | 'deepseek' | 'kimi';
    ready: boolean;
    requestTimeoutMs: number;
    providers: Array<{
      provider: 'local' | 'deepseek' | 'kimi';
      displayName: string;
      model: string;
      configured: boolean;
      required: boolean;
      supportsImages: boolean;
      supportsFileExtraction: boolean;
    }>;
  };
  runtime: {
    startedAt: string;
    windowSize: number;
    sampleCount: number;
    totals: {
      requests: number;
      completed: number;
      failed: number;
      cancelled: number;
      timeouts: number;
      fallbacks: number;
      retries: number;
      usageReportedRequests: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    latencyMs: { average: number; p95: number; maximum: number };
    ttftMs?: { sampleCount: number; average: number; p95: number; maximum: number };
    stages?: Record<string, { sampleCount: number; average: number; p95: number; maximum: number }>;
    usage?: {
      availability: number;
      reportedRequests: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      source: 'provider_reported_only';
    };
    lastRequestAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastError: {
      code: string;
      provider: string;
      status: number | null;
      requestId: string | null;
      at: string;
    } | null;
    providers: Array<{
      provider: string;
      model: string;
      requests: number;
      failures: number;
      fallbacks: number;
    }>;
  };
  releaseGate: {
    status: 'not_configured' | 'not_run' | 'running' | 'healthy' | 'attention';
    healthy: boolean;
    ready: boolean;
    latestRun: AiEvaluationRun | null;
    activeCaseCount: number;
    evaluatedActiveCaseCount: number;
    activeFailedCount: number;
    activeReviewCount: number;
  };
  process: {
    version: string;
    gitCommit: string;
    startedAt: string;
    uptimeSeconds: number;
  };
};

export type AiToolPlanStep = {
  index: number;
  name: string;
  label: string;
  mode: 'read' | 'write';
  requiresConfirmation?: boolean;
  source?: 'rule' | 'model' | 'unknown';
  validationStatus?: 'validated' | 'rejected';
  validationError?: string;
  argsSummary?: Array<{ key: string; value: string }>;
};

export type AiToolPlan = {
  summary: string;
  steps: AiToolPlanStep[];
};

export type AiStreamEvent =
  | { type: 'status'; status: string; message?: string }
  | ({ type: 'provider' } & AiProviderInfo)
  | { type: 'content'; content: string }
  | ({ type: 'tool_plan' } & AiToolPlan)
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'detail'; detailType?: string; toolResults?: AiToolResult[] }
  | ({ type: 'metrics' } & AiTurnMetrics)
  | { type: 'reference_context'; entities: Array<{ entityType: string; canonicalName: string }> }
  | AiAssistantWriteProposalStreamEvent
  | { type: 'done' }
  | { type: 'error'; message: string; code?: string };

/**
 * 助理受保护写的 Task-free 结构化提案事件。
 * 只承载服务端冻结的展示事实与不透明执行身份；不做任何前端计算。
 */
export type AiAssistantWriteProposalStreamEvent = {
  type: 'write_proposal';
  stage: 'AI_ASSISTANT_WRITE_PROPOSAL';
  proposal: {
    capabilityId: string;
    target: { entityType?: string; displayName: string };
    changes: Array<{ field: string; current?: unknown; proposed?: unknown; delta?: number }>;
    currentState?: Record<string, unknown>;
    proposedState?: Record<string, unknown>;
    warnings?: string[];
    item?: {
      model: string;
      currentStock: number;
      delta: number;
      nextStock: number;
      clampedToZero?: boolean;
    };
  };
  confirmation: {
    confirmationToken: string;
    expiresAt?: string | null;
  };
};

/**
 * 历史会话里只保留「这里曾有一张提案卡」的**非执行**标记：
 * 不持久化 confirmationToken，也不持久化任何可用来自行重建执行请求的数值。
 */
export type AiWriteProposalHistory = { capabilityId: string };

export const AI_CONTEXT_MESSAGE_LIMIT = 10;
export const AI_STREAM_INTERRUPTED_CODE = 'AI_STREAM_INTERRUPTED';

export class AiStreamTransportError extends Error {
  readonly code = AI_STREAM_INTERRUPTED_CODE;
  readonly retryable = true;

  constructor(message = 'AI 连接中断，请重试') {
    super(message);
    this.name = 'AiStreamTransportError';
  }
}

class AiStreamServerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code = '') {
    super(message);
    this.name = 'AiStreamServerError';
    this.code = code;
    this.retryable = code === 'AI_PROVIDER_NETWORK_ERROR';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as { name?: string } | null)?.name === 'AbortError';
}

function isFetchTransportError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /load failed|failed to fetch|fetch failed|network|connection|terminated/i.test(message);
}

export function isRetryableAiStreamError(error: unknown): boolean {
  return error instanceof AiStreamTransportError
    || (error as { code?: string; retryable?: boolean } | null)?.code === AI_STREAM_INTERRUPTED_CODE
    || (error as { retryable?: boolean } | null)?.retryable === true;
}

function resolveAiStreamUrl(): string {
  const configured = process.env.NEXT_PUBLIC_AI_STREAM_URL;
  if (configured) return configured;
  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return `http://${window.location.hostname}:3002/api/ai/chat`;
  }
  return '/api/ai/chat';
}

export async function streamAiChat(
  messages: AiChatMessage[],
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal,
  pageContext?: AiPageContext | null,
  conversationId?: string,
): Promise<void> {
  let response: Response;
  try {
    response = await proxyStreamFetch(resolveAiStreamUrl(), {
      method: 'POST',
      body: JSON.stringify({
        messages: messages.slice(-AI_CONTEXT_MESSAGE_LIMIT),
        ...(conversationId === undefined ? {} : { conversationId }),
        ...(pageContext ? {
          pageContext: {
            resourceType: pageContext.resourceType,
            resourceId: pageContext.resourceId,
            path: pageContext.path,
            view: pageContext.view,
          },
        } : {}),
      }),
      signal,
    });
  } catch (error) {
    if (isAbortError(error) || !isFetchTransportError(error)) throw error;
    throw new AiStreamTransportError();
  }

  const reader = response.body?.getReader();
  if (!reader) throw new AiStreamTransportError('无法读取 AI 响应流，请重试');

  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let serverError: Extract<AiStreamEvent, { type: 'error' }> | null = null;

  function consumeLine(line: string) {
    const normalized = line.trimEnd();
    if (!normalized.startsWith('data:')) return;
    const raw = normalized.slice(5).trim();
    if (!raw) return;
    try {
      const event = JSON.parse(raw) as AiStreamEvent;
      if (event.type === 'done') completed = true;
      if (event.type === 'error') serverError = event;
      onEvent(event);
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) consumeLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof AiStreamServerError || error instanceof AiStreamTransportError) throw error;
    throw new AiStreamTransportError();
  }

  const terminalServerError = serverError as Extract<AiStreamEvent, { type: 'error' }> | null;
  if (terminalServerError) {
    throw new AiStreamServerError(terminalServerError.message, terminalServerError.code);
  }
  if (!completed) {
    throw new AiStreamTransportError();
  }
}

export async function generateAiDraftFromAttachment(
  prompt: string,
  attachment: AiAttachment,
  pageContext?: AiPageContext | null
): Promise<string> {
  return generateAiDraftFromAttachments(prompt, [attachment], pageContext);
}

export async function generateAiDraftFromAttachments(
  prompt: string,
  attachments: AiAttachment[],
  pageContext?: AiPageContext | null
): Promise<string> {
  if (!attachments.length) throw new Error('请至少选择一个附件');
  if (attachments.length > 4) throw new Error('一次最多归纳 4 个附件');
  let content = '';
  let errorMessage = '';
  await streamAiChat(
    [{ role: 'user', content: prompt, attachments }],
    event => {
      if (event.type === 'content') content += event.content;
      if (event.type === 'error') errorMessage = event.message;
    },
    undefined,
    pageContext
  );
  if (errorMessage) throw new Error(errorMessage);
  const result = content.trim();
  if (!result) throw new Error('AI 没有生成可用的归纳内容');
  return result;
}

export type DomainPolicyVersion = {
  id: number;
  version: number;
  content: string;
  status: 'PUBLISHED' | 'SUPERSEDED';
  publishedAt: string;
};
export type DomainPolicyDraft = { content: string; baseVersionId: number; version: string; updatedAt: string };
export type DomainPolicyState = { published: DomainPolicyVersion; draft: DomainPolicyDraft };

export async function getDomainPolicy(): Promise<DomainPolicyState> {
  const result = await proxyRequest<ApiResponse<DomainPolicyState>>('/api/ai/domain-policy');
  if (!result.success || !result.data?.published || !result.data?.draft) throw new Error(result.error || '读取工厂规则失败');
  return result.data;
}
export async function saveDomainPolicyDraft(content: string, expectedVersion: string): Promise<DomainPolicyDraft> {
  const result = await proxyRequest<ApiResponse<DomainPolicyDraft>>('/api/ai/domain-policy/draft', {
    method: 'PUT', body: JSON.stringify({ content, expectedVersion }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '保存工厂规则草稿失败');
  return result.data;
}
export async function publishDomainPolicy(expectedDraftVersion: string, expectedPublishedVersion: number): Promise<DomainPolicyVersion> {
  const result = await proxyRequest<ApiResponse<DomainPolicyVersion>>('/api/ai/domain-policy/publish', {
    method: 'POST', body: JSON.stringify({ expectedDraftVersion, expectedPublishedVersion }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '发布工厂规则失败');
  return result.data;
}
export async function getDomainPolicyVersions(): Promise<{ versions: DomainPolicyVersion[] }> {
  const result = await proxyRequest<ApiResponse<{ versions: DomainPolicyVersion[] }>>('/api/ai/domain-policy/versions');
  if (!result.success || !result.data) throw new Error(result.error || '读取工厂规则历史失败');
  return result.data;
}
export type DomainPolicyDiff = { changes: Array<{ line: number; before: string; after: string }> };
export async function getDomainPolicyDiff(from: number | 'draft', to: number | 'draft'): Promise<DomainPolicyDiff> {
  const result = await proxyRequest<ApiResponse<DomainPolicyDiff>>(`/api/ai/domain-policy/diff?from=${encodeURIComponent(String(from))}&to=${encodeURIComponent(String(to))}`);
  if (!result.success || !result.data) throw new Error(result.error || '读取工厂规则差异失败');
  return result.data;
}
export async function rollbackDomainPolicy(versionId: number, expectedPublishedVersion: number): Promise<DomainPolicyVersion> {
  const result = await proxyRequest<ApiResponse<DomainPolicyVersion>>('/api/ai/domain-policy/rollback', {
    method: 'POST', body: JSON.stringify({ versionId, expectedPublishedVersion }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '回滚工厂规则失败');
  return result.data;
}

/**
 * 确认执行一次服务器签发的库存调整提案。
 * 只转发服务端签发的不透明身份；不做目标重解析、数量重算、幂等键生成或二次预览。
 * 成功只由服务端 verified 结果判定（含必要时的有界对账）。
 */
export function executeAiAssistantWriteProposal(card: AiAssistantWriteCard) {
  return confirmAiAssistantWriteProposal({ request: aiAssistantWriteProposalRequest, card });
}

/** 提案卡片的 HTTP 适配器：保留后端 `code`，供失败映射使用（不打印任何 token）。 */
async function aiAssistantWriteProposalRequest(
  path: string,
  options: { method: string; body?: string }
): Promise<{ status: number; body: unknown }> {
  const response = await proxyFetch(path, { method: options.method, body: options.body }, {
    throwOnError: false,
    redirectOnUnauthorized: false,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

export async function listAiConversations(): Promise<AiConversationSummary[]> {
  const result = await proxyRequest<ApiResponse<AiConversationSummary[]>>('/api/ai/conversations?limit=50');
  if (!result.success || !Array.isArray(result.data)) throw new Error(result.error || '读取会话历史失败');
  result.data.forEach(rememberAiConversationVersion);
  return result.data;
}

const aiConversationVersions = new Map<number, string>();
const aiConversationMessageVersions = new Map<string, string>();
const aiEvaluationRunVersions = new Map<number, string>();
const aiEvaluationCaseVersions = new Map<number, string>();
const aiAnswerFeedbackVersions = new Map<number, string>();
const aiAnswerFeedbackByMessage = new Map<number, string>();
const factoryAiRuleVersions = new Map<number, string>();

function conversationMessageVersionKey(conversationId: number, messageId: number) {
  return `${conversationId}:${messageId}`;
}

function rememberAiConversationVersion(conversation: AiConversationSummary) {
  if (conversation.updatedAt) {
    aiConversationVersions.set(conversation.id, conversation.updatedAt);
  }
  return conversation;
}

function rememberAiConversationMessageVersion(message: AiConversationMessage) {
  if (message.updatedAt) {
    aiConversationMessageVersions.set(
      conversationMessageVersionKey(message.conversationId, message.id),
      message.updatedAt
    );
  }
  const conversationUpdatedAt = (
    message as AiConversationMessage & { conversationUpdatedAt?: string }
  ).conversationUpdatedAt;
  if (conversationUpdatedAt) {
    aiConversationVersions.set(message.conversationId, conversationUpdatedAt);
  }
  return message;
}

function rememberAiEvaluationRunVersion(run: AiEvaluationRun) {
  if (run.updatedAt) {
    aiEvaluationRunVersions.set(run.id, run.updatedAt);
  }
  return run;
}

function rememberAiEvaluationCaseVersion(evaluationCase: AiEvaluationCase) {
  if (evaluationCase.updatedAt) {
    aiEvaluationCaseVersions.set(evaluationCase.id, evaluationCase.updatedAt);
  }
  return evaluationCase;
}

function rememberAiAnswerFeedbackVersion(feedback: AiAnswerFeedback) {
  if (feedback.updatedAt) {
    aiAnswerFeedbackVersions.set(feedback.id, feedback.updatedAt);
    aiAnswerFeedbackByMessage.set(feedback.messageId, feedback.updatedAt);
  }
  if (feedback.learningRule?.updatedAt) {
    factoryAiRuleVersions.set(
      feedback.learningRule.id,
      feedback.learningRule.updatedAt
    );
  }
  if (feedback.regressionCase) {
    rememberAiEvaluationCaseVersion(feedback.regressionCase);
  }
  return feedback;
}

function rememberFactoryAiRuleVersion(rule: FactoryAiRule) {
  if (rule.updatedAt) {
    factoryAiRuleVersions.set(rule.id, rule.updatedAt);
  }
  return rule;
}

export async function createAiConversation(title: string): Promise<AiConversationSummary> {
  const result = await proxyRequest<ApiResponse<AiConversationSummary>>('/api/ai/conversations', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey('ai-conversation-create'),
    },
    body: JSON.stringify({ title }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '创建会话失败');
  return rememberAiConversationVersion(result.data);
}

export async function getAiConversation(id: number): Promise<AiConversationDetail> {
  const result = await proxyRequest<ApiResponse<AiConversationDetail>>(`/api/ai/conversations/${id}`);
  if (!result.success || !result.data) throw new Error(result.error || '读取会话失败');
  rememberAiConversationVersion(result.data);
  result.data.messages.forEach(rememberAiConversationMessageVersion);
  return result.data;
}

export async function appendAiConversationMessage(
  conversationId: number,
  message: { role: AiRole; content: string; metadata?: AiConversationMessage['metadata'] }
): Promise<AiConversationMessage> {
  const result = await proxyRequest<ApiResponse<AiConversationMessage>>(`/api/ai/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-conversation-message:${conversationId}`),
    },
    body: JSON.stringify({
      ...message,
      expectedUpdatedAt: aiConversationVersions.get(conversationId) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '保存会话消息失败');
  return rememberAiConversationMessageVersion(result.data);
}

export async function updateAiConversationMessage(
  conversationId: number,
  messageId: number,
  metadata: AiConversationMessage['metadata']
): Promise<AiConversationMessage> {
  const result = await proxyRequest<ApiResponse<AiConversationMessage>>(`/api/ai/conversations/${conversationId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-conversation-message-update:${messageId}`),
    },
    body: JSON.stringify({
      metadata,
      expectedUpdatedAt: aiConversationMessageVersions.get(
        conversationMessageVersionKey(conversationId, messageId)
      ) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '更新会话消息失败');
  return rememberAiConversationMessageVersion(result.data);
}

export async function deleteAiConversation(id: number): Promise<void> {
  const result = await proxyRequest<ApiResponse<{ id: number }>>(`/api/ai/conversations/${id}`, {
    method: 'DELETE',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-conversation-delete:${id}`),
    },
    body: JSON.stringify({
      expectedUpdatedAt: aiConversationVersions.get(id) || null,
    }),
  });
  if (!result.success) throw new Error(result.error || '删除会话失败');
  aiConversationVersions.delete(id);
}

export async function batchDeleteAiConversations(ids: number[]): Promise<number[]> {
  const items = ids.map((id) => ({
    id,
    expectedUpdatedAt: aiConversationVersions.get(id) || null,
  }));
  if (items.some((item) => !item.expectedUpdatedAt)) {
    throw new Error('会话版本缺失，请刷新列表后重试');
  }
  const result = await proxyRequest<ApiResponse<{ ids: number[]; deletedCount: number }>>('/api/ai/conversations/batch-delete', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey('ai-conversation-batch-delete'),
    },
    body: JSON.stringify({ items }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '批量删除会话失败');
  result.data.ids.forEach((id) => aiConversationVersions.delete(id));
  return result.data.ids;
}

export async function listAiAnswerFeedback(filters: {
  conversationId?: number;
  status?: AiAnswerFeedbackStatus;
  rating?: AiAnswerFeedbackRating;
  limit?: number;
} = {}): Promise<AiAnswerFeedbackList> {
  const params = new URLSearchParams();
  if (filters.conversationId) params.set('conversationId', String(filters.conversationId));
  if (filters.status) params.set('status', filters.status);
  if (filters.rating) params.set('rating', filters.rating);
  params.set('limit', String(filters.limit || 50));
  const result = await proxyRequest<ApiResponse<AiAnswerFeedbackList>>(`/api/ai/feedback?${params}`);
  if (!result.success || !result.data) throw new Error(result.error || '读取 AI 回答反馈失败');
  result.data.items.forEach(rememberAiAnswerFeedbackVersion);
  return result.data;
}

export async function submitAiAnswerFeedback(input: {
  messageId: number;
  rating: AiAnswerFeedbackRating;
  note?: string;
  learnFromCorrection?: boolean;
}): Promise<AiAnswerFeedback> {
  const result = await proxyRequest<ApiResponse<AiAnswerFeedback>>('/api/ai/feedback', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-feedback-submit:${input.messageId}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: aiAnswerFeedbackByMessage.get(input.messageId) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '保存 AI 回答反馈失败');
  return rememberAiAnswerFeedbackVersion(result.data);
}

export async function listV2Findings(filters: {
  status?: AiV2FindingStatus;
  category?: AiV2FindingCategory;
  conversationId?: number;
  limit?: number;
} = {}): Promise<AiV2FindingList> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.conversationId) params.set('conversationId', String(filters.conversationId));
  params.set('limit', String(filters.limit || 50));
  const result = await proxyRequest<ApiResponse<AiV2FindingList>>(`/api/ai/v2-findings?${params}`);
  if (!result.success || !result.data) throw new Error(result.error || '读取 V2 记录失败');
  return result.data;
}

export async function getV2FindingDetail(id: number): Promise<AiV2Finding> {
  const result = await proxyRequest<ApiResponse<AiV2Finding>>(`/api/ai/v2-findings/${id}`);
  if (!result.success || !result.data) throw new Error(result.error || '读取 V2 记录失败');
  return result.data;
}

export async function saveV2Finding(input: {
  assistantMessageId: number;
  category?: AiV2FindingCategory | null;
  note?: string;
}): Promise<AiV2Finding> {
  const result = await proxyRequest<ApiResponse<AiV2Finding>>('/api/ai/v2-findings', {
    method: 'POST',
    headers: { 'Idempotency-Key': createIdempotencyKey(`ai-v2-finding:${input.assistantMessageId}`) },
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '记录给 V2 失败');
  return result.data;
}

export async function updateV2Finding(id: number, input: {
  category?: AiV2FindingCategory | null;
  note?: string;
  status?: AiV2FindingStatus;
  expectedUpdatedAt?: string;
}): Promise<AiV2Finding> {
  const result = await proxyRequest<ApiResponse<AiV2Finding>>(`/api/ai/v2-findings/${id}`, {
    method: 'PATCH',
    headers: { 'Idempotency-Key': createIdempotencyKey(`ai-v2-finding-update:${id}`) },
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '更新 V2 记录失败');
  return result.data;
}

export async function listFactoryAiRules(filters: {
  status?: FactoryAiRuleStatus;
  effectiveStatus?: FactoryAiRuleEffectiveStatus;
  domain?: string;
  limit?: number;
} = {}): Promise<FactoryAiRuleList> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.effectiveStatus) params.set('effectiveStatus', filters.effectiveStatus);
  if (filters.domain) params.set('domain', filters.domain);
  params.set('limit', String(filters.limit || 100));
  const result = await proxyRequest<ApiResponse<FactoryAiRuleList>>(`/api/ai/learning-rules?${params}`);
  if (!result.success || !result.data) throw new Error(result.error || '读取 AI 学习规则失败');
  result.data.items.forEach(rememberFactoryAiRuleVersion);
  return result.data;
}

export async function updateFactoryAiRule(
  id: number,
  input: {
    status?: FactoryAiRuleStatus;
    title?: string;
    triggerText?: string;
    instruction?: string;
    scopeType?: FactoryAiRuleScopeType;
    domains?: string[];
    objectType?: string;
    objectRef?: string;
    ruleType?: FactoryAiRuleType;
    conflictGroup?: string;
    priority?: number;
    effectiveFrom?: string | null;
    expiresAt?: string | null;
  }
): Promise<FactoryAiRule> {
  const result = await proxyRequest<ApiResponse<FactoryAiRule>>(`/api/ai/learning-rules/${id}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-learning-rule-update:${id}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: factoryAiRuleVersions.get(id) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '更新 AI 学习规则失败');
  return rememberFactoryAiRuleVersion(result.data);
}

export async function reviewAiAnswerFeedback(
  id: number,
  input: { status: AiAnswerFeedbackStatus; resolutionNote?: string }
): Promise<AiAnswerFeedback> {
  const result = await proxyRequest<ApiResponse<AiAnswerFeedback>>(`/api/ai/feedback/${id}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-feedback-review:${id}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: aiAnswerFeedbackVersions.get(id) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '处理 AI 回答反馈失败');
  return rememberAiAnswerFeedbackVersion(result.data);
}

export async function diagnoseAiAnswerFeedback(id: number): Promise<AiAnswerFeedback> {
  const result = await proxyRequest<ApiResponse<AiAnswerFeedback>>(`/api/ai/feedback/${id}/diagnose`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-feedback-diagnose:${id}`),
    },
    body: JSON.stringify({
      expectedUpdatedAt: aiAnswerFeedbackVersions.get(id) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '诊断 AI 回答反馈失败');
  return rememberAiAnswerFeedbackVersion(result.data);
}

export async function recordAiAnswerFeedbackRetest(
  id: number,
  input: { answerText: string; toolResults: AiToolResult[] }
): Promise<AiAnswerFeedback> {
  const result = await proxyRequest<ApiResponse<AiAnswerFeedback>>(`/api/ai/feedback/${id}/retest`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-feedback-retest:${id}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: aiAnswerFeedbackVersions.get(id) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '保存 AI 回答复测结果失败');
  return rememberAiAnswerFeedbackVersion(result.data);
}

export async function getAiEvaluationOverview(): Promise<AiEvaluationOverview> {
  const result = await proxyRequest<ApiResponse<AiEvaluationOverview>>('/api/ai/evaluations/overview');
  if (!result.success || !result.data) throw new Error(result.error || '读取知识库检查结果失败');
  result.data.cases.forEach(rememberAiEvaluationCaseVersion);
  (result.data.systemCases || []).forEach(rememberAiEvaluationCaseVersion);
  result.data.feedbackCases.forEach(rememberAiEvaluationCaseVersion);
  if (result.data.latestRun) rememberAiEvaluationRunVersion(result.data.latestRun);
  return result.data;
}

export async function createAiEvaluationRun(): Promise<{ run: AiEvaluationRun; cases: AiEvaluationCase[] }> {
  const result = await proxyRequest<ApiResponse<{ run: AiEvaluationRun; cases: AiEvaluationCase[] }>>('/api/ai/evaluations/runs', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey('ai-evaluation-run-start'),
    },
  });
  if (!result.success || !result.data) throw new Error(result.error || '创建知识库检查失败');
  rememberAiEvaluationRunVersion(result.data.run);
  result.data.cases.forEach(rememberAiEvaluationCaseVersion);
  return result.data;
}

export async function recordAiEvaluationResult(
  runId: number,
  input: { caseId: number; answerText?: string; toolResults?: AiToolResult[]; errorText?: string }
): Promise<AiEvaluationResult> {
  const result = await proxyRequest<ApiResponse<AiEvaluationResult>>(`/api/ai/evaluations/runs/${runId}/results`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-evaluation-result:${runId}:${input.caseId}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: aiEvaluationRunVersions.get(runId) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '保存知识库检查结果失败');
  return result.data;
}

export async function completeAiEvaluationRun(runId: number): Promise<AiEvaluationRun> {
  const result = await proxyRequest<ApiResponse<AiEvaluationRun>>(`/api/ai/evaluations/runs/${runId}/complete`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-evaluation-run-complete:${runId}`),
    },
    body: JSON.stringify({
      expectedUpdatedAt: aiEvaluationRunVersions.get(runId) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '完成知识库检查失败');
  return rememberAiEvaluationRunVersion(result.data);
}

export async function reviewAiEvaluationCase(
  id: number,
  input: { reviewStatus: AiEvaluationReviewStatus; reviewNote?: string }
): Promise<AiEvaluationCase> {
  const result = await proxyRequest<ApiResponse<AiEvaluationCase>>(`/api/ai/evaluations/cases/${id}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-evaluation-case-review:${id}`),
    },
    body: JSON.stringify({
      ...input,
      expectedUpdatedAt: aiEvaluationCaseVersions.get(id) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '审核纠错回归用例失败');
  return rememberAiEvaluationCaseVersion(result.data);
}

export async function getAiHealth(): Promise<AiHealthSnapshot> {
  const result = await proxyRequest<ApiResponse<AiHealthSnapshot>>('/api/ai/health');
  if (!result.success || !result.data) throw new Error(result.error || '读取 AI 运行健康失败');
  return result.data;
}

export async function configureAiSystemEvaluationCase(
  id: number,
  enabled: boolean
): Promise<AiEvaluationCase> {
  const result = await proxyRequest<ApiResponse<AiEvaluationCase>>(`/api/ai/evaluations/system-cases/${id}`, {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`ai-evaluation-system-case:${id}`),
    },
    body: JSON.stringify({
      enabled,
      expectedUpdatedAt: aiEvaluationCaseVersions.get(id) || null,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '更新系统检查项失败');
  return rememberAiEvaluationCaseVersion(result.data);
}
