'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CircleAlert, PackagePlus, Save, Sparkles, X } from 'lucide-react';
import { SlideOver } from '@/components/motion/slide-over';
import { RecipeSectionFlowProvider, type RecipeFlowStep } from '@/components/recipe/RecipeSection';
import { Button } from '@/components/ui/button';

type RecipeEditorProps = {
  open: boolean;
  editing: boolean;
  saving: boolean;
  analysisLoading: boolean;
  saveBlocked: boolean;
  costLoading: boolean;
  formError: string | null;
  dirty: boolean;
  steps: RecipeFlowStep[];
  missingPartCount: number;
  children: ReactNode;
  onClose: () => void;
  onAnalyze: () => void;
  onOpenMissingParts: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function RecipeEditor({
  open,
  editing,
  saving,
  analysisLoading,
  saveBlocked,
  costLoading,
  formError,
  dirty,
  steps,
  missingPartCount,
  children,
  onClose,
  onAnalyze,
  onOpenMissingParts,
  onSubmit,
}: RecipeEditorProps) {
  const [activeSectionId, setActiveSectionId] = useState('');
  const wasOpenRef = useRef(false);
  const previousDoneRef = useRef(new Map<string, boolean>());

  useEffect(() => {
    const currentDone = new Map(steps.map((step) => [step.id, step.done]));
    if (!open) {
      wasOpenRef.current = false;
      previousDoneRef.current = currentDone;
      return;
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      setActiveSectionId(steps.find((step) => !step.done)?.id || steps[0]?.id || '');
      previousDoneRef.current = currentDone;
      return;
    }

    const currentIndex = steps.findIndex((step) => step.id === activeSectionId);
    const currentStep = steps[currentIndex];
    const justCompleted = currentStep?.done === true
      && previousDoneRef.current.get(activeSectionId) === false;
    if (justCompleted) {
      const nextStep = steps.slice(currentIndex + 1).find((step) => !step.done)
        || steps.find((step) => !step.done);
      if (nextStep) setActiveSectionId(nextStep.id);
    }
    previousDoneRef.current = currentDone;
  }, [activeSectionId, open, steps]);

  function openStep(sectionId: string) {
    setActiveSectionId(sectionId);
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <SlideOver open={open} onClose={() => !saving && onClose()} size="workspace">
      <form onSubmit={onSubmit} className="flex min-h-full flex-col bg-slate-50">
        <div className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-start justify-between gap-4 px-6 py-5">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-ink">
                {editing ? '编辑配方' : '新建配方'}
              </h2>
              <p className="mt-2 text-sm text-muted">配置产品型号、BOM 物料和加工费用，系统会自动生成成本预览。</p>
            </div>
            <button
              type="button"
              aria-label="关闭"
              disabled={saving}
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1">
          <div className="mx-auto max-w-7xl px-6 py-6">
            {formError ? (
              <div className="mb-4 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <CircleAlert size={16} />
                {formError}
              </div>
            ) : null}
            {missingPartCount > 0 ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                <div>
                  <div className="text-sm font-semibold text-amber-900">待补齐零件 {missingPartCount} 项</div>
                  <div className="mt-1 text-xs text-amber-700">可以集中填写供应商和目录价，也可继续在对应物料行单条建档。</div>
                </div>
                <Button type="button" size="sm" onClick={onOpenMissingParts} disabled={saving} icon={<PackagePlus size={14} />}>
                  集中补齐
                </Button>
              </div>
            ) : null}
            <RecipeSectionFlowProvider
              activeSectionId={activeSectionId}
              sectionIds={steps.map((step) => step.id)}
              onActiveSectionChange={openStep}
            >
              <fieldset disabled={saving} aria-busy={saving} className="contents">
                {children}
              </fieldset>
            </RecipeSectionFlowProvider>
          </div>
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-white/80 p-5 backdrop-blur">
          <div className="text-xs text-muted" aria-live="polite">{dirty ? '有未保存修改' : '尚未修改'}</div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button
              type="button"
              onClick={onAnalyze}
              disabled={saving || analysisLoading}
              icon={<Sparkles size={15} />}
            >
              {analysisLoading ? '检查中' : '智能检查'}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || saveBlocked}
              title={costLoading ? '成本正在后台更新；保存时会按当前配置重新核算' : saveBlocked ? '存在成本警告，请处理后再保存配方' : undefined}
              icon={<Save size={15} />}
            >
              {saving ? '保存中' : saveBlocked ? '处理警告后保存' : '保存配方'}
            </Button>
          </div>
        </div>
      </form>
    </SlideOver>
  );
}
