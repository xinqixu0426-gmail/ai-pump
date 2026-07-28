'use client';

export type AiPageContext = {
  resourceType: 'order';
  resourceId: number;
  path: '/orders';
  view: 'readiness' | 'items' | 'purchase' | 'todos';
  label: string;
};

export const AI_PAGE_CONTEXT_EVENT = 'pump:ai-page-context';

const orderViewLabels: Record<AiPageContext['view'], string> = {
  readiness: '生产准备',
  items: '型号',
  purchase: '采购',
  todos: '待办',
};

export function readAiPageContext(url: string | URL): AiPageContext | null {
  const parsed = url instanceof URL ? url : new URL(url, 'http://localhost');
  if (parsed.pathname !== '/orders') return null;

  const resourceId = Number(parsed.searchParams.get('orderId'));
  if (!Number.isSafeInteger(resourceId) || resourceId <= 0) return null;

  const requestedView = parsed.searchParams.get('view');
  const view: AiPageContext['view'] = requestedView && Object.prototype.hasOwnProperty.call(orderViewLabels, requestedView)
    ? requestedView as AiPageContext['view']
    : 'items';

  return {
    resourceType: 'order',
    resourceId,
    path: '/orders',
    view,
    label: `订单 #${resourceId} · ${orderViewLabels[view]}`,
  };
}

export function readCurrentAiPageContext(): AiPageContext | null {
  if (typeof window === 'undefined') return null;
  return readAiPageContext(window.location.href);
}

export function replacePageLocation(url: string) {
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new Event(AI_PAGE_CONTEXT_EVENT));
}
