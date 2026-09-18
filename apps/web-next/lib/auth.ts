'use client';

import { proxyFetch } from './api';

export async function loginWithPassword(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await proxyFetch(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      },
      { redirectOnUnauthorized: false, throwOnError: false }
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.success === false) {
      return { success: false, error: data?.error || data?.message || '登录失败' };
    }

    return { success: true };
  } catch {
    return { success: false, error: '网络连接失败，请检查后端服务' };
  }
}
