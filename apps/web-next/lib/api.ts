'use client';

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};

type ProxyOptions = {
  redirectOnUnauthorized?: boolean;
  throwOnError?: boolean;
};

function isFormData(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function resolveApiPath(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${process.env.NEXT_PUBLIC_API_BASE_URL || ''}${path}`;
}

export function createIdempotencyKey(prefix = 'web'): string {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}:${random}`;
}

export async function proxyFetch(
  path: string,
  options: RequestInit = {},
  proxyOptions: ProxyOptions = {}
): Promise<Response> {
  const { redirectOnUnauthorized = true, throwOnError = true } = proxyOptions;
  const headers = new Headers(options.headers);

  if (options.body && !isFormData(options.body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(resolveApiPath(path), {
    ...options,
    credentials: 'include',
    headers,
  });

  if (response.status === 401 && redirectOnUnauthorized && typeof window !== 'undefined') {
    window.location.href = '/login';
    throw new Error('未授权，跳转登录页');
  }

  if (throwOnError && !response.ok) {
    let serverError: string | undefined;
    try {
      const errData = await response.json();
      serverError = errData?.error || errData?.message;
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new Error(serverError || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response;
}

export async function proxyStreamFetch(
  path: string,
  options: RequestInit = {},
  proxyOptions: ProxyOptions = {}
): Promise<Response> {
  return proxyFetch(path, options, proxyOptions);
}

export async function proxyRequest<T>(
  path: string,
  options: RequestInit = {},
  proxyOptions: ProxyOptions = {}
): Promise<T> {
  const response = await proxyFetch(path, options, proxyOptions);
  if (response.status === 204) return undefined as T;
  return response.json();
}
