'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, PackagePlus } from 'lucide-react';
import { EditableValueSelect } from '@/components/recipe/EditableValueSelect';
import {
  candidateMatchesPart,
  type MissingPartCandidate,
} from '@/components/recipe/missing-part-candidates';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/form-error';
import { selectInputValueOnFocus } from '@/components/ui/field';
import {
  confirmPartBatchCreate,
  getAllParts,
  previewPartBatchCreate,
  type Part,
  type PartBatchCreateInput,
  type PartBatchCreatePreview,
} from '@/lib/parts';

type MissingPartsBatchDialogProps = {
  open: boolean;
  candidates: MissingPartCandidate[];
  supplierOptions: string[];
  onClose: () => void;
  onCompleted: (candidates: MissingPartCandidate[], parts: Part[]) => void | Promise<void>;
};

function identityKey(candidate: MissingPartCandidate): string {
  return `${candidate.model.trim().toLocaleLowerCase()}\u0000${candidate.supplier.trim().toLocaleLowerCase()}`;
}

function partIdentityKey(part: Part): string {
  return `${part.model.trim().toLocaleLowerCase()}\u0000${part.supplier.trim().toLocaleLowerCase()}`;
}

function uniqueBatchInputs(candidates: MissingPartCandidate[]): PartBatchCreateInput[] {
  const groups = new Map<string, MissingPartCandidate>();
  for (const candidate of candidates) {
    const key = identityKey(candidate);
    const existing = groups.get(key);
    if (existing) {
      if (existing.category !== candidate.category || existing.subcategory !== candidate.subcategory) {
        throw new Error(`型号“${candidate.model}”和供应商“${candidate.supplier}”被分到多个分类，请分别调整供应商或使用单条建档`);
      }
      if (existing.price !== candidate.price || existing.stock !== candidate.stock) {
        throw new Error(`型号“${candidate.model}”和供应商“${candidate.supplier}”在多行使用了不同价格，请统一后再集中建档`);
      }
      continue;
    }
    groups.set(key, candidate);
  }
  return Array.from(groups.values()).map((candidate) => ({
    model: candidate.model.trim(),
    category: candidate.category,
    subcategory: candidate.subcategory || undefined,
    supplier: candidate.supplier.trim(),
    price: candidate.price,
    stock: candidate.stock,
    notes: `从${candidate.contextLabel}集中补齐零件`,
  }));
}

export function MissingPartsBatchDialog({
  open,
  candidates,
  supplierOptions,
  onClose,
  onCompleted,
}: MissingPartsBatchDialogProps) {
  const [rows, setRows] = useState<MissingPartCandidate[]>(candidates);
  const [preview, setPreview] = useState<PartBatchCreatePreview | null>(null);
  const [alreadyExistingCount, setAlreadyExistingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uniqueSuppliers = useMemo(
    () => Array.from(new Set(supplierOptions.map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    [supplierOptions]
  );

  useEffect(() => {
    if (!open) return;
    setRows(candidates);
    setPreview(null);
    setAlreadyExistingCount(0);
    setBusy(false);
    setCommitted(false);
    setError(null);
  }, [candidates, open]);

  function updateRow(key: string, patch: Partial<MissingPartCandidate>) {
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
      if (!Number.isFinite(row.price) || row.price <= 0) throw new Error(`请填写“${row.model}”大于 0 的单价`);
      if (row.category === '包装' && !row.subcategory) throw new Error(`请选择“${row.model}”的包装二级分类`);
    }
  }

  async function buildPreview() {
    setBusy(true);
    setError(null);
    try {
      validateRows();
      const freshParts = await getAllParts();
      const unresolvedRows = rows.filter((row) => !freshParts.some((part) => candidateMatchesPart(row, part)));
      for (const row of unresolvedRows) {
        const conflicting = freshParts.find((part) => partIdentityKey(part) === identityKey(row));
        if (conflicting) {
          throw new Error(`型号“${row.model}”和供应商“${row.supplier}”已存在于“${conflicting.category}”分类，请使用单条建档调整绑定`);
        }
      }
      setAlreadyExistingCount(rows.length - unresolvedRows.length);
      if (unresolvedRows.length === 0) {
        await onCompleted(rows, freshParts);
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
      let freshParts: Part[];
      try {
        freshParts = await getAllParts();
      } catch {
        setPreview(null);
        setError('零件已经正式建档，但目录回读失败。请关闭后刷新页面，勿重复提交本批建档。');
        return;
      }
      await onCompleted(rows, freshParts);
    } catch (createError) {
      setPreview(null);
      const message = createError instanceof Error ? createError.message : '集中建档结果未确认';
      setError(`${message}。本次命令已发出，为避免重复提交，请关闭后刷新零件目录确认结果。`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      closeOnBackdrop={!busy}
      size="xl"
      layer="top"
      ariaLabel="集中补齐零件"
    >
      <DialogHeader>
        <div>
          <h2 className="text-lg font-semibold text-ink">集中补齐零件</h2>
          <p className="mt-1 text-sm text-muted">先补齐供应商和目录价，再预览整批变化；确认后由正式批量命令原子建档并回绑当前草稿。</p>
        </div>
      </DialogHeader>
      <DialogBody className="max-h-[70dvh] overflow-y-auto">
        <FormError message={error} />

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
                <span className="text-xs font-medium text-muted">目录单价</span>
                <input
                  value={Number.isFinite(row.price) ? String(row.price) : ''}
                  onChange={(event) => updateRow(row.key, { price: Number(event.target.value) })}
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
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
        {preview ? (
          <Button type="button" variant="primary" onClick={() => void confirmCreate()} disabled={busy || committed} icon={<PackagePlus size={15} />}>
            {busy ? '建档并回读中' : '确认集中建档'}
          </Button>
        ) : (
          <Button type="button" variant="primary" onClick={() => void buildPreview()} disabled={busy || committed || rows.length === 0} icon={<PackagePlus size={15} />}>
            {busy ? '生成预览中' : '预览集中建档'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
