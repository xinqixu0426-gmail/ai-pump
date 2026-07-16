import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/app-shell';
import { AppErrorBoundary } from '@/components/app-error-boundary';

export const metadata: Metadata = {
  title: '水泵 BOM 管理助手',
  description: '统一管理订单、配方、库存、成本核算与转子出图',
  manifest: '/manifest.json',
  applicationName: '水泵助手',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '水泵助手',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { url: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#071018',
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
