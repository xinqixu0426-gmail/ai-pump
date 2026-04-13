import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  Tooltip,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import {
  Save as SaveIcon,
  Add as AddIcon,
  ArrowBack as BackIcon,
  Cable as CableIcon,
  Inventory as TemplateIcon,
  NavigateNext as NextIcon,
  NavigateBefore as PrevIcon,
} from '@mui/icons-material';
import { RecipePart, TemplatePart, PartSelection } from '../types';
import { createRecipe, updateRecipe } from '../utils/api';
import { useAppStore } from '../utils/store';
import { getPriceByModelAndSupplier as _getPrice, getModelsByCategory as _getModelsByCategory, getSuppliersByModel as _getSuppliersByModel } from '../utils/partHelpers';
import RecipePartRow from '../components/RecipePartRow';

const COIL_API_BASE = '';

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
  const locState = location.state as {
    cloneFrom?: { name: string; spec: string; partsJson: string; template_id?: number; coil_spec?: string; coil_sheets?: number; has_float?: number; float_wire?: string; has_cable?: number; cable_length?: number; cable_wire?: string; box_type?: string; extra_parts_json?: string; assembly_wage?: number; packing_wage?: number; painting_wage?: number | null; management_fee?: number };
    editFrom?: { id: number; name: string; spec: string; partsJson: string; template_id?: number; coil_spec?: string; coil_sheets?: number; has_float?: number; float_wire?: string; has_cable?: number; cable_length?: number; cable_wire?: string; box_type?: string; extra_parts_json?: string; assembly_wage?: number; packing_wage?: number; painting_wage?: number | null; management_fee?: number };
  } | null;
  const cloneFrom = locState?.cloneFrom;
  const editFrom = locState?.editFrom;
  const isEditing = !!editFrom;
  const initApplied = useRef(false);

  const { parts, fetchParts, templates, fetchTemplates } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Stepper
  const STEPS = ['基本信息 + 模板', '配件配置', '工资 + 确认'];
  const [activeStep, setActiveStep] = useState(0);

  // 基本信息
  const [recipeName, setRecipeName] = useState(editFrom?.name || cloneFrom?.name || '');
  const [recipeSpec, setRecipeSpec] = useState(editFrom?.spec || cloneFrom?.spec || '');

  // 泵壳模板选择
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    editFrom?.template_id || cloneFrom?.template_id || null
  );

  // 线圈转子
  const [coilSpecs, setCoilSpecs] = useState<CoilSpecInfo[]>([]);
  const [coilSpec, setCoilSpec] = useState(editFrom?.coil_spec || cloneFrom?.coil_spec || '');
  const [coilSheets, setCoilSheets] = useState(editFrom?.coil_sheets ? String(editFrom.coil_sheets) : (cloneFrom?.coil_sheets ? String(cloneFrom.coil_sheets) : ''));
  const [coilCustomWireWeight, setCoilCustomWireWeight] = useState('');
  const [useCoilCustomWeight, setUseCoilCustomWeight] = useState(false);
  const [coilResult, setCoilResult] = useState<CoilCalcResult | null>(null);
  const [coilLoading, setCoilLoading] = useState(false);

  // 选配配件
  const [optionalParts, setOptionalParts] = useState<Array<PartSelection & { id: number }>>([]);
  const nextOptionalId = useRef(1);

  // 动态配置
  const [hasFloat, setHasFloat] = useState(!!editFrom?.has_float || !!cloneFrom?.has_float);
  const [floatWire, setFloatWire] = useState(editFrom?.float_wire || cloneFrom?.float_wire || '0.55');
  const [hasCable, setHasCable] = useState(!!editFrom?.has_cable || !!cloneFrom?.has_cable);
  const [cableLength, setCableLength] = useState(editFrom?.cable_length ? String(editFrom.cable_length) : (cloneFrom?.cable_length ? String(cloneFrom.cable_length) : ''));
  const [cableWire, setCableWire] = useState(editFrom?.cable_wire || cloneFrom?.cable_wire || '0.55');
  const [boxType, setBoxType] = useState(editFrom?.box_type || cloneFrom?.box_type || '');

  // 电容（从线圈联动）
  const [capacitorModel, setCapacitorModel] = useState('');

  // 人工工资
  const [assemblyWage, setAssemblyWage] = useState(editFrom?.assembly_wage ?? cloneFrom?.assembly_wage ?? 0);
  const [packingWage, setPackingWage] = useState(editFrom?.packing_wage ?? cloneFrom?.packing_wage ?? 0);
  const [paintingWage, setPaintingWage] = useState<number | null>(editFrom?.painting_wage ?? cloneFrom?.painting_wage ?? null);

  // 管理费用
  const [managementFee, setManagementFee] = useState(editFrom?.management_fee ?? cloneFrom?.management_fee ?? 0);

  // ── 数据加载 ──
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([fetchParts(), fetchTemplates()]);
    } catch {
      setError('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [fetchParts, fetchTemplates]);

  useEffect(() => { loadData(); }, [loadData]);

  // 读取管理费默认值（仅新建时）
  useEffect(() => {
    if (editFrom || cloneFrom) return; // 编辑/复制时用配方已存的值
    (async () => {
      try {
        const res = await fetch('/api/settings/management_fee', { credentials: 'include' });
        const json = await res.json();
        if (json.success) setManagementFee(parseFloat(json.data.value) || 0);
      } catch { /* ignore */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (coilResult.wireGauge) {
      setFloatWire(coilResult.wireGauge);
      setCableWire(coilResult.wireGauge);
    }
    if (coilResult.capacitor) {
      const uf = String(coilResult.capacitor);
      const capPart = parts.find(p => p.category === '电容' && p.model.includes(uf));
      if (capPart) setCapacitorModel(capPart.model);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coilResult]);

  // 编辑/复制配方预填 — 新逻辑：从结构化字段还原
  useEffect(() => {
    const source = editFrom || cloneFrom;
    if (!source || initApplied.current || parts.length === 0) return;
    initApplied.current = true;

    // 如果有 template_id，直接用结构化字段
    if (source.template_id) {
      setSelectedTemplateId(source.template_id);
      if (source.coil_spec) setCoilSpec(source.coil_spec);
      if (source.coil_sheets) setCoilSheets(String(source.coil_sheets));
      setHasFloat(!!source.has_float);
      if (source.float_wire) setFloatWire(source.float_wire);
      setHasCable(!!source.has_cable);
      if (source.cable_length) setCableLength(String(source.cable_length));
      if (source.cable_wire) setCableWire(source.cable_wire);
      if (source.box_type) setBoxType(source.box_type);

      // 额外选配
      try {
        const extras = JSON.parse(source.extra_parts_json || '[]');
        setOptionalParts(extras.map((p: PartSelection) => ({ id: nextOptionalId.current++, ...p })));
      } catch { /* */ }
      return;
    }

    // 兼容旧配方：从 parts_json 解析
    try {
      const srcParts: RecipePart[] = JSON.parse(source.partsJson);
      const newOptional: Array<PartSelection & { id: number }> = [];
      srcParts.forEach((cp) => {
        if (cp.name === '线圈转子') {
          if (cp.model && cp.model.includes('-')) {
            const [s, sh] = cp.model.split('-');
            setCoilSpec(s.trim());
            setCoilSheets(sh.trim());
          }
          return;
        }
        if (cp.name === '浮球') { setHasFloat(true); const w = cp.model.replace('浮球-线径', ''); if (w) setFloatWire(w); return; }
        if (cp.name === '电缆线') { setHasCable(true); const w = cp.model.replace('电缆-线径', ''); if (w) setCableWire(w); setCableLength(String(cp.qty || '')); return; }
        if (cp.name === '电缆接头配件') return;
        if (cp.name === '纸箱' || cp.name === '木箱') { setBoxType(cp.model); return; }
        // 跳过泵壳/轴承/油封等固定配件（旧配方没模板，加到选配）
        newOptional.push({ id: nextOptionalId.current++, model: cp.model, supplier: cp.supplier, qty: cp.qty });
      });
      setOptionalParts(newOptional);
    } catch (e) {
      console.error('解析配方失败', e);
    }
  }, [editFrom, cloneFrom, parts]);

  // ── 辅助函数（委托到公共工具）──
  const getPriceByModelAndSupplier = useCallback(
    (model: string, supplier: string) => _getPrice(parts, model, supplier),
    [parts]
  );

  const getModelsByCategory = useCallback(
    (category: string) => _getModelsByCategory(parts, category),
    [parts]
  );

  const getSuppliersByModel = useCallback(
    (model: string) => _getSuppliersByModel(parts, model),
    [parts]
  );

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

  // 获取选中模板的配件列表
  const selectedTemplate = templates.find(t => t.Id === selectedTemplateId) || null;
  const templateParts: TemplatePart[] = (() => {
    if (!selectedTemplate) return [];
    try { return JSON.parse(selectedTemplate.parts_json || '[]'); } catch { return []; }
  })();

  // 选模板时自动带入工资
  useEffect(() => {
    if (selectedTemplate) {
      setAssemblyWage(selectedTemplate.assembly_wage || 0);
      setPackingWage(selectedTemplate.packing_wage || 0);
      setPaintingWage(selectedTemplate.painting_wage);
    }
  }, [selectedTemplateId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 模板配件成本
  const templateCost = templateParts.reduce((sum, p: TemplatePart) => sum + getPriceByModelAndSupplier(p.model, p.supplier || '') * p.qty, 0);

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

  const getWireOptions = (prefix: string): string[] => {
    const wires = new Set<string>();
    parts.forEach((p) => {
      const m = p.model;
      if (m.startsWith(prefix)) { const w = m.replace(prefix, ''); if (w) wires.add(w); }
    });
    return Array.from(wires).sort((a, b) => parseFloat(a) - parseFloat(b));
  };

  // ── 汇总所有配件（用于 parts_json 冗余快照）──
  const buildAllParts = useCallback((): RecipePart[] => {
    const all: RecipePart[] = [];

    // 模板固定配件
    templateParts.forEach(p => {
      const supplier = p.supplier || '';
      const price = getPriceByModelAndSupplier(p.model, supplier);
      all.push({ model: p.model, name: p.name, supplier, qty: p.qty, snapshotPrice: price });
    });

    // 电容（从线圈联动）
    if (capacitorModel) {
      all.push({ model: capacitorModel, name: '电容', supplier: '', qty: 1, snapshotPrice: getPriceByModelAndSupplier(capacitorModel, '') });
    }

    // 线圈转子
    if (coilResult && coilSpec && coilSheets) {
      all.push({ model: `${coilSpec}-${coilSheets}`, name: '线圈转子', supplier: '', qty: 1, snapshotPrice: coilResult.totalCost });
    }

    // 选配
    optionalParts.forEach((p) => {
      if (p.model) all.push({ model: p.model, name: p.model, supplier: p.supplier, qty: p.qty, snapshotPrice: getPriceByModelAndSupplier(p.model, p.supplier) });
    });

    // 动态配置
    all.push(...buildConfigParts());
    return all;
  }, [templateParts, capacitorModel, optionalParts, buildConfigParts, getPriceByModelAndSupplier, coilResult, coilSpec, coilSheets]);

  // 总成本预览（配件 + 工资）
  const allPartsPreview = useMemo(() => buildAllParts(), [buildAllParts]);
  const laborCost = useMemo(() => (assemblyWage || 0) + (packingWage || 0) + (paintingWage || 0) + (managementFee || 0), [assemblyWage, packingWage, paintingWage, managementFee]);
  const partsCost = useMemo(() => allPartsPreview.reduce((sum, p) => sum + (p.snapshotPrice || 0) * (p.qty || 1), 0), [allPartsPreview]);
  const totalCost = partsCost + laborCost;

  // ── handlers ──
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
    if (recipeParts.length === 0 && !selectedTemplateId) { setError('请选择泵壳模板或至少添加一个配件'); return; }

    const savedTotalCost = recipeParts.reduce((sum, p) => sum + (p.snapshotPrice || 0) * (p.qty || 1), 0) + laborCost;
    const wageLines = [`安装工资: ¥${(assemblyWage || 0).toFixed(2)}`, `打包工资: ¥${(packingWage || 0).toFixed(2)}`];
    if (paintingWage != null) wageLines.push(`喷漆工资: ¥${(paintingWage || 0).toFixed(2)}`);
    wageLines.push(`管理费用: ¥${(managementFee || 0).toFixed(2)}`);
    const savedCostDetails = recipeParts
      .map((p) => `${p.name || p.model}: ¥${(p.snapshotPrice || 0).toFixed(2)} × ${p.qty || 1} = ¥${((p.snapshotPrice || 0) * (p.qty || 1)).toFixed(2)}`)
      .concat(wageLines)
      .join('\n');

    const recipeData = {
      name: recipeName,
      spec: recipeSpec,
      parts_json: JSON.stringify(recipeParts),
      saved_total_cost: savedTotalCost,
      saved_cost_details: savedCostDetails,
      template_id: selectedTemplateId,
      coil_spec: coilSpec,
      coil_sheets: coilSheets ? parseInt(coilSheets) : 0,
      has_float: hasFloat ? 1 : 0,
      float_wire: floatWire,
      has_cable: hasCable ? 1 : 0,
      cable_length: cableLength ? parseFloat(cableLength) : 0,
      cable_wire: cableWire,
      box_type: boxType,
      extra_parts_json: JSON.stringify(optionalParts.filter(p => p.model).map(p => ({ model: p.model, supplier: p.supplier, qty: p.qty }))),
      assembly_wage: assemblyWage,
      packing_wage: packingWage,
      painting_wage: paintingWage,
      management_fee: managementFee,
    };

    setSaving(true);
    try {
      if (isEditing && editFrom) {
        await updateRecipe(editFrom.id, recipeData);
      } else {
        await createRecipe(recipeData);
      }
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

  // ── 各区块小计（用于浮动面板）──
  const coilCost = coilResult?.totalCost || 0;
  const optionalCost = optionalParts.reduce((sum, p) => {
    if (!p.model) return sum;
    return sum + getPriceByModelAndSupplier(p.model, p.supplier) * (p.qty || 1);
  }, 0);
  const configCost = buildConfigParts().reduce((sum, p) => sum + (p.snapshotPrice || 0) * (p.qty || 1), 0);
  const capCost = capacitorModel ? getPriceByModelAndSupplier(capacitorModel, '') : 0;

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', pb: 10 }}>
    <Paper sx={{ p: { xs: 2, md: 3 } }}>
      {/* 标题 */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Box display="flex" alignItems="center" gap={1}>
          <IconButton onClick={() => navigate('/recipes')} size="small">
            <BackIcon />
          </IconButton>
          <Typography variant="h6">
            {isEditing ? '编辑配方' : cloneFrom ? '复制配方' : '录入配方'}
          </Typography>
        </Box>
      </Box>

      {/* ━━ Stepper ━━ */}
      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3 }}>
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

      {/* ━━ Step 0: 基本信息 + 泵壳模板 ━━ */}
      {activeStep === 0 && (<>

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

      {/* ━━ 泵壳模板选择 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'rgba(124, 58, 237, 0.05)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <TemplateIcon sx={{ fontSize: 16, color: '#7c3aed' }} />
          <Typography variant="caption" fontWeight={700} color="#7c3aed" sx={{ letterSpacing: 1 }}>
            ▸ 泵壳模板（固定配件）
          </Typography>
          {selectedTemplate && (
            <Chip
              label={`¥${templateCost.toFixed(2)}`}
              size="small"
              color="success"
              sx={{ ml: 'auto', fontWeight: 700 }}
            />
          )}
        </Box>
        <Box sx={{ px: 2, py: 1.5 }}>
          <FormControl size="small" sx={{ minWidth: 240, mb: selectedTemplate ? 1.5 : 0 }}>
            <InputLabel>选择泵壳模板</InputLabel>
            <Select
              value={selectedTemplateId || ''}
              label="选择泵壳模板"
              onChange={(e) => setSelectedTemplateId(e.target.value ? Number(e.target.value) : null)}
            >
              <MenuItem value="">
                <em>不使用模板</em>
              </MenuItem>
              {templates.map(t => (
                <MenuItem key={t.Id} value={t.Id}>
                  {t.shell_model}{t.description ? ` — ${t.description}` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* 模板配件预览（只读） */}
          {selectedTemplate && templateParts.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 1 }}>
              {templateParts.map((p, i) => {
                const supplier = p.supplier || '';
                const price = getPriceByModelAndSupplier(p.model, supplier);
                return (
                  <Box key={i} display="flex" justifyContent="space-between" alignItems="center"
                    sx={{ py: 0.25, fontSize: '0.8rem' }}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 70 }}>
                        {p.name}
                      </Typography>
                      <Chip label={p.model} size="small" variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem' }} />
                      {supplier && (
                        <Typography variant="caption" color="text.disabled">{supplier}</Typography>
                      )}
                      {p.qty > 1 && (
                        <Typography variant="caption" color="text.disabled">×{p.qty}</Typography>
                      )}
                    </Box>
                    <Typography variant="body2" sx={{
                      fontFamily: 'monospace',
                      color: price > 0 ? 'success.main' : 'error.main',
                      fontSize: '0.8rem'
                    }}>
                      ¥{(price * p.qty).toFixed(2)}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          )}

          {!selectedTemplate && (
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              选择泵壳模板后，固定配件(轴承/油封/螺丝等)将自动填入
            </Typography>
          )}
        </Box>
      </Paper>


      {/* Step navigation */}
      <Box display="flex" justifyContent="flex-end" mt={2}>
        <Button
          variant="contained"
          endIcon={<NextIcon />}
          onClick={() => setActiveStep(1)}
          disabled={!recipeName.trim()}
        >
          下一步：配件配置
        </Button>
      </Box>

      </>)}

      {/* ━━ Step 1: 配件配置 ━━ */}
      {activeStep === 1 && (<>

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

      {/* Step navigation */}
      <Box display="flex" justifyContent="space-between" mt={2}>
        <Button variant="outlined" startIcon={<PrevIcon />} onClick={() => setActiveStep(0)}>
          上一步
        </Button>
        <Button variant="contained" endIcon={<NextIcon />} onClick={() => setActiveStep(2)}>
          下一步：确认
        </Button>
      </Box>

      </>)}

      {/* ━━ Step 2: 工资 + 确认 + 保存 ━━ */}
      {activeStep === 2 && (<>

      {/* 人工工资（如果有模板则显示） */}
      {selectedTemplate && (
        <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, bgcolor: 'rgba(245, 158, 11, 0.06)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: 16 }}>👷</Typography>
            <Typography variant="caption" fontWeight={700} color="warning.main" sx={{ letterSpacing: 1 }}>
              ▸ 人工工资 & 管理费（元/台）
            </Typography>
            {laborCost > 0 && (
              <Chip label={`¥${laborCost.toFixed(2)}`} size="small" color="warning" sx={{ ml: 'auto', fontWeight: 700 }} />
            )}
          </Box>
          <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField label="安装工资" type="number" size="small"
              value={assemblyWage || ''} onChange={e => setAssemblyWage(parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 0.5 }} sx={{ width: 120 }} />
            <TextField label="打包工资" type="number" size="small"
              value={packingWage || ''} onChange={e => setPackingWage(parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 0.5 }} sx={{ width: 120 }} />
            <Box display="flex" alignItems="center" gap={1}>
              <FormControlLabel
                control={<Checkbox size="small" checked={paintingWage != null}
                  onChange={e => setPaintingWage(e.target.checked ? 0 : null)} />}
                label={<Typography variant="body2" sx={{ fontSize: '0.8rem' }}>需要喷漆</Typography>}
                sx={{ mr: 0 }}
              />
              {paintingWage != null && (
                <TextField label="喷漆工资" type="number" size="small"
                  value={paintingWage || ''} onChange={e => setPaintingWage(parseFloat(e.target.value) || 0)}
                  inputProps={{ min: 0, step: 0.5 }} sx={{ width: 120 }} />
              )}
            </Box>
            <TextField label="管理费用" type="number" size="small"
              value={managementFee || ''} onChange={e => setManagementFee(parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 0.5 }} sx={{ width: 120 }}
              helperText="系统默认值" />
          </Box>
        </Paper>
      )}

      {/* 配方概览 */}
      <Paper variant="outlined" sx={{ mb: 2, p: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>📋 配方概览</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">配方名称：<strong>{recipeName || '-'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">规格：<strong>{recipeSpec || '-'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">泵壳模板：<strong>{selectedTemplate?.shell_model || '未选择'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">线圈规格：<strong>{coilSpec ? `${coilSpec} / ${coilSheets}片` : '未配置'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">选配件数：<strong>{optionalParts.filter(p => p.model).length} 项</strong></Typography>
          <Typography variant="body2" color="text.secondary">人工合计：<strong>¥{laborCost.toFixed(2)}</strong></Typography>
        </Box>
      </Paper>

      {/* 保存按钮 */}
      <Button
        variant="contained"
        color="success"
        size="large"
        fullWidth
        startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
        onClick={handleSubmit}
        disabled={saving || !recipeName.trim() || (allPartsPreview.length === 0 && !selectedTemplateId)}
        sx={{ mt: 1 }}
      >
        {isEditing ? '更新配方' : '保存配方'}
      </Button>

      {/* Step navigation */}
      <Box display="flex" justifyContent="flex-start" mt={2}>
        <Button variant="outlined" startIcon={<PrevIcon />} onClick={() => setActiveStep(1)}>
          上一步
        </Button>
      </Box>

      </>)}
    </Paper>

    {/* ━━━ 浮动成本速览面板 ━━━ */}
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: { xs: 0, md: 240 },
        right: 0,
        zIndex: 1100,
        borderRadius: 0,
        borderTop: '2px solid',
        borderColor: 'primary.main',
        bgcolor: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(8px)',
        px: { xs: 2, md: 3 },
        py: 1.5,
      }}
    >
      <Box sx={{
        maxWidth: 960,
        mx: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 1.5, md: 3 },
        flexWrap: 'wrap',
      }}>
        {/* Section breakdowns */}
        {selectedTemplate && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>模板配件</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: '#7c3aed' }}>¥{templateCost.toFixed(0)}</Typography>
          </Box>
        )}
        {coilCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>线圈转子</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: '#7c3aed' }}>¥{coilCost.toFixed(0)}</Typography>
          </Box>
        )}
        {(optionalCost + capCost) > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>选配+电容</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: '#2563eb' }}>¥{(optionalCost + capCost).toFixed(0)}</Typography>
          </Box>
        )}
        {configCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>动态配置</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: '#2563eb' }}>¥{configCost.toFixed(0)}</Typography>
          </Box>
        )}
        {laborCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>人工+管理</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: '#d97706' }}>¥{laborCost.toFixed(0)}</Typography>
          </Box>
        )}

        {/* Total */}
        <Box sx={{ ml: 'auto', textAlign: 'right' }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>预估总成本</Typography>
          <Typography variant="h6" sx={{ fontWeight: 800, color: totalCost > 0 ? 'success.main' : 'text.disabled', fontSize: '1.25rem', lineHeight: 1.2 }}>
            ¥{totalCost.toFixed(2)}
          </Typography>
        </Box>
      </Box>
    </Paper>
    </Box>
  );
}
