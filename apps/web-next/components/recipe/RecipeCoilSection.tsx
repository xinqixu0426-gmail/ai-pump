'use client';

import { ChevronDown } from 'lucide-react';
import { EditableNumberSelect } from '@/components/recipe/EditableValueSelect';
import { RecipeSection as WorkspaceSection, RecipeStatusBadge } from '@/components/recipe/RecipeSection';
import { money } from '@/lib/format';
import type { CoilSpecOption, RecipeBomDraftResult } from '@/lib/recipes';

export type RecipeCoilSlotType = '小眼' | '国标眼';

type RecipeCoilFields = {
  coilSpec: string;
  coilSheets: string;
  coilMaterial: string;
  coilSlotType: RecipeCoilSlotType;
  coilWireWeight: string;
};

type RecipeCoilSectionProps = {
  form: RecipeCoilFields;
  coilSpecs: CoilSpecOption[];
  sheetOptions: string[];
  materialOptions: string[];
  slotTypeOptions: string[];
  coilSnapshot: RecipeBomDraftResult['coilSnapshot'];
  capacitorModel: string;
  onSpecChange: (value: string) => void;
  onSheetsChange: (value: string) => void;
  onMaterialChange: (value: string) => void;
  onSlotTypeChange: (value: RecipeCoilSlotType) => void;
  onWireWeightChange: (value: string) => void;
};

export function RecipeCoilSection({
  form,
  coilSpecs,
  sheetOptions,
  materialOptions,
  slotTypeOptions,
  coilSnapshot,
  capacitorModel,
  onSpecChange,
  onSheetsChange,
  onMaterialChange,
  onSlotTypeChange,
  onWireWeightChange,
}: RecipeCoilSectionProps) {
  return (
    <WorkspaceSection
      title="2. 线圈转子"
      description="选择线圈规格和片数后，系统自动读取对应线重并计算成本。"
      summary={form.coilSpec ? `${form.coilSpec} / ${form.coilSheets || '待选片数'} / ${form.coilMaterial || '-'} / ${form.coilSlotType || '小眼'}` : '待选择线圈规格'}
      status={coilSnapshot ? 'complete' : 'warning'}
      badge="自动计算"
      badgeTone="blue"
      defaultOpen={false}
    >
      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="text-xs font-medium text-muted">线圈规格</span>
          <select
            value={form.coilSpec}
            onChange={(event) => onSpecChange(event.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
          >
            <option value="">选择规格</option>
            {coilSpecs.map((spec) => <option key={spec.spec} value={spec.spec}>{spec.spec}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">片数</span>
          <EditableNumberSelect
            value={form.coilSheets}
            options={sheetOptions}
            onChange={onSheetsChange}
            ariaLabel="片数"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">材质</span>
          <select
            value={form.coilMaterial}
            onChange={(event) => onMaterialChange(event.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
          >
            {materialOptions.map((material) => <option key={material} value={material}>{material}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted">槽眼</span>
          <select
            value={form.coilSlotType}
            onChange={(event) => onSlotTypeChange(event.target.value as RecipeCoilSlotType)}
            className="mt-1 h-8 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
          >
            {slotTypeOptions.map((slotType) => <option key={slotType} value={slotType}>{slotType}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 items-stretch gap-2 sm:grid-cols-[8.5rem_minmax(0,1fr)_7rem]">
        <label className="block min-w-0">
          <span className="text-xs font-medium text-muted">线重 kg</span>
          <input
            value={form.coilWireWeight}
            onChange={(event) => onWireWeightChange(event.target.value)}
            type="number"
            min="0"
            step="0.001"
            placeholder="系统默认 / 客户指定"
            className="mt-1 h-8 w-full rounded-md border border-line px-2 text-sm tabular-nums text-ink outline-none transition-colors duration-150 focus:border-slate-400"
          />
        </label>

        <div className="order-3 col-span-2 flex min-w-0 items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50/80 px-3 py-2 sm:order-2 sm:col-span-1">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500">线圈成本</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
              {coilSnapshot ? money(coilSnapshot.totalCost || 0) : '-'}
            </div>
          </div>
          <RecipeStatusBadge tone="blue">自动计算</RecipeStatusBadge>
        </div>

        <div className="order-2 min-w-0 rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 sm:order-3">
          <div className="truncate text-xs font-medium text-slate-500" title="自动关联电容">自动电容</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-slate-900" title={capacitorModel || '-'}>
            {capacitorModel || '-'}
          </div>
        </div>
      </div>

      <details className="group mt-2 rounded-md border border-line bg-slate-50/70">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 py-1.5 marker:content-none">
          <span className="shrink-0 text-xs font-medium text-slate-600">计算明细</span>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {coilSnapshot
              ? `${coilSnapshot.source || '自动匹配'}${coilSnapshot.wireWeight ? ` · ${coilSnapshot.wireWeight}kg` : ''}`
              : '填写规格和片数后自动计算'}
          </span>
          <ChevronDown size={14} className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180" />
        </summary>
        <div className="border-t border-line px-3 py-2 font-mono text-xs leading-5 text-slate-600">
          {coilSnapshot?.formula || '-'}
        </div>
      </details>
    </WorkspaceSection>
  );
}
