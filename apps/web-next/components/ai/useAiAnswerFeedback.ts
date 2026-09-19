'use client';

import { useState } from 'react';
import {
  submitAiAnswerFeedback,
  type AiAnswerFeedback,
  type AiAnswerFeedbackRating,
} from '@/lib/ai';
import type { ChatItem } from '@/components/ai/AiAnswerProcess';

export function useAiAnswerFeedback(onError: (message: string) => void) {
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<number, AiAnswerFeedback>>({});
  const [feedbackTarget, setFeedbackTarget] = useState<ChatItem | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<Exclude<AiAnswerFeedbackRating, 'helpful'>>('incorrect');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackLearn, setFeedbackLearn] = useState(true);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');

  async function markAnswerHelpful(item: ChatItem) {
    if (!item.persistedMessageId || feedbackSaving) return;
    setFeedbackSaving(true);
    setFeedbackError('');
    try {
      const feedback = await submitAiAnswerFeedback({
        messageId: item.persistedMessageId,
        rating: 'helpful',
      });
      setFeedbackByMessageId((current) => ({ ...current, [feedback.messageId]: feedback }));
    } catch (error) {
      const message = (error as Error).message || '保存反馈失败';
      setFeedbackError(message);
      onError(message);
    } finally {
      setFeedbackSaving(false);
    }
  }

  function openAnswerIssue(item: ChatItem) {
    const existing = item.persistedMessageId ? feedbackByMessageId[item.persistedMessageId] : undefined;
    const issueRating = existing?.rating !== 'helpful' ? existing?.rating : undefined;
    setFeedbackTarget(item);
    setFeedbackRating(issueRating || 'incorrect');
    setFeedbackNote(existing?.note || '');
    setFeedbackLearn(existing?.learningRule?.status === 'active' || !existing);
    setFeedbackError('');
  }

  async function saveAnswerIssue() {
    if (!feedbackTarget?.persistedMessageId || feedbackSaving) return;
    if (feedbackLearn && feedbackRating === 'incorrect' && !feedbackNote.trim()) {
      setFeedbackError('让 AI 长期记住时，请填写以后应该遵守的正确做法。');
      return;
    }
    setFeedbackSaving(true);
    setFeedbackError('');
    try {
      const feedback = await submitAiAnswerFeedback({
        messageId: feedbackTarget.persistedMessageId,
        rating: feedbackRating,
        note: feedbackNote,
        learnFromCorrection: feedbackRating === 'incorrect' && feedbackLearn,
      });
      setFeedbackByMessageId((current) => ({ ...current, [feedback.messageId]: feedback }));
      setFeedbackTarget(null);
    } catch (error) {
      setFeedbackError((error as Error).message || '保存反馈失败');
    } finally {
      setFeedbackSaving(false);
    }
  }

  function changeFeedbackRating(value: Exclude<AiAnswerFeedbackRating, 'helpful'>) {
    setFeedbackRating(value);
    setFeedbackLearn(value === 'incorrect');
  }

  function resetFeedback() {
    setFeedbackByMessageId({});
  }

  return {
    feedbackByMessageId,
    feedbackTarget,
    feedbackRating,
    feedbackNote,
    feedbackLearn,
    feedbackSaving,
    feedbackError,
    setFeedbackByMessageId,
    setFeedbackNote,
    setFeedbackLearn,
    markAnswerHelpful,
    openAnswerIssue,
    saveAnswerIssue,
    changeFeedbackRating,
    resetFeedback,
    closeFeedbackDialog: () => setFeedbackTarget(null),
  };
}
