export const partSettingFields = [
  'standardCableAccessoryName',
  'standardCableAccessoryFee',
  'xinjieCableAccessoryName',
  'xinjieCableAccessoryFee',
  'floatAccessoryDelta',
] as const;

export type PartSettingField = (typeof partSettingFields)[number];

export function mergeUntouchedPartSettings<T extends Record<PartSettingField, string>>(
  current: T,
  touched: ReadonlySet<PartSettingField>,
  loaded: Partial<Record<PartSettingField, string>>
): T {
  let changed = false;
  const next = { ...current };

  for (const field of partSettingFields) {
    const loadedValue = loaded[field];
    if (loadedValue === undefined || touched.has(field) || current[field] !== '') continue;
    next[field] = loadedValue;
    changed = true;
  }

  return changed ? next : current;
}
