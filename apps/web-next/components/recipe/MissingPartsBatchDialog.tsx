'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, PackagePlus } from 'lucide-react';
import { EditableValueSelect } from '@/components/recipe/EditableValueSelect';
import {
  candidateMatchesPart,
  type MissingPartCandidate,
} from '@/components/recipe/missing-part-candidates';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/form-error';
import { getCatalogNamingRules, previewCatalogName, type CatalogNamingRule } from '@/lib/catalog-naming';
import { identityKey, partIdentityKey, uniqueBatchInputs, nameMissingPartCandidates, type NamedMissingPartCandidate } from './missing-part-naming';
import { Field, Input, selectInputValueOnFocus } from '@/components/ui/field';
import { useConfirmDiscard } from '@/hooks/use-confirm-discard';
import {
  confirmPartBatchCreate,
  getAllParts,
  previewPartBatchCreate,
  type Part,
  type PartBatchCreatePreview,
} from '@/lib/parts';

type MissingPartsBatchDialogProps = {
  open: boolean;
  candidates: MissingPartCandidate[];
  supplierOptions: string[];
  onClose: () => void;
  onCompleted: (candidates: MissingPartCandidate[], parts: Part[]) => void | Promise<void>;
};

export function MissingPartsBatchDialog({
  open,
  candidates,
  supplierOptions,
  onClose,
  onCompleted,
}: MissingPartsBatchDialogProps) {
  const [rows, setRows] = useState<MissingPartCandidate[]>(candidates);
  const [namingRules, setNamingRules] = useState<CatalogNamingRule[] | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesAttempt, setRulesAttempt] = useState(0);
  const [specs, setSpecs] = useState<Record<string, Record<string, string>>>({});
  const [namedRows, setNamedRows] = useState<NamedMissingPartCandidate[]>([]);
  const [preview, setPreview] = useState<PartBatchCreatePreview | null>(null);
  const [alreadyExistingCount, setAlreadyExistingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    dirty,
    discardPromptOpen,
    discardMessage,
    markDirty,
    resetDirty,
    requestClose,
    confirmDiscard,
    cancelDiscard,
  } = useConfirmDiscard({
    open,
    busy,
    onDiscard: onClose,
    message: '当前集中建档草稿有尚未保存的修改，确定放弃吗？',
  });
  const uniqueSuppliers = useMemo(
    () => Array.from(new Set(supplierOptions.map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    [supplierOptions]
  );

  useEffect(() => {
    if (!open) return;
    resetDirty();
    setRows(candidates);
    setSpecs({});
    setNamedRows([]);
    setPreview(null);
    setAlreadyExistingCount(0);
    setBusy(false);
    setCommitted(false);
    setError(null);
  }, [candidates, open, resetDirty]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setNamingRules(null);
    setRulesError(null);
    getCatalogNamingRules().then((rules) => { if (active) setNamingRules(rules); })
      .catch((cause) => { if (active) setRulesError(cause instanceof Error ? cause.message : '命名规则加载失败'); });
    return () => { active = false; };
  }, [open, rulesAttempt]);

  function updateRow(key: string, patch: Partial<MissingPartCandidate>) {
    markDirty();
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
    setPreview(null);
    setAlreadyExistingCount(0);
    setError(null);
  }

  function validateRows() {
    if (rows.length === 0) throw new Error('当前没有待补齐零件');
    for (const row of rows) {
      if (!row.model.trim()) throw new Error(`${row.contextLabel}缺少零件型号`);
      if (!row.supplier.trim()) throw new Error(`请填写“${row.model}”的供应商`);
      if (!Number.isFinite(row.catalogUnitCost) || row.catalogUnitCost <= 0) throw new Error(`请填写“${row.model}”大于 0 的目录成本价`);
      if (row.category === '包装' && !row.subcategory) throw new Error(`请选择“${row.model}”的包装二级分类`);
    }
  }

  async function buildPreview() {
    setBusy(true);
    setError(null);
    try {
      if (!namingRules) throw new Error(rulesError || '命名规则加载中，请稍后重试');
      validateRows();
      const resolvedRows = await nameMissingPartCandidates(rows, namingRules, specs, previewCatalogName);
      uniqueBatchInputs(resolvedRows);
      const freshParts = await getAllParts();
      const unresolvedRows = resolvedRows.filter((row) => !freshParts.some((part) => candidateMatchesPart(row, part)));
      for (const row of unresolvedRows) {
        const conflicting = freshParts.find((part) => partIdentityKey(part) === identityKey(row));
        if (conflicting) {
          throw new Error(`型号“${row.model}”和供应商“${row.supplier}”已存在于“${conflicting.category}”分类，请使用单条建档调整绑定`);
        }
      }
      setAlreadyExistingCount(resolvedRows.length - unresolvedRows.length);
      setNamedRows(resolvedRows);
      if (unresolvedRows.length === 0) {
        await onCompleted(resolvedRows, freshParts);
        resetDirty();
        return;
      }
      setPreview(await previewPartBatchCreate(uniqueBatchInputs(unresolvedRows)));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : '生成集中建档预览失败');
    } finally {
      setBusy(false);
    }
  }

  async function confirmCreate() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setCommitted(true);
    try {
      await confirmPartBatchCreate(preview);
      resetDirty();
      let freshParts: Part[];
      try {
        freshParts = await getAllParts();
      } catch {
        setPreview(null);
        setError('零件已经正式建档，但目录回读失败。请关闭后刷新页面，勿重复提交本批建档。');
        return;
      }
      await onCompleted(namedRows, freshParts);
    } catch (createError) {
      setPreview(null);
      const message = createError instanceof Error ? createError.message : '集中建档结果未确认';
      setError(`${message}。本次命令已发出，为避免重复提交，请关闭后刷新零件目录确认结果。`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Dialog
      open={open}
      onClose={requestClose}
      closeOnBackdrop={!busy}
      size="xl"
      layer="top"
      ariaLabel="集中补齐零件"
    >
      <DialogHeader>
        <div>
          <h2 className="text-lg font-semibold text-ink">集中补齐零件</h2>
          <p className="mt-1 text-sm text-muted">先补齐命名规格、供应商和目录价，再预览整批生成名称；确认后由正式批量命令原子建档并回绑当前草稿。</p>
        </div>
      </DialogHeader>
      <DialogBody className="max-h-[70dvh] overflow-y-auto">
        <FormError message={error} />
        {!namingRules ? <div role="status" className="mb-3 text-sm text-muted">
          {rulesError || '正在加载命名规则…'}
          {rulesError ? <Button type="button" onClick={() => setRulesAttempt((value) => value + 1)}>重新加载命名规则</Button> : null}
        </div> : null}

        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.key} className="grid gap-3 rounded-md border border-line bg-white p-3 lg:grid-cols-[minmax(150px,1fr)_minmax(180px,1.2fr)_minmax(160px,1fr)_130px]">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-muted">{row.contextLabel}</div>
                <div className="mt-1 truncate text-sm font-semibold text-ink" title={row.model}>{row.model}</div>
                <div className="mt-1 text-xs text-slate-500">{row.category}{row.subcategory ? ` / ${row.subcategory}` : ''}</div>
              </div>
              <label className="block min-w-0">
                <span className="text-xs font-medium text-muted">供应商</span>
                <EditableValueSelect
                  value={row.supplier}
                  options={uniqueSuppliers}
                  onChange={(supplier) => updateRow(row.key, { supplier })}
                  ariaLabel={`${row.model}供应商`}
                  listboxId={`missing-part-supplier-${row.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                  placeholder="填写或选择供应商"
                  rootClassName="relative mt-1"
                  disabled={Boolean(preview) || busy || committed}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">目录成本价</span>
                <input
                  value={Number.isFinite(row.catalogUnitCost) ? String(row.catalogUnitCost) : ''}
                  onChange={(event) => updateRow(row.key, { catalogUnitCost: Number(event.target.value) })}
                  onFocus={selectInputValueOnFocus}
                  type="number"
                  min="0.01"
                  step="0.01"
                  disabled={Boolean(preview) || busy || committed}
                  className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-sky-400 disabled:bg-slate-50"
                />
              </label>
              <div className="flex items-center text-xs text-muted">
                初始库存 0
              </div>
              {namingRules?.find((rule) => rule.supportsPartCreate && rule.category === row.category) ? (
                <div className="space-y-3 lg:col-span-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    {namingRules.find((rule) => rule.supportsPartCreate && rule.category === row.category)!.fields.map((field) => (
                      <Field key={field.key} label={field.label} required={!field.optional}>
                        <Input value={specs[row.key]?.[field.key] ?? ''} maxLength={field.maxLength}
                          disabled={Boolean(preview) || busy || committed}
                          onChange={(event) => {
                            markDirty();
                            setSpecs((current) => ({ ...current, [row.key]: { ...current[row.key], [field.key]: event.target.value } }));
                            setNamedRows([]);
                            setError(null);
                          }} />
                      </Field>
                    ))}
                  </div>
                  <div className="break-words text-sm text-muted">生成型号：{namedRows.find((item) => item.key === row.key)?.model || '填写规格后点击预览生成'}</div>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {preview ? (
          <div className="mt-5 rounded-md border border-sky-200 bg-sky-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-900">
              <CheckCircle2 size={16} /> 正式预览已生成
            </div>
            <div className="mt-2 text-sm text-sky-800">
              将新增 {preview.createCount} 项；已存在并直接回绑 {alreadyExistingCount + preview.skippedCount} 项。
            </div>
            {preview.warnings.length > 0 ? (
              <div className="mt-3 space-y-1 text-xs text-amber-800">
                {preview.warnings.map((warning) => <div key={`${warning.code}-${warning.resourceId || warning.message}`}>· {warning.message}</div>)}
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <div className="mr-auto text-xs text-muted" aria-live="polite">{dirty ? '有未保存修改' : '尚未修改'}</div>
        <Button type="button" variant="ghost" onClick={requestClose} disabled={busy}>取消</Button>
        {preview && !committed ? <Button type="button" disabled={busy} onClick={() => { setPreview(null); setNamedRows([]); setAlreadyExistingCount(0); }}>修改规格</Button> : null}
        {preview ? (
          <Button type="button" variant="primary" onClick={() => void confirmCreate()} disabled={busy || committed} icon={<PackagePlus size={15} />}>
            {busy ? '建档并回读中' : '确认集中建档'}
          </Button>
        ) : (
          <Button type="button" variant="primary" onClick={() => void buildPreview()} disabled={busy || committed || !namingRules || rows.length === 0} icon={<PackagePlus size={15} />}>
            {busy ? '生成预览中' : '预览集中建档'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
    <ConfirmDialog
      open={discardPromptOpen}
      title="放弃未保存修改？"
      description={discardMessage}
      confirmLabel="放弃修改"
      cancelLabel="继续编辑"
      confirmVariant="danger"
      busy={busy}
      onConfirm={confirmDiscard}
      onClose={cancelDiscard}
      layer="top"
    />
    </>
  );
}
