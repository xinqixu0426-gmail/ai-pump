import { DashboardView } from '@/components/dashboard-view';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string; entry?: string }> }) {
  const params = await searchParams;
  const initialMode = params.view === 'quality' || params.view === 'knowledge' || params.view === 'readiness' || params.view === 'actions' ? params.view : 'overview';
  const initialKnowledgeEntryId = Number.parseInt(params.entry || '', 10);
  return <DashboardView initialMode={initialMode} initialKnowledgeEntryId={Number.isInteger(initialKnowledgeEntryId) && initialKnowledgeEntryId > 0 ? initialKnowledgeEntryId : null} />;
}
