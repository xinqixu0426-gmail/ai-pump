'use client';

import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';

type BomPreviewProps = {
  count: number;
  disabled?: boolean;
  onOpen: () => void;
};

export function BomPreview({ count, disabled, onOpen }: BomPreviewProps) {
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-500">BOM 明细</div>
          <div className="mt-0.5 text-base font-semibold text-slate-900">{count} 项物料</div>
        </div>
        <Button type="button" size="sm" onClick={onOpen} disabled={disabled} icon={<Eye size={14} />}>
          查看 BOM 明细
        </Button>
      </div>
    </div>
  );
}
