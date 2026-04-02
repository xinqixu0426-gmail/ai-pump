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
  Chip,
  IconButton,
} from '@mui/material';
import {
  Save as SaveIcon,
  Add as AddIcon,
  ArrowBack as BackIcon,
  Cable as CableIcon,
} from '@mui/icons-material';
import { RecipePart } from '../types';
import { createRecipe } from '../utils/api';
import { useAppStore } from '../utils/store';
import RecipePartRow from '../components/RecipePartRow';

const COIL_API_BASE = '';

// 必备配件（线圈转子单独处理）
const REQUIRED_PARTS = [
  { key: 'pumpShell', name: '泵壳' },
  { key: 'plateBearing', name: '花板轴承' },
  { key: 'cylinderBearing', name: '油缸轴承' },
  { key: 'mechanicalSeal', name: '机械油封' },
  { key: 'skeletonSeal', name: '骨架油封' },
  { key: 'capacitor', name: '电容' },
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
  capacitor: { model: '', supplier: '', qty: 1 },
};

interface CoilCalcResult {
  spec: string;
  sheets: number;
  unitPrice: number;
  wireWeight: number;
  copperBase: number;
  coilFee: number;
  rotorFee: number;
  totalCost: number;
  formula: string;
  source: string;
  isCustomWireWeight: boolean;
  wireGauge: string | null;
  capacitor: string | null;
}

interface CoilSpecInfo {
  spec: string;
  unitPrice: string;
  sheets: number[];
  count: number;
}

export default function RecipeFormPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const cloneFrom = (location.state as { cloneFrom?: { name: string; spec: string; partsJson: string } })?.cloneFrom;
  const cloneApplied = useRef(false);

  const { parts, fetchParts } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 基本信息
  const [recipeName, setRecipeName] = useState(cloneFrom?.name || '');
  const [recipeSpec, setRecipeSpec] = useState(cloneFrom?.spec || '');

  // 必备配件
  const [requiredSelections, setRequiredSelections] = useState<Record<string, PartSelection>>(
    JSON.parse(JSON.stringify(EMPTY_REQUIRED))
  );

  // 线圈转子
  const [coilSpecs, setCoilSpecs] = useState<CoilSpecInfo[]>([]);
  const [coilSpec, setCoilSpec] = useState('');
  const [coilSheets, setCoilSheets] = useState('');
  const [coilCustomWireWeight, setCoilCustomWireWeight] = useState('');
  const [useCoilCustomWeight, setUseCoilCustomWeight] = useState(false);
  const [coilResult, setCoilResult] = useState<CoilCalcResult | null>(null);
  const [coilLoading, setCoilLoading] = useState(false);

  // 选配 + 动态配置
  const [optionalParts, setOptionalParts] = useState<Array<PartSelection & { id: number }>>([]);
  const nextOptionalId = useRef(1);

  const [hasFloat, setHasFloat] = useState(false);
  const [floatWire, setFloatWire] = useState('0.55');
  const [hasCable, setHasCable] = useState(false);
  const [cableLength, setCableLength] = useState('');
  const [cableWire, setCableWire] = useState('0.55');
  const [boxType, setBoxType] = useState('');

  // ── 数据加载 ──
  const loadParts = useCallback(async () => {
    try {
      setLoading(true);
      await fetchParts();
    } catch {
      setError('加载零件数据失败');
    } finally {
      setLoading(false);
    }
  }, [fetchParts]);

  useEffect(() => { loadParts(); }, [loadParts]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${COIL_API_BASE}/api/coils/specs`);
        const json = await res.json();
        if (json.success) setCoilSpecs(json.data);
      } catch (err) {
        console.error('加载线圈规格失败:', err);
      }
    })();
  }, []);

  const calculateCoilCost = useCallback(async (spec: string, sheets: string, customWeight?: string) => {
    if (!spec || !sheets) { setCoilResult(null); return; }
    try {
      setCoilLoading(true);
      const body: Record<string, unknown> = { spec, sheets: parseInt(sheets) };
      if (customWeight) body.wireWeight = parseFloat(customWeight);
      const res = await fetch(`${COIL_API_BASE}/api/coils/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.success) setCoilResult(json.data);
      else setCoilResult(null);
    } catch {
      setCoilResult(null);
    } finally {
      setCoilLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      calculateCoilCost(coilSpec, coilSheets, useCoilCustomWeight ? coilCustomWireWeight : undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [coilSpec, coilSheets, coilCustomWireWeight, useCoilCustomWeight, calculateCoilCost]);

  // 线圈结果联动：自动设置浮球/电缆线径 + 电容
  useEffect(() => {
    if (!coilResult) return;
    // 自动填充线径
    if (coilResult.wireGauge) {
      setFloatWire(coilResult.wireGauge);
      setCableWire(coilResult.wireGauge);
    }
    // 自动填充电容到必备配件
    if (coilResult.capacitor) {
      const uf = String(coilResult.capacitor);
      const capPart = parts.find(p =>
        p.category === '电容' &&
        (p.model).includes(uf)
      );
      if (capPart) {
        const capModel = capPart.model;
        setRequiredSelections(prev => ({
          ...prev,
          capacitor: { ...prev.capacitor, model: capModel }
        }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coilResult]);

  // 复制配方预填
  useEffect(() => {
    if (!cloneFrom || cloneApplied.current || parts.length === 0) return;
    cloneApplied.current = true;
    try {
      const cloneParts: RecipePart[] = JSON.parse(cloneFrom.partsJson);
      const newRequired = JSON.parse(JSON.stringify(EMPTY_REQUIRED));
      const newOptional: Array<PartSelection & { id: number }> = [];
      cloneParts.forEach((cp) => {
        if (cp.name === '线圈转子') {
          if (cp.model && cp.model.includes('-')) {
            const [s, sh] = cp.model.split('-');
            setCoilSpec(s.trim());
            setCoilSheets(sh.trim());
          }
          return;
        }
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

  // ── 辅助函数 ──
  const getPriceByModelAndSupplier = useCallback((model: string, supplier: string): number => {
    const m1 = (model || '').trim();
    const s1 = (supplier || '').trim();
    const exactPart = parts.find(
      (p) => p.model.trim() === m1 && p.supplier.trim() === s1
    );
    if (exactPart && s1) return exactPart.price;
    const modelParts = parts.filter((p) => p.model.trim() === m1);
    if (modelParts.length > 0) {
      return modelParts.reduce((min, curr) => {
        const cp = curr.price;
        const mp = min.price;
        return cp < mp ? curr : min;
      }, modelParts[0]).price;
    }
    return 0;
  }, [parts]);

  const resolveBoxType = useCallback((keyword: string): { model: string; price: number } => {
    const k = (keyword || '').trim();
    if (!k) return { model: '', price: 0 };
    const exactPrice = getPriceByModelAndSupplier(k, '');
    if (exactPrice > 0) return { model: k, price: exactPrice };
    const candidates = parts
      .filter((p) => p.category === '包装' && p.model.includes(k))
      .map((p) => ({ model: p.model, price: p.price }));
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
      if (p.category === category) models.add(p.model);
    });
    return Array.from(models).filter(Boolean).sort();
  };

  const getWireOptions = (prefix: string): string[] => {
    const wires = new Set<string>();
    parts.forEach((p) => {
      const m = p.model;
      if (m.startsWith(prefix)) { const w = m.replace(prefix, ''); if (w) wires.add(w); }
    });
    return Array.from(wires).sort((a, b) => parseFloat(a) - parseFloat(b));
  };

  const getSuppliersByModel = (model: string): string[] => {
    const suppliers = new Set<string>();
    parts.forEach((p) => {
      if (p.model === model) suppliers.add(p.supplier);
    });
    return Array.from(suppliers).filter(Boolean).sort();
  };

  // ── 汇总 ──
  const buildAllParts = useCallback((): RecipePart[] => {
    const all: RecipePart[] = [];
    REQUIRED_PARTS.forEach(({ key, name }) => {
      const s = requiredSelections[key];
      if (s.model) {
        all.push({ model: s.model, name, supplier: s.supplier, qty: s.qty, snapshotPrice: getPriceByModelAndSupplier(s.model, s.supplier) });
      }
    });
    if (coilResult && coilSpec && coilSheets) {
      all.push({ model: `${coilSpec}-${coilSheets}`, name: '线圈转子', supplier: '', qty: 1, snapshotPrice: coilResult.totalCost });
    }
    optionalParts.forEach((p) => {
      if (p.model) all.push({ model: p.model, name: p.model, supplier: p.supplier, qty: p.qty, snapshotPrice: getPriceByModelAndSupplier(p.model, p.supplier) });
    });
    all.push(...buildConfigParts());
    return all;
  }, [requiredSelections, optionalParts, buildConfigParts, getPriceByModelAndSupplier, coilResult, coilSpec, coilSheets]);

  // 成本预览
  const allPartsPreview = buildAllParts();
  const totalCost = allPartsPreview.reduce((sum, p) => sum + (p.snapshotPrice || 0) * (p.qty || 1), 0);

  // ── handlers ──
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
    if (!recipeName.trim()) { setError('请输入配方名称'); return; }
    const recipeParts = buildAllParts();
    if (recipeParts.length === 0) { setError('请至少选择一个配件'); return; }

    const savedTotalCost = recipeParts.reduce((sum, p) => sum + (p.snapshotPrice || 0) * (p.qty || 1), 0);
    const savedCostDetails = recipeParts
      .map((p) => `${p.name || p.model}: ¥${(p.snapshotPrice || 0).toFixed(2)} × ${p.qty || 1} = ¥${((p.snapshotPrice || 0) * (p.qty || 1)).toFixed(2)}`)
      .join('\n');

    setSaving(true);
    try {
      await createRecipe({
        name: recipeName,
        spec: recipeSpec,
        parts_json: JSON.stringify(recipeParts),
        saved_total_cost: savedTotalCost,
        saved_cost_details: savedCostDetails,
      });
      navigate('/recipes');
    } catch {
      setError('保存配方失败');
      setSaving(false);
    }
  };

  // ── 表头 ──
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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Paper sx={{ p: { xs: 2, md: 3 }, maxWidth: 960, mx: 'auto' }}>
      {/* 标题 + 成本速览 */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Box display="flex" alignItems="center" gap={1}>
          <IconButton onClick={() => navigate('/recipes')} size="small">
            <BackIcon />
          </IconButton>
          <Typography variant="h6">
            {cloneFrom ? '复制配方' : '录入配方'}
          </Typography>
        </Box>
        {totalCost > 0 && (
          <Chip
            label={`预估成本 ¥${totalCost.toFixed(2)}`}
            color="primary"
            sx={{ fontWeight: 700, fontSize: '0.9rem' }}
          />
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {/* ━━ 基本信息 ━━ */}
      <Box display="flex" gap={2} mb={2}>
        <TextField
          label="配方名称"
          value={recipeName}
          onChange={(e) => setRecipeName(e.target.value)}
          placeholder="如：人民款370w-90机筒"
          required
          size="small"
          sx={{ flex: 2 }}
        />
        <TextField
          label="规格"
          value={recipeSpec}
          onChange={(e) => setRecipeSpec(e.target.value)}
          placeholder="如：90-100"
          size="small"
          sx={{ flex: 1 }}
        />
      </Box>

      {/* ━━ 配件表格 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Table size="small" sx={{ tableLayout: 'auto' }}>
          <TableHeader />
          <TableBody>
            {/* 必备配件 */}
            <TableRow>
              <TableCell colSpan={7} sx={{ py: 0.5, px: 1.5, bgcolor: 'primary.50', borderBottom: 'none' }}>
                <Typography variant="caption" fontWeight={700} color="primary.main" sx={{ letterSpacing: 1 }}>
                  ▸ 必备配件
                </Typography>
              </TableCell>
            </TableRow>
            {REQUIRED_PARTS.map(({ key, name }) => (
              <RecipePartRow
                key={key}
                label={name}
                selection={requiredSelections[key]}
                models={getModelsByCategory(
                  name === '泵壳' ? '泵壳'
                    : name.includes('轴承') ? '轴承'
                    : name.includes('油封') ? '油封'
                    : name === '电容' ? '电容'
                    : '其他'
                )}
                getSuppliers={getSuppliersByModel}
                getPrice={getPriceByModelAndSupplier}
                onChange={(field, value) => handleRequiredChange(key, field, value)}
                isRequired
              />
            ))}

            <TableRow>
              <TableCell colSpan={7} sx={{ p: 0 }}><Divider /></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Paper>

      {/* ━━ 线圈转子 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'rgba(124, 58, 237, 0.05)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <CableIcon sx={{ fontSize: 16, color: '#7c3aed' }} />
          <Typography variant="caption" fontWeight={700} color="#7c3aed" sx={{ letterSpacing: 1 }}>
            ▸ 线圈转子
          </Typography>
          {coilLoading && <CircularProgress size={12} sx={{ ml: 1 }} />}
          {coilResult && (
            <Chip
              label={`¥${coilResult.totalCost.toFixed(2)}`}
              size="small"
              color="success"
              sx={{ ml: 'auto', fontWeight: 700 }}
            />
          )}
        </Box>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>定子规格</InputLabel>
            <Select
              value={coilSpec}
              label="定子规格"
              onChange={(e) => { setCoilSpec(e.target.value); setCoilSheets(''); setCoilResult(null); }}
            >
              {coilSpecs.map(s => (
                <MenuItem key={s.spec} value={s.spec}>
                  规格 {s.spec} ({s.count}种)
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="片数"
            type="number"
            value={coilSheets}
            onChange={(e) => setCoilSheets(e.target.value)}
            sx={{ width: 120 }}
            placeholder={coilSpec && coilSpecs.find(s => s.spec === coilSpec)
              ? coilSpecs.find(s => s.spec === coilSpec)!.sheets.join(',')
              : ''}
          />
          <FormControlLabel
            control={<Checkbox checked={useCoilCustomWeight} onChange={(e) => setUseCoilCustomWeight(e.target.checked)} size="small" />}
            label={<Typography variant="body2">指定线重</Typography>}
          />
          {useCoilCustomWeight && (
            <TextField
              size="small" label="线重(kg)" type="number"
              value={coilCustomWireWeight}
              onChange={(e) => setCoilCustomWireWeight(e.target.value)}
              sx={{ width: 100 }}
              inputProps={{ step: '0.001' }}
            />
          )}
          {coilResult && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {coilResult.formula}
            </Typography>
          )}
        </Box>
      </Paper>

      {/* ━━ 选配配件 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
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
                <TableCell colSpan={7} sx={{ textAlign: 'center', py: 1.5, color: 'text.disabled', fontSize: '0.8rem' }}>
                  暂无选配配件
                </TableCell>
              </TableRow>
            ) : (
              optionalParts.map((part) => (
                <RecipePartRow
                  key={part.id}
                  label="配件"
                  selection={part}
                  models={parts.map((p) => p.model).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)}
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

      {/* ━━ 动态配置区 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 1 }}>
            ▸ 动态配置（浮球 / 电缆 / 包材）
          </Typography>
        </Box>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {/* 浮球 */}
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <FormControlLabel
              control={<Checkbox checked={hasFloat} onChange={(e) => setHasFloat(e.target.checked)} size="small" />}
              label={<Typography variant="body2" fontWeight={500}>浮球</Typography>}
              sx={{ minWidth: 100 }}
            />
            {hasFloat && (
              <>
                <FormControl size="small" sx={{ minWidth: 110 }}>
                  <InputLabel>线径</InputLabel>
                  <Select value={floatWire} label="线径" onChange={(e) => setFloatWire(e.target.value as string)}>
                    {getWireOptions('浮球-线径').map((w) => (
                      <MenuItem key={w} value={w}>{w} mm</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                  ¥{getPriceByModelAndSupplier(`浮球-线径${floatWire}`, '').toFixed(2)}
                </Typography>
              </>
            )}
          </Box>
          <Divider />
          {/* 电缆 */}
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <FormControlLabel
              control={<Checkbox checked={hasCable} onChange={(e) => setHasCable(e.target.checked)} size="small" />}
              label={<Typography variant="body2" fontWeight={500}>电缆线</Typography>}
              sx={{ minWidth: 100 }}
            />
            {hasCable && (
              <>
                <FormControl size="small" sx={{ minWidth: 110 }}>
                  <InputLabel>线径</InputLabel>
                  <Select value={cableWire} label="线径" onChange={(e) => setCableWire(e.target.value as string)}>
                    {getWireOptions('电缆-线径').map((w) => (
                      <MenuItem key={w} value={w}>{w} mm</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="长度(米)" size="small" type="number"
                  inputProps={{ step: '0.1', min: '0' }}
                  value={cableLength}
                  onChange={(e) => setCableLength(e.target.value)}
                  sx={{ width: 110 }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                  ¥{((getPriceByModelAndSupplier(`电缆-线径${cableWire}`, '') * (Number(cableLength) || 0)) + getPriceByModelAndSupplier('电缆配件费', '')).toFixed(2)}
                </Typography>
              </>
            )}
          </Box>
          <Divider />
          {/* 包材 */}
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <Typography variant="body2" fontWeight={500} sx={{ minWidth: 100 }}>包装</Typography>
            <Autocomplete
              freeSolo
              disableClearable
              options={getModelsByCategory('包装')}
              value={boxType}
              onInputChange={(_, v) => setBoxType(v)}
              sx={{ width: 220 }}
              renderInput={(params) => (
                <TextField {...params} label="包装箱型号" size="small" placeholder="选择或输入" InputProps={{ ...params.InputProps, type: 'search' }} />
              )}
            />
            {boxType && (() => {
              const resolved = resolveBoxType(boxType);
              return (
                <Typography variant="body2" color={resolved.price > 0 ? 'text.secondary' : 'error'} sx={{ ml: 'auto' }}>
                  ¥{resolved.price.toFixed(2)}
                  {resolved.model !== boxType && resolved.price > 0 && (
                    <Typography component="span" variant="caption" sx={{ ml: 0.5, color: 'text.disabled' }}>
                      ({resolved.model})
                    </Typography>
                  )}
                </Typography>
              );
            })()}
          </Box>
        </Box>
      </Paper>

      {/* ━━ 保存按钮 ━━ */}
      <Button
        variant="contained"
        color="success"
        size="large"
        fullWidth
        startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
        onClick={handleSubmit}
        disabled={saving || !recipeName.trim() || allPartsPreview.length === 0}
        sx={{ mt: 1 }}
      >
        保存配方
      </Button>
    </Paper>
  );
}
