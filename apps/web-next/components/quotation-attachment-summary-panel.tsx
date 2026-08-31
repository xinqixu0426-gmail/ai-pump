'use client';

import { useMemo, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { Check, CircleAlert, Download, FileSearch, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, PanelRightOpen, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { uploadFactoryFile, type FactoryFile } from '@/lib/files';
import { generateQuotationInquirySummaryDraft } from '@/lib/quotations';
import {
  FACTORY_ATTACHMENT_EXTENSIONS,
  selectClipboardFile,
} from '@/lib/clipboard-files';

export type QuotationInquiryDraft = {
  files: FactoryFile[];
  summaryText: string;
  sourceFileIds: number[];
};

type InquiryTab = 'files' | 'summary' | 'pending';

type Props = {
  customerName?: string;
  value: QuotationInquiryDraft;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onChange: (value: QuotationInquiryDraft) => void;
};

const ACCEPTED_FILE_TYPES = FACTORY_ATTACHMENT_EXTENSIONS.join(',');
const MAX_ATTACHMENTS = 20;

function fileSizeLabel(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileTypeLabel(file: FactoryFile) {
  if (file.extension === '.doc' || file.extension === '.docx') return 'Word';
  if (file.detectedType === 'spreadsheet') return '表格';
  if (file.detectedType === 'image') return '图片';
  if (file.detectedType === 'pdf') return 'PDF';
  return '文本';
}

function fileIcon(type: FactoryFile['detectedType']) {
  if (type === 'spreadsheet') return <FileSpreadsheet size={17} />;
  if (type === 'image') return <ImageIcon size={17} />;
  return <FileText size={17} />;
}

function pendingItems(summaryText: string) {
  return summaryText
    .split('\n')
    .map(line => line.replace(/^\s*[-*#\d.、]+\s*/, '').trim())
    .filter(line => line && /(待确认|未提供|不确定|冲突|需核对|需要确认)/.test(line))
    .filter((line, index, lines) => lines.indexOf(line) === index)
    .slice(0, 12);
}

export function QuotationAttachmentSummaryPanel({
  customerName = '',
  value,
  expanded,
  onExpandedChange,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<InquiryTab>('files');
  const [uploading, setUploading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<FactoryFile | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const selectedIds = useMemo(() => new Set(value.sourceFileIds), [value.sourceFileIds]);
  const selectedFiles = useMemo(
    () => value.files.filter(file => selectedIds.has(file.id)),
    [selectedIds, value.files]
  );
  const pending = useMemo(() => pendingItems(value.summaryText), [value.summaryText]);
  const busy = uploading || summarizing;
  const summaryStatus = summarizing ? 'AI 归纳中' : value.summaryText.trim() ? '已有归纳' : '未归纳';

  function update(patch: Partial<QuotationInquiryDraft>) {
    onChange({ ...value, ...patch });
  }

  function openFileChooser() {
    onExpandedChange(true);
    setActiveTab('files');
    if (value.files.length >= MAX_ATTACHMENTS) {
      setError(`一张报价最多上传 ${MAX_ATTACHMENTS} 个询价附件。`);
      return;
    }
    inputRef.current?.click();
  }

  async function upload(file?: File, pasteNotice = '') {
    if (!file || busy) return;
    if (value.files.length >= MAX_ATTACHMENTS) {
      setError(`一张报价最多上传 ${MAX_ATTACHMENTS} 个询价附件。`);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const stored = await uploadFactoryFile(file);
      const files = value.files.some(item => item.id === stored.id)
        ? value.files.map(item => item.id === stored.id ? stored : item)
        : [...value.files, stored];
      update({ files });
      setMessage(`${pasteNotice ? `${pasteNotice} ` : ''}附件已上传，可继续上传或让 AI 归纳。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传询价附件失败');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
      setUploading(false);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    if (event.clipboardData.files.length === 0) return;
    event.preventDefault();
    onExpandedChange(true);
    setActiveTab('files');
    if (busy) {
      setMessage('');
      setError('当前询价附件正在处理中，请完成后再粘贴。');
      return;
    }
    if (value.files.length >= MAX_ATTACHMENTS) {
      setMessage('');
      setError(`一张报价最多上传 ${MAX_ATTACHMENTS} 个询价附件。`);
      return;
    }
    const decision = selectClipboardFile(event.clipboardData.files, {
      allowedExtensions: FACTORY_ATTACHMENT_EXTENSIONS,
      allowedLabel: ' PDF、Word、Excel、CSV、文本或图片文件',
    });
    if (decision.kind === 'rejected') {
      setMessage('');
      setError(decision.message);
      return;
    }
    if (decision.kind === 'accepted') void upload(decision.file, decision.notice);
  }

  function remove(file: FactoryFile) {
    update({
      files: value.files.filter(item => item.id !== file.id),
      sourceFileIds: value.sourceFileIds.filter(id => id !== file.id),
    });
    setRemoveTarget(null);
    setMessage('附件已从本次报价中移除，原文件仍保留在统一文件库。');
  }

  function toggleFile(fileId: number) {
    setError('');
    const current = value.sourceFileIds;
    if (current.includes(fileId)) {
      update({ sourceFileIds: current.filter(id => id !== fileId) });
      return;
    }
    if (current.length >= 4) {
      setError('一次最多选择 4 个附件进行 AI 联合归纳。');
      return;
    }
    update({ sourceFileIds: [...current, fileId] });
  }

  async function runSummary(files: FactoryFile[]) {
    if (!files.length || busy) return;
    setSummarizing(true);
    setError('');
    setMessage('');
    try {
      const result = await generateQuotationInquirySummaryDraft({
        fileIds: files.map(file => file.id),
        customerName,
      });
      update({ summaryText: result.summaryText, sourceFileIds: result.sourceFileIds });
      setActiveTab('summary');
      setMessage(`Kimi 已直接读取原始附件并完成归纳，请核对后继续制作报价。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 归纳失败');
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPTED_FILE_TYPES} className="hidden" onChange={event => void upload(event.target.files?.[0])} />

      <section
        onPaste={handlePaste}
        tabIndex={0}
        aria-label="询价附件粘贴上传区域"
        className="flex min-h-14 flex-col gap-3 rounded-panel border border-sky-200 bg-sky-50 px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-sky-200 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-sky-700 shadow-sm"><Sparkles size={17} /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-sky-950">
              <span>询价助手</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-sky-800">附件 {value.files.length}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-sky-800">{summaryStatus}</span>
              {pending.length ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">待核对 {pending.length}</span> : null}
            </div>
            <div className="mt-0.5 truncate text-xs text-sky-800">上传或从 WPS、文件夹复制文件后在此按 Ctrl+V 粘贴，由 Kimi 读取并归纳。</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
          <Button type="button" size="sm" variant="secondary" disabled={busy} icon={uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} onClick={openFileChooser}>
            {uploading ? '处理中' : '上传'}
          </Button>
          <Button type="button" size="sm" variant="primary" icon={<PanelRightOpen size={14} />} onClick={() => onExpandedChange(true)}>
            {expanded ? '已展开' : '展开助手'}
          </Button>
        </div>
      </section>

      {expanded ? (
        <aside
          aria-label="询价助手"
          onPaste={handlePaste}
          tabIndex={0}
          className="fixed inset-0 z-40 flex flex-col bg-white shadow-2xl outline-none focus:ring-2 focus:ring-sky-200 lg:bottom-[76px] lg:left-auto lg:right-4 lg:top-[109px] lg:w-[480px] lg:border-l lg:border-line"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-ink"><FileSearch size={16} />询价助手</div>
              <div className="mt-1 text-xs text-muted">Kimi 直接读取原始附件；归纳结果不会修改成本或价格。</div>
            </div>
            <button type="button" aria-label="收起询价助手" onClick={() => onExpandedChange(false)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-muted hover:bg-slate-50 hover:text-ink"><X size={15} /></button>
          </div>

          <div className="grid grid-cols-3 border-b border-line bg-slate-50 px-2 pt-2" role="tablist" aria-label="询价助手内容">
            {([
              ['files', `原始附件 ${value.files.length}`],
              ['summary', 'AI 归纳'],
              ['pending', `待确认 ${pending.length}`],
            ] as Array<[InquiryTab, string]>).map(([tab, label]) => (
              <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`rounded-t-md border-b-2 px-2 py-2 text-xs font-medium transition-colors ${activeTab === tab ? 'border-sky-600 bg-white text-sky-800' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {error ? <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
            {message ? <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

            {activeTab === 'files' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">客户原始附件</div>
                    <div className="mt-1 text-xs text-muted">图片、Word、Excel、PDF、CSV、文本，单个不超过 10MB，最多 {MAX_ATTACHMENTS} 个；也可在此按 Ctrl+V 粘贴复制的文件。</div>
                  </div>
                  <Button type="button" size="sm" variant="secondary" disabled={busy} icon={uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} onClick={openFileChooser}>继续上传</Button>
                </div>
                {value.files.length ? value.files.map(file => {
                  const selected = selectedIds.has(file.id);
                  return (
                    <div key={file.id} className="rounded-md border border-line p-3">
                      <div className="flex items-center gap-3">
                        <button type="button" aria-pressed={selected} aria-label={`${selected ? '取消选择' : '选择'}${file.originalName}`} onClick={() => toggleFile(file.id)} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white'}`}>{selected ? <Check size={13} /> : null}</button>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">{fileIcon(file.detectedType)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-ink">{file.originalName}</div>
                          <div className="mt-0.5 text-xs text-muted">{fileTypeLabel(file)} · {fileSizeLabel(file.fileSize)}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <a href={file.downloadPath} target="_blank" rel="noreferrer" aria-label={`下载${file.originalName}`} className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-muted hover:bg-slate-50 hover:text-ink"><Download size={14} /></a>
                        <Button type="button" size="sm" variant="secondary" disabled={busy} icon={<Sparkles size={14} />} onClick={() => void runSummary([file])}>AI 归纳</Button>
                        <Button type="button" size="sm" variant="danger" className="h-8 w-8 px-0" disabled={busy} aria-label={`移除${file.originalName}`} icon={<Trash2 size={14} />} onClick={() => setRemoveTarget(file)} />
                      </div>
                    </div>
                  );
                }) : <div className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">尚未上传客户询价附件。</div>}
                <Button type="button" className="w-full" variant="primary" disabled={!selectedFiles.length || busy} icon={summarizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} onClick={() => void runSummary(selectedFiles)}>{summarizing ? '归纳中' : `汇总所选附件${selectedFiles.length ? `（${selectedFiles.length}）` : ''}`}</Button>
              </div>
            ) : null}

            {activeTab === 'summary' ? (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-ink">客户要求摘要</div>
                  <div className="mt-1 text-xs leading-5 text-muted">人工核对后随报价保存；这里的内容不会自动写入产品、成本或价格。</div>
                </div>
                <textarea value={value.summaryText} onChange={event => update({ summaryText: event.target.value })} rows={18} placeholder="在“原始附件”中选择文件并让 AI 归纳，也可以手工填写客户要求。" className="w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink outline-none placeholder:text-muted focus:border-sky-400" />
                {selectedFiles.length ? <Button type="button" className="w-full" variant="secondary" disabled={busy} icon={summarizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} onClick={() => void runSummary(selectedFiles)}>重新归纳所选附件</Button> : null}
              </div>
            ) : null}

            {activeTab === 'pending' ? (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-ink"><CircleAlert size={16} />待人工确认</div>
                  <div className="mt-1 text-xs leading-5 text-muted">从摘要中提取“未提供、不确定、冲突、待确认”等内容，报价前逐项核对。</div>
                </div>
                {pending.length ? (
                  <ol className="space-y-2">
                    {pending.map((item, index) => <li key={`${item}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900"><span className="mr-2 font-semibold">{index + 1}.</span>{item}</li>)}
                  </ol>
                ) : <div className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">摘要中暂未识别到待确认事项。</div>}
                <Button type="button" className="w-full" variant="secondary" onClick={() => setActiveTab('summary')}>返回摘要核对</Button>
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}

      <ConfirmDialog open={Boolean(removeTarget)} title="从本次报价移除附件？" description={removeTarget ? `“${removeTarget.originalName}”不会随新报价保存，但原文件仍保留在统一文件库。` : ''} confirmLabel="移除" confirmVariant="danger" busy={busy} onConfirm={() => removeTarget && remove(removeTarget)} onClose={() => !busy && setRemoveTarget(null)} layer="top" />
    </>
  );
}
