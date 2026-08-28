'use client';

import { createIdempotencyKey, proxyRequest, type ApiResponse } from './api';

export type FactoryFile = {
  id: number;
  originalName: string;
  extension: string;
  detectedType: 'pdf' | 'spreadsheet' | 'image' | 'text';
  mimeType: string;
  fileSize: number;
  fileSha256: string;
  parserStatus: 'pending' | 'processing' | 'parsed' | 'metadata_only' | 'failed';
  sourceType: 'direct_upload' | 'knowledge_document' | 'recipe_technical_file';
  duplicateCount: number;
  metadata: Record<string, unknown>;
  parsedTextPreview: string;
  parserSummary: {
    version: string;
    parser: string;
    pageCount: number;
    parsedPageCount: number;
    sheetCount: number;
    parsedSheetCount: number;
    rowCount: number;
    scannedRowCount: number;
    cellCount: number;
    tableCount: number;
    formulaCount: number;
    truncated: boolean;
    requiresOcr: boolean;
    ocrApplied: boolean;
    confidence: number;
    needsReview: boolean;
    drawingCandidateCount: number;
  };
  parserError: string;
  parsedAt: string | null;
  downloadPath: string;
  createdAt: string;
  updatedAt: string;
};

export type FactoryFileArchiveTargetType =
  | 'customer'
  | 'quotation'
  | 'order'
  | 'recipe'
  | 'recipe_analysis_feedback'
  | 'ai_answer_feedback'
  | 'knowledge_document';

export type FactoryFileArchiveTarget = {
  id: number;
  targetType: FactoryFileArchiveTargetType;
  label: string;
  detail: string;
};

export type FactoryFileLink = {
  id: number;
  fileId: number;
  targetType: FactoryFileArchiveTargetType;
  targetId: number;
  relationRole: 'attachment' | 'customer_requirement' | 'execution_evidence' | 'technical_reference' | 'quotation_source' | 'quality_evidence' | 'knowledge_source';
  title: string;
  note: string;
  source: 'manual' | 'ai_chat' | 'business_page';
  createdAt: string;
  updatedAt: string;
  target: FactoryFileArchiveTarget | null;
  file?: Pick<FactoryFile, 'id' | 'originalName' | 'extension' | 'detectedType' | 'mimeType' | 'fileSize'>;
};

export type ArchiveFactoryFileInput = {
  targetType: FactoryFileArchiveTargetType;
  targetId?: number;
  relationRole?: FactoryFileLink['relationRole'];
  title?: string;
  note?: string;
  documentType?: 'technical_note' | 'pump_performance_test' | 'drawing' | 'spreadsheet' | 'other';
  tags?: string[];
  source?: 'manual' | 'ai_chat' | 'business_page';
};

export type ArchiveFactoryFileResult = {
  link: FactoryFileLink;
  knowledgeDocument: {
    id: number;
    title: string;
    documentType: string;
  } | null;
  deduplicated: boolean;
};

export type UploadBusinessAttachmentResult = {
  file: FactoryFile;
  link: FactoryFileLink;
  deduplicated: boolean;
  operationId: string;
  status?: string;
  operationStatus?: string;
  auditIds: number[];
};

export type ArchiveFactoryFilePreview = {
  capabilityId: 'files.archive';
  operationId: string;
  confirmationToken: string;
  inputHash: string;
  expiresAt: string;
  suggestedIdempotencyKey: string;
  previewHash: string;
  file: Pick<FactoryFile, 'id' | 'originalName' | 'parserStatus' | 'fileSha256' | 'updatedAt'>;
  target: Omit<FactoryFileArchiveTarget, 'id'> & { id: number | null };
  action: 'deduplicated' | 'restore_link' | 'create_link' | 'create_document_and_link';
  changes: Array<Record<string, unknown>>;
  warnings: Array<{ code: string; message: string }>;
};

function createFileCommandKey(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

const factoryFileVersions = new Map<number, string>();

function rememberFactoryFileVersion(file: FactoryFile) {
  if (file.updatedAt) factoryFileVersions.set(file.id, file.updatedAt);
  return file;
}

export async function uploadFactoryFile(file: File): Promise<FactoryFile> {
  const formData = new FormData();
  formData.append('file', file);
  const result = await proxyRequest<ApiResponse<FactoryFile>>('/api/files', {
    method: 'POST',
    headers: {
      'Idempotency-Key': createIdempotencyKey('file-upload'),
    },
    body: formData,
  });
  if (!result.success || !result.data) throw new Error(result.error || '上传文件失败');
  return rememberFactoryFileVersion(result.data);
}

function appendArchiveInput(formData: FormData, input: ArchiveFactoryFileInput) {
  formData.append('targetType', input.targetType);
  if (input.targetId) formData.append('targetId', String(input.targetId));
  if (input.relationRole) formData.append('relationRole', input.relationRole);
  if (input.title) formData.append('title', input.title);
  if (input.note) formData.append('note', input.note);
  if (input.source) formData.append('source', input.source);
}

export async function uploadBusinessAttachment(
  file: File,
  input: ArchiveFactoryFileInput
): Promise<UploadBusinessAttachmentResult> {
  const previewBody = new FormData();
  previewBody.append('file', file);
  appendArchiveInput(previewBody, input);
  const preview = await proxyRequest<ApiResponse<{
    confirmationToken: string;
    suggestedIdempotencyKey: string;
  }>>('/api/files/business-attachment-preview', {
    method: 'POST',
    body: previewBody,
  });
  if (!preview.success || !preview.data) {
    throw new Error(preview.error || '生成业务附件上传预览失败');
  }

  const commandBody = new FormData();
  commandBody.append('file', file);
  commandBody.append('confirmationToken', preview.data.confirmationToken);
  const result = await proxyRequest<ApiResponse<UploadBusinessAttachmentResult>>(
    '/api/files/business-attachment',
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': preview.data.suggestedIdempotencyKey,
      },
      body: commandBody,
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error || '上传并归档业务附件失败');
  }
  const status = result.data.status || result.data.operationStatus;
  if (status !== 'completed'
    || !result.data.operationId
    || result.data.auditIds.length === 0
    || !result.data.file?.id
    || !result.data.link?.id) {
    throw new Error('业务附件回执不完整，请刷新附件列表并检查业务变更记录');
  }
  rememberFactoryFileVersion(result.data.file);
  return result.data;
}

export async function getFactoryFile(id: number): Promise<FactoryFile> {
  const result = await proxyRequest<ApiResponse<FactoryFile>>(`/api/files/${id}`);
  if (!result.success || !result.data) throw new Error(result.error || '读取文件状态失败');
  return rememberFactoryFileVersion(result.data);
}

export async function deleteFactoryFile(id: number): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/files/${id}`, {
    method: 'DELETE',
    headers: {
      'Idempotency-Key': createIdempotencyKey(`file-delete:${id}`),
    },
    body: JSON.stringify({
      expectedUpdatedAt: factoryFileVersions.get(id) || null,
    }),
  });
  if (!result.success) throw new Error(result.error || '删除文件失败');
  factoryFileVersions.delete(id);
}

export async function searchFactoryFileArchiveTargets(
  targetType: Exclude<FactoryFileArchiveTargetType, 'knowledge_document'>,
  query = ''
): Promise<FactoryFileArchiveTarget[]> {
  const params = new URLSearchParams({ targetType });
  if (query.trim()) params.set('query', query.trim());
  const result = await proxyRequest<ApiResponse<FactoryFileArchiveTarget[]>>(
    `/api/files/archive-targets?${params.toString()}`
  );
  if (!result.success || !result.data) throw new Error(result.error || '读取归档目标失败');
  return result.data;
}

export async function listFactoryFileLinks(id: number): Promise<FactoryFileLink[]> {
  const result = await proxyRequest<ApiResponse<FactoryFileLink[]>>(`/api/files/${id}/links`);
  if (!result.success || !result.data) throw new Error(result.error || '读取文件归档记录失败');
  return result.data;
}

export async function listFactoryFileLinksForTarget(
  targetType: FactoryFileArchiveTargetType,
  targetId: number
): Promise<FactoryFileLink[]> {
  const params = new URLSearchParams({
    targetType,
    targetId: String(targetId),
  });
  const result = await proxyRequest<ApiResponse<FactoryFileLink[]>>(`/api/files/links?${params.toString()}`);
  if (!result.success || !result.data) throw new Error(result.error || '读取业务附件失败');
  return result.data;
}

export async function archiveFactoryFile(
  id: number,
  input: ArchiveFactoryFileInput
): Promise<ArchiveFactoryFileResult> {
  const preview = await proxyRequest<ApiResponse<ArchiveFactoryFilePreview>>(
    `/api/files/${id}/archive-preview`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  if (!preview.success || !preview.data) {
    throw new Error(preview.error || '归档文件预览失败');
  }
  const result = await proxyRequest<ApiResponse<ArchiveFactoryFileResult>>(`/api/files/${id}/archive`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': preview.data.suggestedIdempotencyKey,
    },
    body: JSON.stringify({
      confirmationToken: preview.data.confirmationToken,
    }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '归档文件失败');
  return result.data;
}

export async function deleteFactoryFileLink(
  fileId: number,
  linkId: number,
  expectedUpdatedAt?: string
): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/files/${fileId}/links/${linkId}`, {
    method: 'DELETE',
    headers: {
      'Idempotency-Key': createFileCommandKey(`file-link-delete:${linkId}`),
    },
    body: JSON.stringify({ expectedUpdatedAt }),
  });
  if (!result.success) throw new Error(result.error || '解除文件关联失败');
}
