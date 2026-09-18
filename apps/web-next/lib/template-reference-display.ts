import type { Part } from './parts';

type TemplateReference = { partId?: number; model?: string; supplier?: string };

export function templateReferenceDisplay(reference: TemplateReference, parts: Part[], category?: string) {
  const savedName = reference.model || '-';
  if (reference.partId == null) return { name: savedName, issue: null, part: undefined };
  if (!Number.isSafeInteger(reference.partId) || reference.partId <= 0) {
    return { name: savedName, issue: '零件引用无效，待核对', part: undefined };
  }
  const part = parts.find(item => item.id === reference.partId);
  if (!part) return { name: savedName, issue: '零件不存在或已停用，待核对', part: undefined };
  if (category && part.category !== category) return { name: savedName, issue: '引用分类不一致，待核对', part: undefined };
  if (reference.supplier?.trim() && reference.supplier.trim() !== part.supplier.trim()) {
    return { name: savedName, issue: '引用供应商不一致，待核对', part: undefined };
  }
  return { name: part.model, issue: null, part };
}
