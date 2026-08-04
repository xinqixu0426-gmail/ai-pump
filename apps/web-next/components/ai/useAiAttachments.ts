'use client';

import { useEffect, useRef, useState } from 'react';
import { getAiCapabilities, type AiAttachment, type AiCapabilities } from '@/lib/ai';
import { deleteFactoryFile, getFactoryFile, uploadFactoryFile } from '@/lib/files';

function storedFileAttachment(stored: Awaited<ReturnType<typeof getFactoryFile>>): AiAttachment {
  return {
    id: stored.id,
    originalName: stored.originalName,
    detectedType: stored.detectedType,
    mimeType: stored.mimeType,
    fileSize: stored.fileSize,
    downloadPath: stored.downloadPath,
    parserStatus: stored.parserStatus,
    parserSummary: stored.parserSummary,
  };
}

export function useAiAttachments(initialAttachmentId?: number) {
  const [aiCapabilities, setAiCapabilities] = useState<AiCapabilities | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<AiAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initialAttachmentAppliedRef = useRef<number | null>(null);
  const transientAttachmentIdsRef = useRef(new Set<number>());

  useEffect(() => {
    void getAiCapabilities()
      .then(setAiCapabilities)
      .catch((error) => setAttachmentError((error as Error).message || '读取模型能力失败'));
  }, []);

  useEffect(() => {
    if (!initialAttachmentId || initialAttachmentAppliedRef.current === initialAttachmentId) return;
    const previousInitialAttachmentId = initialAttachmentAppliedRef.current;
    initialAttachmentAppliedRef.current = initialAttachmentId;
    setUploadingAttachment(true);
    setAttachmentError('');
    void getFactoryFile(initialAttachmentId)
      .then((stored) => {
        const attachment = storedFileAttachment(stored);
        setPendingAttachments((current) => {
          const retained = previousInitialAttachmentId
            ? current.filter((item) => item.id !== previousInitialAttachmentId)
            : current;
          const merged = new Map([...retained, attachment].map((item) => [item.id, item]));
          return Array.from(merged.values()).slice(0, aiCapabilities?.maxAttachments || 4);
        });
      })
      .catch((error) => setAttachmentError((error as Error).message || '读取订单附件失败'))
      .finally(() => setUploadingAttachment(false));
  }, [aiCapabilities?.maxAttachments, initialAttachmentId]);

  async function selectAttachments(files: FileList | null) {
    if (!files?.length || uploadingAttachment) return;
    const maximum = aiCapabilities?.maxAttachments || 4;
    const selected = Array.from(files).slice(0, Math.max(0, maximum - pendingAttachments.length));
    if (selected.length === 0) {
      setAttachmentError(`每条消息最多上传 ${maximum} 个附件`);
      return;
    }
    setUploadingAttachment(true);
    setAttachmentError('');
    const uploaded: AiAttachment[] = [];
    try {
      for (const file of selected) {
        const stored = await uploadFactoryFile(file);
        transientAttachmentIdsRef.current.add(stored.id);
        uploaded.push(storedFileAttachment(stored));
      }
      setPendingAttachments((current) => {
        const merged = new Map([...current, ...uploaded].map((attachment) => [attachment.id, attachment]));
        return Array.from(merged.values()).slice(0, maximum);
      });
    } catch (error) {
      for (const attachment of uploaded) {
        transientAttachmentIdsRef.current.delete(attachment.id);
        void deleteFactoryFile(attachment.id).catch(() => {});
      }
      setAttachmentError((error as Error).message || '上传附件失败');
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function discardPendingAttachment(attachment: AiAttachment) {
    setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id));
    if (transientAttachmentIdsRef.current.delete(attachment.id)) {
      void deleteFactoryFile(attachment.id).catch(() => {
        // A deduplicated file may already be referenced by business data or another conversation.
      });
    }
  }

  function clearPendingAttachments() {
    setPendingAttachments([]);
    setAttachmentError('');
  }

  function restorePendingAttachments(attachments: AiAttachment[]) {
    setPendingAttachments(attachments);
  }

  function markAttachmentsPersisted(attachments: AiAttachment[]) {
    for (const attachment of attachments) transientAttachmentIdsRef.current.delete(attachment.id);
  }

  function discardAllPendingAttachments() {
    for (const attachment of pendingAttachments) {
      if (transientAttachmentIdsRef.current.delete(attachment.id)) {
        void deleteFactoryFile(attachment.id).catch(() => {});
      }
    }
    clearPendingAttachments();
  }

  return {
    aiCapabilities,
    pendingAttachments,
    uploadingAttachment,
    attachmentError,
    fileInputRef,
    selectAttachments,
    discardPendingAttachment,
    clearPendingAttachments,
    restorePendingAttachments,
    markAttachmentsPersisted,
    discardAllPendingAttachments,
  };
}
