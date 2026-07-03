import { Part, PumpShellMeta, ScrewPricingMeta } from '../types';
import { DEFAULT_FLOAT_ACCESSORY_DELTA, capacitorValueFromModel } from './businessRules';

export const WIRE_MODE_CONFIG: Record<string, string> = {
  '浮球': '浮球-线径',
  '电缆线': '电缆-线径',
};

export const CAPACITOR_CATEGORIES = new Set(['电容']);
export const DEFAULT_STANDARD_CABLE_ACCESSORY_NAME = '普通铜套';
export const DEFAULT_XINJIE_CABLE_ACCESSORY_NAME = '新界式';

export interface CableAccessoryMetaForm {
  standardFee: string;
  xinjieFee: string;
  standardName: string;
  xinjieName: string;
}

export interface PartFormValidationInput {
  category: string;
  model: string;
  price: string;
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
}

export interface PartNotesInput {
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
}

function parseJsonObject(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

export function parsePumpShellMeta(notes?: string): PumpShellMeta {
  const meta = parseJsonObject(notes) as unknown as PumpShellMeta;
  return { ...meta, isStainless: Boolean(meta.isStainless) };
}

export function parseCableAccessoryMeta(notes?: string): CableAccessoryMetaForm {
  const meta = parseJsonObject(notes) as {
    cableAccessoryFee?: unknown;
    cableAccessoryFees?: { standard?: unknown; xinjie?: unknown };
    cableAccessoryNames?: { standard?: unknown; xinjie?: unknown };
  };
  const standardFee = nonNegativeString(meta.cableAccessoryFees?.standard);
  const legacyFee = nonNegativeString(meta.cableAccessoryFee);
  const xinjieFee = nonNegativeString(meta.cableAccessoryFees?.xinjie);
  const standardName = typeof meta.cableAccessoryNames?.standard === 'string' && meta.cableAccessoryNames.standard.trim()
    ? meta.cableAccessoryNames.standard.trim()
    : DEFAULT_STANDARD_CABLE_ACCESSORY_NAME;
  const xinjieName = typeof meta.cableAccessoryNames?.xinjie === 'string' && meta.cableAccessoryNames.xinjie.trim()
    ? meta.cableAccessoryNames.xinjie.trim()
    : DEFAULT_XINJIE_CABLE_ACCESSORY_NAME;

  return {
    standardFee: standardFee || legacyFee,
    xinjieFee,
    standardName,
    xinjieName,
  };
}

export function parseScrewPricingMetaFromNotes(notes?: string): ScrewPricingMeta | null {
  const pricing = (parseJsonObject(notes) as { screwPricing?: ScrewPricingMeta }).screwPricing;
  return pricing?.enabled ? pricing : null;
}

export function wirePrefixForCategory(category: string): string {
  return WIRE_MODE_CONFIG[category] || '';
}

export function isCapacitorCategory(category: string): boolean {
  return CAPACITOR_CATEGORIES.has(category);
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
  if (!input.category) errors.category = '请选择类别';
  if (!input.price || Number.isNaN(Number(input.price)) || Number(input.price) < 0) errors.price = '请输入有效价格';
  if (input.isCableMode && input.standardCableAccessoryFee && (Number.isNaN(Number(input.standardCableAccessoryFee)) || Number(input.standardCableAccessoryFee) < 0)) errors.standardCableAccessoryFee = '请输入有效的普通铜套配件费';
  if (input.isCableMode && input.xinjieCableAccessoryFee && (Number.isNaN(Number(input.xinjieCableAccessoryFee)) || Number(input.xinjieCableAccessoryFee) < 0)) errors.xinjieCableAccessoryFee = '请输入有效的新界式铜套配件费';
  if (input.isCableMode && !input.standardCableAccessoryName.trim()) errors.standardCableAccessoryName = '请输入第一种配件费名称';
  if (input.isCableMode && !input.xinjieCableAccessoryName.trim()) errors.xinjieCableAccessoryName = '请输入第二种配件费名称';
  if (input.isFloatMode && (Number.isNaN(Number(input.floatAccessoryDelta)) || Number(input.floatAccessoryDelta) < 0)) errors.floatAccessoryDelta = '请输入有效的新界式加价';
  if (input.isScrewMode && input.screwPricingEnabled) {
    if (!input.screwDiameter || Number.isNaN(Number(input.screwDiameter)) || Number(input.screwDiameter) <= 0) errors.screwDiameter = '请输入有效直径';
  }
  if (!input.supplier.trim()) errors.supplier = '供应商不能为空';
  return errors;
}

export function buildPartNotes(input: PartNotesInput): Record<string, unknown> | null {
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
