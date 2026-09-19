import type { Recipe, SurfaceTreatmentMode } from '@/lib/recipes';

export type RecipeConfigurationPolicyField =
  | 'hasFloat'
  | 'floatWire'
  | 'floatAccessoryType'
  | 'hasCable'
  | 'cableLength'
  | 'cableWire'
  | 'cableAccessoryType'
  | 'coilSpec'
  | 'coilSheets'
  | 'coilMaterial'
  | 'coilSlotType'
  | 'customBarrelLength';

export type RecipeConfigurationPolicy = {
  version: 1;
  fields: Partial<Record<RecipeConfigurationPolicyField, Array<string | number | boolean>>>;
  packingPartIds?: number[];
  surfaceTreatmentOptions?: Array<{ mode: SurfaceTreatmentMode; cost: number }>;
};

export function parseConfigurationPolicy(value?: string | null): RecipeConfigurationPolicy | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<RecipeConfigurationPolicy>;
    if (parsed.version !== 1 || !parsed.fields || typeof parsed.fields !== 'object') return null;
    return {
      version: 1,
      fields: parsed.fields,
      ...(Array.isArray(parsed.packingPartIds) ? { packingPartIds: parsed.packingPartIds.map(Number).filter(Number.isInteger) } : {}),
      ...(Array.isArray(parsed.surfaceTreatmentOptions) ? { surfaceTreatmentOptions: parsed.surfaceTreatmentOptions } : {}),
    };
  } catch {
    return null;
  }
}

export function stringifyConfigurationPolicy(policy: RecipeConfigurationPolicy | null): string | null {
  return policy ? JSON.stringify(policy) : null;
}

export function configurationAllowedValues(
  recipe: Recipe | undefined,
  field: RecipeConfigurationPolicyField,
): Array<string | number | boolean> | null {
  const policy = parseConfigurationPolicy(recipe?.configurationPolicyJson);
  const values = policy?.fields?.[field];
  return Array.isArray(values) ? values : null;
}

export function configurationValueAllowed(
  recipe: Recipe | undefined,
  field: RecipeConfigurationPolicyField,
  value: string | number | boolean,
  baseline: string | number | boolean,
): boolean {
  if (String(value) === String(baseline)) return true;
  const allowed = configurationAllowedValues(recipe, field);
  if (!allowed) return true;
  return allowed.some(candidate => String(candidate) === String(value));
}

export function recipePackingPartIds(recipe?: Recipe): number[] | null {
  const policy = parseConfigurationPolicy(recipe?.configurationPolicyJson);
  return policy && Object.prototype.hasOwnProperty.call(policy, 'packingPartIds')
    ? policy.packingPartIds || []
    : null;
}

export function recipeSurfaceTreatmentOptions(recipe?: Recipe) {
  const policy = parseConfigurationPolicy(recipe?.configurationPolicyJson);
  return policy && Object.prototype.hasOwnProperty.call(policy, 'surfaceTreatmentOptions')
    ? policy.surfaceTreatmentOptions || []
    : null;
}
