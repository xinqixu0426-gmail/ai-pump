export interface RotorHistoryRecord {
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
}

function text(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}

export function normalizeRotorHistoryRow(row: any): RotorHistoryRecord {
  return {
    id: Number(row?.id || 0),
    jobId: text(row?.jobId ?? row?.job_id),
    drawingName: text(row?.drawingName ?? row?.drawing_name),
    nlInput: text(row?.nlInput ?? row?.nl_input),
    paramsJson: text(row?.paramsJson ?? row?.params_json, '{}'),
    fcParamsJson: text(row?.fcParamsJson ?? row?.fc_params_json, '{}'),
    status: text(row?.status),
    fileUrl: text(row?.fileUrl ?? row?.file_url),
    error: text(row?.error),
    linkedPumpModel: text(row?.linkedPumpModel ?? row?.linked_pump_model),
    createdAt: text(row?.createdAt ?? row?.created_at),
    updatedAt: text(row?.updatedAt ?? row?.updated_at),
  };
}

export function normalizeRotorHistoryRows(rows: any[]): RotorHistoryRecord[] {
  return (Array.isArray(rows) ? rows : []).map(normalizeRotorHistoryRow);
}

export function parseRotorFcParams(row: Pick<RotorHistoryRecord, 'fcParamsJson'>): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.fcParamsJson || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
