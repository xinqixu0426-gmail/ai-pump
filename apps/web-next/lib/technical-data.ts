export type FixedTechnicalDataKey =
  | 'rotorLength'
  | 'rotorDiameter'
  | 'shaftDiameter'
  | 'upperBearing'
  | 'lowerBearing'
  | 'pieceCount'
  | 'bearingSpan'
  | 'stackOffset'
  | 'oilSealDiameter'
  | 'impellerBoreDiameter'
  | 'impellerSpan'
  | 'impellerDepth'
  | 'threadLength'
  | 'threadDiameter'
  | 'power'
  | 'voltage'
  | 'current'
  | 'frequency'
  | 'testReportNo'
  | 'testDate'
  | 'testSummary';

export type CustomTechnicalField = {
  id: string;
  label: string;
  value: string;
  unit?: string;
};

export type TechnicalReferenceField = {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
};

export type RecipeTechnicalData = Partial<Record<FixedTechnicalDataKey, string>> & {
  customFields?: CustomTechnicalField[];
};

export const TECHNICAL_DATA_LABELS: Record<FixedTechnicalDataKey, string> = {
  rotorLength: '转子长度',
  rotorDiameter: '转子直径',
  shaftDiameter: '轴径',
  upperBearing: '上轴承',
  lowerBearing: '下轴承',
  pieceCount: '转子片数',
  bearingSpan: '开档',
  stackOffset: '定位',
  oilSealDiameter: '油封孔径',
  impellerBoreDiameter: '叶轮孔径',
  impellerSpan: '叶轮开档',
  impellerDepth: '叶轮厚度',
  threadLength: '螺纹长度',
  threadDiameter: '螺纹直径',
  power: '功率',
  voltage: '电压',
  current: '电流',
  frequency: '频率',
  testReportNo: '测试报告号',
  testDate: '测试日期',
  testSummary: '测试报告/备注',
};

export const TECHNICAL_DATA_KEYS = Object.keys(TECHNICAL_DATA_LABELS) as FixedTechnicalDataKey[];

const IMPELLER_PROGRESS_FIELDS = [
  { key: 'impellerModel', label: '叶轮' },
  { key: 'impellerThickness', label: '叶轮厚度', unit: 'mm' },
  { key: 'impellerDiameter', label: '叶轮直径', unit: 'mm' },
  { key: 'impellerBladeCount', label: '叶片数', unit: '片' },
] as const;

const TECHNICAL_DATA_UNITS: Partial<Record<FixedTechnicalDataKey, string>> = {
  rotorLength: 'mm',
  rotorDiameter: 'mm',
  shaftDiameter: 'mm',
  pieceCount: '片',
  bearingSpan: 'mm',
  stackOffset: 'mm',
  oilSealDiameter: 'mm',
  impellerBoreDiameter: 'mm',
  impellerSpan: 'mm',
  impellerDepth: 'mm',
  threadLength: 'mm',
  threadDiameter: 'mm',
  voltage: 'V',
  current: 'A',
  frequency: 'Hz',
};

type RecipeTechnicalProgressSource = {
  technicalData: RecipeTechnicalData;
  impellerModel?: string | number | null;
  impellerThickness?: string | number | null;
  impellerDiameter?: string | number | null;
  impellerBladeCount?: string | number | null;
};

export type RecipeTechnicalProgress = {
  completed: number;
  total: number;
  percent: number;
  entries: Array<{
    id: string;
    label: string;
    value: string;
  }>;
};

function hasTechnicalValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function getRecipeTechnicalProgress(source: RecipeTechnicalProgressSource): RecipeTechnicalProgress {
  const fixedEntries = TECHNICAL_DATA_KEYS.flatMap((key) => {
    const rawValue = source.technicalData[key];
    if (!hasTechnicalValue(rawValue)) return [];
    const unit = TECHNICAL_DATA_UNITS[key];
    return [{
      id: key,
      label: TECHNICAL_DATA_LABELS[key],
      value: `${String(rawValue).trim()}${unit ? ` ${unit}` : ''}`,
    }];
  });
  const impellerEntries = IMPELLER_PROGRESS_FIELDS.flatMap((field) => {
    const rawValue = source[field.key];
    if (!hasTechnicalValue(rawValue)) return [];
    return [{
      id: field.key,
      label: field.label,
      value: `${String(rawValue).trim()}${'unit' in field ? ` ${field.unit}` : ''}`,
    }];
  });
  const total = TECHNICAL_DATA_KEYS.length + IMPELLER_PROGRESS_FIELDS.length;
  const entries = [...fixedEntries, ...impellerEntries];
  const completed = entries.length;
  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    entries,
  };
}

export function createCustomTechnicalField(): CustomTechnicalField {
  return {
    id: `custom_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    label: '',
    value: '',
    unit: '',
  };
}

export function parseTechnicalDataJson(value?: string): RecipeTechnicalData {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const fixedData = TECHNICAL_DATA_KEYS.reduce<RecipeTechnicalData>((acc, key) => {
      const raw = parsed[key];
      if (raw === undefined || raw === null) return acc;
      const text = String(raw).trim();
      if (text) acc[key] = text;
      return acc;
    }, {});

    const rawCustomFields: unknown[] = Array.isArray(parsed.customFields) ? parsed.customFields : [];
    const customFields = rawCustomFields.reduce<CustomTechnicalField[]>((acc, field, index) => {
      if (!field || typeof field !== 'object') return acc;
      const item = field as Partial<CustomTechnicalField>;
      const label = String(item.label || '').trim();
      const text = String(item.value || '').trim();
      const unit = String(item.unit || '').trim();
      if (!label && !text && !unit) return acc;
      acc.push({
        id: String(item.id || `custom_${index}`),
        label,
        value: text,
        unit,
      });
      return acc;
    }, []);

    Object.entries(parsed as Record<string, unknown>).forEach(([key, raw]) => {
      if (key === 'customFields' || TECHNICAL_DATA_KEYS.includes(key as FixedTechnicalDataKey)) return;
      const text = String(raw ?? '').trim();
      if (text) customFields.push({ id: `custom_${key}`, label: key, value: text, unit: '' });
    });

    if (customFields.length > 0) fixedData.customFields = customFields;
    return fixedData;
  } catch {
    return {};
  }
}

export function stringifyTechnicalData(value: RecipeTechnicalData): string {
  const cleaned = TECHNICAL_DATA_KEYS.reduce<RecipeTechnicalData>((acc, key) => {
    const text = String(value[key] ?? '').trim();
    if (text) acc[key] = text;
    return acc;
  }, {});

  const customFields = (value.customFields || [])
    .map((field) => ({
      id: field.id || createCustomTechnicalField().id,
      label: String(field.label || '').trim(),
      value: String(field.value || '').trim(),
      unit: String(field.unit || '').trim(),
    }))
    .filter((field) => field.label || field.value || field.unit);

  if (customFields.length > 0) cleaned.customFields = customFields;
  return JSON.stringify(cleaned);
}

export function getTechnicalDataEntries(value: RecipeTechnicalData) {
  const fixedEntries = TECHNICAL_DATA_KEYS
    .map((key) => ({
      id: key,
      label: TECHNICAL_DATA_LABELS[key],
      value: String(value[key] || '').trim(),
      unit: '',
    }))
    .filter((entry) => entry.value);

  const customEntries = (value.customFields || [])
    .map((field) => ({
      id: field.id,
      label: String(field.label || '').trim(),
      value: String(field.value || '').trim(),
      unit: String(field.unit || '').trim(),
    }))
    .filter((entry) => entry.label || entry.value || entry.unit);

  return [...fixedEntries, ...customEntries];
}
