'use client';

import { proxyRequest } from '@/lib/api';

export type AiProvider = 'deepseek' | 'kimi';

export type RuntimeSettingsValues = {
  aiProvider: AiProvider;
  deepseekModel: string;
  deepseekBaseUrl: string;
  kimiModel: string;
  kimiBaseUrl: string;
  aiVisionEnabled: boolean;
  knowledgeAutoSyncEnabled: boolean;
  knowledgeVectorEnabled: boolean;
  knowledgeVectorAutoSyncEnabled: boolean;
  knowledgeHybridSearchEnabled: boolean;
  knowledgeVectorBatchSize: number;
  knowledgeEmbeddingModel: string;
  knowledgeEmbeddingDimensions: number;
  knowledgeEmbeddingDtype: 'q8' | 'fp16' | 'fp32';
  knowledgeModelCacheDir: string;
  knowledgeModelOffline: boolean;
};

export type RuntimeSecretStatus = {
  configured: boolean;
  source: 'runtime' | 'environment' | 'none' | 'invalid';
  error?: string;
};

export type RuntimeDeploymentStatus = {
  key: string;
  label: string;
  configured: boolean;
  value?: string;
};

export type RuntimeConfigSnapshot = {
  values: RuntimeSettingsValues;
  sources: Record<string, 'runtime' | 'environment' | 'default' | 'none' | 'invalid'>;
  secrets: {
    deepseekApiKey: RuntimeSecretStatus;
    kimiApiKey: RuntimeSecretStatus;
  };
  deployment: RuntimeDeploymentStatus[];
  restartRequired: boolean;
  restartFields: string[];
  kimiCodingCompatible: false;
};

export type RuntimeSettingsInput = RuntimeSettingsValues & {
  deepseekApiKey?: string;
  kimiApiKey?: string;
};

type RuntimeResponse = {
  success: boolean;
  data: RuntimeConfigSnapshot;
  error?: string;
};

type AiTestResponse = {
  success: boolean;
  data: {
    provider: AiProvider;
    displayName: string;
    model: string;
    latencyMs: number;
  };
  error?: string;
};

export async function getRuntimeSettings(): Promise<RuntimeConfigSnapshot> {
  const response = await proxyRequest<RuntimeResponse>('/api/settings/runtime');
  return response.data;
}

export async function saveRuntimeSettings(input: RuntimeSettingsInput): Promise<RuntimeConfigSnapshot> {
  const response = await proxyRequest<RuntimeResponse>('/api/settings/runtime', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function testRuntimeAi(input: RuntimeSettingsInput): Promise<AiTestResponse['data']> {
  const response = await proxyRequest<AiTestResponse>('/api/settings/runtime/test-ai', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.data;
}
