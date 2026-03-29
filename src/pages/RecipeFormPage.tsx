import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Paper,
  Typography,
  Alert,
  Box,
  CircularProgress,
  TextField,
  Button,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Divider,
  Checkbox,
  FormControlLabel,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Stepper,
  Step,
  StepLabel,
  Chip,
  IconButton,
} from '@mui/material';
import {
  Save as SaveIcon,
  Add as AddIcon,
  ArrowBack as BackIcon,
  ArrowForward as NextIcon,
} from '@mui/icons-material';
import { Part, RecipePart } from '../types';
import { getAllParts, createRecipe } from '../utils/api';
import { buildPartsIndex, calculateRecipeCost } from '../utils/costCalculator';
import RecipePartRow from '../components/RecipePartRow';

const STEPS = ['基本信息', '必备配件', '选配 & 动态配置', '预览 & 保存'];

// 必备配件配置
const REQUIRED_PARTS = [
  { key: 'pumpShell', name: '泵壳' },
  { key: 'plateBearing', name: '花板轴承' },
  { key: 'cylinderBearing', name: '油缸轴承' },
  { key: 'mechanicalSeal', name: '机械油封' },
  { key: 'skeletonSeal', name: '骨架油封' },
  { key: 'rotor', name: '线圈转子' },
];

interface PartSelection {
  model: string;
  supplier: string;
  qty: number;
}

const REQUIRED_NAME_TO_KEY: Record<string, string> = {};
REQUIRED_PARTS.forEach(({ key, name }) => {
  REQUIRED_NAME_TO_KEY[name] = key;
});

const EMPTY_REQUIRED: Record<string, PartSelection> = {
  pumpShell: { model: '', supplier: '', qty: 1 },
  plateBearing: { model: '', supplier: '', qty: 1 },
  cylinderBearing: { model: '', supplier: '', qty: 1 },
  mechanicalSeal: { model: '', supplier: '', qty: 1 },
  skeletonSeal: { model: '', supplier: '', qty: 1 },
  rotor: { model: '', supplier: '', qty: 1 },
};

export default function RecipeFormPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const cloneFrom = (location.state as { cloneFrom?: { name: string; spec: string; partsJson: string } })?.cloneFrom;
  const cloneApplied = useRef(false);

  const [activeStep, setActiveStep] = useState(0);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Step 0 ──────────────────────────────────────────────
  const [recipeName, setRecipeName] = useState(cloneFrom?.name || '');
  const [recipeSpec, setRecipeSpec] = useState(cloneFrom?.spec || '');

  // ── Step 1: 必备配件 ─────────────────────────────────────
  const [requiredSelections, setRequiredSelections] = useState<Record<string, PartSelection>>(
    JSON.parse(JSON.stringify(EMPTY_REQUIRED))
  );

  // ── Step 2: 选配 + 动态配置 ──────────────────────────────
  const [optionalParts, setOptionalParts] = useState<Array<PartSelection & { id: number }>>([]);
  const nextOptionalId = useRef(1);

  const [hasFloat, setHasFloat] = useState(false);
  const [floatWire, setFloatWire] = useState('0.55');
  const [hasCable, setHasCable] = useState(false);
  const [cableLength, setCableLength] = useState('');
  const [cableWire, setCableWire] = useState('0.55');
  const [boxType, setBoxType] = useState('');

  // ── 数据加载 ─────────────────────────────────────────────
  const loadParts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAllParts();
      setParts(data);
    } catch {
      setError('加载零件数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadParts(); }, [loadParts]);

  // 复制配方时预填
  useEffect(() => {
    if (!cloneFrom || cloneApplied.current || parts.length === 0) return;
    cloneApplied.current = true;
    try {
      const cloneParts: RecipePart[] = JSON.parse(cloneFrom.partsJson);
      const newRequired = JSON.parse(JSON.stringify(EMPTY_REQUIRED));
      const newOptional: Array<PartSelection & { id: number }> = [];
      cloneParts.forEach((cp) => {
        const key = REQUIRED_NAME_TO_KEY[cp.name];
        if (key) {
          newRequired[key] = { model: cp.model, supplier: cp.supplier, qty: cp.qty };
        } else {
          newOptional.push({ id: nextOptionalId.current++, model: cp.model, supplier: cp.supplier, qty: cp.qty });
        }
      });
      setRequiredSelections(newRequired);
      setOptionalParts(newOptional);
    } catch (e) {
      console.error('复制配方解析失败', e);
    }
  }, [cloneFrom, parts]);

  // ── 辅助函数 ─────────────────────────────────────────────
  const getPriceByModelAndSupplier = useCallback((model: string, supplier: string): number => {
    const m1 = (model || '').trim();
    const s1 = (supplier || '').trim();
    const exactPart = parts.find(
      (p) => ((p.型号 || p.model) || '').trim() === m1 && ((p.供应商 || p.supplier) || '').trim() === s1
    );
    if (exactPart && s1) return exactPart.单价 || exactPart.price || 0;
    const modelParts = parts.filter((p) => ((p.型号 || p.model) || '').trim() === m1);
    if (modelParts.length > 0) {
      return modelParts.reduce((min, curr) => {
        const cp = curr.单价 || curr.price || 0;
        const mp = min.单价 || min.price || 0;
        return cp < mp ? curr : min;
      }, modelParts[0]).单价 || modelParts[0].price || 0;
    }
    return 0;
  }, [parts]);

  const resolveBoxType = useCallback((keyword: string): { model: string; price: number } => {
    const k = (keyword || '').trim();
    if (!k) return { model: '', price: 0 };
    const exactPrice = getPriceByModelAndSupplier(k, '');
    if (exactPrice > 0) return { model: k, price: exactPrice };
    const candidates = parts
      .filter((p) => (p.类别 || p.category) === '包装' && ((p.型号 || p.model) || '').includes(k))
      .map((p) => ({ model: (p.型号 || p.model) || '', price: p.单价 || p.price || 0 }));
    if (candidates.length > 0) return candidates.reduce((min, c) => c.price < min.price ? c : min, candidates[0]);
    return { model: k, price: 0 };
  }, [parts, getPriceByModelAndSupplier]);

  const buildConfigParts = useCallback((): RecipePart[] => {
    const configParts: RecipePart[] = [];
    if (hasFloat) {
      const model = `浮球-线径${floatWire}`;
      configParts.push({ model, name: '浮球', supplier: '', qty: 1, snapshotPrice: getPriceByModelAndSupplier(model, '') });
    }
    if (hasCable && cableLength && Number(cableLength) > 0) {
      const cableModel = `电缆-线径${cableWire}`;
      configParts.push({ model: cableModel, name: '电缆线', supplier: '', qty: Number(cableLength), snapshotPrice: getPriceByModelAndSupplier(cableModel, '') });
      configParts.push({ model: '电缆配件费', name: '电缆接头配件', supplier: '', qty: 1, snapshotPrice: getPriceByModelAndSupplier('电缆配件费', '') });
    }
    if (boxType) {
      const resolved = resolveBoxType(boxType);
      const name = resolved.model.includes('木') ? '木箱' : '纸箱';
      configParts.push({ model: resolved.model, name, supplier: '', qty: 1, snapshotPrice: resolved.price });
    }
    return configParts;
  }, [hasFloat, floatWire, hasCable, cableLength, cableWire, boxType, getPriceByModelAndSupplier, resolveBoxType]);

  const getModelsByCategory = (category: string): string[] => {
    const models = new Set<string>();
    parts.forEach((p) => {
      if ((p.类别 || p.category || '') === category) models.add(p.型号 || p.model || '');
    });
    return Array.from(models).filter(Boolean).sort();
  };

  const getWireOptions = (prefix: string): string[] => {
    const wires = new Set<string>();
    parts.forEach((p) => {
      const m = (p.型号 || p.model || '').trim();
      if (m.startsWith(prefix)) { const w = m.replace(prefix, ''); if (w) wires.add(w); }
    });
    return Array.from(wires).sort((a, b) => parseFloat(a) - parseFloat(b));
  };

  const getSuppliersByModel = (model: string): string[] => {
    const suppliers = new Set<string>();
    parts.forEach((p) => {
      if ((p.型号 || p.model || '') === model) suppliers.add(p.供应商 || p.supplier || '');
    });
    return Array.from(suppliers).filter(Boolean).sort();
  };

  // ── 汇总所有配件 ─────────────────────────────────────────
  const buildAllParts = useCallback((): RecipePart[] => {
    const all: RecipePart[] = [];
    REQUIRED_PARTS.forEach(({ key, name }) => {
      const s = requiredSelections[key];
      if (s.model) {
        all.push({ model: s.model, name, supplier: s.supplier, qty: s.qty, snapshotPrice: getPriceByModelAndSupplier(s.model, s.supplier) });
      }
    });
    optionalParts.forEach((p) => {
      if (p.model) all.push({ model: p.model, name: p.model, supplier: p.supplier, qty: p.qty, snapshotPrice: getPriceByModelAndSupplier(p.model, p.supplier) });
    });
    all.push(...buildConfigParts());
    return all;
  }, [requiredSelections, optionalParts, buildConfigParts, getPriceByModelAndSupplier]);

  // Step 3 成本预览
  const allPartsPreview = buildAllParts();
  const costPreview = (() => {
    if (allPartsPreview.length === 0) return null;
    const { partsCache, partsByModel } = buildPartsIndex(parts);
    return calculateRecipeCost(allPartsPreview, partsCache, partsByModel);
  })();

  // ── 步骤验证 ─────────────────────────────────────────────
  const canNext = () => {
    if (activeStep === 0) return recipeName.trim().length > 0;
    if (activeStep === 1) {
      // 至少填一个必备配件
      return REQUIRED_PARTS.some(({ key }) => requiredSelections[key].model.trim().length > 0);
    }
    return true;
  };

  // ── handlers ─────────────────────────────────────────────
  const handleRequiredChange = (key: string, field: keyof PartSelection, value: string | number) => {
    setRequiredSelections((prev) => {
      const updated = { ...prev, [key]: { ...prev[key], [field]: value } };
      if (field === 'model') updated[key].supplier = '';
      return updated;
    });
  };

  const handleAddOptional = () => {
    setOptionalParts((prev) => [...prev, { id: nextOptionalId.current++, model: '', supplier: '', qty: 1 }]);
  };

  const handleOptionalChange = (id: number, field: keyof PartSelection, value: string | number) => {
    setOptionalParts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const updated = { ...p, [field]: value };
        if (field === 'model') updated.supplier = '';
        return updated;
      })
    );
  };

  const handleRemoveOptional = (id: number) => {
    setOptionalParts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSubmit = async () => {
    const recipeParts = buildAllParts();
    if (recipeParts.length === 0) { setError('请至少选择一个配件'); return; }

    const savedTotalCost = recipeParts.reduce((sum, p) => sum + (p.snapshotPrice || 0) * (p.qty || 1), 0);
    const savedCostDetails = recipeParts
      .map((p) => `${p.name || p.model}: ¥${(p.snapshotPrice || 0).toFixed(2)} × ${p.qty || 1} = ¥${((p.snapshotPrice || 0) * (p.qty || 1)).toFixed(2)}`)
      .join('\n');

    setSaving(true);
    try {
      await createRecipe({
        配方名称: recipeName,
        规格: recipeSpec,
        配件JSON: JSON.stringify(recipeParts),
        saved_total_cost: savedTotalCost,
        saved_cost_details: savedCostDetails,
      });
      navigate('/recipes');
    } catch {
      setError('保存配方失败');
      setSaving(false);
    }
  };

  // ── 表头组件 ─────────────────────────────────────────────
  const TableHeader = () => (
    <TableHead>
      <TableRow sx={{ bgcolor: 'grey.50' }}>
        <TableCell sx={{ py: 0.75, pl: 1.5, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 90 }}>配件</TableCell>
        <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>型号</TableCell>
        <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>供应商</TableCell>
        <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 70 }}>数量</TableCell>
        <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 72, textAlign: 'right' }}>单价</TableCell>
        <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 80, textAlign: 'right' }}>小计</TableCell>
        <TableCell sx={{ py: 0.75, width: 40 }} />
      </TableRow>
    </TableHead>
  );

  return (
    <Paper elevation={2} sx={{ p: 3, maxWidth: 960, mx: 'auto' }}>
      {/* 标题 */}
      <Box display="flex" alignItems="center" mb={3} gap={1}>
        <IconButton onClick={() => navigate('/recipes')} size="small">
          <BackIcon />
        </IconButton>
        <Typography variant="h6">
          {cloneFrom ? '复制配方' : '录入配方'}
        </Typography>
        {loading && <CircularProgress size={18} sx={{ ml: 1 }} />}
      </Box>

      {/* 步骤条 */}
      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {/* ── Step 0: 基本信息 ── */}
      {!loading && activeStep === 0 && (
        <Box sx={{ maxWidth: 560 }}>
          <TextField
            label="配方名称"
            value={recipeName}
            onChange={(e) => setRecipeName(e.target.value)}
            placeholder="如：人民款370w-90机筒"
            required
            fullWidth
            sx={{ mb: 2 }}
          />
          <TextField
            label="规格（可选）"
            value={recipeSpec}
            onChange={(e) => setRecipeSpec(e.target.value)}
            placeholder="如：90-100"
            fullWidth
          />
        </Box>
      )}

      {/* ── Step 1: 必备配件 ── */}
      {!loading && activeStep === 1 && (
        <Box>
          <Alert severity="info" sx={{ mb: 2 }}>
            填写 6 项必备配件，至少需要填一项才能继续。
          </Alert>
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Table size="small" sx={{ tableLayout: 'auto' }}>
              <TableHeader />
              <TableBody>
                {REQUIRED_PARTS.map(({ key, name }) => (
                  <RecipePartRow
                    key={key}
                    label={name}
                    selection={requiredSelections[key]}
                    models={getModelsByCategory(
                      name === '泵壳' ? '泵壳'
                        : name === '线圈转子' ? '线圈转子'
                        : name.includes('轴承') ? '轴承'
                        : name.includes('油封') ? '油封'
                        : '其他'
                    )}
                    getSuppliers={getSuppliersByModel}
                    getPrice={getPriceByModelAndSupplier}
                    onChange={(field, value) => handleRequiredChange(key, field, value)}
                    isRequired
                  />
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Box>
      )}

      {/* ── Step 2: 选配 + 动态配置 ── */}
      {!loading && activeStep === 2 && (
        <Box>
          {/* 选配配件 */}
          <Paper variant="outlined" sx={{ mb: 3, overflow: 'hidden' }}>
            <Table size="small" sx={{ tableLayout: 'auto' }}>
              <TableHeader />
              <TableBody>
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 0.5, px: 1.5, bgcolor: 'grey.50', borderBottom: 'none' }}>
                    <Box display="flex" alignItems="center" justifyContent="space-between">
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 1 }}>
                        ▸ 选配配件（{optionalParts.length} 项）
                      </Typography>
                      <Button
                        variant="text"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={handleAddOptional}
                        sx={{ py: 0, minWidth: 'auto', fontSize: '0.75rem' }}
                      >
                        添加配件
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
                {optionalParts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ textAlign: 'center', py: 2, color: 'text.disabled', fontSize: '0.8rem' }}>
                      暂无选配配件，点击「添加配件」
                    </TableCell>
                  </TableRow>
                ) : (
                  optionalParts.map((part) => (
                    <RecipePartRow
                      key={part.id}
                      label="配件"
                      selection={part}
                      models={parts.map((p) => p.型号 || p.model || '').filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)}
                      getSuppliers={getSuppliersByModel}
                      getPrice={getPriceByModelAndSupplier}
                      onChange={(field, value) => handleOptionalChange(part.id, field, value)}
                      onDelete={() => handleRemoveOptional(part.id)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </Paper>

          {/* 动态配置区 */}
          <Typography variant="subtitle1" fontWeight={700} color="primary" sx={{ mb: 1.5 }}>
            水泵动态配置区
          </Typography>
          <Box sx={{ p: 2.5, bgcolor: 'grey.50', borderRadius: 2, border: '1px solid', borderColor: 'grey.200', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* 浮球 */}
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <FormControlLabel
                control={<Checkbox checked={hasFloat} onChange={(e) => setHasFloat(e.target.checked)} color="primary" />}
                label={<Typography fontWeight={500}>带浮球</Typography>}
                sx={{ minWidth: 160 }}
              />
              {hasFloat && (
                <>
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>浮球线径</InputLabel>
                    <Select value={floatWire} label="浮球线径" onChange={(e) => setFloatWire(e.target.value as string)}>
                      {getWireOptions('浮球-线径').map((w) => (
                        <MenuItem key={w} value={w}>{w} mm</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                    小计: <strong>¥{getPriceByModelAndSupplier(`浮球-线径${floatWire}`, '').toFixed(2)}</strong>
                  </Typography>
                </>
              )}
            </Box>
            <Divider />
            {/* 电缆 */}
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <FormControlLabel
                control={<Checkbox checked={hasCable} onChange={(e) => setHasCable(e.target.checked)} color="primary" />}
                label={<Typography fontWeight={500}>带电缆线（按米计价）</Typography>}
                sx={{ minWidth: 220 }}
              />
              {hasCable && (
                <>
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>电缆线径</InputLabel>
                    <Select value={cableWire} label="电缆线径" onChange={(e) => setCableWire(e.target.value as string)}>
                      {getWireOptions('电缆-线径').map((w) => (
                        <MenuItem key={w} value={w}>{w} mm</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    label="电缆长度 (米)"
                    size="small"
                    type="number"
                    inputProps={{ step: '0.1', min: '0' }}
                    value={cableLength}
                    onChange={(e) => setCableLength(e.target.value)}
                    sx={{ width: 150 }}
                  />
                  <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                    小计: <strong>¥{((getPriceByModelAndSupplier(`电缆-线径${cableWire}`, '') * (Number(cableLength) || 0)) + getPriceByModelAndSupplier('电缆配件费', '')).toFixed(2)}</strong>
                  </Typography>
                </>
              )}
            </Box>
            <Divider />
            {/* 包材 */}
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <Typography fontWeight={500} sx={{ minWidth: 120 }}>包装及辅材：</Typography>
              <Autocomplete
                freeSolo
                disableClearable
                options={getModelsByCategory('包装')}
                value={boxType}
                onInputChange={(_, v) => setBoxType(v)}
                sx={{ width: 250 }}
                renderInput={(params) => (
                  <TextField {...params} label="包装箱型号" size="small" placeholder="可下拉选择或手动输入" InputProps={{ ...params.InputProps, type: 'search' }} />
                )}
              />
              {boxType && (() => {
                const resolved = resolveBoxType(boxType);
                return (
                  <Typography variant="body2" color={resolved.price > 0 ? 'text.secondary' : 'error'} sx={{ ml: 'auto' }}>
                    小计: <strong>¥{resolved.price.toFixed(2)}</strong>
                    {resolved.model !== boxType && resolved.price > 0 && (
                      <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.disabled' }}>
                        (匹配到: {resolved.model})
                      </Typography>
                    )}
                  </Typography>
                );
              })()}
            </Box>
          </Box>
        </Box>
      )}

      {/* ── Step 3: 预览 & 保存 ── */}
      {!loading && activeStep === 3 && (
        <Box>
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <Typography variant="subtitle1" fontWeight={700}>配方汇总</Typography>
            {costPreview && (
              <Chip
                label={`预估总成本 ¥${costPreview.totalCost}`}
                color="primary"
                sx={{ fontWeight: 700, fontSize: '0.95rem' }}
              />
            )}
          </Box>

          {allPartsPreview.length === 0 ? (
            <Alert severity="warning">还没有任何配件，请返回上一步添加。</Alert>
          ) : (
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell>名称</TableCell>
                    <TableCell>型号</TableCell>
                    <TableCell>供应商</TableCell>
                    <TableCell align="right">单价</TableCell>
                    <TableCell align="right">数量</TableCell>
                    <TableCell align="right">小计</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {allPartsPreview.map((p, i) => (
                    <TableRow key={i} hover>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.model}</TableCell>
                      <TableCell>{p.supplier || '-'}</TableCell>
                      <TableCell align="right">¥{(p.snapshotPrice || 0).toFixed(2)}</TableCell>
                      <TableCell align="right">{p.qty}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        ¥{((p.snapshotPrice || 0) * (p.qty || 1)).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={{ bgcolor: 'primary.50' }}>
                    <TableCell colSpan={5} sx={{ fontWeight: 700 }}>合计</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: 'primary.main', fontSize: '1rem' }}>
                      ¥{costPreview?.totalCost ?? '0.00'}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Paper>
          )}

          <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="body2"><b>配方名称：</b>{recipeName}</Typography>
            {recipeSpec && <Typography variant="body2" mt={0.5}><b>规格：</b>{recipeSpec}</Typography>}
          </Box>
        </Box>
      )}

      {/* ── 导航按钮 ── */}
      {!loading && (
        <Box display="flex" justifyContent="space-between" mt={4}>
          <Button
            variant="outlined"
            startIcon={<BackIcon />}
            onClick={() => setActiveStep((s) => s - 1)}
            disabled={activeStep === 0}
          >
            上一步
          </Button>
          {activeStep < STEPS.length - 1 ? (
            <Button
              variant="contained"
              endIcon={<NextIcon />}
              onClick={() => setActiveStep((s) => s + 1)}
              disabled={!canNext()}
            >
              下一步
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              size="large"
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
              onClick={handleSubmit}
              disabled={saving || allPartsPreview.length === 0}
            >
              保存配方
            </Button>
          )}
        </Box>
      )}
    </Paper>
  );
}
