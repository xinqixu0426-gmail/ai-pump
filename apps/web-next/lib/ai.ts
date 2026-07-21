'use client';

import { proxyRequest, proxyStreamFetch, type ApiResponse } from './api';

export type AiRole = 'user' | 'assistant';

export type AiChatMessage = {
  role: AiRole;
  content: string;
};

export type AiToolResult = {
  name: string;
  result: unknown;
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
  };
  createdAt: string;
  updatedAt: string;
};

export type AiConversationDetail = AiConversationSummary & {
  messages: AiConversationMessage[];
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
  signal?: AbortSignal
): Promise<void> {
  const response = await proxyStreamFetch(resolveAiStreamUrl(), {
    method: 'POST',
    body: JSON.stringify({ messages: messages.slice(-AI_CONTEXT_MESSAGE_LIMIT) }),
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

export async function confirmAiTool(toolName: string, args: unknown): Promise<AiToolResult> {
  const result = await proxyRequest<ApiResponse<AiToolResult>>('/api/ai/confirm-tool', {
    method: 'POST',
    body: JSON.stringify({ toolName, args }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '确认执行失败');
  return result.data;
}

