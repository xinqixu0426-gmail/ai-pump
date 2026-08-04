import type { CoilSpecOption } from '@/lib/recipes';

export type CoilSlotType = '小眼' | '国标眼';

export type CoilVariantSelection = {
  material: string;
  slotType: CoilSlotType;
  sheets: number[];
};

function normalizeCoilSlotType(value: string | undefined): CoilSlotType {
  return value === '国标眼' ? '国标眼' : '小眼';
}

export function resolveCoilVariantSelection(
  specOption: CoilSpecOption | undefined,
  preferredMaterial = '',
  preferredSlotType = ''
): CoilVariantSelection {
  const variants = specOption?.variants || [];
  const selectedVariant = variants.find((variant) => (
    variant.material === preferredMaterial && variant.slotType === preferredSlotType
  ))
    || variants.find((variant) => variant.material === preferredMaterial)
    || variants[0];

  if (selectedVariant) {
    return {
      material: selectedVariant.material,
      slotType: normalizeCoilSlotType(selectedVariant.slotType),
      sheets: selectedVariant.sheets || [],
    };
  }

  const material = preferredMaterial || specOption?.materials?.[0] || '钢带';
  const slotType = specOption?.slotTypes?.includes(preferredSlotType)
    ? preferredSlotType
    : specOption?.slotTypes?.[0] || preferredSlotType;
  return {
    material,
    slotType: normalizeCoilSlotType(slotType),
    sheets: [],
  };
}
