'use client';

import { useEffect, useState } from 'react';
import type { AiAttachment } from '@/lib/ai';
import {
  archiveFactoryFile,
  listFactoryFileLinks,
  searchFactoryFileArchiveTargets,
  type FactoryFileArchiveTarget,
  type FactoryFileArchiveTargetType,
  type FactoryFileLink,
} from '@/lib/files';
import {
  archiveTargetLabel,
  AttachmentArchiveDialog,
  defaultArchiveDocumentType,
  type ArchiveDocumentType,
} from '@/components/ai/AiWorkspaceDialogs';

export function AiAttachmentArchiveController({
  attachment,
  onClose,
}: {
  attachment: AiAttachment | null;
  onClose: () => void;
}) {
  const [targetType, setTargetType] = useState<FactoryFileArchiveTargetType>('knowledge_document');
  const [query, setQuery] = useState('');
  const [targets, setTargets] = useState<FactoryFileArchiveTarget[]>([]);
  const [targetId, setTargetId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [documentType, setDocumentType] = useState<ArchiveDocumentType>('other');
  const [links, setLinks] = useState<FactoryFileLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!attachment) return;
    let active = true;
    setTargetType('knowledge_document');
    setQuery('');
    setTargets([]);
    setTargetId('');
    setTitle(attachment.originalName.replace(/\.[^.]+$/, ''));
    setNote('');
    setTags('');
    setDocumentType(defaultArchiveDocumentType(attachment));
    setLinks([]);
    setError('');
    setSuccess('');
    setLoading(true);
    void listFactoryFileLinks(attachment.id)
      .then((rows) => {
        if (active) setLinks(rows);
      })
      .catch((loadError) => {
        if (active) setError((loadError as Error).message || '读取资料关联记录失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [attachment]);

  async function searchTargets() {
    if (targetType === 'knowledge_document') return;
    setSearching(true);
    setError('');
    setSuccess('');
    try {
      const rows = await searchFactoryFileArchiveTargets(targetType, query);
      setTargets(rows);
      setTargetId(rows.length === 1 ? String(rows[0].id) : '');
      if (rows.length === 0) setError('没有找到匹配的业务对象');
    } catch (searchError) {
      setTargets([]);
      setTargetId('');
      setError((searchError as Error).message || '查找资料关联对象失败');
    } finally {
      setSearching(false);
    }
  }

  async function saveArchive() {
    if (!attachment || saving) return;
    if (targetType !== 'knowledge_document' && !Number(targetId)) {
      setError('请先搜索并选择一个资料关联对象');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await archiveFactoryFile(attachment.id, {
        targetType,
        ...(targetType === 'knowledge_document' ? {} : { targetId: Number(targetId) }),
        title,
        note,
        documentType,
        tags: tags.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
        source: 'manual',
      });
      setSuccess(
        result.deduplicated
          ? `这个文件已经关联到 ${result.link.target?.label || archiveTargetLabel(targetType)}`
          : `已关联到 ${result.link.target?.label || archiveTargetLabel(targetType)}`
      );
      setLinks(await listFactoryFileLinks(attachment.id));
    } catch (saveError) {
      setError((saveError as Error).message || '关联文件失败');
    } finally {
      setSaving(false);
    }
  }

  if (!attachment) return null;
  return (
    <AttachmentArchiveDialog
      attachment={attachment}
      targetType={targetType}
      query={query}
      targets={targets}
      targetId={targetId}
      title={title}
      note={note}
      tags={tags}
      documentType={documentType}
      links={links}
      loading={loading}
      searching={searching}
      saving={saving}
      error={error}
      success={success}
      onTargetTypeChange={(value) => {
        setTargetType(value);
        setTargets([]);
        setTargetId('');
        setError('');
        setSuccess('');
      }}
      onQueryChange={setQuery}
      onTargetIdChange={setTargetId}
      onTitleChange={setTitle}
      onNoteChange={setNote}
      onTagsChange={setTags}
      onDocumentTypeChange={setDocumentType}
      onSearch={searchTargets}
      onSave={saveArchive}
      onClose={onClose}
    />
  );
}
