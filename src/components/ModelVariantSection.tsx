import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Paper, Typography, Box, Button, TextField, Select, MenuItem, FormControl,
  InputLabel, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Dialog, DialogActions, DialogContent, DialogTitle, Chip, Tooltip, InputAdornment,
} from '@mui/material';
import { Copy as CopyIcon, Edit3 as EditIcon, Plus as AddIcon, Trash2 as DeleteIcon, Search as SearchIcon } from 'lucide-react';
import { PumpModelVariant, PumpShellTemplate } from '../types';
import { createModelVariant, deleteModelVariant, updateModelVariant, proxyRequest } from '../utils/api';
import { CoilSpecInfo } from './recipe/recipeFormConstants';
import { DEFAULT_COIL_MATERIAL, DEFAULT_LONG_SCREW_EXTRA_LENGTH } from '../utils/businessRules';
import { entityId } from '../utils/entityFields';

interface Props {
  variants: PumpModelVariant[];
  templates: PumpShellTemplate[];
  reload: () => Promise<void>;
  setError: (msg: string) => void;
}

type FormState = {
  modelName: string;
  templateId: string;
  coilSpec: string;
  coilSheets: string;
  coilMaterial: string;
  barrelLength: string;
  longScrewExtraLength: string;
  impellerModel: string;
  impellerThickness: string;
  impellerDiameter: string;
  impellerBladeCount: string;
  note: string;
  customFields: CustomField[];
};

type CustomField = {
  id: string;
  label: string;
  value: string;
};

type TextFormField = Exclude<keyof FormState, 'customFields'>;

const emptyForm: FormState = {
  modelName: '',
  templateId: '',
  coilSpec: '',
  coilSheets: '',
  coilMaterial: DEFAULT_COIL_MATERIAL,
  barrelLength: '',
  longScrewExtraLength: String(DEFAULT_LONG_SCREW_EXTRA_LENGTH),
  impellerModel: '',
  impellerThickness: '',
  impellerDiameter: '',
  impellerBladeCount: '',
  note: '',
  customFields: [],
};

function parseCustomFields(json?: string): CustomField[] {
  try {
    const parsed = JSON.parse(json || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item, index) => ({
      id: `field-${index}`,
      label: String(item?.label || ''),
      value: String(item?.value || ''),
    })).filter(item => item.label || item.value);
  } catch {
    return [];
  }
}

function customFieldsToJson(fields: CustomField[]): string {
  return JSON.stringify(fields
    .map(field => ({ label: field.label.trim(), value: field.value.trim() }))
    .filter(field => field.label || field.value));
}

function FormSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, bgcolor: 'rgba(248,250,252,0.72)' }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={800}>{title}</Typography>
        {subtitle ? <Typography variant="caption" color="text.secondary">{subtitle}</Typography> : null}
      </Box>
      {children}
    </Box>
  );
}

export default function ModelVariantSection({ variants, templates, reload, setError }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PumpModelVariant | null>(null);
  const [cloningFrom, setCloningFrom] = useState<PumpModelVariant | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [coilSpecs, setCoilSpecs] = useState<CoilSpecInfo[]>([]);
  const [query, setQuery] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');

  const templateNameById = useMemo(() => {
    const map = new Map<number, string>();
    templates.forEach(t => map.set(entityId(t), t.shellModel));
    return map;
  }, [templates]);

  useEffect(() => {
    proxyRequest<{ success: boolean; data: CoilSpecInfo[] }>('/api/coils/specs')
      .then(res => setCoilSpecs(res.data || []))
      .catch(() => setCoilSpecs([]));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setCloningFrom(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const formFromVariant = (variant: PumpModelVariant, modelName = variant.modelName || ''): FormState => ({
    modelName,
    templateId: variant.templateId ? String(variant.templateId) : '',
    coilSpec: variant.coilSpec || '',
    coilSheets: variant.coilSheets ? String(variant.coilSheets) : '',
    coilMaterial: variant.coilMaterial || DEFAULT_COIL_MATERIAL,
    barrelLength: variant.barrelLength ? String(variant.barrelLength) : '',
    longScrewExtraLength: variant.longScrewExtraLength != null ? String(variant.longScrewExtraLength) : String(DEFAULT_LONG_SCREW_EXTRA_LENGTH),
    impellerModel: variant.impellerModel || '',
    impellerThickness: variant.impellerThickness ? String(variant.impellerThickness) : '',
    impellerDiameter: variant.impellerDiameter ? String(variant.impellerDiameter) : '',
    impellerBladeCount: variant.impellerBladeCount ? String(variant.impellerBladeCount) : '',
    note: variant.note || '',
    customFields: parseCustomFields(variant.customFieldsJson),
  });

  const openEdit = (variant: PumpModelVariant) => {
    setEditing(variant);
    setCloningFrom(null);
    setForm(formFromVariant(variant));
    setOpen(true);
  };

  const openClone = (variant: PumpModelVariant) => {
    setEditing(null);
    setCloningFrom(variant);
    setForm(formFromVariant(variant, `${variant.modelName || ''}-复用`));
    setOpen(true);
  };

  const updateField = (field: TextFormField, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const addCustomField = () => {
    setForm(prev => ({
      ...prev,
      customFields: [...prev.customFields, { id: `field-${Date.now()}`, label: '', value: '' }],
    }));
  };

  const updateCustomField = (id: string, patch: Partial<CustomField>) => {
    setForm(prev => ({
      ...prev,
      customFields: prev.customFields.map(field => field.id === id ? { ...field, ...patch } : field),
    }));
  };

  const removeCustomField = (id: string) => {
    setForm(prev => ({
      ...prev,
      customFields: prev.customFields.filter(field => field.id !== id),
    }));
  };

  const save = async () => {
    if (!form.modelName.trim()) { setError('配置名称不能为空'); return; }
    if (!form.templateId) { setError('请选择泵壳模板'); return; }
    const payload = {
      modelName: form.modelName.trim(),
      templateId: Number(form.templateId),
      coilSpec: form.coilSpec,
      coilSheets: form.coilSheets ? Number(form.coilSheets) : 0,
      coilMaterial: form.coilMaterial || DEFAULT_COIL_MATERIAL,
      barrelLength: form.barrelLength ? Number(form.barrelLength) : null,
      longScrewExtraLength: form.longScrewExtraLength ? Number(form.longScrewExtraLength) : 0,
      impellerModel: form.impellerModel.trim(),
      impellerThickness: form.impellerThickness ? Number(form.impellerThickness) : null,
      impellerDiameter: form.impellerDiameter ? Number(form.impellerDiameter) : null,
      impellerBladeCount: form.impellerBladeCount ? Number(form.impellerBladeCount) : null,
      note: form.note.trim(),
      customFieldsJson: customFieldsToJson(form.customFields),
    };
    setSaving(true);
    try {
      if (editing) await updateModelVariant(entityId(editing), payload);
      else await createModelVariant(payload);
      setOpen(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存常用配置失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('确定删除这个常用配置吗？已创建的配方不会被删除。')) return;
    try {
      await deleteModelVariant(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除常用配置失败');
    }
  };

  const selectedCoil = coilSpecs.find(s => s.spec === form.coilSpec);
  const materialOptions = selectedCoil?.materials?.length ? selectedCoil.materials : [DEFAULT_COIL_MATERIAL];
  const filteredVariants = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variants.filter(variant => {
      if (templateFilter && String(variant.templateId) !== templateFilter) return false;
      if (!q) return true;
      const customText = parseCustomFields(variant.customFieldsJson).map(field => `${field.label} ${field.value}`).join(' ');
      const text = [
        variant.modelName,
        templateNameById.get(variant.templateId),
        variant.coilSpec,
        variant.coilSheets,
        variant.coilMaterial,
        variant.impellerModel,
        variant.note,
        customText,
      ].join(' ').toLowerCase();
      return text.includes(q);
    });
  }, [variants, templateFilter, query, templateNameById]);

  return (
    <>
      <Paper elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" fontWeight={700}>常用配置</Typography>
            <Typography variant="caption" color="text.secondary">
              保存常用的“泵壳模板 + 线圈片数 + 叶轮/机筒参数”，新建配方时可直接带入，也可在配方中覆盖。
            </Typography>
          </Box>
          <Chip label={`${filteredVariants.length} / ${variants.length}`} size="small" variant="outlined" sx={{ mr: 1, fontWeight: 700 }} />
          <Button variant="contained" size="small" startIcon={<AddIcon size={16} />} onClick={openCreate}>新建配置</Button>
        </Box>
        {variants.length === 0 ? (
          <Box textAlign="center" py={6} color="text.secondary">
            <Typography variant="body2">还没有常用配置。可以先从配方直接核算，确认会复用后再保存为常用配置。</Typography>
          </Box>
        ) : (
          <>
          <Box sx={{ p: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', borderBottom: '1px solid', borderColor: 'divider' }}>
            <TextField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索配置 / 线圈 / 叶轮 / 备注"
              size="small"
              sx={{ width: { xs: '100%', sm: 320 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon size={16} />
                  </InputAdornment>
                ),
              }}
            />
            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
              <InputLabel>泵壳模板</InputLabel>
              <Select value={templateFilter} label="泵壳模板" onChange={e => setTemplateFilter(e.target.value)}>
                <MenuItem value="">全部模板</MenuItem>
                {templates.map(template => (
                  <MenuItem key={entityId(template)} value={String(entityId(template))}>{template.shellModel}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          {filteredVariants.length === 0 ? (
            <Box textAlign="center" py={6} color="text.secondary">
              <Typography variant="body2">没有匹配的常用配置</Typography>
            </Box>
          ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>配置名称</TableCell>
                  <TableCell>共用壳体</TableCell>
                  <TableCell>线圈</TableCell>
                  <TableCell>机筒长度</TableCell>
                  <TableCell>长螺丝</TableCell>
                  <TableCell>叶轮</TableCell>
                  <TableCell>备注</TableCell>
                  <TableCell align="center" sx={{ width: 132 }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredVariants.map(v => {
                  const variantId = entityId(v);
                  return (
                  <TableRow key={variantId} hover>
                    <TableCell><Typography fontWeight={700}>{v.modelName}</Typography></TableCell>
                    <TableCell>{templateNameById.get(v.templateId) || '-'}</TableCell>
                    <TableCell>{v.coilSpec ? `${v.coilSpec}-${v.coilSheets || 0} / ${v.coilMaterial || DEFAULT_COIL_MATERIAL}` : '-'}</TableCell>
                    <TableCell>{v.barrelLength ? `${v.barrelLength} mm` : '-'}</TableCell>
                    <TableCell>
                      {v.barrelLength ? `机筒 ${v.barrelLength} + 补偿 ${v.longScrewExtraLength ?? DEFAULT_LONG_SCREW_EXTRA_LENGTH} = ${Number(v.barrelLength) + Number(v.longScrewExtraLength ?? DEFAULT_LONG_SCREW_EXTRA_LENGTH)} mm` : '-'}
                    </TableCell>
                    <TableCell>
                      {v.impellerModel ? (
                        <Box display="flex" gap={0.5} flexWrap="wrap">
                          <Chip size="small" label={v.impellerModel} />
                          {v.impellerThickness ? <Chip size="small" variant="outlined" label={`${v.impellerThickness}厚`} /> : null}
                          {v.impellerDiameter ? <Chip size="small" variant="outlined" label={`直径${v.impellerDiameter}`} /> : null}
                          {v.impellerBladeCount ? <Chip size="small" variant="outlined" label={`${v.impellerBladeCount}片`} /> : null}
                        </Box>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      <Box>
                        <Typography variant="body2">{v.note || '-'}</Typography>
                        {parseCustomFields(v.customFieldsJson).length > 0 ? (
                          <Box display="flex" flexWrap="wrap" gap={0.5} mt={0.5}>
                            {parseCustomFields(v.customFieldsJson).slice(0, 2).map(field => (
                              <Chip key={field.id} size="small" variant="outlined" label={`${field.label || '字段'}: ${field.value || '-'}`} />
                            ))}
                          </Box>
                        ) : null}
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="复用为新配置">
                        <IconButton size="small" color="primary" aria-label="复用常用配置" onClick={() => openClone(v)}><CopyIcon size={16} /></IconButton>
                      </Tooltip>
                      <Tooltip title="编辑">
                        <IconButton size="small" color="warning" aria-label="编辑常用配置" onClick={() => openEdit(v)}><EditIcon size={16} /></IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton size="small" color="error" aria-label="删除常用配置" onClick={() => remove(variantId)}><DeleteIcon size={16} /></IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          )}
          </>
        )}
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? `编辑配置 - ${editing.modelName}` : cloningFrom ? `复用配置 - ${cloningFrom.modelName}` : '新建常用配置'}</DialogTitle>
        <DialogContent sx={{ bgcolor: '#f8fafc' }}>
          <Box display="grid" gap={2} mt={1}>
            <FormSection title="基础信息" subtitle="决定这个配置归属哪个泵壳模板">
              <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }} gap={2}>
                <TextField label="配置名称" value={form.modelName} onChange={e => updateField('modelName', e.target.value)} required size="small" />
                <FormControl size="small" required>
                  <InputLabel>共用泵壳模板</InputLabel>
                  <Select value={form.templateId} label="共用泵壳模板" onChange={e => updateField('templateId', e.target.value)}>
                    {templates.map(t => <MenuItem key={entityId(t)} value={String(entityId(t))}>{t.shellModel}</MenuItem>)}
                  </Select>
                </FormControl>
              </Box>
            </FormSection>

            <FormSection title="线圈配置" subtitle="用于新建配方时带入线圈规格、片数和材质">
              <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr 1fr' }} gap={2}>
                <FormControl size="small">
                  <InputLabel>线圈规格</InputLabel>
                  <Select value={form.coilSpec} label="线圈规格" onChange={e => { updateField('coilSpec', e.target.value); updateField('coilSheets', ''); }}>
                    <MenuItem value=""><em>不预设</em></MenuItem>
                    {coilSpecs.map(s => <MenuItem key={s.spec} value={s.spec}>{s.spec}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl size="small">
                  <InputLabel>材质</InputLabel>
                  <Select value={form.coilMaterial} label="材质" onChange={e => updateField('coilMaterial', e.target.value)}>
                    {materialOptions.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField label="线圈片数" type="number" value={form.coilSheets} onChange={e => updateField('coilSheets', e.target.value)} size="small" />
              </Box>
            </FormSection>

            <FormSection title="机筒与长螺丝" subtitle="长螺丝长度会按机筒长度加补偿长度自动推导">
              <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }} gap={2}>
                <TextField label="机筒长度" type="number" value={form.barrelLength} onChange={e => updateField('barrelLength', e.target.value)} size="small" helperText="mm" />
                <TextField label="长螺丝补偿长度" type="number" value={form.longScrewExtraLength} onChange={e => updateField('longScrewExtraLength', e.target.value)} size="small" helperText="长螺丝长度 = 不锈钢机筒长度 + 补偿长度" />
              </Box>
            </FormSection>

            <FormSection title="叶轮参数" subtitle="作为技术参考带入配方技术档案">
              <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: 'repeat(4, 1fr)' }} gap={2}>
                <TextField label="叶轮型号" value={form.impellerModel} onChange={e => updateField('impellerModel', e.target.value)} size="small" placeholder="如 400" />
                <TextField label="叶轮厚度" type="number" value={form.impellerThickness} onChange={e => updateField('impellerThickness', e.target.value)} size="small" helperText="mm" />
                <TextField label="叶轮直径" type="number" value={form.impellerDiameter} onChange={e => updateField('impellerDiameter', e.target.value)} size="small" helperText="mm" />
                <TextField label="叶片数" type="number" value={form.impellerBladeCount} onChange={e => updateField('impellerBladeCount', e.target.value)} size="small" />
              </Box>
            </FormSection>

            <FormSection title="备注与自定义字段" subtitle="用于记录客户或型号特有参数">
              <Box display="grid" gap={1.5}>
                <TextField label="备注" value={form.note} onChange={e => updateField('note', e.target.value)} size="small" />
                {form.customFields.map(field => (
                  <Box key={field.id} display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr auto' }} gap={1} alignItems="center">
                    <TextField label="字段名称" value={field.label} onChange={e => updateCustomField(field.id, { label: e.target.value })} size="small" placeholder="如 扬程" />
                    <TextField label="字段值" value={field.value} onChange={e => updateCustomField(field.id, { value: e.target.value })} size="small" placeholder="如 10m" />
                    <IconButton color="error" aria-label="删除自定义字段" onClick={() => removeCustomField(field.id)}><DeleteIcon size={18} /></IconButton>
                  </Box>
                ))}
                <Box>
                  <Button variant="outlined" size="small" startIcon={<AddIcon size={16} />} onClick={addCustomField}>新增字段</Button>
                </Box>
              </Box>
            </FormSection>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button variant="contained" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
