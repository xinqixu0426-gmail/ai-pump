'use client';

import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';

export type RecipeSelectionRow = {
  id: string;
  model: string;
  supplier: string;
  qty: string;
  packagingMaterial: string;
  costSource: '' | 'manual';
  snapshotPrice: string;
};

type RecipeDataTableProps = {
  kind: 'optional' | 'packing';
  rows: RecipeSelectionRow[];
  disabled?: boolean;
  modelListId: string;
  emptyText: string;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<RecipeSelectionRow>) => void;
  onRemove: (id: string) => void;
  getAmount: (row: RecipeSelectionRow) => number;
  getCostLine: (row: RecipeSelectionRow) => string;
  getFormula?: (row: RecipeSelectionRow) => string;
  formulaLabel?: string;
};

export function RecipeDataTable({
  kind,
  rows,
  disabled,
  modelListId,
  emptyText,
  onAdd,
  onUpdate,
  onRemove,
  getAmount,
  getCostLine,
  getFormula,
  formulaLabel = '公式:',
}: RecipeDataTableProps) {
  const isPacking = kind === 'packing';

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-line bg-slate-50 p-4 text-sm text-slate-500">
        <span>{emptyText}</span>
        <Button type="button" size="sm" onClick={onAdd} disabled={disabled}>
          添加
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-full overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-xs">
        <colgroup>
          <col className={isPacking ? 'w-[28%]' : 'w-[32%]'} />
          <col className="w-[15%]" />
          <col className="w-[9%]" />
          {isPacking ? <col className="w-[12%]" /> : null}
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[52px]" />
        </colgroup>
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-2.5 py-2 font-medium">名称</th>
            <th className="px-2.5 py-2 font-medium">供应商</th>
            <th className="px-2.5 py-2 font-medium">数量</th>
            {isPacking ? <th className="px-2.5 py-2 font-medium">类型</th> : null}
            <th className="px-2.5 py-2 font-medium">价格类型</th>
            <th className="px-2.5 py-2 font-medium">单价</th>
            <th className="px-2.5 py-2 font-medium">金额</th>
            <th className="px-2.5 py-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line align-top">
              <td className="px-2.5 py-2">
                <input
                  value={row.model}
                  onChange={(event) => onUpdate(row.id, { model: event.target.value })}
                  list={modelListId}
                  placeholder={isPacking ? '包材型号' : '型号'}
                  className="h-8 w-full min-w-0 rounded-md border border-line px-2 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-slate-400"
                />
                <div className="mt-1 truncate text-[11px] text-slate-500" title={getCostLine(row)}>{getCostLine(row)}</div>
                {getFormula?.(row) ? (
                  <div className="mt-0.5 truncate text-[11px] text-slate-500" title={getFormula(row)}>{formulaLabel} {getFormula(row)}</div>
                ) : null}
              </td>
              <td className="px-2.5 py-2">
                <input
                  value={row.supplier}
                  onChange={(event) => onUpdate(row.id, { supplier: event.target.value })}
                  placeholder="供应商"
                  className="h-8 w-full min-w-0 rounded-md border border-line px-2 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-slate-400"
                />
              </td>
              <td className="px-2.5 py-2">
                <input
                  value={row.qty}
                  onChange={(event) => onUpdate(row.id, { qty: event.target.value })}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="数量"
                  className="h-8 w-full rounded-md border border-line px-2 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-slate-400"
                />
              </td>
              {isPacking ? (
                <td className="px-2.5 py-2">
                  <input
                    value={row.packagingMaterial}
                    onChange={(event) => onUpdate(row.id, { packagingMaterial: event.target.value })}
                    placeholder="纸箱/泡沫"
                    className="h-8 w-full rounded-md border border-line px-2 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </td>
              ) : null}
              <td className="px-2.5 py-2">
                <select
                  value={row.costSource}
                  onChange={(event) => onUpdate(row.id, { costSource: event.target.value as RecipeSelectionRow['costSource'] })}
                  className="h-8 w-full rounded-md border border-line bg-white px-2 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-slate-400"
                >
                  <option value="">目录价</option>
                  <option value="manual">手输价</option>
                </select>
              </td>
              <td className="px-2.5 py-2">
                <input
                  value={row.snapshotPrice}
                  onChange={(event) => onUpdate(row.id, { snapshotPrice: event.target.value })}
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={row.costSource !== 'manual'}
                  placeholder="单价"
                  className="h-8 w-full rounded-md border border-line px-2 text-sm text-slate-900 outline-none transition-colors duration-150 focus:border-slate-400 disabled:opacity-60"
                />
              </td>
              <td className="px-2.5 py-2 text-sm font-medium text-slate-900">{money(getAmount(row))}</td>
              <td className="px-2.5 py-2">
                <button
                  type="button"
                  aria-label="删除"
                  title="删除"
                  onClick={() => onRemove(row.id)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-rose-600 transition-colors duration-150 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={disabled}
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
