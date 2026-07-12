import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/app-shell';
import { AppErrorBoundary } from '@/components/app-error-boundary';

export const metadata: Metadata = {
  title: '水泵 BOM 管理助手',
  description: '统一管理订单、配方、库存、成本核算与转子出图',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AppErrorBoundary>
          <AppShell>{children}</AppShell>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
