'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import {
  BUILTIN_CATEGORIES,
  DEFAULT_FLOAT_ACCESSORY_DELTA,
  DEFAULT_STANDARD_CABLE_ACCESSORY_NAME,
  DEFAULT_XINJIE_CABLE_ACCESSORY_NAME,
  PACKAGING_SUBCATEGORIES,
  buildCableAccessorySettingsValue,
  buildPartNotes,
  capacitorValueFromModel,
  finalPartModel,
  parseFloatAccessoryDelta,
  validatePartForm,
  wirePrefixForCategory,
} from '@/lib/part-form-rules';
import { getSettingValue, setSettingValue, type Part, type PartInput } from '@/lib/parts';

export type InlinePartCreateSeed = {
  contextLabel: string;
  model?: string;
  category?: string;
  subcategory?: string;
  supplier?: string;
  price?: number;
  stock?: number;
  categoryScope?: 'locked' | 'non-packaging' | 'editable';
};

type InlinePartCreateDialogProps = {
  open: boolean;
  seed: InlinePartCreateSeed | null;
  supplierOptions: string[];
  onClose: () => void;
  onResolve: (
    input: PartInput,
    beforeCreate?: () => Promise<void>
  ) => Promise<{ part: Part; created: boolean }>;
  onResolved: (result: { part: Part; created: boolean }) => void;
};

type Draft = {
  model: string;
  category: string;
  subcategory: string;
  supplier: string;
  price: string;
  stock: string;
  rawNotes: string;
  capacitorUf: string;
  wireGauge: string;
  standardCableAccessoryFee: string;
  xinjieCableAccessoryFee: string;
  standardCableAccessoryName: string;
  xinjieCableAccessoryName: string;
  floatAccessoryDelta: string;
  screwPricingEnabled: boolean;
  screwDiameter: string;
  isStainless: boolean;
  openOffset: string;
};

const categoryOptions = BUILTIN_CATEGORIES.filter((category) => category !== '线圈转子');

function parseCableSetting(value: string) {
  try {
    const parsed = JSON.parse(value) as {
      standard?: { name?: string; fee?: unknown };
      xinjie?: { name?: string; fee?: unknown };
    };
    return {
      standardName: parsed.standard?.name || DEFAULT_STANDARD_CABLE_ACCESSORY_NAME,
      standardFee: String(Number(parsed.standard?.fee) || 0),
      xinjieName: parsed.xinjie?.name || DEFAULT_XINJIE_CABLE_ACCESSORY_NAME,
      xinjieFee: String(Number(parsed.xinjie?.fee) || 0),
    };
  } catch {
    return {
      standardName: DEFAULT_STANDARD_CABLE_ACCESSORY_NAME,
      standardFee: '0',
      xinjieName: DEFAULT_XINJIE_CABLE_ACCESSORY_NAME,
      xinjieFee: '0',
    };
  }
}

function draftFromSeed(seed: InlinePartCreateSeed | null): Draft {
  const category = seed?.category && categoryOptions.includes(seed.category) ? seed.category : '配件';
  const wirePrefix = wirePrefixForCategory(category);
  const model = String(seed?.model || '').trim();
  return {
    model: wirePrefix || category === '电容' ? '' : model,
    category,
    subcategory: category === '包装'
      ? (seed?.subcategory || PACKAGING_SUBCATEGORIES[0])
      : '',
    supplier: String(seed?.supplier || ''),
    price: String(seed?.price ?? 0),
    stock: String(seed?.stock ?? 0),
    rawNotes: '',
    capacitorUf: category === '电容' ? String(capacitorValueFromModel(model) ?? '') : '',
    wireGauge: wirePrefix && model.startsWith(wirePrefix) ? model.slice(wirePrefix.length) : '',
    standardCableAccessoryFee: '0',
    xinjieCableAccessoryFee: '0',
    standardCableAccessoryName: DEFAULT_STANDARD_CABLE_ACCESSORY_NAME,
    xinjieCableAccessoryName: DEFAULT_XINJIE_CABLE_ACCESSORY_NAME,
    floatAccessoryDelta: String(DEFAULT_FLOAT_ACCESSORY_DELTA),
    screwPricingEnabled: false,
    screwDiameter: '',
    isStainless: false,
    openOffset: '',
  };
}

export function InlinePartCreateDialog({
  open,
  seed,
  supplierOptions,
  onClose,
  onResolve,
  onResolved,
}: InlinePartCreateDialogProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFromSeed(seed));
  const [saving, setSaving] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wirePrefix = wirePrefixForCategory(draft.category);
  const isWireMode = Boolean(wirePrefix);
  const isCableMode = draft.category === '电缆线';
  const isFloatMode = draft.category === '浮球';
  const isScrewMode = draft.category === '螺丝';
  const isPumpShellMode = draft.category === '泵壳';
  const isCapacitorMode = draft.category === '电容';
  const isPackagingMode = draft.category === '包装';
  const modelPreview = finalPartModel({
    isCapacitorMode,
    capacitorUf: draft.capacitorUf,
    isWireMode,
    wirePrefix,
    wireGauge: draft.wireGauge,
    model: draft.model,
  });

  const sortedSupplierOptions = useMemo(
    () => Array.from(new Set(supplierOptions.map((value) => value.trim()).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
    [supplierOptions]
  );
  const visibleCategoryOptions = seed?.categoryScope === 'non-packaging'
    ? categoryOptions.filter((category) => category !== '包装')
    : categoryOptions;

  useEffect(() => {
    if (!open) return;
    setDraft(draftFromSeed(seed));
    setError(null);
    setSaving(false);
  }, [open, seed]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingSettings(true);
    Promise.all([
      getSettingValue('cable_accessories'),
      getSettingValue('float_accessory_delta'),
    ]).then(([cableValue, floatValue]) => {
      if (cancelled) return;
      const cable = parseCableSetting(cableValue);
      setDraft((current) => ({
        ...current,
        standardCableAccessoryName: cable.standardName,
        standardCableAccessoryFee: cable.standardFee,
        xinjieCableAccessoryName: cable.xinjieName,
        xinjieCableAccessoryFee: cable.xinjieFee,
        floatAccessoryDelta: String(parseFloatAccessoryDelta(floatValue)),
      }));
    }).catch((settingsError) => {
      if (!cancelled) setError(settingsError instanceof Error ? settingsError.message : '专用零件设置加载失败');
    }).finally(() => {
      if (!cancelled) setLoadingSettings(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validatePartForm({
      category: draft.category,
      model: draft.model,
      price: draft.price,
      supplier: draft.supplier,
      isCapacitorMode,
      capacitorUf: draft.capacitorUf,
      isWireMode,
      wireGauge: draft.wireGauge,
      isCableMode,
      standardCableAccessoryFee: draft.standardCableAccessoryFee,
      xinjieCableAccessoryFee: draft.xinjieCableAccessoryFee,
      standardCableAccessoryName: draft.standardCableAccessoryName,
      xinjieCableAccessoryName: draft.xinjieCableAccessoryName,
      isFloatMode,
      floatAccessoryDelta: draft.floatAccessoryDelta,
      isScrewMode,
      screwPricingEnabled: draft.screwPricingEnabled,
      screwDiameter: draft.screwDiameter,
    });
    const firstError = Object.values(errors)[0];
    if (firstError) {
      setError(firstError);
      return;
    }
    if (isPackagingMode && !PACKAGING_SUBCATEGORIES.includes(draft.subcategory as typeof PACKAGING_SUBCATEGORIES[number])) {
      setError('请选择有效的包装二级分类');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const structuredNotes = buildPartNotes({
        category: draft.category,
        isCableMode,
        isScrewMode,
        isStainless: draft.isStainless,
        openOffset: draft.openOffset,
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
        standardCableAccessoryFee: draft.standardCableAccessoryFee,
        xinjieCableAccessoryFee: draft.xinjieCableAccessoryFee,
        standardCableAccessoryName: draft.standardCableAccessoryName,
        xinjieCableAccessoryName: draft.xinjieCableAccessoryName,
        screwPricingEnabled: draft.screwPricingEnabled,
        screwDiameter: draft.screwDiameter,
      });
      const beforeCreate = async () => {
        if (!Number.isFinite(Number(draft.price)) || Number(draft.price) <= 0) {
          throw new Error('为了完成当前模板或配方，请输入大于 0 的目录单价');
        }
        if (!Number.isInteger(Number(draft.stock)) || Number(draft.stock) < 0) {
          throw new Error('初始库存必须是大于或等于 0 的整数');
        }
        if (isCableMode) {
          await setSettingValue('cable_accessories', buildCableAccessorySettingsValue({
            standardCableAccessoryName: draft.standardCableAccessoryName,
            standardCableAccessoryFee: draft.standardCableAccessoryFee,
            xinjieCableAccessoryName: draft.xinjieCableAccessoryName,
            xinjieCableAccessoryFee: draft.xinjieCableAccessoryFee,
          }));
        } else if (isFloatMode) {
          await setSettingValue('float_accessory_delta', String(parseFloatAccessoryDelta(draft.floatAccessoryDelta)));
        }
      };
      const result = await onResolve({
        model: modelPreview,
        category: draft.category,
        subcategory: isPackagingMode ? draft.subcategory : '',
        supplier: draft.supplier.trim(),
        price: Number(draft.price),
        stock: Number(draft.stock),
        notes: structuredNotes ? JSON.stringify(structuredNotes) : draft.rawNotes.trim(),
      }, beforeCreate);
      onResolved(result);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '零件建档失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} size="lg" layer="top" closeOnBackdrop={!saving} ariaLabelledBy="inline-part-create-title">
      <form onSubmit={submit}>
        <DialogHeader>
          <div>
            <h2 id="inline-part-create-title" className="text-lg font-semibold text-ink">新增零件并选中</h2>
            <div className="mt-1 text-sm text-muted">{seed?.contextLabel || '当前配置'} · 保存后自动回到当前草稿</div>
          </div>
          <button type="button" aria-label="关闭" disabled={saving} onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted hover:bg-slate-50 disabled:opacity-60">
            <X size={16} />
          </button>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <FormError message={error} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="分类" required>
              <Select disabled={seed?.categoryScope === 'locked'} value={draft.category} onChange={(event) => {
                const category = event.target.value;
                updateDraft({
                  category,
                  subcategory: category === '包装' ? (draft.subcategory || PACKAGING_SUBCATEGORIES[0]) : '',
                });
              }}>
                {visibleCategoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
              </Select>
            </Field>
            {isPackagingMode ? (
              <Field label="包装二级分类" required>
                <Select value={draft.subcategory} onChange={(event) => updateDraft({ subcategory: event.target.value })}>
                  {PACKAGING_SUBCATEGORIES.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field label="供应商" required>
              <Input value={draft.supplier} onChange={(event) => updateDraft({ supplier: event.target.value })} list="inline-part-supplier-options" placeholder="供应商名称" />
              <datalist id="inline-part-supplier-options">
                {sortedSupplierOptions.map((supplier) => <option key={supplier} value={supplier} />)}
              </datalist>
            </Field>
            <Field label="目录单价" required>
              <Input value={draft.price} onChange={(event) => updateDraft({ price: event.target.value })} type="number" min="0" step="0.01" />
            </Field>
            <Field label="初始库存" hint="配方建档通常保持 0，实际到货后再通过库存入库。">
              <Input value={draft.stock} onChange={(event) => updateDraft({ stock: event.target.value })} type="number" min="0" step="1" />
            </Field>
          </div>

          {isCapacitorMode ? (
            <Field label="电容容量 (μF)" required>
              <Input value={draft.capacitorUf} onChange={(event) => updateDraft({ capacitorUf: event.target.value })} type="number" min="0" step="0.1" />
            </Field>
          ) : isWireMode ? (
            <Field label={`线径（最终型号：${modelPreview || '-'}）`} required>
              <Input value={draft.wireGauge} onChange={(event) => updateDraft({ wireGauge: event.target.value })} placeholder="例如：0.75" />
            </Field>
          ) : (
            <Field label="零件型号" required>
              <Input value={draft.model} onChange={(event) => updateDraft({ model: event.target.value })} placeholder="输入正式型号" />
            </Field>
          )}

          {isCableMode ? (
            <section className="rounded-md border border-line bg-slate-50 p-4">
              <div className="text-sm font-medium text-ink">电缆配件费</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="第一种名称"><Input value={draft.standardCableAccessoryName} onChange={(event) => updateDraft({ standardCableAccessoryName: event.target.value })} /></Field>
                <Field label="第一种费用"><Input value={draft.standardCableAccessoryFee} onChange={(event) => updateDraft({ standardCableAccessoryFee: event.target.value })} type="number" min="0" step="0.01" /></Field>
                <Field label="第二种名称"><Input value={draft.xinjieCableAccessoryName} onChange={(event) => updateDraft({ xinjieCableAccessoryName: event.target.value })} /></Field>
                <Field label="第二种费用"><Input value={draft.xinjieCableAccessoryFee} onChange={(event) => updateDraft({ xinjieCableAccessoryFee: event.target.value })} type="number" min="0" step="0.01" /></Field>
              </div>
            </section>
          ) : null}
          {isFloatMode ? (
            <Field label="新界式浮球加价"><Input value={draft.floatAccessoryDelta} onChange={(event) => updateDraft({ floatAccessoryDelta: event.target.value })} type="number" min="0" step="0.01" /></Field>
          ) : null}
          {isScrewMode ? (
            <section className="rounded-md border border-line bg-slate-50 p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <Checkbox checked={draft.screwPricingEnabled} onChange={(event) => updateDraft({ screwPricingEnabled: event.target.checked })} />
                按长度自动计价
              </label>
              {draft.screwPricingEnabled ? <div className="mt-3"><Field label="螺丝直径"><Input value={draft.screwDiameter} onChange={(event) => updateDraft({ screwDiameter: event.target.value })} type="number" min="0" step="0.1" /></Field></div> : null}
            </section>
          ) : null}
          {isPumpShellMode ? (
            <section className="rounded-md border border-line bg-slate-50 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2 text-sm font-medium text-ink"><Checkbox checked={draft.isStainless} onChange={(event) => updateDraft({ isStainless: event.target.checked })} />不锈钢机筒</label>
                <Field label="开档系数"><Input value={draft.openOffset} onChange={(event) => updateDraft({ openOffset: event.target.value })} type="number" step="0.1" /></Field>
              </div>
            </section>
          ) : null}
          {!isCableMode && !isScrewMode && !isPumpShellMode ? (
            <Field label="备注"><Textarea value={draft.rawNotes} onChange={(event) => updateDraft({ rawNotes: event.target.value })} rows={3} placeholder="供应说明或临时备注" /></Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
          <Button type="submit" variant="primary" disabled={saving || loadingSettings} icon={<Save size={15} />}>
            {saving ? '保存中' : loadingSettings ? '加载设置中' : '保存并选中'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
