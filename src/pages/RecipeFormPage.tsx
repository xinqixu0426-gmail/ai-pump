import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Paper,
  Typography,
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Button,
} from '@mui/material';
import { ArrowLeft as BackIcon, Save as SaveIcon } from 'lucide-react';
import { RecipePart, TemplatePart, PartSelection } from '../types';
import { createRecipe, updateRecipe, proxyRequest } from '../utils/api';
import { useAppStore } from '../utils/store';
import { getPriceByModelAndSupplier as _getPrice, getModelsByCategory as _getModelsByCategory, getSuppliersByModel as _getSuppliersByModel } from '../utils/partHelpers';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { colors } from '../utils/theme';

import { COIL_API_BASE, CoilCalcResult, CoilSpecInfo } from '../components/recipe/recipeFormConstants';
import StepTemplateSelect from '../components/recipe/StepTemplateSelect';
import StepPartsConfig from '../components/recipe/StepPartsConfig';
import StepWageConfirm from '../components/recipe/StepWageConfirm';

export default function RecipeFormPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const locState = location.state as {
    cloneFrom?: any;
    editFrom?: any;
  } | null;
  const cloneFrom = locState?.cloneFrom;
  const editFrom = locState?.editFrom;
  const isEditing = !!editFrom;
  const initApplied = useRef(false);

  const { parts, fetchParts, templates, fetchTemplates, showSnackbar } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
  const [packingParts, setPackingParts] = useState<Array<PartSelection & { id: number }>>([]);
  const nextPackingId = useRef(100);

  // 不锈钢自定义机筒长度
  const [customBarrelLength, setCustomBarrelLength] = useState(
    editFrom?.custom_barrel_length ? String(editFrom.custom_barrel_length) :
    (cloneFrom?.custom_barrel_length ? String(cloneFrom.custom_barrel_length) : '')
  );

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

  // 表单离开保护：有模板/线圈/名称/选配即为有未保存内容
  const isDirty = !!selectedTemplateId || coilSpec !== '' || recipeName !== '' || optionalParts.length > 0;
  useUnsavedChanges(isDirty && !saving);

  // 读取管理费默认值（仅新建时）
  useEffect(() => {
    if (editFrom || cloneFrom) return;
    (async () => {
      try {
        const res = await fetch('/api/settings/management_fee', { credentials: 'include' });
        const json = await res.json();
        if (json.success) setManagementFee(parseFloat(json.data.value) || 0);
      } catch { /* */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      try {
        const json = await proxyRequest<{ success: boolean; data: CoilSpecInfo[] }>(`${COIL_API_BASE}/api/coils/specs`);
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
      const json = await proxyRequest<{ success: boolean; data: CoilCalcResult }>(`${COIL_API_BASE}/api/coils/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
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

  // 线圈结果联动
  useEffect(() => {
    if (!coilResult) return;
    if (coilResult.wireGauge) {
      setFloatWire(coilResult.wireGauge);
      setCableWire(coilResult.wireGauge);
    }
    if (coilResult.capacitor) {
      // 从线圈表的 default_capacitor 提取纯数值 (如 "18"→18, "20uF"→20, "12μF"→12)
      const rawCap = String(coilResult.capacitor).replace(/[uUμfFvV\s]/g, '').trim();
      const capValue = parseFloat(rawCap);
      if (!isNaN(capValue)) {
        // 精确匹配标准化格式 "{capValue}μF"
        const capParts = parts.filter(p => p.category === '电容');
        const exact = capParts.find(p => p.model === `${capValue}μF`);
        // 回退：兼容旧格式
        const fuzzy = exact || capParts.find(p => {
          const m = p.model.replace(/[uUμfFvV\s]/g, '').trim();
          return m === String(capValue);
        });
        if (fuzzy) setCapacitorModel(fuzzy.model);
        else setCapacitorModel('');
      }
    } else {
      setCapacitorModel('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coilResult]);

  // 编辑/复制预填
  useEffect(() => {
    const source = editFrom || cloneFrom;
    if (!source || initApplied.current || parts.length === 0) return;
    initApplied.current = true;

    if (source.template_id) {
      setSelectedTemplateId(source.template_id);
      if (source.coil_spec) setCoilSpec(source.coil_spec);
      if (source.coil_sheets) setCoilSheets(String(source.coil_sheets));
      setHasFloat(!!source.has_float);
      if (source.float_wire) setFloatWire(source.float_wire);
      setHasCable(!!source.has_cable);
      if (source.cable_length) setCableLength(String(source.cable_length));
      if (source.cable_wire) setCableWire(source.cable_wire);
      // 读取 packing_parts_json，向后兼容旧 box_type
      const rawPacking: PartSelection[] = (() => {
        try {
          const arr = JSON.parse(source.packing_parts_json || '[]');
          if (arr.length > 0) return arr;
          if (source.box_type) return [{ model: source.box_type, supplier: '', qty: 1 }];
          return [];
        } catch { return source.box_type ? [{ model: source.box_type, supplier: '', qty: 1 }] : []; }
      })();
      setPackingParts(rawPacking.map(p => ({ id: nextPackingId.current++, ...p })));
      if (source.custom_barrel_length) setCustomBarrelLength(String(source.custom_barrel_length));

      try {
        const extras = JSON.parse(source.extra_parts_json || '[]');
        setOptionalParts(extras.map((p: PartSelection) => ({ id: nextOptionalId.current++, ...p })));
      } catch { /* */ }
      return;
    }

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
        if (cp.name === '纸箱' || cp.name === '木箱') {
          setPackingParts(prev => [...prev, { id: nextPackingId.current++, model: cp.model, supplier: '', qty: 1 }]);
          return;
        }
        newOptional.push({ id: nextOptionalId.current++, model: cp.model, supplier: cp.supplier, qty: cp.qty });
      });
      setOptionalParts(newOptional);
    } catch (e) {
      console.error('解析配方失败', e);
    }
  }, [editFrom, cloneFrom, parts]);

  // ── 辅助函数 ──
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


  const selectedTemplate = templates.find(t => t.Id === selectedTemplateId) || null;
  const templateParts: TemplatePart[] = (() => {
    if (!selectedTemplate) return [];
    try { return JSON.parse(selectedTemplate.parts_json || '[]'); } catch { return []; }
  })();

  const shellMetaInfo = useMemo(() => {
    if (!selectedTemplate) return null;
    const shellPart = parts.find(p => p.model === selectedTemplate.shell_model && p.category === '泵壳');
    if (!shellPart || !shellPart.notes) return null;
    try { return JSON.parse(shellPart.notes); } catch { return null; }
  }, [selectedTemplate, parts]);

  useEffect(() => {
    if (selectedTemplate) {
      setAssemblyWage(selectedTemplate.assembly_wage || 0);
      setPackingWage(selectedTemplate.packing_wage || 0);
      setPaintingWage(selectedTemplate.painting_wage);
    }
  }, [selectedTemplateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shellPrice = selectedTemplate ? getPriceByModelAndSupplier(selectedTemplate.shell_model, '') : 0;
  const templateCost = shellPrice + templateParts.reduce((sum, p) => sum + getPriceByModelAndSupplier(p.model, p.supplier || '') * p.qty, 0);

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
    // 包装件
    packingParts.forEach(p => {
      if (!p.model) return;
      const price = getPriceByModelAndSupplier(p.model, p.supplier);
      configParts.push({ model: p.model, name: p.model, supplier: p.supplier, qty: p.qty || 1, snapshotPrice: price });
    });
    return configParts;
  }, [hasFloat, floatWire, hasCable, cableLength, cableWire, packingParts, getPriceByModelAndSupplier]);

  const buildAllParts = useCallback((): RecipePart[] => {
    const all: RecipePart[] = [];
    // 泵壳本体
    if (selectedTemplate) {
      const sp = getPriceByModelAndSupplier(selectedTemplate.shell_model, '');
      all.push({ model: selectedTemplate.shell_model, name: '泵壳', supplier: '', qty: 1, snapshotPrice: sp });
    }
    templateParts.forEach(p => {
      const supplier = p.supplier || '';
      const price = getPriceByModelAndSupplier(p.model, supplier);
      all.push({ model: p.model, name: p.name, supplier, qty: p.qty, snapshotPrice: price });
    });
    if (capacitorModel) {
      all.push({ model: capacitorModel, name: '电容', supplier: '', qty: 1, snapshotPrice: getPriceByModelAndSupplier(capacitorModel, '') });
    }
    if (coilResult && coilSpec && coilSheets) {
      all.push({ model: `${coilSpec}-${coilSheets}`, name: '线圈转子', supplier: '', qty: 1, snapshotPrice: coilResult.totalCost });
    }
    optionalParts.forEach((p) => {
      if (p.model) all.push({ model: p.model, name: p.model, supplier: p.supplier, qty: p.qty, snapshotPrice: getPriceByModelAndSupplier(p.model, p.supplier) });
    });
    all.push(...buildConfigParts());
    return all;
  }, [selectedTemplate, templateParts, capacitorModel, optionalParts, buildConfigParts, getPriceByModelAndSupplier, coilResult, coilSpec, coilSheets]);

  const allPartsPreview = useMemo(() => buildAllParts(), [buildAllParts]);
  const laborCost = useMemo(() => (assemblyWage || 0) + (packingWage || 0) + (paintingWage || 0) + (managementFee || 0), [assemblyWage, packingWage, paintingWage, managementFee]);
  const partsCost = useMemo(() => allPartsPreview.reduce((sum, p) => sum + (p.snapshotPrice || 0) * (p.qty || 1), 0), [allPartsPreview]);
  const packingCost = useMemo(
    () => packingParts.filter(p => p.model).reduce((sum, p) => sum + getPriceByModelAndSupplier(p.model, p.supplier) * (p.qty || 1), 0),
    [packingParts, getPriceByModelAndSupplier]
  );
  const totalCost = partsCost + laborCost;

  const handleAddOptional = () => setOptionalParts((prev) => [...prev, { id: nextOptionalId.current++, model: '', supplier: '', qty: 1 }]);
  const handleOptionalChange = (id: number, field: keyof PartSelection, value: string | number) => {
    setOptionalParts((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const updated = { ...p, [field]: value };
      if (field === 'model') updated.supplier = '';
      return updated;
    }));
  };
  const handleRemoveOptional = (id: number) => setOptionalParts((prev) => prev.filter((p) => p.id !== id));

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
      name: recipeName, spec: recipeSpec, parts_json: JSON.stringify(recipeParts),
      saved_total_cost: savedTotalCost, saved_cost_details: savedCostDetails,
      template_id: selectedTemplateId, coil_spec: coilSpec, coil_sheets: coilSheets ? parseInt(coilSheets) : 0,
      has_float: hasFloat ? 1 : 0, float_wire: floatWire, has_cable: hasCable ? 1 : 0,
      cable_length: cableLength ? parseFloat(cableLength) : 0, cable_wire: cableWire,
      // 包装
      packing_parts_json: JSON.stringify(
        packingParts.filter(p => p.model).map(p => ({ model: p.model, supplier: p.supplier, qty: p.qty }))
      ),
      custom_barrel_length: customBarrelLength ? parseFloat(customBarrelLength) : null,
      extra_parts_json: JSON.stringify(optionalParts.filter(p => p.model).map(p => ({ model: p.model, supplier: p.supplier, qty: p.qty }))),
      assembly_wage: assemblyWage, packing_wage: packingWage, painting_wage: paintingWage, management_fee: managementFee,
    };

    setSaving(true);
    try {
      if (isEditing && editFrom) await updateRecipe(editFrom.id, recipeData);
      else await createRecipe(recipeData);
      showSnackbar('配方已保存', 'success');
      navigate('/recipes');
    } catch {
      setError('保存配方失败');
      setSaving(false);
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>;
  }

  const coilCostDisplay = coilResult?.totalCost || 0;
  const optionalCost = optionalParts.reduce((sum, p) => p.model ? sum + getPriceByModelAndSupplier(p.model, p.supplier) * (p.qty || 1) : sum, 0);
  const configCost = buildConfigParts().reduce((sum, p) => sum + (p.snapshotPrice || 0) * (p.qty || 1), 0);
  const capCost = capacitorModel ? getPriceByModelAndSupplier(capacitorModel, '') : 0;

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', pb: 10 }}>
    <Paper sx={{ p: { xs: 2, md: 3 } }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Box display="flex" alignItems="center" gap={1}>
          <IconButton onClick={() => navigate('/recipes')} size="small"><BackIcon size={20} /></IconButton>
          <Typography variant="h6">{isEditing ? '编辑配方' : cloneFrom ? '复制配方' : '录入配方'}</Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <StepTemplateSelect
        recipeName={recipeName} setRecipeName={setRecipeName}
        recipeSpec={recipeSpec} setRecipeSpec={setRecipeSpec}
        selectedTemplateId={selectedTemplateId} setSelectedTemplateId={setSelectedTemplateId}
        templates={templates} templateParts={templateParts} templateCost={templateCost}
        getPriceByModelAndSupplier={getPriceByModelAndSupplier} shellMetaInfo={shellMetaInfo}
        customBarrelLength={customBarrelLength} setCustomBarrelLength={setCustomBarrelLength}
      />

        <StepPartsConfig
          coilSpecs={coilSpecs} coilSpec={coilSpec} setCoilSpec={setCoilSpec}
          coilSheets={coilSheets} setCoilSheets={setCoilSheets}
          useCoilCustomWeight={useCoilCustomWeight} setUseCoilCustomWeight={setUseCoilCustomWeight}
          coilCustomWireWeight={coilCustomWireWeight} setCoilCustomWireWeight={setCoilCustomWireWeight}
          coilResult={coilResult} coilLoading={coilLoading}
          capacitorModel={capacitorModel} capacitorPrice={capCost}
          optionalParts={optionalParts} handleAddOptional={handleAddOptional}
          handleOptionalChange={handleOptionalChange} handleRemoveOptional={handleRemoveOptional}
          hasFloat={hasFloat} setHasFloat={setHasFloat} floatWire={floatWire} setFloatWire={setFloatWire}
          hasCable={hasCable} setHasCable={setHasCable} cableLength={cableLength} setCableLength={setCableLength}
          cableWire={cableWire} setCableWire={setCableWire}
          packingParts={packingParts}
          setPackingParts={setPackingParts}
          parts={parts} getPriceByModelAndSupplier={getPriceByModelAndSupplier}
          getSuppliersByModel={getSuppliersByModel} getModelsByCategory={getModelsByCategory}
        />

      <StepWageConfirm
        selectedTemplate={selectedTemplate} assemblyWage={assemblyWage} setAssemblyWage={setAssemblyWage}
        packingWage={packingWage} setPackingWage={setPackingWage} paintingWage={paintingWage} setPaintingWage={setPaintingWage}
        managementFee={managementFee} setManagementFee={setManagementFee} laborCost={laborCost}
        recipeName={recipeName} recipeSpec={recipeSpec} coilSpec={coilSpec} coilSheets={coilSheets}
        optionalParts={optionalParts}
      />

      <Button
        variant="contained"
        color="success"
        size="large"
        fullWidth
        startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon size={18} />}
        onClick={handleSubmit}
        disabled={saving || !recipeName.trim() || (allPartsPreview.length === 0 && !selectedTemplateId)}
        sx={{ mt: 2 }}
      >
        完成保存
      </Button>
    </Paper>

    {/* 浮动面板 */}
    <Paper elevation={8} sx={{ position: 'fixed', bottom: 0, left: { xs: 0, md: 240 }, right: 0, zIndex: 1100, borderRadius: 0, borderTop: '2px solid', borderColor: 'primary.main', bgcolor: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(8px)', px: { xs: 2, md: 3 }, py: 1.5 }}>
      <Box sx={{ maxWidth: 960, mx: 'auto', display: 'flex', alignItems: 'center', gap: { xs: 1.5, md: 3 }, flexWrap: 'wrap' }}>
        {selectedTemplate && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>模板(含泵壳)</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.purple.main }}>¥{templateCost.toFixed(0)}</Typography>
          </Box>
        )}
        {coilCostDisplay > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>线圈转子</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.purple.main }}>¥{coilCostDisplay.toFixed(0)}</Typography>
          </Box>
        )}
        {(optionalCost + capCost) > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>选配+电容</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.blue.text }}>¥{(optionalCost + capCost).toFixed(0)}</Typography>
          </Box>
        )}
        {configCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>动态配置</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.blue.text }}>¥{configCost.toFixed(0)}</Typography>
          </Box>
        )}
        {packingCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>📦 包装</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.amber.dark }}>¥{packingCost.toFixed(0)}</Typography>
          </Box>
        )}
        {laborCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>人工+管理</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.amber.dark }}>¥{laborCost.toFixed(0)}</Typography>
          </Box>
        )}
        <Box sx={{ ml: 'auto', textAlign: 'right' }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>预估总成本</Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: totalCost > 0 ? 'success.main' : 'text.disabled', fontSize: '1.25rem', lineHeight: 1.2 }}>
            ¥{totalCost.toFixed(2)}
          </Typography>
        </Box>
      </Box>
    </Paper>

    </Box>
  );
}
