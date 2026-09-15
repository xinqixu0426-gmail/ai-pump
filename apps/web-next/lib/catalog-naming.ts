import { proxyRequest, type ApiResponse } from './api';

export type CatalogNamingInput = { ruleId: string; spec: Record<string, string | number> };
export type SavedCatalogNaming = CatalogNamingInput & { ruleVersion: number };
export type CatalogNamingRule = {
  id: string;
  category: string | null;
  supportsPartCreate: boolean;
  fields: Array<{ key: string; label: string; type: 'text' | 'number' | 'choice'; optional?: boolean; maxLength?: number; unit?: string; values?: string[] }>;
};

export async function getCatalogNamingRules(): Promise<CatalogNamingRule[]> {
  const result = await proxyRequest<ApiResponse<{ rules: CatalogNamingRule[] }>>('/api/catalog/naming-rules');
  if (!result.success || !result.data) throw new Error(result.error || '命名规则加载失败');
  return result.data.rules;
}

export async function previewCatalogName(input: CatalogNamingInput): Promise<string> {
  const result = await proxyRequest<ApiResponse<{ name: string }>>('/api/catalog/name-preview', {
    method: 'POST', body: JSON.stringify(input),
  });
  if (!result.success || !result.data) throw new Error(result.error || '请补齐并检查命名规格');
  return result.data.name;
}
