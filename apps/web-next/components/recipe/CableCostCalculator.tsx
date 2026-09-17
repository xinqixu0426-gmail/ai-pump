'use client';

import { useEffect, useState } from 'react';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { previewRecipeBomDraft, type RecipePart, type CableAccessoryType } from '@/lib/recipes';
import { partFormulaLine, recipePartSubtotal } from './recipe-cost-display';

type WirePart = { id: number; model: string; supplier: string; category: string; naming?: { ruleId: string; spec: { wireValue?: unknown } } | null };

export function CableCostCalculator({ open, onClose, parts }: { open: boolean; onClose: () => void; parts: WirePart[] }) {
  const [partId, setPartId] = useState('');
  const [length, setLength] = useState('8');
  const [accessoryType, setAccessoryType] = useState<CableAccessoryType>('standard');
  const [result, setResult] = useState<RecipePart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selected = parts.find(part => part.id === Number(partId) && part.category === '电缆线');
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    if (!open || !selected || !Number.isFinite(Number(length)) || Number(length) <= 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      // Read-only formal BOM preview supports standalone dynamic items without a template.
      const wire = selected.naming?.spec.wireValue ?? selected.model.match(/^电缆-线径([0-9]+(?:\.[0-9]+)?)$/)?.[1];
      void previewRecipeBomDraft({ hasCable: true, cablePartId: selected.id, cableWire: String(wire ?? ''), cableLength: Number(length), cableAccessoryType: accessoryType })
        .then(draft => {
          if (cancelled) return;
          const cable = draft.parts.find(part => part.cableAssembly && part.partId === selected.id);
          if (!cable || cable.pricingComplete === false) throw new Error('该电缆缺少有效目录价格，请先补齐零件库');
          setResult(cable);
        })
        .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : '电缆试算失败'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, selected, length, accessoryType]);
  const inputClass = 'mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink';
  return <SlideOver open={open} onClose={onClose} ariaLabel="电缆成本试算">
    <div className="space-y-4 p-5">
      <h2 className="text-lg font-semibold text-ink">电缆成本试算</h2>
      <p className="text-sm text-muted">无需模板或配方，只读试算，不保存数据。选择线材后填写长度，自动计算完整成品电缆成本。</p>
      <label className="block text-sm">电缆线材 / 供应商<select className={inputClass} value={partId} onChange={event => setPartId(event.target.value)}><option value="">选择电缆线材</option>{parts.filter(part => part.category === '电缆线').map(part => <option key={part.id} value={part.id}>{part.model} · {part.supplier || '未标供应商'}</option>)}</select></label>
      <label className="block text-sm">长度 m<input className={inputClass} type="number" min="0.1" step="0.1" value={length} onChange={event => setLength(event.target.value)} /></label>
      <label className="block text-sm">插头 / 规格<select className={inputClass} value={accessoryType} onChange={event => setAccessoryType(event.target.value as CableAccessoryType)}><option value="standard">普通</option><option value="xinjie">新界式</option></select></label>
      <div className="rounded-panel border border-line bg-slate-50 p-4" aria-live="polite">
        <div className="text-sm text-muted">成品电缆成本（元 / 根）</div>
        <div className="mt-2 text-2xl font-semibold text-ink">{loading ? '计算中…' : result ? money(recipePartSubtotal(result)) : '—'}</div>
        <div className={`mt-2 text-sm ${error ? 'text-rose-700' : 'text-muted'}`}>{error || (result ? partFormulaLine(result) : '请选择线材并填写大于 0 的长度')}</div>
      </div>
      <Button onClick={onClose}>关闭</Button>
    </div>
  </SlideOver>;
}
