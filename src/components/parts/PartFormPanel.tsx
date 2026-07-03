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
import { Part } from '../../types';
import { colors, gradients } from '../../utils/theme';
import { proxyRequest } from '../../utils/api';
import { BUILTIN_CATEGORIES, getCatIcon } from './partsConstants';
import { DEFAULT_FLOAT_ACCESSORY_DELTA, wireOptionsFromParts } from '../../utils/businessRules';
import {
  DEFAULT_STANDARD_CABLE_ACCESSORY_NAME,
  DEFAULT_XINJIE_CABLE_ACCESSORY_NAME,
  WIRE_MODE_CONFIG,
  buildCableAccessorySettingsValue,
  buildPartNotes,
  finalPartModel,
  isCapacitorCategory,
  modelFieldsFromPart,
  parseCableAccessoryMeta,
  parseFloatAccessoryDelta,
  parsePumpShellMeta,
  parseScrewPricingMetaFromNotes,
  validatePartForm,
} from '../../utils/partFormRules';

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
  const isFloatMode = category === '浮球';
  const isCableMode = category === '电缆线';
  const [standardCableAccessoryFee, setStandardCableAccessoryFee] = useState('');
  const [xinjieCableAccessoryFee, setXinjieCableAccessoryFee] = useState('');
  const [standardCableAccessoryName, setStandardCableAccessoryName] = useState(DEFAULT_STANDARD_CABLE_ACCESSORY_NAME);
  const [xinjieCableAccessoryName, setXinjieCableAccessoryName] = useState(DEFAULT_XINJIE_CABLE_ACCESSORY_NAME);
  const [floatAccessoryDelta, setFloatAccessoryDelta] = useState(String(DEFAULT_FLOAT_ACCESSORY_DELTA));

  // ── 螺丝参数化计价 ──
  const isScrewMode = category === '螺丝';
  const [screwPricingEnabled, setScrewPricingEnabled] = useState(false);
  const [screwDiameter, setScrewDiameter] = useState('6');

  // ── 电容结构化输入 ──
  const [capacitorUf, setCapacitorUf] = useState('');
  const isCapacitorMode = isCapacitorCategory(category);

  /** 线径下拉选项（已有数据库中的线径，可手工录入新值） */
  const wireGaugeOptions = useMemo(() => {
    if (!wirePrefix) return [];
    return wireOptionsFromParts(parts, wirePrefix);
  }, [wirePrefix, parts]);

  // ── 泵壳不锈钢机筒扩展属性 ──
  const [isStainless, setIsStainless] = useState(false);
  const [openOffset, setOpenOffset] = useState('');

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

  useEffect(() => {
    if (editingPart) {
      setCategory(editingPart.category);
      const modelFields = modelFieldsFromPart(editingPart);
      setModel(modelFields.model);
      setWireGauge(modelFields.wireGauge);
      setCapacitorUf(modelFields.capacitorUf);
      setPrice(String(editingPart.price || ''));
      const cableAccessoryMeta = parseCableAccessoryMeta(editingPart.notes);
      setStandardCableAccessoryFee(cableAccessoryMeta.standardFee);
      setXinjieCableAccessoryFee(cableAccessoryMeta.xinjieFee);
      setStandardCableAccessoryName(cableAccessoryMeta.standardName);
      setXinjieCableAccessoryName(cableAccessoryMeta.xinjieName);
      const screwPricing = parseScrewPricingMetaFromNotes(editingPart.notes);
      setScrewPricingEnabled(!!screwPricing);
      setScrewDiameter(screwPricing?.diameter != null ? String(screwPricing.diameter) : '6');
      setSupplier(editingPart.supplier);
      setStock(String(editingPart.stock ?? ''));
      // 解析不锈钢及备用参数元数据
      const meta = parsePumpShellMeta(editingPart.notes);
      setIsStainless(meta.isStainless ?? false);
      setOpenOffset(meta.openOffset != null ? String(meta.openOffset) : (meta.openFactor != null ? String(meta.openFactor) : ''));
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
      setPrice(''); setStandardCableAccessoryFee(''); setXinjieCableAccessoryFee(''); setStandardCableAccessoryName(DEFAULT_STANDARD_CABLE_ACCESSORY_NAME); setXinjieCableAccessoryName(DEFAULT_XINJIE_CABLE_ACCESSORY_NAME); setSupplier(''); setStock('');
      setScrewPricingEnabled(false); setScrewDiameter('6');
      setIsStainless(false); setOpenOffset('');
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
        setStandardCableAccessoryName(config.standard?.name || DEFAULT_STANDARD_CABLE_ACCESSORY_NAME);
        setStandardCableAccessoryFee(String(config.standard?.fee ?? 0));
        setXinjieCableAccessoryName(config.xinjie?.name || DEFAULT_XINJIE_CABLE_ACCESSORY_NAME);
        setXinjieCableAccessoryFee(String(config.xinjie?.fee ?? 0));
      })
      .catch(() => { /* 兼容尚未初始化全局配置的旧环境 */ });
  }, [open, isCableMode]);

  useEffect(() => {
    if (!open || !isFloatMode) return;
    proxyRequest<{ success: boolean; data: { value: string } }>('/api/settings/float_accessory_delta')
      .then(({ data }) => {
        setFloatAccessoryDelta(String(parseFloatAccessoryDelta(data.value)));
      })
      .catch(() => setFloatAccessoryDelta(String(DEFAULT_FLOAT_ACCESSORY_DELTA)));
  }, [open, isFloatMode]);

  const validate = () => {
    return validatePartForm({
      category,
      model,
      price,
      supplier,
      isCapacitorMode,
      capacitorUf,
      isWireMode,
      wireGauge,
      isCableMode,
      standardCableAccessoryFee,
      xinjieCableAccessoryFee,
      standardCableAccessoryName,
      xinjieCableAccessoryName,
      isFloatMode,
      floatAccessoryDelta,
      isScrewMode,
      screwPricingEnabled,
      screwDiameter,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const continueEntry = submitter?.name === 'continueEntry' && !editingPart;
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    const finalModel = finalPartModel({ isCapacitorMode, capacitorUf, isWireMode, wirePrefix, wireGauge, model });

    // 重复检测：新增时检查同型号+类别是否已存在
    if (!editingPart) {
      const dup = parts.find(p => p.model === finalModel && p.category === category);
      if (dup && !confirm(`型号「${finalModel}」的${category}已存在（供应商: ${dup.supplier}），是否仍要新增？`)) {
        return;
      }
    }

    const notes = buildPartNotes({
      category,
      isCableMode,
      isScrewMode,
      isStainless,
      openOffset,
      defaultUpperBearing,
      defaultLowerBearing,
      defaultOilSealDia,
      defaultBearingSpan,
      defaultImpellerDia,
      defaultImpellerSpan,
      defaultImpellerDepth,
      defaultThreadLength,
      defaultThreadDia,
      defaultStackOffset,
      standardCableAccessoryFee,
      xinjieCableAccessoryFee,
      standardCableAccessoryName,
      xinjieCableAccessoryName,
      screwPricingEnabled,
      screwDiameter,
    });
    if (isCableMode) {
      await proxyRequest('/api/settings/cable_accessories', {
        method: 'PUT',
        body: JSON.stringify({ value: buildCableAccessorySettingsValue({ standardCableAccessoryName, standardCableAccessoryFee, xinjieCableAccessoryName, xinjieCableAccessoryFee }) }),
      });
    }
    if (isFloatMode) {
      await proxyRequest('/api/settings/float_accessory_delta', {
        method: 'PUT',
        body: JSON.stringify({ value: floatAccessoryDelta ? parseFloat(floatAccessoryDelta) : 0 }),
      });
    }
    await onSave({
      model: finalModel, category, price: parseFloat(price) || 0,
      supplier: supplier.trim(), stock: parseInt(stock) || 0,
      notes: notes ? JSON.stringify(notes) : '',
    }, { continueEntry });
    if (!editingPart) {
      setModel(''); setWireGauge(''); setCapacitorUf(''); setPrice(''); setStandardCableAccessoryFee(''); setXinjieCableAccessoryFee(''); setStandardCableAccessoryName(DEFAULT_STANDARD_CABLE_ACCESSORY_NAME); setXinjieCableAccessoryName(DEFAULT_XINJIE_CABLE_ACCESSORY_NAME); setFloatAccessoryDelta(String(DEFAULT_FLOAT_ACCESSORY_DELTA)); setStock('');
      if (!continueEntry) {
        setCategory(''); setSupplier('');
        setIsStainless(false); setOpenOffset('');
        setDefaultUpperBearing(''); setDefaultLowerBearing(''); setDefaultOilSealDia(''); setDefaultBearingSpan('');
        setDefaultImpellerDia(''); setDefaultImpellerSpan(''); setDefaultImpellerDepth(''); setDefaultThreadLength(''); setDefaultThreadDia(''); setDefaultStackOffset('');
        setScrewPricingEnabled(false); setScrewDiameter('6');
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
            {isFloatMode && (
              <TextField
                id="part-float-accessory-delta-input"
                label="新界式加价"
                type="number"
                value={floatAccessoryDelta}
                onChange={(e) => setFloatAccessoryDelta(e.target.value)}
                placeholder="0.60"
                fullWidth
                size="small"
                inputProps={{ step: 0.01, min: 0 }}
                InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
                error={!!errors.floatAccessoryDelta}
                helperText={errors.floatAccessoryDelta || (price ? `新界式：¥${((parseFloat(price) || 0) + (parseFloat(floatAccessoryDelta) || 0)).toFixed(2)}` : '普通铜套录入单价，新界式自动加价')}
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
          {isScrewMode && (
            <Box
              sx={{
                p: 1.5, borderRadius: 2, border: '1px solid',
                borderColor: screwPricingEnabled ? colors.amber.border : 'divider',
                bgcolor: screwPricingEnabled ? colors.amber.bg : 'action.hover',
              }}
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={screwPricingEnabled}
                    onChange={(e) => setScrewPricingEnabled(e.target.checked)}
                    size="small"
                    color="warning"
                  />
                }
                label={<Typography variant="body2" fontWeight={700}>按长度自动计价</Typography>}
                sx={{ m: 0 }}
              />
              <Collapse in={screwPricingEnabled}>
                <Stack spacing={1.5} mt={1.5}>
                  <Typography variant="caption" color="text.secondary">
                    单价 ≈ 0.00424 × 螺丝长度 - 0.198
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    螺丝长度取自目标型号，例如 6*195 中的 195；这里只设置用于匹配的直径。
                  </Typography>
                  <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }} gap={1.5}>
                    <TextField
                      label="匹配直径"
                      type="number"
                      size="small"
                      value={screwDiameter}
                      onChange={(e) => setScrewDiameter(e.target.value)}
                      error={!!errors.screwDiameter}
                      helperText={errors.screwDiameter || '例如填 6，可匹配 6*195'}
                      InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                  </Box>
                </Stack>
              </Collapse>
            </Box>
          )}
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
              </Box>

              {/* 转子出图备用参数区块 */}
              <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid divider', bgcolor: 'action.hover' }}>
                <Typography variant="body2" fontWeight={700} color="text.secondary" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <span style={{ fontSize: '1.2rem' }}>⚙️</span> 转子出图备用参数 (可选)
                  </Typography>
                <Stack spacing={1.5}>
                  <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1.5}>
                    <TextField
                      id="part-open-offset-input"
                      size="small"
                      fullWidth
                      label="开档偏移量"
                      type="number"
                      value={openOffset}
                      onChange={(e) => setOpenOffset(e.target.value)}
                      InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{ step: 0.1 }}
                      placeholder={isStainless ? '开档 = 机筒长度 - 此值' : '可选'}
                    />
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
