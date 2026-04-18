export const BEARING_OPTIONS = [
  { value: '', label: '未指定' },
  { value: '6201', label: '6201 (孔径12mm)' },
  { value: '6202', label: '6202 (孔径15mm)' },
  { value: '6203', label: '6203 (孔径17mm)' },
  { value: '6204', label: '6204 (孔径20mm)' },
  { value: '6205', label: '6205 (孔径25mm)' },
];

// 定子规格 → 转子直径映射（格式："12-160" 中 12 是定子规格，160 是片数）
// 后续新增规格只需在这里加一行
export const STATOR_TO_ROTOR: Record<string, number> = {
  '12': 61,     // 12号定子 → 转子直径61mm
  '13.5': 67,   // 13.5号定子 → 转子直径67mm
};

/** 轴承型号标准化："6202-2RS" → "6202"、"202" → "6202" */
export function normalizeBearing(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();
  s = s.replace(/[-/]?(2RS|2RZ|2Z|ZZ|RS|RZ|DDU|LLU|LLB|CM|C3|P6|P5|NR)\b/gi, '');
  s = s.replace(/[-/]+$/, '').trim();
  if (/^\d{3}$/.test(s)) s = '6' + s;
  return s;
}

export interface JobStatus {
  status: 'processing' | 'success' | 'failed';
  fileUrl?: string;
  error?: string;
}
