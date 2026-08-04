'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ShellComponentInput, SubassemblyContentInput } from '@/lib/recipes';

export type ShellComponentRow = {
  name?: string;
  model?: string;
  supplier?: string;
  qty?: number;
  unitCost?: number;
  pricingMode?: string;
  included?: boolean;
  optional?: boolean;
  componentType?: 'standard' | 'stainlessStretchBarrel' | 'subassembly';
  subassemblyContents?: SubassemblyContentInput[];
  // Legacy templates used this flag before stainless barrels became a component type.
  isStainlessStretchBarrel?: boolean;
  note?: string;
};

export type SubassemblyContentFormRow = SubassemblyContentInput & {
  id: string;
};

export type ShellComponentFormRow = Omit<ShellComponentInput, 'subassemblyContents'> & {
  id: string;
  subassemblyContents: SubassemblyContentFormRow[];
};

export const SHELL_COMPONENT_CATEGORY = '泵壳搭配';
export const STAINLESS_STRETCH_BARREL_NAME = '不锈钢拉伸筒';
export const barrelComponentNameOptions = ['铝机筒', STAINLESS_STRETCH_BARREL_NAME, '铁机筒'] as const;

const shellComponentNameOptions = ['上帽', '花板', '油缸', '泵头', '叶轮', '底座', '法兰'];

export function isBarrelComponentName(name: string) {
  return ['机筒', '铝机筒', '铝压铸机筒', '不锈钢拉伸机筒', STAINLESS_STRETCH_BARREL_NAME, '铁机筒'].includes(name.trim());
}

export function normalizeBarrelComponentName(name: string, isStainlessBarrel: boolean) {
  if (isStainlessBarrel || name === '不锈钢拉伸机筒') return STAINLESS_STRETCH_BARREL_NAME;
  if (name === '铝压铸机筒') return '铝机筒';
  return name === '机筒' ? '' : name;
}

export function isStainlessStretchBarrelComponent(
  component: Pick<ShellComponentRow, 'componentType' | 'isStainlessStretchBarrel'>
) {
  return component.componentType === 'stainlessStretchBarrel' || component.isStainlessStretchBarrel === true;
}

export function isSubassemblyComponent(component: Pick<ShellComponentRow, 'componentType'>) {
  return component.componentType === 'subassembly';
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextRowId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type ShellCostEditorProps = {
  costMode: 'components' | 'bundle';
  bundleCost: string;
  bundleNote: string;
  componentRows: ShellComponentFormRow[];
  modelOptions: string[];
  getDefaultSupplier: (model: string) => string;
  onBundleCostChange: (value: string) => void;
  onBundleNoteChange: (value: string) => void;
  onComponentRowsChange: (
    update: (rows: ShellComponentFormRow[]) => ShellComponentFormRow[]
  ) => void;
};

export function ShellCostEditor({
  costMode,
  bundleCost,
  bundleNote,
  componentRows,
  modelOptions,
  getDefaultSupplier,
  onBundleCostChange,
  onBundleNoteChange,
  onComponentRowsChange,
}: ShellCostEditorProps) {
  function addComponentRow(componentType: 'standard' | 'subassembly' = 'standard') {
    const isSubassembly = componentType === 'subassembly';
    onComponentRowsChange((rows) => [...rows, {
      id: nextRowId(),
      name: isSubassembly ? '供应商小套件' : '',
      model: '',
      supplier: '',
      qty: 1,
      unitCost: 0,
      pricingMode: 'fixed',
      included: true,
      optional: false,
      componentType,
      subassemblyContents: isSubassembly
        ? [{ id: nextRowId(), name: '', qty: 1, note: '' }]
        : [],
      note: '',
    }]);
  }

  function updateComponentRow(id: string, patch: Partial<ShellComponentFormRow>) {
    onComponentRowsChange((rows) => rows.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...patch };
      if (patch.model !== undefined && patch.supplier === undefined) {
        next.supplier = getDefaultSupplier(String(patch.model || ''));
      }
      if (patch.name !== undefined) {
        if (row.componentType === 'subassembly') return next;
        const isStainlessBarrel = patch.name.trim() === STAINLESS_STRETCH_BARREL_NAME;
        next.componentType = isStainlessBarrel ? 'stainlessStretchBarrel' : 'standard';
        if (isStainlessBarrel && Number(next.qty || 0) <= 1) next.qty = 15;
        if (!isStainlessBarrel && isBarrelComponentName(patch.name) && Number(row.qty || 0) === 15) next.qty = 1;
        next.pricingMode = isStainlessBarrel ? 'lengthCm' : 'fixed';
      }
      if (patch.componentType === 'stainlessStretchBarrel') {
        next.name = STAINLESS_STRETCH_BARREL_NAME;
        next.pricingMode = 'lengthCm';
        next.subassemblyContents = [];
      } else if (patch.componentType === 'subassembly') {
        next.name = row.componentType === 'subassembly' ? next.name : '供应商小套件';
        next.pricingMode = 'fixed';
        next.subassemblyContents = row.subassemblyContents.length > 0
          ? row.subassemblyContents
          : [{ id: nextRowId(), name: '', qty: 1, note: '' }];
      } else if (patch.componentType === 'standard') {
        next.pricingMode = 'fixed';
        next.subassemblyContents = [];
      }
      return next;
    }));
  }

  function addSubassemblyContentRow(componentId: string) {
    onComponentRowsChange((rows) => rows.map((row) => row.id === componentId
      ? {
          ...row,
          subassemblyContents: [
            ...row.subassemblyContents,
            { id: nextRowId(), name: '', qty: 1, note: '' },
          ],
        }
      : row));
  }

  function updateSubassemblyContentRow(
    componentId: string,
    contentId: string,
    patch: Partial<SubassemblyContentFormRow>
  ) {
    onComponentRowsChange((rows) => rows.map((row) => row.id === componentId
      ? {
          ...row,
          subassemblyContents: row.subassemblyContents.map((item) => (
            item.id === contentId ? { ...item, ...patch } : item
          )),
        }
      : row));
  }

  function removeSubassemblyContentRow(componentId: string, contentId: string) {
    onComponentRowsChange((rows) => rows.map((row) => row.id === componentId
      ? { ...row, subassemblyContents: row.subassemblyContents.filter((item) => item.id !== contentId) }
      : row));
  }

  return (
    <section className="rounded-panel border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">
            {costMode === 'bundle' ? '2. 泵壳套件计价' : '2. 自由搭配组件'}
          </div>
          <div className="mt-1 text-xs text-muted">
            {costMode === 'bundle'
              ? '套件价格默认读取零件库最低有效价格，模板中仍可覆盖。'
              : `共 ${componentRows.length} 个计价项，${componentRows.filter((row) => row.included !== false).length} 个计入成本。`}
          </div>
        </div>
        {costMode === 'components' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => addComponentRow('standard')} icon={<Plus size={14} />}>添加单件</Button>
            <Button type="button" size="sm" onClick={() => addComponentRow('subassembly')} icon={<Plus size={14} />}>添加小套件</Button>
          </div>
        ) : null}
      </div>
      {costMode === 'bundle' ? (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">泵壳套件价格</span>
            <input value={bundleCost} onChange={(event) => onBundleCostChange(event.target.value)} type="number" min="0" step="0.01" className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
            <span className="mt-1 block text-xs text-muted">选择泵壳型号时默认带入零件库最低有效价格，可在模板中覆盖。</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">备注</span>
            <input
              value={bundleNote}
              onChange={(event) => onBundleNoteChange(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
              placeholder="填写套件计价或配置说明"
            />
          </label>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <div className="hidden px-3 text-xs font-medium text-muted xl:grid xl:grid-cols-[90px_180px_minmax(240px,1.5fr)_minmax(160px,1fr)_90px_112px_76px_40px] xl:gap-2">
            <span>类型</span>
            <span>组件 / 小套件名称</span>
            <span>零件型号</span>
            <span>供应商</span>
            <span>数量</span>
            <span>备用单价</span>
            <span className="text-center">计入</span>
            <span />
          </div>
          {componentRows.map((row, index) => (
            <div key={row.id} className={`overflow-hidden rounded-md border ${row.included !== false ? 'border-line' : 'border-slate-200 bg-slate-50/60'}`}>
              <div className="flex items-center justify-between gap-3 border-b border-line bg-slate-50/70 px-3 py-2 xl:hidden">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ink">计价项 {index + 1}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${row.componentType === 'subassembly' ? 'bg-blue-50 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>
                      {row.componentType === 'subassembly' ? '小套件' : '单件'}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">{row.name || '未填写名称'}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className={`rounded px-2 py-1 text-xs font-medium ${row.included !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {row.included !== false ? '计入成本' : '不计入'}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onComponentRowsChange((rows) => rows.filter((item) => item.id !== row.id))}
                    icon={<Trash2 size={14} />}
                    aria-label={`删除计价项 ${index + 1}`}
                    title="删除计价项"
                    className="h-8 w-8 !px-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  />
                </div>
              </div>
              <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-[90px_180px_minmax(240px,1.5fr)_minmax(160px,1fr)_90px_112px_76px_40px] xl:items-end xl:gap-2">
                <div className="hidden h-9 items-center xl:flex">
                  <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${row.componentType === 'subassembly' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                    {row.componentType === 'subassembly' ? '小套件' : '单件'}
                  </span>
                </div>
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium text-muted xl:sr-only">{row.componentType === 'subassembly' ? '小套件名称' : '组件名称'}</span>
                  {row.componentType !== 'subassembly' && isBarrelComponentName(row.name) ? (
                    <select value={normalizeBarrelComponentName(row.name, isStainlessStretchBarrelComponent(row))} onChange={(event) => updateComponentRow(row.id, { name: event.target.value })} aria-label="机筒类型" className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400">
                      <option value="">请选择机筒类型</option>
                      {barrelComponentNameOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  ) : (
                    <input value={row.name} onChange={(event) => updateComponentRow(row.id, { name: event.target.value })} placeholder={row.componentType === 'subassembly' ? '例如：铝铸件小套件' : '例如：上帽'} list={row.componentType === 'subassembly' ? undefined : 'shell-component-name-options'} className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                  )}
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium text-muted xl:sr-only">零件型号</span>
                  <select value={row.model || ''} onChange={(event) => updateComponentRow(row.id, { model: event.target.value })} aria-label={`${row.name || '组件'}零件型号`} className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400">
                    <option value="">{row.componentType === 'subassembly' ? '请选择小套件型号' : '请选择零件型号'}</option>
                    {row.model && !modelOptions.includes(row.model) ? <option value={row.model} disabled>{row.model}（不在泵壳搭配类别）</option> : null}
                    {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium text-muted xl:sr-only">供应商</span>
                  <input value={row.supplier || ''} onChange={(event) => updateComponentRow(row.id, { supplier: event.target.value })} placeholder="选择型号后自动带入" className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium text-muted xl:sr-only">{row.componentType === 'stainlessStretchBarrel' ? '基准长度(cm)' : '数量'}</span>
                  <input value={String(row.qty)} onChange={(event) => updateComponentRow(row.id, { qty: numberValue(event.target.value) })} type="number" min="0" step="0.01" title={row.componentType === 'stainlessStretchBarrel' ? '不锈钢拉伸筒的基准长度，单位 cm' : '计价数量'} className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="block min-w-0">
                  <span className="mb-1 block text-xs font-medium text-muted xl:sr-only">备用单价</span>
                  <input value={String(row.unitCost)} onChange={(event) => updateComponentRow(row.id, { unitCost: numberValue(event.target.value) })} type="number" min="0" step="0.01" title="零件库没有有效价格时使用此单价" className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                </label>
                <label className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-line bg-white px-2 text-xs font-medium text-muted md:self-end">
                  <input type="checkbox" checked={row.included !== false} onChange={(event) => updateComponentRow(row.id, { included: event.target.checked })} />
                  计入
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onComponentRowsChange((rows) => rows.filter((item) => item.id !== row.id))}
                  icon={<Trash2 size={15} />}
                  aria-label={`删除计价项 ${index + 1}`}
                  title="删除计价项"
                  className="hidden h-9 w-9 !px-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 xl:inline-flex"
                />
              </div>
              {row.componentType === 'subassembly' ? (
                <div className="border-t border-line bg-slate-50/70 p-3 xl:ml-8 xl:border-l-2 xl:border-l-slate-200 xl:pl-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-ink">包含组件</div>
                      <div className="mt-0.5 text-xs text-muted">仅用于说明套件组成，不单独计价或扣库存。</div>
                    </div>
                    <Button type="button" size="sm" onClick={() => addSubassemblyContentRow(row.id)} icon={<Plus size={14} />}>添加组成项</Button>
                  </div>
                  <div className="space-y-2">
                    {row.subassemblyContents.length > 0 ? (
                      <div className="hidden grid-cols-[minmax(180px,1fr)_90px_minmax(220px,1.2fr)_36px] gap-2 px-1 text-xs font-medium text-muted md:grid">
                        <span>组件名称</span>
                        <span>数量</span>
                        <span>备注</span>
                        <span />
                      </div>
                    ) : null}
                    {row.subassemblyContents.map((item) => (
                      <div key={item.id} className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_90px_minmax(220px,1.2fr)_36px] md:items-end">
                        <label className="block min-w-0">
                          <span className="mb-1 block text-xs font-medium text-muted md:sr-only">组件名称</span>
                          <input value={item.name} onChange={(event) => updateSubassemblyContentRow(row.id, item.id, { name: event.target.value })} placeholder="例如：上帽" className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                        </label>
                        <label className="block min-w-0">
                          <span className="mb-1 block text-xs font-medium text-muted md:sr-only">数量</span>
                          <input value={String(item.qty)} onChange={(event) => updateSubassemblyContentRow(row.id, item.id, { qty: numberValue(event.target.value) })} type="number" min="0.01" step="0.01" className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                        </label>
                        <label className="block min-w-0">
                          <span className="mb-1 block text-xs font-medium text-muted md:sr-only">备注</span>
                          <input value={item.note || ''} onChange={(event) => updateSubassemblyContentRow(row.id, item.id, { note: event.target.value })} placeholder="可选，例如：与上帽同厂采购" className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeSubassemblyContentRow(row.id, item.id)}
                          icon={<Trash2 size={14} />}
                          aria-label={`删除组成项 ${item.name || ''}`}
                          title="删除组成项"
                          className="h-9 w-9 justify-self-end !px-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          <datalist id="shell-component-name-options">
            {shellComponentNameOptions.map((name) => <option key={name} value={name} />)}
          </datalist>
          {modelOptions.length === 0 ? (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">零件库暂无“泵壳搭配”类别零件，请先到零件管理中建立组件型号。</div>
          ) : null}
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-muted">
            单件和供应商小套件的父型号都只读取“泵壳搭配”类别，并按“零件型号 + 供应商”读取价格和库存。小套件的组成项仅作说明，不重复计价或扣库存。选择“不锈钢拉伸筒”后，系统自动按配方/型号变体的机筒长度计价，并联动长螺丝长度。
          </div>
        </div>
      )}
    </section>
  );
}
