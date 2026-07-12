import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/app-shell';
import { AppErrorBoundary } from '@/components/app-error-boundary';

export const metadata: Metadata = {
  title: '水泵订单及生产管理系统',
  description: 'Next.js 重构版前端壳',
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
