'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listV2Findings,
  saveV2Finding,
  updateV2Finding,
  type AiV2Finding,
  type AiV2FindingCategory,
} from '@/lib/ai';
import type { ChatItem } from '@/components/ai/AiAnswerProcess';

export const v2FindingCategories: Array<{ value: AiV2FindingCategory; label: string }> = [
  { value: 'intent_understanding', label: '意图理解' },
  { value: 'api_capability_design', label: 'API 能力设计' },
  { value: 'over_investigation', label: '调查过多' },
  { value: 'missing_capability', label: '能力缺失' },
  { value: 'data_model', label: '数据模型' },
  { value: 'answer_presentation', label: '回答呈现' },
  { value: 'performance', label: '性能' },
  { value: 'stability', label: '稳定性' },
  { value: 'other', label: '其他' },
];

export function useAiV2Findings(onError: (message: string) => void) {
  const [byMessageId, setByMessageId] = useState<Record<number, AiV2Finding>>({});
  const [target, setTarget] = useState<ChatItem | null>(null);
  const [category, setCategory] = useState<AiV2FindingCategory | ''>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refreshForConversation = useCallback(async (conversationId?: number | null) => {
    if (!conversationId) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    try {
      const result = await listV2Findings({ conversationId, limit: 100 });
      setByMessageId(current => ({
        ...current,
        ...Object.fromEntries(result.items.map(item => [item.assistantMessageId, item])),
      }));
    } catch (error) {
      onError((error as Error).message || '读取 V2 记录失败');
    } finally {
      setLoaded(true);
    }
  }, [onError]);

  async function markOrEdit(item: ChatItem) {
    if (!item.persistedMessageId || saving || !loaded) return;
    const existing = byMessageId[item.persistedMessageId];
    if (existing) {
      setTarget(item);
      setCategory(existing.category || '');
      setNote(existing.note || '');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveV2Finding({ assistantMessageId: item.persistedMessageId });
      setByMessageId(current => ({ ...current, [saved.assistantMessageId]: saved }));
    } catch (error) {
      const message = (error as Error).message || '记录给 V2 失败';
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdits() {
    if (!target?.persistedMessageId || saving) return;
    const existing = byMessageId[target.persistedMessageId];
    if (!existing) return;
    setSaving(true);
    try {
      const saved = await updateV2Finding(existing.id, {
        category: category || null,
        note,
        expectedUpdatedAt: existing.updatedAt,
      });
      setByMessageId(current => ({ ...current, [saved.assistantMessageId]: saved }));
      setTarget(null);
    } catch (error) {
      onError((error as Error).message || '更新 V2 记录失败');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void refreshForConversation();
  }, [refreshForConversation]);

  return {
    byMessageId,
    target,
    category,
    note,
    saving,
    loaded,
    markOrEdit,
    saveEdits,
    setCategory,
    setNote,
    closeDialog: () => setTarget(null),
    refreshForConversation,
  };
}
