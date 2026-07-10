'use client';

import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import type { RecipePart } from '@/lib/recipes';
import { RecipeStatusBadge } from './RecipeSection';

type TemplateMatchSummaryProps = {
  parts: RecipePart[];
  total: number;
  onOpenAll: () => void;
  getSubtotal: (part: RecipePart) => number;
  getSourceLabel: (part: RecipePart) => string;
};

export function TemplateMatchSummary({ parts, total, onOpenAll, getSubtotal, getSourceLabel }: TemplateMatchSummaryProps) {
  return (
    <section title="模板 / 型号零配件" className="rounded-panel border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-slate-900">模板匹配结果</span>
            <RecipeStatusBadge tone={parts.length > 0 ? 'blue' : 'gray'}>{parts.length > 0 ? `${parts.length} 项` : '未匹配'}</RecipeStatusBadge>
            {parts.length > 0 ? <RecipeStatusBadge tone="blue">系统匹配</RecipeStatusBadge> : null}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {parts.length > 0 ? `已自动匹配 ${parts.length} 项，预计成本 ${money(total)}` : '选择泵壳模板或型号变体后自动匹配'}
          </div>
        </div>
        {parts.length > 3 ? (
          <Button type="button" size="sm" variant="ghost" onClick={onOpenAll}>
            + 查看全部 {parts.length} 项
          </Button>
        ) : null}
      </div>
      {parts.length > 0 ? (
        <div className="border-t border-line bg-slate-50/60">
          {parts.slice(0, 3).map((part, index) => (
            <div key={`${part.model}-${index}`} className="grid gap-2 border-b border-line px-4 py-2 text-xs last:border-b-0 md:grid-cols-[minmax(180px,1fr)_52px_88px_92px_minmax(100px,0.6fr)]">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-900" title={part.name || part.model}>{part.name || part.model}</div>
                <div className="truncate text-slate-500" title={`${part.model}${part.supplier ? ` / ${part.supplier}` : ''}`}>{part.model}{part.supplier ? ` / ${part.supplier}` : ''}</div>
              </div>
              <div className="text-slate-500">x{part.qty || 1}</div>
              <div className="text-slate-900">{money(Number(part.snapshotPrice || 0))}</div>
              <div className="font-medium text-slate-900">{money(getSubtotal(part))}</div>
              <div className="truncate text-slate-500" title={getSourceLabel(part)}>{getSourceLabel(part)}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
