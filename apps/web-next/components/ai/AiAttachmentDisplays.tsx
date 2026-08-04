'use client';

import Image from 'next/image';
import { Archive, FileText, Image as ImageIcon, X } from 'lucide-react';
import type { AiAttachment } from '@/lib/ai';
import { attachmentParserText, fileSizeText } from '@/components/ai/AiResultPrimitives';
import { Button } from '@/components/ui/button';

export function AiMessageAttachments({
  attachments,
  role,
  onArchive,
}: {
  attachments: AiAttachment[];
  role: 'user' | 'assistant';
  onArchive: (attachment: AiAttachment) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-2 grid gap-2 sm:grid-cols-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className={`min-w-0 overflow-hidden rounded-md border ${role === 'user' ? 'border-slate-200 bg-white text-ink md:border-white/20 md:bg-white/10 md:text-white' : 'border-line bg-slate-50'}`}
        >
          {attachment.detectedType === 'image' ? (
            <a href={attachment.downloadPath} target="_blank" rel="noreferrer" className="block">
              <Image
                src={`${attachment.downloadPath}?inline=1`}
                alt={attachment.originalName}
                width={960}
                height={640}
                unoptimized
                className="max-h-64 w-full bg-slate-100 object-contain"
              />
            </a>
          ) : null}
          <span className="flex min-w-0 items-center gap-1 px-1.5 py-1.5">
            <a href={attachment.downloadPath} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 hover:bg-black/5">
              {attachment.detectedType === 'image'
                ? <ImageIcon size={15} className="shrink-0" />
                : <FileText size={15} className="shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{attachment.originalName}</span>
                <span className={`mt-0.5 block text-[11px] ${role === 'user' ? 'text-muted md:text-slate-300' : 'text-muted'}`}>
                  {fileSizeText(attachment.fileSize)}
                </span>
              </span>
            </a>
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 w-8 px-0 ${role === 'user' ? 'md:text-slate-200 md:hover:bg-white/10 md:hover:text-white' : ''}`}
              icon={<Archive size={14} />}
              aria-label={`归档 ${attachment.originalName}`}
              title="归档到业务资料"
              onClick={() => onArchive(attachment)}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

export function AiPendingAttachmentStrip({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: AiAttachment[];
  disabled: boolean;
  onRemove: (attachment: AiAttachment) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
      {attachments.map((attachment) => (
        <div key={`pending-${attachment.id}`} className="relative w-32 shrink-0 overflow-hidden rounded-md border border-line bg-slate-50">
          {attachment.detectedType === 'image' ? (
            <Image
              src={`${attachment.downloadPath}?inline=1`}
              alt=""
              width={256}
              height={160}
              unoptimized
              className="h-20 w-full bg-slate-100 object-cover"
            />
          ) : (
            <span className="flex h-20 items-center justify-center text-slate-500"><FileText size={24} /></span>
          )}
          <div className="px-2 py-1.5 pr-7">
            <div className="truncate text-xs text-ink">{attachment.originalName}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted">{attachmentParserText(attachment)}</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1 h-7 w-7 bg-white/90 px-0 text-slate-600 shadow-sm"
            icon={<X size={14} />}
            aria-label={`移除 ${attachment.originalName}`}
            title="移除附件"
            onClick={() => onRemove(attachment)}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}
