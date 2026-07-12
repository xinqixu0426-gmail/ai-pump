'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Route error:', error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <section className="w-full max-w-xl rounded-panel border border-red-200 bg-white p-6 text-center shadow-panel">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-red-50 text-red-600">
          <AlertTriangle size={24} aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">页面加载失败</h1>
        <p className="mt-2 text-sm text-muted">路由渲染时出现异常，可以重试当前页面。</p>
        <div className="mt-4 rounded-md border border-line bg-slate-50 p-3 text-left font-mono text-sm text-red-700">
          {error.message || error.digest || 'Unknown route error'}
        </div>
        <div className="mt-5 flex justify-center">
          <Button variant="primary" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={reset}>
            重试
          </Button>
        </div>
      </section>
    </main>
  );
}
