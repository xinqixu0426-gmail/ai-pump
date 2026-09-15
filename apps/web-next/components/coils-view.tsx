'use client';

import { useBusinessRefresh } from '@/lib/use-business-refresh';
import { previewCatalogName } from '@/lib/catalog-naming';
import { CatalogRenameDialog, type CatalogRenameTarget } from '@/components/catalog-rename-dialog';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence } from 'motion/react';
import { Boxes, Calculator, ChevronDown, ChevronRight, CircleDollarSign, Pencil, Plus, RefreshCw, Save, Search, Trash2, TrendingUp, X } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { PresenceRow } from '@/components/motion/presence-row';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import { InlineNotice } from '@/components/ui/notice';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { PageHeader } from '@/components/ui/page-header';
import { useConfirmDiscard } from '@/hooks/use-confirm-discard';
import { money } from '@/lib/format';
import {
  calculateCoilCost,
  adjustCoilStock,
  createCoil,
  deleteCoil,
  getAllCoils,
  getCoilSpecDraft,
  getCoilStockMovements,
  getMarketIndicators,
  updateCoil,
  updateCoilSpecPrice,
  updateMarketIndicators,
  type CoilCalcResult,
  type CoilRecord,
  type CoilStockMovement,
  type MarketIndicators,
} from '@/lib/coils';

type CoilFormState = {
  spec: string;
  diameterMm: string;
  material: string;
  slotType: '小眼' | '国标眼';
  sheets: string;
  schemeName: string;
  schemeCode: string;
  schemeStatus: 'testing' | 'official' | 'disabled';
  isDefault: boolean;
  ratedVoltageV: string;
  ratedFrequencyHz: string;
  market: string;
  schemeFamilyCode: string;
  pricingMode: 'calculated' | 'kit';
  kitPrice: string;
  unitPrice: string;
  wireWeight: string;
  copperBase: string;
  coilFee: string;
  rotorFee: string;
  defaultWireGauge: string;
  defaultCapacitor: string;
  mainWireGauge: string;
  mainWireData: string;
  auxWireGauge: string;
  auxWireData: string;
};

const emptyForm: CoilFormState = {
  spec: '',
  diameterMm: '',
  material: '钢带',
  slotType: '小眼',
  sheets: '',
  schemeName: '正式方案',
  schemeCode: '',
  schemeStatus: 'official',
  isDefault: false,
  ratedVoltageV: '',
  ratedFrequencyHz: '',
  market: '',
  schemeFamilyCode: '',
  pricingMode: 'calculated',
  kitPrice: '',
  unitPrice: '',
  wireWeight: '0',
  copperBase: '0',
  coilFee: '0',
  rotorFee: '0',
  defaultWireGauge: '',
  defaultCapacitor: '',
  mainWireGauge: '',
  mainWireData: '',
  auxWireGauge: '',
  auxWireData: '',
};

const autoFillControlledFields = new Set<keyof CoilFormState>([
  'spec',
  'diameterMm',
  'material',
  'slotType',
  'unitPrice',
  'wireWeight',
  'copperBase',
  'coilFee',
  'rotorFee',
  'defaultWireGauge',
  'defaultCapacitor',
]);

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formFromCoil(coil: CoilRecord): CoilFormState {
  return {
    spec: coil.spec,
    diameterMm: String(coil.diameterMm || ''),
    material: coil.material || '钢带',
    slotType: coil.slotType || '小眼',
    sheets: String(coil.sheets || ''),
    schemeName: coil.schemeName || '',
    schemeCode: coil.schemeCode || '',
    schemeStatus: coil.schemeStatus || 'official',
    isDefault: Boolean(coil.isDefault),
    ratedVoltageV: optionalNumberText(coil.ratedVoltageV),
    ratedFrequencyHz: optionalNumberText(coil.ratedFrequencyHz),
    market: coil.market || '',
    schemeFamilyCode: coil.schemeFamilyCode || '',
    pricingMode: coil.pricingMode || 'calculated',
    kitPrice: String(coil.kitPrice || ''),
    unitPrice: String(coil.unitPrice || ''),
    wireWeight: String(coil.wireWeight || 0),
    copperBase: String(coil.copperBase || 0),
    coilFee: String(coil.coilFee || 0),
    rotorFee: String(coil.rotorFee || 0),
    defaultWireGauge: coil.defaultWireGauge || '',
    defaultCapacitor: coil.defaultCapacitor || '',
    mainWireGauge: coil.mainWireGauge || '',
    mainWireData: coil.mainWireData || '',
    auxWireGauge: coil.auxWireGauge || '',
    auxWireData: coil.auxWireData || '',
  };
}

function needsSync(dbValue?: string | number | null, liveValue?: string | number | null, precision = 2) {
  const dbNumber = Number(dbValue);
  const liveNumber = Number(liveValue);
  if (!Number.isFinite(dbNumber) || !Number.isFinite(liveNumber)) return true;
  return dbNumber.toFixed(precision) !== liveNumber.toFixed(precision);
}

function numberText(value: string | number | null | undefined, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function optionalNumberText(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

function optionalPositiveNumberText(value: string | number | null | undefined, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '-';
  return number.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function diameterFromSpec(spec: string) {
  const value = spec.trim();
  if (value === '12') return '120';
  return /^\d+$/.test(value) ? value : '';
}

export function CoilsView() {
  const [coils, setCoils] = useState<CoilRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [marketIndicators, setMarketIndicators] = useState<MarketIndicators | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketUpdating, setMarketUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CatalogRenameTarget | null>(null);
  const [generatedCoilName, setGeneratedCoilName] = useState('');
  const [editingCoil, setEditingCoil] = useState<CoilRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CoilRecord | null>(null);
  const [form, setForm] = useState<CoilFormState>(emptyForm);
  useEffect(() => {
    let current = true;
    setGeneratedCoilName('');
    if (!drawerOpen || editingCoil || !form.spec.trim() || Number(form.sheets) <= 0) return;
    void previewCatalogName({ ruleId: 'coil', spec: {
      statorCode: form.spec.trim(), sheets: Number(form.sheets), material: form.material,
      slotType: form.slotType, scheme: form.schemeName.trim() || (form.schemeStatus === 'testing' ? '测试方案' : '正式方案'),
    } }).then(name => { if (current) setGeneratedCoilName(name); })
      .catch(() => { if (current) setGeneratedCoilName('请补齐并检查规格'); });
    return () => { current = false; };
  }, [drawerOpen, editingCoil, form.spec, form.sheets, form.material, form.slotType, form.schemeName, form.schemeStatus]);
  const [calcSpec, setCalcSpec] = useState('');
  const [calcMaterial, setCalcMaterial] = useState('钢带');
  const [calcSlotType, setCalcSlotType] = useState<'小眼' | '国标眼'>('小眼');
  const [calcSheets, setCalcSheets] = useState('');
  const [calcWireWeight, setCalcWireWeight] = useState('');
  const [calcResult, setCalcResult] = useState<CoilCalcResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [editingGroupPrice, setEditingGroupPrice] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const groupsInitializedRef = useRef(false);
  const [stockCoil, setStockCoil] = useState<CoilRecord | null>(null);
  const [stockDirection, setStockDirection] = useState<'in' | 'out'>('in');
  const [stockQty, setStockQty] = useState('');
  const [stockNote, setStockNote] = useState('');
  const [stockMovements, setStockMovements] = useState<CoilStockMovement[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const formSessionRef = useRef(0);
  const autoFillRequestRef = useRef(0);
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
    onDiscard: () => {
      formSessionRef.current += 1;
      setDrawerOpen(false);
    },
  });

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const [coilRows, indicatorData] = await Promise.all([
        getAllCoils(),
        getMarketIndicators().catch(() => null),
      ]);
      setCoils(coilRows);
      if (indicatorData) setMarketIndicators(indicatorData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '线圈数据加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useBusinessRefresh(() => load());

  const specOptions = useMemo(
    () => Array.from(new Set(coils.map((coil) => coil.spec).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    [coils]
  );
  const materials = ['钢带', '冷轧'];

  const filteredCoils = useMemo(() => {
    const text = query.trim().toLowerCase();
    return coils
      .filter((coil) => {
        if (!text) return true;
        return [
          coil.spec,
          coil.material,
          coil.slotType,
          coil.schemeName,
          coil.schemeCode,
          coil.market,
          coil.schemeFamilyCode,
          coil.ratedVoltageV,
          coil.ratedFrequencyHz,
          coil.schemeStatus,
          coil.pricingMode === 'kit' ? '供应商套件价' : '计算计价',
          coil.sheets,
          coil.defaultWireGauge,
          coil.defaultCapacitor,
          coil.mainWireGauge,
          coil.mainWireData,
          coil.auxWireGauge,
          coil.auxWireData,
          coil.stock,
        ]
          .join(' ')
          .toLowerCase()
          .includes(text);
      })
      .sort((a, b) => a.diameterMm - b.diameterMm || a.material.localeCompare(b.material, 'zh-Hans-CN') || a.slotType.localeCompare(b.slotType, 'zh-Hans-CN') || a.sheets - b.sheets);
  }, [coils, query]);

  const groupedCoils = useMemo(() => {
    const groups = new Map<string, CoilRecord[]>();
    filteredCoils.forEach((coil) => {
      const key = `${coil.commonName || coil.spec || '-'}（${coil.diameterMm}mm） / ${coil.material || '钢带'} / ${coil.slotType || '小眼'}`;
      groups.set(key, [...(groups.get(key) || []), coil]);
    });
    return Array.from(groups.entries()).map(([key, rows]) => ({ key, rows }));
  }, [filteredCoils]);

  useEffect(() => {
    if (query.trim()) {
      setCollapsedGroups(new Set());
      return;
    }
    if (!groupsInitializedRef.current && groupedCoils.length > 0) {
      setCollapsedGroups(new Set(groupedCoils.map((group) => group.key)));
      groupsInitializedRef.current = true;
    }
  }, [groupedCoils, query]);

  const stats = useMemo(() => {
    const specCount = new Set(coils.map((coil) => coil.statorVariantId || `${coil.diameterMm}-${coil.material}-${coil.slotType}`)).size;
    const avgCost = coils.length ? coils.reduce((sum, coil) => sum + coil.cost, 0) / coils.length : 0;
    return { specCount, avgCost };
  }, [coils]);

  function updateForm(patch: Partial<CoilFormState>) {
    if ((Object.keys(patch) as Array<keyof CoilFormState>).some((key) => autoFillControlledFields.has(key))) {
      autoFillRequestRef.current += 1;
    }
    setForm((current) => ({ ...current, ...patch }));
  }

  async function autoFillFromSpec(spec: string, diameterMm = form.diameterMm, material = form.material, slotType = form.slotType) {
    if (editingCoil) {
      updateForm({ spec, diameterMm });
      return;
    }
    const normalizedMaterial = (material || '钢带').trim();
    if (!spec.trim()) {
      updateForm({
        spec,
        diameterMm,
        material: normalizedMaterial,
      });
      return;
    }
    const formSession = formSessionRef.current;
    const requestId = ++autoFillRequestRef.current;
    try {
      const draft = await getCoilSpecDraft(spec.trim(), numberValue(diameterMm), normalizedMaterial, slotType);
      if (formSession !== formSessionRef.current || requestId !== autoFillRequestRef.current) return;
      setForm((current) => ({
        ...current,
        spec,
        diameterMm: String(draft.diameterMm || diameterMm),
        material: draft.material || normalizedMaterial,
        slotType: draft.slotType || slotType,
        unitPrice: draft.exactMaterial ? (optionalNumberText(draft.unitPrice) || current.unitPrice) : current.unitPrice,
        wireWeight: optionalNumberText(draft.wireWeight) || current.wireWeight,
        copperBase: optionalNumberText(draft.copperBase) || current.copperBase,
        coilFee: optionalNumberText(draft.coilFee) || current.coilFee,
        rotorFee: optionalNumberText(draft.rotorFee) || current.rotorFee,
        defaultWireGauge: draft.defaultWireGauge || current.defaultWireGauge,
        defaultCapacitor: draft.defaultCapacitor || current.defaultCapacitor,
      }));
    } catch (err) {
      if (formSession !== formSessionRef.current || requestId !== autoFillRequestRef.current) return;
      setError(err instanceof Error ? err.message : '线圈规格草稿生成失败');
    }
  }

  function updateFormMaterial(material: string) {
    updateForm({ material });
    if (!editingCoil && form.spec.trim()) {
      void autoFillFromSpec(form.spec, form.diameterMm, material, form.slotType);
    }
  }

  function updateFormSlotType(slotType: '小眼' | '国标眼') {
    updateForm({ slotType });
    if (!editingCoil && form.spec.trim()) {
      void autoFillFromSpec(form.spec, form.diameterMm, form.material, slotType);
    }
  }

  function openCreateDrawer() {
    formSessionRef.current += 1;
    resetFormDirty();
    setEditingCoil(null);
    const material = materials[0] || '钢带';
    setForm({
      ...emptyForm,
      material,
      copperBase: String(marketIndicators?.copper.dbPrice || marketIndicators?.copper.livePricePerKg || '0'),
    });
    setFormError(null);
    setDrawerOpen(true);
  }

  function openEditDrawer(coil: CoilRecord) {
    formSessionRef.current += 1;
    resetFormDirty();
    setEditingCoil(coil);
    setForm(formFromCoil(coil));
    setFormError(null);
    setDrawerOpen(true);
  }

  async function runCalculate() {
    if (!calcSpec.trim() || !calcSheets.trim()) {
      setError('请选择规格并输入片数');
      return;
    }
    setCalcLoading(true);
    setError(null);
    try {
      const result = await calculateCoilCost({
        spec: calcSpec.trim(),
        material: calcMaterial || '钢带',
        slotType: calcSlotType,
        sheets: numberValue(calcSheets),
        ...(calcWireWeight.trim() ? { wireWeight: numberValue(calcWireWeight) } : {}),
      });
      setCalcResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '线圈成本试算失败');
    } finally {
      setCalcLoading(false);
    }
  }

  async function refreshMarketIndicators() {
    setMarketLoading(true);
    setError(null);
    try {
      setMarketIndicators(await getMarketIndicators());
    } catch (err) {
      setError(err instanceof Error ? err.message : '市场指标加载失败');
    } finally {
      setMarketLoading(false);
    }
  }

  async function syncMarketIndicators() {
    setMarketUpdating(true);
    setError(null);
    try {
      await updateMarketIndicators();
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '市场指标同步失败');
    } finally {
      setMarketUpdating(false);
    }
  }

  async function saveGroupPrice(groupKey: string) {
    const group = groupedCoils.find((item) => item.key === groupKey);
    const first = group?.rows.find((coil) => coil.pricingMode === 'calculated');
    if (!first) return;
    setSaving(true);
    setError(null);
    try {
      await updateCoilSpecPrice(first.spec, first.material || '钢带', first.slotType || '小眼', numberValue(editingGroupPrice));
      setEditingGroupKey(null);
      setEditingGroupPrice('');
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '规格单价保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function submitCoil(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pricingMissing = form.pricingMode === 'kit'
      ? numberValue(form.kitPrice) <= 0
      : !form.unitPrice.trim();
    if (!form.spec.trim() || !form.diameterMm.trim() || !form.sheets.trim() || pricingMissing) {
      setFormError(form.pricingMode === 'kit'
        ? '规格俗称、定子直径、片数和大于 0 的供应商套件价不能为空'
        : '规格俗称、定子直径、片数和定子单片成本不能为空');
      return;
    }
    autoFillRequestRef.current += 1;
    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      const payload = {
        spec: form.spec.trim(),
        diameterMm: numberValue(form.diameterMm),
        material: form.material.trim() || '钢带',
        slotType: form.slotType,
        sheets: numberValue(form.sheets),
        schemeName: form.schemeName.trim(),
        ...(!editingCoil && form.schemeCode.trim() ? { schemeCode: form.schemeCode.trim() } : {}),
        schemeStatus: form.schemeStatus,
        isDefault: form.schemeStatus === 'official' && form.isDefault,
        ratedVoltageV: form.ratedVoltageV.trim() ? numberValue(form.ratedVoltageV) : null,
        ratedFrequencyHz: form.ratedFrequencyHz.trim() ? numberValue(form.ratedFrequencyHz) : null,
        market: form.market.trim(),
        schemeFamilyCode: form.schemeFamilyCode.trim(),
        pricingMode: form.pricingMode,
        kitPrice: form.pricingMode === 'kit' ? numberValue(form.kitPrice) : 0,
        unitPrice: numberValue(form.unitPrice),
        wireWeight: numberValue(form.wireWeight),
        copperBase: numberValue(form.copperBase),
        coilFee: numberValue(form.coilFee),
        rotorFee: numberValue(form.rotorFee),
        defaultWireGauge: form.defaultWireGauge.trim(),
        defaultCapacitor: form.defaultCapacitor.trim(),
        mainWireGauge: form.mainWireGauge.trim(),
        mainWireData: form.mainWireData.trim(),
        auxWireGauge: form.auxWireGauge.trim(),
        auxWireData: form.auxWireData.trim(),
      };
      if (editingCoil) await updateCoil(editingCoil, payload);
      else await createCoil(payload);
      await load(true);
      formSessionRef.current += 1;
      resetFormDirty();
      setDrawerOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '线圈记录保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeCoil(coil: CoilRecord) {
    setSaving(true);
    setError(null);
    try {
      await deleteCoil(coil);
      await load(true);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '线圈记录删除失败');
    } finally {
      setSaving(false);
    }
  }

  async function openStockDrawer(coil: CoilRecord) {
    setStockCoil(coil);
    setStockDirection('in');
    setStockQty('');
    setStockNote('');
    setStockMovements([]);
    setStockLoading(true);
    setError(null);
    try {
      setStockMovements(await getCoilStockMovements(coil.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '线圈库存流水加载失败');
    } finally {
      setStockLoading(false);
    }
  }

  async function submitStockAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stockCoil) return;
    const quantity = Number(stockQty);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError('库存数量必须是正整数');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await adjustCoilStock(
        stockCoil.id,
        stockDirection === 'in' ? quantity : -quantity,
        stockNote.trim(),
        stockCoil.updatedAt
      );
      setStockCoil(updated);
      setStockQty('');
      setStockNote('');
      setStockMovements(await getCoilStockMovements(updated.id));
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '线圈库存调整失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="线圈转子"
        description="维护定子组合、绕组方案、计算成本或供应商套件价，以及成品库存。"
        actions={(
          <>
          <Button onClick={() => void load(true)} disabled={refreshing || saving} icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}>
            刷新
          </Button>
          <Button variant="primary" onClick={openCreateDrawer} disabled={saving} icon={<Plus size={15} />}>
            新增记录
          </Button>
          </>
        )}
      />

      {error ? (
        <InlineNotice tone="danger">{error}</InlineNotice>
      ) : null}

      <FadePanel className="space-y-4 border-amber-200 bg-amber-50/70">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-amber-100 text-amber-700">
            <CircleDollarSign size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">实时市场指标</div>
            <div className="mt-1 text-xs text-muted">同步后只更新计算计价方案采用的铜价；供应商套件价保持不变。</div>
          </div>
        </div>
        {marketIndicators ? (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-amber-200 bg-white/70 p-3">
              <div className="text-xs font-medium text-amber-700">铜价</div>
              <div className="mt-1 text-xl font-semibold text-ink">¥{numberText(marketIndicators.copper.livePrice, 0)}</div>
              <div className="mt-1 text-xs text-muted">
                {numberText(marketIndicators.copper.livePricePerKg)} 元/千克 · 数据库 {marketIndicators.copper.dbPrice || '-'}
              </div>
              {needsSync(marketIndicators.copper.dbPrice, marketIndicators.copper.livePricePerKg) ? <div className="mt-2 text-xs font-medium text-amber-700">需要同步</div> : null}
            </div>
            <div className="rounded-md border border-amber-200 bg-white/70 p-3">
              <div className="text-xs font-medium text-amber-700">铝线价格</div>
              <div className="mt-1 text-xl font-semibold text-ink">¥{numberText(marketIndicators.aluminum.livePrice, 0)}</div>
              <div className="mt-1 text-xs text-muted">
                {numberText(marketIndicators.aluminum.livePricePerKg)} 元/千克 · 数据库 {marketIndicators.aluminum.dbPrice || '-'}
              </div>
              {needsSync(marketIndicators.aluminum.dbPrice, marketIndicators.aluminum.livePricePerKg) ? <div className="mt-2 text-xs font-medium text-amber-700">需要同步</div> : null}
            </div>
            <div className="rounded-md border border-amber-200 bg-white/70 p-3">
              <div className="text-xs font-medium text-amber-700">美元汇率</div>
              <div className="mt-1 text-xl font-semibold text-ink">{numberText(marketIndicators.exchangeRate.liveRate, 4)}</div>
              <div className="mt-1 text-xs text-muted">
                CNY/USD · 数据库 {marketIndicators.exchangeRate.dbRate || '-'}
              </div>
              {needsSync(marketIndicators.exchangeRate.dbRate, marketIndicators.exchangeRate.liveRate, 4) ? <div className="mt-2 text-xs font-medium text-amber-700">需要同步</div> : null}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-white/70 p-3 text-sm text-muted">
            {marketLoading ? '市场指标加载中...' : '市场指标暂不可用，可稍后刷新。'}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-amber-200 pt-3">
          <Button type="button" onClick={() => void refreshMarketIndicators()} disabled={marketLoading || marketUpdating} icon={<RefreshCw size={15} className={marketLoading ? 'animate-spin' : ''} />}>
            刷新指标
          </Button>
          <Button type="button" variant="primary" onClick={() => void syncMarketIndicators()} disabled={marketUpdating} icon={marketUpdating ? <RefreshCw size={15} className="animate-spin" /> : <TrendingUp size={15} />}>
            {marketUpdating ? '同步中' : '同步市场指标'}
          </Button>
        </div>
      </FadePanel>

      <div className="grid gap-3 md:grid-cols-3">
        <Panel elevated className="p-4">
          <div className="text-2xl font-semibold tracking-tight text-ink">{coils.length}</div>
          <div className="mt-1 text-xs text-muted">线圈记录</div>
        </Panel>
        <Panel elevated className="p-4">
          <div className="text-2xl font-semibold tracking-tight text-ink">{stats.specCount}</div>
          <div className="mt-1 text-xs text-muted">定子组合</div>
        </Panel>
        <Panel elevated className="p-4">
          <div className="text-2xl font-semibold tracking-tight text-ink">{money(stats.avgCost)}</div>
          <div className="mt-1 text-xs text-muted">平均成本</div>
        </Panel>
      </div>

      <FadePanel className="space-y-4">
        <Panel>
          <PanelHeader title="成本试算" icon={<Calculator size={16} />} />
          <PanelBody>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1.4fr)_minmax(8rem,.8fr)_minmax(8rem,.8fr)_minmax(7rem,.7fr)_minmax(12rem,1fr)_auto]">
              <Field label="规格">
                <Input
                  value={calcSpec}
                  onChange={(event) => setCalcSpec(event.target.value)}
                  list="coil-spec-options"
                />
              </Field>
              <Field label="材质">
                <Select
                  value={calcMaterial}
                  onChange={(event) => setCalcMaterial(event.target.value)}
                >
                  {materials.map((material) => (
                    <option key={material} value={material}>{material}</option>
                  ))}
                </Select>
              </Field>
              <Field label="槽眼">
                <Select
                  value={calcSlotType}
                  onChange={(event) => setCalcSlotType(event.target.value as '小眼' | '国标眼')}
                >
                  <option value="小眼">小眼</option>
                  <option value="国标眼">国标眼</option>
                </Select>
              </Field>
              <Field label="片数">
                <Input
                  value={calcSheets}
                  onChange={(event) => setCalcSheets(event.target.value)}
                  type="number"
                  min="0"
                  step="1"
                  selectOnFirstFocus
                />
              </Field>
              <Field label="自定义线重" hint="可选；留空时使用配方记录中的线重。">
                <Input
                  value={calcWireWeight}
                  onChange={(event) => setCalcWireWeight(event.target.value)}
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="可选"
                />
              </Field>
              <Button type="button" variant="primary" onClick={() => void runCalculate()} disabled={calcLoading} icon={<Calculator size={15} />} className="sm:self-start sm:mt-8">
                {calcLoading ? '试算中' : '试算'}
              </Button>
            </div>
            {calcResult ? (
              <div className="mt-4 rounded-md border border-line bg-slate-50 p-3 text-sm">
                <div className="text-xl font-semibold text-ink">{money(calcResult.totalCost)}</div>
                <div className="mt-2 text-muted">{calcResult.formula}</div>
                <div className="mt-2 grid gap-1 text-xs text-muted">
                  <span>定子：{calcResult.diameterMm}mm / {calcResult.material} / {calcResult.slotType}</span>
                  <span>来源：{calcResult.source || '-'}</span>
                  <span>搭配电缆横截面积（mm²）：{calcResult.wireGauge || '-'}</span>
                  <span>电容：{calcResult.capacitor ? `${calcResult.capacitor}μF` : '-'}</span>
                </div>
              </div>
            ) : null}
            <datalist id="coil-spec-options">
              {specOptions.map((spec) => <option key={spec} value={spec} />)}
            </datalist>
          </PanelBody>
        </Panel>

        <div className="min-w-0">
          <div className="mb-3 flex flex-col gap-2 rounded-md border border-line bg-white p-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
              <Search size={16} className="text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="搜索线圈记录"
                placeholder="搜索规格、材质、槽眼、方案、片数、电缆横截面积（mm²）或绕组数据"
                className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="清空搜索"
                  onClick={() => setQuery('')}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted transition hover:bg-slate-100 hover:text-ink"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line px-1 pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
              <span className="whitespace-nowrap text-xs text-muted">{filteredCoils.length} 条 · {groupedCoils.length} 组</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCollapsedGroups(
                    collapsedGroups.size > 0
                      ? new Set()
                      : new Set(groupedCoils.map((group) => group.key))
                  );
                }}
                icon={collapsedGroups.size > 0 ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              >
                {collapsedGroups.size > 0 ? '展开全部' : '收起全部'}
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="rounded-md border border-line p-6 text-sm text-muted">加载中...</div>
          ) : groupedCoils.length === 0 ? (
            <div className="rounded-md border border-line p-6 text-sm text-muted">暂无线圈记录</div>
          ) : (
            <div className="space-y-3">
              {groupedCoils.map((group) => {
                const collapsed = collapsedGroups.has(group.key);
                const calculatedRows = group.rows.filter((coil) => coil.pricingMode === 'calculated');
                const kitCount = group.rows.length - calculatedRows.length;
                return (
                <div key={group.key} className="overflow-hidden rounded-panel border border-line bg-white">
                  <div className={`flex items-center justify-between gap-3 px-4 py-2.5 ${collapsed ? '' : 'border-b border-line'}`}>
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      onClick={() => {
                        setCollapsedGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        });
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    >
                      {collapsed ? <ChevronRight size={16} className="shrink-0 text-muted" /> : <ChevronDown size={16} className="shrink-0 text-muted" />}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{group.key}</span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {group.rows.length} 条
                          {calculatedRows.length > 0 ? ` · 计算方案单片成本 ${money(calculatedRows[0]?.unitPrice || 0)}` : ''}
                          {kitCount > 0 ? ` · 套件价方案 ${kitCount} 条` : ''}
                        </span>
                      </span>
                    </button>
                    {calculatedRows.length > 0 && editingGroupKey === group.key ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          value={editingGroupPrice}
                          onChange={(event) => setEditingGroupPrice(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveGroupPrice(group.key);
                            if (event.key === 'Escape') setEditingGroupKey(null);
                          }}
                          type="number"
                          min="0"
                          step="0.0001"
                          autoFocus
                          selectOnFirstFocus
                          compact
                          className="w-28"
                        />
                        <Button size="sm" variant="primary" disabled={saving} onClick={() => void saveGroupPrice(group.key)}>
                          保存
                        </Button>
                        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditingGroupKey(null)}>
                          取消
                        </Button>
                      </div>
                    ) : calculatedRows.length > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => {
                          setEditingGroupKey(group.key);
                          setEditingGroupPrice(String(calculatedRows[0]?.unitPrice || ''));
                        }}
                        icon={<Pencil size={14} />}
                      >
                        改定子单片成本
                      </Button>
                    ) : null}
                  </div>
                  {!collapsed ? <div className="overflow-x-auto">
                    <table className="w-full min-w-[1380px] border-collapse text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-muted">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">片数</th>
                          <th className="px-4 py-2.5 font-medium">方案名称</th>
                          <th className="px-4 py-2.5 font-medium">状态</th>
                          <th className="px-4 py-2.5 font-medium">电压</th>
                          <th className="px-4 py-2.5 font-medium">频率</th>
                          <th className="px-4 py-2.5 font-medium">计价</th>
                          <th className="px-4 py-2.5 font-medium">线圈套成本</th>
                          <th className="px-4 py-2.5 font-medium">线重</th>
                          <th className="px-4 py-2.5 font-medium">库存</th>
                          <th className="px-4 py-2.5 font-medium">默认搭配</th>
                          <th className="px-4 py-2.5 font-medium">绕组数据</th>
                          <th className="px-4 py-2.5 text-right font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        <AnimatePresence initial={false}>
                          {group.rows.map((coil) => (
                            <PresenceRow key={coil.id}>
                              <td className="border-b border-line px-4 py-2.5 font-medium text-ink">{coil.sheets}</td>
                              <td className="border-b border-line px-4 py-2.5 font-medium text-ink">
                                {coil.schemeName || (coil.schemeStatus === 'testing' ? '测试方案' : '正式方案')}
                              </td>
                              <td className="border-b border-line px-4 py-2.5">
                                <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                                  coil.schemeStatus === 'official'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : coil.schemeStatus === 'testing'
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {coil.schemeStatus === 'official' ? '正式' : coil.schemeStatus === 'testing' ? '测试' : '停用'}
                                </span>
                                {coil.isDefault ? <span className="ml-1 mt-1 inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">默认</span> : null}
                              </td>
                              <td className="border-b border-line px-4 py-2.5 text-muted">{coil.ratedVoltageV ? `${coil.ratedVoltageV}V` : '-'}</td>
                              <td className="border-b border-line px-4 py-2.5 text-muted">{coil.ratedFrequencyHz ? `${coil.ratedFrequencyHz}Hz` : '-'}</td>
                              <td className="border-b border-line px-4 py-2.5">
                                <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${coil.pricingMode === 'kit' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {coil.pricingMode === 'kit' ? '供应商套件价' : '计算计价'}
                                </span>
                              </td>
                              <td className="border-b border-line px-4 py-2.5">
                                <div className="font-medium text-ink">{money(coil.cost)}</div>
                                <div className="mt-0.5 whitespace-nowrap text-xs text-muted">
                                  {coil.pricingMode === 'kit'
                                    ? '套件总价'
                                    : `单片 ${money(coil.unitPrice)} · 加工 ${money(coil.coilFee + coil.rotorFee)}`}
                                </div>
                              </td>
                              <td className="border-b border-line px-4 py-2.5 text-muted">{coil.pricingMode === 'kit' ? `${optionalPositiveNumberText(coil.wireWeight)}${coil.wireWeight > 0 ? ' kg' : ''}` : `${coil.wireWeight} kg`}</td>
                              <td className="border-b border-line px-4 py-2.5">
                                <div className="font-medium text-ink">{coil.stock} 套</div>
                                <div className={`mt-1 text-xs ${coil.stock > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                  {coil.stock > 0 ? '有库存' : '待补充'}
                                </div>
                              </td>
                              <td className="border-b border-line px-4 py-2.5 text-xs text-muted">
                                <div>电缆：{coil.defaultWireGauge || '-'}</div>
                                <div className="mt-1">电容：{coil.defaultCapacitor || '-'}</div>
                              </td>
                              <td className="border-b border-line px-4 py-2.5 text-xs text-muted">
                                <div>主：{[coil.mainWireGauge, coil.mainWireData].filter(Boolean).join(' · ') || '-'}</div>
                                <div className="mt-1">副：{[coil.auxWireGauge, coil.auxWireData].filter(Boolean).join(' · ') || '-'}</div>
                              </td>
                              <td className="border-b border-line px-4 py-2.5">
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => void openStockDrawer(coil)} icon={<Boxes size={14} />}>
                                    库存
                                  </Button>
                                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => openEditDrawer(coil)} icon={<Pencil size={14} />}>
                                    编辑
                                  </Button>
                                  <Button size="sm" variant="danger" disabled={saving} onClick={() => setDeleteTarget(coil)} icon={<Trash2 size={14} />}>
                                    删除
                                  </Button>
                                </div>
                              </td>
                            </PresenceRow>
                          ))}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  </div> : null}
                </div>
                );
              })}
            </div>
          )}
        </div>
      </FadePanel>

      <SlideOver
        open={drawerOpen}
        onClose={requestDrawerClose}
        ariaLabel={editingCoil ? '编辑线圈记录' : '新增线圈记录'}
      >
        <form onSubmit={submitCoil} onChange={markFormDirty} className="flex min-h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Coil</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{editingCoil ? '编辑线圈记录' : '新增线圈记录'}</h2>
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
              <Field label="规格俗称">
                <Input
                  value={form.spec}
                  onChange={(event) => {
                    const spec = event.target.value;
                    const diameterMm = diameterFromSpec(spec) || form.diameterMm;
                    updateForm({ spec, diameterMm });
                    if (!editingCoil && specOptions.includes(spec)) void autoFillFromSpec(spec, diameterMm, form.material, form.slotType);
                  }}
                  onBlur={() => {
                    if (!editingCoil && form.spec.trim()) void autoFillFromSpec(form.spec, form.diameterMm, form.material, form.slotType);
                  }}
                  list="coil-spec-options"
                  placeholder="例如 12"
                />
              </Field>
              <Field label="定子直径 mm" hint="俗称 12 对应标准直径 120mm。">
                <Input value={form.diameterMm} onChange={(event) => updateForm({ diameterMm: event.target.value })} type="number" min="1" step="1" placeholder="例如 120" selectOnFirstFocus />
              </Field>
              <Field label="材质">
                <Select value={form.material} onChange={(event) => updateFormMaterial(event.target.value)}>
                  <option value="钢带">钢带</option>
                  <option value="冷轧">冷轧</option>
                </Select>
              </Field>
              <Field label="槽眼">
                <Select value={form.slotType} onChange={(event) => updateFormSlotType(event.target.value as '小眼' | '国标眼')}>
                  <option value="小眼">小眼</option>
                  <option value="国标眼">国标眼</option>
                </Select>
              </Field>
              <Field label="片数">
                <Input value={form.sheets} onChange={(event) => updateForm({ sheets: event.target.value })} type="number" min="0" step="1" selectOnFirstFocus />
              </Field>
              <Field label="方案状态" hint="同一定子组合和片数可有多套正式方案，但最多一套默认方案。">
                <Select value={form.schemeStatus} onChange={(event) => {
                  const schemeStatus = event.target.value as CoilFormState['schemeStatus'];
                  updateForm({ schemeStatus, ...(schemeStatus !== 'official' ? { isDefault: false } : {}) });
                }}>
                  <option value="official">正式方案</option>
                  <option value="testing">测试方案</option>
                  <option value="disabled">停用</option>
                </Select>
              </Field>
              <Field label={editingCoil ? '方案名称' : '方案区别'} hint={editingCoil ? undefined : '填写需要区分的方案特点，系统按规格生成完整名称。'} className="md:col-span-2">
                <Input value={form.schemeName} onChange={(event) => updateForm({ schemeName: event.target.value })} placeholder="例如 高扬程测试方案" />
              </Field>
              {!editingCoil ? <Field label="生成名称" className="md:col-span-2"><Input value={generatedCoilName} readOnly placeholder="填写规格和片数后生成" /></Field> : null}
              {editingCoil ? <Button type="button" disabled={formDirty} title={formDirty ? '请先保存或取消当前修改' : undefined} onClick={() => setRenameTarget({ entityType: 'coil', entityId: editingCoil.id, name: editingCoil.schemeName || '', updatedAt: editingCoil.updatedAt || '' })}>按规格规范名称</Button> : null}
              <Field label="方案编码" hint={editingCoil ? '稳定编码创建后不可修改，用于跨页面和接口绑定。' : '可留空，由系统自动生成。'}>
                <Input value={form.schemeCode} onChange={(event) => updateForm({ schemeCode: event.target.value })} disabled={Boolean(editingCoil)} placeholder="例如 COIL-12-200-MY240" />
              </Field>
              <Field label="方案族编码" hint="同一设计族可用于不同片数间插值；不同电压/频率建议分族。">
                <Input value={form.schemeFamilyCode} onChange={(event) => updateForm({ schemeFamilyCode: event.target.value })} placeholder="例如 12-220V-50HZ" />
              </Field>
              <Field label="额定电压 V">
                <Input value={form.ratedVoltageV} onChange={(event) => updateForm({ ratedVoltageV: event.target.value })} type="number" min="1" step="1" placeholder="220 或 240" />
              </Field>
              <Field label="额定频率 Hz">
                <Input value={form.ratedFrequencyHz} onChange={(event) => updateForm({ ratedFrequencyHz: event.target.value })} type="number" min="1" step="1" placeholder="50 或 60" />
              </Field>
              <Field label="适用市场">
                <Input value={form.market} onChange={(event) => updateForm({ market: event.target.value })} placeholder="例如 通用、马来西亚" />
              </Field>
              <label className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-sm text-ink">
                <Checkbox
                  checked={form.isDefault}
                  disabled={form.schemeStatus !== 'official'}
                  onChange={(event) => updateForm({ isDefault: event.target.checked })}
                />
                设为该组合默认方案
              </label>
              <Field label="计价方式" className="md:col-span-2" hint="供应商套件价只按完整套件价格计价，不参与其他片数的插值或外推。">
                <Select value={form.pricingMode} onChange={(event) => updateForm({ pricingMode: event.target.value as CoilFormState['pricingMode'] })}>
                  <option value="calculated">计算计价</option>
                  <option value="kit">供应商套件价</option>
                </Select>
              </Field>
              {form.pricingMode === 'kit' ? (
                <>
                  <Field label="供应商套件价" className="md:col-span-2" hint="每套线圈转子的直接采购成本，不再计算定子、铜重或加工费。">
                    <Input value={form.kitPrice} onChange={(event) => updateForm({ kitPrice: event.target.value })} type="number" min="0.01" step="0.01" selectOnFirstFocus />
                  </Field>
                  <Field label="线重 kg（可选）" hint="仅作套件价格参考，不参与成本计算。">
                    <Input value={form.wireWeight} onChange={(event) => updateForm({ wireWeight: event.target.value })} type="number" min="0" step="0.001" />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    label="定子单片成本"
                    hint={editingCoil?.pricingMode === 'calculated' ? '定子单片成本请在定子组合里批量修改，保持同直径、材质和槽眼一致。' : undefined}
                  >
                    <Input value={form.unitPrice} onChange={(event) => updateForm({ unitPrice: event.target.value })} type="number" min="0" step="0.0001" disabled={editingCoil?.pricingMode === 'calculated'} selectOnFirstFocus />
                  </Field>
                  <Field label="线重 kg">
                    <Input value={form.wireWeight} onChange={(event) => updateForm({ wireWeight: event.target.value })} type="number" min="0" step="0.001" />
                  </Field>
                  <Field label="线圈加工费">
                    <Input value={form.coilFee} onChange={(event) => updateForm({ coilFee: event.target.value })} type="number" min="0" step="0.01" selectOnFirstFocus />
                  </Field>
                  <Field label="转子加工费">
                    <Input value={form.rotorFee} onChange={(event) => updateForm({ rotorFee: event.target.value })} type="number" min="0" step="0.01" selectOnFirstFocus />
                  </Field>
                </>
              )}
              <Field label="默认搭配电缆横截面积（mm²）">
                <Input value={form.defaultWireGauge} onChange={(event) => updateForm({ defaultWireGauge: event.target.value })} />
              </Field>
              <Field label="默认电容 μF">
                <Input value={form.defaultCapacitor} onChange={(event) => updateForm({ defaultCapacitor: event.target.value })} />
              </Field>
              <div className="border-t border-line pt-4 md:col-span-2">
                <div className="text-sm font-medium text-ink">绕组技术参数</div>
                <div className="mt-1 text-xs text-muted">选填，用于记录线圈绕组数据备忘。</div>
              </div>
              <Field label="主线线径">
                <Input value={form.mainWireGauge} onChange={(event) => updateForm({ mainWireGauge: event.target.value })} placeholder="例如 0.55" />
              </Field>
              <Field label="主线数据">
                <Input value={form.mainWireData} onChange={(event) => updateForm({ mainWireData: event.target.value })} placeholder="匝数、绕法等备忘" />
              </Field>
              <Field label="副线线径">
                <Input value={form.auxWireGauge} onChange={(event) => updateForm({ auxWireGauge: event.target.value })} placeholder="例如 0.45" />
              </Field>
              <Field label="副线数据">
                <Input value={form.auxWireData} onChange={(event) => updateForm({ auxWireData: event.target.value })} placeholder="匝数、绕法等备忘" />
              </Field>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line p-5">
            <div className="text-xs text-muted" aria-live="polite">{formDirty ? '有未保存修改' : '尚未修改'}</div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={requestDrawerClose} disabled={saving}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={saving} icon={<Save size={15} />}>
                {saving ? '保存中' : '保存记录'}
              </Button>
            </div>
          </div>
        </form>
      </SlideOver>

      <CatalogRenameDialog target={renameTarget} onClose={() => setRenameTarget(null)} onSaved={async () => { await load(); setDrawerOpen(false); }} />
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

      <SlideOver
        open={Boolean(stockCoil)}
        onClose={() => !saving && setStockCoil(null)}
        ariaLabel="线圈库存"
      >
        {stockCoil ? (
          <form onSubmit={submitStockAdjustment} className="flex min-h-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-line p-5">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Inventory</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">线圈库存</h2>
                <p className="mt-1 text-sm text-muted">
                  {stockCoil.spec}-{stockCoil.sheets} · {stockCoil.material} · {stockCoil.slotType}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                disabled={saving}
                onClick={() => setStockCoil(null)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-6 p-5">
              <div className="border-b border-line pb-5">
                <div className="text-sm text-muted">当前库存</div>
                <div className="mt-2 text-3xl font-semibold text-ink">{stockCoil.stock} 套</div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-ink">变动方向</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button type="button" variant={stockDirection === 'in' ? 'primary' : 'ghost'} onClick={() => setStockDirection('in')}>
                      入库
                    </Button>
                    <Button type="button" variant={stockDirection === 'out' ? 'primary' : 'ghost'} onClick={() => setStockDirection('out')}>
                      出库
                    </Button>
                  </div>
                </div>
                <Field label="数量（套）">
                  <Input
                    value={stockQty}
                    onChange={(event) => setStockQty(event.target.value)}
                    type="number"
                    min="1"
                    step="1"
                    selectOnFirstFocus
                  />
                </Field>
                <Field label="备注">
                  <Input
                    value={stockNote}
                    onChange={(event) => setStockNote(event.target.value)}
                    placeholder="例如 盘点调整、样机领用"
                  />
                </Field>
                <Button type="submit" variant="primary" disabled={saving} icon={<Save size={15} />}>
                  {saving ? '保存中' : '保存库存变动'}
                </Button>
              </div>

              <div className="border-t border-line pt-5">
                <div className="text-sm font-semibold text-ink">最近流水</div>
                {stockLoading ? (
                  <div className="mt-3 text-sm text-muted">加载中...</div>
                ) : stockMovements.length === 0 ? (
                  <div className="mt-3 text-sm text-muted">暂无库存流水</div>
                ) : (
                  <div className="mt-3 divide-y divide-line border-y border-line">
                    {stockMovements.map((movement) => (
                      <div key={movement.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="text-ink">{movement.note || (movement.movementType === 'purchase_inbound' ? '订单采购入库' : '手工调整')}</div>
                          <div className="mt-1 text-xs text-muted">{new Date(movement.createdAt).toLocaleString('zh-CN')}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={movement.changeQty > 0 ? 'font-medium text-emerald-700' : 'font-medium text-rose-700'}>
                            {movement.changeQty > 0 ? '+' : ''}{movement.changeQty}
                          </div>
                          <div className="mt-1 text-xs text-muted">结存 {movement.balanceAfter}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </form>
        ) : null}
      </SlideOver>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除线圈记录？"
        description={deleteTarget
          ? `线圈“${deleteTarget.spec} / ${deleteTarget.sheets}片 / ${deleteTarget.material} / ${deleteTarget.slotType}”将被永久删除，此操作无法撤销；系统审计日志仍会保留。已有库存或被业务数据引用时，后端仍会执行最终校验。`
          : ''}
        confirmLabel="删除线圈"
        confirmVariant="danger"
        busy={saving}
        onConfirm={() => deleteTarget && void removeCoil(deleteTarget)}
        onClose={() => {
          if (!saving) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
