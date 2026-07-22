'use client';

import { ChevronDown, Download, FileSpreadsheet, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  deleteRecipeTechnicalFile,
  downloadRecipeTechnicalFile,
  getRecipeTechnicalFiles,
  uploadRecipeTechnicalFile,
  type RecipeTechnicalFile,
} from '@/lib/recipes';
import {
  createCustomTechnicalField,
  getTechnicalDataEntries,
  TECHNICAL_DATA_LABELS,
  type CustomTechnicalField,
  type FixedTechnicalDataKey,
  type RecipeTechnicalData,
  type TechnicalReferenceField,
} from '@/lib/technical-data';

const fixedFields: Array<{ key: FixedTechnicalDataKey; unit?: string; type?: string; wide?: boolean }> = [
  { key: 'rotorLength', unit: 'mm' },
  { key: 'rotorDiameter', unit: 'mm' },
  { key: 'shaftDiameter', unit: 'mm' },
  { key: 'power', unit: 'W / kW' },
  { key: 'voltage', unit: 'V' },
  { key: 'current', unit: 'A' },
  { key: 'frequency', unit: 'Hz' },
  { key: 'testReportNo' },
  { key: 'testDate', type: 'date' },
  { key: 'testSummary', wide: true },
];

type TechnicalDataEditorProps = {
  recipeId?: number | null;
  value: RecipeTechnicalData;
  onChange: (value: RecipeTechnicalData) => void;
  referenceFields?: TechnicalReferenceField[];
  impellerModel: string;
  impellerThickness: string;
  impellerDiameter: string;
  impellerBladeCount: string;
  onImpellerChange: (patch: {
    impellerModel?: string;
    impellerThickness?: string;
    impellerDiameter?: string;
    impellerBladeCount?: string;
  }) => void;
};

function FieldShell({ label, unit, children, wide = false }: {
  label: string;
  unit?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'block md:col-span-3' : 'block'}>
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted">
        {label}
        {unit ? <span className="font-normal text-slate-400">{unit}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function TechnicalDataEditor({
  recipeId,
  value,
  onChange,
  referenceFields = [],
  impellerModel,
  impellerThickness,
  impellerDiameter,
  impellerBladeCount,
  onImpellerChange,
}: TechnicalDataEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [technicalFiles, setTechnicalFiles] = useState<RecipeTechnicalFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const customFields = value.customFields || [];
  const filledCount = getTechnicalDataEntries(value).length;
  const impellerEntries = [
    impellerModel ? `叶轮 ${impellerModel}` : '',
    impellerThickness ? `${impellerThickness}mm厚` : '',
    impellerDiameter ? `直径${impellerDiameter}mm` : '',
    impellerBladeCount ? `${impellerBladeCount}片叶` : '',
  ].filter(Boolean);

  useEffect(() => {
    if (!recipeId) {
      setTechnicalFiles([]);
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    setFileError('');
    void getRecipeTechnicalFiles(recipeId)
      .then((files) => { if (!cancelled) setTechnicalFiles(files); })
      .catch((error) => { if (!cancelled) setFileError(error instanceof Error ? error.message : '测试报告加载失败'); })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [recipeId]);

  async function uploadTestReport(file?: File) {
    if (!recipeId || !file) return;
    setFileBusy(true);
    setFileError('');
    try {
      await uploadRecipeTechnicalFile(recipeId, file);
      setTechnicalFiles(await getRecipeTechnicalFiles(recipeId));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : '测试报告上传失败');
    } finally {
      setFileBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removeTestReport(file: RecipeTechnicalFile) {
    if (!recipeId || !window.confirm(`删除测试报告“${file.originalName}”？`)) return;
    setFileBusy(true);
    setFileError('');
    try {
      await deleteRecipeTechnicalFile(recipeId, file.id);
      setTechnicalFiles(await getRecipeTechnicalFiles(recipeId));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : '测试报告删除失败');
    } finally {
      setFileBusy(false);
    }
  }

  function updateFixed(key: FixedTechnicalDataKey, next: string) {
    onChange({ ...value, [key]: next });
  }

  function addCustomField() {
    onChange({ ...value, customFields: [...customFields, createCustomTechnicalField()] });
  }

  function updateCustomField(id: string, patch: Partial<CustomTechnicalField>) {
    onChange({
      ...value,
      customFields: customFields.map((field) => field.id === id ? { ...field, ...patch } : field),
    });
  }

  function removeCustomField(id: string) {
    onChange({ ...value, customFields: customFields.filter((field) => field.id !== id) });
  }

  return (
    <div className="rounded-panel border border-slate-200 bg-white shadow-sm transition duration-200 focus-within:border-sky-300 focus-within:bg-sky-50/20 focus-within:ring-4 focus-within:ring-sky-100/60">
      <button
        type="button"
        onClick={() => setExpanded((next) => !next)}
        className="flex w-full flex-wrap items-center justify-between gap-3 rounded-panel px-4 py-3 text-left transition-colors duration-150 hover:bg-slate-50"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">技术档案与叶轮参数</span>
            <span className="inline-flex h-6 items-center rounded-full border border-sky-200 bg-sky-50 px-2 text-xs font-medium text-sky-700">
              参考 {referenceFields.length}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {expanded
              ? '结构化保存到 technicalDataJson，可直接被报价、订单和出图流程复用。'
              : `${filledCount > 0 ? `已填 ${filledCount} 项` : '未填写'}${technicalFiles.length > 0 ? `，报告 ${technicalFiles.length} 份` : ''}${referenceFields.length > 0 ? `，参考 ${referenceFields.length}` : ''}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {expanded && filledCount > 0 ? <span className="rounded-full border border-line bg-slate-50 px-2 py-1 text-muted">已填 {filledCount}</span> : null}
          {expanded && referenceFields.length > 0 ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">参考 {referenceFields.length}</span> : null}
          <ChevronDown size={16} className={`text-muted transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded ? <div className="space-y-4 border-t border-line p-4">
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-muted">性能测试报告</div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(event) => void uploadTestReport(event.target.files?.[0])}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={!recipeId || fileBusy}
              icon={fileBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            >
              上传 Excel
            </Button>
          </div>
          {!recipeId ? (
            <div className="rounded-md border border-dashed border-line p-3 text-sm text-muted">保存配方后即可上传测试报告</div>
          ) : filesLoading ? (
            <div className="rounded-md border border-line p-3 text-sm text-muted">正在加载测试报告...</div>
          ) : technicalFiles.length === 0 ? (
            <div className="rounded-md border border-dashed border-line p-3 text-sm text-muted">暂无测试报告</div>
          ) : (
            <div className="space-y-2">
              {technicalFiles.map((file) => {
                return (
                  <div key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-ink">
                        <FileSpreadsheet size={15} className="shrink-0 text-emerald-600" />
                        <span className="truncate">{file.originalName}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {[file.summary?.model, file.summary?.testDate, `${file.summary?.testPointCount || 0} 个测试点`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" size="sm" variant="ghost" title="下载原文件" aria-label={`下载${file.originalName}`} onClick={() => recipeId && void downloadRecipeTechnicalFile(recipeId, file)} icon={<Download size={14} />} />
                      <Button type="button" size="sm" variant="danger" title="删除测试报告" aria-label={`删除${file.originalName}`} disabled={fileBusy} onClick={() => void removeTestReport(file)} icon={<Trash2 size={14} />} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {fileError ? <div className="mt-2 text-sm text-rose-700">{fileError}</div> : null}
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="text-xs font-semibold text-muted">叶轮参数</div>
            {impellerEntries.map((entry) => (
              <span key={entry} className="rounded-full border border-line bg-slate-50 px-2 py-0.5 text-xs text-muted">{entry}</span>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <FieldShell label="叶轮">
              <input value={impellerModel} onChange={(event) => onImpellerChange({ impellerModel: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
            </FieldShell>
            <FieldShell label="叶轮厚度" unit="mm">
              <input value={impellerThickness} onChange={(event) => onImpellerChange({ impellerThickness: event.target.value })} type="number" min="0" step="0.1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
            </FieldShell>
            <FieldShell label="叶轮直径" unit="mm">
              <input value={impellerDiameter} onChange={(event) => onImpellerChange({ impellerDiameter: event.target.value })} type="number" min="0" step="0.1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
            </FieldShell>
            <FieldShell label="叶片数" unit="片">
              <input value={impellerBladeCount} onChange={(event) => onImpellerChange({ impellerBladeCount: event.target.value })} type="number" min="0" step="1" className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
            </FieldShell>
          </div>
        </div>

        <div>
          <div className="mb-3 text-xs font-semibold text-muted">固定技术字段</div>
          <div className="grid gap-3 md:grid-cols-3">
            {fixedFields.map((field) => (
              <FieldShell key={field.key} label={TECHNICAL_DATA_LABELS[field.key]} unit={field.unit} wide={field.wide}>
                {field.wide ? (
                  <textarea value={value[field.key] || ''} onChange={(event) => updateFixed(field.key, event.target.value)} rows={2} className="mt-1 w-full resize-y rounded-md border border-line px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                ) : (
                  <input value={value[field.key] || ''} onChange={(event) => updateFixed(field.key, event.target.value)} type={field.type || 'text'} className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                )}
              </FieldShell>
            ))}
          </div>
        </div>

        {referenceFields.length > 0 ? (
          <div>
            <div className="mb-3 text-xs font-semibold text-muted">泵壳预设参考</div>
            <div className="grid gap-2 md:grid-cols-3">
              {referenceFields.map((field) => (
                <div key={field.id} className="min-w-0 rounded-md border border-sky-100 bg-sky-50 px-3 py-2">
                  <div className="truncate text-xs font-medium text-sky-700" title={field.label}>{field.label}</div>
                  <div className="mt-1 truncate text-sm font-semibold text-ink" title={`${field.value}${field.unit ? ` ${field.unit}` : ''}`}>
                    {field.value}{field.unit ? ` ${field.unit}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-muted">自定义参数</div>
            <Button type="button" size="sm" onClick={addCustomField} icon={<Plus size={14} />}>添加字段</Button>
          </div>
          {customFields.length === 0 ? (
            <div className="rounded-md border border-dashed border-line p-3 text-sm text-muted">暂无自定义参数</div>
          ) : (
            <div className="space-y-2">
              {customFields.map((field) => (
                <div key={field.id} className="grid gap-2 md:grid-cols-[1fr_1.4fr_0.7fr_auto]">
                  <input value={field.label} onChange={(event) => updateCustomField(field.id, { label: event.target.value })} placeholder="字段名" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                  <input value={field.value} onChange={(event) => updateCustomField(field.id, { value: event.target.value })} placeholder="参数" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                  <input value={field.unit || ''} onChange={(event) => updateCustomField(field.id, { unit: event.target.value })} placeholder="单位" className="h-9 rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400" />
                  <Button type="button" size="sm" variant="danger" onClick={() => removeCustomField(field.id)} icon={<Trash2 size={14} />}>删除</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div> : null}
    </div>
  );
}
