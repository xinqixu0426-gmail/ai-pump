import { proxyRequest, type ApiResponse } from './api';

export type QualitySeverity = 'danger' | 'warning' | 'info';

export type QualityIssueItem = {
  kind: string;
  id: string;
  title: string;
  desc: string;
  path: string;
  meta?: Record<string, unknown>;
};

export type QualityIssueGroup = {
  key: string;
  title: string;
  severity: QualitySeverity;
  count: number;
  suggestion: string;
  items: QualityIssueItem[];
};

export type DataQualitySummary = {
  generatedAt: string;
  score: number;
  totals: {
    parts: number;
    recipes: number;
    templates: number;
    variants: number;
    coils: number;
    customers: number;
    quotations: number;
    issueCount: number;
    dangerCount: number;
    warningCount: number;
  };
  issues: QualityIssueGroup[];
  topIssues: QualityIssueGroup[];
};

export type BusinessAlertSeverity = 'high' | 'medium' | 'low';
export type BusinessAlertScope = 'quotation' | 'order';

export type BusinessAlert = {
  severity: BusinessAlertSeverity;
  scope: BusinessAlertScope;
  entityId: string;
  title: string;
  detail: string;
  action: string;
  path: string;
};

export type BusinessAlertsSummary = {
  generatedAt: string;
  totals: {
    high: number;
    medium: number;
    low: number;
    all: number;
  };
  alerts: BusinessAlert[];
  topAlerts: BusinessAlert[];
};

export async function getDataQualitySummary(): Promise<DataQualitySummary> {
  const result = await proxyRequest<ApiResponse<DataQualitySummary>>('/api/quality/summary');
  if (!result.success || !result.data) throw new Error(result.error || '数据质量加载失败');
  return result.data;
}

export async function getBusinessAlerts(): Promise<BusinessAlertsSummary> {
  const result = await proxyRequest<ApiResponse<BusinessAlertsSummary>>('/api/quality/business-alerts');
  if (!result.success || !result.data) throw new Error(result.error || '经营异常提醒加载失败');
  return result.data;
}

export function qualitySeverityClassName(severity: QualitySeverity): string {
  if (severity === 'danger') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
}

export function businessAlertClassName(severity: BusinessAlertSeverity): string {
  if (severity === 'high') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'medium') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
}
