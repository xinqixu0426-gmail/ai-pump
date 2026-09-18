# ONT-P1 — Thin Ontology Contract V1

## Purpose and status

This is an isolated, versioned, deterministic, deeply immutable, read-only **code contract**. It describes entity identity, relation authority, evidence source addresses, and future reading requirements. It contains no business records, SQL, readers, adapters, traversal, or model calls. `OntologyVersion=1`; all `runtimeEnabled` values are `false`.

Implementation: `api/ontology/contract.cjs`, `sources.cjs`, `validator.cjs`. `validateOntology` validates an explicitly supplied contract and returns structural counts; it does not resolve entities or validate business results.

Start commit: `24106a1b41baa11a7a3e64e0fc78efa28121b271`.
Branch: `codex/ont-p1-thin-contract`, isolated worktree `C:\Users\Dan\Documents\pump-ont-p1`.
Original worktree: `master`, one user-owned untracked file `docs/ontology-preimplementation-audit.md`. Its exact UTF-8 contents were copied into this branch as the supplied P0 evidence; the original was not edited or staged. No existing tracked implementation was changed.

**Supervisor status: PASS after accepting the P0 scope corrections**, as explicitly supplied in the ONT-P2 task. Entity Count = 7; Relation Family Count = 6; Directional Relation Definition Count = 12. The original P1 return was REWORK pending that decision; the accepted scope is six families, not the original nine-family proposal. No runtime integration is authorized.

## Non-goals and source-of-truth boundary

- Ontology V1 is not a database.
- Ontology V1 is not a business source of truth.
- Ontology V1 does not infer business facts.
- Ontology V1 does not execute writes.

SQLite and formal Business APIs/services remain the authorities. This module neither replaces their schemas nor grants tool permissions. It does not restore historical V5. There is no route, AI tool, runtime path planning, relation persistence, fact ontology, graph database, RDF/OWL, traversal engine, or new dependency. Existing relation-specific AI code remains unchanged. The original large-list/context problem is **not fixed in P1**.

## Entity registry and identity sources

Every entry has `kind=BUSINESS_ENTITY`, `canonicalIdKind=DB_POSITIVE_INTEGER_PRIMARY_KEY`, `authoritative=true`, and a formal SQLite primary identity. These are definitions, not instances. Display/business keys cannot substitute for canonical identity.

| Type | Canonical ID | Display source | Business key | Formal truth | Resolver / stable identity support |
|---|---|---|---|---|---|
| customer | customers.id | customers.name | customers.name | SQLite:customers | existing V3 / V4 |
| order | orders.id | orders.contract_no | orders.contract_no | SQLite:orders | existing V3 / V4 |
| recipe | recipes.id | recipes.name | recipes.name | SQLite:recipes | existing V3 / V4 |
| part | parts.id | parts.model | model + supplier; not canonical | SQLite:parts | existing V3 / V4 |
| coil | coils.id | coils.scheme_name | coils.scheme_code | SQLite:coils | existing V3 / V4 |
| template | pump_shell_templates.id | pump_shell_templates.shell_model | shell_model | SQLite:pump_shell_templates | existing V3 / V4 |
| quotation | quotations.id | quotationQueries.get customerName/status | NOT_AVAILABLE | SQLite:quotations | NOT_SUPPORTED / FORMAL_DB_ID_ONLY |

Identity sources are grounded in `api/database/schema.cjs`. Existing six-type support is grounded in `aiCapabilityGraphV3.cjs:ENTITY_DESCRIPTORS` and `aiStableEntityIdentityV4.cjs:ENTITY_IDENTITY_SPECS`. These names declare current capabilities, not a new resolver or a guarantee that historical matching is canonical-only.

### Seventh entity audit

P0's readiness list had six READY types and quotation CONDITIONAL, while its V1 candidate list explicitly included quotation as seventh. `quotations.id` is a persisted primary key; `quotations.customer_id` is NOT NULL and has a real FK. `quotationQueries.get` obtains a formal quotation by positive ID and returns a structured not-found error. Therefore quotation satisfies this phase's six admission criteria and participates in `quotation.belongs_to_customer`.

The missing generic resolver does not remove quotation's canonical identity; the contract explicitly records this support gap. Entity count remains **7**, unchanged from P0's candidate count. No quotation resolver was implemented.

### Facts and excluded concepts

Inventory, price, stock, readiness, cost, purchase state, and requirement summary are facts/calculations/aggregates/snapshots, not V1 authoritative entities. A purchase row can refer to a part/coil, but P0 supplies no independently canonical purchase-item entity. Supplier is a string rather than a formal resource. No ID is generated from text, ordinal, model output, memory, history, or fuzzy candidates.

Stator variants and technical files do have persisted primary IDs; they are not being called non-entities. They are **outside this phase's specified seven-type registry** and require explicit scope reconciliation before their relations can be admitted.

## Relation authority and count reconciliation

Authority enum: `CANONICAL_DIRECT` (A), `DETERMINISTIC_DERIVED` (B), `LEGACY_EXACT` (C), `SEMANTIC` (D), `INFERRED` (E). Only A/B can occur in `ontology.relations`.

Counts distinguish **physical relation families** from directed definitions: six families = four A + two B; each has a forward and inverse entry, yielding 12 directed definitions = eight A + four B. Inverse entries do not create additional evidence sources or inflate P0's nine-family target.

| P0 candidate | Decision | Evidence / reason |
|---|---|---|
| recipe uses template, A | retain | recipes.template_id FK |
| recipe uses coil, A | retain | recipes.coil_id FK |
| order belongs to customer, A | retain canonical ID subset | orders.customer_id FK; no customer-name fallback |
| coil belongs to stator_variant, A | exclude from V1 | endpoint absent from specified seven-type registry |
| technical_file belongs to recipe, A | exclude from V1 | endpoint absent from specified seven-type registry |
| quotation belongs to customer, A | retain | quotations.customer_id FK |
| order contains recipe, B | retain explicit saved IDs | orders.items_json[].recipeId; orderCommands validates formal recipe |
| recipe contains part, B | retain explicit saved IDs | recipes.parts_json[].partId; bomPartIdentity canonical reference branch |
| purchase item refers to part/coil, B | exclude from V1 | purchaseStockIdentity supports IDs, but source endpoint is an aggregate/value object; no canonical purchase-item entity |

Thus the recommended family count is corrected from **9 to 6**, A **6 to 4**, B **3 to 2**. No replacement relation is invented. Expanding to stator_variant/technical_file or projecting purchase membership onto order would change scope and semantics and must be reviewed separately.

## Relation registry, cardinality, and inverse relations

Naming: `<fromType>.<lower_snake_case_verb>_<toType>`. This makes source/destination types readable while keeping stable machine IDs. Historical relationRead IDs remain untouched and are explicitly mapped.

Cardinality is the number of distinct target identities per source identity within the described membership scope, not BOM quantity or snapshot line count. `ONE` for quotation/customer reflects a non-null FK; inactive/missing targets still produce unavailable resolution rather than a fabricated object. `ZERO_OR_ONE` allows nullable direct FKs.

| Forward ID | Inverse ID | Forward / inverse cardinality | Authority |
|---|---|---|---|
| recipe.uses_template | template.used_by_recipe | ZERO_OR_ONE / MANY | A |
| recipe.uses_coil | coil.used_by_recipe | ZERO_OR_ONE / MANY | A |
| order.belongs_to_customer | customer.has_order | ZERO_OR_ONE / MANY | A |
| quotation.belongs_to_customer | customer.has_quotation | ONE / MANY | A |
| order.contains_recipe | recipe.contained_in_order | MANY / MANY | B |
| recipe.contains_part | part.contained_in_recipe | MANY / MANY | B |

All six pairs are symmetric in inverse declaration, swap endpoints, share source/authority/temporal semantics, and use opposite directions. No relation lacks an inverse. An inverse declaration describes meaning; it is not an available inverse reader or permission to traverse.

## Relation source mapping and reading semantics

`sourceId` references immutable `RelationSources`; evidence addresses are code locations, not runtime imports. No source may be caller SQL, model text, semantic search, memory, assistant history, fuzzy candidates, or a first search result.

| Source ID | Physical source | Formal evidence | Future read strategy |
|---|---|---|---|
| recipe_template | recipes.template_id | schema.cjs | formal FK query required |
| recipe_coil | recipes.coil_id | schema.cjs | formal FK query required |
| order_customer | orders.customer_id | schema.cjs; relationReadService.cjs | canonical-only adapter required |
| quotation_customer | quotations.customer_id | schema.cjs; quotationQueries.cjs | formal FK query required |
| order_recipe | orders.items_json[].recipeId | schema.cjs; orderCommands.cjs | formal saved-ID query required |
| recipe_part | recipes.parts_json[].partId | schema.cjs; bomPartIdentity.cjs; relationReadService.cjs | canonical-only adapter required |

All relations require explicit canonical IDs for both endpoints, no name fallback, and a future formal read receipt with source, `asOf`, and unresolved references. Contract metadata has no business observation time or stored values.

Direct relations describe the current persisted FK, filtered to active endpoints. A null nullable FK means no edge; a dangling/inactive target is unresolved/unavailable. Missing legacy customer IDs cannot become authoritative absence or be resolved by guessing a name.

Derived relations describe saved membership, resolving only explicit IDs against formal target identity. Order membership does not assert that current recipe configuration/cost equals the saved order. Saved recipe BOM membership does not establish current price. Duplicate references count once as an edge, while quantities and line provenance remain business-reader responsibilities. Missing IDs, malformed sources, unresolved/deleted targets, and partial scans must be visible; they cannot yield a complete negative assertion.

`recipe_part` deliberately covers **parts_json only**, matching the audited source. It is not full expanded BOM membership: extra_parts_json, packing_parts_json, defaults, computed items, template components, and non-part roles are not silently included. A future reader must preserve this scope or introduce a reviewed separate contract/version.

## Transitional C relations

`transitionalCandidates` is a separate immutable array, not part of `relations`:

1. `legacy.model_variant_recipe_name`: P0's claimed name association was **not reproduced** in current code. `recipeQueries.getModelVariantDraft` copies a display name into a draft, while `rotorQueries` reads `recipe.model_variant_id` by ID; neither establishes the claimed name-matching relation. Retain only as P0 claim metadata (`P0_CLAIM_NOT_REPRODUCED`), not a verified source or executable candidate.
2. `legacy.bom_part_model`: legacy BOM model/supplier association, observed in `relationReadService.partFor` and `bomPartIdentity`'s ID-less branch.

Both have authority C, `authoritative=false`, `runtimeEnabled=false`. They contain only metadata, no endpoints with generated identities, no business values, and no reader. D/E are excluded entirely from V1 relations. Candidate metadata is not evidence of an actual link.

Consequently there are two retained P0 C candidate records, but only one current-code-verified C relation. This is an additional P0 audit correction requiring review, not permission to invent the missing source.

## Existing relationRead mapping

Ontology describes what relationships mean; Business Service / relationRead owns how real data may be obtained. No second implementation was copied, and no adapter was written in P1.

| Existing relationRead ID | Ontology ID | Disposition |
|---|---|---|
| customer.orders | customer.has_order | ADAPTER_REQUIRED: existing reader includes unique legacy name rows |
| order.customer | order.belongs_to_customer | ADAPTER_REQUIRED: existing reader permits name fallback |
| recipe.parts | recipe.contains_part | ADAPTER_REQUIRED: reader permits ID-less name resolution and checks saved model equality with ID |
| part.recipes | part.contained_in_recipe | ADAPTER_REQUIRED: reverse reader includes legacy model matching |
| order.lines | none | EXCLUDED: snapshot-local ordinals are not recipe IDs |
| parts.stock | none | EXCLUDED: collection/fact query |
| part.facts | none | EXCLUDED: stock/price facts, not another entity |

All seven are accounted for: four mapped, zero directly reusable as-is, four adapter-required, three excluded. Existing service can supply future bounded transaction infrastructure, but its mixed A/B/C semantics cannot be silently elevated to A/B. Tests compare mapping endpoints/coverage to the current reader contract without changing its behavior.

## Runtime boundary and validation rules

Production code does not import `api/ontology/`. `api.cjs` does not mount relationRead. AI tools, capability registration/routing, resolver, shortlist, runtime, API requests/responses, SQLite schema, and production data are untouched.

Validation is deterministic and fail-closed for this isolated **contract**, not a new AI admission gate:

- Exact version, object field whitelists, required static metadata, read-only flags, and non-business-truth flags.
- Unique supported entity types; exact canonical/source/display/support mapping; every entity participates in a relation.
- Unique relation IDs, valid different endpoints, A/B-only authority, exact source mapping, stable names and cardinality.
- Exact identity/no-fallback, freshness, provenance, and scoped completeness requirements.
- Symmetric inverses, opposite direction, same physical source, and complete family coverage.
- Separate C metadata, false runtime/authority flags, unique candidates, no D/E authoritative relation.
- Mapping uniqueness, valid endpoints, and explicit exclusion.
- Unknown fields, runtime records, stock/price values, writes, injected readers, and fabricated identities are rejected.

Counts are version-specific structural invariants. Semantic changes need explicit review and a version decision; this validator is not a general ontology editor.

## Known gaps and next-phase preconditions

1. Supervisor accepted the six-family correction before P2. Stator_variant, technical_file, and purchase-item endpoints remain excluded; their scope must not be silently restored.
2. Quotation has formal ID authority but lacks generic V3/V4 resolver support; adding that support is a separate reviewed change.
3. Canonical-only adapters must reuse business services, report legacy unresolved references, and preserve existing bounds and negative-evidence distinctions. They must not relabel old mixed-authority receipts.
4. Isolated canonical one-hop readers are described in [Ontology Relation Resolver V1](ontology-relation-resolver-v1.md). They are not available through an AI tool or HTTP API.
5. P0's proposed two-hop/50-entity bounds are future design constraints, not an implemented traversal engine or runtime promise.
6. Future rollout needs formal capability/schema/service/route tests and documentation under the current API SOP, pagination/token budgets, and evidence-backed end-to-end acceptance.
7. A future semantic aid must preserve cross-domain investigation; contract completeness must not become a universal problem classifier blocking otherwise valid existing tools.

## Verification

Deterministic suite: `tests/ontologyContract.test.cjs`. It checks counts, immutable metadata, real in-memory migrated schema PKs/FKs, quotation support, B source columns, inverse semantics, seven-reader mapping coverage, invalid authority/identity/write/runtime-value variants, and absence of production imports/exposure. Schema inspection and validation leave the test database serialization unchanged.

Run relationRead, identity, and relevant query/runtime regressions and full `npm test` before the final stage return. No real AI or production deployment is required to validate this runtime-inaccessible code contract; they would not demonstrate ontology runtime behavior in P1.

Final local results (2026-09-18):

- Ontology-only: **58/58 PASS**.
- Ontology + relationRead + stable entity/BOM/purchase identity + quotation queries: **101/101 PASS**.
- Existing technical/template/recipe-selection identity and AI assistant runtime: **88/88 PASS**.
- API contract governance: **26/26 PASS**.
- Complete `npm test`: **2204/2204 PASS**, no skips or failures.
- ESLint on all new CJS and `git diff --check`: PASS.

The first full/regression run failed because the fresh worktree lacked `apps/web-next/node_modules/typescript`. Existing root and Web dependencies were reused through local directory junctions, with no install or dependency/lockfile change; reruns passed. A later C-evidence metadata change added one rejection test and the final full suite above was rerun. Tests used temporary/in-memory databases, not production data. Build/deep-API/real-AI were not run because there is no Web/business-API/schema/runtime change and no publish request.

Original and copied P0 evidence SHA-256: `8930a71e60b28fb9238c34d31b0c813e56ef5b89ec1d72f6ccc05b8fbbb2151b`. The original remains the sole untracked file on master. The branch includes the supplied audit verbatim so this contract's evidence baseline is reviewable without relying on the original dirty worktree.
