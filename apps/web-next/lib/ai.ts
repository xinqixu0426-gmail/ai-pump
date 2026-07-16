'use client';

import { proxyFetch, proxyRequest, type ApiResponse } from './api';

export type AiRole = 'user' | 'assistant';

export type AiChatMessage = {
  role: AiRole;
  content: string;
};

export type AiToolResult = {
  name: string;
  result: unknown;
};

export type AiStreamEvent =
  | { type: 'status'; status: string; message?: string }
  | { type: 'content'; content: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'detail'; detailType?: string; toolResults?: AiToolResult[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

export async function streamAiChat(
  messages: AiChatMessage[],
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await proxyFetch('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
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

export async function confirmAiTool(toolName: string, args: unknown): Promise<AiToolResult> {
  const result = await proxyRequest<ApiResponse<AiToolResult>>('/api/ai/confirm-tool', {
    method: 'POST',
    body: JSON.stringify({ toolName, args }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '确认执行失败');
  return result.data;
}

