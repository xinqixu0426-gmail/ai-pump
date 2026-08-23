'use client';

import { useEffect, useState } from 'react';
import { Copy, Layers3, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import type { PumpShellTemplate, Recipe } from '@/lib/recipes';

type ProductCreationDialogProps = {
  open: boolean;
  recipes: Recipe[];
  templates: PumpShellTemplate[];
  saving: boolean;
  onClose: () => void;
  onCloneRecipe: (recipe: Recipe) => void;
  onCreateFromTemplate: (template: PumpShellTemplate) => void | Promise<void>;
  onCreateTemplate: () => void;
};

export function ProductCreationDialog({
  open,
  recipes,
  templates,
  saving,
  onClose,
  onCloneRecipe,
  onCreateFromTemplate,
  onCreateTemplate,
}: ProductCreationDialogProps) {
  const [recipeId, setRecipeId] = useState('');
  const [templateId, setTemplateId] = useState('');

  useEffect(() => {
    if (!open) return;
    setRecipeId('');
    setTemplateId('');
  }, [open]);

  const selectedRecipe = recipes.find((recipe) => String(recipe.id) === recipeId);
  const selectedTemplate = templates.find((template) => String(template.id) === templateId);
  const templateNameById = new Map(templates.map((template) => [template.id, template.shellModel]));

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} size="lg" ariaLabelledBy="product-creation-title">
      <DialogHeader>
        <div>
          <h2 id="product-creation-title" className="text-lg font-semibold text-ink">新建产品</h2>
          <div className="mt-1 text-sm text-muted">先选择最接近当前工作的起点，后续仍使用正式模板和配方保存流程。</div>
        </div>
        <button
          type="button"
          aria-label="关闭"
          disabled={saving}
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted hover:bg-slate-50 disabled:opacity-60"
        >
          <X size={16} />
        </button>
      </DialogHeader>

      <DialogBody className="space-y-3 bg-slate-50">
        <section className="rounded-panel border border-sky-200 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-sky-600 text-white"><Copy size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-semibold text-ink">复制相近配方</div>
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">推荐</span>
              </div>
              <div className="mt-1 text-sm text-muted">保留包装、选配、人工和技术参数，只修改型号、线圈等差异。</div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Select value={recipeId} onChange={(event) => setRecipeId(event.target.value)} aria-label="选择要复制的配方" className="min-w-0 flex-1">
                  <option value="">选择作为起点的配方</option>
                  {recipes.map((recipe) => (
                    <option key={recipe.id} value={String(recipe.id)}>
                      {[recipe.name || `配方 #${recipe.id}`, recipe.templateId ? templateNameById.get(recipe.templateId) : '', recipe.coilSheets ? `${recipe.coilSpec || ''}/${recipe.coilSheets}片` : ''].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="primary" disabled={!selectedRecipe || saving} onClick={() => selectedRecipe && onCloneRecipe(selectedRecipe)} icon={<Copy size={14} />}>
                  复制为新配方
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-panel border border-line bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-800"><Layers3 size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-ink">从现有模板创建</div>
              <div className="mt-1 text-sm text-muted">自动带入泵壳固定 BOM、人工工资、表面处理和配置范围。</div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Select value={templateId} onChange={(event) => setTemplateId(event.target.value)} aria-label="选择产品模板" className="min-w-0 flex-1">
                  <option value="">选择泵壳模板</option>
                  {templates.map((template) => (
                    <option key={template.id} value={String(template.id)}>{template.shellModel || `模板 #${template.id}`}</option>
                  ))}
                </Select>
                <Button type="button" disabled={!selectedTemplate || saving} onClick={() => selectedTemplate && void onCreateFromTemplate(selectedTemplate)} icon={<Layers3 size={14} />}>
                  使用此模板
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-panel border border-line bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700"><Plus size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-ink">创建全新模板</div>
              <div className="mt-1 text-sm text-muted">适合新的泵壳结构；模板保存后可以直接继续创建配方。</div>
              <Button type="button" className="mt-3" disabled={saving} onClick={onCreateTemplate} icon={<Plus size={14} />}>
                新建泵壳模板
              </Button>
            </div>
          </div>
        </section>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
      </DialogFooter>
    </Dialog>
  );
}
