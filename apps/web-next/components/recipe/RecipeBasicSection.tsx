'use client';

import { ChevronDown, CircleHelp } from 'lucide-react';
import { TemplateMatchSummary } from '@/components/recipe/TemplateMatchSummary';
import { RecipeSection as WorkspaceSection, RecipeStatusBadge } from '@/components/recipe/RecipeSection';
import type { PumpShellTemplate, RecipePart } from '@/lib/recipes';

export type LinkedChangeAnnotation = {
  label: string;
  value: string;
  note: string;
  tone: 'blue' | 'green' | 'amber' | 'slate';
};

type RecipeBasicFields = {
  name: string;
  spec: string;
  templateId: string;
  customBarrelLength: string;
  longScrewExtraLength: string;
};

type RecipeBasicSectionProps = {
  form: RecipeBasicFields;
  templates: PumpShellTemplate[];
  hasStainlessBarrel: boolean;
  templateParts: RecipePart[];
  templatePartsCost: number;
  linkedChanges: LinkedChangeAnnotation[];
  linkedChangeSummary: string;
  hasLinkedChangeWarning: boolean;
  onChange: (patch: Partial<RecipeBasicFields>) => void;
  onTemplateChange: (templateId: string) => void | Promise<void>;
  onOpenTemplateParts: () => void;
};

function linkedChangeToneClass(tone: LinkedChangeAnnotation['tone']): string {
  if (tone === 'green') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (tone === 'blue') return 'border-sky-200 bg-sky-50 text-sky-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export function RecipeBasicSection({
  form,
  templates,
  hasStainlessBarrel,
  templateParts,
  templatePartsCost,
  linkedChanges,
  linkedChangeSummary,
  hasLinkedChangeWarning,
  onChange,
  onTemplateChange,
  onOpenTemplateParts,
}: RecipeBasicSectionProps) {
  const complete = Boolean(form.name.trim() && form.templateId);

  return (
    <WorkspaceSection
      id="recipe-basic-section"
      title="1. 泵壳与产品"
      description="选择泵壳模板并填写产品名称；模板固定搭配会自动进入 BOM。"
      status={complete ? 'complete' : 'warning'}
      badge={complete ? '已完成' : '待完善'}
      badgeTone={complete ? 'green' : 'amber'}
    >
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block md:col-span-2">
            <span className="text-xs font-medium text-muted">配方名称</span>
            <input
              value={form.name}
              onChange={(event) => onChange({ name: event.target.value })}
              className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
              placeholder="例如：1500W 不锈钢泵"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-muted">规格</span>
            <input
              value={form.spec}
              onChange={(event) => onChange({ spec: event.target.value })}
              className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
              placeholder="可选"
            />
          </label>
        </div>

        <div>
          <label className="block min-w-0">
            <span className="text-xs font-medium text-muted">泵壳模板</span>
            <select
              value={form.templateId}
              onChange={(event) => void onTemplateChange(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
            >
              <option value="">选择模板</option>
              {templates.map((template) => (
                <option key={template.id} value={String(template.id)}>{template.shellModel}</option>
              ))}
            </select>
          </label>
        </div>

        {hasStainlessBarrel ? (
          <div className="grid items-end gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-muted">机筒长度 mm</span>
              <input
                value={form.customBarrelLength}
                onChange={(event) => onChange({ customBarrelLength: event.target.value })}
                type="number"
                min="0"
                step="1"
                className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                placeholder="可选"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted">长螺丝补偿 mm</span>
              <input
                value={form.longScrewExtraLength}
                onChange={(event) => onChange({ longScrewExtraLength: event.target.value })}
                type="number"
                min="0"
                step="1"
                className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
              />
            </label>
          </div>
        ) : null}

        <TemplateMatchSummary
          parts={templateParts}
          total={templatePartsCost}
          onOpenAll={onOpenTemplateParts}
        />

        {linkedChanges.length > 0 ? (
          <details className="group rounded-md border border-slate-200 bg-white">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 marker:content-none">
              <div className="flex shrink-0 items-center gap-2">
                <CircleHelp size={15} className="text-slate-400" aria-hidden="true" />
                <span className="text-xs font-semibold text-slate-700">系统联动</span>
                <RecipeStatusBadge tone={hasLinkedChangeWarning ? 'amber' : 'blue'}>
                  {linkedChanges.length} 项
                </RecipeStatusBadge>
              </div>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={linkedChangeSummary}>
                {linkedChangeSummary}
              </span>
              <ChevronDown size={15} className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180" />
            </summary>
            <div className="grid gap-2 border-t border-line bg-slate-50/50 p-3 md:grid-cols-2">
              {linkedChanges.map((item) => (
                <div key={`${item.label}-${item.value}`} className={`rounded-md border px-3 py-2 ${linkedChangeToneClass(item.tone)}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium opacity-80">{item.label}</span>
                    <span className="text-sm font-semibold">{item.value}</span>
                  </div>
                  <div className="mt-1 text-xs leading-5 opacity-80">{item.note}</div>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </WorkspaceSection>
  );
}
