# ONT-P2 — Canonical Relation Resolver V1

## Responsibility and stage baseline

The resolver takes an already established canonical root identity and exactly one registered A/B relation definition. It reads the formal source inside one SQLite read transaction and returns canonical target identities. It does not resolve natural-language names, prove a caller's identity authorization, plan a path, traverse more than one hop, calculate facts, infer missing references, or perform writes.

Start Commit: `761f28a9f41847e2a4872538a010da78c0383e74`.
Branch: `codex/ont-p1-thin-contract`.
Worktree: `C:\Users\Dan\Documents\pump-ont-p1`; clean at start.
The original master worktree still has its user-owned untracked P0 audit, preserved unchanged. The P2 instruction explicitly records Supervisor acceptance of P1's corrected scope.

Counts are **Entity Count = 7**, **Relation Family Count = 6**, **Directional Relation Definition Count = 12**. No additional family, entity, or semantic relation is introduced. Ontology Version and Resolver Contract Version are both 1.

The validator summary uses `relationFamilyCount` and `directionalRelationDefinitionCount`; the earlier `directedRelationCount` label was clarified without adding an alias or changing any quantity.

Implementation:

- `api/ontology/resolverContract.cjs`: closed request/result validation and reused bounds.
- `api/ontology/resolver.cjs`: registry lookup, root validation, adapter selection, transaction, provenance, and error separation; no SQL.
- `api/services/relationReadService.cjs`: explicit internal `canonicalOnly=true` construction policy; existing callers default to `false` and retain their original outputs and semantics.
- `api/services/canonicalRelationQueries.cjs`: controlled DB-backed business read layer for the other families; only fixed SQL and no caller-supplied SQL/table/column/filter.

## Request contract

```js
const { createOntologyRelationResolver } = require('../api/ontology/resolver.cjs');
const resolver = createOntologyRelationResolver({ db: isolatedDatabase });
const result = resolver.resolveRelation({
    ontologyVersion: 1,
    relationId: 'recipe.contains_part',
    root: { entityType: 'recipe', canonicalId: '301' },
    pageSize: 20,             // optional, defaults to 20
    // afterId: '601',        // optional descending keyset boundary for MANY only
});
```

This example is an internal/test invocation, not an HTTP endpoint. Canonical IDs are decimal **strings** without whitespace, sign, leading zeros, fractions, exponent notation, or unsafe integer values. Numeric coercion and display names are rejected. Saved reference IDs remain strictly positive safe integer numbers in their current JSON contracts. Unknown properties, SQL, conversation/memory fields, custom source/authority, and hop/path requests are rejected before database access.

The registry supplies the relation and fixed target type. The root type must equal `fromType`; its ID must exist in the current formal source. Soft-deleted roots are unavailable as identities. Coils have no soft-delete column in the current schema; existence is checked directly, and removed coils are not found. A stale root never falls back to a name.

`afterId` is a keyset position, not a persistent session, authenticated token, graph cursor, or permission. Different pages are separate read transactions; they do not promise a single historical view across concurrent updates.

## Result contract

Successful results contain:

```text
version / ontologyVersion / success / status
relationId / root / resultEntityType
items[{entityType, canonicalId, display:{name}}]
authority / sourceOfTruth / provenance / asOf
complete / hasMore / pageSize / returnedCount / totalCount
pageBoundary:{afterId, nextAfterId}
warnings:[]
```

Items are distinct canonical identities in descending ID order. Display contains current formal labels, not saved snapshot names; quotation display uses its formal status label, with ID carrying identity. Prices, stock, quantities, costs, saved names, and full JSON records are not returned. Definitions and validated results are deeply frozen; no result is persisted in ontology.

`complete=true` means the source was fully validated within the declared relation scope and work bounds. `hasMore=true` still means this response is only one page. `totalCount` counts distinct target identities in that scope before the cursor, not JSON lines or quantity. A page exhausted by `afterId` is `RESOLVED` when that total is nonzero; it is not verified global absence.

Failures contain `version`, `ontologyVersion`, `success=false`, `status`, stable `code`, `complete=false`, `items=[]`, `hasMore=false`, and `warnings=[]`. Validated requests also retain `relationId/root`. Invalid input is not echoed. Failed reads return no partial authoritative items; they must not be interpreted as empty membership evidence. Technical errors are redacted rather than returning SQL, stack, credentials, or database details.

## Canonical-only boundary and adapter mapping

The ontology's existing `relationReadMapping` selects its four mapped readers. Other directions use the definition's `sourceId/direction` in the controlled business layer. Resolver code does not maintain a second relation-ID/type/authority table. SQL plans implement physical sources, while ontology remains the definition authority.

| Relation family | Directional definitions | Reader |
|---|---|---|
| recipe_template | recipe.uses_template / template.used_by_recipe | fixed canonical FK business reader |
| recipe_coil | recipe.uses_coil / coil.used_by_recipe | fixed canonical FK business reader |
| order_customer | order.belongs_to_customer / customer.has_order | existing relationRead, canonical-only adapter |
| quotation_customer | quotation.belongs_to_customer / customer.has_quotation | fixed canonical FK business reader |
| order_recipe | order.contains_recipe / recipe.contained_in_order | explicit saved recipeId business reader |
| recipe_part | recipe.contains_part / part.contained_in_recipe | existing relationRead, canonical-only adapter |

No canonical-only reader uses name search, fuzzy matching, supplier guessing, semantic retrieval, model text, memory, or first-result selection. Supplying an ID-shaped string from untrusted text does not itself prove canonical ownership; a future caller must first use the established identity/evidence boundary. P2 has no such external caller.

## relationRead reuse and compatibility

The existing service's default policy, seven request relation IDs, schemas, result semantics, legacy exact lookup, ambiguity checks, missing-reference audit, transaction, and route remain intact. No request property can switch its construction policy. No original relationRead tests were changed.

An opt-in internal construction policy is necessary: translating an old mixed A/B/C result alone cannot prove that its members came from canonical IDs. The canonical adapter reuses the same service's root lookup, typed item construction, transactions, reference iteration/deduplication, bounded scans, output validation, and pagination. It disables the legacy branches at the source:

- Customer/order uses only `customer_id`, never `customer_name` lookup. Missing IDs are incomplete.
- BOM uses only explicit `partId`, then reuses `resolveSavedCatalogPartIdentity` for current target identity and supplier consistency. A stale display model is not another identity key. ID-less exact legacy matches are not admitted.
- Non-part roles follow the existing formal identity helper and the established coil/rotor marker; they do not become part entities.
- Reverse BOM validates bounded active saved references before selecting explicit root-ID membership. It cannot silently skip unknown legacy membership.

Shared JSON reference validation and page finalization were extracted into `relationReadContract.parsedReferences/resultPage` and are reused by both paths. Bounds and failure distinctions are shared, not copied into another relation service. The new option adds stricter internal behavior; it does not rewrite existing callers' legacy semantics.

Excluded old relations remain excluded: `order.lines` has snapshot-local ordinals, `parts.stock` is a collection/fact query, and `part.facts` returns facts. None is relabeled as an ontology entity edge.

## Other controlled business readers

The existing quotation/recipe queries primarily expose hydrated detail/list/calculation contracts; they do not provide these bounded canonical inverse-FK or saved-membership reads as a reusable source contract. P2 therefore implements the missing reads in the controlled DB-backed business layer, using the existing formal columns as authority, without putting SQL in the resolver or exposing a SQL facility.

The fixed plans cover `recipes.template_id`, `recipes.coil_id`, `quotations.customer_id`, and `orders.items_json[].recipeId`. There is no duplicate cost, stock, ordering workflow, name resolver, or BOM formula. The saved-order reader uses the shared snapshot validator/bounds, deduplicates IDs, and resolves current target identity. Reverse order membership scans only bounded active orders and reports unknown/malformed membership instead of claiming absence. It does not use `order.lines` ordinals as recipe identity.

## Direct, inverse, and time semantics

All six pairs swap endpoints and share the P1 physical source/authority and current-vs-snapshot semantics. Tests follow populated forward memberships back through inverse pages; pagination does not imply that an arbitrary pair of current pages must contain the same entire set.

Direct A reads use current persisted FKs and formal endpoint existence. Nullable recipe/template or recipe/coil FKs can yield verified empty. A dangling/inactive target yields unavailable, not empty. Quotations require a non-null customer; consequently a valid quotation cannot have a successful empty customer relation. Order customer IDs missing from legacy rows are incomplete, not guessed or declared absent.

Derived B reads describe saved membership, not current recipe configuration, BOM pricing, or order-line values. `recipe_part` remains strictly **parts_json only**, excluding extra/packing/default/expanded BOM sources. The reader does not claim completeness for those other sources. Source membership references with no canonical ID or an unresolved target fail as incomplete; they are not migrated or repaired.

## Empty, not-found, incomplete, ambiguity, and technical semantics

| Status | Meaning |
|---|---|
| RESOLVED | Complete formal source read; distinct target total is nonzero, possibly exhausted on this page |
| VERIFIED_EMPTY | Root exists; complete formal source read establishes a zero target total |
| ROOT_NOT_FOUND | Root canonical ID absent or soft-deleted; no fallback |
| RELATION_UNAVAILABLE | Defined source cannot finish: invalid JSON, bounds exceeded, dangling direct FK, invalid source projection |
| REFERENCE_INCOMPLETE | Saved canonical target missing, malformed/missing reference ID, supplier consistency conflict, or unknown legacy membership |
| AMBIGUOUS_LEGACY_REFERENCE | A legacy ID-less source explicitly carries its existing `identityStatus=ambiguous`; never resolved through name guessing |
| TECHNICAL_FAILURE | Database/transport or output-contract failure; redacted and not negative evidence |
| INVALID_REQUEST | Closed-contract validation failed before business reading |

Unmarked ID-less references are incomplete, not labeled ambiguous merely because they have a name. Canonical IDs are not replaced by `identityStatus` text when present. Every failure has `complete=false`.

## Provenance

Every success carries the registered relation ID and A/B authority, `sourceId`, physical source mapping, actual source service, query ID, root identity, `asOf`, `canonicalOnly=true`, and the exact P1 `currentVsSnapshotSemantics`. The validator checks those values against ontology and the expected adapter, not arbitrary caller metadata.

Native service receipts are consumed internally; the ontology result does **not** claim that `/api/relations/read` was called or is reachable. `sourceService` is `relationReadService.read:CANONICAL_ONLY` or `canonicalRelationQueries.readSource`. A timestamp/query ID is trace provenance, not a cryptographic proof or a new AI execution-evidence receipt. Future runtime integration must still pass the formal evidence mechanism.

## Bounds

Reused bounds: default page size **20**, maximum page size / returned entities **50**, maximum serialized result **strictly less than 262144 bytes**, snapshot nested limit **50**, reverse saved-reference scan limit **512**. Sort is descending canonical ID. The caller cannot request an unbounded list, arbitrary predicate, or alternate source.

Reverse B reads conservatively validate a bounded source collection because ID-less membership cannot be filtered authoritatively by name. More than 512 source rows is unavailable rather than partial evidence. This may be stricter than future indexed readers; it is deliberate for isolated P2 and must be revisited with formal bounded membership APIs before broad rollout.

## Runtime-disabled boundary

Ontology and all relation definitions still have `runtimeEnabled=false`. Only explicit internal/test construction invokes the resolver. There is no import into production chat, provider, routing, shortlist, prompt, capability registry, AI/MCP tool catalog, or a mounted HTTP route. Existing relationRead route remains unmounted. No schema/table, production data, lockfile, dependency, write API, or existing business API contract changed.

## Known gaps and ONT-P3 preconditions

- Missing JSON IDs/targets are reported, not repaired; legacy ambiguous metadata is not newly inferred.
- Inverse customer/order reports incomplete if any active order lacks a customer ID, even if its display name suggests another customer. It avoids name-based negative assertions and may conservatively block unrelated roots.
- Reverse saved membership likewise reports unknown legacy rows; no silent known-ID-only total is presented as full authoritative membership.
- A failed mixed-reference read returns no partial items. Future partial results require a reviewed result/evidence contract.
- Quotation natural-language resolver, supplier entities, purchase identity, snapshot migrations, hard-code removal, semantic relations, and multi-hop are out of scope.
- No AI enhancement or context-bloat fix is deployed in P2. Before P3, review bounded/indexed source strategies, authorization and canonical root evidence, cancellation/time budgets, formal capability/API/evidence contracts, and whether/how runtime exposure is authorized.

## Verification

`tests/ontologyRelationResolver.test.cjs` covers all 12 directions, canonical roots/targets, six inverse pairs, provenance, empty/absence distinctions, deleted/removed roots, legacy incompleteness and ambiguity, stale names/supplier conflicts, deduplication/non-part roles, descending pages/cursor exhaustion, JSON/nested/scan failures, result validation, and technical-error redaction. Successful reads leave `total_changes()` and the serialized in-memory database unchanged; failure paths also verify no writes.

The pre-existing relationRead suite remains unchanged and is rerun alongside P1 contract/identity/runtime tests. P1's pure-contract import test is narrowed to its original three pure metadata modules so the newly authorized isolated resolver can depend on business readers; its no-production-import assertion remains enforced.

Final validation (2026-09-18): resolver tests **74/74**; focused resolver/contract/relationRead/identity/query/AI-runtime group **251/251**; complete `npm test` **2278/2278**; API governance **26/26**; isolated deep API **491/491**; changed CJS ESLint, syntax checks, and whitespace checks PASS.

Initial fixture verification found that coils do not have `deleted_at` and order fixtures require `customer_name`; queries/fixtures were corrected to match current schema rather than changing it. The first deep-API attempt could not find `pump.db` in the isolated worktree. The existing runner was then given the original local database as its **read-only backup source**; all mutations and HTTP acceptance ran on its temporary copy. No `.env` or credentials were copied. Full regression was rerun after final contract-validation changes. Web build and real AI were not run: this phase has no Web changes or runtime/model exposure, and no deployment was requested.
