import { Box, Paper, TextField, Typography } from '@mui/material';

export interface RecipeTechnicalData {
  rotorLength?: string;
  rotorDiameter?: string;
  shaftDiameter?: string;
  power?: string;
  voltage?: string;
  current?: string;
  frequency?: string;
  testReportNo?: string;
  testDate?: string;
  testSummary?: string;
}

export const TECHNICAL_DATA_LABELS: Record<keyof RecipeTechnicalData, string> = {
  rotorLength: '转子长度',
  rotorDiameter: '转子直径',
  shaftDiameter: '轴径',
  power: '功率',
  voltage: '电压',
  current: '电流',
  frequency: '频率',
  testReportNo: '测试报告号',
  testDate: '测试日期',
  testSummary: '测试报告/备注',
};

const TECHNICAL_DATA_KEYS = Object.keys(TECHNICAL_DATA_LABELS) as Array<keyof RecipeTechnicalData>;

interface Props {
  value: RecipeTechnicalData;
  onChange: (value: RecipeTechnicalData) => void;
}

export function parseTechnicalDataJson(value?: string): RecipeTechnicalData {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return TECHNICAL_DATA_KEYS.reduce<RecipeTechnicalData>((acc, key) => {
      const raw = parsed[key];
      if (raw === undefined || raw === null) return acc;
      const text = String(raw).trim();
      if (text) acc[key] = text;
      return acc;
    }, {});
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
  return JSON.stringify(cleaned);
}

export default function StepTechnicalData({ value, onChange }: Props) {
  const update = (field: keyof RecipeTechnicalData, next: string) => {
    onChange({ ...value, [field]: next });
  };

  return (
    <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 0.5 }}>
          ▸ 技术档案
        </Typography>
      </Box>
      <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, 1fr)' }, gap: 1.5 }}>
        <TextField size="small" label="转子长度" value={value.rotorLength || ''} onChange={e => update('rotorLength', e.target.value)} helperText="mm" />
        <TextField size="small" label="转子直径" value={value.rotorDiameter || ''} onChange={e => update('rotorDiameter', e.target.value)} helperText="mm" />
        <TextField size="small" label="轴径" value={value.shaftDiameter || ''} onChange={e => update('shaftDiameter', e.target.value)} helperText="mm" />
        <TextField size="small" label="功率" value={value.power || ''} onChange={e => update('power', e.target.value)} helperText="W / kW" />
        <TextField size="small" label="电压" value={value.voltage || ''} onChange={e => update('voltage', e.target.value)} helperText="V" />
        <TextField size="small" label="电流" value={value.current || ''} onChange={e => update('current', e.target.value)} helperText="A" />
        <TextField size="small" label="频率" value={value.frequency || ''} onChange={e => update('frequency', e.target.value)} helperText="Hz" />
        <TextField size="small" label="测试报告号" value={value.testReportNo || ''} onChange={e => update('testReportNo', e.target.value)} />
        <TextField size="small" label="测试日期" type="date" value={value.testDate || ''} onChange={e => update('testDate', e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField
          size="small"
          label="测试报告 / 备注"
          value={value.testSummary || ''}
          onChange={e => update('testSummary', e.target.value)}
          multiline
          minRows={2}
          sx={{ gridColumn: { xs: '1', sm: 'span 3' } }}
        />
      </Box>
    </Paper>
  );
}
