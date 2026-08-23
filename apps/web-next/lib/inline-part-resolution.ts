import type { Part, PartInput } from './parts';

type ResolveInlineCatalogPartInput = {
  input: PartInput;
  readParts: () => Promise<Part[]>;
  createPart: (input: PartInput) => Promise<Part>;
  beforeCreate?: () => Promise<void>;
};

export type InlineCatalogPartResolution = {
  part: Part;
  created: boolean;
  rows: Part[];
};

function normalizedIdentity(value: string): string {
  return value.trim().toLocaleLowerCase('zh-Hans-CN');
}

function reusablePartFromRows(
  rows: Part[],
  input: PartInput,
  model: string,
  supplier: string
): Part | null {
  const identityRows = rows.filter((part) => (
    normalizedIdentity(part.model) === normalizedIdentity(model)
    && normalizedIdentity(part.supplier) === normalizedIdentity(supplier)
  ));
  const categoryConflict = identityRows.find((part) => part.category !== input.category);
  if (categoryConflict) {
    throw new Error(`该型号和供应商已存在于“${categoryConflict.category}”分类，不能从当前表单静默改为“${input.category}”`);
  }
  const subcategoryConflict = input.category === '包装'
    ? identityRows.find((part) => (part.subcategory || '') !== (input.subcategory || ''))
    : undefined;
  if (subcategoryConflict) {
    throw new Error(`该包装型号和供应商已属于“${subcategoryConflict.subcategory || '未分类'}”，请使用现有分类或到零件库调整`);
  }
  return identityRows[0] || null;
}

export async function resolveInlineCatalogPart({
  input,
  readParts,
  createPart,
  beforeCreate,
}: ResolveInlineCatalogPartInput): Promise<InlineCatalogPartResolution> {
  const model = input.model.trim();
  const supplier = input.supplier.trim();
  const beforeRows = await readParts();
  const existing = reusablePartFromRows(beforeRows, input, model, supplier);
  if (existing) return { part: existing, created: false, rows: beforeRows };

  if (beforeCreate) await beforeCreate();
  let created: Part;
  try {
    created = await createPart({
      ...input,
      model,
      supplier,
      duplicatePolicy: 'reject',
    });
  } catch (createError) {
    let recoveryRows: Part[];
    try {
      recoveryRows = await readParts();
    } catch {
      throw createError;
    }
    const recovered = reusablePartFromRows(recoveryRows, input, model, supplier);
    if (recovered) return { part: recovered, created: false, rows: recoveryRows };
    throw createError;
  }
  const afterRows = await readParts();
  return {
    part: afterRows.find((part) => part.id === created.id) || created,
    created: true,
    rows: afterRows,
  };
}
