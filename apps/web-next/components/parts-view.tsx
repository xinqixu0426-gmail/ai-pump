'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
  Wrench,
  X,
} from 'lucide-react';
import {
  createPart,
  deletePart,
  deleteParts,
  getAllParts,
  getSettingValue,
  partStockStatus,
  setSettingValue,
  updatePart,
  type Part,
  type PartInput,
  type PartStockStatus,
} from '@/lib/parts';
import {
  BUILTIN_CATEGORIES,
  DEFAULT_FLOAT_ACCESSORY_DELTA,
  DEFAULT_STANDARD_CABLE_ACCESSORY_NAME,
  DEFAULT_XINJIE_CABLE_ACCESSORY_NAME,
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
  wireOptionsFromParts,
  wirePrefixForCategory,
} from '@/lib/part-form-rules';
import { money } from '@/lib/format';
import { FadePanel } from '@/components/motion/fade-panel';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge } from '@/components/ui/status-badge';

type QuickFilter = 'all' | PartStockStatus | 'noSupplier' | 'noPrice';

const quickFilters: Array<{ value: QuickFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'out', label: '缺货' },
  { value: 'low', label: '低库存' },
  { value: 'noSupplier', label: '无供应商' },
  { value: 'noPrice', label: '无价格' },
];

type PartFormState = {
  model: string;
  category: string;
  supplier: string;
  price: string;
  stock: string;
  rawNotes: string;
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
  model: '',
  category: '轴承',
  supplier: '',
  price: '0',
  stock: '0',
  rawNotes: '',
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

function categoryPill(category: string) {
  return (
    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
      {category || '未分类'}
    </span>
  );
}

function numericText(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : '';
}

function formFromPart(part: Part): PartFormState {
  const modelFields = modelFieldsFromPart(part);
  const cableMeta = parseCableAccessoryMeta(part.notes);
  const screwMeta = parseScrewPricingMetaFromNotes(part.notes);
  const pumpShellMeta = parsePumpShellMeta(part.notes);

  return {
    ...emptyForm,
    model: modelFields.model,
    category: part.category || '轴承',
    supplier: part.supplier,
    price: String(part.price),
    stock: String(part.stock),
    rawNotes: part.notes || part.remark || '',
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
    supplier: form.supplier,
    standardCableAccessoryName: form.standardCableAccessoryName,
    xinjieCableAccessoryName: form.xinjieCableAccessoryName,
    standardCableAccessoryFee: form.standardCableAccessoryFee,
    xinjieCableAccessoryFee: form.xinjieCableAccessoryFee,
    floatAccessoryDelta: form.floatAccessoryDelta,
  };
}

function formToInput(form: PartFormState, model: string, notes: string): PartInput {
  return {
    model,
    category: form.category.trim() || '轴承',
    supplier: form.supplier.trim(),
    price: Math.max(0, Number(form.price) || 0),
    stock: Math.max(0, Number(form.stock) || 0),
    notes,
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

export function PartsView() {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [form, setForm] = useState<PartFormState>(emptyForm);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await getAllParts();
      setParts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '零件加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
  const wireOptions = useMemo(() => wireOptionsFromParts(parts, wirePrefix), [parts, wirePrefix]);
  const modelPreview = finalPartModel({
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

    async function loadCategorySettings() {
      if (isCableMode) {
        try {
          const value = await getSettingValue('cable_accessories');
          const parsed = parseCableSetting(value);
          if (!active || !parsed) return;
          setForm((current) => ({
            ...current,
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
          if (!active) return;
          setForm((current) => ({
            ...current,
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
      const text = `${part.model} ${part.category} ${part.supplier}`.toLowerCase();
      const matchesQuery = !normalizedQuery || text.includes(normalizedQuery);
      const matchesCategory = category === '全部' || part.category === category;
      const matchesQuick =
        quickFilter === 'all' ||
        stock === quickFilter ||
        (quickFilter === 'noSupplier' && !part.supplier.trim()) ||
        (quickFilter === 'noPrice' && part.price <= 0);
      return matchesQuery && matchesCategory && matchesQuick;
    });
  }, [parts, query, category, quickFilter]);

  const groupedParts = useMemo(() => {
    const groups = new Map<string, Part[]>();
    for (const part of filteredParts) {
      const key = part.category || '未分类';
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
  }, [query, category, quickFilter]);

  const stats = useMemo(() => {
    const totalValue = parts.reduce((sum, part) => sum + part.price * part.stock, 0);
    const low = parts.filter((part) => partStockStatus(part).status === 'low').length;
    const out = parts.filter((part) => partStockStatus(part).status === 'out').length;
    return { totalValue, low, out };
  }, [parts]);

  function openCreateDrawer() {
    setEditingPart(null);
    setForm(emptyForm);
    setFormError(null);
    setDrawerOpen(true);
  }

  function openEditDrawer(part: Part) {
    setEditingPart(part);
    setForm(formFromPart(part));
    setFormError(null);
    setDrawerOpen(true);
  }

  function buildNotesPayload() {
    const structured = buildPartNotes({
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
    return structured ? JSON.stringify(structured) : form.rawNotes.trim();
  }

  async function submitPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const continueEntry = submitter?.name === 'continueEntry' && !editingPart;
    const errors = validatePartForm({
      category: form.category,
      model: form.model,
      price: form.price,
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
      part.category.trim() === form.category.trim()
    ));
    if (duplicated && !window.confirm(`已存在同分类零件「${finalModel}」，仍然继续创建？`)) return;

    setSaving(true);
    setFormError(null);
    setError(null);

    try {
      if (isCableMode) {
        await setSettingValue('cable_accessories', buildCableAccessorySettingsValue({
          standardCableAccessoryName: form.standardCableAccessoryName,
          standardCableAccessoryFee: form.standardCableAccessoryFee,
          xinjieCableAccessoryName: form.xinjieCableAccessoryName,
          xinjieCableAccessoryFee: form.xinjieCableAccessoryFee,
        }));
      }

      if (isFloatMode) {
        await setSettingValue('float_accessory_delta', String(parseFloatAccessoryDelta(form.floatAccessoryDelta)));
      }

      const input = formToInput(form, finalModel, buildNotesPayload());
      await (editingPart ? updatePart(editingPart.id, input) : createPart(input));
      await load(true);
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

  async function removePart(part: Part) {
    if (!window.confirm(`确定删除零件「${part.model || part.id}」？`)) return;

    setSaving(true);
    setError(null);

    try {
      await deletePart(part.id);
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
    const header = ['型号', '分类', '单价', '供应商', '库存', '备注'];
    const escapeCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = selectedParts.map((part) => [
      part.model,
      part.category,
      part.price,
      part.supplier,
      part.stock,
      part.notes || part.remark || '',
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

  async function removeSelectedParts() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`确定删除选中的 ${selectedIds.length} 个零件？此操作不可撤销。`)) return;

    setSaving(true);
    setError(null);

    try {
      await deleteParts(selectedIds);
      setSelectedIds([]);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量删除失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <FadePanel className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Parts</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">零件</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            零件列表、分类输入规则和库存写操作都走标准 API；保存后重新拉取库存底表。
          </p>
        </div>
        <div className="flex gap-2">
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
        </div>
      </FadePanel>

      <div className="grid gap-3 md:grid-cols-4">
        <FadePanel delay={0.02} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(String(parts.length), '零件种类')}
        </FadePanel>
        <FadePanel delay={0.04} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(money(stats.totalValue), '库存总价值')}
        </FadePanel>
        <FadePanel delay={0.06} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(String(stats.low), '低库存')}
        </FadePanel>
        <FadePanel delay={0.08} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(String(stats.out), '缺货零件')}
        </FadePanel>
      </div>

      <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3">
            <Search size={16} className="text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索型号、供应商或分类"
              className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-muted" />
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-9 min-w-32 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 hover:bg-slate-50"
              >
                {filterCategories.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <SegmentedControl
              value={quickFilter}
              options={quickFilters}
              onChange={setQuickFilter}
              ariaLabel="库存快速筛选"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCollapsedCategories(new Set())}
                icon={<ChevronDown size={14} />}
              >
                展开
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCollapsedCategories(new Set(groupedParts.map(([name]) => name)))}
                icon={<ChevronUp size={14} />}
              >
                折叠
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
                  <div className="flex items-center gap-3 bg-slate-50 px-4 py-3">
                    <input
                      type="checkbox"
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
                            <th className="border-b border-line px-4 py-3 w-10"></th>
                            <th className="border-b border-line px-4 py-3">型号</th>
                            <th className="border-b border-line px-4 py-3">分类</th>
                            <th className="border-b border-line px-4 py-3">供应商</th>
                            <th className="border-b border-line px-4 py-3 text-right">单价</th>
                            <th className="border-b border-line px-4 py-3 text-right">库存</th>
                            <th className="border-b border-line px-4 py-3">状态</th>
                            <th className="border-b border-line px-4 py-3 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupParts.map((part) => {
                            const stock = partStockStatus(part);
                            return (
                              <tr key={part.id} className="transition-colors duration-150 hover:bg-slate-50">
                                <td className="border-b border-line px-4 py-3">
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.includes(part.id)}
                                    onChange={(event) => toggleSelectPart(part.id, event.target.checked)}
                                    aria-label={`选择零件${part.model || part.id}`}
                                    className="h-4 w-4 rounded border-line text-ink"
                                  />
                                </td>
                                <td className="border-b border-line px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <Wrench size={15} className="text-muted" />
                                    <span className="font-medium text-ink">{part.model || '-'}</span>
                                  </div>
                                </td>
                                <td className="border-b border-line px-4 py-3">{categoryPill(part.category)}</td>
                                <td className="border-b border-line px-4 py-3 text-muted">{part.supplier || '-'}</td>
                                <td className="border-b border-line px-4 py-3 text-right font-medium text-ink">{money(part.price)}</td>
                                <td className="border-b border-line px-4 py-3 text-right text-muted">{part.stock}</td>
                                <td className="border-b border-line px-4 py-3 whitespace-nowrap">
                                  <StatusBadge tone={stock.status === 'out' ? 'red' : stock.status === 'low' ? 'amber' : 'green'}>{stock.label}</StatusBadge>
                                </td>
                                <td className="border-b border-line px-4 py-3">
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="ghost" onClick={() => openEditDrawer(part)} disabled={saving} icon={<Pencil size={14} />}>
                                      编辑
                                    </Button>
                                    <Button size="sm" variant="danger" onClick={() => void removePart(part)} disabled={saving} icon={<Trash2 size={14} />}>
                                      删除
                                    </Button>
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
          <Button size="sm" variant="ghost" onClick={() => void removeSelectedParts()} disabled={saving} icon={<Trash2 size={14} />} className="text-rose-200 hover:bg-rose-500/20 hover:text-rose-100">
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

      <SlideOver open={drawerOpen} onClose={() => !saving && setDrawerOpen(false)}>
        <form onSubmit={submitPart} className="flex min-h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Part</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
                {editingPart ? '编辑零件' : '新建零件'}
              </h2>
              <div className="mt-1 text-sm text-muted">按分类录入结构化字段，最终型号：{modelPreview || '-'}</div>
            </div>
            <button
              type="button"
              aria-label="关闭"
              disabled={saving}
              onClick={() => setDrawerOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-5 p-5">
            {formError ? (
              <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <CircleAlert size={16} />
                {formError}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">分类</span>
                <select
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  className={textInputClass()}
                >
                  {categoryOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-ink">供应商</span>
                <input
                  value={form.supplier}
                  onChange={(event) => setForm((current) => ({ ...current, supplier: event.target.value }))}
                  list="part-supplier-options"
                  className={textInputClass()}
                  placeholder="供应商名称"
                />
                <datalist id="part-supplier-options">
                  {supplierOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </label>
            </div>

            {isCapacitorMode ? (
              <label className="block">
                <span className="text-sm font-medium text-ink">电容容量</span>
                <div className="mt-2 flex rounded-md border border-line focus-within:border-slate-400">
                  <input
                    value={form.capacitorUf}
                    onChange={(event) => setForm((current) => ({ ...current, capacitorUf: event.target.value }))}
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
              <label className="block">
                <span className="text-sm font-medium text-ink">型号</span>
                <input
                  value={form.model}
                  onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                  className={textInputClass()}
                  placeholder="例如：6204 轴承"
                />
              </label>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">单价</span>
                <input
                  value={form.price}
                  onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                  type="number"
                  min="0"
                  step="0.001"
                  className={textInputClass()}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-ink">库存</span>
                <input
                  value={form.stock}
                  onChange={(event) => setForm((current) => ({ ...current, stock: event.target.value }))}
                  type="number"
                  min="0"
                  step="1"
                  className={textInputClass()}
                />
              </label>
            </div>

            {isCableMode ? (
              <section className="rounded-md border border-line bg-slate-50 p-4">
                <div className="text-sm font-medium text-ink">成品电缆插头 / 规格费用</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-muted">第一种名称</span>
                    <input
                      value={form.standardCableAccessoryName}
                      onChange={(event) => setForm((current) => ({ ...current, standardCableAccessoryName: event.target.value }))}
                      className={textInputClass()}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted">第一种费用</span>
                    <input
                      value={form.standardCableAccessoryFee}
                      onChange={(event) => setForm((current) => ({ ...current, standardCableAccessoryFee: event.target.value }))}
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
                      onChange={(event) => setForm((current) => ({ ...current, xinjieCableAccessoryName: event.target.value }))}
                      className={textInputClass()}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted">第二种费用</span>
                    <input
                      value={form.xinjieCableAccessoryFee}
                      onChange={(event) => setForm((current) => ({ ...current, xinjieCableAccessoryFee: event.target.value }))}
                      type="number"
                      min="0"
                      step="0.01"
                      className={textInputClass()}
                    />
                  </label>
                </div>
                {smallHelp('保存电缆零件时会同步更新全局 cable_accessories 设置，配方成本会读取同一口径。')}
              </section>
            ) : null}

            {isFloatMode ? (
              <section className="rounded-md border border-line bg-slate-50 p-4">
                <label className="block">
                  <span className="text-sm font-medium text-ink">新界式浮球加价</span>
                  <input
                    value={form.floatAccessoryDelta}
                    onChange={(event) => setForm((current) => ({ ...current, floatAccessoryDelta: event.target.value }))}
                    type="number"
                    min="0"
                    step="0.01"
                    className={textInputClass()}
                  />
                </label>
                {smallHelp('保存浮球零件时会同步更新全局 float_accessory_delta 设置。')}
              </section>
            ) : null}

            {isScrewMode ? (
              <section className="rounded-md border border-line bg-slate-50 p-4">
                <label className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={form.screwPricingEnabled}
                    onChange={(event) => setForm((current) => ({ ...current, screwPricingEnabled: event.target.checked }))}
                    className="h-4 w-4 rounded border-line"
                  />
                  按长度自动计价
                </label>
                {form.screwPricingEnabled ? (
                  <label className="mt-3 block">
                    <span className="text-xs font-medium text-muted">螺丝直径</span>
                    <input
                      value={form.screwDiameter}
                      onChange={(event) => setForm((current) => ({ ...current, screwDiameter: event.target.value }))}
                      type="number"
                      min="0"
                      step="0.1"
                      className={textInputClass()}
                      placeholder="例如：6"
                    />
                  </label>
                ) : null}
                {smallHelp('启用后 notes 会写入 screwPricing，成本引擎可按 6*长度 这类型号自动计算长螺丝单价。')}
              </section>
            ) : null}

            {isPumpShellMode ? (
              <section className="rounded-md border border-line bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-ink">泵壳默认参数</div>
                    <div className="mt-1 text-xs text-muted">这些字段会被转子出图、模板带入和成本流程复用。</div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={form.isStainless}
                      onChange={(event) => setForm((current) => ({ ...current, isStainless: event.target.checked }))}
                      className="h-4 w-4 rounded border-line"
                    />
                    不锈钢机筒
                  </label>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {[
                    ['openOffset', '开档偏移'],
                    ['defaultUpperBearing', '上轴承'],
                    ['defaultLowerBearing', '下轴承'],
                    ['defaultOilSealDia', '油封直径'],
                    ['defaultBearingSpan', '轴承档距'],
                    ['defaultImpellerDia', '叶轮外径'],
                    ['defaultImpellerSpan', '叶轮档距'],
                    ['defaultImpellerDepth', '叶轮深度'],
                    ['defaultThreadLength', '螺纹长度'],
                    ['defaultThreadDia', '螺纹直径'],
                    ['defaultStackOffset', '叠高偏移'],
                  ].map(([key, label]) => (
                    <label key={key} className="block">
                      <span className="text-xs font-medium text-muted">{label}</span>
                      <input
                        value={String(form[key as keyof PartFormState])}
                        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                        className={textInputClass()}
                      />
                    </label>
                  ))}
                </div>
              </section>
            ) : null}

            {!isCableMode && !isScrewMode && !isPumpShellMode ? (
              <label className="block">
                <span className="text-sm font-medium text-ink">备注</span>
                <textarea
                  value={form.rawNotes}
                  onChange={(event) => setForm((current) => ({ ...current, rawNotes: event.target.value }))}
                  rows={4}
                  className="mt-2 w-full resize-none rounded-md border border-line px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  placeholder="供应说明或临时备注"
                />
              </label>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line p-5">
            <Button type="button" variant="ghost" onClick={() => setDrawerOpen(false)} disabled={saving}>
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
        </form>
      </SlideOver>
    </div>
  );
}
