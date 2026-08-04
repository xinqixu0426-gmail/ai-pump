'use client';

import { useMemo, useState } from 'react';
import { Eye, Pencil, Trash2, X } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import {
  templateSurfaceTreatmentOptions,
} from '@/components/recipe/PumpShellTemplateEditor';
import {
  isStainlessStretchBarrelComponent,
  isSubassemblyComponent,
  type ShellComponentRow,
} from '@/components/recipe/ShellCostEditor';
import { money } from '@/lib/format';
import type { Part } from '@/lib/parts';
import type { PumpShellTemplate } from '@/lib/recipes';

type TemplatePartRow = {
  name?: string;
  model?: string;
  supplier?: string;
  qty?: number;
};

type PumpShellTemplateWorkspaceProps = {
  visible: boolean;
  templates: PumpShellTemplate[];
  parts: Part[];
  saving: boolean;
  onEdit: (template: PumpShellTemplate) => void;
  onRemove: (template: PumpShellTemplate) => void;
};

function parseJsonArray<T>(value?: string): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function surfaceTreatmentLabel(mode?: string): string {
  return templateSurfaceTreatmentOptions.find((option) => option.value === mode)?.label || '无';
}

export function PumpShellTemplateWorkspace({
  visible,
  templates,
  parts,
  saving,
  onEdit,
  onRemove,
}: PumpShellTemplateWorkspaceProps) {
  const [detail, setDetail] = useState<PumpShellTemplate | null>(null);
  const rows = useMemo(() => templates.map((template) => {
    const fixedParts = parseJsonArray<TemplatePartRow>(template.partsJson);
    const shellComponents = parseJsonArray<ShellComponentRow>(template.shellComponentsJson);
    const costMode = template.costMode === 'bundle' ? 'bundle' : 'components';
    const shellCost = costMode === 'bundle'
      ? Number(template.bundleCost || 0)
      : shellComponents
          .filter((component) => component.included !== false)
          .reduce((sum, component) => {
            const catalogPart = parts.find((part) => (
              part.model === component.model
              && (!component.supplier || part.supplier === component.supplier)
            ));
            const unitCost = Number(catalogPart?.price || 0) > 0
              ? Number(catalogPart?.price || 0)
              : Number(component.unitCost || 0);
            return sum + unitCost * Number(component.qty || 1);
          }, 0);
    return {
      template,
      fixedParts,
      costMode,
      shellCost,
      laborCost: Number(template.assemblyWage || 0) + Number(template.packingWage || 0),
    };
  }), [parts, templates]);

  const detailParts = useMemo(
    () => parseJsonArray<TemplatePartRow>(detail?.partsJson),
    [detail]
  );
  const detailComponents = useMemo(
    () => parseJsonArray<ShellComponentRow>(detail?.shellComponentsJson),
    [detail]
  );

  return (
    <>
      {visible ? (
        <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
          <div className="flex items-center justify-between gap-3 border-b border-line p-4">
            <div>
              <div className="text-sm font-semibold text-ink">泵壳模板</div>
              <div className="mt-1 text-xs text-muted">模板决定泵壳固定配件、计价方式、安装/打包工资和表面处理，可在当前页面新建、编辑和删除。</div>
            </div>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{templates.length} 套</span>
          </div>
          {templates.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted">暂无泵壳模板</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                  <tr>
                    <th className="border-b border-line px-4 py-3">泵壳型号</th>
                    <th className="border-b border-line px-4 py-3">说明</th>
                    <th className="border-b border-line px-4 py-3">成本模式</th>
                    <th className="border-b border-line px-4 py-3 text-right">泵壳成本</th>
                    <th className="border-b border-line px-4 py-3 text-right">人工/表面处理</th>
                    <th className="border-b border-line px-4 py-3 text-right">固定配件</th>
                    <th className="border-b border-line px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.template.id} className="transition-colors duration-150 hover:bg-slate-50">
                      <td className="border-b border-line px-4 py-3 font-medium text-ink">{row.template.shellModel || '-'}</td>
                      <td className="border-b border-line px-4 py-3 text-muted">{row.template.description || '-'}</td>
                      <td className="border-b border-line px-4 py-3">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                          {row.costMode === 'bundle' ? '泵壳套件' : '自由搭配'}
                        </span>
                      </td>
                      <td className="border-b border-line px-4 py-3 text-right font-medium text-ink">{money(row.shellCost)}</td>
                      <td className="border-b border-line px-4 py-3 text-right text-muted">
                        <div>{money(row.laborCost)}</div>
                        <div className="mt-0.5 text-xs">{surfaceTreatmentLabel(row.template.surfaceTreatmentMode)} · {money(row.template.surfaceTreatmentCost || 0)}</div>
                      </td>
                      <td className="border-b border-line px-4 py-3 text-right text-muted">{row.fixedParts.length}</td>
                      <td className="border-b border-line px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setDetail(row.template)} icon={<Eye size={14} />}>
                            明细
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => onEdit(row.template)} disabled={saving} icon={<Pencil size={14} />}>
                            编辑
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => onRemove(row.template)} disabled={saving} icon={<Trash2 size={14} />}>
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </FadePanel>
      ) : null}

      <SlideOver open={Boolean(detail)} onClose={() => setDetail(null)}>
        {detail ? (
          <div className="flex min-h-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-line p-5">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Template</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{detail.shellModel}</h2>
                <div className="mt-1 text-sm text-muted">{detail.description || '无说明'}</div>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setDetail(null)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-5 p-5">
              <section className="rounded-panel border border-line">
                <div className="border-b border-line p-4 text-sm font-semibold text-ink">固定配件</div>
                <div className="divide-y divide-line">
                  {detailParts.length === 0 ? (
                    <div className="p-4 text-sm text-muted">暂无固定配件</div>
                  ) : detailParts.map((part, index) => (
                    <div key={`${part.name}-${index}`} className="grid gap-2 p-3 text-sm md:grid-cols-[1fr_1fr_1fr_auto]">
                      <span className="font-medium text-ink">{part.name || '-'}</span>
                      <span className="text-muted">{part.model || '-'}</span>
                      <span className="text-muted">{part.supplier || '-'}</span>
                      <span className="text-muted">x{part.qty || 1}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-panel border border-line">
                <div className="border-b border-line p-4 text-sm font-semibold text-ink">泵壳计价</div>
                <div className="divide-y divide-line">
                  {detail.costMode === 'bundle' ? (
                    <div className="p-4 text-sm text-ink">
                      <div>泵壳套件价格：{money(detail.bundleCost || 0)}</div>
                      <div className="mt-1 text-muted">备注：{detail.bundleNote || '-'}</div>
                    </div>
                  ) : detailComponents.length === 0 ? (
                    <div className="p-4 text-sm text-muted">暂无组件明细</div>
                  ) : detailComponents.map((component, index) => (
                    <div key={`${component.name}-${index}`} className="p-3 text-sm">
                      <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto_auto_auto]">
                        <span className="font-medium text-ink">{component.name || '-'}</span>
                        <span className="text-muted">{component.model || '-'}</span>
                        <span className="text-muted">{component.supplier || '-'}</span>
                        <span className="text-muted">x{component.qty || 1}</span>
                        <span className="text-muted">{money(component.unitCost || 0)}</span>
                        <span className="text-muted">
                          {isSubassemblyComponent(component) ? '供应商小套件' : isStainlessStretchBarrelComponent(component) ? '按机筒长度' : '单件'}
                        </span>
                      </div>
                      {isSubassemblyComponent(component) ? (
                        <div className="mt-2 text-xs text-muted">
                          包含：{(component.subassemblyContents || []).map((item) => `${item.name}×${item.qty}`).join('、') || '-'}（子项不单独计价）
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-panel border border-line p-4">
                <div className="text-sm font-semibold text-ink">表面处理</div>
                <div className="mt-2 text-sm text-muted">{surfaceTreatmentLabel(detail.surfaceTreatmentMode)} · {money(detail.surfaceTreatmentCost || 0)}</div>
              </section>
            </div>
          </div>
        ) : null}
      </SlideOver>
    </>
  );
}
