'use client';

import { RecipeSection } from '@/components/recipe/RecipeSection';
import { Field, Input, Select } from '@/components/ui/field';
import { InlineNotice } from '@/components/ui/notice';
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
        <InlineNotice tone="warning" title="以下费用可能漏算" className="mb-3">
          <div className="space-y-1 text-xs">
            {warnings.map((warning) => <div key={warning}>{warning}</div>)}
          </div>
        </InlineNotice>
      ) : null}

      <div className="grid gap-3 md:grid-cols-5">
        <Field label="安装工资">
          <Input
            value={form.assemblyWage}
            onChange={(event) => onChange({ assemblyWage: event.target.value })}
            type="number"
            min="0"
            step="0.01"
          />
        </Field>
        <Field label="打包工资">
          <Input
            value={form.packingWage}
            onChange={(event) => onChange({ packingWage: event.target.value })}
            type="number"
            min="0"
            step="0.01"
          />
        </Field>
        <Field label="管理费">
          <Input
            value={form.managementFee}
            onChange={(event) => onChange({ managementFee: event.target.value })}
            type="number"
            min="0"
            step="0.01"
          />
        </Field>
        <Field label="表面处理">
          <Select
            value={form.surfaceTreatmentMode}
            onChange={(event) => onChange({ surfaceTreatmentMode: event.target.value as SurfaceTreatmentMode })}
          >
            {surfaceTreatmentOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="表面处理费用">
          <Input
            value={form.surfaceTreatmentCost}
            onChange={(event) => onChange({ surfaceTreatmentCost: event.target.value })}
            type="number"
            min="0"
            step="0.01"
            disabled={form.surfaceTreatmentMode === 'none'}
          />
        </Field>
      </div>
    </RecipeSection>
  );
}
