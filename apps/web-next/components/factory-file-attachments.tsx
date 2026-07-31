'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Paperclip, Sparkles, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  archiveFactoryFile,
  deleteFactoryFileLink,
  listFactoryFileLinksForTarget,
  uploadFactoryFile,
  type FactoryFileArchiveTargetType,
  type FactoryFileLink,
} from '@/lib/files';

type FactoryFileAttachmentsProps = {
  targetType: FactoryFileArchiveTargetType;
  targetId: number;
  relationRole?: FactoryFileLink['relationRole'];
  title?: string;
  description?: string;
  embedded?: boolean;
  onAiSummarize?: (link: FactoryFileLink) => Promise<void>;
  onChanged?: () => void;
};

const ACCEPTED_FILE_TYPES = '.pdf,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp';

function fileSizeLabel(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileTypeLabel(type?: string) {
  if (type === 'spreadsheet') return '表格';
  if (type === 'image') return '图片';
  if (type === 'pdf') return 'PDF';
  return '文本';
}

function fileIcon(type?: string) {
  if (type === 'spreadsheet') return <FileSpreadsheet size={17} />;
  if (type === 'image') return <ImageIcon size={17} />;
  return <FileText size={17} />;
}

export function FactoryFileAttachments({
  targetType,
  targetId,
  relationRole,
  title = '附件',
  description = '支持 PDF、Excel、CSV、文本和图片，单个文件不超过 10MB。',
  embedded = false,
  onAiSummarize,
  onChanged,
}: FactoryFileAttachmentsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [links, setLinks] = useState<FactoryFileLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [summarizingFileId, setSummarizingFileId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const locked = busy || summarizingFileId !== null;

  async function load() {
    if (!targetId) {
      setLinks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await listFactoryFileLinksForTarget(targetType, targetId);
      setLinks(relationRole ? next.filter(link => link.relationRole === relationRole) : next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取附件失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [targetType, targetId, relationRole]);

  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const stored = await uploadFactoryFile(file);
      await archiveFactoryFile(stored.id, {
        targetType,
        targetId,
        relationRole,
        title: file.name,
        source: 'business_page',
      });
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传附件失败');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
      setBusy(false);
    }
  }

  async function unlink(link: FactoryFileLink) {
    if (busy || !window.confirm(`解除附件「${link.file?.originalName || link.title || link.fileId}」与当前业务记录的关联？原文件不会被删除。`)) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await deleteFactoryFileLink(link.fileId, link.id);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解除附件关联失败');
    } finally {
      setBusy(false);
    }
  }

  async function summarize(link: FactoryFileLink) {
    if (!onAiSummarize || locked) return;
    setSummarizingFileId(link.fileId);
    setError('');
    try {
      await onAiSummarize(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 归纳失败');
    } finally {
      setSummarizingFileId(null);
    }
  }

  return (
    <section className={embedded ? '' : 'overflow-hidden rounded-panel border border-line bg-white shadow-panel'}>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Paperclip size={16} />
            {title}
            {!loading && links.length > 0 ? <span className="text-xs font-normal text-muted">{links.length} 个</span> : null}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted">{description}</div>
        </div>
        <div className="shrink-0">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            className="hidden"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={locked || !targetId}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? '处理中' : '上传附件'}
          </Button>
        </div>
      </div>

      {error ? <div className="border-t border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="flex items-center gap-2 border-t border-line px-4 py-4 text-sm text-muted">
          <Loader2 size={15} className="animate-spin" />
          读取附件
        </div>
      ) : links.length === 0 ? (
        <div className="border-t border-line px-4 py-4 text-sm text-muted">暂无附件</div>
      ) : (
        <div className="divide-y divide-line border-t border-line">
          {links.map((link) => (
            <div key={link.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                {fileIcon(link.file?.detectedType)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{link.file?.originalName || link.title || `文件 #${link.fileId}`}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {fileTypeLabel(link.file?.detectedType)} · {fileSizeLabel(link.file?.fileSize || 0)}
                </div>
              </div>
              <a
                href={`/api/files/${link.fileId}/download`}
                target="_blank"
                rel="noreferrer"
                title="下载原文件"
                aria-label={`下载${link.file?.originalName || '附件'}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-muted transition-colors hover:bg-slate-50 hover:text-ink"
              >
                <Download size={14} />
              </a>
              {onAiSummarize ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={locked}
                  title="用 AI 原地归纳附件"
                  aria-label={`用 AI 归纳${link.file?.originalName || '附件'}`}
                  className="h-8 shrink-0"
                  icon={summarizingFileId === link.fileId
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Sparkles size={14} />}
                  onClick={() => void summarize(link)}
                >
                  {summarizingFileId === link.fileId ? '归纳中' : 'AI 归纳'}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="danger"
                className="h-8 w-8 shrink-0 px-0"
                disabled={locked}
                title="解除关联"
                aria-label={`解除${link.file?.originalName || '附件'}关联`}
                icon={<Trash2 size={14} />}
                onClick={() => void unlink(link)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
