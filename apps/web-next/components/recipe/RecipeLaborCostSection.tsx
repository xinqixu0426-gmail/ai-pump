'use client';

import { RecipeSection } from '@/components/recipe/RecipeSection';
import { money } from '@/lib/format';
import type { SurfaceTreatmentMode } from '@/lib/recipes';

export type RecipeLaborCostForm = {
  assemblyWage: string;
  packingWage: string;
  managementFee: string;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: string;
};

type RecipeLaborCostSectionProps = {
  form: RecipeLaborCostForm;
  warnings: string[];
  complete: boolean;
  totalCost: number;
  onChange: (patch: Partial<RecipeLaborCostForm>) => void;
};

const surfaceTreatmentOptions: Array<{ value: SurfaceTreatmentMode; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'painting', label: '喷漆' },
  { value: 'electrophoresis', label: '电泳' },
  { value: 'electrophoresis_powder_coating', label: '电泳+喷塑' },
  { value: 'powder_coating', label: '整体喷塑' },
  { value: 'custom', label: '自定义' },
];

const inputClassName = 'mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400';

export function RecipeLaborCostSection({
  form,
  warnings,
  complete,
  totalCost,
  onChange,
}: RecipeLaborCostSectionProps) {
  return (
    <RecipeSection
      id="recipe-labor-section"
      title="5. 人工与费用"
      description="模板会带入默认人工，配方可覆盖。"
      summary={money(totalCost)}
      status={complete ? 'complete' : 'warning'}
      badge={complete ? money(totalCost) : '待完善'}
      badgeTone={complete ? 'green' : 'amber'}
      defaultOpen={false}
      muted
    >
      {warnings.length > 0 ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="font-semibold">以下费用可能漏算</div>
          <div className="mt-1 space-y-1">
            {warnings.map((warning) => <div key={warning}>{warning}</div>)}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-5">
        <label className="block">
          <span className="text-sm font-medium text-ink">安装工资</span>
          <input
            value={form.assemblyWage}
            onChange={(event) => onChange({ assemblyWage: event.target.value })}
            type="number"
            min="0"
            step="0.01"
            className={inputClassName}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">打包工资</span>
          <input
            value={form.packingWage}
            onChange={(event) => onChange({ packingWage: event.target.value })}
            type="number"
            min="0"
            step="0.01"
            className={inputClassName}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">管理费</span>
          <input
            value={form.managementFee}
            onChange={(event) => onChange({ managementFee: event.target.value })}
            type="number"
            min="0"
            step="0.01"
            className={inputClassName}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">表面处理</span>
          <select
            value={form.surfaceTreatmentMode}
            onChange={(event) => onChange({ surfaceTreatmentMode: event.target.value as SurfaceTreatmentMode })}
            className={`${inputClassName} bg-white`}
          >
            {surfaceTreatmentOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">表面处理费用</span>
          <input
            value={form.surfaceTreatmentCost}
            onChange={(event) => onChange({ surfaceTreatmentCost: event.target.value })}
            type="number"
            min="0"
            step="0.01"
            disabled={form.surfaceTreatmentMode === 'none'}
            className={`${inputClassName} disabled:opacity-60`}
          />
        </label>
      </div>
    </RecipeSection>
  );
}
