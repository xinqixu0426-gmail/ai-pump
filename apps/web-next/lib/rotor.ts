import type { ApiResponse } from './api';
import { proxyRequest } from './api';

export type RotorFormData = {
  upper_bearing: string;
  lower_bearing: string;
  piece_count: string;
  rotor_dia: string;
  bearing_span: string;
  stack_offset: string;
  oil_seal_dia: string;
  impeller_dia: string;
  impeller_span: string;
  impeller_depth: string;
  thread_length: string;
  thread_dia: string;
};

export type RotorHistoryRecord = {
  id: number;
  jobId: string;
  drawingName: string;
  nlInput: string;
  paramsJson: string;
  fcParamsJson: string;
  status: string;
  fileUrl: string;
  error?: string;
  linkedPumpModel: string;
  createdAt?: string;
  updatedAt?: string;
};

export type RotorJobStatus = {
  status: 'processing' | 'success' | 'failed' | 'saved' | 'not_found';
  fileUrl?: string;
  drawingName?: string;
  error?: string;
  message?: string;
};

export type RotorDrawResult = {
  jobId: string;
  drawingName: string;
  params?: Record<string, unknown>;
  message?: string;
};

export type RotorTemplateDraft = {
  templateId: number;
  variantId: number | null;
  patch: Partial<RotorFormData>;
  hints: string[];
  meta: Record<string, unknown> | null;
  openOffset: number | null;
  barrelLength: number | null;
  drawingText: string;
};

export type RotorLinkTargetType = 'order' | 'variant' | 'recipe';

export type RotorLinkTarget = {
  type: RotorLinkTargetType;
  id: string;
  label: string;
  value: string;
  secondary: string;
};

export const bearingOptions = ['', '6201', '6202', '6203', '6204', '6205'];

export const emptyRotorForm: RotorFormData = {
  upper_bearing: '',
  lower_bearing: '',
  piece_count: '',
  rotor_dia: '',
  bearing_span: '',
  stack_offset: '',
  oil_seal_dia: '',
  impeller_dia: '',
  impeller_span: '',
  impeller_depth: '',
  thread_length: '',
  thread_dia: '',
};

type RotorHistoryRow = Partial<RotorHistoryRecord> & {
  job_id?: string;
  drawing_name?: string;
  nl_input?: string;
  params_json?: string;
  fc_params_json?: string;
  file_url?: string;
  linked_pump_model?: string;
  created_at?: string;
  updated_at?: string;
};

function text(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}

export function normalizeRotorHistoryRow(row: RotorHistoryRow): RotorHistoryRecord {
  return {
    id: Number(row.id || 0),
    jobId: text(row.jobId ?? row.job_id),
    drawingName: text(row.drawingName ?? row.drawing_name),
    nlInput: text(row.nlInput ?? row.nl_input),
    paramsJson: text(row.paramsJson ?? row.params_json, '{}'),
    fcParamsJson: text(row.fcParamsJson ?? row.fc_params_json, '{}'),
    status: text(row.status),
    fileUrl: text(row.fileUrl ?? row.file_url),
    error: text(row.error),
    linkedPumpModel: text(row.linkedPumpModel ?? row.linked_pump_model),
    createdAt: text(row.createdAt ?? row.created_at),
    updatedAt: text(row.updatedAt ?? row.updated_at),
  };
}

export function parseRotorParams(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function formFromRotorParams(params: Record<string, unknown>): RotorFormData {
  return {
    upper_bearing: text(params.upper_bearing),
    lower_bearing: text(params.lower_bearing),
    piece_count: text(params.piece_count),
    rotor_dia: text(params.rotor_dia),
    bearing_span: text(params.bearing_span),
    stack_offset: text(params.stack_offset),
    oil_seal_dia: text(params.oil_seal_dia),
    impeller_dia: text(params.impeller_dia),
    impeller_span: text(params.impeller_span ?? params.bearing_to_impeller),
    impeller_depth: text(params.impeller_depth),
    thread_length: text(params.thread_length),
    thread_dia: text(params.thread_dia),
  };
}

function rotorPayload(form: RotorFormData, drawingName: string, drawingText: string) {
  return {
    ...form,
    drawingName: drawingName.trim(),
    drawingText: drawingText.trim(),
  };
}

export async function getRotorHistory(): Promise<RotorHistoryRecord[]> {
  const result = await proxyRequest<ApiResponse<RotorHistoryRow[]> | RotorHistoryRow[]>('/api/rotor/history');
  const rows = Array.isArray(result) ? result : result.data || [];
  if (!Array.isArray(result) && !result.success) throw new Error(result.error || '出图历史加载失败');
  return rows.map(normalizeRotorHistoryRow);
}

export async function saveRotorParams(form: RotorFormData, drawingName: string, drawingText: string): Promise<RotorDrawResult> {
  const result = await proxyRequest<ApiResponse<RotorDrawResult> & RotorDrawResult>('/api/rotor/save', {
    method: 'POST',
    body: JSON.stringify(rotorPayload(form, drawingName, drawingText)),
  });
  if (!result.success && !result.jobId) throw new Error(result.error || result.message || '转子参数保存失败');
  return result.data || { jobId: result.jobId, drawingName: result.drawingName || drawingName };
}

export async function startRotorDraw(form: RotorFormData, drawingName: string, drawingText: string): Promise<RotorDrawResult> {
  const result = await proxyRequest<(ApiResponse<RotorDrawResult> & RotorDrawResult & { status?: string })>('/api/rotor/draw', {
    method: 'POST',
    body: JSON.stringify(rotorPayload(form, drawingName, drawingText)),
  });
  if (result.success && result.data) return result.data;
  if (result.status !== 'success' && !result.jobId) throw new Error(result.error || result.message || '出图任务启动失败');
  return { jobId: result.jobId, drawingName: result.drawingName || drawingName, params: result.params, message: result.message };
}

export async function getRotorJobStatus(jobId: string): Promise<RotorJobStatus> {
  const result = await proxyRequest<ApiResponse<RotorJobStatus> & RotorJobStatus>(`/api/rotor/status/${jobId}`, {}, { throwOnError: false });
  if (result.success && result.data) return result.data;
  return {
    status: result.status || 'not_found',
    fileUrl: result.fileUrl,
    drawingName: result.drawingName,
    error: result.error,
    message: result.message,
  };
}

export async function getRotorTemplateDraft(templateId: number, variantId?: number | null): Promise<RotorTemplateDraft> {
  const result = await proxyRequest<ApiResponse<RotorTemplateDraft>>('/api/rotor/template-draft', {
    method: 'POST',
    body: JSON.stringify({ templateId, variantId: variantId || undefined }),
  });
  if (!result.success || !result.data) throw new Error(result.error || '转子模板草稿生成失败');
  return result.data;
}

export async function printRotorDrawing(jobId: string): Promise<string> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/rotor/print/${jobId}`, {
    method: 'POST',
  });
  if (!result.success) throw new Error(result.error || result.message || '打印失败');
  return result.message || '打印指令已发送';
}

export async function deleteRotorHistory(id: number): Promise<void> {
  const result = await proxyRequest<ApiResponse<unknown>>(`/api/rotor/history/${id}`, {
    method: 'DELETE',
  });
  if (!result.success) throw new Error(result.error || '删除出图记录失败');
}

export async function getRotorLinkTargets(): Promise<RotorLinkTarget[]> {
  const result = await proxyRequest<ApiResponse<RotorLinkTarget[]> | RotorLinkTarget[]>('/api/rotor/link-targets');
  const rows = Array.isArray(result) ? result : result.data || [];
  if (!Array.isArray(result) && !result.success) throw new Error(result.error || '关联对象加载失败');
  return rows;
}

export async function linkRotorHistory(id: number, linkedPumpModel: string): Promise<void> {
  const result = await proxyRequest<ApiResponse<{ linkedPumpModel: string }>>(`/api/rotor/history/${id}/link`, {
    method: 'PATCH',
    body: JSON.stringify({ linkedPumpModel }),
  });
  if (!result.success) throw new Error(result.error || '关联出图记录失败');
}
