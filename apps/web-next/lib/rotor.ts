import type { ApiResponse } from './api';
import { proxyRequest } from './api';

export type RotorFormData = {
  upperBearing: string;
  lowerBearing: string;
  pieceCount: string;
  rotorDia: string;
  bearingSpan: string;
  stackOffset: string;
  oilSealDia: string;
  impellerDia: string;
  impellerSpan: string;
  impellerDepth: string;
  threadLength: string;
  threadDia: string;
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
  upperBearing: '',
  lowerBearing: '',
  pieceCount: '',
  rotorDia: '',
  bearingSpan: '',
  stackOffset: '',
  oilSealDia: '',
  impellerDia: '',
  impellerSpan: '',
  impellerDepth: '',
  threadLength: '',
  threadDia: '',
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

type RotorParamPayload = {
  upper_bearing?: unknown;
  lower_bearing?: unknown;
  piece_count?: unknown;
  rotor_dia?: unknown;
  bearing_span?: unknown;
  stack_offset?: unknown;
  oil_seal_dia?: unknown;
  impeller_dia?: unknown;
  impeller_span?: unknown;
  bearing_to_impeller?: unknown;
  impeller_depth?: unknown;
  thread_length?: unknown;
  thread_dia?: unknown;
  drawingText?: unknown;
  drawing_text?: unknown;
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
  const payload = params as RotorParamPayload;
  return {
    upperBearing: text(payload.upper_bearing),
    lowerBearing: text(payload.lower_bearing),
    pieceCount: text(payload.piece_count),
    rotorDia: text(payload.rotor_dia),
    bearingSpan: text(payload.bearing_span),
    stackOffset: text(payload.stack_offset),
    oilSealDia: text(payload.oil_seal_dia),
    impellerDia: text(payload.impeller_dia),
    impellerSpan: text(payload.impeller_span ?? payload.bearing_to_impeller),
    impellerDepth: text(payload.impeller_depth),
    threadLength: text(payload.thread_length),
    threadDia: text(payload.thread_dia),
  };
}

function rotorPatchFromParams(params: Record<string, unknown>): Partial<RotorFormData> {
  const payload = params as RotorParamPayload;
  const patch: Partial<RotorFormData> = {};
  if ('upper_bearing' in payload) patch.upperBearing = text(payload.upper_bearing);
  if ('lower_bearing' in payload) patch.lowerBearing = text(payload.lower_bearing);
  if ('piece_count' in payload) patch.pieceCount = text(payload.piece_count);
  if ('rotor_dia' in payload) patch.rotorDia = text(payload.rotor_dia);
  if ('bearing_span' in payload) patch.bearingSpan = text(payload.bearing_span);
  if ('stack_offset' in payload) patch.stackOffset = text(payload.stack_offset);
  if ('oil_seal_dia' in payload) patch.oilSealDia = text(payload.oil_seal_dia);
  if ('impeller_dia' in payload) patch.impellerDia = text(payload.impeller_dia);
  if ('impeller_span' in payload || 'bearing_to_impeller' in payload) patch.impellerSpan = text(payload.impeller_span ?? payload.bearing_to_impeller);
  if ('impeller_depth' in payload) patch.impellerDepth = text(payload.impeller_depth);
  if ('thread_length' in payload) patch.threadLength = text(payload.thread_length);
  if ('thread_dia' in payload) patch.threadDia = text(payload.thread_dia);
  return patch;
}

function rotorPayload(form: RotorFormData, drawingName: string, drawingText: string) {
  return {
    upper_bearing: form.upperBearing,
    lower_bearing: form.lowerBearing,
    piece_count: form.pieceCount,
    rotor_dia: form.rotorDia,
    bearing_span: form.bearingSpan,
    stack_offset: form.stackOffset,
    oil_seal_dia: form.oilSealDia,
    impeller_dia: form.impellerDia,
    impeller_span: form.impellerSpan,
    impeller_depth: form.impellerDepth,
    thread_length: form.threadLength,
    thread_dia: form.threadDia,
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
  return { ...result.data, patch: rotorPatchFromParams(result.data.patch as Record<string, unknown>) };
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
