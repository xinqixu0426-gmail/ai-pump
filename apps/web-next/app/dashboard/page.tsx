import { DashboardView } from '@/components/dashboard-view';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  return <DashboardView initialMode={params.view === 'quality' ? 'quality' : 'overview'} />;
}
