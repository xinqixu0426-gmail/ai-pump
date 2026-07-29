'use client';

import { proxyRequest, type ApiResponse } from './api';

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
  relationRole: 'attachment' | 'technical_reference' | 'quotation_source' | 'quality_evidence' | 'knowledge_source';
  title: string;
  note: string;
  source: 'manual' | 'ai_chat' | 'business_page';
  createdAt: string;
  updatedAt: string;
  target: FactoryFileArchiveTarget | null;
  file?: Pick<FactoryFile, 'id' | 'originalName' | 'detectedType' | 'mimeType' | 'fileSize'>;
};

export type ArchiveFactoryFileInput = {
  targetType: FactoryFileArchiveTargetType;
  targetId?: number;
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

export async function uploadFactoryFile(file: File): Promise<FactoryFile> {
  const formData = new FormData();
  formData.append('file', file);
  const result = await proxyRequest<ApiResponse<FactoryFile>>('/api/files', {
    method: 'POST',
    body: formData,
  });
  if (!result.success || !result.data) throw new Error(result.error || '上传文件失败');
  return result.data;
}

export async function getFactoryFile(id: number): Promise<FactoryFile> {
  const result = await proxyRequest<ApiResponse<FactoryFile>>(`/api/files/${id}`);
  if (!result.success || !result.data) throw new Error(result.error || '读取文件状态失败');
  return result.data;
}

export async function deleteFactoryFile(id: number): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/files/${id}`, {
    method: 'DELETE',
  });
  if (!result.success) throw new Error(result.error || '删除文件失败');
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
  const result = await proxyRequest<ApiResponse<ArchiveFactoryFileResult>>(`/api/files/${id}/archive`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '归档文件失败');
  return result.data;
}

export async function deleteFactoryFileLink(fileId: number, linkId: number): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/files/${fileId}/links/${linkId}`, {
    method: 'DELETE',
  });
  if (!result.success) throw new Error(result.error || '解除文件关联失败');
}
