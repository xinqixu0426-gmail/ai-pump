import { Suspense } from 'react';
import { QuotationsView } from '@/components/quotations-view';

export default function QuotationsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">报价单加载中...</div>}>
      <QuotationsView />
    </Suspense>
  );
}
