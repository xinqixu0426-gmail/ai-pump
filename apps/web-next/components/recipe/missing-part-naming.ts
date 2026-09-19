import type { MissingPartCandidate } from './missing-part-candidates';
import type { Part, PartBatchCreateInput } from '@/lib/parts';
import type { CatalogNamingInput, CatalogNamingRule } from '@/lib/catalog-naming';

export type NamedMissingPartCandidate = MissingPartCandidate & { naming?: CatalogNamingInput };

export async function nameMissingPartCandidates(
  rows: MissingPartCandidate[],
  rules: CatalogNamingRule[],
  specs: Record<string, Record<string, string>>,
  generateName: (input: CatalogNamingInput) => Promise<string>
): Promise<NamedMissingPartCandidate[]> {
  const result: NamedMissingPartCandidate[] = [];
  for (const row of rows) {
    const rule = rules.find((item) => item.supportsPartCreate && item.category === row.category);
    if (!rule) { result.push({ ...row }); continue; }
    const spec = Object.fromEntries(Object.entries(specs[row.key] || {}).sort(([a], [b]) => a.localeCompare(b)));
    if (rule.fields.some((field) => !field.optional && !String(spec[field.key] ?? '').trim())) {
      throw new Error(`请补齐“${row.model}”的命名规格`);
    }
    const naming = { ruleId: rule.id, spec };
    const model = await generateName(naming);
    result.push({ ...row, model, naming, matchScope: 'exact-category' });
  }
  return result;
}

export function identityKey(candidate: MissingPartCandidate): string {
  return `${candidate.model.trim().toLocaleLowerCase()}\u0000${candidate.supplier.trim().toLocaleLowerCase()}`;
}

export function partIdentityKey(part: Part): string {
  return `${part.model.trim().toLocaleLowerCase()}\u0000${part.supplier.trim().toLocaleLowerCase()}`;
}

export function uniqueBatchInputs(candidates: NamedMissingPartCandidate[]): PartBatchCreateInput[] {
  const groups = new Map<string, NamedMissingPartCandidate>();
  for (const candidate of candidates) {
    const key = identityKey(candidate);
    const existing = groups.get(key);
    if (existing) {
      if (existing.category !== candidate.category || existing.subcategory !== candidate.subcategory) {
        throw new Error(`型号“${candidate.model}”和供应商“${candidate.supplier}”被分到多个分类，请分别调整供应商或使用单条建档`);
      }
      if (existing.catalogUnitCost !== candidate.catalogUnitCost || existing.stock !== candidate.stock) {
        throw new Error(`型号“${candidate.model}”和供应商“${candidate.supplier}”在多行使用了不同价格，请统一后再集中建档`);
      }
      if (JSON.stringify(existing.naming) !== JSON.stringify(candidate.naming)) {
        throw new Error(`型号“${candidate.model}”的命名规格不一致，请分别核对后再建档`);
      }
      continue;
    }
    groups.set(key, candidate);
  }
  return Array.from(groups.values()).map((candidate) => ({
    model: candidate.model.trim(),
    ...(candidate.naming ? { naming: candidate.naming } : {}),
    category: candidate.category,
    subcategory: candidate.subcategory || undefined,
    supplier: candidate.supplier.trim(),
    catalogUnitCost: candidate.catalogUnitCost,
    stock: candidate.stock,
    remark: `从${candidate.contextLabel}集中补齐零件`,
  }));
}

