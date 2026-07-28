import { OrdersView } from '@/components/orders-view';

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const orderId = Number(Array.isArray(params.orderId) ? params.orderId[0] : params.orderId);
  const initialOrderId = Number.isInteger(orderId) && orderId > 0 ? orderId : null;
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  const initialDetailTab = ['readiness', 'items', 'purchase', 'todos'].includes(String(view))
    ? view as 'readiness' | 'items' | 'purchase' | 'todos'
    : 'items';

  return <OrdersView initialOrderId={initialOrderId} initialDetailTab={initialDetailTab} />;
}
