type EntityIdentity = {
  id?: number;
  Id?: number;
  createdAt?: string;
  CreatedAt?: string;
  updatedAt?: string;
  UpdatedAt?: string;
};

export function entityId(entity: EntityIdentity): number {
  return entity.id ?? entity.Id ?? 0;
}

export function entityCreatedAt(entity: EntityIdentity): string | undefined {
  return entity.createdAt ?? entity.CreatedAt;
}

export function entityUpdatedAt(entity: EntityIdentity): string | undefined {
  return entity.updatedAt ?? entity.UpdatedAt;
}
