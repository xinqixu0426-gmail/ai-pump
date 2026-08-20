export type PackingRole = 'container' | 'foam' | 'pearlCotton' | 'fixed'

export interface PackingPart {
  model?: string
  name?: string
  supplier?: string
  qty?: number
  notes?: string
  remark?: string
  subcategory?: string
  packagingMaterial?: string
  packingRole?: PackingRole
  snapshotPrice?: number
  price?: number
  [key: string]: unknown
}

export interface PackingOption extends PackingPart {
  model: string
  supplier: string
  packagingMaterial: string
  packingRole: PackingRole
  price: number
}

export function inferPackingMaterial(value: unknown): string
export function inferPackingSemantics(part?: PackingPart): {
  packagingMaterial: string
  packingRole: PackingRole
}
export function normalizePackingParts(value: unknown): PackingPart[]
export function resolvePackingPart(value: unknown, role: PackingRole, boxType?: unknown): PackingPart | undefined
export function findPackingOption<Option extends PackingOption>(options: Option[], packing?: PackingPart | null): Option | undefined
export function buildPackingOptionValues<Part extends PackingPart, Recipe extends { boxType?: unknown; packingPartsJson?: unknown }>(
  parts: Part[],
  recipes: Recipe[],
): PackingOption[]
export function updatePackingRoleValue<Overrides extends { boxType?: unknown; packingPartsJson?: unknown }>(
  overrides: Overrides,
  role: PackingRole,
  option?: PackingOption,
): Overrides & { boxType: string; packingPartsJson: string }
