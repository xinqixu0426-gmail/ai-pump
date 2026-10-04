# D2-B1 — Operational Evidence Foundation

Run: `d2-b1-20261004`
Starting source: `d0bde8bb4a25139dcd9837344b09b28b16dd322c`
Model calls: `0`
Deployment: `none`

## Outcome

The Native read/preview path now has one structured operational evidence vocabulary for virtual readiness, order readiness, order detail, and purchase overview. The implementation copies only verified formal producer values. It neither recomputes shortages/readiness/procurement coverage nor introduces a fixed investigation route.

The API Index remains 31 discoverable capabilities with the unchanged fingerprint `734be7888b47f19baf76b5f55282d408e2416eec0b2924c3a91b90d197473f18`. No write capability, database schema, Business Understanding, Domain Policy, Ontology, or D1 final artifact changed.

## Formal response enrichment

Two additive, backward-compatible formal read contracts were enriched:

- `GET /api/orders/:id/readiness` shortage rows now return their already-used `partId` or `coilId` when formal identity exists, plus `collections.shortages` completeness metadata.
- `GET /api/orders/purchase-overview` tasks now preserve formal `partId`/`coilId`, `inventoryType`, and the existing readiness-ordering procurement stage where that identity is present.

`preview_virtual_readiness` now exposes formal completeness metadata for requirements, shortages, and unresolved requirements. `get_order_detail`’s AI read adapter adds result-scoped completeness metadata for order lines, purchase-list rows, and todos. Order-line recipe names remain snapshots; they are not upgraded to current recipe identities.

## Shared evidence behavior

The Ledger projects `readiness_status`, required/available/shortage quantities, purchase progress quantities, order status/line quantities, unresolved requirements, and collection completeness. Quantity facts use a result-scoped `requirementRef`, exact formal material binding internally, formal unit, producer/basis context, and explicit quantity role.

The model-facing catalog keeps canonical names and role/completeness context while suppressing numeric internal IDs. The validator rejects wrong material, wrong role, wrong unit, and complete-collection claims backed only by partial results. It permits an explicit no-shortage conclusion only from a complete formal READY result.

Supplier remains a formal string attribute. The Ledger intentionally does not decide whether a purchase plan covers a shortage; that would require a formal comparison producer in a later wave.

## Verification

- Focused D2 deterministic tests: 29 pass, 0 fail.
- `npm test`: 2318 pass, 0 fail.
- `npm run verify:api-contract`: 29 pass, 0 fail.
- `npm run test:deep-api`: 486 pass, 0 fail, canonical deterministic source, no local `pump.db`.
- `npm run lint`, `npm run build`, `npm run test:ai-architecture`, and `npm run verify:ai-assistant-release`: pass.

The first sandboxed full-test attempt could not bind local loopback ports. The required full suite was rerun under approved local test execution and passed; it did not deploy or access production.

## Scope boundaries

`DB_SCHEMA_CHANGED=NO`, `BUSINESS_DB_MUTATIONS=0`, `WRITE_CAPABILITY_CHANGED=NO`, and `MODEL_CALLS=0` for this phase. D2-B1 establishes deterministic structured evidence only. Fresh Owner-style Agent acceptance remains D2-B2 work.
