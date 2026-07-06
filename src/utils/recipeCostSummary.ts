import { Part, PartSelection, PumpShellTemplate, RecipePart, TemplatePart, SurfaceTreatmentMode } from '../types';
import { CoilCostSnapshot } from './recipeBomBuilder';

type PriceGetter = (model: string, supplier: string) => number;
type TemplatePartPriceGetter = (part: TemplatePart) => number;

export interface RecipeCostSummaryInput {
  allPartsPreview: RecipePart[];
  templateCost: number;
  selectedTemplate: unknown | null;
  coilResult: CoilCostSnapshot | null;
  optionalParts: Array<PartSelection & { id?: number }>;
  capacitorModel: string;
  configParts: RecipePart[];
  packingParts: Array<PartSelection & { id?: number }>;
  laborCost: number;
  getPriceByModelAndSupplier: PriceGetter;
}

export interface RecipeCostDetailItem {
  label: string;
  amount: number;
  note: string;
  issue: boolean;
}

export interface RecipeCostDetailGroup {
  title: string;
  items: RecipeCostDetailItem[];
}

export interface RecipeCostDetailGroupsInput {
  parts: Part[];
  selectedTemplate: PumpShellTemplate | null;
  selectedTemplateCostMode: 'bundle' | 'components';
  shellPrice: number;
  adjustedTemplateParts: TemplatePart[];
  getTemplatePartPrice: TemplatePartPriceGetter;
  coilResult: CoilCostSnapshot | null;
  coilSpec: string;
  coilSheets: string;
  capacitorModel: string;
  optionalParts: Array<PartSelection & { id?: number }>;
  configParts: RecipePart[];
  packingParts: Array<PartSelection & { id?: number }>;
  assemblyWage: number;
  packingWage: number;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  surfaceTreatmentCost: number;
  managementFee: number;
  getPriceByModelAndSupplier: PriceGetter;
}

export interface RecipeCostSummary {
  templateCost: number;
  showTemplateCost: boolean;
  coilCost: number;
  optionAndCapacitorCost: number;
  configCost: number;
  packingCost: number;
  laborCost: number;
  partsCost: number;
  totalCost: number;
}

function row(label: string, amount: number, note = '', issue = false): RecipeCostDetailItem {
  return { label, amount, note, issue };
}

function getPackingLibraryPrice(parts: Part[], model: string, supplier = '') {
  const normalizedModel = String(model || '').trim();
  const candidates = parts.filter(p => p.category === '包装' && p.model.trim() === normalizedModel);
  const normalizedSupplier = String(supplier || '').trim();
  const exact = candidates.find(p => normalizedSupplier && String(p.supplier || '').trim() === normalizedSupplier);
  if (exact) return exact.price;
  return candidates.length ? candidates.reduce((min, p) => p.price < min.price ? p : min, candidates[0]).price : 0;
}

export function calculateRecipeCostSummary(input: RecipeCostSummaryInput): RecipeCostSummary {
  const partsCost = input.allPartsPreview.reduce((sum, part) => (
    sum + Number(part.snapshotPrice || 0) * Number(part.qty || 1)
  ), 0);
  const optionalCost = input.optionalParts.reduce((sum, part) => (
    part.model
      ? sum + (part.costSource === 'manual' ? Number(part.snapshotPrice || 0) : input.getPriceByModelAndSupplier(part.model, part.supplier)) * Number(part.qty || 1)
      : sum
  ), 0);
  const capacitorCost = input.capacitorModel ? input.getPriceByModelAndSupplier(input.capacitorModel, '') : 0;
  const configCost = input.configParts.reduce((sum, part) => (
    sum + Number(part.snapshotPrice || 0) * Number(part.qty || 1)
  ), 0);
  const packingCost = input.packingParts.reduce((sum, part) => {
    if (!part.model) return sum;
    const price = part.costSource === 'manual'
      ? Number(part.snapshotPrice || 0)
      : input.getPriceByModelAndSupplier(part.model, part.supplier);
    return sum + price * Number(part.qty || 1);
  }, 0);

  return {
    templateCost: input.templateCost,
    showTemplateCost: Boolean(input.selectedTemplate),
    coilCost: input.coilResult?.totalCost || 0,
    optionAndCapacitorCost: optionalCost + capacitorCost,
    configCost,
    packingCost,
    laborCost: input.laborCost,
    partsCost,
    totalCost: partsCost + input.laborCost,
  };
}

export function calculateRecipeCostDetailGroups(input: RecipeCostDetailGroupsInput): RecipeCostDetailGroup[] {
  const groups = [
    {
      title: '模板',
      items: input.selectedTemplate ? [
        row(input.selectedTemplateCostMode === 'bundle' ? '整套泵壳' : '泵壳组件', input.shellPrice, input.selectedTemplate.shellModel || ''),
        ...input.adjustedTemplateParts.map(part => {
          const unitPrice = input.getTemplatePartPrice(part);
          return row(part.name || part.model, unitPrice * Number(part.qty || 1), `${part.model}${part.qty > 1 ? ` ×${part.qty}` : ''}`, unitPrice <= 0);
        }),
      ] : [],
    },
    {
      title: '线圈',
      items: [
        ...(input.coilResult ? [row('线圈转子', input.coilResult.totalCost || 0, `${input.coilSpec || '-'} / ${input.coilSheets || '-'}片`)] : []),
        ...(input.capacitorModel ? [row('电容', input.getPriceByModelAndSupplier(input.capacitorModel, ''), input.capacitorModel, input.getPriceByModelAndSupplier(input.capacitorModel, '') <= 0)] : []),
      ],
    },
    {
      title: '选配',
      items: input.optionalParts
        .filter(part => part.model)
        .map(part => {
          const unitPrice = part.costSource === 'manual' ? Number(part.snapshotPrice || 0) : input.getPriceByModelAndSupplier(part.model, part.supplier);
          return row(part.model, unitPrice * Number(part.qty || 1), `${part.supplier || '默认'}${Number(part.qty || 1) > 1 ? ` ×${part.qty}` : ''}`, unitPrice <= 0);
        }),
    },
    {
      title: '动态',
      items: input.configParts
        .filter(part => !part.packagingMaterial)
        .map(part => row(part.name || part.model, Number(part.snapshotPrice || 0) * Number(part.qty || 1), `${part.model}${Number(part.qty || 1) > 1 ? ` ×${part.qty}` : ''}`, Number(part.snapshotPrice || 0) <= 0)),
    },
    {
      title: '包装',
      items: input.packingParts
        .filter(part => part.model)
        .map(part => {
          const unitPrice = part.costSource === 'manual' ? Number(part.snapshotPrice || 0) : getPackingLibraryPrice(input.parts, part.model, part.supplier);
          const qty = Number(part.qty || 1);
          return row(part.model, unitPrice * qty, `${part.packagingMaterial || '包材'} / ${part.supplier || '默认'}${qty > 1 ? ` ×${qty}` : ''}`, unitPrice <= 0);
        }),
    },
    {
      title: '人工',
      items: [
        row('安装工资', Number(input.assemblyWage || 0)),
        row('打包工资', Number(input.packingWage || 0)),
        row(input.surfaceTreatmentMode === 'painting' ? '喷漆' : input.surfaceTreatmentMode === 'electrophoresis' ? '电泳' : '表面处理', Number(input.surfaceTreatmentCost || 0)),
        row('管理费', Number(input.managementFee || 0)),
      ].filter(item => item.amount > 0),
    },
  ];
  return groups.filter(group => group.items.length > 0);
}

export function countRecipeCostIssues(groups: RecipeCostDetailGroup[]): number {
  return groups.reduce((sum, group) => sum + group.items.filter(item => item.issue).length, 0);
}
