'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { Download, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Paperclip, Sparkles, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  deleteFactoryFileLink,
  listFactoryFileLinksForTarget,
  uploadBusinessAttachment,
  type FactoryFileArchiveTargetType,
  type FactoryFileLink,
} from '@/lib/files';
import {
  FACTORY_ATTACHMENT_EXTENSIONS,
  selectClipboardFile,
} from '@/lib/clipboard-files';

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

const ACCEPTED_FILE_TYPES = FACTORY_ATTACHMENT_EXTENSIONS.join(',');

function fileSizeLabel(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileTypeLabel(type?: string, extension?: string) {
  if (extension === '.doc' || extension === '.docx') return 'Word';
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
  const [unlinkTarget, setUnlinkTarget] = useState<FactoryFileLink | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const locked = busy || summarizingFileId !== null;

  const load = useCallback(async () => {
    setMessage('');
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
  }, [relationRole, targetId, targetType]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file?: File, pasteNotice = '') {
    if (!file || locked || !targetId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await uploadBusinessAttachment(file, {
        targetType,
        targetId,
        relationRole,
        title: file.name,
        source: 'business_page',
      });
      await load();
      onChanged?.();
      setMessage(pasteNotice);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传附件失败');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
      setBusy(false);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    if (event.clipboardData.files.length === 0) return;
    event.preventDefault();
    if (!targetId) {
      setMessage('');
      setError('请先保存当前业务记录，再粘贴附件。');
      return;
    }
    if (locked) {
      setMessage('');
      setError('当前附件正在处理中，请完成后再粘贴。');
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

  async function unlink(link: FactoryFileLink) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await deleteFactoryFileLink(link.fileId, link.id, link.updatedAt);
      await load();
      onChanged?.();
      setUnlinkTarget(null);
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
    setMessage('');
    try {
      await onAiSummarize(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 归纳失败');
    } finally {
      setSummarizingFileId(null);
    }
  }

  return (
    <>
    <section
      onPaste={handlePaste}
      tabIndex={0}
      aria-label={`${title}粘贴上传区域`}
      className={`${embedded ? '' : 'overflow-hidden rounded-panel border border-line bg-white shadow-panel'} outline-none transition focus:ring-2 focus:ring-sky-200`}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Paperclip size={16} />
            {title}
            {!loading && links.length > 0 ? <span className="text-xs font-normal text-muted">{links.length} 个</span> : null}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted">
            {description} 点击此区域后可按 Ctrl+V 粘贴单个文件。
          </div>
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
      {message ? <div className="border-t border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{message}</div> : null}

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
                  {fileTypeLabel(link.file?.detectedType, link.file?.extension)} · {fileSizeLabel(link.file?.fileSize || 0)}
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
                onClick={() => setUnlinkTarget(link)}
              />
            </div>
          ))}
        </div>
      )}
    </section>

    <ConfirmDialog
      open={Boolean(unlinkTarget)}
      title="解除附件关联？"
      description={unlinkTarget
        ? `附件“${unlinkTarget.file?.originalName || unlinkTarget.title || unlinkTarget.fileId}”将从当前业务记录中移除，但原文件仍会保留在文件库中。`
        : ''}
      confirmLabel="解除关联"
      confirmVariant="danger"
      busy={busy}
      onConfirm={() => unlinkTarget && void unlink(unlinkTarget)}
      onClose={() => {
        if (!busy) setUnlinkTarget(null);
      }}
      layer="top"
    />
    </>
  );
}
