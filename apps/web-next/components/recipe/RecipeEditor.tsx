'use client';

import type { FormEvent, ReactNode } from 'react';
import { CircleAlert, Save, Sparkles, X } from 'lucide-react';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';

type RecipeEditorProps = {
  open: boolean;
  editing: boolean;
  saving: boolean;
  analysisLoading: boolean;
  saveBlocked: boolean;
  costLoading: boolean;
  formError: string | null;
  children: ReactNode;
  onClose: () => void;
  onAnalyze: () => void;
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
  children,
  onClose,
  onAnalyze,
  onSubmit,
}: RecipeEditorProps) {
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
            {children}
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-white/80 p-5 backdrop-blur">
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
            title={costLoading ? '当前成本尚未计算完成' : saveBlocked ? '存在成本警告，请处理后再保存配方' : undefined}
            icon={<Save size={15} />}
          >
            {saving ? '保存中' : costLoading ? '等待成本计算' : saveBlocked ? '处理警告后保存' : '保存配方'}
          </Button>
        </div>
      </form>
    </SlideOver>
  );
}
