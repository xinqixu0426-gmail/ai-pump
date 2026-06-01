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
import { CableAccessoryConfig, CableAccessoryType, RecipePart, TemplatePart, ShellComponent, PartSelection, SurfaceTreatmentMode, Recipe } from '../types';
import { createRecipe, updateRecipe, proxyRequest } from '../utils/api';
import { useAppStore } from '../utils/store';
import { getPriceByModelAndSupplier as _getPrice, getCableAccessoryFee as _getCableAccessoryFee, getCableAccessoryName as _getCableAccessoryName, getModelsByCategory as _getModelsByCategory, getSuppliersByModel as _getSuppliersByModel } from '../utils/partHelpers';
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
    editFrom?.templateId || cloneFrom?.templateId || null
  );

  // 线圈转子
  const [coilSpecs, setCoilSpecs] = useState<CoilSpecInfo[]>([]);
  const [coilSpec, setCoilSpec] = useState(editFrom?.coilSpec || cloneFrom?.coilSpec || '');
  const [coilMaterial, setCoilMaterial] = useState(editFrom?.coilMaterial || cloneFrom?.coilMaterial || '钢带');
  const [coilSheets, setCoilSheets] = useState(editFrom?.coilSheets ? String(editFrom.coilSheets) : (cloneFrom?.coilSheets ? String(cloneFrom.coilSheets) : ''));
  const [coilCustomWireWeight, setCoilCustomWireWeight] = useState('');
  const [useCoilCustomWeight, setUseCoilCustomWeight] = useState(false);
  const [coilResult, setCoilResult] = useState<CoilCalcResult | null>(null);
  const [coilLoading, setCoilLoading] = useState(false);

  // 选配配件
  const [optionalParts, setOptionalParts] = useState<Array<PartSelection & { id: number }>>([]);
  const nextOptionalId = useRef(1);

  // 动态配置
  const [hasFloat, setHasFloat] = useState(!!editFrom?.hasFloat || !!cloneFrom?.hasFloat);
  const [floatWire, setFloatWire] = useState(editFrom?.floatWire || cloneFrom?.floatWire || '0.55');
  const [hasCable, setHasCable] = useState(!!editFrom?.hasCable || !!cloneFrom?.hasCable);
  const [cableLength, setCableLength] = useState(editFrom?.cableLength ? String(editFrom.cableLength) : (cloneFrom?.cableLength ? String(cloneFrom.cableLength) : ''));
  const [cableWire, setCableWire] = useState(editFrom?.cableWire || cloneFrom?.cableWire || '0.55');
  const [cableAccessoryType, setCableAccessoryType] = useState<CableAccessoryType>(editFrom?.cableAccessoryType || cloneFrom?.cableAccessoryType || 'standard');
  const [cableAccessoryConfig, setCableAccessoryConfig] = useState<CableAccessoryConfig | null>(null);
  const [packingParts, setPackingParts] = useState<Array<PartSelection & { id: number }>>([]);
  const nextPackingId = useRef(100);

  // 不锈钢自定义机筒长度
  const [customBarrelLength, setCustomBarrelLength] = useState(
    editFrom?.customBarrelLength ? String(editFrom.customBarrelLength) :
    (cloneFrom?.customBarrelLength ? String(cloneFrom.customBarrelLength) : '')
  );

  // 电容（从线圈联动）
  const [capacitorModel, setCapacitorModel] = useState('');

  // 人工工资
  const [assemblyWage, setAssemblyWage] = useState(editFrom?.assemblyWage ?? cloneFrom?.assemblyWage ?? 0);
  const [packingWage, setPackingWage] = useState(editFrom?.packingWage ?? cloneFrom?.packingWage ?? 0);
  const [surfaceTreatmentMode, setSurfaceTreatmentMode] = useState<SurfaceTreatmentMode>(
    editFrom?.surfaceTreatmentMode ?? cloneFrom?.surfaceTreatmentMode ??
    ((editFrom?.paintingWage ?? cloneFrom?.paintingWage) != null ? 'painting' : 'none')
  );
  const [surfaceTreatmentCost, setSurfaceTreatmentCost] = useState(
    editFrom?.surfaceTreatmentCost ?? cloneFrom?.surfaceTreatmentCost ??
    editFrom?.paintingWage ?? cloneFrom?.paintingWage ?? 0
  );

  // 管理费用
  const [managementFee, setManagementFee] = useState(editFrom?.managementFee ?? cloneFrom?.managementFee ?? 0);

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
    proxyRequest<{ success: boolean; data: { value: string } }>('/api/settings/cable_accessories')
      .then(({ data }) => setCableAccessoryConfig(JSON.parse(data.value)))
      .catch(() => setCableAccessoryConfig(null));
  }, []);

  useEffect(() => {
    if (editFrom || cloneFrom) return;
    (async () => {
      try {
        const json = await proxyRequest<{ success: boolean; data: { value: string } }>('/api/settings/management_fee');
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

  useEffect(() => {
    if (!coilSpec || coilSpecs.length === 0) return;
    const info = coilSpecs.find(s => s.spec === coilSpec);
    if (!info) return;
    const materials = info.materials?.length ? info.materials : [info.material || '钢带'];
    if (!materials.includes(coilMaterial)) setCoilMaterial(materials[0] || '钢带');
  }, [coilMaterial, coilSpec, coilSpecs]);

  const calculateCoilCost = useCallback(async (spec: string, material: string, sheets: string, customWeight?: string) => {
    if (!spec || !sheets) { setCoilResult(null); return; }
    try {
      setCoilLoading(true);
      const body: Record<string, unknown> = { spec, material: material || '钢带', sheets: parseInt(sheets) };
      if (customWeight) body.wireWeight = parseFloat(customWeight);
      const json = await proxyRequest<{ success: boolean; data: CoilCalcResult }>(`${COIL_API_BASE}/api/coils/calculate`, {
        method: 'POST',
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
      calculateCoilCost(coilSpec, coilMaterial, coilSheets, useCoilCustomWeight ? coilCustomWireWeight : undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [coilSpec, coilMaterial, coilSheets, coilCustomWireWeight, useCoilCustomWeight, calculateCoilCost]);

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

    if (source.templateId) {
      setSelectedTemplateId(source.templateId);
      if (source.coilSpec) setCoilSpec(source.coilSpec);
      if (source.coilMaterial) setCoilMaterial(source.coilMaterial);
      if (source.coilSheets) setCoilSheets(String(source.coilSheets));
      setHasFloat(!!source.hasFloat);
      if (source.floatWire) setFloatWire(source.floatWire);
      setHasCable(!!source.hasCable);
      if (source.cableLength) setCableLength(String(source.cableLength));
      if (source.cableWire) setCableWire(source.cableWire);
      if (source.cableAccessoryType) setCableAccessoryType(source.cableAccessoryType);
      // 读取 packingPartsJson，向后兼容旧 boxType
      const rawPacking: PartSelection[] = (() => {
        try {
          const arr = JSON.parse(source.packingPartsJson || '[]');
          if (arr.length > 0) return arr;
          if (source.boxType) return [{ model: source.boxType, supplier: '', qty: 1 }];
          return [];
        } catch { return source.boxType ? [{ model: source.boxType, supplier: '', qty: 1 }] : []; }
      })();
      setPackingParts(rawPacking.map(p => ({ id: nextPackingId.current++, ...p })));
      if (source.customBarrelLength) setCustomBarrelLength(String(source.customBarrelLength));

      try {
        const extras = JSON.parse(source.extraPartsJson || '[]');
        setOptionalParts(extras.map((p: PartSelection) => ({ id: nextOptionalId.current++, ...p })));
      } catch { /* */ }
      return;
    }

    try {
      const srcParts: RecipePart[] = JSON.parse(source.partsJson);
      const newOptional: Array<PartSelection & { id: number }> = [];
      srcParts.forEach((cp) => {
        if (cp.name === '线圈转子') {
          if (cp.material) setCoilMaterial(cp.material);
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
  const getCableAccessoryFee = useCallback(
    (model: string, supplier: string, accessoryType: CableAccessoryType = 'standard') => _getCableAccessoryFee(parts, model, supplier, accessoryType, cableAccessoryConfig),
    [parts, cableAccessoryConfig]
  );
  const getCableAccessoryName = useCallback(
    (model: string, supplier: string, accessoryType: CableAccessoryType = 'standard') => _getCableAccessoryName(parts, model, supplier, accessoryType, cableAccessoryConfig),
    [parts, cableAccessoryConfig]
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
  const selectedTemplateCostMode = selectedTemplate?.costMode || 'components';
  const templateParts: TemplatePart[] = (() => {
    if (!selectedTemplate) return [];
    try { return JSON.parse(selectedTemplate.partsJson || '[]'); } catch { return []; }
  })();
  const shellComponents: ShellComponent[] = (() => {
    if (!selectedTemplate) return [];
    try {
      const parsed = JSON.parse(selectedTemplate.shellComponentsJson || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  })();

  const shellMetaInfo = useMemo(() => {
    if (!selectedTemplate) return null;
    const shellPart = parts.find(p => p.model === selectedTemplate.shellModel && p.category === '泵壳');
    if (!shellPart || !shellPart.notes) return null;
    try { return JSON.parse(shellPart.notes); } catch { return null; }
  }, [selectedTemplate, parts]);

  useEffect(() => {
    if (selectedTemplate) {
      setAssemblyWage(selectedTemplate.assemblyWage || 0);
      setPackingWage(selectedTemplate.packingWage || 0);
    }
  }, [selectedTemplateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const getTemplatePartPrice = useCallback((p: TemplatePart) => {
    return getPriceByModelAndSupplier(p.model, p.supplier || '');
  }, [getPriceByModelAndSupplier]);
  const shellPrice = selectedTemplate && selectedTemplateCostMode === 'bundle'
    ? Number(selectedTemplate.bundleCost || 0)
    : shellComponents.reduce((sum, c) => {
        if (c.included === false) return sum;
        const qty = c.pricingMode === 'lengthCm'
          ? Number(customBarrelLength || shellMetaInfo?.barrelLength || Number(c.qty || 0) * 10) / 10
          : Number(c.qty || 1);
        return sum + Number(c.unitCost || 0) * qty;
      }, 0);
  const templateCost = selectedTemplate
    ? shellPrice + templateParts.reduce((sum, p) => sum + getTemplatePartPrice(p) * p.qty, 0)
    : 0;

  const buildConfigParts = useCallback((): RecipePart[] => {
    const configParts: RecipePart[] = [];
    if (hasFloat) {
      const model = `浮球-线径${floatWire}`;
      configParts.push({ model, name: '浮球', supplier: '', qty: 1, snapshotPrice: getPriceByModelAndSupplier(model, '') });
    }
    if (hasCable && cableLength && Number(cableLength) > 0) {
      const cableModel = `电缆-线径${cableWire}`;
      configParts.push({ model: cableModel, name: '电缆线', supplier: '', qty: Number(cableLength), snapshotPrice: getPriceByModelAndSupplier(cableModel, '') });
      configParts.push({ model: '电缆配件费', name: getCableAccessoryName(cableModel, '', cableAccessoryType), supplier: '', qty: 1, snapshotPrice: getCableAccessoryFee(cableModel, '', cableAccessoryType), cableAccessoryType });
    }
    // 包装件
    packingParts.forEach(p => {
      if (!p.model) return;
      const price = getPriceByModelAndSupplier(p.model, p.supplier);
      configParts.push({ model: p.model, name: p.model, supplier: p.supplier, qty: p.qty || 1, snapshotPrice: price });
    });
    return configParts;
  }, [hasFloat, floatWire, hasCable, cableLength, cableWire, cableAccessoryType, packingParts, getPriceByModelAndSupplier, getCableAccessoryFee, getCableAccessoryName]);

  const buildAllParts = useCallback((): RecipePart[] => {
    const all: RecipePart[] = [];
    if (selectedTemplate) {
      if (selectedTemplateCostMode === 'bundle') {
        all.push({ model: selectedTemplate.shellModel, name: '泵壳整套', supplier: '', qty: 1, snapshotPrice: shellPrice, source: 'pump_shell_template', costSource: 'manual' });
      } else {
        shellComponents.forEach(c => {
          if (c.included === false) return;
          const qty = c.pricingMode === 'lengthCm'
            ? Number(customBarrelLength || shellMetaInfo?.barrelLength || Number(c.qty || 0) * 10) / 10
            : Number(c.qty || 1);
          all.push({
            model: c.model || c.name,
            name: c.pricingMode === 'lengthCm' ? `${c.name}(按cm)` : c.name,
            supplier: '',
            qty,
            snapshotPrice: Number(c.unitCost || 0),
            source: 'pump_shell_template',
            costSource: 'manual'
          });
        });
      }
    }
    templateParts.forEach(p => {
      const supplier = p.supplier || '';
      const price = getTemplatePartPrice(p);
      all.push({ model: p.model, name: p.name, supplier, qty: p.qty, snapshotPrice: price });
    });
    if (capacitorModel) {
      all.push({ model: capacitorModel, name: '电容', supplier: '', qty: 1, snapshotPrice: getPriceByModelAndSupplier(capacitorModel, '') });
    }
    if (coilResult && coilSpec && coilSheets) {
      all.push({
        model: `${coilSpec}-${coilSheets}`,
        name: '线圈转子',
        supplier: '',
        qty: 1,
        snapshotPrice: coilResult.totalCost,
        material: coilResult.material || coilMaterial,
        unitPrice: coilResult.unitPrice,
        source: coilResult.source,
        formula: coilResult.formula,
      });
    }
    optionalParts.forEach((p) => {
      if (p.model) all.push({ model: p.model, name: p.model, supplier: p.supplier, qty: p.qty, snapshotPrice: getPriceByModelAndSupplier(p.model, p.supplier) });
    });
    all.push(...buildConfigParts());
    return all;
  }, [selectedTemplate, selectedTemplateCostMode, shellPrice, shellComponents, customBarrelLength, shellMetaInfo, templateParts, capacitorModel, optionalParts, buildConfigParts, getTemplatePartPrice, getPriceByModelAndSupplier, coilResult, coilSpec, coilMaterial, coilSheets]);

  const allPartsPreview = useMemo(() => buildAllParts(), [buildAllParts]);
  const laborCost = useMemo(
    () => (assemblyWage || 0) + (packingWage || 0) + (surfaceTreatmentCost || 0) + (managementFee || 0),
    [assemblyWage, packingWage, surfaceTreatmentCost, managementFee]
  );
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
    const surfaceLabels: Record<SurfaceTreatmentMode, string> = {
      none: '无处理',
      painting: '喷漆',
      electrophoresis: '电泳',
      powder_coating: '喷塑',
    };
    if (surfaceTreatmentMode !== 'none') wageLines.push(`表面处理(${surfaceLabels[surfaceTreatmentMode]}): ¥${(surfaceTreatmentCost || 0).toFixed(2)}`);
    wageLines.push(`管理费用: ¥${(managementFee || 0).toFixed(2)}`);
    const savedCostDetails = recipeParts
      .map((p) => {
        const base = `${p.name || p.model}: ¥${(p.snapshotPrice || 0).toFixed(2)} × ${p.qty || 1} = ¥${((p.snapshotPrice || 0) * (p.qty || 1)).toFixed(2)}`;
        if (p.name === '线圈转子') {
          return `${base}（材质: ${p.material || coilMaterial || '钢带'}，单价: ¥${Number(p.unitPrice || 0).toFixed(2)}，来源: ${p.source || '-'}，公式: ${p.formula || '-'}）`;
        }
        return base;
      })
      .concat(wageLines)
      .join('\n');

    const recipeData: Omit<Recipe, 'Id'> = {
      name: recipeName, spec: recipeSpec, partsJson: JSON.stringify(recipeParts),
      savedTotalCost: savedTotalCost, savedCostDetails: savedCostDetails,
      templateId: selectedTemplateId, coilSpec: coilSpec, coilMaterial: coilMaterial || '钢带', coilSheets: coilSheets ? parseInt(coilSheets) : 0,
      hasFloat: hasFloat ? 1 : 0, floatWire: floatWire, hasCable: hasCable ? 1 : 0,
      cableLength: cableLength ? parseFloat(cableLength) : 0, cableWire: cableWire,
      cableAccessoryType,
      // 包装
      packingPartsJson: JSON.stringify(
        packingParts.filter(p => p.model).map(p => ({ model: p.model, supplier: p.supplier, qty: p.qty }))
      ),
      customBarrelLength: customBarrelLength ? parseFloat(customBarrelLength) : null,
      extraPartsJson: JSON.stringify(optionalParts.filter(p => p.model).map(p => ({ model: p.model, supplier: p.supplier, qty: p.qty }))),
      assemblyWage: assemblyWage,
      packingWage: packingWage,
      paintingWage: null,
      surfaceTreatmentMode: surfaceTreatmentMode,
      surfaceTreatmentCost: surfaceTreatmentMode === 'none' ? 0 : surfaceTreatmentCost,
      managementFee: managementFee,
    };

    setSaving(true);
    try {
      if (isEditing && editFrom) await updateRecipe(editFrom.Id, recipeData);
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
          <IconButton aria-label="返回配方管理" onClick={() => navigate('/recipes')} size="small"><BackIcon size={20} /></IconButton>
          <Typography variant="h6">{isEditing ? '编辑配方' : cloneFrom ? '复制配方' : '录入配方'}</Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <StepTemplateSelect
        recipeName={recipeName} setRecipeName={setRecipeName}
        recipeSpec={recipeSpec} setRecipeSpec={setRecipeSpec}
        selectedTemplateId={selectedTemplateId} setSelectedTemplateId={setSelectedTemplateId}
        templates={templates} templateParts={templateParts} shellComponents={shellComponents} templateCost={templateCost}
        getPriceByModelAndSupplier={getPriceByModelAndSupplier} shellMetaInfo={shellMetaInfo}
        customBarrelLength={customBarrelLength} setCustomBarrelLength={setCustomBarrelLength}
      />

        <StepPartsConfig
          coilSpecs={coilSpecs} coilSpec={coilSpec} setCoilSpec={setCoilSpec}
          coilMaterial={coilMaterial} setCoilMaterial={setCoilMaterial}
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
          cableAccessoryType={cableAccessoryType} setCableAccessoryType={setCableAccessoryType}
          cableAccessoryConfig={cableAccessoryConfig}
          packingParts={packingParts}
          setPackingParts={setPackingParts}
          parts={parts} getPriceByModelAndSupplier={getPriceByModelAndSupplier}
          getSuppliersByModel={getSuppliersByModel} getModelsByCategory={getModelsByCategory}
        />

      <StepWageConfirm
        selectedTemplate={selectedTemplate} assemblyWage={assemblyWage} setAssemblyWage={setAssemblyWage}
        packingWage={packingWage} setPackingWage={setPackingWage}
        surfaceTreatmentMode={surfaceTreatmentMode} setSurfaceTreatmentMode={setSurfaceTreatmentMode}
        surfaceTreatmentCost={surfaceTreatmentCost} setSurfaceTreatmentCost={setSurfaceTreatmentCost}
        managementFee={managementFee} setManagementFee={setManagementFee} laborCost={laborCost}
        recipeName={recipeName} recipeSpec={recipeSpec} coilSpec={coilSpec} coilSheets={coilSheets}
        optionalParts={optionalParts}
        capacitorModel={capacitorModel}
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
