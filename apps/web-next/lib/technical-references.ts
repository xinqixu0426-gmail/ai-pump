import type { Part } from './parts';
import type { PumpShellTemplate } from './recipes';
import type { TechnicalReferenceField } from './technical-data';

type PumpShellMeta = Record<string, unknown> & {
  isStainless?: boolean;
  barrelLength?: number | string;
  openOffset?: number | string;
  openFactor?: number | string;
  defaultUpperBearing?: string;
  defaultLowerBearing?: string;
  defaultOilSealDia?: number | string;
  defaultBearingSpan?: number | string;
  defaultImpellerDia?: number | string;
  defaultImpellerSpan?: number | string;
  defaultImpellerDepth?: number | string;
  defaultThreadLength?: number | string;
  defaultThreadDia?: number | string;
  defaultStackOffset?: number | string;
};

const KNOWN_SHELL_META_KEYS = new Set([
  'isStainless',
  'barrelLength',
  'openOffset',
  'openFactor',
  'barrelLengthPresets',
  'defaultUpperBearing',
  'defaultLowerBearing',
  'defaultOilSealDia',
  'defaultBearingSpan',
  'defaultImpellerDia',
  'defaultImpellerSpan',
  'defaultImpellerDepth',
  'defaultThreadLength',
  'defaultThreadDia',
  'defaultStackOffset',
]);

const ROTOR_PARAM_LABELS: Record<string, { label: string; unit?: string }> = {
  upper_bearing: { label: '模板上轴承' },
  lower_bearing: { label: '模板下轴承' },
  piece_count: { label: '模板转子片数', unit: '片' },
  rotor_dia: { label: '模板转子直径', unit: 'mm' },
  bearing_span: { label: '模板开档', unit: 'mm' },
  stack_offset: { label: '模板定位', unit: 'mm' },
  oil_seal_dia: { label: '模板油封孔径', unit: 'mm' },
  impeller_dia: { label: '模板叶轮孔径', unit: 'mm' },
  impeller_span: { label: '模板叶轮开档', unit: 'mm' },
  impeller_depth: { label: '模板叶轮深度', unit: 'mm' },
  thread_length: { label: '模板螺丝长度', unit: 'mm' },
  thread_dia: { label: '模板螺纹直径', unit: 'mm' },
};

function normalizeShellModel(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function describeShellModel(value: string) {
  const exact = normalizeShellModel(value);
  const base = exact.replace(/-\d+(?:\.\d+)?(?:mm|cm)?$/i, '');
  return { exact, base, hasDimensionSuffix: base !== exact };
}

function findShellPartForTemplate(shellModel: string, parts: Part[]) {
  const target = describeShellModel(shellModel);
  const shellParts = parts.filter((part) => part.category === '泵壳');
  const exact = shellParts.find((part) => normalizeShellModel(part.model) === target.exact);
  if (exact) return exact;
  const compatible = shellParts.filter((part) => {
    const candidate = describeShellModel(part.model);
    return candidate.base === target.base
      && candidate.hasDimensionSuffix !== target.hasDimensionSuffix;
  });
  const distinctModels = new Set(compatible.map((part) => normalizeShellModel(part.model)));
  return distinctModels.size === 1 ? compatible[0] : undefined;
}

function addReference(refs: TechnicalReferenceField[], id: string, label: string, value: unknown, unit = '') {
  if (value === undefined || value === null || value === '') return;
  refs.push({ id, label, value: String(value), unit });
}

export function findShellMetaForTemplate(template: PumpShellTemplate | null | undefined, parts: Part[]): PumpShellMeta | null {
  if (!template) return null;
  const shellPart = findShellPartForTemplate(template.shellModel, parts);
  if (!shellPart?.notes) return null;
  try {
    const parsed = JSON.parse(shellPart.notes);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as PumpShellMeta : null;
  } catch {
    return null;
  }
}

export function openOffsetFromMeta(meta: PumpShellMeta | null) {
  if (!meta) return null;
  const value = meta.openOffset ?? meta.openFactor;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function calculateBearingSpan(barrelLength: string | number, openOffset: number | null) {
  const length = Number(barrelLength);
  const offset = Number(openOffset);
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(offset)) return '';
  return String(Number((length - offset).toFixed(1)));
}

export function stainlessBarrelDrawingText(barrelLength: string | number | null | undefined) {
  const length = Number(barrelLength);
  if (!Number.isFinite(length) || length <= 0) return '';
  return `不锈钢机筒：${Number(length.toFixed(1))}mm`;
}

function addShellMetaReferences(refs: TechnicalReferenceField[], shellMetaInfo: PumpShellMeta | null) {
  if (!shellMetaInfo) return;
  addReference(refs, 'openOffset', '开档系数', openOffsetFromMeta(shellMetaInfo), 'mm');
  addReference(refs, 'defaultBearingSpan', '默认开档', shellMetaInfo.defaultBearingSpan, 'mm');
  addReference(refs, 'defaultStackOffset', '默认定位', shellMetaInfo.defaultStackOffset, 'mm');
  addReference(refs, 'defaultUpperBearing', '默认上轴承', shellMetaInfo.defaultUpperBearing);
  addReference(refs, 'defaultLowerBearing', '默认下轴承', shellMetaInfo.defaultLowerBearing);
  addReference(refs, 'defaultOilSealDia', '默认油封孔径', shellMetaInfo.defaultOilSealDia, 'mm');
  addReference(refs, 'defaultImpellerDia', '默认叶轮孔径', shellMetaInfo.defaultImpellerDia, 'mm');
  addReference(refs, 'defaultImpellerSpan', '默认叶轮开档', shellMetaInfo.defaultImpellerSpan, 'mm');
  addReference(refs, 'defaultImpellerDepth', '默认叶轮厚度', shellMetaInfo.defaultImpellerDepth, 'mm');
  addReference(refs, 'defaultThreadLength', '默认螺丝长度', shellMetaInfo.defaultThreadLength, 'mm');
  addReference(refs, 'defaultThreadDia', '默认螺纹直径', shellMetaInfo.defaultThreadDia, 'mm');

  Object.entries(shellMetaInfo).forEach(([key, value]) => {
    if (KNOWN_SHELL_META_KEYS.has(key)) return;
    if (Array.isArray(value)) addReference(refs, `shell_${key}`, key, value.join(' / '));
    else if (typeof value !== 'object') addReference(refs, `shell_${key}`, key, value);
  });
}

function addRotorParamReferences(refs: TechnicalReferenceField[], selectedTemplate: PumpShellTemplate | null) {
  if (!selectedTemplate?.rotorParamsJson) return;
  try {
    const rotorParams = JSON.parse(selectedTemplate.rotorParamsJson || '{}');
    if (!rotorParams || typeof rotorParams !== 'object' || Array.isArray(rotorParams)) return;
    Object.entries(rotorParams).forEach(([key, value]) => {
      const config = ROTOR_PARAM_LABELS[key];
      if (!config) return;
      addReference(refs, `rotor_${key}`, config.label, value, config.unit || '');
    });
  } catch {
    // Invalid template params are treated as no references.
  }
}

function dedupeReferences(refs: TechnicalReferenceField[]) {
  const deduped = new Map<string, TechnicalReferenceField>();
  refs.forEach((ref) => {
    const key = `${ref.label}||${ref.value}||${ref.unit || ''}`;
    if (!deduped.has(key)) deduped.set(key, ref);
  });
  return Array.from(deduped.values());
}

export function buildTechnicalReferenceFields(input: {
  shellMetaInfo: PumpShellMeta | null;
  selectedTemplate: PumpShellTemplate | null;
}): TechnicalReferenceField[] {
  const refs: TechnicalReferenceField[] = [];
  addShellMetaReferences(refs, input.shellMetaInfo);
  addRotorParamReferences(refs, input.selectedTemplate);
  return dedupeReferences(refs);
}
