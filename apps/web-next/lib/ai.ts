'use client';

import { proxyRequest, proxyStreamFetch, type ApiResponse } from './api';
import type { AiPageContext } from './page-context';
import type { FactoryFile } from './files';

export type AiRole = 'user' | 'assistant';

export type AiChatMessage = {
  role: AiRole;
  content: string;
  attachments?: AiAttachment[];
};

export type AiAttachment = Pick<
  FactoryFile,
  'id' | 'originalName' | 'detectedType' | 'mimeType' | 'fileSize' | 'downloadPath'
> & Partial<Pick<
  FactoryFile,
  'parserStatus' | 'parserSummary'
>>;

export type AiCapabilities = {
  provider: 'auto' | 'deepseek' | 'kimi';
  displayName: string;
  model: string;
  supportsImages: boolean;
  supportsFiles: boolean;
  acceptedFileTypes: Array<'pdf' | 'spreadsheet' | 'image' | 'text'>;
  maxAttachments: number;
  maxFileSize: number;
  defaultProvider?: 'deepseek';
  visionProvider?: 'kimi' | null;
};

export type AiProviderInfo = {
  provider: 'deepseek' | 'kimi';
  displayName: string;
  model: string;
  routeReason: 'default' | 'image' | 'vision_unavailable' | 'vision_fallback' | 'manual';
  fallback?: boolean;
  fallbackFrom?: 'kimi';
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
  };
  createdAt: string;
  updatedAt: string;
};

export type AiConversationDetail = AiConversationSummary & {
  messages: AiConversationMessage[];
};

export type AiAnswerFeedbackRating = 'helpful' | 'incorrect' | 'outdated' | 'missing_source';
export type AiAnswerFeedbackStatus = 'open' | 'resolved';

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
  sortOrder: number;
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
  latestRun: AiEvaluationRun | null;
  results: AiEvaluationResult[];
};

export type AiToolPlanStep = {
  index: number;
  name: string;
  label: string;
  mode: 'read' | 'write';
  requiresConfirmation?: boolean;
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
  | { type: 'done' }
  | { type: 'error'; message: string };

export const AI_CONTEXT_MESSAGE_LIMIT = 10;

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
  pageContext?: AiPageContext | null
): Promise<void> {
  const response = await proxyStreamFetch(resolveAiStreamUrl(), {
    method: 'POST',
    body: JSON.stringify({
      messages: messages.slice(-AI_CONTEXT_MESSAGE_LIMIT),
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

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取 AI 响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      try {
        onEvent(JSON.parse(raw) as AiStreamEvent);
      } catch {
        // Ignore partial or malformed SSE chunks.
      }
    }
  }
}

export async function generateAiDraftFromAttachment(
  prompt: string,
  attachment: AiAttachment,
  pageContext?: AiPageContext | null
): Promise<string> {
  let content = '';
  let errorMessage = '';
  await streamAiChat(
    [{ role: 'user', content: prompt, attachments: [attachment] }],
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

export async function getAiSystemPrompt(): Promise<string> {
  const result = await proxyRequest<ApiResponse<string>>('/api/ai/system-prompt');
  if (!result.success || typeof result.data !== 'string') throw new Error(result.error || '读取提示词失败');
  return result.data;
}

export async function updateAiSystemPrompt(prompt: string): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>('/api/ai/system-prompt', {
    method: 'PUT',
    body: JSON.stringify({ prompt }),
  });
  if (!result.success) throw new Error(result.error || '保存提示词失败');
}

export async function listAiConversations(): Promise<AiConversationSummary[]> {
  const result = await proxyRequest<ApiResponse<AiConversationSummary[]>>('/api/ai/conversations?limit=50');
  if (!result.success || !Array.isArray(result.data)) throw new Error(result.error || '读取会话历史失败');
  return result.data;
}

export async function createAiConversation(title: string): Promise<AiConversationSummary> {
  const result = await proxyRequest<ApiResponse<AiConversationSummary>>('/api/ai/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '创建会话失败');
  return result.data;
}

export async function getAiConversation(id: number): Promise<AiConversationDetail> {
  const result = await proxyRequest<ApiResponse<AiConversationDetail>>(`/api/ai/conversations/${id}`);
  if (!result.success || !result.data) throw new Error(result.error || '读取会话失败');
  return result.data;
}

export async function appendAiConversationMessage(
  conversationId: number,
  message: { role: AiRole; content: string; metadata?: AiConversationMessage['metadata'] }
): Promise<AiConversationMessage> {
  const result = await proxyRequest<ApiResponse<AiConversationMessage>>(`/api/ai/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(message),
  });
  if (!result.success || !result.data) throw new Error(result.error || '保存会话消息失败');
  return result.data;
}

export async function updateAiConversationMessage(
  conversationId: number,
  messageId: number,
  metadata: AiConversationMessage['metadata']
): Promise<AiConversationMessage> {
  const result = await proxyRequest<ApiResponse<AiConversationMessage>>(`/api/ai/conversations/${conversationId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ metadata }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '更新会话消息失败');
  return result.data;
}

export async function deleteAiConversation(id: number): Promise<void> {
  const result = await proxyRequest<ApiResponse<{ id: number }>>(`/api/ai/conversations/${id}`, { method: 'DELETE' });
  if (!result.success) throw new Error(result.error || '删除会话失败');
}

export async function getAiCapabilities(): Promise<AiCapabilities> {
  const result = await proxyRequest<ApiResponse<AiCapabilities>>('/api/ai/capabilities');
  if (!result.success || !result.data) throw new Error(result.error || '读取 AI 模型能力失败');
  return result.data;
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
  return result.data;
}

export async function submitAiAnswerFeedback(input: {
  messageId: number;
  rating: AiAnswerFeedbackRating;
  note?: string;
}): Promise<AiAnswerFeedback> {
  const result = await proxyRequest<ApiResponse<AiAnswerFeedback>>('/api/ai/feedback', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '保存 AI 回答反馈失败');
  return result.data;
}

export async function reviewAiAnswerFeedback(
  id: number,
  input: { status: AiAnswerFeedbackStatus; resolutionNote?: string }
): Promise<AiAnswerFeedback> {
  const result = await proxyRequest<ApiResponse<AiAnswerFeedback>>(`/api/ai/feedback/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '处理 AI 回答反馈失败');
  return result.data;
}

export async function diagnoseAiAnswerFeedback(id: number): Promise<AiAnswerFeedback> {
  const result = await proxyRequest<ApiResponse<AiAnswerFeedback>>(`/api/ai/feedback/${id}/diagnose`, {
    method: 'POST',
  });
  if (!result.success || !result.data) throw new Error(result.error || '诊断 AI 回答反馈失败');
  return result.data;
}

export async function recordAiAnswerFeedbackRetest(
  id: number,
  input: { answerText: string; toolResults: AiToolResult[] }
): Promise<AiAnswerFeedback> {
  const result = await proxyRequest<ApiResponse<AiAnswerFeedback>>(`/api/ai/feedback/${id}/retest`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '保存 AI 回答复测结果失败');
  return result.data;
}

export async function getAiEvaluationOverview(): Promise<AiEvaluationOverview> {
  const result = await proxyRequest<ApiResponse<AiEvaluationOverview>>('/api/ai/evaluations/overview');
  if (!result.success || !result.data) throw new Error(result.error || '读取知识库检查结果失败');
  return result.data;
}

export async function createAiEvaluationRun(): Promise<{ run: AiEvaluationRun; cases: AiEvaluationCase[] }> {
  const result = await proxyRequest<ApiResponse<{ run: AiEvaluationRun; cases: AiEvaluationCase[] }>>('/api/ai/evaluations/runs', {
    method: 'POST',
  });
  if (!result.success || !result.data) throw new Error(result.error || '创建知识库检查失败');
  return result.data;
}

export async function recordAiEvaluationResult(
  runId: number,
  input: { caseId: number; answerText?: string; toolResults?: AiToolResult[]; errorText?: string }
): Promise<AiEvaluationResult> {
  const result = await proxyRequest<ApiResponse<AiEvaluationResult>>(`/api/ai/evaluations/runs/${runId}/results`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '保存知识库检查结果失败');
  return result.data;
}

export async function completeAiEvaluationRun(runId: number): Promise<AiEvaluationRun> {
  const result = await proxyRequest<ApiResponse<AiEvaluationRun>>(`/api/ai/evaluations/runs/${runId}/complete`, {
    method: 'POST',
  });
  if (!result.success || !result.data) throw new Error(result.error || '完成知识库检查失败');
  return result.data;
}

export async function confirmAiTool(toolName: string, args: unknown): Promise<AiToolResult> {
  const result = await proxyRequest<ApiResponse<AiToolResult>>('/api/ai/confirm-tool', {
    method: 'POST',
    body: JSON.stringify({ toolName, args }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '确认执行失败');
  return result.data;
}

