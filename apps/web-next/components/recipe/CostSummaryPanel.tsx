'use client';

import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { BomPreview } from './BomPreview';

type CostSummaryPanelProps = {
  bomCount: number;
  loading?: boolean;
  ready: boolean;
  saving?: boolean;
  total: number;
  coilCost: number;
  templatePartsCost: number;
  optionalPartsCost: number;
  packingPartsCost: number;
  laborAndManagementCost: number;
  surfaceTreatmentCost: number;
  missingConfigHints: string[];
  costWarningHints?: string[];
  completedItems: string[];
  pendingItems: string[];
  completionPercent: number;
  onRefresh: () => void;
  onOpenBom: () => void;
  onGoToCostWarnings?: () => void;
};

function CostLine({ label, value, ready }: { label: string; value: number; ready: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
      <span>{label}</span>
      <span className="font-medium text-slate-900">{ready ? money(value) : '—'}</span>
    </div>
  );
}

export function CostSummaryPanel({
  bomCount,
  loading,
  ready,
  saving,
  total,
  coilCost,
  templatePartsCost,
  optionalPartsCost,
  packingPartsCost,
  laborAndManagementCost,
  surfaceTreatmentCost,
  missingConfigHints,
  costWarningHints = [],
  completedItems,
  pendingItems,
  completionPercent,
  onRefresh,
  onOpenBom,
  onGoToCostWarnings,
}: CostSummaryPanelProps) {
  const clampedPercent = Math.max(0, Math.min(100, completionPercent));
  const completedCount = completedItems.length;
  const moduleCount = completedItems.length + pendingItems.length;
  const pendingHints = Array.from(new Set([...missingConfigHints, ...costWarningHints]));

  return (
    <aside className="xl:sticky xl:top-6 xl:self-start">
      <div className="rounded-panel border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-900">实时成本预览</div>
            <div className="mt-1 text-xs text-slate-500">
              {loading ? '正在计算当前成本...' : ready && bomCount > 0 ? `${bomCount} 项 BOM` : '填写配置后自动预览'}
            </div>
          </div>
          <Button type="button" size="sm" onClick={onRefresh} disabled={saving || loading} icon={<Wand2 size={14} />}>
            {loading ? '刷新中' : '刷新'}
          </Button>
        </div>

        <CostSummaryCard total={total} bomCount={bomCount} loading={loading} ready={ready} />

        <div className="mt-4 space-y-2.5">
          <CostLine label="线圈成本" value={coilCost} ready={ready && !loading} />
          <CostLine label="模板配件成本" value={templatePartsCost} ready={ready && !loading} />
          <CostLine label="选配件成本" value={optionalPartsCost} ready={ready && !loading} />
          <CostLine label="包装材料成本" value={packingPartsCost} ready={ready && !loading} />
          <CostLine label="人工与管理费" value={laborAndManagementCost} ready={ready && !loading} />
          <CostLine label="表面处理费" value={surfaceTreatmentCost} ready={ready && !loading} />
        </div>

        <div className={`mt-4 rounded-md border p-3 ${pendingHints.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50/70'}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className={`text-xs font-semibold ${pendingHints.length > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                {pendingHints.length > 0 ? `待完善 ${pendingHints.length} 项` : '配置已完整'}
              </div>
              <div className={`mt-1 text-xs ${pendingHints.length > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {completedCount}/{moduleCount} 个成本模块已完成
              </div>
            </div>
            <div className={`text-sm font-semibold ${pendingHints.length > 0 ? 'text-amber-900' : 'text-emerald-900'}`}>{clampedPercent}%</div>
          </div>
          <div className={`mt-3 h-2 rounded-full ${pendingHints.length > 0 ? 'bg-amber-100' : 'bg-emerald-100'}`}>
            <div className={`h-2 rounded-full ${pendingHints.length > 0 ? 'bg-amber-500' : 'bg-emerald-600'}`} style={{ width: `${clampedPercent}%` }} />
          </div>

          {pendingHints.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {pendingHints.slice(0, 3).map((hint) => (
                <div key={hint} className="text-xs leading-5 text-amber-800">· {hint}</div>
              ))}
              {pendingHints.length > 3 ? (
                <details className="group">
                  <summary className="cursor-pointer list-none text-xs font-medium text-amber-800 underline underline-offset-2">
                    查看其余 {pendingHints.length - 3} 项
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {pendingHints.slice(3).map((hint) => (
                      <div key={hint} className="text-xs leading-5 text-amber-800">· {hint}</div>
                    ))}
                  </div>
                </details>
              ) : null}
              {costWarningHints.length > 0 && onGoToCostWarnings ? (
                <button
                  type="button"
                  onClick={onGoToCostWarnings}
                  className="pt-1 text-xs font-semibold text-amber-900 underline underline-offset-2 transition-colors duration-150 hover:text-amber-950"
                >
                  前往配置
                </button>
              ) : null}
            </div>
          ) : null}

          <details className="group mt-3 border-t border-current/10 pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-slate-600">
              <span>查看模块状态</span>
              <span className="group-open:hidden">展开</span>
              <span className="hidden group-open:inline">收起</span>
            </summary>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-1">
                {completedItems.map((item) => (
                  <div key={item} className="text-emerald-700">✓ {item}</div>
                ))}
              </div>
              <div className="space-y-1">
                {pendingItems.map((item) => (
                  <div key={item} className="text-slate-500">○ {item}</div>
                ))}
              </div>
            </div>
          </details>
        </div>

        <BomPreview count={bomCount} disabled={bomCount === 0} onOpen={onOpenBom} />
      </div>
    </aside>
  );
}

function CostSummaryCard({ total, bomCount, loading, ready }: { total: number; bomCount: number; loading?: boolean; ready: boolean }) {
  return (
    <div className={`mt-5 rounded-md border border-sky-200 bg-cyan-50/70 p-4 pl-5 shadow-sm ${loading ? 'ring-4 ring-sky-100/70' : ''}`}>
      <div className="relative">
        <div className="absolute -left-3 top-0 h-full w-1 rounded-full bg-sky-500" />
        <div className="text-xs font-medium text-sky-700">总成本</div>
        <div className="mt-1 flex items-end gap-1">
          <span className="text-3xl font-bold tracking-tight text-slate-950">
            {loading ? '正在计算' : ready ? money(total) : '—'}
          </span>
          {ready && !loading ? <span className="pb-1 text-sm font-medium text-slate-600">/ 台</span> : null}
        </div>
        <div className="mt-2 text-xs text-sky-700">
          {loading
            ? '正在根据当前模板和配方参数生成 BOM'
            : ready
              ? `根据当前 ${bomCount} 项 BOM 实时计算`
              : '完成必要配置后生成当前成本'}
        </div>
      </div>
    </div>
  );
}
