import type { Part } from './parts';

type SelectionIdentity = { model?: string; supplier?: string; partId?: number };

// Quantity, pricing and notes do not select a different physical catalog item.
export function patchRecipeSelectionIdentity<T extends SelectionIdentity>(
  current: SelectionIdentity | undefined,
  patch: T,
  catalog: Part[],
  category?: string
): T {
  if (patch.model === undefined && patch.supplier === undefined) return patch;
  const model = String(patch.model ?? current?.model ?? '');
  const supplier = String(patch.supplier ?? current?.supplier ?? '').trim();
  const candidates = catalog.filter(part => (
    part.model === model
    && (category ? part.category === category : part.category !== '包装' && part.category !== '线圈转子')
    && (!supplier || part.supplier.trim() === supplier)
  ));
  return { ...patch, partId: candidates.length === 1 ? candidates[0].id : undefined };
}
