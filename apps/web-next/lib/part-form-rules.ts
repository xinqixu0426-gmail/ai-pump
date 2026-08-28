import type { Part } from './parts';

export const BUILTIN_CATEGORIES = ['轴承', '油封', '螺丝', '泵壳', '泵壳搭配', '线圈转子', '电容', '电缆线', '浮球', '皮垫', '配件', '包装'];
export const PACKAGING_SUBCATEGORIES = ['外包装', '内衬', '固定包材'] as const;

export const DEFAULT_FLOAT_ACCESSORY_DELTA = 0.6;
export const DEFAULT_STANDARD_CABLE_ACCESSORY_NAME = '普通铜套';
export const DEFAULT_XINJIE_CABLE_ACCESSORY_NAME = '新界式';

export const WIRE_MODE_CONFIG: Record<string, string> = {
  浮球: '浮球-线径',
  电缆线: '电缆-线径',
};

export type ScrewPricingMeta = {
  enabled: boolean;
  diameter: number;
  modelPrefix?: string;
};

export type PumpShellMeta = {
  isStainless?: boolean;
  openOffset?: number;
  defaultUpperBearing?: string;
  defaultLowerBearing?: string;
  defaultOilSealDia?: number;
  defaultBearingSpan?: number;
  defaultImpellerDia?: number;
  defaultImpellerSpan?: number;
  defaultImpellerDepth?: number;
  defaultThreadLength?: number;
  defaultThreadDia?: number;
  defaultStackOffset?: number;
};

export type CableAccessoryMetaForm = {
  standardFee: string;
  xinjieFee: string;
  standardName: string;
  xinjieName: string;
};

export type PartFormValidationInput = {
  category: string;
  model: string;
  catalogUnitCost: string;
  supplier: string;
  isCapacitorMode: boolean;
  capacitorUf: string;
  isWireMode: boolean;
  wireGauge: string;
  isCableMode: boolean;
  standardCableAccessoryFee: string;
  xinjieCableAccessoryFee: string;
  standardCableAccessoryName: string;
  xinjieCableAccessoryName: string;
  isFloatMode: boolean;
  floatAccessoryDelta: string;
  isScrewMode: boolean;
  screwPricingEnabled: boolean;
  screwDiameter: string;
};

export type PartRemarkInput = {
  category: string;
  isCableMode: boolean;
  isScrewMode: boolean;
  isStainless: boolean;
  openOffset: string;
  defaultUpperBearing: string;
  defaultLowerBearing: string;
  defaultOilSealDia: string;
  defaultBearingSpan: string;
  defaultImpellerDia: string;
  defaultImpellerSpan: string;
  defaultImpellerDepth: string;
  defaultThreadLength: string;
  defaultThreadDia: string;
  defaultStackOffset: string;
  standardCableAccessoryFee: string;
  xinjieCableAccessoryFee: string;
  standardCableAccessoryName: string;
  xinjieCableAccessoryName: string;
  screwPricingEnabled: boolean;
  screwDiameter: string;
};

function parseJsonObject(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nonNegativeString(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? String(numeric) : '';
}

function optionalNumber(value: string): number | undefined {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function zeroNumber(value: string): number {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function capacitorValueFromModel(model: string): number | null {
  const normalized = String(model || '').replace(/[uUμfFvV\s]/g, '').trim();
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

export function wireOptionsFromParts(parts: Part[], prefix: string): string[] {
  const wires = new Set<string>();
  parts.forEach((part) => {
    const model = part.model || '';
    if (!model.startsWith(prefix)) return;
    const wire = model.replace(prefix, '');
    if (wire) wires.add(wire);
  });
  return Array.from(wires).sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b));
}

export function parsePumpShellMeta(remark?: string): PumpShellMeta {
  const meta = parseJsonObject(remark);
  return {
    isStainless: Boolean(meta.isStainless),
    openOffset: optionalNumber(String(meta.openOffset ?? '')),
    defaultUpperBearing: text(meta.defaultUpperBearing),
    defaultLowerBearing: text(meta.defaultLowerBearing),
    defaultOilSealDia: optionalNumber(String(meta.defaultOilSealDia ?? '')),
    defaultBearingSpan: optionalNumber(String(meta.defaultBearingSpan ?? '')),
    defaultImpellerDia: optionalNumber(String(meta.defaultImpellerDia ?? '')),
    defaultImpellerSpan: optionalNumber(String(meta.defaultImpellerSpan ?? '')),
    defaultImpellerDepth: optionalNumber(String(meta.defaultImpellerDepth ?? '')),
    defaultThreadLength: optionalNumber(String(meta.defaultThreadLength ?? '')),
    defaultThreadDia: optionalNumber(String(meta.defaultThreadDia ?? '')),
    defaultStackOffset: optionalNumber(String(meta.defaultStackOffset ?? '')),
  };
}

export function parseCableAccessoryMeta(remark?: string): CableAccessoryMetaForm {
  const meta = parseJsonObject(remark);
  const fees = readRecord(meta.cableAccessoryFees);
  const names = readRecord(meta.cableAccessoryNames);
  const standardFee = nonNegativeString(fees.standard);
  const legacyFee = nonNegativeString(meta.cableAccessoryFee);
  const xinjieFee = nonNegativeString(fees.xinjie);
  const standardName = text(names.standard).trim() || DEFAULT_STANDARD_CABLE_ACCESSORY_NAME;
  const xinjieName = text(names.xinjie).trim() || DEFAULT_XINJIE_CABLE_ACCESSORY_NAME;

  return {
    standardFee: standardFee || legacyFee,
    xinjieFee,
    standardName,
    xinjieName,
  };
}

export function parseScrewPricingMetaFromRemark(remark?: string): ScrewPricingMeta | null {
  const pricing = readRecord(parseJsonObject(remark).screwPricing);
  if (!pricing.enabled) return null;
  const diameter = Number(pricing.diameter);
  if (!Number.isFinite(diameter) || diameter <= 0) return null;
  return {
    enabled: true,
    diameter,
    modelPrefix: text(pricing.modelPrefix) || undefined,
  };
}

export function wirePrefixForCategory(category: string): string {
  return WIRE_MODE_CONFIG[category] || '';
}

export function isCapacitorCategory(category: string): boolean {
  return category === '电容';
}

export function modelFieldsFromPart(part: Part): { model: string; wireGauge: string; capacitorUf: string } {
  const wirePrefix = wirePrefixForCategory(part.category);
  if (wirePrefix && part.model.startsWith(wirePrefix)) {
    return { model: part.model, wireGauge: part.model.replace(wirePrefix, ''), capacitorUf: '' };
  }
  if (isCapacitorCategory(part.category)) {
    return { model: part.model, wireGauge: '', capacitorUf: String(capacitorValueFromModel(part.model) ?? '') };
  }
  return { model: part.model, wireGauge: '', capacitorUf: '' };
}

export function finalPartModel(input: {
  isCapacitorMode: boolean;
  capacitorUf: string;
  isWireMode: boolean;
  wirePrefix: string;
  wireGauge: string;
  model: string;
}): string {
  if (input.isCapacitorMode) return `${input.capacitorUf.trim()}μF`;
  if (input.isWireMode) return `${input.wirePrefix}${input.wireGauge.trim()}`;
  return input.model.trim();
}

export function validatePartForm(input: PartFormValidationInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.isCapacitorMode) {
    if (!input.capacitorUf.trim() || Number.isNaN(Number(input.capacitorUf)) || Number(input.capacitorUf) <= 0) errors.model = '请输入有效的电容值 (μF)';
  } else if (input.isWireMode) {
    if (!input.wireGauge.trim()) errors.model = '请选择线径';
  } else if (!input.model.trim()) {
    errors.model = '型号不能为空';
  }
  if (!input.category.trim()) errors.category = '请选择类别';
  if (!input.catalogUnitCost || Number.isNaN(Number(input.catalogUnitCost)) || Number(input.catalogUnitCost) < 0) errors.catalogUnitCost = '请输入有效的目录成本价';
  if (input.isCableMode && input.standardCableAccessoryFee && (Number.isNaN(Number(input.standardCableAccessoryFee)) || Number(input.standardCableAccessoryFee) < 0)) errors.standardCableAccessoryFee = '请输入有效的普通铜套配件费';
  if (input.isCableMode && input.xinjieCableAccessoryFee && (Number.isNaN(Number(input.xinjieCableAccessoryFee)) || Number(input.xinjieCableAccessoryFee) < 0)) errors.xinjieCableAccessoryFee = '请输入有效的新界式铜套配件费';
  if (input.isCableMode && !input.standardCableAccessoryName.trim()) errors.standardCableAccessoryName = '请输入第一种配件费名称';
  if (input.isCableMode && !input.xinjieCableAccessoryName.trim()) errors.xinjieCableAccessoryName = '请输入第二种配件费名称';
  if (input.isFloatMode && (Number.isNaN(Number(input.floatAccessoryDelta)) || Number(input.floatAccessoryDelta) < 0)) errors.floatAccessoryDelta = '请输入有效的新界式加价';
  if (input.isScrewMode && input.screwPricingEnabled && (!input.screwDiameter || Number.isNaN(Number(input.screwDiameter)) || Number(input.screwDiameter) <= 0)) errors.screwDiameter = '请输入有效直径';
  if (!input.supplier.trim()) errors.supplier = '供应商不能为空';
  return errors;
}

export function buildPartRemark(input: PartRemarkInput): Record<string, unknown> | null {
  if (input.category === '泵壳') {
    return {
      isStainless: input.isStainless,
      openOffset: optionalNumber(input.openOffset),
      defaultUpperBearing: input.defaultUpperBearing || undefined,
      defaultLowerBearing: input.defaultLowerBearing || undefined,
      defaultOilSealDia: optionalNumber(input.defaultOilSealDia),
      defaultBearingSpan: optionalNumber(input.defaultBearingSpan),
      defaultImpellerDia: optionalNumber(input.defaultImpellerDia),
      defaultImpellerSpan: optionalNumber(input.defaultImpellerSpan),
      defaultImpellerDepth: optionalNumber(input.defaultImpellerDepth),
      defaultThreadLength: optionalNumber(input.defaultThreadLength),
      defaultThreadDia: optionalNumber(input.defaultThreadDia),
      defaultStackOffset: optionalNumber(input.defaultStackOffset),
    };
  }

  if (input.isCableMode) {
    const standard = zeroNumber(input.standardCableAccessoryFee);
    return {
      cableAccessoryFee: standard,
      cableAccessoryFees: {
        standard,
        xinjie: zeroNumber(input.xinjieCableAccessoryFee),
      },
      cableAccessoryNames: {
        standard: input.standardCableAccessoryName.trim(),
        xinjie: input.xinjieCableAccessoryName.trim(),
      },
    };
  }

  if (input.isScrewMode && input.screwPricingEnabled) {
    const diameter = Number.parseFloat(input.screwDiameter);
    return {
      screwPricing: {
        enabled: true,
        diameter,
        modelPrefix: `${diameter}*`,
      },
    };
  }

  return null;
}

export function buildCableAccessorySettingsValue(input: {
  standardCableAccessoryName: string;
  standardCableAccessoryFee: string;
  xinjieCableAccessoryName: string;
  xinjieCableAccessoryFee: string;
}) {
  return {
    standard: { name: input.standardCableAccessoryName.trim(), fee: zeroNumber(input.standardCableAccessoryFee) },
    xinjie: { name: input.xinjieCableAccessoryName.trim(), fee: zeroNumber(input.xinjieCableAccessoryFee) },
  };
}

export function parseFloatAccessoryDelta(value: string): number {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : DEFAULT_FLOAT_ACCESSORY_DELTA;
}
