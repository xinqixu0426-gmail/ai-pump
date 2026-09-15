'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getPartRenameImpact, type PartRenameImpact } from '@/lib/parts';

const sourceLabels: Record<string, string> = {
  part: '零件', coil: '线圈', template: '泵壳模板', recipe: '配方', modelVariant: '配置预设',
  quotation: '报价', order: '订单', orderRevision: '订单修订', drawing: '图纸', fileLink: '附件关联',
};
const statusLabels: Record<string, string> = {
  resolved_id: '已保存 ID', resolved_legacy: '仅按名称匹配', ambiguous: '有多个候选',
  missing: '找不到物料', inactive: '物料已停用', identity_mismatch: 'ID 与名称不一致',
  invalid_id: 'ID 无效', unstructured: '待核对', catalog_incomplete: '目录检查不完整',
  bound_reference: '历史显示绑定', bound_shell_reference: '泵壳绑定', legacy_shell_dependency: '按名称关联泵壳',
};

export function PartRenameImpactDetails({ report }: { report: PartRenameImpact }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="break-words">{report.nameChanged
        ? `拟改为：${report.proposedName}` : '名称未改变，以下为当前引用。'}</p>
      {!report.complete && <p className="text-rose-700">引用检查不完整，不能将未列出的对象视为没有引用。</p>}
      {report.blockers.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-amber-800">
          {report.blockers.map(item => <li key={item.code} className="break-words">{item.message}</li>)}
        </ul>
      ) : report.nameChanged ? <p>当前检查未发现普通改名阻塞，保存时仍会重新校验。</p> : null}
      <p className="text-muted">共 {report.referenceCount} 处引用，已显示 {report.references.length} 处。</p>
      {report.references.length > 0 && (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {report.references.map(ref => (
            <li key={`${ref.sourceType}:${ref.sourceId}:${ref.path}`} className="rounded-md border border-line bg-white p-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span>{sourceLabels[ref.sourceType] || '关联对象'} #{ref.sourceId}</span>
                <span className="text-xs text-muted">{statusLabels[ref.status] || '待核对'}</span>
              </div>
              <details className="mt-1 text-xs text-muted">
                <summary className="cursor-pointer">查看引用位置</summary>
                <p className="mt-1 break-all">{ref.path}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">检查不会修改资料或库存。有引用的零件仍需完成迁移后才能改名。</p>
    </div>
  );
}

// Parent keys this component by part ID and proposed name, so an edited name
// never displays or appends a report requested for the previous input.
export function PartRenameImpactPanel({ partId, model }: { partId: number; model: string }) {
  const [report, setReport] = useState<PartRenameImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => {
    const pending = request.current;
    request.current = null;
    pending?.abort();
  }, []);

  async function read(more = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setError(null);
    const previous = more ? report : null;
    if (!more) setReport(null);
    try {
      const next = await getPartRenameImpact(partId, model,
        previous && previous.nextOffset !== null ? { offset: previous.nextOffset, sourceHash: previous.sourceHash } : {},
        controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      setReport({ ...next, references: [...(previous?.references || []), ...next.references] });
    } catch (err) {
      if (request.current !== controller) return;
      // Discard all pages after any failure, including a changed source hash.
      setReport(null);
      setError(controller.signal.aborted ? '检查超时，请重新检查。' : err instanceof Error ? err.message : '检查失败，请重试。');
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-line bg-slate-50 p-3" aria-label="改名影响检查">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-medium">引用与改名影响</p><p className="mt-1 text-xs text-muted">按已保存的资料检查；其他未保存字段不参与本次检查。</p></div>
        <Button size="sm" onClick={() => void read()} disabled={loading || !model.trim()}>{loading ? '检查中…' : '检查引用'}</Button>
      </div>
      {error && <p role="alert" className="break-words text-sm text-rose-700">{error}</p>}
      {report && <PartRenameImpactDetails report={report} />}
      {report?.nextOffset != null && <Button size="sm" disabled={loading} onClick={() => void read(true)}>加载更多引用</Button>}
    </section>
  );
}
