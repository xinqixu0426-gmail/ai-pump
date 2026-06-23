import { useState } from 'react';
import { Box, Button, Chip, Collapse, IconButton, Paper, TextField, Typography } from '@mui/material';
import { ChevronDown as ExpandIcon, ChevronUp as CollapseIcon, Plus as AddIcon, Trash2 as DeleteIcon } from 'lucide-react';

type FixedTechnicalDataKey =
  | 'rotorLength'
  | 'rotorDiameter'
  | 'shaftDiameter'
  | 'power'
  | 'voltage'
  | 'current'
  | 'frequency'
  | 'testReportNo'
  | 'testDate'
  | 'testSummary';

export interface CustomTechnicalField {
  id: string;
  label: string;
  value: string;
  unit?: string;
}

export interface TechnicalReferenceField {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
}

export interface RecipeTechnicalData extends Partial<Record<FixedTechnicalDataKey, string>> {
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
  customFields?: CustomTechnicalField[];
}

export const TECHNICAL_DATA_LABELS: Record<FixedTechnicalDataKey, string> = {
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

export const TECHNICAL_DATA_KEYS = Object.keys(TECHNICAL_DATA_LABELS) as FixedTechnicalDataKey[];

interface Props {
  value: RecipeTechnicalData;
  onChange: (value: RecipeTechnicalData) => void;
  referenceFields?: TechnicalReferenceField[];
}

const createCustomField = (): CustomTechnicalField => ({
  id: `custom_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  label: '',
  value: '',
  unit: '',
});

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

    Object.entries(parsed).forEach(([key, raw]) => {
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
    .map(field => ({
      id: field.id || createCustomField().id,
      label: String(field.label || '').trim(),
      value: String(field.value || '').trim(),
      unit: String(field.unit || '').trim(),
    }))
    .filter(field => field.label || field.value || field.unit);
  if (customFields.length > 0) cleaned.customFields = customFields;
  return JSON.stringify(cleaned);
}

export function getTechnicalDataEntries(value: RecipeTechnicalData) {
  const fixedEntries = TECHNICAL_DATA_KEYS
    .map(key => ({
      id: key,
      label: TECHNICAL_DATA_LABELS[key],
      value: String(value[key] || '').trim(),
      unit: '',
    }))
    .filter(entry => entry.value);
  const customEntries = (value.customFields || [])
    .map(field => ({
      id: field.id,
      label: String(field.label || '').trim(),
      value: String(field.value || '').trim(),
      unit: String(field.unit || '').trim(),
    }))
    .filter(entry => entry.label || entry.value || entry.unit);
  return [...fixedEntries, ...customEntries];
}

export default function StepTechnicalData({ value, onChange, referenceFields = [] }: Props) {
  const [expanded, setExpanded] = useState(false);
  const update = (field: FixedTechnicalDataKey, next: string) => {
    onChange({ ...value, [field]: next });
  };
  const customFields = value.customFields || [];
  const filledCount = getTechnicalDataEntries(value).length;
  const addCustomField = () => onChange({ ...value, customFields: [...customFields, createCustomField()] });
  const updateCustomField = (id: string, patch: Partial<CustomTechnicalField>) => {
    onChange({
      ...value,
      customFields: customFields.map(field => field.id === id ? { ...field, ...patch } : field),
    });
  };
  const removeCustomField = (id: string) => {
    onChange({ ...value, customFields: customFields.filter(field => field.id !== id) });
  };

  return (
    <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 0.5 }}>
          ▸ 技术档案
        </Typography>
        {filledCount > 0 && <Chip size="small" label={`已填 ${filledCount}`} sx={{ height: 20, fontSize: '0.7rem' }} />}
        {referenceFields.length > 0 && <Chip size="small" label={`参考 ${referenceFields.length}`} variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />}
        <Button
          size="small"
          startIcon={expanded ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
          onClick={() => setExpanded(prev => !prev)}
          sx={{ ml: 'auto', fontWeight: 700 }}
        >
          {expanded ? '收起' : '展开'}
        </Button>
      </Box>
      <Collapse in={expanded}>
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
        {referenceFields.length > 0 && (
          <Box sx={{ px: 2, pb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 700 }}>
              泵壳预设参考
            </Typography>
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 1,
            }}>
              {referenceFields.map(field => (
                <Box
                  key={field.id}
                  sx={{
                    minWidth: 0,
                    px: 1.25,
                    py: 0.9,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'rgba(37, 99, 235, 0.18)',
                    bgcolor: 'rgba(37, 99, 235, 0.035)',
                  }}
                >
                  <Typography variant="caption" color="text.secondary" noWrap title={field.label} sx={{ display: 'block', fontWeight: 700 }}>
                    {field.label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.35 }} noWrap title={`${field.value}${field.unit ? ` ${field.unit}` : ''}`}>
                    {field.value}{field.unit ? ` ${field.unit}` : ''}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
        <Box sx={{ px: 2, pb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: customFields.length > 0 ? 1 : 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              自定义参数
            </Typography>
            <Button size="small" startIcon={<AddIcon size={14} />} onClick={addCustomField} sx={{ ml: 'auto', fontWeight: 700 }}>
              自定义字段
            </Button>
          </Box>
          {customFields.length > 0 && (
            <Box sx={{ display: 'grid', gap: 1 }}>
              {customFields.map(field => (
                <Box
                  key={field.id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1.2fr 1.6fr 0.8fr auto' },
                    gap: 1,
                    alignItems: 'start',
                  }}
                >
                  <TextField
                    size="small"
                    label="字段名"
                    value={field.label}
                    onChange={e => updateCustomField(field.id, { label: e.target.value })}
                  />
                  <TextField
                    size="small"
                    label="参数"
                    value={field.value}
                    onChange={e => updateCustomField(field.id, { value: e.target.value })}
                  />
                  <TextField
                    size="small"
                    label="单位"
                    value={field.unit || ''}
                    onChange={e => updateCustomField(field.id, { unit: e.target.value })}
                  />
                  <IconButton aria-label="删除自定义技术字段" color="error" onClick={() => removeCustomField(field.id)}>
                    <DeleteIcon size={18} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
