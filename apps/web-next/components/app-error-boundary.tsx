'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
  errorInfo: ErrorInfo | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught app error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    const { error, errorInfo } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
        <section className="w-full max-w-2xl rounded-panel border border-red-200 bg-white p-6 text-center shadow-panel">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-red-50 text-red-600">
            <AlertTriangle size={24} aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">页面出现异常</h1>
          <p className="mt-2 text-sm text-muted">
            当前页面遇到了运行时错误。请先重试；错误详情已输出到控制台，便于定位。
          </p>
          <div className="mt-4 max-h-72 overflow-auto rounded-md border border-line bg-slate-50 p-3 text-left">
            <div className="font-mono text-sm font-semibold text-red-700">{error.message}</div>
            {errorInfo?.componentStack ? (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted">{errorInfo.componentStack}</pre>
            ) : null}
          </div>
          <div className="mt-5 flex justify-center">
            <Button variant="primary" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => window.location.reload()}>
              重新加载
            </Button>
          </div>
        </section>
      </main>
    );
  }
}
