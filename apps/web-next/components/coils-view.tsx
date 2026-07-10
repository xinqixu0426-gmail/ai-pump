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
  getCoilMaterials,
  getCoilSpecDraft,
  getMarketIndicators,
  saveCoilMaterialPrices,
  updateCoil,
  updateCoilSpecPrice,
  updateMarketIndicators,
  type CoilCalcResult,
  type CoilRecord,
  type MarketIndicators,
} from '@/lib/coils';

type CoilFormState = {
  spec: string;
  material: string;
  sheets: string;
  unitPrice: string;
  wireWeight: string;
  copperBase: string;
  coilFee: string;
  rotorFee: string;
  defaultWireGauge: string;
  defaultCapacitor: string;
};

const emptyForm: CoilFormState = {
  spec: '',
  material: '钢带',
  sheets: '',
  unitPrice: '',
  wireWeight: '0',
  copperBase: '0',
  coilFee: '0',
  rotorFee: '0',
  defaultWireGauge: '',
  defaultCapacitor: '',
};

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formFromCoil(coil: CoilRecord): CoilFormState {
  return {
    spec: coil.spec,
    material: coil.material || '钢带',
    sheets: String(coil.sheets || ''),
    unitPrice: String(coil.unitPrice || ''),
    wireWeight: String(coil.wireWeight || 0),
    copperBase: String(coil.copperBase || 0),
    coilFee: String(coil.coilFee || 0),
    rotorFee: String(coil.rotorFee || 0),
    defaultWireGauge: coil.defaultWireGauge || '',
    defaultCapacitor: coil.defaultCapacitor || '',
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

export function CoilsView() {
  const [coils, setCoils] = useState<CoilRecord[]>([]);
  const [materials, setMaterials] = useState<string[]>(['钢带']);
  const [materialPrices, setMaterialPrices] = useState<Record<string, number>>({});
  const [materialPriceDraft, setMaterialPriceDraft] = useState<Record<string, string>>({});
  const [newMaterialName, setNewMaterialName] = useState('');
  const [newMaterialPrice, setNewMaterialPrice] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingMaterials, setSavingMaterials] = useState(false);
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
      const [coilRows, materialData, indicatorData] = await Promise.all([
        getAllCoils(),
        getCoilMaterials().catch(() => null),
        getMarketIndicators().catch(() => null),
      ]);
      setCoils(coilRows);
      if (indicatorData) setMarketIndicators(indicatorData);
      if (materialData) {
        setMaterials(materialData.materials.length ? materialData.materials : [materialData.defaultMaterial || '钢带']);
        setMaterialPrices(materialData.materialPrices || {});
        setMaterialPriceDraft(Object.fromEntries(Object.entries(materialData.materialPrices || {}).map(([material, price]) => [material, String(price)])));
        setCalcMaterial((current) => current || materialData.defaultMaterial || '钢带');
      }
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

  const filteredCoils = useMemo(() => {
    const text = query.trim().toLowerCase();
    return coils
      .filter((coil) => {
        if (!text) return true;
        return [coil.spec, coil.material, coil.sheets, coil.defaultWireGauge, coil.defaultCapacitor]
          .join(' ')
          .toLowerCase()
          .includes(text);
      })
      .sort((a, b) => a.spec.localeCompare(b.spec, 'zh-Hans-CN') || a.material.localeCompare(b.material, 'zh-Hans-CN') || a.sheets - b.sheets);
  }, [coils, query]);

  const groupedCoils = useMemo(() => {
    const groups = new Map<string, CoilRecord[]>();
    filteredCoils.forEach((coil) => {
      const key = `${coil.spec || '-'} / ${coil.material || '钢带'}`;
      groups.set(key, [...(groups.get(key) || []), coil]);
    });
    return Array.from(groups.entries()).map(([key, rows]) => ({ key, rows }));
  }, [filteredCoils]);

  const stats = useMemo(() => {
    const specCount = new Set(coils.map((coil) => coil.spec).filter(Boolean)).size;
    const avgCost = coils.length ? coils.reduce((sum, coil) => sum + coil.cost, 0) / coils.length : 0;
    return { specCount, avgCost };
  }, [coils]);

  function updateForm(patch: Partial<CoilFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function autoFillFromSpec(spec: string, material = form.material) {
    if (editingCoil) {
      updateForm({ spec });
      return;
    }
    const normalizedMaterial = (material || '钢带').trim();
    if (!spec.trim()) {
      setForm((current) => ({
        ...current,
        spec,
        material: normalizedMaterial,
        unitPrice: String(materialPrices[normalizedMaterial] ?? current.unitPrice ?? ''),
      }));
      return;
    }
    try {
      const draft = await getCoilSpecDraft(spec.trim(), normalizedMaterial);
      setForm((current) => ({
        ...current,
        spec,
        material: draft.material || normalizedMaterial,
        unitPrice: optionalNumberText(draft.unitPrice) || current.unitPrice,
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
      void autoFillFromSpec(form.spec, material);
      return;
    }
    setForm((current) => ({
      ...current,
      material,
      unitPrice: editingCoil ? current.unitPrice : String(materialPrices[material] ?? current.unitPrice ?? ''),
    }));
  }

  function openCreateDrawer() {
    setEditingCoil(null);
    const material = materials[0] || '钢带';
    setForm({
      ...emptyForm,
      material,
      unitPrice: String(materialPrices[material] ?? ''),
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

  async function saveMaterialConfig() {
    setSavingMaterials(true);
    setError(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(materialPriceDraft)
          .map(([material, price]) => [material.trim(), numberValue(price)] as const)
          .filter(([material]) => material.length > 0)
      );
      const saved = await saveCoilMaterialPrices(payload);
      setMaterialPrices(saved);
      setMaterialPriceDraft(Object.fromEntries(Object.entries(saved).map(([material, price]) => [material, String(price)])));
      setMaterials(Array.from(new Set([...Object.keys(saved), ...coils.map((coil) => coil.material || '钢带')])).filter(Boolean));
    } catch (err) {
      setError(err instanceof Error ? err.message : '材质单价配置保存失败');
    } finally {
      setSavingMaterials(false);
    }
  }

  function addMaterialDraft() {
    const name = newMaterialName.trim();
    if (!name) return;
    setMaterialPriceDraft((current) => ({ ...current, [name]: newMaterialPrice.trim() || '0' }));
    setMaterials((current) => Array.from(new Set([...current, name])).filter(Boolean));
    setNewMaterialName('');
    setNewMaterialPrice('');
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
      await updateCoilSpecPrice(first.spec, first.material || '钢带', numberValue(editingGroupPrice));
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
    if (!form.spec.trim() || !form.sheets.trim()) {
      setFormError('规格和片数不能为空');
      return;
    }
    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      const payload = {
        spec: form.spec.trim(),
        material: form.material.trim() || '钢带',
        sheets: numberValue(form.sheets),
        unitPrice: numberValue(form.unitPrice),
        wireWeight: numberValue(form.wireWeight),
        copperBase: numberValue(form.copperBase),
        coilFee: numberValue(form.coilFee),
        rotorFee: numberValue(form.rotorFee),
        defaultWireGauge: form.defaultWireGauge.trim(),
        defaultCapacitor: form.defaultCapacitor.trim(),
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
          <p className="mt-2 max-w-2xl text-sm text-muted">定子线圈成本试算和基础数据维护。</p>
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
          <div className="mt-1 text-xs text-muted">定子规格</div>
        </div>
        <div className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="text-2xl font-semibold tracking-tight text-ink">{money(stats.avgCost)}</div>
          <div className="mt-1 text-xs text-muted">平均成本</div>
        </div>
      </div>

      <FadePanel className="space-y-3">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">材质默认单价</div>
            <div className="text-xs text-muted">新增线圈时按材质自动带入单片价，试算时作为缺省材质价。</div>
          </div>
          <Button type="button" variant="primary" onClick={() => void saveMaterialConfig()} disabled={savingMaterials} icon={<Save size={15} />}>
            {savingMaterials ? '保存中' : '保存单价配置'}
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {Object.entries(materialPriceDraft).map(([material, price]) => (
            <label key={material} className="block w-[136px]">
              <span className="text-xs font-medium text-muted">{material}</span>
              <input
                value={price}
                onChange={(event) => setMaterialPriceDraft((current) => ({ ...current, [material]: event.target.value }))}
                type="number"
                min="0"
                step="0.0001"
                className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
              />
            </label>
          ))}
          <label className="block w-[136px]">
            <span className="text-xs font-medium text-muted">新材质</span>
            <input value={newMaterialName} onChange={(event) => setNewMaterialName(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
          </label>
          <label className="block w-[112px]">
            <span className="text-xs font-medium text-muted">单价</span>
            <input value={newMaterialPrice} onChange={(event) => setNewMaterialPrice(event.target.value)} type="number" min="0" step="0.0001" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
          </label>
          <Button type="button" onClick={addMaterialDraft} disabled={!newMaterialName.trim()}>
            添加材质
          </Button>
        </div>
      </FadePanel>

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
              placeholder="搜索规格、材质、片数、线径"
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
                    <table className="w-full min-w-[840px] border-collapse text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-muted">
                        <tr>
                          <th className="px-4 py-3 font-medium">片数</th>
                          <th className="px-4 py-3 font-medium">单片价</th>
                          <th className="px-4 py-3 font-medium">线重</th>
                          <th className="px-4 py-3 font-medium">铜价基数</th>
                          <th className="px-4 py-3 font-medium">加工费</th>
                          <th className="px-4 py-3 font-medium">总成本</th>
                          <th className="px-4 py-3 font-medium">默认线径</th>
                          <th className="px-4 py-3 text-right font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        <AnimatePresence initial={false}>
                          {group.rows.map((coil) => (
                            <PresenceRow key={coil.id}>
                              <td className="border-b border-line px-4 py-3 font-medium text-ink">{coil.sheets}</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{money(coil.unitPrice)}</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{coil.wireWeight} kg</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{money(coil.copperBase)}</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{money(coil.coilFee + coil.rotorFee)}</td>
                              <td className="border-b border-line px-4 py-3 font-medium text-ink">{money(coil.cost)}</td>
                              <td className="border-b border-line px-4 py-3 text-muted">{coil.defaultWireGauge || '-'}</td>
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
                <span className="text-sm font-medium text-ink">规格</span>
                <input
                  value={form.spec}
                  onChange={(event) => {
                    const spec = event.target.value;
                    updateForm({ spec });
                    if (!editingCoil && specOptions.includes(spec)) void autoFillFromSpec(spec, form.material);
                  }}
                  onBlur={() => {
                    if (!editingCoil && form.spec.trim()) void autoFillFromSpec(form.spec, form.material);
                  }}
                  list="coil-spec-options"
                  className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">材质</span>
                <input value={form.material} onChange={(event) => updateFormMaterial(event.target.value)} list="coil-material-options" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">片数</span>
                <input value={form.sheets} onChange={(event) => updateForm({ sheets: event.target.value })} type="number" min="0" step="1" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">单片价</span>
                <input value={form.unitPrice} onChange={(event) => updateForm({ unitPrice: event.target.value })} type="number" min="0" step="0.0001" placeholder={String(materialPrices[form.material] || '')} disabled={Boolean(editingCoil)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400 disabled:bg-slate-50 disabled:text-muted" />
                {editingCoil ? <span className="mt-1 block text-xs text-muted">单片价请在规格组里批量修改，保持同规格同材质一致。</span> : null}
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
            </div>
            <datalist id="coil-material-options">
              {materials.map((material) => <option key={material} value={material} />)}
            </datalist>
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
