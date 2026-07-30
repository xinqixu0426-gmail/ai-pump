import { PartsView, type QuickFilter } from '@/components/parts-view';

const QUICK_FILTERS = new Set(['all', 'attention', 'out', 'low', 'normal', 'noSupplier', 'noPrice']);

export default async function PartsPage({
  searchParams,
}: {
  searchParams: Promise<{ stock?: string; query?: string }>;
}) {
  const params = await searchParams;
  const initialQuickFilter: QuickFilter = QUICK_FILTERS.has(params.stock || '')
    ? params.stock as QuickFilter
    : 'all';
  return <PartsView initialQuickFilter={initialQuickFilter} initialQuery={params.query || ''} />;
}
