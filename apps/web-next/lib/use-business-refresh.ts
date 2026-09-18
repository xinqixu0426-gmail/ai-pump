'use client';

import { useEffect, useRef } from 'react';
import { proxyRequest, type ApiResponse } from './api';
import { createRevisionRefresh } from './revision-refresh';

const monitor = createRevisionRefresh(async () => {
  const response = await proxyRequest<ApiResponse<{ revision: string }>>('/api/business-changes/revision', { signal: AbortSignal.timeout(5000) });
  if (!response.success || !response.data) throw new Error('变更版本读取失败');
  return response.data.revision;
});
let subscribers = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(delay = 1000) {
  clearTimeout(timer);
  if (!subscribers || document.visibilityState === 'hidden') return;
  timer = setTimeout(() => { void monitor.tick().finally(() => schedule()); }, delay);
}
function resume() {
  monitor.invalidate();
  schedule(0);
}

export function useBusinessRefresh(refresh: () => Promise<boolean | void>) {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; });
  useEffect(() => {
    const unsubscribe = monitor.subscribe(() => latest.current());
    subscribers += 1;
    if (subscribers === 1) {
      document.addEventListener('visibilitychange', resume);
      window.addEventListener('online', resume);
    }
    schedule(0);
    return () => {
      unsubscribe();
      subscribers -= 1;
      if (!subscribers) {
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', resume);
        window.removeEventListener('online', resume);
      }
    };
  }, []);
}
