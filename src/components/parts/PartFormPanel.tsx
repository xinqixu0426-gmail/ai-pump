import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box, Typography, Paper, Chip, TextField, Button, IconButton,
  FormControl, InputLabel, Select, MenuItem, Stack, Tooltip,
  Collapse, InputAdornment, Autocomplete, Switch, FormControlLabel, Avatar
} from '@mui/material';
import {
  Plus as AddIcon, Edit3 as EditIcon, Save as SaveIcon,
  X as CancelIcon, Package as InventoryIcon, Settings as SettingsIcon
} from 'lucide-react';
import { Part, PumpShellMeta } from '../../types';
import { colors, gradients } from '../../utils/theme';
import { proxyRequest } from '../../utils/api';
import { BUILTIN_CATEGORIES, getCatIcon } from './partsConstants';

// ─── 零件表单面板 ─────────────────────────────────────

interface PartFormPanelProps {
  editingPart: Part | null;
  onSave: (part: Omit<Part, 'Id'>, options?: { continueEntry?: boolean }) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  allCategories: string[];
  customCategories: string[];
  onManageCategories: () => void;
  supplierOptions: string[];
  parts: Part[];
  open?: boolean;
}

/** 线径模式配置：类别 → 固定前缀 */
const WIRE_MODE_CONFIG: Record<string, string> = {
  '浮球': '浮球-线径',
  '电缆线': '电缆-线径',
};

/** 电容模式：类别集合 */
const CAPACITOR_CATEGORIES = new Set(['电容']);

/** 预置常用线径 */
const DEFAULT_WIRE_GAUGES = ['0.35', '0.40', '0.45', '0.50', '0.55', '0.60', '0.65', '0.70', '0.75', '0.80', '0.85', '0.90', '0.95', '1.00', '1.18', '1.50', '2.50', '4.00'];

export default function PartFormPanel({ editingPart, onSave, onCancel, saving, allCategories, onManageCategories, supplierOptions, parts, open }: PartFormPanelProps) {
  const [model, setModel] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [supplier, setSupplier] = useState('');
  const [stock, setStock] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const modelInputRef = useRef<HTMLInputElement>(null);

  // ── 线径结构化输入 ──
  const [wireGauge, setWireGauge] = useState('');

  /** 当前类别是否为线径模式 */
  const wirePrefix = WIRE_MODE_CONFIG[category] || '';
  const isWireMode = !!wirePrefix;
  const isCableMode = category === '电缆线';
  const [standardCableAccessoryFee, setStandardCableAccessoryFee] = useState('');
  const [xinjieCableAccessoryFee, setXinjieCableAccessoryFee] = useState('');
  const [standardCableAccessoryName, setStandardCableAccessoryName] = useState('普通铜套');
  const [xinjieCableAccessoryName, setXinjieCableAccessoryName] = useState('新界式');

  // ── 电容结构化输入 ──
  const [capacitorUf, setCapacitorUf] = useState('');
  const isCapacitorMode = CAPACITOR_CATEGORIES.has(category);

  /** 线径下拉选项（预置 + 已有数据库中的线径） */
  const wireGaugeOptions = useMemo(() => {
    if (!wirePrefix) return [];
    const set = new Set<string>(DEFAULT_WIRE_GAUGES);
    parts.forEach(p => {
      if (p.model.startsWith(wirePrefix)) {
        const w = p.model.replace(wirePrefix, '');
        if (w) set.add(w);
      }
    });
    return Array.from(set).sort((a, b) => parseFloat(a) - parseFloat(b));
  }, [wirePrefix, parts]);

  // ── 泵壳不锈钢机筒扩展属性 ──
  const [isStainless, setIsStainless] = useState(false);
  const [barrelLength, setBarrelLength] = useState('');
  const [openOffset, setOpenOffset] = useState('');
  const [barrelLengthPresets, setBarrelLengthPresets] = useState<number[]>([150, 170, 190, 210, 230]);

  // ── 泵壳转子出图备用参数 ──
  const [defaultUpperBearing, setDefaultUpperBearing] = useState('');
  const [defaultLowerBearing, setDefaultLowerBearing] = useState('');
  const [defaultOilSealDia, setDefaultOilSealDia] = useState('');
  const [defaultBearingSpan, setDefaultBearingSpan] = useState('');
  const [defaultImpellerDia, setDefaultImpellerDia] = useState('');
  const [defaultImpellerSpan, setDefaultImpellerSpan] = useState('');
  const [defaultImpellerDepth, setDefaultImpellerDepth] = useState('');
  const [defaultThreadLength, setDefaultThreadLength] = useState('');
  const [defaultThreadDia, setDefaultThreadDia] = useState('');
  const [defaultStackOffset, setDefaultStackOffset] = useState('');

  const isPumpShell = category === '泵壳';

  /** 解析 notes JSON */
  function parseMeta(notes?: string): PumpShellMeta {
    if (!notes) return { isStainless: false };
    try { return JSON.parse(notes) as PumpShellMeta; } catch { return { isStainless: false }; }
  }

  function parseCableAccessoryMeta(notes?: string): { standardFee: string; xinjieFee: string; standardName: string; xinjieName: string } {
    if (!notes) return { standardFee: '', xinjieFee: '', standardName: '普通铜套', xinjieName: '新界式' };
    try {
      const meta = JSON.parse(notes);
      const legacyFee = Number(meta?.cableAccessoryFee);
      const standardFee = Number(meta?.cableAccessoryFees?.standard);
      const xinjieFee = Number(meta?.cableAccessoryFees?.xinjie);
      return {
        standardFee: Number.isFinite(standardFee) && standardFee >= 0
          ? String(standardFee)
          : (Number.isFinite(legacyFee) && legacyFee >= 0 ? String(legacyFee) : ''),
        xinjieFee: Number.isFinite(xinjieFee) && xinjieFee >= 0 ? String(xinjieFee) : '',
        standardName: typeof meta?.cableAccessoryNames?.standard === 'string' && meta.cableAccessoryNames.standard.trim()
          ? meta.cableAccessoryNames.standard.trim()
          : '普通铜套',
        xinjieName: typeof meta?.cableAccessoryNames?.xinjie === 'string' && meta.cableAccessoryNames.xinjie.trim()
          ? meta.cableAccessoryNames.xinjie.trim()
          : '新界式',
      };
    } catch {
      return { standardFee: '', xinjieFee: '', standardName: '普通铜套', xinjieName: '新界式' };
    }
  }

  useEffect(() => {
    if (editingPart) {
      setCategory(editingPart.category);
      // 线径模式：拆分 model 为 prefix + wireGauge
      const editPrefix = WIRE_MODE_CONFIG[editingPart.category] || '';
      if (editPrefix && editingPart.model.startsWith(editPrefix)) {
        setModel(editingPart.model);
        setWireGauge(editingPart.model.replace(editPrefix, ''));
      } else if (CAPACITOR_CATEGORIES.has(editingPart.category)) {
        // 电容模式：从 "12μF" / "12uF" / "12vf" 中提取数值
        setModel(editingPart.model);
        const num = editingPart.model.replace(/[uμUvVfF\s]/g, '').trim();
        setCapacitorUf(num);
      } else {
        setModel(editingPart.model);
        setWireGauge('');
      }
      setPrice(String(editingPart.price || ''));
      const cableAccessoryMeta = parseCableAccessoryMeta(editingPart.notes);
      setStandardCableAccessoryFee(cableAccessoryMeta.standardFee);
      setXinjieCableAccessoryFee(cableAccessoryMeta.xinjieFee);
      setStandardCableAccessoryName(cableAccessoryMeta.standardName);
      setXinjieCableAccessoryName(cableAccessoryMeta.xinjieName);
      setSupplier(editingPart.supplier);
      setStock(String(editingPart.stock ?? ''));
      // 解析不锈钢及备用参数元数据
      const meta = parseMeta(editingPart.notes);
      setIsStainless(meta.isStainless ?? false);
      setBarrelLength(meta.barrelLength != null ? String(meta.barrelLength) : '');
      setOpenOffset(meta.openOffset != null ? String(meta.openOffset) : (meta.openFactor != null ? String(meta.openFactor) : ''));
      setBarrelLengthPresets(meta.barrelLengthPresets && meta.barrelLengthPresets.length > 0 ? meta.barrelLengthPresets : [150, 170, 190, 210, 230]);
      setDefaultUpperBearing(meta.defaultUpperBearing || '');
      setDefaultLowerBearing(meta.defaultLowerBearing || '');
      setDefaultOilSealDia(meta.defaultOilSealDia != null ? String(meta.defaultOilSealDia) : '');
      setDefaultBearingSpan(meta.defaultBearingSpan != null ? String(meta.defaultBearingSpan) : '');
      setDefaultImpellerDia(meta.defaultImpellerDia != null ? String(meta.defaultImpellerDia) : '');
      setDefaultImpellerSpan(meta.defaultImpellerSpan != null ? String(meta.defaultImpellerSpan) : '');
      setDefaultImpellerDepth(meta.defaultImpellerDepth != null ? String(meta.defaultImpellerDepth) : '');
      setDefaultThreadLength(meta.defaultThreadLength != null ? String(meta.defaultThreadLength) : '');
      setDefaultThreadDia(meta.defaultThreadDia != null ? String(meta.defaultThreadDia) : '');
      setDefaultStackOffset(meta.defaultStackOffset != null ? String(meta.defaultStackOffset) : '');
    } else {
      setModel(''); setCategory(''); setWireGauge(''); setCapacitorUf('');
      setPrice(''); setStandardCableAccessoryFee(''); setXinjieCableAccessoryFee(''); setStandardCableAccessoryName('普通铜套'); setXinjieCableAccessoryName('新界式'); setSupplier(''); setStock('');
      setIsStainless(false); setBarrelLength(''); setOpenOffset(''); setBarrelLengthPresets([150, 170, 190, 210, 230]);
      setDefaultUpperBearing(''); setDefaultLowerBearing(''); setDefaultOilSealDia(''); setDefaultBearingSpan('');
      setDefaultImpellerDia(''); setDefaultImpellerSpan(''); setDefaultImpellerDepth(''); setDefaultThreadLength(''); setDefaultThreadDia(''); setDefaultStackOffset('');
      if (open) {
        setTimeout(() => modelInputRef.current?.focus(), 100);
      }
    }
    setErrors({});
  }, [editingPart, open]);

  useEffect(() => {
    if (!open || !isCableMode) return;
    proxyRequest<{ success: boolean; data: { value: string } }>('/api/settings/cable_accessories')
      .then(({ data }) => {
        const config = JSON.parse(data.value);
        setStandardCableAccessoryName(config.standard?.name || '普通铜套');
        setStandardCableAccessoryFee(String(config.standard?.fee ?? 0));
        setXinjieCableAccessoryName(config.xinjie?.name || '新界式');
        setXinjieCableAccessoryFee(String(config.xinjie?.fee ?? 0));
      })
      .catch(() => { /* 兼容尚未初始化全局配置的旧环境 */ });
  }, [open, isCableMode]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (isCapacitorMode) {
      if (!capacitorUf.trim() || isNaN(Number(capacitorUf)) || Number(capacitorUf) <= 0) e.model = '请输入有效的电容值 (μF)';
    } else if (isWireMode) {
      if (!wireGauge.trim()) e.model = '请选择线径';
    } else {
      if (!model.trim()) e.model = '型号不能为空';
    }
    if (!category) e.category = '请选择类别';
    if (!price || isNaN(Number(price)) || Number(price) < 0) e.price = '请输入有效价格';
    if (isCableMode && standardCableAccessoryFee && (isNaN(Number(standardCableAccessoryFee)) || Number(standardCableAccessoryFee) < 0)) e.standardCableAccessoryFee = '请输入有效的普通铜套配件费';
    if (isCableMode && xinjieCableAccessoryFee && (isNaN(Number(xinjieCableAccessoryFee)) || Number(xinjieCableAccessoryFee) < 0)) e.xinjieCableAccessoryFee = '请输入有效的新界式铜套配件费';
    if (isCableMode && !standardCableAccessoryName.trim()) e.standardCableAccessoryName = '请输入第一种配件费名称';
    if (isCableMode && !xinjieCableAccessoryName.trim()) e.xinjieCableAccessoryName = '请输入第二种配件费名称';
    if (!supplier.trim()) e.supplier = '供应商不能为空';
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const continueEntry = submitter?.name === 'continueEntry' && !editingPart;
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    // 结构化模式下自动拼接 model
    const finalModel = isCapacitorMode
      ? `${capacitorUf.trim()}μF`
      : isWireMode ? `${wirePrefix}${wireGauge.trim()}` : model.trim();

    // 重复检测：新增时检查同型号+类别是否已存在
    if (!editingPart) {
      const dup = parts.find(p => p.model === finalModel && p.category === category);
      if (dup && !confirm(`型号「${finalModel}」的${category}已存在（供应商: ${dup.supplier}），是否仍要新增？`)) {
        return;
      }
    }

    // 构建 notes JSON
    let notes: PumpShellMeta | { cableAccessoryFee: number; cableAccessoryFees: { standard: number; xinjie: number }; cableAccessoryNames: { standard: string; xinjie: string } } | null = null;
    if (category === '泵壳') {
      notes = { 
          isStainless, 
          barrelLength: barrelLength ? parseFloat(barrelLength) : undefined, 
          openOffset: openOffset ? parseFloat(openOffset) : undefined,
          barrelLengthPresets,
          defaultUpperBearing: defaultUpperBearing || undefined,
          defaultLowerBearing: defaultLowerBearing || undefined,
          defaultOilSealDia: defaultOilSealDia ? parseFloat(defaultOilSealDia) : undefined,
          defaultBearingSpan: defaultBearingSpan ? parseFloat(defaultBearingSpan) : undefined,
          defaultImpellerDia: defaultImpellerDia ? parseFloat(defaultImpellerDia) : undefined,
          defaultImpellerSpan: defaultImpellerSpan ? parseFloat(defaultImpellerSpan) : undefined,
          defaultImpellerDepth: defaultImpellerDepth ? parseFloat(defaultImpellerDepth) : undefined,
          defaultThreadLength: defaultThreadLength ? parseFloat(defaultThreadLength) : undefined,
          defaultThreadDia: defaultThreadDia ? parseFloat(defaultThreadDia) : undefined,
          defaultStackOffset: defaultStackOffset ? parseFloat(defaultStackOffset) : undefined
        };
    } else if (isCableMode) {
      const standard = standardCableAccessoryFee ? parseFloat(standardCableAccessoryFee) : 0;
      notes = {
        cableAccessoryFee: standard,
        cableAccessoryFees: {
          standard,
          xinjie: xinjieCableAccessoryFee ? parseFloat(xinjieCableAccessoryFee) : 0,
        },
        cableAccessoryNames: {
          standard: standardCableAccessoryName.trim(),
          xinjie: xinjieCableAccessoryName.trim(),
        },
      };
    }
    if (isCableMode) {
      await proxyRequest('/api/settings/cable_accessories', {
        method: 'PUT',
        body: JSON.stringify({ value: {
          standard: { name: standardCableAccessoryName.trim(), fee: standardCableAccessoryFee ? parseFloat(standardCableAccessoryFee) : 0 },
          xinjie: { name: xinjieCableAccessoryName.trim(), fee: xinjieCableAccessoryFee ? parseFloat(xinjieCableAccessoryFee) : 0 },
        } }),
      });
    }
    await onSave({
      model: finalModel, category, price: parseFloat(price) || 0,
      supplier: supplier.trim(), stock: parseInt(stock) || 0,
      notes: notes ? JSON.stringify(notes) : '',
    }, { continueEntry });
    if (!editingPart) {
      setModel(''); setWireGauge(''); setCapacitorUf(''); setPrice(''); setStandardCableAccessoryFee(''); setXinjieCableAccessoryFee(''); setStandardCableAccessoryName('普通铜套'); setXinjieCableAccessoryName('新界式'); setStock('');
      if (!continueEntry) {
        setCategory(''); setSupplier('');
        setIsStainless(false); setBarrelLength(''); setOpenOffset(''); setBarrelLengthPresets([150, 170, 190, 210, 230]);
        setDefaultUpperBearing(''); setDefaultLowerBearing(''); setDefaultOilSealDia(''); setDefaultBearingSpan('');
        setDefaultImpellerDia(''); setDefaultImpellerSpan(''); setDefaultImpellerDepth(''); setDefaultThreadLength(''); setDefaultThreadDia(''); setDefaultStackOffset('');
      }
      if (open) {
        setTimeout(() => modelInputRef.current?.focus(), 100);
      }
    }
  };

  const isEditing = !!editingPart;

  return (
    <Paper
      elevation={0}
      sx={{
        p: 3, borderRadius: 3, height: '100%',
        border: isEditing ? `2px solid ${colors.blue.border}` : '1px solid',
        borderColor: isEditing ? colors.blue.border : 'divider',
        position: 'relative', overflow: 'hidden',
        '&::before': {
          content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: isEditing ? gradients.revenue : gradients.parts,
        },
      }}
    >
      <Box display="flex" alignItems="center" gap={1.5} mb={2.5}>
        <Avatar sx={{ width: 36, height: 36, background: isEditing ? gradients.revenue : gradients.parts }}>
          {isEditing ? <EditIcon size={18} /> : <AddIcon size={18} />}
        </Avatar>
        <Box>
          <Typography variant="subtitle1" fontWeight={800}>{isEditing ? '修改零件' : '录入零件'}</Typography>
          <Typography variant="caption" color="text.secondary">{isEditing ? `ID: ${editingPart.Id}` : '填写下方表单新增'}</Typography>
        </Box>
      </Box>

      <Box component="form" id="part-form" onSubmit={handleSubmit}>
        <Stack spacing={2}>
          <Box display="flex" gap={1} alignItems="flex-start">
            <FormControl fullWidth size="small" required error={!!errors.category}>
              <InputLabel>类别</InputLabel>
              <Select
                id="part-category-select"
                value={allCategories.includes(category) ? category : (category || '')}
                label="类别"
                onChange={(e) => { setCategory(e.target.value); setErrors((prev) => ({ ...prev, category: '' })); }}
              >
                <MenuItem value=""><em>请选择类别</em></MenuItem>
                <MenuItem disabled sx={{ fontSize: '0.7rem', color: 'text.disabled', letterSpacing: 0.5, py: 0.3 }}>── 内置类别 ──</MenuItem>
                {BUILTIN_CATEGORIES.map((cat) => (
                  <MenuItem key={cat} value={cat}>{getCatIcon(cat)} {cat}</MenuItem>
                ))}
                <MenuItem disabled sx={{ fontSize: '0.7rem', color: 'text.disabled', letterSpacing: 0.5, py: 0.3 }}>── 自定义类别 ──</MenuItem>
                {allCategories.filter((c) => !BUILTIN_CATEGORIES.includes(c)).length === 0
                  ? <MenuItem disabled sx={{ fontStyle: 'italic', fontSize: '0.8rem' }}>（暂无，点击 ⚙ 添加）</MenuItem>
                  : allCategories.filter((c) => !BUILTIN_CATEGORIES.includes(c)).map((cat, idx) => (
                      <MenuItem key={cat} value={cat}>
                        <Box component="span" sx={{ mr: 0.5 }}>🏷️</Box> {cat}
                        <Box component="span" sx={{ ml: 0.5, fontSize: '0.65rem', opacity: 0.4 }}>#{idx + 1}</Box>
                      </MenuItem>
                    ))
                }
              </Select>
              {errors.category && <Typography variant="caption" color="error" sx={{ ml: 1.5, mt: 0.3 }}>{errors.category}</Typography>}
            </FormControl>
            <Tooltip title="管理类别（增删改）">
              <IconButton
                id="manage-categories-btn"
                aria-label="管理零件类别"
                size="small"
                onClick={onManageCategories}
                sx={{ mt: 0.5, flexShrink: 0, color: colors.purple.main, bgcolor: colors.purple.bg, border: `1px solid ${colors.purple.border}`, '&:hover': { bgcolor: colors.purple.light } }}
              >
                <SettingsIcon size={18} />
              </IconButton>
            </Tooltip>
          </Box>
          {isCapacitorMode ? (
            /* 电容结构化输入模式：仅允许数字 + μF */
            <Box display="flex" gap={1} alignItems="flex-start">
              <Chip
                label="μF"
                size="small"
                sx={{
                  mt: 0.8, fontWeight: 700, fontSize: '0.85rem',
                  bgcolor: colors.amber.bg, color: colors.amber.text,
                  border: '1px solid', borderColor: colors.amber.border,
                }}
              />
              <TextField
                id="part-model-input"
                label="电容值"
                type="number"
                value={capacitorUf}
                onChange={(e) => setCapacitorUf(e.target.value)}
                placeholder="如 12"
                required
                fullWidth
                size="small"
                error={!!errors.model}
                helperText={errors.model || `最终型号：${capacitorUf ? capacitorUf.trim() + 'μF' : '?'}`}
                inputProps={{ min: 0.1, step: 0.1 }}
                InputProps={{ endAdornment: <InputAdornment position="end">μF</InputAdornment> }}
              />
            </Box>
          ) : isWireMode ? (
            /* 线径结构化输入模式 */
            <Box display="flex" gap={1} alignItems="flex-start">
              <Chip
                label={wirePrefix}
                size="small"
                sx={{
                  mt: 0.8, fontWeight: 700, fontSize: '0.85rem',
                  bgcolor: category === '浮球' ? '#fff1f2' : '#fdf4ff',
                  color: category === '浮球' ? '#be123c' : '#701a75',
                  border: '1px solid',
                  borderColor: category === '浮球' ? '#fecdd3' : '#f0abfc',
                }}
              />
              <Autocomplete
                freeSolo
                disableClearable
                options={wireGaugeOptions}
                value={wireGauge}
                onInputChange={(_e, v) => setWireGauge(v || '')}
                sx={{ flex: 1 }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="线径"
                    placeholder="选择或输入线径"
                    required
                    size="small"
                    error={!!errors.model}
                    helperText={errors.model || (`最终型号：${wirePrefix}${wireGauge || '?'}`)}
                  />
                )}
              />
            </Box>
          ) : (
            /* 普通型号输入 */
            <TextField
              inputRef={modelInputRef}
              id="part-model-input" label="型号" value={model} onChange={(e) => setModel(e.target.value)}
              placeholder="如：6202-2RS" required fullWidth size="small"
              error={!!errors.model} helperText={errors.model}
            />
          )}
          {isCableMode && (
            <>
              <Typography variant="caption" color="text.secondary">
                铜套配件费为全局配置，修改后自动应用于所有电缆线径
              </Typography>
              <Box display="flex" gap={1.5} alignItems="flex-start">
                <TextField
                  id="part-standard-cable-accessory-name-input"
                  label="第一种配件费名称"
                  value={standardCableAccessoryName}
                  onChange={(e) => setStandardCableAccessoryName(e.target.value)}
                  placeholder="如：普通铜套"
                  fullWidth
                  size="small"
                  error={!!errors.standardCableAccessoryName}
                  helperText={errors.standardCableAccessoryName || ' '}
                  sx={{ '& .MuiFormHelperText-root': { mx: 0 }, flex: 1 }}
                />
                <TextField
                  id="part-xinjie-cable-accessory-name-input"
                  label="第二种配件费名称"
                  value={xinjieCableAccessoryName}
                  onChange={(e) => setXinjieCableAccessoryName(e.target.value)}
                  placeholder="如：新界式"
                  fullWidth
                  size="small"
                  error={!!errors.xinjieCableAccessoryName}
                  helperText={errors.xinjieCableAccessoryName || ' '}
                  sx={{ '& .MuiFormHelperText-root': { mx: 0 }, flex: 1 }}
                />
              </Box>
            </>
          )}
          <Box display="flex" gap={1.5} alignItems="flex-start">
            <TextField
              id="part-price-input" label="单价（元）" type="number" value={price}
              onChange={(e) => setPrice(e.target.value)} placeholder="0.00"
              required fullWidth size="small"
              inputProps={{ step: 0.01, min: 0 }}
              InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
              error={!!errors.price} helperText={errors.price || ' '}
              sx={{ '& .MuiFormHelperText-root': { mx: 0 }, flex: 1 }}
            />
            {isCableMode && (
              <TextField
                id="part-standard-cable-accessory-fee-input"
                label={`${standardCableAccessoryName.trim() || '第一种'}配件费`}
                type="number"
                value={standardCableAccessoryFee}
                onChange={(e) => setStandardCableAccessoryFee(e.target.value)}
                placeholder="0.00"
                fullWidth
                size="small"
                inputProps={{ step: 0.01, min: 0 }}
                InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
                error={!!errors.standardCableAccessoryFee}
                helperText={errors.standardCableAccessoryFee || ' '}
                sx={{ '& .MuiFormHelperText-root': { mx: 0 }, flex: 1 }}
              />
            )}
            {isCableMode && (
              <TextField
                id="part-xinjie-cable-accessory-fee-input"
                label={`${xinjieCableAccessoryName.trim() || '第二种'}配件费`}
                type="number"
                value={xinjieCableAccessoryFee}
                onChange={(e) => setXinjieCableAccessoryFee(e.target.value)}
                placeholder="0.00"
                fullWidth
                size="small"
                inputProps={{ step: 0.01, min: 0 }}
                InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
                error={!!errors.xinjieCableAccessoryFee}
                helperText={errors.xinjieCableAccessoryFee || ' '}
                sx={{ '& .MuiFormHelperText-root': { mx: 0 }, flex: 1 }}
              />
            )}
            <TextField
              id="part-stock-input" label="库存数量" type="number" value={stock}
              onChange={(e) => setStock(e.target.value)} placeholder="0"
              fullWidth size="small" inputProps={{ min: 0, step: 1 }}
              InputProps={{
                startAdornment: <InputAdornment position="start"><InventoryIcon size={16} opacity={0.6} /></InputAdornment>
              }}
              sx={{ flex: 1 }}
            />
          </Box>
          <Autocomplete
            id="part-supplier-autocomplete"
            freeSolo
            options={supplierOptions}
            value={supplier}
            onInputChange={(_e, newValue) => {
              setSupplier(newValue ?? '');
              if (newValue) setErrors((prev) => ({ ...prev, supplier: '' }));
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                id="part-supplier-input"
                label="供应商"
                placeholder="搜索或输入新供应商"
                required
                size="small"
                error={!!errors.supplier}
                helperText={errors.supplier}
              />
            )}
          />

          {/* 泵壳不锈钢机筒扩展区块 */}
          {isPumpShell && (
            <>
              <Box
                sx={{
                  p: 1.5, borderRadius: 2, border: '1px solid',
                  borderColor: isStainless ? '#bae6fd' : 'divider',
                  bgcolor: isStainless ? '#f0f9ff' : 'action.hover',
                  transition: 'all 0.2s',
                }}
              >
                <FormControlLabel
                  control={
                    <Switch
                      id="part-stainless-switch"
                      checked={isStainless}
                      onChange={(e) => setIsStainless(e.target.checked)}
                      size="small"
                      color="info"
                    />
                  }
                  label={
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <Typography variant="body2" fontWeight={700} color={isStainless ? '#0369a1' : 'text.secondary'}>
                        不锈钢机筒
                      </Typography>
                      {isStainless && (
                        <Chip label="SS" size="small" sx={{ height: 16, fontSize: '0.6rem', fontWeight: 800, bgcolor: '#0284c7', color: 'white' }} />
                      )}
                    </Box>
                  }
                  sx={{ m: 0 }}
                />
                <Collapse in={isStainless}>
                  <Stack spacing={1.5} mt={1.5}>
                    <TextField
                      id="part-open-offset-input"
                      label="开档偏移量"
                      type="number"
                      size="small"
                      fullWidth
                      value={openOffset}
                      onChange={(e) => setOpenOffset(e.target.value)}
                      placeholder="开档 = 机筒长度 - 此值"
                      InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }}
                      inputProps={{ step: 0.1 }}
                    />
                    <TextField
                      id="part-barrel-length-input"
                      label="默认机筒长度"
                      type="number"
                      size="small"
                      fullWidth
                      value={barrelLength}
                      onChange={(e) => setBarrelLength(e.target.value)}
                      placeholder="可选，仅作参考默认值"
                      InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }}
                      inputProps={{ min: 0, step: 1 }}
                    />
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        常用长度预设 (供配方和出图时快速选择)
                      </Typography>
                      <Box display="flex" flexWrap="wrap" gap={1}>
                        {barrelLengthPresets.map((len, idx) => (
                          <Chip 
                            key={idx} 
                            label={`${len} mm`} 
                            size="small" 
                            onDelete={() => setBarrelLengthPresets(prev => prev.filter((_, i) => i !== idx))} 
                          />
                        ))}
                        <TextField 
                          size="small" 
                          placeholder="+ 添加" 
                          sx={{ width: 80, '& .MuiInputBase-root': { height: 24, fontSize: '0.75rem' } }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const val = parseFloat((e.target as HTMLInputElement).value);
                              if (!isNaN(val) && !barrelLengthPresets.includes(val)) {
                                setBarrelLengthPresets(prev => [...prev, val].sort((a, b) => a - b));
                              }
                              (e.target as HTMLInputElement).value = '';
                            }
                          }}
                        />
                      </Box>
                    </Box>
                  </Stack>
                </Collapse>
              </Box>

              {/* 转子出图备用参数区块 */}
              <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid divider', bgcolor: 'action.hover' }}>
                <Typography variant="body2" fontWeight={700} color="text.secondary" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <span style={{ fontSize: '1.2rem' }}>⚙️</span> 转子出图备用参数 (可选)
                </Typography>
                <Stack spacing={1.5}>
                  <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1.5}>
                    <FormControl size="small" fullWidth>
                      <InputLabel shrink>上轴承</InputLabel>
                      <Select notched value={defaultUpperBearing} onChange={(e) => setDefaultUpperBearing(e.target.value)} label="上轴承" displayEmpty>
                        <MenuItem value=""><em>(不预设)</em></MenuItem>
                        <MenuItem value="6201">6201</MenuItem>
                        <MenuItem value="6202">6202</MenuItem>
                        <MenuItem value="6203">6203</MenuItem>
                        <MenuItem value="6204">6204</MenuItem>
                        <MenuItem value="6205">6205</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" fullWidth>
                      <InputLabel shrink>下轴承</InputLabel>
                      <Select notched value={defaultLowerBearing} onChange={(e) => setDefaultLowerBearing(e.target.value)} label="下轴承" displayEmpty>
                        <MenuItem value=""><em>(不预设)</em></MenuItem>
                        <MenuItem value="6201">6201</MenuItem>
                        <MenuItem value="6202">6202</MenuItem>
                        <MenuItem value="6203">6203</MenuItem>
                        <MenuItem value="6204">6204</MenuItem>
                        <MenuItem value="6205">6205</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField size="small" fullWidth label="油封孔径" type="number" value={defaultOilSealDia} onChange={(e) => setDefaultOilSealDia(e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }} InputLabelProps={{ shrink: true }} placeholder="可选" />
                    <TextField size="small" fullWidth label="轴承开档" type="number" value={defaultBearingSpan} onChange={(e) => setDefaultBearingSpan(e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }} InputLabelProps={{ shrink: true }} placeholder={isStainless ? "SS机筒不填将自动算" : "可选"} />
                    <TextField size="small" fullWidth label="叶轮孔径" type="number" value={defaultImpellerDia} onChange={(e) => setDefaultImpellerDia(e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }} InputLabelProps={{ shrink: true }} placeholder="可选" />
                    <TextField size="small" fullWidth label="叶轮开档" type="number" value={defaultImpellerSpan} onChange={(e) => setDefaultImpellerSpan(e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }} InputLabelProps={{ shrink: true }} placeholder="可选" />
                    <TextField size="small" fullWidth label="叶轮厚度" type="number" value={defaultImpellerDepth} onChange={(e) => setDefaultImpellerDepth(e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }} InputLabelProps={{ shrink: true }} placeholder="可选" />
                    <TextField size="small" fullWidth label="转子定位" type="number" value={defaultStackOffset} onChange={(e) => setDefaultStackOffset(e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }} InputLabelProps={{ shrink: true }} placeholder="可选" />
                    <TextField size="small" fullWidth label="螺丝长度" type="number" value={defaultThreadLength} onChange={(e) => setDefaultThreadLength(e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }} InputLabelProps={{ shrink: true }} placeholder="可选" />
                    <TextField size="small" fullWidth label="螺纹直径" type="number" value={defaultThreadDia} onChange={(e) => setDefaultThreadDia(e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }} InputLabelProps={{ shrink: true }} placeholder="可选" />
                  </Box>
                </Stack>
              </Box>
            </>
          )}
          {/* 库存已经移到上方与单价同行 */}
          <Stack direction="row" spacing={1} pt={0.5}>
            <Button
              id="part-save-btn" type="submit" variant="contained" startIcon={<SaveIcon size={18} />}
              fullWidth disabled={saving}
              sx={{ background: isEditing ? gradients.revenue : gradients.parts, boxShadow: 'none', fontWeight: 700 }}
            >
              {saving ? '保存中...' : isEditing ? '保存修改' : '新增零件'}
            </Button>
            {!isEditing && (
              <Button
                id="part-save-continue-btn"
                name="continueEntry"
                type="submit"
                variant="outlined"
                startIcon={<AddIcon size={18} />}
                disabled={saving}
                sx={{ flexShrink: 0, fontWeight: 700 }}
              >
                保存并继续
              </Button>
            )}
            {isEditing && (
              <Button id="part-cancel-btn" variant="outlined" startIcon={<CancelIcon size={18} />} onClick={onCancel} sx={{ flexShrink: 0 }}>
                取消
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>
    </Paper>
  );
}

