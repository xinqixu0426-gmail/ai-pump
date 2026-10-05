'use client';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import type { AiV2FindingCategory } from '@/lib/ai';
import { v2FindingCategories } from '@/components/ai/useAiV2Findings';
import type { ChatItem } from '@/components/ai/AiAnswerProcess';

export function AiV2FindingDialog({
  target,
  category,
  note,
  saving,
  onCategoryChange,
  onNoteChange,
  onSave,
  onClose,
}: {
  target: ChatItem;
  category: AiV2FindingCategory | '';
  note: string;
  saving: boolean;
  onCategoryChange: (value: AiV2FindingCategory | '') => void;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={() => { if (!saving) onClose(); }} size="md" layer="assistant" closeOnBackdrop={false} ariaLabelledBy="v2-finding-title">
      <div>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id="v2-finding-title" className="text-base font-semibold text-ink">记录给 V2</h2>
            <p className="mt-1 text-xs text-muted">这条真实使用记录只用于未来架构研究，不会改变当前回答或业务数据。</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>关闭</Button>
        </div>
        <div className="space-y-4 p-4">
          <div className="max-h-28 overflow-y-auto rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">{target.content}</div>
          <label className="block">
            <span className="text-xs font-medium text-muted">分类（可选）</span>
            <select value={category} onChange={event => onCategoryChange(event.target.value as AiV2FindingCategory | '')} className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink">
              <option value="">不分类</option>
              {v2FindingCategories.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">补充说明（可选）</span>
            <textarea value={note} onChange={event => onNoteChange(event.target.value)} maxLength={2000} rows={3} placeholder="例如：答案是对的，但为了查成本跑了太多接口。" className="mt-2 w-full resize-y rounded-md border border-line bg-slate-50 px-3 py-2 text-sm leading-6 text-ink" disabled={saving} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>取消</Button>
            <Button onClick={onSave} disabled={saving}>{saving ? '保存中…' : '保存修改'}</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
