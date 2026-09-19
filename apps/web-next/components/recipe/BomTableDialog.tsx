'use client';

import { X } from 'lucide-react';
import { SlideOver } from '@/components/motion/slide-over';
import { money } from '@/lib/format';
import type { RecipePart } from '@/lib/recipes';

type BomTableDialogProps = {
  open: boolean;
  title?: string;
  parts: RecipePart[];
  total: number;
  onClose: () => void;
  getSubtotal: (part: RecipePart) => number;
  getSourceLabel: (part: RecipePart) => string;
  getFormula: (part: RecipePart) => string;
};

export function BomTableDialog({
  open,
  title = 'BOM 明细',
  parts,
  total,
  onClose,
  getSubtotal,
  getSourceLabel,
  getFormula,
}: BomTableDialogProps) {
  return (
    <SlideOver open={open} onClose={onClose} size="wide">
      <div className="bg-white">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">{title}</div>
            <div className="mt-1 text-sm text-slate-500">{parts.length} 项物料，当前成本合计 {money(total)}</div>
          </div>
          <button
            type="button"
            aria-label={`关闭${title}`}
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">
          <div className="max-h-[64vh] overflow-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[820px] table-fixed border-collapse text-left text-xs">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[25%]" />
                <col className="w-[9%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 shadow-[0_1px_0_0_rgb(226,232,240)]">
                <tr>
                  <th className="px-3 py-2 font-medium">物料名称</th>
                  <th className="px-3 py-2 font-medium">规格</th>
                  <th className="px-3 py-2 font-medium">数量</th>
                  <th className="px-3 py-2 font-medium">单位成本</th>
                  <th className="px-3 py-2 font-medium">金额</th>
                  <th className="px-3 py-2 font-medium">来源</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((part, index) => (
                  <tr key={`${part.model}-${index}`} className="border-t border-line">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      <div className="truncate" title={part.name || part.model}>{part.name || part.model}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      <div className="truncate" title={`${part.model}${part.supplier ? ` / ${part.supplier}` : ''}`}>{part.model}{part.supplier ? ` / ${part.supplier}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{part.qty || 1}</td>
                    <td className="px-3 py-2 text-slate-900">{money(Number(part.snapshotPrice || 0))}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{money(getSubtotal(part))}</td>
                    <td className="px-3 py-2 text-slate-500">
                      <div className="truncate" title={getFormula(part) || getSourceLabel(part)}>{getFormula(part) || getSourceLabel(part)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </SlideOver>
  );
}
