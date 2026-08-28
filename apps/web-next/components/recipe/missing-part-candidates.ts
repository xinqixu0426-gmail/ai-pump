import type { TemplateFormState } from '@/components/recipe/PumpShellTemplateEditor';
import type { RecipeSelectionRow } from '@/components/recipe/RecipeDataTable';
import { SHELL_COMPONENT_CATEGORY } from '@/components/recipe/ShellCostEditor';
import type { Part } from '@/lib/parts';
import { templatePartCategoryForName } from '@/lib/template-part-category';

export type MissingPartTargetKind =
  | 'template-shell'
  | 'template-component'
  | 'template-fixed'
  | 'recipe-optional'
  | 'recipe-packing';

export type MissingPartCandidate = {
  key: string;
  targetKind: MissingPartTargetKind;
  rowId?: string;
  contextLabel: string;
  model: string;
  supplier: string;
  category: string;
  subcategory: string;
  catalogUnitCost: number;
  stock: number;
  matchScope: 'exact-category' | 'non-packaging';
};

function candidateKey(targetKind: MissingPartTargetKind, rowId: string | undefined, model: string) {
  return `${targetKind}:${rowId || 'root'}:${model}`;
}

export function packagingSubcategoryForDraft(row: RecipeSelectionRow): string {
  const text = `${row.model} ${row.packagingMaterial}`;
  if (text.includes('泡沫') || text.includes('珍珠棉') || text.includes('内衬')) return '内衬';
  if (text.includes('箱') || text.includes('外包装')) return '外包装';
  return '固定包材';
}

export function candidateMatchesPart(candidate: MissingPartCandidate, part: Part): boolean {
  if (part.model.trim().toLocaleLowerCase() !== candidate.model.trim().toLocaleLowerCase()) return false;
  if (candidate.supplier.trim()
    && part.supplier.trim().toLocaleLowerCase() !== candidate.supplier.trim().toLocaleLowerCase()) {
    return false;
  }
  if (candidate.matchScope === 'non-packaging') {
    return part.category !== '包装' && part.category !== '线圈转子';
  }
  return part.category === candidate.category
    && (candidate.category !== '包装' || part.subcategory === candidate.subcategory);
}

function isMissing(candidate: MissingPartCandidate, parts: Part[]): boolean {
  return !parts.some((part) => candidateMatchesPart(candidate, part));
}

export function collectTemplateMissingPartCandidates(
  form: TemplateFormState,
  parts: Part[]
): MissingPartCandidate[] {
  const candidates: MissingPartCandidate[] = [];
  const shellModel = form.shellModel.trim();
  if (form.costMode === 'bundle' && shellModel) {
    candidates.push({
      key: candidateKey('template-shell', undefined, shellModel),
      targetKind: 'template-shell',
      contextLabel: '整套泵壳',
      model: shellModel,
      supplier: '',
      category: '泵壳',
      subcategory: '',
      catalogUnitCost: Number(form.bundleCost || 0),
      stock: 0,
      matchScope: 'exact-category',
    });
  }

  if (form.costMode === 'components') {
    form.componentRows
      .filter((row) => row.included !== false && row.model?.trim())
      .forEach((row) => {
        const model = row.model?.trim() || '';
        candidates.push({
          key: candidateKey('template-component', row.id, model),
          targetKind: 'template-component',
          rowId: row.id,
          contextLabel: `自由搭配 · ${row.name || '未命名组件'}`,
          model,
          supplier: row.supplier?.trim() || '',
          category: SHELL_COMPONENT_CATEGORY,
          subcategory: '',
          catalogUnitCost: Number(row.unitCost || 0),
          stock: 0,
          matchScope: 'exact-category',
        });
      });
  }

  form.partRows
    .filter((row) => row.model.trim())
    .forEach((row) => {
      const inferredCategory = templatePartCategoryForName(row.name);
      if (inferredCategory === '线圈转子') return;
      candidates.push({
        key: candidateKey('template-fixed', row.id, row.model.trim()),
        targetKind: 'template-fixed',
        rowId: row.id,
        contextLabel: `固定配件 · ${row.name || '未命名配件'}`,
        model: row.model.trim(),
        supplier: row.supplier?.trim() || '',
        category: inferredCategory || '配件',
        subcategory: '',
        catalogUnitCost: 0,
        stock: 0,
        matchScope: inferredCategory ? 'exact-category' : 'non-packaging',
      });
    });

  return candidates.filter((candidate) => isMissing(candidate, parts));
}

export function collectRecipeMissingPartCandidates(
  optionalParts: RecipeSelectionRow[],
  packingParts: RecipeSelectionRow[],
  parts: Part[]
): MissingPartCandidate[] {
  const optional = optionalParts
    .filter((row) => row.model.trim())
    .map((row): MissingPartCandidate | null => {
      const inferredCategory = templatePartCategoryForName(row.model);
      if (inferredCategory === '线圈转子') return null;
      return {
        key: candidateKey('recipe-optional', row.id, row.model.trim()),
        targetKind: 'recipe-optional',
        rowId: row.id,
        contextLabel: '配方选配件',
        model: row.model.trim(),
        supplier: row.supplier.trim(),
        category: inferredCategory || '配件',
        subcategory: '',
        catalogUnitCost: row.costSource === 'manual' ? Number(row.snapshotPrice || 0) : 0,
        stock: 0,
        matchScope: inferredCategory ? 'exact-category' : 'non-packaging',
      };
    })
    .filter((candidate): candidate is MissingPartCandidate => Boolean(candidate));

  const packing = packingParts
    .filter((row) => row.model.trim())
    .map((row): MissingPartCandidate => ({
      key: candidateKey('recipe-packing', row.id, row.model.trim()),
      targetKind: 'recipe-packing',
      rowId: row.id,
      contextLabel: '配方包装材料',
      model: row.model.trim(),
      supplier: row.supplier.trim(),
      category: '包装',
      subcategory: packagingSubcategoryForDraft(row),
      catalogUnitCost: row.costSource === 'manual' ? Number(row.snapshotPrice || 0) : 0,
      stock: 0,
      matchScope: 'exact-category',
    }));

  return [...optional, ...packing].filter((candidate) => isMissing(candidate, parts));
}
