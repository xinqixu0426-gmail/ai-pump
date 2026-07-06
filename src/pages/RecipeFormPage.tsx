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
  Popover,
  Divider,
  Chip,
} from '@mui/material';
import { ArrowLeft as BackIcon, Save as SaveIcon } from 'lucide-react';
import { CableAccessoryConfig, CableAccessoryType, PumpModelVariant, RecipePart, TemplatePart, PartSelection, SurfaceTreatmentMode, RecipeBomDraftResult } from '../types';
import { createModelVariant, createPart, createRecipe, updateRecipe, proxyRequest, getAllModelVariants, previewRecipeBomDraft } from '../utils/api';
import { useAppStore } from '../utils/store';
import { getPriceByModelAndSupplier as _getPrice, getCableAccessoryFee as _getCableAccessoryFee, getCableAccessoryName as _getCableAccessoryName, getModelsByCategory as _getModelsByCategory, getSuppliersByModel as _getSuppliersByModel } from '../utils/partHelpers';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { colors } from '../utils/theme';
import {
  DEFAULT_COIL_MATERIAL,
  DEFAULT_FLOAT_ACCESSORY_DELTA,
  isLongScrewPart,
  longScrewPriceByModel,
  wireOptionsFromParts,
} from '../utils/businessRules';
import { buildConfigParts as buildConfigRecipeParts, buildRecipeBomParts, calculateShellPrice } from '../utils/recipeBomBuilder';

import { COIL_API_BASE, CoilCalcResult, CoilSpecInfo } from '../components/recipe/recipeFormConstants';
import StepTemplateSelect from '../components/recipe/StepTemplateSelect';
import StepPartsConfig from '../components/recipe/StepPartsConfig';
import StepWageConfirm from '../components/recipe/StepWageConfirm';
import StepTechnicalData, { parseTechnicalDataJson } from '../components/recipe/StepTechnicalData';
import { buildTechnicalReferenceFields } from '../utils/technicalReferences';
import { calculateRecipeCostSummary } from '../utils/recipeCostSummary';
import { buildOptionalSelectionsFromRecipe, buildPackingSelectionsFromRecipe, parseLegacyRecipeParts } from '../utils/recipePrefill';
import { buildRecipeTemplateContext } from '../utils/recipeTemplateContext';
import { buildCoilCalculateBody, resolveCoilLinkedSelections } from '../utils/recipeCoilForm';
import { buildRecipeBomDraftPayload, shouldRequestRecipeBomDraft } from '../utils/recipeBomDraftPayload';
import {
  addOptionalPart,
  emptyImpellerFields,
  recipeFieldsFromVariant,
  removeOptionalPart,
  updateOptionalPart,
} from '../utils/recipeFormActions';
import { prepareRecipeSubmission } from '../utils/recipeSubmitFlow';

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
  const promptedMissingParts = useRef<Set<string>>(new Set());

  const { parts, fetchParts, templates, fetchTemplates, showSnackbar } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [bomDraft, setBomDraft] = useState<RecipeBomDraftResult | null>(null);

  // 基本信息
  const [recipeName, setRecipeName] = useState(editFrom?.name || cloneFrom?.name || '');
  const [recipeSpec, setRecipeSpec] = useState(editFrom?.spec || cloneFrom?.spec || '');
  const [modelVariants, setModelVariants] = useState<PumpModelVariant[]>([]);
  const [selectedModelVariantId, setSelectedModelVariantId] = useState<number | null>(
    editFrom?.modelVariantId || cloneFrom?.modelVariantId || null
  );
  const [impellerModel, setImpellerModel] = useState(editFrom?.impellerModel || cloneFrom?.impellerModel || '');
  const [impellerThickness, setImpellerThickness] = useState(
    editFrom?.impellerThickness ? String(editFrom.impellerThickness) : (cloneFrom?.impellerThickness ? String(cloneFrom.impellerThickness) : '')
  );
  const [impellerDiameter, setImpellerDiameter] = useState(
    editFrom?.impellerDiameter ? String(editFrom.impellerDiameter) : (cloneFrom?.impellerDiameter ? String(cloneFrom.impellerDiameter) : '')
  );
  const [impellerBladeCount, setImpellerBladeCount] = useState(
    editFrom?.impellerBladeCount ? String(editFrom.impellerBladeCount) : (cloneFrom?.impellerBladeCount ? String(cloneFrom.impellerBladeCount) : '')
  );
  const [technicalData, setTechnicalData] = useState(() => parseTechnicalDataJson(editFrom?.technicalDataJson || cloneFrom?.technicalDataJson));
  const [costDetailAnchor, setCostDetailAnchor] = useState<HTMLElement | null>(null);
  const [saveAsPreset, setSaveAsPreset] = useState(false);

  // 泵壳模板选择
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    editFrom?.templateId || cloneFrom?.templateId || null
  );

  // 线圈转子
  const [coilSpecs, setCoilSpecs] = useState<CoilSpecInfo[]>([]);
  const [coilSpec, setCoilSpec] = useState(editFrom?.coilSpec || cloneFrom?.coilSpec || '');
  const [coilMaterial, setCoilMaterial] = useState(editFrom?.coilMaterial || cloneFrom?.coilMaterial || DEFAULT_COIL_MATERIAL);
  const [coilSheets, setCoilSheets] = useState(editFrom?.coilSheets ? String(editFrom.coilSheets) : (cloneFrom?.coilSheets ? String(cloneFrom.coilSheets) : ''));
  const [coilCustomWireWeight, setCoilCustomWireWeight] = useState('');
  const [useCoilCustomWeight, setUseCoilCustomWeight] = useState(false);
  const [coilResult, setCoilResult] = useState<CoilCalcResult | null>(null);
  const [coilLoading, setCoilLoading] = useState(false);

  // 选配配件
  const [optionalParts, setOptionalParts] = useState<Array<PartSelection & { id: number }>>([]);
  const nextOptionalId = useRef(1);

  // 动态配置
  const [hasFloat, setHasFloat] = useState(editFrom ? !!editFrom.hasFloat : cloneFrom ? !!cloneFrom.hasFloat : true);
  const [floatWire, setFloatWire] = useState(editFrom?.floatWire || cloneFrom?.floatWire || '');
  const [floatAccessoryType, setFloatAccessoryType] = useState<CableAccessoryType>(editFrom?.floatAccessoryType || cloneFrom?.floatAccessoryType || 'standard');
  const [floatAccessoryDelta, setFloatAccessoryDelta] = useState(DEFAULT_FLOAT_ACCESSORY_DELTA);
  const [hasCable, setHasCable] = useState(!!editFrom?.hasCable || !!cloneFrom?.hasCable);
  const [cableLength, setCableLength] = useState(editFrom?.cableLength ? String(editFrom.cableLength) : (cloneFrom?.cableLength ? String(cloneFrom.cableLength) : ''));
  const [cableWire, setCableWire] = useState(editFrom?.cableWire || cloneFrom?.cableWire || '');
  const [cableAccessoryType, setCableAccessoryType] = useState<CableAccessoryType>(editFrom?.cableAccessoryType || cloneFrom?.cableAccessoryType || 'standard');
  const [cableAccessoryConfig, setCableAccessoryConfig] = useState<CableAccessoryConfig | null>(null);
  const [packingParts, setPackingParts] = useState<Array<PartSelection & { id: number }>>([]);
  const nextPackingId = useRef(100);
  const getInventoryWireGauges = useCallback((prefix: string) => wireOptionsFromParts(parts, prefix), [parts]);
  const floatWireOptions = useMemo(() => getInventoryWireGauges('浮球-线径'), [getInventoryWireGauges]);
  const cableWireOptions = useMemo(() => getInventoryWireGauges('电缆-线径'), [getInventoryWireGauges]);

  useEffect(() => {
    setFloatWire((current: string) => floatWireOptions.includes(current) ? current : (floatWireOptions[0] || ''));
    setCableWire((current: string) => cableWireOptions.includes(current) ? current : (cableWireOptions[0] || ''));
  }, [floatWireOptions, cableWireOptions]);

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

  useEffect(() => {
    getAllModelVariants().then(setModelVariants).catch(() => setModelVariants([]));
  }, []);

  // 表单离开保护：覆盖模板、常用配置、线圈、选配、机筒、叶轮和技术档案。
  const hasImpellerData = [impellerModel, impellerThickness, impellerDiameter, impellerBladeCount]
    .some(v => String(v || '').trim() !== '');
  const hasTechnicalData = Object.values(technicalData).some(v => String(v || '').trim() !== '');
  const isDirty = !!selectedTemplateId || !!selectedModelVariantId || coilSpec !== '' || recipeName !== ''
    || optionalParts.length > 0 || customBarrelLength !== '' || hasImpellerData || hasTechnicalData;
  useUnsavedChanges(isDirty && !saving);

  // 读取管理费默认值（仅新建时）
  useEffect(() => {
    proxyRequest<{ success: boolean; data: { value: string } }>('/api/settings/cable_accessories')
      .then(({ data }) => setCableAccessoryConfig(JSON.parse(data.value)))
      .catch(() => setCableAccessoryConfig(null));
    proxyRequest<{ success: boolean; data: { value: string } }>('/api/settings/float_accessory_delta')
      .then(({ data }) => {
        const delta = Number(data.value);
        setFloatAccessoryDelta(Number.isFinite(delta) && delta >= 0 ? delta : DEFAULT_FLOAT_ACCESSORY_DELTA);
      })
      .catch(() => setFloatAccessoryDelta(DEFAULT_FLOAT_ACCESSORY_DELTA));
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
    const materials = info.materials?.length ? info.materials : [info.material || DEFAULT_COIL_MATERIAL];
    if (!materials.includes(coilMaterial)) setCoilMaterial(materials[0] || DEFAULT_COIL_MATERIAL);
  }, [coilMaterial, coilSpec, coilSpecs]);

  const calculateCoilCost = useCallback(async (spec: string, material: string, sheets: string, customWeight?: string) => {
    if (!spec || !sheets) { setCoilResult(null); return; }
    try {
      setCoilLoading(true);
      const body = buildCoilCalculateBody({ spec, material, sheets, customWeight });
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
    const linked = resolveCoilLinkedSelections({ coilResult, floatWireOptions, cableWireOptions, parts });
    if (linked.nextFloatWire) setFloatWire(linked.nextFloatWire);
    if (linked.nextCableWire) setCableWire(linked.nextCableWire);
    setCapacitorModel(linked.capacitorModel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coilResult, floatWireOptions, cableWireOptions, parts]);

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
      if (source.floatWire) setFloatWire(floatWireOptions.includes(source.floatWire) ? source.floatWire : (floatWireOptions[0] || ''));
      if (source.floatAccessoryType) setFloatAccessoryType(source.floatAccessoryType);
      setHasCable(!!source.hasCable);
      if (source.cableLength) setCableLength(String(source.cableLength));
      if (source.cableWire) setCableWire(cableWireOptions.includes(source.cableWire) ? source.cableWire : (cableWireOptions[0] || ''));
      if (source.cableAccessoryType) setCableAccessoryType(source.cableAccessoryType);
      const rawPacking = buildPackingSelectionsFromRecipe(source);
      setPackingParts(rawPacking.map(p => ({ id: nextPackingId.current++, ...p })));
      if (source.customBarrelLength) setCustomBarrelLength(String(source.customBarrelLength));
      if (source.modelVariantId) setSelectedModelVariantId(source.modelVariantId);
      if (source.impellerModel) setImpellerModel(source.impellerModel);
      if (source.impellerThickness) setImpellerThickness(String(source.impellerThickness));
      if (source.impellerDiameter) setImpellerDiameter(String(source.impellerDiameter));
      if (source.impellerBladeCount) setImpellerBladeCount(String(source.impellerBladeCount));
      setTechnicalData(parseTechnicalDataJson(source.technicalDataJson));

      setOptionalParts(buildOptionalSelectionsFromRecipe(source).map(p => ({ id: nextOptionalId.current++, ...p })));
      return;
    }

    const legacy = parseLegacyRecipeParts(source.partsJson, floatWireOptions, cableWireOptions);
    if (legacy.coilMaterial) setCoilMaterial(legacy.coilMaterial);
    if (legacy.coilSpec) setCoilSpec(legacy.coilSpec);
    if (legacy.coilSheets) setCoilSheets(legacy.coilSheets);
    if (legacy.hasFloat) setHasFloat(true);
    if (legacy.floatWire) setFloatWire(legacy.floatWire);
    if (legacy.floatAccessoryType) setFloatAccessoryType(legacy.floatAccessoryType);
    if (legacy.hasCable) setHasCable(true);
    if (legacy.cableWire) setCableWire(legacy.cableWire);
    if (legacy.cableLength) setCableLength(legacy.cableLength);
    if (legacy.packingParts.length > 0) {
      setPackingParts(legacy.packingParts.map(p => ({ id: nextPackingId.current++, ...p })));
    }
    setOptionalParts(legacy.optionalParts.map(p => ({ id: nextOptionalId.current++, ...p })));
  }, [editFrom, cloneFrom, parts, floatWireOptions, cableWireOptions]);

  // ── 辅助函数 ──
  const getPriceByModelAndSupplier = useCallback(
    (model: string, supplier: string) => longScrewPriceByModel(parts, model, supplier) ?? _getPrice(parts, model, supplier),
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
  const selectedModelVariant = modelVariants.find(v => v.Id === selectedModelVariantId) || null;
  const {
    selectedTemplateCostMode,
    shellComponents,
    shellMetaInfo,
    effectiveBarrelLength,
    effectiveLongScrewExtraLength,
    adjustedTemplateParts,
  } = useMemo(() => buildRecipeTemplateContext({
    selectedTemplate,
    selectedModelVariant,
    parts,
    customBarrelLength,
  }), [selectedTemplate, selectedModelVariant, parts, customBarrelLength]);

  const shellTechnicalReferences = useMemo(
    () => buildTechnicalReferenceFields({ shellMetaInfo, selectedTemplate }),
    [selectedTemplate, shellMetaInfo]
  );

  useEffect(() => {
    if (selectedTemplate) {
      setAssemblyWage(selectedTemplate.assemblyWage || 0);
      setPackingWage(selectedTemplate.packingWage || 0);
    }
  }, [selectedTemplateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const getTemplatePartPrice = useCallback((p: TemplatePart) => {
    if (isLongScrewPart(p)) {
      return longScrewPriceByModel(parts, p.model, p.supplier || '') ?? getPriceByModelAndSupplier(p.model, p.supplier || '');
    }
    return getPriceByModelAndSupplier(p.model, p.supplier || '');
  }, [parts, getPriceByModelAndSupplier]);
  const shellPrice = calculateShellPrice({
    selectedTemplate,
    costMode: selectedTemplateCostMode,
    shellComponents,
    customBarrelLength: effectiveBarrelLength,
  });
  const templateCost = selectedTemplate
    ? shellPrice + adjustedTemplateParts.reduce((sum, p) => sum + getTemplatePartPrice(p) * p.qty, 0)
    : 0;

  const buildConfigParts = useCallback((): RecipePart[] => {
    return buildConfigRecipeParts({
      hasFloat,
      floatWire,
      floatAccessoryType,
      floatAccessoryDelta,
      hasCable,
      cableLength,
      cableWire,
      cableAccessoryType,
      packingParts,
      getPriceByModelAndSupplier,
      getCableAccessoryFee,
      getCableAccessoryName,
    });
  }, [hasFloat, floatWire, floatAccessoryType, floatAccessoryDelta, hasCable, cableLength, cableWire, cableAccessoryType, packingParts, getPriceByModelAndSupplier, getCableAccessoryFee, getCableAccessoryName]);

  const buildAllParts = useCallback((): RecipePart[] => {
    return buildRecipeBomParts({
      selectedTemplate,
      selectedTemplateCostMode,
      shellPrice,
      shellComponents,
      customBarrelLength: effectiveBarrelLength,
      templateParts: adjustedTemplateParts,
      capacitorModel,
      optionalParts,
      coilResult,
      coilSpec,
      coilMaterial,
      coilSheets,
      configParts: buildConfigParts(),
      getTemplatePartPrice,
      getPriceByModelAndSupplier,
    });
  }, [selectedTemplate, selectedTemplateCostMode, shellPrice, shellComponents, effectiveBarrelLength, adjustedTemplateParts, capacitorModel, optionalParts, buildConfigParts, getTemplatePartPrice, getPriceByModelAndSupplier, coilResult, coilSpec, coilMaterial, coilSheets]);

  const localPartsPreview = useMemo(() => buildAllParts(), [buildAllParts]);
  const bomDraftPayload = useMemo(() => buildRecipeBomDraftPayload({
    selectedTemplateId,
    selectedModelVariantId,
    effectiveBarrelLength,
    effectiveLongScrewExtraLength,
    coilSpec,
    coilSheets,
    coilMaterial,
    coilResult,
    capacitorModel,
    optionalParts,
    hasFloat,
    floatWire,
    floatAccessoryType,
    floatAccessoryDelta,
    hasCable,
    cableLength,
    cableWire,
    cableAccessoryType,
    packingParts,
  }), [
    selectedTemplateId, selectedModelVariantId, effectiveBarrelLength, effectiveLongScrewExtraLength,
    coilSpec, coilSheets, coilMaterial, coilResult, capacitorModel, optionalParts,
    hasFloat, floatWire, floatAccessoryType, floatAccessoryDelta, hasCable, cableLength, cableWire,
    cableAccessoryType, packingParts,
  ]);
  useEffect(() => {
    let cancelled = false;
    if (!shouldRequestRecipeBomDraft({ selectedTemplateId, optionalParts, hasFloat, hasCable, packingParts })) {
      setBomDraft(null);
      return;
    }
    previewRecipeBomDraft(bomDraftPayload)
      .then(result => { if (!cancelled) setBomDraft(result); })
      .catch(() => { if (!cancelled) setBomDraft(null); });
    return () => { cancelled = true; };
  }, [bomDraftPayload, selectedTemplateId, optionalParts, hasFloat, hasCable, packingParts]);
  const allPartsPreview = bomDraft?.parts || localPartsPreview;
  const laborCost = useMemo(
    () => (assemblyWage || 0) + (packingWage || 0) + (surfaceTreatmentCost || 0) + (managementFee || 0),
    [assemblyWage, packingWage, surfaceTreatmentCost, managementFee]
  );
  const configPartsPreview = useMemo(() => buildConfigParts(), [buildConfigParts]);
  const costSummary = useMemo(() => calculateRecipeCostSummary({
    allPartsPreview,
    templateCost,
    selectedTemplate,
    coilResult,
    optionalParts,
    capacitorModel,
    configParts: configPartsPreview,
    packingParts,
    laborCost,
    getPriceByModelAndSupplier,
  }), [
    allPartsPreview, templateCost, selectedTemplate, coilResult, optionalParts, capacitorModel,
    configPartsPreview, packingParts, laborCost, getPriceByModelAndSupplier,
  ]);
  const costDetailGroups = useMemo(() => {
    const row = (label: string, amount: number, note = '', issue = false) => ({ label, amount, note, issue });
    const packingLibraryPrice = (model: string, supplier = '') => {
      const candidates = parts.filter(p => p.category === '包装' && p.model.trim() === String(model || '').trim());
      const normalizedSupplier = String(supplier || '').trim();
      const exact = candidates.find(p => normalizedSupplier && String(p.supplier || '').trim() === normalizedSupplier);
      if (exact) return exact.price;
      return candidates.length ? candidates.reduce((min, p) => p.price < min.price ? p : min, candidates[0]).price : 0;
    };
    const groups = [
      {
        title: '模板',
        items: selectedTemplate ? [
          row(selectedTemplateCostMode === 'bundle' ? '整套泵壳' : '泵壳组件', shellPrice, selectedTemplate.shellModel || ''),
          ...adjustedTemplateParts.map(part => {
            const unitPrice = getTemplatePartPrice(part);
            return row(part.name || part.model, unitPrice * Number(part.qty || 1), `${part.model}${part.qty > 1 ? ` ×${part.qty}` : ''}`, unitPrice <= 0);
          }),
        ] : [],
      },
      {
        title: '线圈',
        items: [
          ...(coilResult ? [row('线圈转子', coilResult.totalCost || 0, `${coilSpec || '-'} / ${coilSheets || '-'}片`)] : []),
          ...(capacitorModel ? [row('电容', getPriceByModelAndSupplier(capacitorModel, ''), capacitorModel, getPriceByModelAndSupplier(capacitorModel, '') <= 0)] : []),
        ],
      },
      {
        title: '选配',
        items: optionalParts
          .filter(part => part.model)
          .map(part => {
            const unitPrice = part.costSource === 'manual' ? Number(part.snapshotPrice || 0) : getPriceByModelAndSupplier(part.model, part.supplier);
            return row(part.model, unitPrice * Number(part.qty || 1), `${part.supplier || '默认'}${Number(part.qty || 1) > 1 ? ` ×${part.qty}` : ''}`, unitPrice <= 0);
          }),
      },
      {
        title: '动态',
        items: configPartsPreview
          .filter(part => !part.packagingMaterial)
          .map(part => row(part.name || part.model, Number(part.snapshotPrice || 0) * Number(part.qty || 1), `${part.model}${Number(part.qty || 1) > 1 ? ` ×${part.qty}` : ''}`, Number(part.snapshotPrice || 0) <= 0)),
      },
      {
        title: '包装',
        items: packingParts
          .filter(part => part.model)
          .map(part => {
            const unitPrice = part.costSource === 'manual' ? Number(part.snapshotPrice || 0) : packingLibraryPrice(part.model, part.supplier);
            const qty = Number(part.qty || 1);
            return row(part.model, unitPrice * qty, `${part.packagingMaterial || '包材'} / ${part.supplier || '默认'}${qty > 1 ? ` ×${qty}` : ''}`, unitPrice <= 0);
          }),
      },
      {
        title: '人工',
        items: [
          row('安装工资', Number(assemblyWage || 0)),
          row('打包工资', Number(packingWage || 0)),
          row(surfaceTreatmentMode === 'painting' ? '喷漆' : surfaceTreatmentMode === 'electrophoresis' ? '电泳' : '表面处理', Number(surfaceTreatmentCost || 0)),
          row('管理费', Number(managementFee || 0)),
        ].filter(item => item.amount > 0),
      },
    ];
    return groups.filter(group => group.items.length > 0);
  }, [
    parts, selectedTemplate, selectedTemplateCostMode, shellPrice, adjustedTemplateParts, getTemplatePartPrice,
    coilResult, coilSpec, coilSheets, capacitorModel, getPriceByModelAndSupplier, optionalParts,
    configPartsPreview, packingParts, assemblyWage, packingWage, surfaceTreatmentMode, surfaceTreatmentCost, managementFee,
  ]);
  const costIssueCount = useMemo(
    () => costDetailGroups.reduce((sum, group) => sum + group.items.filter(item => item.issue).length, 0),
    [costDetailGroups]
  );
  const costDetailOpen = Boolean(costDetailAnchor);

  const handleAddOptional = () => setOptionalParts((prev) => addOptionalPart(prev, nextOptionalId.current++));

  const resetImpeller = () => {
    const fields = emptyImpellerFields();
    setImpellerModel(fields.impellerModel);
    setImpellerThickness(fields.impellerThickness);
    setImpellerDiameter(fields.impellerDiameter);
    setImpellerBladeCount(fields.impellerBladeCount);
  };

  const applyModelVariant = (variantId: number | null) => {
    setSelectedModelVariantId(variantId);
    const variant = modelVariants.find(v => v.Id === variantId);
    if (!variant) {
      setSaveAsPreset(false);
      return;
    }
    const fields = recipeFieldsFromVariant(variant);
    setRecipeName(fields.recipeName);
    setRecipeSpec(fields.recipeSpec);
    setSelectedTemplateId(fields.selectedTemplateId);
    setCoilSpec(fields.coilSpec);
    setCoilMaterial(fields.coilMaterial);
    setCoilSheets(fields.coilSheets);
    setCustomBarrelLength(fields.customBarrelLength);
    setImpellerModel(fields.impellerModel);
    setImpellerThickness(fields.impellerThickness);
    setImpellerDiameter(fields.impellerDiameter);
    setImpellerBladeCount(fields.impellerBladeCount);
  };
  const handleTemplateSelect = (templateId: number | null) => {
    setSelectedModelVariantId(null);
    resetImpeller();
    setSelectedTemplateId(templateId);
  };
  const handleOptionalChange = (id: number, field: keyof PartSelection, value: string | number) => {
    setOptionalParts((prev) => updateOptionalPart(prev, id, field, value));
  };
  const handleRemoveOptional = (id: number) => setOptionalParts((prev) => removeOptionalPart(prev, id));

  useEffect(() => {
    const candidate = optionalParts.find((part) => {
      const model = String(part.model || '').trim();
      const supplier = String(part.supplier || '').trim();
      const price = Number(part.snapshotPrice || 0);
      if (!model || !supplier || price <= 0) return false;
      const exists = parts.some(p => p.model.trim() === model && p.supplier.trim() === supplier);
      if (exists) return false;
      const key = `${model}||${supplier}||${price}`;
      return !promptedMissingParts.current.has(key);
    });
    if (!candidate) return;

    const model = candidate.model.trim();
    const supplier = candidate.supplier.trim();
    const price = Number(candidate.snapshotPrice || 0);
    const key = `${model}||${supplier}||${price}`;

    let cancelled = false;
    const addMissingPart = async () => {
      if (cancelled || promptedMissingParts.current.has(key)) return;
      promptedMissingParts.current.add(key);
      const confirmed = window.confirm(`零件管理中没有「${model} / ${supplier}」。是否添加到零件管理？\n单价：¥${price.toFixed(3)}`);
      if (!confirmed || cancelled) return;
      try {
        await createPart({
          model,
          category: '配件',
          price,
          supplier,
          stock: 0,
          notes: JSON.stringify({ autoCreatedFrom: 'recipeOptionalPart' }),
        });
        await fetchParts(true);
        setOptionalParts(prev => prev.map(part => (
          part.id === candidate.id
            ? { ...part, costSource: undefined, snapshotPrice: undefined }
            : part
        )));
        showSnackbar(`已添加零件：${model}`, 'success');
      } catch (err) {
        promptedMissingParts.current.delete(key);
        setError(err instanceof Error ? err.message : '新增零件失败');
      }
    };
    const timer = window.setTimeout(addMissingPart, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [optionalParts, parts, fetchParts, showSnackbar]);

  useEffect(() => {
    const candidate = packingParts.find((part) => {
      const model = String(part.model || '').trim();
      const supplier = String(part.supplier || '').trim();
      const price = Number(part.snapshotPrice || 0);
      if (!model || !supplier || price <= 0 || part.costSource !== 'manual') return false;
      const exists = parts.some(p => (
        p.category === '包装'
        && p.model.trim() === model
        && p.supplier.trim() === supplier
      ));
      if (exists) return false;
      const key = `packing||${model}||${supplier}||${price}`;
      return !promptedMissingParts.current.has(key);
    });
    if (!candidate) return;

    const model = candidate.model.trim();
    const supplier = candidate.supplier.trim();
    const price = Number(candidate.snapshotPrice || 0);
    const packagingMaterial = String(candidate.packagingMaterial || '').trim();
    const key = `packing||${model}||${supplier}||${price}`;

    let cancelled = false;
    const addMissingPackingPart = async () => {
      if (cancelled || promptedMissingParts.current.has(key)) return;
      promptedMissingParts.current.add(key);
      const materialText = packagingMaterial ? `\n类型：${packagingMaterial}` : '';
      const confirmed = window.confirm(`零件管理中没有包材「${model} / ${supplier}」。是否添加到零件管理？\n单价：¥${price.toFixed(3)}${materialText}`);
      if (!confirmed || cancelled) return;
      try {
        await createPart({
          model,
          category: '包装',
          price,
          supplier,
          stock: 0,
          notes: JSON.stringify({ autoCreatedFrom: 'recipePackingPart', packagingMaterial }),
        });
        await fetchParts(true);
        setPackingParts(prev => prev.map(part => (
          part.id === candidate.id
            ? { ...part, costSource: undefined, snapshotPrice: undefined }
            : part
        )));
        showSnackbar(`已添加包材：${model}`, 'success');
      } catch (err) {
        promptedMissingParts.current.delete(key);
        setError(err instanceof Error ? err.message : '新增包材失败');
      }
    };
    const timer = window.setTimeout(addMissingPackingPart, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [packingParts, parts, fetchParts, showSnackbar]);

  const handleSubmit = async () => {
    if (!recipeName.trim()) { setError('请输入配方名称'); return; }
    let recipeParts = bomDraft?.parts || buildAllParts();
    if (recipeParts.length === 0 && !selectedTemplateId) { setError('请选择泵壳模板或至少添加一个配件'); return; }
    if (saveAsPreset && !selectedTemplateId) { setError('保存为常用配置前，请先选择泵壳模板'); return; }

    try {
      const recipeData = await prepareRecipeSubmission({
        recipeName,
        recipeSpec,
        recipeParts,
        selectedTemplateId,
        coilSpec,
        coilMaterial,
        coilSheets,
        hasFloat,
        floatWire,
        floatAccessoryType,
        hasCable,
        cableLength,
        cableWire,
        cableAccessoryType,
        packingParts,
        customBarrelLength,
        effectiveBarrelLength,
        effectiveLongScrewExtraLength,
        selectedModelVariantId,
        impellerModel,
        impellerThickness,
        impellerDiameter,
        impellerBladeCount,
        technicalData,
        optionalParts,
        assemblyWage,
        packingWage,
        surfaceTreatmentMode,
        surfaceTreatmentCost,
        managementFee,
      });
      setSaving(true);
      if (isEditing && editFrom) await updateRecipe(editFrom.Id, recipeData);
      else await createRecipe(recipeData);
      if (saveAsPreset && selectedTemplateId) {
        try {
          await createModelVariant({
            modelName: recipeName.trim(),
            templateId: selectedTemplateId,
            coilSpec,
            coilSheets: coilSheets ? Number(coilSheets) : 0,
            coilMaterial,
            barrelLength: effectiveBarrelLength ? Number(effectiveBarrelLength) : null,
            longScrewExtraLength: Number(effectiveLongScrewExtraLength || 0),
            impellerModel: impellerModel.trim(),
            impellerThickness: impellerThickness ? Number(impellerThickness) : null,
            impellerDiameter: impellerDiameter ? Number(impellerDiameter) : null,
            impellerBladeCount: impellerBladeCount ? Number(impellerBladeCount) : null,
            note: recipeSpec.trim(),
          });
        } catch (presetErr) {
          showSnackbar(presetErr instanceof Error ? `配方已保存，常用配置保存失败：${presetErr.message}` : '配方已保存，常用配置保存失败', 'warning');
          navigate('/recipes');
          return;
        }
      }
      showSnackbar('配方已保存', 'success');
      navigate('/recipes');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存配方失败');
      setSaving(false);
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>;
  }

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
        selectedTemplateId={selectedTemplateId} onTemplateSelect={handleTemplateSelect}
        modelVariants={modelVariants}
        selectedModelVariantId={selectedModelVariantId}
        onModelVariantSelect={applyModelVariant}
        templates={templates} templateParts={adjustedTemplateParts} shellComponents={shellComponents} templateCost={templateCost}
        getPriceByModelAndSupplier={getPriceByModelAndSupplier} shellMetaInfo={shellMetaInfo}
        effectiveBarrelLength={effectiveBarrelLength}
        customBarrelLength={customBarrelLength} setCustomBarrelLength={setCustomBarrelLength}
        saveAsPreset={saveAsPreset}
        setSaveAsPreset={setSaveAsPreset}
        canSaveAsPreset={!!selectedTemplateId && !!recipeName.trim()}
        isEditing={isEditing}
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
          floatAccessoryType={floatAccessoryType} setFloatAccessoryType={setFloatAccessoryType}
          floatAccessoryDelta={floatAccessoryDelta}
          hasCable={hasCable} setHasCable={setHasCable} cableLength={cableLength} setCableLength={setCableLength}
          cableWire={cableWire} setCableWire={setCableWire}
          cableAccessoryType={cableAccessoryType} setCableAccessoryType={setCableAccessoryType}
          cableAccessoryConfig={cableAccessoryConfig}
          packingParts={packingParts}
          setPackingParts={setPackingParts}
          parts={parts} getPriceByModelAndSupplier={getPriceByModelAndSupplier}
          getSuppliersByModel={getSuppliersByModel} getModelsByCategory={getModelsByCategory}
        />

        <StepTechnicalData
          value={technicalData}
          onChange={setTechnicalData}
          referenceFields={shellTechnicalReferences}
          impellerModel={impellerModel}
          onImpellerModelChange={setImpellerModel}
          impellerThickness={impellerThickness}
          onImpellerThicknessChange={setImpellerThickness}
          impellerDiameter={impellerDiameter}
          onImpellerDiameterChange={setImpellerDiameter}
          impellerBladeCount={impellerBladeCount}
          onImpellerBladeCountChange={setImpellerBladeCount}
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
        {costSummary.showTemplateCost && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>模板(含泵壳)</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.purple.main }}>¥{costSummary.templateCost.toFixed(0)}</Typography>
          </Box>
        )}
        {costSummary.coilCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>线圈转子</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.purple.main }}>¥{costSummary.coilCost.toFixed(0)}</Typography>
          </Box>
        )}
        {costSummary.optionAndCapacitorCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>选配+电容</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.blue.text }}>¥{costSummary.optionAndCapacitorCost.toFixed(0)}</Typography>
          </Box>
        )}
        {costSummary.configCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>动态配置</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.blue.text }}>¥{costSummary.configCost.toFixed(0)}</Typography>
          </Box>
        )}
        {costSummary.packingCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>📦 包装</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.amber.dark }}>¥{costSummary.packingCost.toFixed(0)}</Typography>
          </Box>
        )}
        {costSummary.laborCost > 0 && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>人工+管理</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', color: colors.amber.dark }}>¥{costSummary.laborCost.toFixed(0)}</Typography>
          </Box>
        )}
        <Button
          size="small"
          variant={costDetailOpen ? 'contained' : 'outlined'}
          color={costIssueCount > 0 ? 'warning' : 'primary'}
          onClick={(event) => setCostDetailAnchor(event.currentTarget)}
          sx={{ minWidth: 74, fontWeight: 700 }}
        >
          明细{costIssueCount > 0 ? ` ${costIssueCount}` : ''}
        </Button>
        <Box sx={{ ml: 'auto', textAlign: 'right' }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', display: 'block', lineHeight: 1 }}>预估总成本</Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: costSummary.totalCost > 0 ? 'success.main' : 'text.disabled', fontSize: '1.25rem', lineHeight: 1.2 }}>
            ¥{costSummary.totalCost.toFixed(2)}
          </Typography>
        </Box>
      </Box>
    </Paper>
    <Popover
      open={costDetailOpen}
      anchorEl={costDetailAnchor}
      onClose={() => setCostDetailAnchor(null)}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      PaperProps={{
        sx: {
          width: { xs: 'calc(100vw - 24px)', sm: 520 },
          maxHeight: { xs: '70vh', sm: 560 },
          p: 1.5,
          borderRadius: 2,
          overflow: 'auto',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>成本明细</Typography>
        {costIssueCount > 0 && <Chip size="small" color="warning" label={`${costIssueCount} 项待处理`} sx={{ ml: 1, fontWeight: 700 }} />}
        <Typography variant="subtitle2" sx={{ ml: 'auto', fontWeight: 800, color: 'success.main' }}>¥{costSummary.totalCost.toFixed(2)}</Typography>
      </Box>
      <Divider sx={{ mb: 1 }} />
      <Box sx={{ display: 'grid', gap: 1 }}>
        {costDetailGroups.map(group => {
          const groupTotal = group.items.reduce((sum, item) => sum + item.amount, 0);
          return (
            <Box key={group.title}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.4 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>{group.title}</Typography>
                <Typography variant="caption" sx={{ ml: 'auto', fontWeight: 800 }}>¥{groupTotal.toFixed(2)}</Typography>
              </Box>
              <Box sx={{ display: 'grid', gap: 0.35 }}>
                {group.items.map((item, index) => (
                  <Box key={`${group.title}-${item.label}-${index}`} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 1, alignItems: 'baseline' }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap title={item.label} sx={{ fontWeight: item.issue ? 800 : 600, color: item.issue ? 'error.main' : 'text.primary', lineHeight: 1.35 }}>
                        {item.label}
                      </Typography>
                      {item.note && (
                        <Typography variant="caption" color="text.disabled" noWrap title={item.note} sx={{ display: 'block', lineHeight: 1.25 }}>
                          {item.note}
                        </Typography>
                      )}
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: item.issue ? 'error.main' : 'text.primary' }}>
                      {item.issue ? '未找到' : `¥${item.amount.toFixed(2)}`}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Popover>

  </Box>
  );
}
