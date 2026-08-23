'use client';

import { Plus } from 'lucide-react';
import { RecipeDataTable, type RecipeSelectionRow } from '@/components/recipe/RecipeDataTable';
import { RecipeSection } from '@/components/recipe/RecipeSection';
import {
  findDraftSelectionPart,
  partCostLine,
  partFormulaLine,
  recipePartSubtotal,
} from '@/components/recipe/recipe-cost-display';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import type { RecipeBomDraftResult } from '@/lib/recipes';

export type PackingModelOption = {
  key: string;
  model: string;
  label: string;
};

type RecipeOptionalPackingSectionProps = {
  optionalParts: RecipeSelectionRow[];
  packingParts: RecipeSelectionRow[];
  optionalPartsCost: number;
  packingPartsCost: number;
  optionalCostRows: RecipeSelectionRow[];
  packingCostRows: RecipeSelectionRow[];
  complete: boolean;
  partModelOptions: string[];
  packingModelOptions: PackingModelOption[];
  bomDraft: RecipeBomDraftResult | null;
  saving: boolean;
  onAddOptionalPart: () => void;
  onUpdateOptionalPart: (id: string, patch: Partial<RecipeSelectionRow>) => void;
  onRemoveOptionalPart: (id: string) => void;
  onAddPackingPart: () => void;
  onUpdatePackingPart: (id: string, patch: Partial<RecipeSelectionRow>) => void;
  onRemovePackingPart: (id: string) => void;
  isCatalogMissing: (kind: 'optional' | 'packing', row: RecipeSelectionRow) => boolean;
  onCreateCatalogPart: (kind: 'optional' | 'packing', row: RecipeSelectionRow) => void;
};

export function RecipeOptionalPackingSection({
  optionalParts,
  packingParts,
  optionalPartsCost,
  packingPartsCost,
  optionalCostRows,
  packingCostRows,
  complete,
  partModelOptions,
  packingModelOptions,
  bomDraft,
  saving,
  onAddOptionalPart,
  onUpdateOptionalPart,
  onRemoveOptionalPart,
  onAddPackingPart,
  onUpdatePackingPart,
  onRemovePackingPart,
  isCatalogMissing,
  onCreateCatalogPart,
}: RecipeOptionalPackingSectionProps) {
  const totalItems = optionalParts.length + packingParts.length;
  const optionalCostRow = (row: RecipeSelectionRow) => optionalCostRows.find((candidate) => candidate.id === row.id) || row;
  const packingCostRow = (row: RecipeSelectionRow) => packingCostRows.find((candidate) => candidate.id === row.id) || row;
  return (
    <RecipeSection
      id="recipe-optional-packing-section"
      title="4. 包装与其他配件"
      description="额外物料和包装项默认弱化，添加后会参与 BOM 和成本草稿。"
      summary={`${totalItems} 项，${money(optionalPartsCost + packingPartsCost)}`}
      status={complete ? 'complete' : 'warning'}
      badge={complete ? `${totalItems} 项` : '待完善'}
      badgeTone={complete ? 'green' : 'amber'}
      defaultOpen={false}
      muted
    >
      <div className="space-y-5">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">选配件</div>
              <div className="mt-1 text-xs text-slate-500">保存到 extraPartsJson，可添加电容、密封件、螺丝、铭牌等额外物料。</div>
            </div>
            <Button type="button" size="sm" onClick={onAddOptionalPart} disabled={saving} icon={<Plus size={14} />}>
              添加选配件
            </Button>
          </div>
          <RecipeDataTable
            kind="optional"
            rows={optionalParts}
            disabled={saving}
            modelListId="recipe-part-model-options"
            modelOptions={partModelOptions}
            emptyText="暂无选配件，可添加电容、密封件、螺丝、铭牌等额外物料"
            onAdd={onAddOptionalPart}
            onUpdate={onUpdateOptionalPart}
            onRemove={onRemoveOptionalPart}
            getAmount={(part) => recipePartSubtotal(findDraftSelectionPart(bomDraft, optionalCostRow(part)))}
            getCostLine={(part) => partCostLine(findDraftSelectionPart(bomDraft, optionalCostRow(part)))}
            getFormula={(part) => partFormulaLine(findDraftSelectionPart(bomDraft, optionalCostRow(part)))}
            formulaLabel="公式:"
            isCatalogMissing={(row) => isCatalogMissing('optional', row)}
            onCreateCatalogPart={(row) => onCreateCatalogPart('optional', row)}
          />
        </div>

        <div className="border-t border-line pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">包装材料</div>
              <div className="mt-1 text-xs text-slate-500">保存到 packingPartsJson，可添加纸箱、泡沫、说明书、标签等包装项。</div>
            </div>
            <Button type="button" size="sm" onClick={onAddPackingPart} disabled={saving} icon={<Plus size={14} />}>
              添加包装
            </Button>
          </div>
          <RecipeDataTable
            kind="packing"
            rows={packingParts}
            disabled={saving}
            modelListId="recipe-packing-model-options"
            modelOptions={packingModelOptions.map((part) => ({
              value: part.model,
              label: `${part.model} · ${part.label}`,
            }))}
            emptyText="暂无包装材料，可添加纸箱、泡沫、说明书、标签等包装项"
            onAdd={onAddPackingPart}
            onUpdate={onUpdatePackingPart}
            onRemove={onRemovePackingPart}
            getAmount={(part) => recipePartSubtotal(findDraftSelectionPart(bomDraft, packingCostRow(part)))}
            getCostLine={(part) => partCostLine(findDraftSelectionPart(bomDraft, packingCostRow(part)))}
            getFormula={(part) => partFormulaLine(findDraftSelectionPart(bomDraft, packingCostRow(part)))}
            formulaLabel="公式:"
            isCatalogMissing={(row) => isCatalogMissing('packing', row)}
            onCreateCatalogPart={(row) => onCreateCatalogPart('packing', row)}
          />
        </div>
      </div>
    </RecipeSection>
  );
}
