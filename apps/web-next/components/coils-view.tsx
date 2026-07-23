'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence } from 'motion/react';
import { Calculator, CircleAlert, CircleDollarSign, Pencil, Plus, RefreshCw, Save, Search, Trash2, TrendingUp, X } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { PresenceRow } from '@/components/motion/presence-row';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import {
  calculateCoilCost,
  createCoil,
  deleteCoil,
  getAllCoils,
  getCoilSpecDraft,
  getMarketIndicators,
  updateCoil,
  updateCoilSpecPrice,
  updateMarketIndicators,
  type CoilCalcResult,
  type CoilRecord,
  type MarketIndicators,
} from '@/lib/coils';

type CoilFormState = {
  spec: string;
  diameterMm: string;
  material: string;
  slotType: '小眼' | '国标眼';
  sheets: string;
  schemeName: string;
  schemeStatus: 'testing' | 'official' | 'disabled';
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
  schemeStatus: 'official',
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
    schemeStatus: coil.schemeStatus || 'official',
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
  const [editingCoil, setEditingCoil] = useState<CoilRecord | null>(null);
  const [form, setForm] = useState<CoilFormState>(emptyForm);
  const [calcSpec, setCalcSpec] = useState('');
  const [calcMaterial, setCalcMaterial] = useState('钢带');
  const [calcSlotType, setCalcSlotType] = useState<'小眼' | '国标眼'>('小眼');
  const [calcSheets, setCalcSheets] = useState('');
  const [calcWireWeight, setCalcWireWeight] = useState('');
  const [calcResult, setCalcResult] = useState<CoilCalcResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [editingGroupPrice, setEditingGroupPrice] = useState('');

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
          coil.schemeStatus,
          coil.sheets,
          coil.defaultWireGauge,
          coil.defaultCapacitor,
          coil.mainWireGauge,
          coil.mainWireData,
          coil.auxWireGauge,
          coil.auxWireData,
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

  const stats = useMemo(() => {
    const specCount = new Set(coils.map((coil) => coil.statorVariantId || `${coil.diameterMm}-${coil.material}-${coil.slotType}`)).size;
    const avgCost = coils.length ? coils.reduce((sum, coil) => sum + coil.cost, 0) / coils.length : 0;
    return { specCount, avgCost };
  }, [coils]);

  function updateForm(patch: Partial<CoilFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function autoFillFromSpec(spec: string, diameterMm = form.diameterMm, material = form.material, slotType = form.slotType) {
    if (editingCoil) {
      updateForm({ spec, diameterMm });
      return;
    }
    const normalizedMaterial = (material || '钢带').trim();
    if (!spec.trim()) {
      setForm((current) => ({
        ...current,
        spec,
        diameterMm,
        material: normalizedMaterial,
      }));
      return;
    }
    try {
      const draft = await getCoilSpecDraft(spec.trim(), numberValue(diameterMm), normalizedMaterial, slotType);
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
      setError(err instanceof Error ? err.message : '线圈规格草稿生成失败');
    }
  }

  function updateFormMaterial(material: string) {
    if (!editingCoil && form.spec.trim()) {
      void autoFillFromSpec(form.spec, form.diameterMm, material, form.slotType);
      return;
    }
    setForm((current) => ({ ...current, material }));
  }

  function updateFormSlotType(slotType: '小眼' | '国标眼') {
    if (!editingCoil && form.spec.trim()) {
      void autoFillFromSpec(form.spec, form.diameterMm, form.material, slotType);
      return;
    }
    updateForm({ slotType });
  }

  function openCreateDrawer() {
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
    const first = group?.rows[0];
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
    if (!form.spec.trim() || !form.diameterMm.trim() || !form.sheets.trim() || !form.unitPrice.trim()) {
      setFormError('规格俗称、定子直径、片数和单片价不能为空');
      return;
    }
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
        schemeStatus: form.schemeStatus,
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
      if (editingCoil) await updateCoil(editingCoil.id, payload);
      else await createCoil(payload);
      await load(true);
      setDrawerOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '线圈记录保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeCoil(coil: CoilRecord) {
    if (!window.confirm(`确定删除「${coil.spec} / ${coil.sheets}片」？`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteCoil(coil.id);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '线圈记录删除失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <FadePanel className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Coils</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">线圈转子</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">维护定子组合、绕组方案和线圈成本。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void load(true)} disabled={refreshing || saving} icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}>
            刷新
          </Button>
          <Button variant="primary" onClick={openCreateDrawer} disabled={saving} icon={<Plus size={15} />}>
            新增记录
          </Button>
        </div>
      </FadePanel>

      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <CircleAlert size={16} />
          {error}
        </div>
      ) : null}

      <FadePanel className="space-y-4 border-amber-200 bg-amber-50/70">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-amber-100 text-amber-700">
              <CircleDollarSign size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">实时市场指标</div>
              <div className="mt-1 text-xs text-muted">同步后会刷新线圈铜价基数、铝线基数和美元汇率设置。</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void refreshMarketIndicators()} disabled={marketLoading || marketUpdating} icon={<RefreshCw size={15} className={marketLoading ? 'animate-spin' : ''} />}>
              刷新指标
            </Button>
            <Button type="button" variant="primary" onClick={() => void syncMarketIndicators()} disabled={marketUpdating} icon={marketUpdating ? <RefreshCw size={15} className="animate-spin" /> : <TrendingUp size={15} />}>
              {marketUpdating ? '同步中' : '同步市场指标'}
            </Button>
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
      </FadePanel>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="text-2xl font-semibold tracking-tight text-ink">{coils.length}</div>
          <div className="mt-1 text-xs text-muted">线圈记录</div>
        </div>
        <div className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="text-2xl font-semibold tracking-tight text-ink">{stats.specCount}</div>
          <div className="mt-1 text-xs text-muted">定子组合</div>
        </div>
        <div className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="text-2xl font-semibold tracking-tight text-ink">{money(stats.avgCost)}</div>
          <div className="mt-1 text-xs text-muted">平均成本</div>
        </div>
      </div>

      <FadePanel className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="rounded-panel border border-line p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Calculator size={16} />
            成本试算
          </div>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-ink">规格</span>
              <input
                value={calcSpec}
                onChange={(event) => setCalcSpec(event.target.value)}
                list="coil-spec-options"
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">材质</span>
                <select
                  value={calcMaterial}
                  onChange={(event) => setCalcMaterial(event.target.value)}
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                >
                  {materials.map((material) => (
                    <option key={material} value={material}>{material}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">槽眼</span>
                <select
                  value={calcSlotType}
                  onChange={(event) => setCalcSlotType(event.target.value as '小眼' | '国标眼')}
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                >
                  <option value="小眼">小眼</option>
                  <option value="国标眼">国标眼</option>
                </select>
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">片数</span>
                <input
                  value={calcSheets}
                  onChange={(event) => setCalcSheets(event.target.value)}
                  type="number"
                  min="0"
                  step="1"
                  className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">自定义线重</span>
                <input
                  value={calcWireWeight}
                  onChange={(event) => setCalcWireWeight(event.target.value)}
                  type="number"
                  min="0"
                  step="0.001"
                  className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  placeholder="可选"
                />
              </label>
            </div>
            <Button type="button" variant="primary" onClick={() => void runCalculate()} disabled={calcLoading} icon={<Calculator size={15} />}>
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
                <span>线径：{calcResult.wireGauge || '-'}</span>
                <span>电容：{calcResult.capacitor ? `${calcResult.capacitor}μF` : '-'}</span>
              </div>
            </div>
          ) : null}
          <datalist id="coil-spec-options">
            {specOptions.map((spec) => <option key={spec} value={spec} />)}
          </datalist>
        </div>

        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2">
            <Search size={16} className="text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索规格、材质、槽眼、方案、片数、线径"
              className="h-8 flex-1 bg-transparent text-sm outline-none"
            />
          </div>

          {loading ? (
            <div className="rounded-md border border-line p-6 text-sm text-muted">加载中...</div>
          ) : groupedCoils.length === 0 ? (
            <div className="rounded-md border border-line p-6 text-sm text-muted">暂无线圈记录</div>
          ) : (
            <div className="space-y-4">
              {groupedCoils.map((group) => (
                <div key={group.key} className="overflow-hidden rounded-panel border border-line bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{group.key}</div>
                      <div className="mt-1 text-xs text-muted">{group.rows.length} 条 · 当前单片价 {money(group.rows[0]?.unitPrice || 0)}</div>
                    </div>
                    {editingGroupKey === group.key ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <input
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
                          className="h-8 w-28 rounded-md border border-line px-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                        />
                        <Button size="sm" variant="primary" disabled={saving} onClick={() => void saveGroupPrice(group.key)}>
                          保存
                        </Button>
                        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditingGroupKey(null)}>
                          取消
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => {
                          setEditingGroupKey(group.key);
                          setEditingGroupPrice(String(group.rows[0]?.unitPrice || ''));
                        }}
                        icon={<Pencil size={14} />}
                      >
                        改单价
                      </Button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-muted">
                        <tr>
                          <th className="px-4 py-3 font-medium">片数</th>
                          <th className="px-4 py-3 font-medium">方案</th>
                          <th className="px-4 py-3 font-medium">单片价</th>
                          <th className="px-4 py-3 font-medium">线重</th>
                          <th className="px-4 py-3 font-medium">铜价基数</th>
                          <th className="px-4 py-3 font-medium">加工费</th>
                          <th className="px-4 py-3 font-medium">总成本</th>
                          <th className="px-4 py-3 font-medium">默认线径</th>
                          <th className="px-4 py-3 font-medium">绕组数据</th>
                          <th className="px-4 py-3 text-right font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        <AnimatePresence initial={false}>
                          {group.rows.map((coil) => (
                            <PresenceRow key={coil.id}>
                              <td className="border-b border-line px-4 py-3 font-medium text-ink">{coil.sheets}</td>
                              <td className="border-b border-line px-4 py-3">
                                <div className="text-ink">{coil.schemeName || (coil.schemeStatus === 'testing' ? '测试方案' : '正式方案')}</div>
                                <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                                  coil.schemeStatus === 'official'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : coil.schemeStatus === 'testing'
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {coil.schemeStatus === 'official' ? '正式' : coil.schemeStatus === 'testing' ? '测试' : '停用'}
                                </span>
                              </td>
                              <td className="border-b border-line px-4 py-3 text-muted">{money(coil.unitPrice)}</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{coil.wireWeight} kg</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{money(coil.copperBase)}</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{money(coil.coilFee + coil.rotorFee)}</td>
                              <td className="border-b border-line px-4 py-3 font-medium text-ink">{money(coil.cost)}</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{coil.defaultWireGauge || '-'}</td>
                              <td className="border-b border-line px-4 py-3 text-xs text-muted">
                                <div>主：{[coil.mainWireGauge, coil.mainWireData].filter(Boolean).join(' · ') || '-'}</div>
                                <div className="mt-1">副：{[coil.auxWireGauge, coil.auxWireData].filter(Boolean).join(' · ') || '-'}</div>
                              </td>
                              <td className="border-b border-line px-4 py-3">
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => openEditDrawer(coil)} icon={<Pencil size={14} />}>
                                    编辑
                                  </Button>
                                  <Button size="sm" variant="danger" disabled={saving} onClick={() => void removeCoil(coil)} icon={<Trash2 size={14} />}>
                                    删除
                                  </Button>
                                </div>
                              </td>
                            </PresenceRow>
                          ))}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </FadePanel>

      <SlideOver open={drawerOpen} onClose={() => !saving && setDrawerOpen(false)}>
        <form onSubmit={submitCoil} className="flex min-h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Coil</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{editingCoil ? '编辑线圈记录' : '新增线圈记录'}</h2>
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
                <span className="text-sm font-medium text-ink">规格俗称</span>
                <input
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
                  className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">定子直径 mm</span>
                <input value={form.diameterMm} onChange={(event) => updateForm({ diameterMm: event.target.value })} type="number" min="1" step="1" placeholder="例如 120" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                <span className="mt-1 block text-xs text-muted">俗称 12 对应标准直径 120mm。</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">材质</span>
                <select value={form.material} onChange={(event) => updateFormMaterial(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400">
                  <option value="钢带">钢带</option>
                  <option value="冷轧">冷轧</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">槽眼</span>
                <select value={form.slotType} onChange={(event) => updateFormSlotType(event.target.value as '小眼' | '国标眼')} className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400">
                  <option value="小眼">小眼</option>
                  <option value="国标眼">国标眼</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">片数</span>
                <input value={form.sheets} onChange={(event) => updateForm({ sheets: event.target.value })} type="number" min="0" step="1" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">方案状态</span>
                <select value={form.schemeStatus} onChange={(event) => updateForm({ schemeStatus: event.target.value as CoilFormState['schemeStatus'] })} className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400">
                  <option value="official">正式方案</option>
                  <option value="testing">测试方案</option>
                  <option value="disabled">停用</option>
                </select>
                <span className="mt-1 block text-xs text-muted">同一定子组合和片数只能有一套正式方案。</span>
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm font-medium text-ink">方案名称</span>
                <input value={form.schemeName} onChange={(event) => updateForm({ schemeName: event.target.value })} placeholder="例如 高扬程测试方案" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">单片价</span>
                <input value={form.unitPrice} onChange={(event) => updateForm({ unitPrice: event.target.value })} type="number" min="0" step="0.0001" disabled={Boolean(editingCoil)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:bg-slate-50 disabled:text-muted" />
                {editingCoil ? <span className="mt-1 block text-xs text-muted">单片价请在定子组合里批量修改，保持同直径、材质和槽眼一致。</span> : null}
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">线重 kg</span>
                <input value={form.wireWeight} onChange={(event) => updateForm({ wireWeight: event.target.value })} type="number" min="0" step="0.001" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">铜价基数</span>
                <input value={form.copperBase} onChange={(event) => updateForm({ copperBase: event.target.value })} type="number" min="0" step="0.01" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">线圈加工费</span>
                <input value={form.coilFee} onChange={(event) => updateForm({ coilFee: event.target.value })} type="number" min="0" step="0.01" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">转子加工费</span>
                <input value={form.rotorFee} onChange={(event) => updateForm({ rotorFee: event.target.value })} type="number" min="0" step="0.01" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">默认线径</span>
                <input value={form.defaultWireGauge} onChange={(event) => updateForm({ defaultWireGauge: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">默认电容 μF</span>
                <input value={form.defaultCapacitor} onChange={(event) => updateForm({ defaultCapacitor: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <div className="border-t border-line pt-4 md:col-span-2">
                <div className="text-sm font-medium text-ink">绕组技术参数</div>
                <div className="mt-1 text-xs text-muted">选填，用于记录线圈绕组数据备忘。</div>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-ink">主线线径</span>
                <input value={form.mainWireGauge} onChange={(event) => updateForm({ mainWireGauge: event.target.value })} placeholder="例如 0.55" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">主线数据</span>
                <input value={form.mainWireData} onChange={(event) => updateForm({ mainWireData: event.target.value })} placeholder="匝数、绕法等备忘" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">副线线径</span>
                <input value={form.auxWireGauge} onChange={(event) => updateForm({ auxWireGauge: event.target.value })} placeholder="例如 0.45" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">副线数据</span>
                <input value={form.auxWireData} onChange={(event) => updateForm({ auxWireData: event.target.value })} placeholder="匝数、绕法等备忘" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line p-5">
            <Button type="button" variant="ghost" onClick={() => setDrawerOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={saving} icon={<Save size={15} />}>
              {saving ? '保存中' : '保存记录'}
            </Button>
          </div>
        </form>
      </SlideOver>
    </div>
  );
}
