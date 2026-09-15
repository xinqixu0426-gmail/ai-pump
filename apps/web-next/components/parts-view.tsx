'use client';

import { useBusinessRefresh } from '@/lib/use-business-refresh';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  PackageMinus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  createPart,
  deletePart,
  deleteParts,
  getAllParts,
  getSettingValue,
  partBusinessSettingUpdate,
  partStockStatus,
  updatePart,
  type Part,
  type PartInput,
  type PartStockStatus,
} from '@/lib/parts';
import {
  BUILTIN_CATEGORIES,
  PACKAGING_SUBCATEGORIES,
  DEFAULT_FLOAT_ACCESSORY_DELTA,
  DEFAULT_STANDARD_CABLE_ACCESSORY_NAME,
  DEFAULT_XINJIE_CABLE_ACCESSORY_NAME,
  buildCableAccessorySettingsValue,
  buildPartRemark,
  finalPartModel,
  isCapacitorCategory,
  modelFieldsFromPart,
  parseCableAccessoryMeta,
  parseFloatAccessoryDelta,
  parsePumpShellMeta,
  parseScrewPricingMetaFromRemark,
  validatePartForm,
  wireOptionsFromParts,
  wirePrefixForCategory,
} from '@/lib/part-form-rules';
import { getCatalogNamingRules, previewCatalogName, type CatalogNamingRule } from '@/lib/catalog-naming';
import { money } from '@/lib/format';
import {
  mergeUntouchedPartSettings,
  partSettingFields,
  type PartSettingField,
} from '@/lib/part-settings-form-state';
import { FadePanel } from '@/components/motion/fade-panel';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea, selectInputValueOnFocus } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge } from '@/components/ui/status-badge';
import { useConfirmDiscard } from '@/hooks/use-confirm-discard';

export type QuickFilter = 'all' | 'attention' | PartStockStatus | 'noSupplier' | 'noPrice';

type PendingPartAction =
  | { kind: 'duplicate'; continueEntry: boolean; model: string }
  | { kind: 'delete'; part: Part }
  | { kind: 'delete-selected'; count: number };

const quickFilters: Array<{ value: QuickFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'attention', label: '库存预警' },
  { value: 'out', label: '缺货' },
  { value: 'low', label: '低库存' },
  { value: 'noSupplier', label: '无供应商' },
  { value: 'noPrice', label: '无价格' },
];

type PartFormState = {
  namingSpec: Record<string, string | number>;
  model: string;
  category: string;
  subcategory: string;
  supplier: string;
  catalogUnitCost: string;
  stock: string;
  rawRemark: string;
  wireGauge: string;
  capacitorUf: string;
  standardCableAccessoryFee: string;
  xinjieCableAccessoryFee: string;
  standardCableAccessoryName: string;
  xinjieCableAccessoryName: string;
  floatAccessoryDelta: string;
  screwPricingEnabled: boolean;
  screwDiameter: string;
  isStainless: boolean;
  openOffset: string;
  defaultUpperBearing: string;
  defaultLowerBearing: string;
  defaultOilSealDia: string;
  defaultBearingSpan: string;
  defaultImpellerDia: string;
  defaultImpellerSpan: string;
  defaultImpellerDepth: string;
  defaultThreadLength: string;
  defaultThreadDia: string;
  defaultStackOffset: string;
};

const emptyForm: PartFormState = {
  namingSpec: {},
  model: '',
  category: '',
  subcategory: '',
  supplier: '',
  catalogUnitCost: '0',
  stock: '0',
  rawRemark: '',
  wireGauge: '',
  capacitorUf: '',
  standardCableAccessoryFee: '',
  xinjieCableAccessoryFee: '',
  standardCableAccessoryName: DEFAULT_STANDARD_CABLE_ACCESSORY_NAME,
  xinjieCableAccessoryName: DEFAULT_XINJIE_CABLE_ACCESSORY_NAME,
  floatAccessoryDelta: String(DEFAULT_FLOAT_ACCESSORY_DELTA),
  screwPricingEnabled: false,
  screwDiameter: '',
  isStainless: false,
  openOffset: '',
  defaultUpperBearing: '',
  defaultLowerBearing: '',
  defaultOilSealDia: '',
  defaultBearingSpan: '',
  defaultImpellerDia: '',
  defaultImpellerSpan: '',
  defaultImpellerDepth: '',
  defaultThreadLength: '',
  defaultThreadDia: '',
  defaultStackOffset: '',
};

function statLabel(value: string, sub: string) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  );
}

function categoryPill(category: string, subcategory?: string) {
  return (
    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
      {category || '未分类'}{subcategory ? ` / ${subcategory}` : ''}
    </span>
  );
}

function numericText(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : '';
}

function formFromPart(part: Part): PartFormState {
  const modelFields = modelFieldsFromPart(part);
  const cableMeta = parseCableAccessoryMeta(part.remark);
  const screwMeta = parseScrewPricingMetaFromRemark(part.remark);
  const pumpShellMeta = parsePumpShellMeta(part.remark);

  return {
    ...emptyForm,
    model: modelFields.model,
    category: part.category || '轴承',
    subcategory: part.subcategory || '',
    supplier: part.supplier,
    catalogUnitCost: String(part.catalogUnitCost),
    stock: String(part.stock),
    rawRemark: part.remark,
    wireGauge: modelFields.wireGauge,
    capacitorUf: modelFields.capacitorUf,
    standardCableAccessoryFee: cableMeta.standardFee,
    xinjieCableAccessoryFee: cableMeta.xinjieFee,
    standardCableAccessoryName: cableMeta.standardName,
    xinjieCableAccessoryName: cableMeta.xinjieName,
    screwPricingEnabled: Boolean(screwMeta?.enabled),
    screwDiameter: screwMeta ? String(screwMeta.diameter) : '',
    isStainless: Boolean(pumpShellMeta.isStainless),
    openOffset: numericText(pumpShellMeta.openOffset),
    defaultUpperBearing: pumpShellMeta.defaultUpperBearing || '',
    defaultLowerBearing: pumpShellMeta.defaultLowerBearing || '',
    defaultOilSealDia: numericText(pumpShellMeta.defaultOilSealDia),
    defaultBearingSpan: numericText(pumpShellMeta.defaultBearingSpan),
    defaultImpellerDia: numericText(pumpShellMeta.defaultImpellerDia),
    defaultImpellerSpan: numericText(pumpShellMeta.defaultImpellerSpan),
    defaultImpellerDepth: numericText(pumpShellMeta.defaultImpellerDepth),
    defaultThreadLength: numericText(pumpShellMeta.defaultThreadLength),
    defaultThreadDia: numericText(pumpShellMeta.defaultThreadDia),
    defaultStackOffset: numericText(pumpShellMeta.defaultStackOffset),
  };
}

function resetAfterContinue(form: PartFormState): PartFormState {
  return {
    ...emptyForm,
    category: form.category,
    subcategory: form.category === '包装' ? form.subcategory : '',
    supplier: form.supplier,
    standardCableAccessoryName: form.standardCableAccessoryName,
    xinjieCableAccessoryName: form.xinjieCableAccessoryName,
    standardCableAccessoryFee: form.standardCableAccessoryFee,
    xinjieCableAccessoryFee: form.xinjieCableAccessoryFee,
    floatAccessoryDelta: form.floatAccessoryDelta,
  };
}

function formToInput(form: PartFormState, model: string, remark: string): PartInput {
  return {
    model,
    category: form.category.trim(),
    subcategory: form.category === '包装' ? form.subcategory : '',
    supplier: form.supplier.trim(),
    catalogUnitCost: Math.max(0, Number(form.catalogUnitCost) || 0),
    stock: Math.max(0, Number(form.stock) || 0),
    remark,
  };
}

function parseCableSetting(value: string) {
  try {
    const parsed = JSON.parse(value) as {
      standard?: { name?: string; fee?: unknown };
      xinjie?: { name?: string; fee?: unknown };
    };
    return {
      standardName: parsed.standard?.name || DEFAULT_STANDARD_CABLE_ACCESSORY_NAME,
      standardFee: numericText(parsed.standard?.fee),
      xinjieName: parsed.xinjie?.name || DEFAULT_XINJIE_CABLE_ACCESSORY_NAME,
      xinjieFee: numericText(parsed.xinjie?.fee),
    };
  } catch {
    return null;
  }
}

function textInputClass() {
  return 'mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400';
}

function smallHelp(text: string) {
  return <div className="mt-2 text-xs leading-5 text-muted">{text}</div>;
}

export function PartsView({
  initialQuickFilter = 'all',
  initialQuery = '',
}: {
  initialQuickFilter?: QuickFilter;
  initialQuery?: string;
}) {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState('全部');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initialQuickFilter);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingPartAction | null>(null);
  const [form, setForm] = useState<PartFormState>(emptyForm);
  const [namingRules, setNamingRules] = useState<CatalogNamingRule[] | null>(null);
  const [namingRulesError, setNamingRulesError] = useState<string | null>(null);
  const [namingPreview, setNamingPreview] = useState<{ key: string; name: string; error?: string } | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const collapseInitializedRef = useRef(false);
  const touchedSettingsFieldsRef = useRef(new Set<PartSettingField>());
  const settingsLoadSessionRef = useRef(0);
  const {
    dirty: formDirty,
    discardPromptOpen,
    discardMessage,
    markDirty: markFormDirty,
    resetDirty: resetFormDirty,
    requestClose: requestDrawerClose,
    confirmDiscard,
    cancelDiscard,
  } = useConfirmDiscard({
    open: drawerOpen,
    busy: saving,
    onDiscard: () => setDrawerOpen(false),
  });

  const loadVersion = useRef(0);
  async function load(force = false, background = false) {
    const version = ++loadVersion.current;
    if (!background) {
      setError(null);
      if (force) setRefreshing(true);
      else setLoading(true);
    }

    try {
      const data = await getAllParts(background ? AbortSignal.timeout(10000) : undefined);
      if (version !== loadVersion.current) return false;
      setParts(data);
      return true;
    } catch (err) {
      if (version !== loadVersion.current) return false;
      if (!background) setError(err instanceof Error ? err.message : '零件加载失败');
      return false;
    } finally {
      if (version === loadVersion.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useBusinessRefresh(() => load(false, true));

  useEffect(() => {
    void load();
    return () => { loadVersion.current += 1; };
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    let active = true;
    getCatalogNamingRules().then(rules => {
      if (active) { setNamingRules(rules); setNamingRulesError(null); }
    }).catch(error => {
      if (active) setNamingRulesError(error instanceof Error ? error.message : '命名规则加载失败');
    });
    return () => { active = false; };
  }, [drawerOpen]);

  const namingRule = !editingPart ? namingRules?.find(rule => rule.supportsPartCreate && rule.category === form.category) : undefined;
  const namingComplete = namingRule?.fields.every(field => field.optional || String(form.namingSpec[field.key] ?? '').trim());
  const namingKey = namingRule && namingComplete ? JSON.stringify({ ruleId: namingRule.id, spec: form.namingSpec }) : '';
  const generatedName = namingPreview?.key === namingKey ? namingPreview.name : '';
  const namingError = namingPreview?.key === namingKey ? namingPreview.error : null;
  useEffect(() => {
    if (!drawerOpen || !namingKey) return;
    let active = true;
    const timer = setTimeout(() => {
      previewCatalogName(JSON.parse(namingKey)).then(name => {
        if (active) setNamingPreview({ key: namingKey, name });
      }).catch(error => {
        if (active) setNamingPreview({ key: namingKey, name: '', error: error instanceof Error ? error.message : '规格预览失败' });
      });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [drawerOpen, namingKey]);

  const categoryOptions = useMemo(() => {
    const all = new Set([...BUILTIN_CATEGORIES, ...parts.map((part) => part.category || '未分类')]);
    return Array.from(all).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [parts]);

  const filterCategories = useMemo(() => ['全部', ...categoryOptions], [categoryOptions]);

  const supplierOptions = useMemo(() => {
    return Array.from(new Set(parts.map((part) => part.supplier).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [parts]);

  const wirePrefix = wirePrefixForCategory(form.category);
  const isWireMode = Boolean(wirePrefix);
  const isCableMode = form.category === '电缆线';
  const isFloatMode = form.category === '浮球';
  const isCapacitorMode = isCapacitorCategory(form.category);
  const isScrewMode = form.category === '螺丝';
  const isPumpShellMode = form.category === '泵壳';
  const isPackagingMode = form.category === '包装';
  const wireOptions = useMemo(() => wireOptionsFromParts(parts, wirePrefix), [parts, wirePrefix]);
  const modelPreview = editingPart?.naming ? editingPart.model : namingRule ? generatedName : finalPartModel({
    isCapacitorMode,
    capacitorUf: form.capacitorUf,
    isWireMode,
    wirePrefix,
    wireGauge: form.wireGauge,
    model: form.model,
  });

  useEffect(() => {
    if (!drawerOpen) return;
    let active = true;
    const session = settingsLoadSessionRef.current;

    async function loadCategorySettings() {
      if (isCableMode) {
        try {
          const value = await getSettingValue('cable_accessories');
          const parsed = parseCableSetting(value);
          if (!active || session !== settingsLoadSessionRef.current || !parsed) return;
          setForm((current) => mergeUntouchedPartSettings(current, touchedSettingsFieldsRef.current, {
            standardCableAccessoryName: current.standardCableAccessoryName || parsed.standardName,
            standardCableAccessoryFee: current.standardCableAccessoryFee || parsed.standardFee,
            xinjieCableAccessoryName: current.xinjieCableAccessoryName || parsed.xinjieName,
            xinjieCableAccessoryFee: current.xinjieCableAccessoryFee || parsed.xinjieFee,
          }));
        } catch {
          return;
        }
      }

      if (isFloatMode) {
        try {
          const value = await getSettingValue('float_accessory_delta');
          if (!active || session !== settingsLoadSessionRef.current) return;
          setForm((current) => mergeUntouchedPartSettings(current, touchedSettingsFieldsRef.current, {
            floatAccessoryDelta: current.floatAccessoryDelta || String(parseFloatAccessoryDelta(value)),
          }));
        } catch {
          return;
        }
      }
    }

    void loadCategorySettings();
    return () => {
      active = false;
    };
  }, [drawerOpen, isCableMode, isFloatMode]);

  const filteredParts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return parts.filter((part) => {
      const stock = partStockStatus(part).status;
      const text = `${part.model} ${part.category} ${part.subcategory || ''} ${part.supplier}`.toLowerCase();
      const matchesQuery = !normalizedQuery || text.includes(normalizedQuery);
      const matchesCategory = category === '全部' || part.category === category;
      const matchesQuick =
        quickFilter === 'all' ||
        stock === quickFilter ||
        (quickFilter === 'attention' && (stock === 'low' || stock === 'out')) ||
        (quickFilter === 'noSupplier' && !part.supplier.trim()) ||
        (quickFilter === 'noPrice' && part.catalogUnitCost <= 0);
      return matchesQuery && matchesCategory && matchesQuick;
    });
  }, [parts, query, category, quickFilter]);

  const groupedParts = useMemo(() => {
    const groups = new Map<string, Part[]>();
    for (const part of filteredParts) {
      const key = part.category === '包装'
        ? `包装 / ${part.subcategory || '未分类'}`
        : (part.category || '未分类');
      groups.set(key, [...(groups.get(key) || []), part]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, 'zh-CN'));
  }, [filteredParts]);

  const selectedParts = useMemo(() => {
    const selected = new Set(selectedIds);
    return parts.filter((part) => selected.has(part.id));
  }, [parts, selectedIds]);

  useEffect(() => {
    setSelectedIds([]);
    if (query.trim() || category !== '全部') {
      setCollapsedCategories(new Set());
    }
  }, [query, category, quickFilter]);

  useEffect(() => {
    if (loading || collapseInitializedRef.current) return;
    collapseInitializedRef.current = true;
    if (!initialQuery.trim()) {
      setCollapsedCategories(new Set(groupedParts.map(([name]) => name)));
    }
  }, [groupedParts, initialQuery, loading]);

  const stats = useMemo(() => {
    const totalValue = parts.reduce((sum, part) => sum + part.catalogUnitCost * part.stock, 0);
    const low = parts.filter((part) => partStockStatus(part).status === 'low').length;
    const out = parts.filter((part) => partStockStatus(part).status === 'out').length;
    return { totalValue, low, out };
  }, [parts]);
  const hasActiveFilters = Boolean(query.trim() || category !== '全部' || quickFilter !== 'all');

  function clearFilters() {
    setQuery('');
    setCategory('全部');
    setQuickFilter('all');
  }

  function openCreateDrawer() {
    resetFormDirty();
    settingsLoadSessionRef.current += 1;
    touchedSettingsFieldsRef.current = new Set();
    setEditingPart(null);
    setForm(emptyForm);
    setFormError(null);
    setDrawerOpen(true);
  }

  function openEditDrawer(part: Part) {
    resetFormDirty();
    settingsLoadSessionRef.current += 1;
    touchedSettingsFieldsRef.current = new Set();
    setEditingPart(part);
    setForm(formFromPart(part));
    setFormError(null);
    setDrawerOpen(true);
  }

  function updateSettingsForm(patch: Partial<Record<PartSettingField, string>>) {
    for (const field of partSettingFields) {
      if (patch[field] !== undefined) touchedSettingsFieldsRef.current.add(field);
    }
    setForm((current) => ({ ...current, ...patch }));
  }

  function buildRemarkPayload() {
    const structured = buildPartRemark({
      category: form.category,
      isCableMode,
      isScrewMode,
      isStainless: form.isStainless,
      openOffset: form.openOffset,
      defaultUpperBearing: form.defaultUpperBearing,
      defaultLowerBearing: form.defaultLowerBearing,
      defaultOilSealDia: form.defaultOilSealDia,
      defaultBearingSpan: form.defaultBearingSpan,
      defaultImpellerDia: form.defaultImpellerDia,
      defaultImpellerSpan: form.defaultImpellerSpan,
      defaultImpellerDepth: form.defaultImpellerDepth,
      defaultThreadLength: form.defaultThreadLength,
      defaultThreadDia: form.defaultThreadDia,
      defaultStackOffset: form.defaultStackOffset,
      standardCableAccessoryFee: form.standardCableAccessoryFee,
      xinjieCableAccessoryFee: form.xinjieCableAccessoryFee,
      standardCableAccessoryName: form.standardCableAccessoryName,
      xinjieCableAccessoryName: form.xinjieCableAccessoryName,
      screwPricingEnabled: form.screwPricingEnabled,
      screwDiameter: form.screwDiameter,
    });
    return structured ? JSON.stringify(structured) : form.rawRemark.trim();
  }

  async function persistPart(continueEntry: boolean, finalModel: string) {
    setSaving(true);
    setFormError(null);
    setError(null);

    try {
      const businessSettings = [];
      if (isCableMode) {
        businessSettings.push(partBusinessSettingUpdate('cable_accessories', buildCableAccessorySettingsValue({
          standardCableAccessoryName: form.standardCableAccessoryName,
          standardCableAccessoryFee: form.standardCableAccessoryFee,
          xinjieCableAccessoryName: form.xinjieCableAccessoryName,
          xinjieCableAccessoryFee: form.xinjieCableAccessoryFee,
        })));
      }

      if (isFloatMode) {
        businessSettings.push(partBusinessSettingUpdate(
          'float_accessory_delta',
          String(parseFloatAccessoryDelta(form.floatAccessoryDelta))
        ));
      }

      const input = {
        ...formToInput(form, finalModel, buildRemarkPayload()),
        ...(namingRule ? { naming: { ruleId: namingRule.id, spec: form.namingSpec } } : {}),
        businessSettings,
      };
      await (editingPart ? updatePart(editingPart, input) : createPart(input));
      await load(true);
      resetFormDirty();
      if (continueEntry) {
        setForm(resetAfterContinue(form));
      } else {
        setDrawerOpen(false);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '零件保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function submitPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const continueEntry = submitter?.name === 'continueEntry' && !editingPart;
    if (!editingPart && (!namingRules || namingRulesError)) {
      setFormError(namingRulesError || '正在加载命名规则，请稍后保存');
      return;
    }
    if (namingRule && !generatedName) {
      setFormError(namingError || '请补齐规格并等待名称预览');
      return;
    }
    const errors = validatePartForm({
      category: form.category,
      model: namingRule ? generatedName : form.model,
      catalogUnitCost: form.catalogUnitCost,
      supplier: form.supplier,
      isCapacitorMode,
      capacitorUf: form.capacitorUf,
      isWireMode,
      wireGauge: form.wireGauge,
      isCableMode,
      standardCableAccessoryFee: form.standardCableAccessoryFee,
      xinjieCableAccessoryFee: form.xinjieCableAccessoryFee,
      standardCableAccessoryName: form.standardCableAccessoryName,
      xinjieCableAccessoryName: form.xinjieCableAccessoryName,
      isFloatMode,
      floatAccessoryDelta: form.floatAccessoryDelta,
      isScrewMode,
      screwPricingEnabled: form.screwPricingEnabled,
      screwDiameter: form.screwDiameter,
    });
    const firstError = Object.values(errors)[0];
    if (firstError) {
      setFormError(firstError);
      return;
    }

    const finalModel = modelPreview;
    const duplicated = !editingPart && parts.some((part) => (
      part.model.trim() === finalModel &&
      part.category.trim() === form.category.trim() &&
      (part.subcategory || '').trim() === (form.category === '包装' ? form.subcategory.trim() : '')
    ));
    if (duplicated) {
      setPendingAction({ kind: 'duplicate', continueEntry, model: finalModel });
      return;
    }
    await persistPart(continueEntry, finalModel);
  }

  async function deleteSinglePart(part: Part) {

    setSaving(true);
    setError(null);

    try {
      await deletePart(part);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '零件删除失败');
    } finally {
      setSaving(false);
    }
  }

  function toggleCategory(categoryName: string) {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryName)) next.delete(categoryName);
      else next.add(categoryName);
      return next;
    });
  }

  function toggleSelectPart(id: number, checked: boolean) {
    setSelectedIds((current) => (checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id)));
  }

  function toggleSelectGroup(groupParts: Part[]) {
    const ids = groupParts.map((part) => part.id);
    const allSelected = ids.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => (
      allSelected ? current.filter((id) => !ids.includes(id)) : Array.from(new Set([...current, ...ids]))
    ));
  }

  function exportSelectedCsv() {
    if (selectedParts.length === 0) return;
    const header = ['型号', '分类', '二级分类', '目录成本价', '供应商', '库存', '备注'];
    const escapeCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = selectedParts.map((part) => [
      part.model,
      part.category,
      part.subcategory || '',
      part.catalogUnitCost,
      part.supplier,
      part.stock,
      part.remark,
    ].map(escapeCell).join(','));
    const blob = new Blob(['\uFEFF', [header.map(escapeCell).join(','), ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `零件导出_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteSelectedParts() {
    setSaving(true);
    setError(null);

    try {
      await deleteParts(selectedParts);
      setSelectedIds([]);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量删除失败');
    } finally {
      setSaving(false);
    }
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    if (action.kind === 'duplicate') {
      await persistPart(action.continueEntry, action.model);
      return;
    }
    if (action.kind === 'delete') {
      await deleteSinglePart(action.part);
      return;
    }
    await deleteSelectedParts();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="零件"
        description="维护零件价格、供应商与库存基础数据。"
        actions={(
          <>
          <Button
            onClick={() => void load(true)}
            disabled={refreshing || saving}
            icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}
          >
            刷新
          </Button>
          <Button variant="primary" onClick={openCreateDrawer} disabled={saving} icon={<Plus size={15} />}>
            新建零件
          </Button>
          </>
        )}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <FadePanel delay={0.02} className="rounded-panel border border-line bg-white shadow-panel">
          <button type="button" onClick={clearFilters} className="w-full rounded-panel p-3 text-left transition-colors hover:bg-slate-50" aria-label="查看全部零件">
            {statLabel(loading ? '—' : String(parts.length), '零件条目')}
          </button>
        </FadePanel>
        <FadePanel delay={0.04} className="rounded-panel border border-line bg-white p-3 shadow-panel">
          {statLabel(loading ? '—' : money(stats.totalValue), '库存总价值')}
        </FadePanel>
        <FadePanel delay={0.06} className={`rounded-panel border bg-white shadow-panel ${quickFilter === 'low' ? 'border-amber-300 ring-2 ring-amber-100' : 'border-line'}`}>
          <button type="button" onClick={() => setQuickFilter('low')} disabled={stats.low === 0} className="w-full rounded-panel p-3 text-left transition-colors hover:bg-amber-50/60 disabled:cursor-not-allowed disabled:hover:bg-transparent" aria-label="查看低库存零件">
            {statLabel(loading ? '—' : String(stats.low), '低库存')}
          </button>
        </FadePanel>
        <FadePanel delay={0.08} className={`rounded-panel border bg-white shadow-panel ${quickFilter === 'out' ? 'border-rose-300 ring-2 ring-rose-100' : 'border-line'}`}>
          <button type="button" onClick={() => setQuickFilter('out')} className="w-full rounded-panel p-3 text-left transition-colors hover:bg-rose-50/60" aria-label="查看缺货零件">
            {statLabel(loading ? '—' : String(stats.out), '缺货零件')}
          </button>
        </FadePanel>
      </div>

      <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
        <div className="sticky top-14 z-20 flex flex-col gap-3 border-b border-line bg-white p-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3">
            <Search size={16} className="text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索型号、供应商或分类"
              aria-label="搜索零件"
              className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-slate-100 hover:text-ink" aria-label="清空搜索" title="清空搜索">
                <X size={14} />
              </button>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-muted" />
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label="按分类筛选"
                className="h-9 min-w-32 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 hover:bg-slate-50"
              >
                {filterCategories.map((item) => (
                  <option key={item} value={item}>{item === '全部' ? '全部分类' : item}</option>
                ))}
              </select>
            </div>
            <div className="max-w-full overflow-x-auto pb-1 lg:pb-0">
              <SegmentedControl
                value={quickFilter}
                options={quickFilters}
                onChange={setQuickFilter}
                ariaLabel="库存快速筛选"
              />
            </div>
            <div className="flex items-center justify-between gap-1">
              <span className="mr-1 whitespace-nowrap text-xs text-muted">
                {hasActiveFilters ? `${filteredParts.length} / ${parts.length} 项` : `共 ${parts.length} 项`}
              </span>
              {hasActiveFilters ? (
                <Button size="sm" variant="ghost" onClick={clearFilters} icon={<X size={14} />}>
                  清除筛选
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCollapsedCategories(new Set())}
                icon={<ChevronDown size={14} />}
                aria-label="全部展开"
                title="全部展开"
              >
                <span className="hidden 2xl:inline">展开</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCollapsedCategories(new Set(groupedParts.map(([name]) => name)))}
                icon={<ChevronUp size={14} />}
                aria-label="全部折叠"
                title="全部折叠"
              >
                <span className="hidden 2xl:inline">折叠</span>
              </Button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 p-5 text-sm text-rose-700">
            <CircleAlert size={16} />
            {error}
          </div>
        ) : loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
            ))}
          </div>
        ) : filteredParts.length === 0 ? (
          <div className="p-10 text-center">
            <PackageMinus className="mx-auto text-slate-300" size={32} />
            <div className="mt-3 text-sm font-medium text-ink">没有匹配的零件</div>
            <div className="mt-1 text-sm text-muted">调整搜索、分类或库存筛选。</div>
          </div>
        ) : (
          <div>
            {groupedParts.map(([groupName, groupParts]) => {
              const isCollapsed = collapsedCategories.has(groupName);
              const ids = groupParts.map((part) => part.id);
              const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
              const partiallySelected = ids.some((id) => selectedIds.includes(id)) && !allSelected;
              const lowCount = groupParts.filter((part) => partStockStatus(part).status === 'low').length;
              const outCount = groupParts.filter((part) => partStockStatus(part).status === 'out').length;

              return (
                <section key={groupName} className="border-b border-line last:border-b-0">
                  <div className="flex items-center gap-3 bg-slate-50 px-4 py-2.5">
                    <Checkbox
                      checked={allSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = partiallySelected;
                      }}
                      onChange={() => toggleSelectGroup(groupParts)}
                      aria-label={`选择${groupName}分类`}
                      className="h-4 w-4 rounded border-line text-ink"
                    />
                    <button
                      type="button"
                      onClick={() => toggleCategory(groupName)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors duration-150 hover:text-ink"
                    >
                      {isCollapsed ? <ChevronDown size={15} className="text-muted" /> : <ChevronUp size={15} className="text-muted" />}
                      <span className="font-medium text-ink">{groupName}</span>
                      <span className="rounded-full border border-line bg-white px-2 py-0.5 text-xs text-muted">{groupParts.length} 项</span>
                      {outCount > 0 ? (
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs text-rose-700">缺货 {outCount}</span>
                      ) : null}
                      {lowCount > 0 ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">低库存 {lowCount}</span>
                      ) : null}
                    </button>
                  </div>

                  {!isCollapsed ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                        <thead className="bg-white text-xs font-medium uppercase tracking-wide text-muted">
                          <tr>
                            <th className="w-10 border-b border-line px-4 py-2.5"></th>
                            <th className="border-b border-line px-4 py-2.5">型号</th>
                            <th className="border-b border-line px-4 py-2.5">分类</th>
                            <th className="border-b border-line px-4 py-2.5">供应商</th>
                            <th className="border-b border-line px-4 py-2.5 text-right">目录成本价</th>
                            <th className="border-b border-line px-4 py-2.5 text-right">库存</th>
                            <th className="border-b border-line px-4 py-2.5">状态</th>
                            <th className="border-b border-line px-4 py-2.5 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupParts.map((part) => {
                            const stock = partStockStatus(part);
                            return (
                              <tr key={part.id} className="group transition-colors duration-150 hover:bg-slate-50">
                                <td className="border-b border-line px-4 py-2.5">
                                  <Checkbox
                                    checked={selectedIds.includes(part.id)}
                                    onChange={(event) => toggleSelectPart(part.id, event.target.checked)}
                                    aria-label={`选择零件${part.model || part.id}`}
                                    className="h-4 w-4 rounded border-line text-ink"
                                  />
                                </td>
                                <td className="border-b border-line px-4 py-2.5">
                                  <span className="font-medium text-ink">{part.model || '-'}</span>
                                </td>
                                <td className="border-b border-line px-4 py-2.5">{categoryPill(part.category, part.subcategory)}</td>
                                <td className="border-b border-line px-4 py-2.5 text-muted">{part.supplier || '-'}</td>
                                <td className="border-b border-line px-4 py-2.5 text-right font-medium text-ink">{money(part.catalogUnitCost)}</td>
                                <td className="border-b border-line px-4 py-2.5 text-right text-muted">{part.stock}</td>
                                <td className="whitespace-nowrap border-b border-line px-4 py-2.5">
                                  <StatusBadge tone={stock.status === 'out' ? 'red' : stock.status === 'low' ? 'amber' : 'green'}>{stock.label}</StatusBadge>
                                </td>
                                <td className="border-b border-line px-4 py-2.5">
                                  <div className="flex justify-end gap-1 text-muted opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                                    <Button size="sm" variant="ghost" className="w-8 px-0" onClick={() => openEditDrawer(part)} disabled={saving} icon={<Pencil size={14} />} aria-label={`编辑 ${part.model || part.id}`} title="编辑" />
                                    <Button size="sm" variant="ghost" className="w-8 px-0 hover:bg-rose-50 hover:text-rose-700" onClick={() => setPendingAction({ kind: 'delete', part })} disabled={saving} icon={<Trash2 size={14} />} aria-label={`删除 ${part.model || part.id}`} title="删除" />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </FadePanel>

      {selectedIds.length > 0 ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-white shadow-xl">
          <span className="font-medium">已选择 {selectedIds.length} 项</span>
          <span className="h-5 w-px bg-white/20" />
          <Button size="sm" variant="ghost" onClick={exportSelectedCsv} icon={<Download size={14} />} className="text-white hover:bg-white/10 hover:text-white">
            导出 CSV
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPendingAction({ kind: 'delete-selected', count: selectedIds.length })} disabled={saving} icon={<Trash2 size={14} />} className="text-rose-200 hover:bg-rose-500/20 hover:text-rose-100">
            删除
          </Button>
          <button
            type="button"
            aria-label="清空已选零件"
            onClick={() => setSelectedIds([])}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 transition-colors duration-150 hover:bg-white/10 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <SlideOver open={drawerOpen} onClose={requestDrawerClose} ariaLabelledBy="part-form-title">
        <form onSubmit={submitPart} onChange={markFormDirty} className="flex min-h-full flex-col">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-white p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Part</div>
              <h2 id="part-form-title" className="mt-2 text-xl font-semibold tracking-tight text-ink">
                {editingPart ? '编辑零件' : '新建零件'}
              </h2>
              <div className="mt-1 text-sm text-muted">按分类录入结构化字段，最终型号：{modelPreview || '-'}</div>
            </div>
            <button
              type="button"
              aria-label="关闭"
              disabled={saving}
              onClick={requestDrawerClose}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-5 p-5">
            <FormError message={formError} />

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="分类" required>
                <Select
                  value={form.category}
                  disabled={Boolean(editingPart?.naming)}
                  onChange={(event) => {
                    const nextCategory = event.target.value;
                    setForm((current) => ({
                      ...current,
                      category: nextCategory,
                      namingSpec: {},
                      subcategory: nextCategory === '包装'
                        ? (current.subcategory || PACKAGING_SUBCATEGORIES[0])
                        : '',
                    }));
                  }}
                >
                  <option value="">请选择分类</option>
                  {categoryOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </Select>
              </Field>

              {isPackagingMode ? (
                <Field
                  label="包装二级分类"
                  hint="外包装：牛皮纸箱、彩印箱、木箱；内衬：泡沫、珍珠棉。"
                >
                  <Select
                    value={form.subcategory || PACKAGING_SUBCATEGORIES[0]}
                    onChange={(event) => setForm((current) => ({ ...current, subcategory: event.target.value }))}
                  >
                    {PACKAGING_SUBCATEGORIES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              <Field label="供应商">
                <Input
                  value={form.supplier}
                  onChange={(event) => setForm((current) => ({ ...current, supplier: event.target.value }))}
                  list="part-supplier-options"
                  placeholder="供应商名称"
                />
                <datalist id="part-supplier-options">
                  {supplierOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </Field>
            </div>

            {!editingPart && namingRulesError ? <FormError message={namingRulesError} /> : null}
            {editingPart?.naming ? (
              <Field label="规格生成型号" hint="名称和规格已保存。修改价格、库存、备注不会改变名称。">
                <Input value={editingPart.model} readOnly />
                <div className="mt-2 text-xs text-muted">{Object.entries(editingPart.naming.spec).map(([key, value]) => {
                  const label = namingRules?.find(rule => rule.id === editingPart.naming?.ruleId)?.fields.find(field => field.key === key)?.label;
                  return `${label || '规格'}：${value}`;
                }).join('；')}</div>
              </Field>
            ) : namingRule ? (
              <div className="space-y-4">
                <div className="text-sm text-muted">填写规格后系统生成名称，无需记住排列格式。</div>
                {namingRule.fields.map(field => (
                  <Field key={field.key} label={field.label} required={!field.optional}>
                    <Input
                      value={String(form.namingSpec[field.key] ?? '')}
                      maxLength={field.maxLength}
                      required={!field.optional}
                      onChange={event => setForm(current => ({ ...current, namingSpec: { ...current.namingSpec, [field.key]: event.target.value } }))}
                    />
                  </Field>
                ))}
                <Field label="生成型号"><Input value={generatedName} placeholder="填写规格后自动生成" readOnly /></Field>
                {namingError ? <FormError message={namingError} /> : null}
              </div>
            ) : isCapacitorMode ? (
              <label className="block">
                <span className="text-sm font-medium text-ink">电容容量</span>
                <div className="mt-2 flex rounded-md border border-line focus-within:border-slate-400">
                  <input
                    value={form.capacitorUf}
                    onChange={(event) => setForm((current) => ({ ...current, capacitorUf: event.target.value }))}
                    onFocus={selectInputValueOnFocus}
                    type="number"
                    min="0"
                    step="0.1"
                    className="h-10 min-w-0 flex-1 rounded-l-md border-0 px-3 text-sm text-ink outline-none"
                    placeholder="例如：35"
                  />
                  <span className="flex h-10 items-center border-l border-line bg-slate-50 px-3 text-sm text-muted">μF</span>
                </div>
                {smallHelp('保存型号会自动生成，例如 35μF。')}
              </label>
            ) : isWireMode ? (
              <label className="block">
                <span className="text-sm font-medium text-ink">线径</span>
                <div className="mt-2 flex rounded-md border border-line focus-within:border-slate-400">
                  <span className="flex h-10 items-center border-r border-line bg-slate-50 px-3 text-sm text-muted">{wirePrefix}</span>
                  <input
                    value={form.wireGauge}
                    onChange={(event) => setForm((current) => ({ ...current, wireGauge: event.target.value }))}
                    list="part-wire-options"
                    className="h-10 min-w-0 flex-1 rounded-r-md border-0 px-3 text-sm text-ink outline-none"
                    placeholder="例如：3*1.5"
                  />
                  <datalist id="part-wire-options">
                    {wireOptions.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </div>
                {smallHelp(`保存型号会自动生成：${modelPreview || `${wirePrefix}线径`}`)}
              </label>
            ) : (
              <Field label="型号" required>
                <Input
                  value={form.model}
                  onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                  placeholder="例如：6204 轴承"
                  autoFocus
                />
              </Field>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="目录成本价" required>
                <Input
                  value={form.catalogUnitCost}
                  onChange={(event) => setForm((current) => ({ ...current, catalogUnitCost: event.target.value }))}
                  type="number"
                  min="0"
                  step="0.001"
                  selectOnFirstFocus
                />
              </Field>

              <Field label="库存">
                <Input
                  value={form.stock}
                  onChange={(event) => setForm((current) => ({ ...current, stock: event.target.value }))}
                  type="number"
                  min="0"
                  step="1"
                  selectOnFirstFocus
                />
              </Field>
            </div>

            {isCableMode ? (
              <section className="rounded-md border border-line bg-slate-50 p-4">
                <div className="text-sm font-medium text-ink">成品电缆插头 / 规格费用</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-muted">第一种名称</span>
                    <input
                      value={form.standardCableAccessoryName}
                      onChange={(event) => updateSettingsForm({ standardCableAccessoryName: event.target.value })}
                      className={textInputClass()}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted">第一种费用</span>
                    <input
                      value={form.standardCableAccessoryFee}
                      onChange={(event) => updateSettingsForm({ standardCableAccessoryFee: event.target.value })}
                      onFocus={selectInputValueOnFocus}
                      type="number"
                      min="0"
                      step="0.01"
                      className={textInputClass()}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted">第二种名称</span>
                    <input
                      value={form.xinjieCableAccessoryName}
                      onChange={(event) => updateSettingsForm({ xinjieCableAccessoryName: event.target.value })}
                      className={textInputClass()}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted">第二种费用</span>
                    <input
                      value={form.xinjieCableAccessoryFee}
                      onChange={(event) => updateSettingsForm({ xinjieCableAccessoryFee: event.target.value })}
                      onFocus={selectInputValueOnFocus}
                      type="number"
                      min="0"
                      step="0.01"
                      className={textInputClass()}
                    />
                  </label>
                </div>
                {smallHelp('保存电缆零件时会同步更新全局电缆铜套配置，配方成本会读取同一口径。')}
              </section>
            ) : null}

            {isFloatMode ? (
              <section className="rounded-md border border-line bg-slate-50 p-4">
                <label className="block">
                  <span className="text-sm font-medium text-ink">新界式浮球加价</span>
                  <input
                    value={form.floatAccessoryDelta}
                    onChange={(event) => updateSettingsForm({ floatAccessoryDelta: event.target.value })}
                    onFocus={selectInputValueOnFocus}
                    type="number"
                    min="0"
                    step="0.01"
                    className={textInputClass()}
                  />
                </label>
                {smallHelp('保存浮球零件时会同步更新全局新界式浮球附加费。')}
              </section>
            ) : null}

            {isScrewMode ? (
              <section className="rounded-md border border-line bg-slate-50 p-4">
                <label className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Checkbox
                    checked={form.screwPricingEnabled}
                    onChange={(event) => setForm((current) => ({ ...current, screwPricingEnabled: event.target.checked }))}
                  />
                  按长度自动计价
                </label>
                {form.screwPricingEnabled ? (
                  <label className="mt-3 block">
                    <span className="text-xs font-medium text-muted">螺丝直径</span>
                    <input
                      value={form.screwDiameter}
                      onChange={(event) => setForm((current) => ({ ...current, screwDiameter: event.target.value }))}
                      onFocus={selectInputValueOnFocus}
                      type="number"
                      min="0"
                      step="0.1"
                      className={textInputClass()}
                      placeholder="例如：6"
                    />
                  </label>
                ) : null}
                {smallHelp('启用后会保存长螺丝计价规则，成本引擎可按 6*长度 这类型号自动计算目录成本价。')}
              </section>
            ) : null}

            {isPumpShellMode ? (
              <section className="rounded-md border border-line bg-slate-50 p-4">
                <div>
                  <div className="text-sm font-medium text-ink">泵壳参数</div>
                  <div className="mt-1 text-xs text-muted">这里只维护泵壳基础属性，轴承、油封、叶轮和螺纹等参数请在配方中配置。</div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-muted">机筒类型</span>
                    <span className="mt-2 flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink">
                      <Checkbox
                        checked={form.isStainless}
                        onChange={(event) => setForm((current) => ({ ...current, isStainless: event.target.checked }))}
                      />
                      不锈钢机筒
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted">开档系数</span>
                    <input
                      value={form.openOffset}
                      onChange={(event) => setForm((current) => ({ ...current, openOffset: event.target.value }))}
                      type="number"
                      step="0.1"
                      className={textInputClass()}
                      placeholder="例如：15"
                    />
                  </label>
                </div>
              </section>
            ) : null}

            {!isCableMode && !isScrewMode && !isPumpShellMode ? (
              <Field label="备注">
                <Textarea
                  value={form.rawRemark}
                  onChange={(event) => setForm((current) => ({ ...current, rawRemark: event.target.value }))}
                  rows={4}
                  className="resize-none"
                  placeholder="供应说明或临时备注"
                />
              </Field>
            ) : null}
          </div>

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-white p-4 sm:p-5">
            <div className="text-xs text-muted" aria-live="polite">{formDirty ? '有未保存修改' : '尚未修改'}</div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={requestDrawerClose} disabled={saving}>
                取消
              </Button>
              {!editingPart ? (
                <Button type="submit" name="continueEntry" variant="ghost" disabled={saving} icon={<Save size={15} />}>
                  {saving ? '保存中' : '保存并继续'}
                </Button>
              ) : null}
              <Button type="submit" variant="primary" disabled={saving} icon={<Save size={15} />}>
                {saving ? '保存中' : '保存'}
              </Button>
            </div>
          </div>
        </form>
      </SlideOver>

      <ConfirmDialog
        open={discardPromptOpen}
        title="放弃未保存修改？"
        description={discardMessage}
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        confirmVariant="danger"
        busy={saving}
        onConfirm={confirmDiscard}
        onClose={cancelDiscard}
        layer="top"
      />

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.kind === 'duplicate'
          ? '创建重复零件？'
          : pendingAction?.kind === 'delete-selected'
            ? `删除 ${pendingAction.count} 个零件？`
            : '删除零件？'}
        description={pendingAction?.kind === 'duplicate'
          ? `同一分类中已经存在零件“${pendingAction.model}”。继续创建可能导致报价和库存选择时难以区分。`
          : pendingAction?.kind === 'delete-selected'
            ? '选中的零件将从当前零件目录中移除，历史审计记录仍会保留。'
            : pendingAction?.kind === 'delete'
              ? `零件“${pendingAction.part.model || pendingAction.part.id}”将从当前零件目录中移除，历史审计记录仍会保留。`
              : ''}
        confirmLabel={pendingAction?.kind === 'duplicate' ? '仍然创建' : '确认删除'}
        confirmVariant={pendingAction?.kind === 'duplicate' ? 'primary' : 'danger'}
        busy={saving}
        onConfirm={() => void confirmPendingAction()}
        onClose={() => {
          if (!saving) setPendingAction(null);
        }}
        layer={pendingAction?.kind === 'duplicate' ? 'top' : 'base'}
      />
    </div>
  );
}
