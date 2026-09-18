'use client';

import { useMemo, useRef, useState } from 'react';
import type { AiChatMessage, AiStreamEvent } from '@/lib/ai';
import type { ChatItem } from '@/components/ai/AiAnswerProcess';

export function applyAiStreamEvent(item: ChatItem, event: AiStreamEvent): ChatItem {
  if (event.type === 'status') return { ...item, status: event.status, statusMessage: event.message || '' };
  if (event.type === 'provider') {
    const { type: _type, ...provider } = event;
    return { ...item, provider };
  }
  if (event.type === 'content') return { ...item, content: item.content + event.content, status: 'answering', statusMessage: '' };
  if (event.type === 'tool_plan') return { ...item, toolPlan: { summary: event.summary, steps: event.steps || [] } };
  if (event.type === 'tool_call') {
    return {
      ...item,
      toolCalls: [...(item.toolCalls || []), { name: event.name, args: event.args }],
      status: 'calling',
      statusMessage: `调用 ${event.name}`,
    };
  }
  if (event.type === 'tool_result') {
    return { ...item, toolResults: [...(item.toolResults || []), { name: event.name, result: event.result }] };
  }
  if (event.type === 'detail') return { ...item, toolResults: event.toolResults || item.toolResults || [] };
  if (event.type === 'metrics') {
    const { type: _type, ...metrics } = event;
    return { ...item, metrics };
  }
  if (event.type === 'turn_state') return { ...item, turnState: event.turnState };
  if (event.type === 'done') return { ...item, status: 'done', statusMessage: '' };
  if (event.type === 'error') {
    return { ...item, status: 'error', statusMessage: event.message, content: item.content || event.message };
  }
  return item;
}

export function useAiMessageStream() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const apiMessages = useMemo<AiChatMessage[]>(() => (
    items
      .filter((item) => (
        item.role === 'user'
        || (
          item.role === 'assistant'
          && item.content.trim()
          && item.status !== 'error'
          && item.status !== 'cancelled'
        )
      ))
      .map((item) => ({
        role: item.role,
        content: item.content,
        ...(item.attachments?.length ? { attachments: item.attachments } : {}),
      }))
  ), [items]);

  function updateAssistant(id: string, updater: (item: ChatItem) => ChatItem) {
    setItems((current) => current.map((item) => (item.id === id ? updater(item) : item)));
  }

  function beginStream() {
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }

  function finishStream() {
    setLoading(false);
    abortRef.current = null;
  }

  function stopStream() {
    abortRef.current?.abort();
    setLoading(false);
  }

  return {
    items,
    setItems,
    loading,
    setLoading,
    apiMessages,
    updateAssistant,
    beginStream,
    finishStream,
    stopStream,
  };
}
