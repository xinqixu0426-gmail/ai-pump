'use client';

import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import type { RecipePart } from '@/lib/recipes';
import { RecipeStatusBadge } from './RecipeSection';

type TemplateMatchSummaryProps = {
  parts: RecipePart[];
  total: number;
  onOpenAll: () => void;
};

export function TemplateMatchSummary({ parts, total, onOpenAll }: TemplateMatchSummaryProps) {
  return (
    <div
      title="模板 / 型号零配件"
      className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-700">模板匹配</span>
        <RecipeStatusBadge tone={parts.length > 0 ? 'blue' : 'gray'}>
          {parts.length > 0 ? `${parts.length} 项` : '未匹配'}
        </RecipeStatusBadge>
        <span className="min-w-0 text-xs text-slate-500">
          {parts.length > 0 ? `预计成本 ${money(total)}` : '选择模板后自动匹配'}
        </span>
      </div>
      {parts.length > 0 ? (
        <Button type="button" size="sm" variant="ghost" onClick={onOpenAll} icon={<Eye size={14} />}>
          查看明细
        </Button>
      ) : null}
    </div>
  );
}
