'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteAiConversation,
  getAiConversation,
  listAiAnswerFeedback,
  listAiConversations,
  type AiAnswerFeedback,
  type AiConversationSummary,
} from '@/lib/ai';
import type { ChatItem } from '@/components/ai/AiAnswerProcess';

type OpenedConversation = {
  items: ChatItem[];
  feedbackByMessageId: Record<number, AiAnswerFeedback>;
};

const ACTIVE_CONVERSATION_STORAGE_KEY = 'pump.ai-active-conversation';

function readRestorableConversationId(): number | null {
  if (typeof window === 'undefined') return null;
  const value = Number(window.sessionStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function persistActiveConversationId(id: number | null) {
  if (typeof window === 'undefined') return;
  if (id) window.sessionStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, String(id));
  else window.sessionStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
}

export function useAiConversationHistory(locked: boolean) {
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [restorableConversationId, setRestorableConversationId] = useState<number | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [openingConversationId, setOpeningConversationId] = useState<number | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);

  const filteredConversations = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) => conversation.title.toLocaleLowerCase().includes(query));
  }, [conversations, historyQuery]);

  const refreshConversationList = useCallback(async () => {
    try {
      setConversations(await listAiConversations());
      setHistoryError('');
    } catch (error) {
      setHistoryError((error as Error).message || '读取会话历史失败');
    }
  }, []);

  useEffect(() => {
    setRestorableConversationId(readRestorableConversationId());
  }, []);

  useEffect(() => {
    let active = true;
    void listAiConversations()
      .then((rows) => {
        if (active) setConversations(rows);
      })
      .catch((error) => {
        if (active) setHistoryError((error as Error).message || '读取会话历史失败');
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function openConversation(id: number): Promise<OpenedConversation | null> {
    if (locked || openingConversationId) return null;
    setOpeningConversationId(id);
    setHistoryError('');
    try {
      const [conversation, feedback] = await Promise.all([
        getAiConversation(id),
        listAiAnswerFeedback({ conversationId: id }),
      ]);
      setActiveConversationId(conversation.id);
      setRestorableConversationId(conversation.id);
      persistActiveConversationId(conversation.id);
      return {
        feedbackByMessageId: Object.fromEntries(feedback.items.map((item) => [item.messageId, item])),
        items: conversation.messages.map((message) => ({
          id: `saved-${message.id}`,
          role: message.role,
          content: message.content,
          status: 'done',
          toolPlan: message.metadata?.toolPlan,
          toolCalls: message.metadata?.toolCalls || [],
          toolResults: message.metadata?.toolResults || [],
          attachments: message.metadata?.attachments || [],
          provider: message.metadata?.provider,
          persistedMessageId: message.id,
          historical: true,
        })),
      };
    } catch (error) {
      setHistoryError((error as Error).message || '读取会话失败');
      return null;
    } finally {
      setOpeningConversationId(null);
    }
  }

  async function removeConversation(id: number) {
    setDeletingConversation(true);
    try {
      await deleteAiConversation(id);
      const removedActiveConversation = activeConversationId === id;
      if (removedActiveConversation) {
        setActiveConversationId(null);
        setRestorableConversationId(null);
        persistActiveConversationId(null);
      }
      await refreshConversationList();
      return removedActiveConversation;
    } catch (error) {
      setHistoryError((error as Error).message || '删除会话失败');
      return null;
    } finally {
      setDeletingConversation(false);
    }
  }

  function addConversation(conversation: AiConversationSummary) {
    setActiveConversationId(conversation.id);
    setRestorableConversationId(conversation.id);
    persistActiveConversationId(conversation.id);
    setConversations((current) => [conversation, ...current]);
  }

  function clearActiveConversation() {
    setActiveConversationId(null);
    setRestorableConversationId(null);
    persistActiveConversationId(null);
  }

  function clearRestorableConversation() {
    setRestorableConversationId(null);
    persistActiveConversationId(null);
  }

  return {
    conversations,
    activeConversationId,
    restorableConversationId,
    historyQuery,
    historyLoading,
    historyError,
    openingConversationId,
    deletingConversation,
    filteredConversations,
    setHistoryQuery,
    setHistoryError,
    addConversation,
    clearActiveConversation,
    clearRestorableConversation,
    refreshConversationList,
    openConversation,
    removeConversation,
  };
}
