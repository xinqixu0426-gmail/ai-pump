'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InlineNotice } from '@/components/ui/notice';
import { cancelAiTask, getAiTask, resumeAiTask, startAiTask, type AiTaskPublicView } from '@/lib/ai';

const labels: Record<string, string> = {
  NEW: '等待后台执行', UNDERSTANDING: '理解中', RESOLVING: '查询中', RUNNING: '查询中',
  WAITING_INPUT: '需补充', WAITING_APPROVAL: '等待确认', VERIFYING: '核对中', SUSPENDED: '已暂停',
  RECONCILING: '核对中', SUCCEEDED: '已完成', PARTIAL: '部分完成', UNSUPPORTED: '暂不支持', FAILED: '执行失败', CANCELLED: '已停止',
};
const terminal = new Set(['SUCCEEDED', 'PARTIAL', 'UNSUPPORTED', 'FAILED', 'CANCELLED']);

type Props = { conversationId: number | null; userMessageId: number | null; initialTaskId?: string | null; onTaskCreated?: (taskId: string) => Promise<void>; persistAnswerMessage?: (content: string) => Promise<void> };
export function AiTaskWorkbench({ conversationId, userMessageId, initialTaskId = null, onTaskCreated, persistAnswerMessage }: Props) {
  const [task, setTask] = useState<AiTaskPublicView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const storageKey = conversationId ? `pump-ai-task:${conversationId}` : null;
  const refresh = useCallback(async (taskId: string) => { const next = await getAiTask(taskId); setTask(next); return next; }, []);
  useEffect(() => {
    if (!storageKey) { setTask(null); return; }
    const taskId = initialTaskId || window.localStorage.getItem(storageKey);
    if (!taskId) { setTask(null); return; }
    void refresh(taskId).catch(() => window.localStorage.removeItem(storageKey));
  }, [storageKey, initialTaskId, refresh]);
  useEffect(() => {
    if (!task || terminal.has(task.state)) return;
    const timer = window.setInterval(() => void refresh(task.taskId).catch((cause) => setError((cause as Error).message)), 2000);
    return () => window.clearInterval(timer);
  }, [task, refresh]);
  const canStart = Boolean(conversationId && userMessageId && !busy);
  const pendingQuestions = useMemo(() => task?.questions.filter(question => !question.answeredAt) || [], [task]);
  const begin = async () => {
    if (!conversationId || !userMessageId) return;
    setBusy(true); setError('');
    try { const ack = await startAiTask(conversationId, userMessageId); window.localStorage.setItem(`pump-ai-task:${conversationId}`, ack.taskId); await onTaskCreated?.(ack.taskId); await refresh(ack.taskId); }
    catch (cause) { setError((cause as Error).message || '创建后台任务失败'); }
    finally { setBusy(false); }
  };
  const resume = async () => {
    if (!task) return;
    const payload = pendingQuestions.map(question => ({ questionId: question.questionId, choiceId: question.choices.length ? (answers[question.questionId] || null) : null, answerText: question.choices.length ? null : (answers[question.questionId] || null) }));
    setBusy(true); setError('');
    try {
      if (!persistAnswerMessage) throw new Error('当前会话无法持久化补充信息');
      for (const question of pendingQuestions) {
        const value = question.choices.length ? question.choices.find(choice => choice.choiceId === answers[question.questionId])?.label : answers[question.questionId];
        if (!value) throw new Error('请先填写所有补充信息');
        await persistAnswerMessage(value);
      }
      const ack = await resumeAiTask(task, payload); await refresh(ack.taskId); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const cancel = async () => { if (!task) return; setBusy(true); setError(''); try { await cancelAiTask(task, '用户停止后台任务'); await refresh(task.taskId); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  return (
    <div className="border-t border-line bg-white px-4 py-3">
      {!task ? <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted">需要较长时间的查询可显式转为后台任务。</p><Button size="sm" variant="secondary" onClick={() => void begin()} disabled={!canStart}>后台执行</Button></div> : (
        <div className="space-y-2 rounded-md border border-line bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium text-ink">后台任务：{labels[task.state] || task.state}</p><p className="text-xs text-muted">{task.userGoal}</p></div><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setExpanded(value => !value)}>{expanded ? '收起依据' : '查看目标'}</Button>{!terminal.has(task.state) ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>停止</Button> : null}</div></div>
          {expanded ? <div className="space-y-2 text-xs text-muted">{task.goals.map(goal => <div key={goal.goalKey}><span className="font-medium text-ink">{goal.description}</span> · {goal.state}{goal.blockers.map(blocker => <p key={blocker.code}>{blocker.message}</p>)}</div>)}{task.steps.map(step => <p key={step.stepId}>{step.displayName} · {step.state}</p>)}</div> : null}
          {pendingQuestions.length ? <div className="space-y-2">{pendingQuestions.map(question => <label key={question.questionId} className="block text-xs text-ink">{question.prompt}{question.choices.length ? <select className="mt-1 block w-full rounded border border-line bg-white p-2" value={answers[question.questionId] || ''} onChange={event => setAnswers(value => ({ ...value, [question.questionId]: event.target.value }))}><option value="">请选择</option>{question.choices.map(choice => <option key={choice.choiceId} value={choice.choiceId}>{choice.label}</option>)}</select> : <input className="mt-1 block w-full rounded border border-line bg-white p-2" value={answers[question.questionId] || ''} onChange={event => setAnswers(value => ({ ...value, [question.questionId]: event.target.value }))} />}</label>)}<Button size="sm" onClick={() => void resume()} disabled={busy}>后台继续</Button></div> : null}
          {task.resultSummary ? <p className="text-sm text-ink">{task.resultSummary}</p> : null}
        </div>
      )}
      {error ? <InlineNotice tone="danger" className="mt-2">{error}</InlineNotice> : null}
    </div>
  );
}
