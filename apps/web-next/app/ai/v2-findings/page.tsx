'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { v2FindingCategories } from '@/components/ai/useAiV2Findings';
import {
  getV2FindingDetail,
  listV2Findings,
  updateV2Finding,
  type AiV2Finding,
  type AiV2FindingCategory,
  type AiV2FindingStatus,
} from '@/lib/ai';

const statuses: Array<{ value: AiV2FindingStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'open', label: '待查看' },
  { value: 'reviewed', label: '已查看' },
  { value: 'promoted', label: '已纳入计划' },
  { value: 'dismissed', label: '已忽略' },
];

const statusLabel = (value: AiV2FindingStatus) => statuses.find(item => item.value === value)?.label || value;
const categoryLabel = (value: AiV2FindingCategory | null) => value
  ? v2FindingCategories.find(item => item.value === value)?.label || value
  : '未分类';

export default function AiV2FindingsPage() {
  const router = useRouter();
  const [items, setItems] = useState<AiV2Finding[]>([]);
  const [selected, setSelected] = useState<AiV2Finding | null>(null);
  const [status, setStatus] = useState<AiV2FindingStatus | ''>('');
  const [category, setCategory] = useState<AiV2FindingCategory | ''>('');
  const [note, setNote] = useState('');
  const [detailStatus, setDetailStatus] = useState<AiV2FindingStatus>('open');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listV2Findings({ status: status || undefined, category: category || undefined, limit: 100 });
      setItems(result.items);
      if (selected && !result.items.some(item => item.id === selected.id)) setSelected(null);
      setError('');
    } catch (cause) {
      setError((cause as Error).message || '读取 V2 记录失败');
    } finally {
      setLoading(false);
    }
  }, [category, selected, status]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function openDetail(id: number) {
    try {
      const detail = await getV2FindingDetail(id);
      setSelected(detail);
      setNote(detail.note);
      setDetailStatus(detail.status);
      setError('');
    } catch (cause) {
      setError((cause as Error).message || '读取 V2 记录失败');
    }
  }

  async function saveDetail() {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await updateV2Finding(selected.id, {
        note,
        status: detailStatus,
        expectedUpdatedAt: selected.updatedAt,
      });
      setSelected(updated);
      setItems(current => current.map(item => item.id === updated.id ? updated : item));
      setError('');
    } catch (cause) {
      setError((cause as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function jumpToConversation(finding: AiV2Finding) {
    if (finding.conversationDeleted) return;
    window.sessionStorage.setItem('pump.ai-active-conversation', String(finding.conversationId));
    router.push('/ai');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 md:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={() => router.push('/ai')}>返回 AI 工作台</Button>
          <h1 className="mt-2 text-2xl font-semibold text-ink">V2 Findings</h1>
          <p className="mt-1 text-sm text-muted">真实使用中的问题与证据快照，仅供后续架构研究。</p>
        </div>
        <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={() => void refresh()} disabled={loading}>刷新</Button>
      </header>
      {error ? <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      <div className="mb-4 flex flex-wrap gap-3">
        <select aria-label="按状态筛选" value={status} onChange={event => setStatus(event.target.value as AiV2FindingStatus | '')} className="h-10 rounded-md border border-line bg-white px-3 text-sm">
          {statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select aria-label="按分类筛选" value={category} onChange={event => setCategory(event.target.value as AiV2FindingCategory | '')} className="h-10 rounded-md border border-line bg-white px-3 text-sm">
          <option value="">全部分类</option>
          {v2FindingCategories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      <div className="grid min-h-[60vh] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="space-y-2">
          {loading ? <div className="rounded-md border border-line bg-white p-5 text-sm text-muted">正在读取…</div> : null}
          {!loading && items.length === 0 ? <div className="rounded-md border border-dashed border-line bg-white p-8 text-center text-sm text-muted">还没有记录。可在已保存的 AI 回答下点击“记录给 V2”。</div> : null}
          {items.map(item => (
            <Button key={item.id} variant="secondary" onClick={() => void openDetail(item.id)} className={`h-auto w-full flex-col items-stretch p-4 text-left ${selected?.id === item.id ? 'border-ink' : 'border-line'}`}>
              <div className="flex items-center justify-between gap-2 text-xs text-muted"><span>{new Date(item.createdAt).toLocaleString()}</span><span>{statusLabel(item.status)} · {categoryLabel(item.category)}</span></div>
              <div className="mt-2 line-clamp-2 text-sm font-medium text-ink">{item.questionText}</div>
              <div className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">{item.answerText}</div>
              {item.note ? <div className="mt-2 line-clamp-2 text-xs text-muted">备注：{item.note}</div> : null}
            </Button>
          ))}
        </section>
        <section className="rounded-md border border-line bg-white p-4">
          {!selected ? <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted">选择一条记录查看详情</div> : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted">记录于 {new Date(selected.createdAt).toLocaleString()} · {categoryLabel(selected.category)}</div>
                {!selected.conversationDeleted ? <Button variant="ghost" size="sm" icon={<ExternalLink size={14} />} onClick={() => jumpToConversation(selected)}>打开原会话</Button> : <span className="text-xs text-muted">原会话已删除，快照仍保留</span>}
              </div>
              <div><h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Owner 问题</h2><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{selected.questionText}</p></div>
              <div><h2 className="text-xs font-semibold uppercase tracking-wide text-muted">AI 回答</h2><p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-ink">{selected.answerText}</p></div>
              <label className="block"><span className="text-xs font-medium text-muted">Owner 备注</span><textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={3} className="mt-1 w-full rounded-md border border-line bg-slate-50 p-2 text-sm" /></label>
              <label className="block"><span className="text-xs font-medium text-muted">状态</span><select value={detailStatus} onChange={event => setDetailStatus(event.target.value as AiV2FindingStatus)} className="mt-1 h-9 rounded-md border border-line bg-white px-2 text-sm">{statuses.filter(item => item.value).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <details><summary className="cursor-pointer text-xs font-medium text-muted">运行证据摘要</summary><pre className="mt-2 max-h-56 overflow-auto rounded-md bg-slate-50 p-3 text-[11px]">{JSON.stringify(selected.runtimeSnapshot, null, 2)}</pre></details>
              <div className="flex justify-end"><Button onClick={() => void saveDetail()} disabled={saving}>{saving ? '保存中…' : '保存更改'}</Button></div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
