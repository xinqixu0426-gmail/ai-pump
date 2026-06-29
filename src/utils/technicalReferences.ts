import { PumpShellMeta, PumpShellTemplate } from '../types';
import { TechnicalReferenceField } from '../components/recipe/StepTechnicalData';

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

function addReference(
  refs: TechnicalReferenceField[],
  id: string,
  label: string,
  value: unknown,
  unit = ''
) {
  if (value === undefined || value === null || value === '') return;
  refs.push({ id, label, value: String(value), unit });
}

function addShellMetaReferences(refs: TechnicalReferenceField[], shellMetaInfo: PumpShellMeta | null) {
  if (!shellMetaInfo) return;
  addReference(refs, 'openOffset', '开档偏移量', shellMetaInfo.openOffset, 'mm');
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
  Object.entries(shellMetaInfo as unknown as Record<string, unknown>).forEach(([key, value]) => {
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
    // ignore invalid template params
  }
}

function dedupeReferences(refs: TechnicalReferenceField[]) {
  const deduped = new Map<string, TechnicalReferenceField>();
  refs.forEach(ref => {
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
