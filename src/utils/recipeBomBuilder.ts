import { CableAccessoryType, PartSelection, PumpShellTemplate, RecipePart, ShellComponent, TemplatePart } from '../types';
import { DEFAULT_COIL_MATERIAL, inferPackingMaterial, wireModel } from './businessRules';

type PriceGetter = (model: string, supplier: string) => number;
type CableAccessoryFeeGetter = (model: string, supplier: string, accessoryType: CableAccessoryType) => number;
type CableAccessoryNameGetter = (model: string, supplier: string, accessoryType: CableAccessoryType) => string;

export interface CoilCostSnapshot {
  totalCost: number;
  material?: string;
  unitPrice?: number;
  source?: string;
  formula?: string;
}

export function lengthCmQty(component: ShellComponent, customBarrelLength?: string | number | null): number {
  if (component.pricingMode !== 'lengthCm') return Number(component.qty || 1);
  return Number(customBarrelLength || Number(component.qty || 0) * 10) / 10;
}

export function calculateShellPrice(input: {
  selectedTemplate: PumpShellTemplate | null;
  costMode: 'bundle' | 'components';
  shellComponents: ShellComponent[];
  customBarrelLength?: string | number | null;
}): number {
  const { selectedTemplate, costMode, shellComponents, customBarrelLength } = input;
  if (!selectedTemplate) return 0;
  if (costMode === 'bundle') return Number(selectedTemplate.bundleCost || 0);
  return shellComponents.reduce((sum, component) => {
    if (component.included === false) return sum;
    return sum + Number(component.unitCost || 0) * lengthCmQty(component, customBarrelLength);
  }, 0);
}

export function buildConfigParts(input: {
  hasFloat: boolean;
  floatWire: string;
  floatAccessoryType: CableAccessoryType;
  floatAccessoryDelta: number;
  hasCable: boolean;
  cableLength: string | number;
  cableWire: string;
  cableAccessoryType: CableAccessoryType;
  packingParts: Array<PartSelection & { id?: number }>;
  getPriceByModelAndSupplier: PriceGetter;
  getCableAccessoryFee: CableAccessoryFeeGetter;
  getCableAccessoryName: CableAccessoryNameGetter;
}): RecipePart[] {
  const {
    hasFloat,
    floatWire,
    floatAccessoryType,
    floatAccessoryDelta,
    hasCable,
    cableLength,
    cableWire,
    cableAccessoryType,
    packingParts,
    getPriceByModelAndSupplier,
    getCableAccessoryFee,
    getCableAccessoryName,
  } = input;

  const configParts: RecipePart[] = [];
  if (hasFloat) {
    const model = wireModel('浮球', floatWire);
    const basePrice = getPriceByModelAndSupplier(model, '');
    const accessoryDelta = floatAccessoryType === 'xinjie' ? floatAccessoryDelta : 0;
    configParts.push({
      model,
      name: floatAccessoryType === 'xinjie' ? '浮球-新界式' : '浮球',
      supplier: '',
      qty: 1,
      snapshotPrice: basePrice + accessoryDelta,
      floatAccessoryType,
      floatAccessoryDelta: accessoryDelta,
    });
  }

  if (hasCable && cableLength && Number(cableLength) > 0) {
    const cableModel = wireModel('电缆', cableWire);
    configParts.push({
      model: cableModel,
      name: '电缆线',
      supplier: '',
      qty: Number(cableLength),
      snapshotPrice: getPriceByModelAndSupplier(cableModel, ''),
    });
    configParts.push({
      model: '电缆配件费',
      name: getCableAccessoryName(cableModel, '', cableAccessoryType),
      supplier: '',
      qty: 1,
      snapshotPrice: getCableAccessoryFee(cableModel, '', cableAccessoryType),
      cableAccessoryType,
    });
  }

  packingParts.forEach(part => {
    if (!part.model) return;
    const isManual = part.costSource === 'manual';
    const price = isManual ? Number(part.snapshotPrice || 0) : getPriceByModelAndSupplier(part.model, part.supplier);
    const packagingMaterial = inferPackingMaterial(part.model, part.packagingMaterial);
    configParts.push({
      model: part.model,
      name: `${part.model}（${packagingMaterial}）`,
      supplier: part.supplier,
      qty: 1,
      snapshotPrice: price,
      packagingMaterial,
      ...(isManual ? { costSource: 'manual', source: 'manual' } : {}),
    });
  });

  return configParts;
}

export function buildRecipeBomParts(input: {
  selectedTemplate: PumpShellTemplate | null;
  selectedTemplateCostMode: 'bundle' | 'components';
  shellPrice: number;
  shellComponents: ShellComponent[];
  customBarrelLength?: string | number | null;
  templateParts: TemplatePart[];
  capacitorModel: string;
  optionalParts: Array<PartSelection & { id?: number }>;
  coilResult: CoilCostSnapshot | null;
  coilSpec: string;
  coilMaterial: string;
  coilSheets: string;
  configParts: RecipePart[];
  getTemplatePartPrice: (part: TemplatePart) => number;
  getPriceByModelAndSupplier: PriceGetter;
}): RecipePart[] {
  const {
    selectedTemplate,
    selectedTemplateCostMode,
    shellPrice,
    shellComponents,
    customBarrelLength,
    templateParts,
    capacitorModel,
    optionalParts,
    coilResult,
    coilSpec,
    coilMaterial,
    coilSheets,
    configParts,
    getTemplatePartPrice,
    getPriceByModelAndSupplier,
  } = input;

  const all: RecipePart[] = [];
  if (selectedTemplate) {
    if (selectedTemplateCostMode === 'bundle') {
      all.push({
        model: selectedTemplate.shellModel,
        name: '泵壳整套',
        supplier: '',
        qty: 1,
        snapshotPrice: shellPrice,
        source: 'pump_shell_template',
        costSource: 'manual',
      });
    } else {
      shellComponents.forEach(component => {
        if (component.included === false) return;
        all.push({
          model: component.model || component.name,
          name: component.pricingMode === 'lengthCm' ? `${component.name}(按cm)` : component.name,
          supplier: '',
          qty: lengthCmQty(component, customBarrelLength),
          snapshotPrice: Number(component.unitCost || 0),
          source: 'pump_shell_template',
          costSource: 'manual',
        });
      });
    }
  }

  templateParts.forEach(part => {
    const supplier = part.supplier || '';
    all.push({
      model: part.model,
      name: part.name,
      supplier,
      qty: part.qty,
      snapshotPrice: getTemplatePartPrice(part),
    });
  });

  if (capacitorModel) {
    all.push({
      model: capacitorModel,
      name: '电容',
      supplier: '',
      qty: 1,
      snapshotPrice: getPriceByModelAndSupplier(capacitorModel, ''),
    });
  }

  if (coilResult && coilSpec && coilSheets) {
    all.push({
      model: `${coilSpec}-${coilSheets}`,
      name: '线圈转子',
      supplier: '',
      qty: 1,
      snapshotPrice: coilResult.totalCost,
      material: coilResult.material || coilMaterial || DEFAULT_COIL_MATERIAL,
      unitPrice: coilResult.unitPrice,
      source: coilResult.source,
      formula: coilResult.formula,
    });
  }

  optionalParts.forEach(part => {
    if (!part.model) return;
    all.push({
      model: part.model,
      name: part.model,
      supplier: part.supplier,
      qty: part.qty,
      snapshotPrice: getPriceByModelAndSupplier(part.model, part.supplier),
    });
  });

  all.push(...configParts);
  return all;
}
