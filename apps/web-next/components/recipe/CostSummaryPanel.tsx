'use client';

import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { BomPreview } from './BomPreview';

type CostSummaryPanelProps = {
  bomCount: number;
  loading?: boolean;
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

function CostLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
      <span>{label}</span>
      <span className="font-medium text-slate-900">{money(value)}</span>
    </div>
  );
}

export function CostSummaryPanel({
  bomCount,
  loading,
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

  return (
    <aside className="xl:sticky xl:top-6 xl:self-start">
      <div className="rounded-panel border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-900">实时成本预览</div>
            <div className="mt-1 text-xs text-slate-500">
              {loading ? '正在刷新...' : bomCount > 0 ? `${bomCount} 项 BOM` : '填写配置后自动预览'}
            </div>
          </div>
          <Button type="button" size="sm" onClick={onRefresh} disabled={saving || loading} icon={<Wand2 size={14} />}>
            {loading ? '刷新中' : '刷新'}
          </Button>
        </div>

        <CostSummaryCard total={total} bomCount={bomCount} loading={loading} />

        <div className="mt-4 space-y-2.5">
          <CostLine label="线圈成本" value={coilCost} />
          <CostLine label="模板配件成本" value={templatePartsCost} />
          <CostLine label="选配件成本" value={optionalPartsCost} />
          <CostLine label="包装材料成本" value={packingPartsCost} />
          <CostLine label="人工与管理费" value={laborAndManagementCost} />
          <CostLine label="表面处理费" value={surfaceTreatmentCost} />
        </div>

        {costWarningHints.length > 0 ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-semibold text-amber-800">成本完整性提示</div>
            <div className="mt-2 space-y-1">
              {costWarningHints.map((hint) => (
                <div key={hint} className="text-xs text-amber-700">{hint}</div>
              ))}
            </div>
            {onGoToCostWarnings ? (
              <button
                type="button"
                onClick={onGoToCostWarnings}
                className="mt-3 text-xs font-medium text-amber-800 underline underline-offset-2 transition-colors duration-150 hover:text-amber-900"
              >
                前往配置
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 rounded-md border border-line bg-slate-50 p-3">
          <div className="text-xs font-semibold text-slate-500">配置状态</div>
          <div className={`mt-2 text-xs font-medium ${missingConfigHints.length > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {missingConfigHints.length > 0 ? '⚠ 存在缺失项' : '✓ 已完成配置'}
          </div>
          {missingConfigHints.length > 0 ? (
            <div className="mt-2 space-y-1">
              {missingConfigHints.slice(0, 4).map((hint) => (
                <div key={hint} className="text-xs text-amber-700">{hint}</div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-4 rounded-md border border-line bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-slate-500">配置完成度</div>
            <div className="text-xs font-medium text-slate-900">{clampedPercent}%</div>
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-slate-800" style={{ width: `${clampedPercent}%` }} />
          </div>
          <div className="mt-2 text-xs text-slate-500">{completedCount}/{moduleCount} 个成本模块已完成</div>
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
        </div>

        <BomPreview count={bomCount} disabled={bomCount === 0} onOpen={onOpenBom} />
      </div>
    </aside>
  );
}

function CostSummaryCard({ total, bomCount, loading }: { total: number; bomCount: number; loading?: boolean }) {
  return (
    <div className={`mt-5 rounded-md border border-sky-200 bg-cyan-50/70 p-4 pl-5 shadow-sm ${loading ? 'ring-4 ring-sky-100/70' : ''}`}>
      <div className="relative">
        <div className="absolute -left-3 top-0 h-full w-1 rounded-full bg-sky-500" />
        <div className="text-xs font-medium text-sky-700">总成本</div>
        <div className="mt-1 flex items-end gap-1">
          <span className="text-3xl font-bold tracking-tight text-slate-950">{money(total)}</span>
          <span className="pb-1 text-sm font-medium text-slate-600">/ 台</span>
        </div>
        <div className="mt-2 text-xs text-sky-700">
          {loading ? '正在根据当前 BOM 重新计算' : `根据当前 ${bomCount} 项 BOM 实时计算`}
        </div>
      </div>
    </div>
  );
}
