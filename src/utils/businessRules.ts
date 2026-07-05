import { Part, ScrewPricingMeta } from '../types';

export const DEFAULT_PACKAGING_MATERIAL = '牛皮纸箱';
export const PACKAGING_MATERIAL_OPTIONS = ['牛皮纸箱', '彩印纸箱', '木箱', '泡沫', '商标', '说明书', '珍珠棉', '其他包材'];
export const DEFAULT_COIL_MATERIAL = '钢带';
export const DEFAULT_FLOAT_ACCESSORY_DELTA = 0.6;
export const DEFAULT_ORDER_MARGIN = 1.10;
export const DEFAULT_QUOTATION_MARGIN = 0.15;
export const DEFAULT_PAINTING_COST = 3;
export const DEFAULT_LONG_SCREW_EXTRA_LENGTH = 0;
export const LONG_SCREW_LENGTH_STEP_MM = 5;
export const SCREW_LENGTH_PRICE_FACTOR = 0.00424;
export const SCREW_LENGTH_PRICE_OFFSET = -0.198;

export function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function inferPackingMaterial(model = '', material?: string): string {
  if (material) return material;
  const normalized = String(model || '').trim();
  if (normalized.includes('木箱')) return '木箱';
  if (normalized.includes('彩')) return '彩印纸箱';
  if (normalized.includes('泡沫')) return '泡沫';
  if (normalized.includes('商标')) return '商标';
  if (normalized.includes('说明书')) return '说明书';
  if (normalized.includes('珍珠棉')) return '珍珠棉';
  return DEFAULT_PACKAGING_MATERIAL;
}

export function partPriceByModelAndSupplier(parts: Part[], model: string, supplier = ''): number {
  const targetModel = (model || '').trim();
  const targetSupplier = (supplier || '').trim();
  const exactPart = parts.find(p => p.model.trim() === targetModel && p.supplier.trim() === targetSupplier);
  if (exactPart && targetSupplier) return exactPart.price;

  const modelParts = parts.filter(p => p.model.trim() === targetModel);
  if (modelParts.length === 0) return 0;
  return modelParts.reduce((min, curr) => curr.price < min.price ? curr : min, modelParts[0]).price;
}

export function wireModel(prefix: '浮球' | '电缆', wire: string): string {
  return `${prefix}-线径${wire}`;
}

export function uniqueModelsByCategory(parts: Part[], category: string): string[] {
  const models = new Set<string>();
  parts.forEach(part => {
    if (part.category === category && part.model) models.add(part.model);
  });
  return Array.from(models).sort();
}

export function suppliersByModel(parts: Part[], model: string): string[] {
  const suppliers = new Set<string>();
  const targetModel = (model || '').trim();
  parts.forEach(part => {
    if (part.model.trim() === targetModel && part.supplier) suppliers.add(part.supplier);
  });
  return Array.from(suppliers).filter(Boolean).sort();
}

export function wireOptionsFromParts(parts: Part[], prefix: string): string[] {
  const wires = new Set<string>();
  parts.forEach(part => {
    const model = part.model || '';
    if (!model.startsWith(prefix)) return;
    const wire = model.replace(prefix, '');
    if (wire) wires.add(wire);
  });
  return Array.from(wires).sort((a, b) => parseFloat(a) - parseFloat(b));
}

export function capacitorValueFromModel(model: string): number | null {
  const normalized = String(model || '').replace(/[uUμfFvV\s]/g, '').trim();
  const value = parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

export function formatLengthMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

export function roundLengthToStep(value: number, step = LONG_SCREW_LENGTH_STEP_MM): number {
  const length = Number(value);
  const interval = Number(step);
  if (!Number.isFinite(length) || length <= 0) return 0;
  if (!Number.isFinite(interval) || interval <= 0) return length;
  return Math.ceil(length / interval) * interval;
}

export function isLongScrewPart(part: { name?: string; model?: string }): boolean {
  return `${part.name || ''}${part.model || ''}`.includes('长螺丝');
}

export function longScrewModelFromBarrel(part: { model?: string }, barrelLength?: number | string | null, extraLength: number | string = DEFAULT_LONG_SCREW_EXTRA_LENGTH): string | null {
  const barrel = Number(barrelLength || 0);
  const extra = Number(extraLength || 0);
  if (!Number.isFinite(barrel) || barrel <= 0) return null;
  const requestedLength = barrel + extra;
  if (!Number.isFinite(requestedLength) || requestedLength <= 0) return null;

  const prefixMatch = String(part.model || '').match(/^(.+?\*)/);
  const prefix = prefixMatch ? prefixMatch[1] : '6*';
  return `${prefix}${formatLengthMm(requestedLength)}`;
}

export function applyLongScrewRule<T extends { name?: string; model?: string }>(
  part: T,
  barrelLength?: number | string | null,
  extraLength: number | string = DEFAULT_LONG_SCREW_EXTRA_LENGTH
): T {
  if (!isLongScrewPart(part)) return part;
  const model = longScrewModelFromBarrel(part, barrelLength, extraLength);
  return model ? { ...part, model } : part;
}

export function parseScrewPricingMeta(notes?: string): ScrewPricingMeta | null {
  if (!notes) return null;
  try {
    const meta = JSON.parse(notes);
    const pricing = meta?.screwPricing;
    if (!pricing?.enabled) return null;
    const diameter = Number(pricing.diameter);
    if (!Number.isFinite(diameter) || diameter <= 0) return null;
    return {
      enabled: true,
      diameter,
      modelPrefix: typeof pricing.modelPrefix === 'string' ? pricing.modelPrefix : undefined,
    };
  } catch {
    return null;
  }
}

export function screwDiameterFromModel(model?: string): number | null {
  const match = String(model || '').match(/^(\d+(?:\.\d+)?)\*/);
  const diameter = match ? Number(match[1]) : NaN;
  return Number.isFinite(diameter) && diameter > 0 ? diameter : null;
}

export function screwLengthFromModel(model?: string): number | null {
  const match = String(model || '').match(/\*(\d+(?:\.\d+)?)$/);
  const length = match ? Number(match[1]) : NaN;
  return Number.isFinite(length) && length > 0 ? length : null;
}

export function calculateScrewUnitPrice(basePrice: number, length: number, pricing: ScrewPricingMeta): number {
  void basePrice;
  void pricing;
  const screwLength = Number(length || 0);
  if (!Number.isFinite(screwLength) || screwLength <= 0) return 0;
  return roundMoney(Math.max(0, SCREW_LENGTH_PRICE_FACTOR * screwLength + SCREW_LENGTH_PRICE_OFFSET));
}

export function findScrewPricingPart(parts: Part[], model?: string, supplier = ''): { part: Part; pricing: ScrewPricingMeta } | null {
  const diameter = screwDiameterFromModel(model);
  if (!diameter) return null;
  const candidates = parts
    .map(part => ({ part, pricing: parseScrewPricingMeta(part.notes) }))
    .filter((item): item is { part: Part; pricing: ScrewPricingMeta } => (
      !!item.pricing
      && item.part.category === '螺丝'
      && Number(item.pricing.diameter) === diameter
    ));
  if (candidates.length === 0) return null;
  const normalizedSupplier = String(supplier || '').trim();
  const exact = candidates.find(item => normalizedSupplier && item.part.supplier.trim() === normalizedSupplier);
  return exact || candidates.reduce((min, item) => item.part.price < min.part.price ? item : min, candidates[0]);
}

export function longScrewPriceByModel(parts: Part[], model?: string, supplier = ''): number | null {
  const length = screwLengthFromModel(model);
  if (!length) return null;
  const matched = findScrewPricingPart(parts, model, supplier);
  if (!matched) return null;
  return calculateScrewUnitPrice(matched.part.price, length, matched.pricing);
}
