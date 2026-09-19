# V5-E4R-E-B1-A Authoritative Entity Read Boundary Audit

## 1. Executive Result

The audit selects `ADD_DEDICATED_READ_ONLY_ENTITY_LOOKUP_API`, using one bounded batch Business API query for the six currently authoritative entity types. Existing Business APIs prove the source of truth and stable identities, but they do not jointly provide a uniform, exact, bounded, ambiguity-preserving, minimal candidate contract. Reusing them directly would require six internal HTTP calls, mixed full-list/search behavior, business DTO overfetch, and client-side completeness assumptions.

The future boundary is a Business API, not an AI Tool. V5 direct SQLite access remains rejected. No production code, endpoint, client, resolver, model, Tool, database, or dependency changed in this audit.

## 2. Current Architecture Boundary

The established production path is `AI runtime → executor → internalApiClient → authenticated Business API → business query service → business data source`. `internalApiClient` injects the existing internal credential and can propagate operation/capability correlation, but it is a generic transport rather than an entity-specific lookup client.

The current V5 adapter accepts an exact mention plus an already known entity type and caller-supplied formal results. The V3 resolver acquires those results only after Tool selection. Therefore neither is the required pre-routing type-independent read boundary.

Direct service reuse from V5 would bypass the formal Business API boundary and couple V5 to database-shaped business services. It is rejected along with direct SQLite and Tool-mediated resolution.

## 3. Ontology / Resolver Coverage

The ontology defines 19 entity types:

- authoritative typed adapters: `coil`, `customer`, `order`, `part`, `recipe`, `template`;
- structural, non-lookup identities: `cost_context`, `factory`, `global`;
- no current V5 resolver adapter: `business_record`, `drawing`, `file`, `knowledge`, `pump_variant`, `purchase`, `quotation`, `stator_variant`, `technical_file`, `workflow`.

Ontology membership does not imply lookup support. Only the six typed adapters have both stable identity descriptors and an existing formal-result reducer.

## 4. Existing Business API Inventory

| Entity type | Existing read boundary | Actual lookup semantics | Stable identity | Candidate multiplicity | Bound |
| --- | --- | --- | --- | --- | --- |
| customer | `GET /api/customers` | name `contains`, case-insensitive; ID equality is separate | primary ID + business name | returns 0/1/N | optional limit; otherwise unbounded |
| order | `GET /api/orders/lookup` | exact ID/contract/customer first, otherwise `contains` | primary ID + contract number | returns 0/1/N | 20 rows, no truncation flag |
| recipe | `GET /api/recipes` | name/spec `contains`, case-insensitive | primary ID + name | returns 0/1/N | unbounded |
| part | `GET /api/parts` | model/category/subcategory/supplier `contains`, case-insensitive | primary ID + model | returns 0/1/N | optional limit; otherwise unbounded |
| coil | `GET /api/coils` | equality for structured fields; generic V3 mention discovery lists all; no scheme-name filter | primary ID + scheme code | returns 0/1/N | unbounded |
| template | `GET /api/templates` | shell model/description `contains`; executor rechecks exact shell model | primary ID + shell model | returns 0/1/N | optional limit; otherwise unbounded |

All six routes are mounted behind the common `/api` authentication boundary and call read-only query functions. Those functions read the formal business source and return Row Adapter DTOs. The audited GET paths do not call command services, `safeInsert`, `safeUpdate`, business audit writes, or backup creation.

The remaining ontology inventory is recorded in the safe dataset. Several types have read routes, but those routes are ID-only, list-only, derived, semantic-search, parent-scoped, or workflow/file-layer interfaces rather than authoritative exact mention lookup.

## 5. internalApiClient Coverage

`internalApiClient.cjs` exposes generic `getJson`/request helpers and injects `x-internal-secret`; it has no typed entity lookup methods. Existing AI query executors demonstrate calls to all six route families, so transport compatibility exists, but resolver-specific coverage is only `PARTIAL` for every type.

Adding six ad hoc calls in the V5 resolver would duplicate endpoint-specific matching and DTO interpretation. A future dedicated wrapper should call one formal lookup endpoint and preserve its status/completeness contract.

## 6. Six Authoritative Entity Types

The six chains are:

1. customer: `GET /api/customers → customerQueries.getAllCustomers → dbGetAllCustomers → customerRow`;
2. order: `GET /api/orders/lookup → orderQueries.lookupOrders → orders query → minimal lookup DTO`;
3. recipe: `GET /api/recipes → recipeQueries.getAllRecipes → dbGetAllRecipes plus technical-file count query → recipeRow`;
4. part: `GET /api/parts → listParts(dbGetAllParts) → partRow`;
5. coil: `GET /api/coils → coilQueries.getAllCoils → dbGetAllCoils → coilRow`;
6. template: `GET /api/templates → templateQueries.getAllTemplates → dbGetAllTemplates → templateRow`.

Each path supplies a stable primary key. The associated business identity classes are customer name, order contract/customer identity, recipe name/specification, part model, coil scheme code/name/specification composite, and template shell model.

## 7. Exact Lookup Semantics

Only the order lookup has explicit exact-first behavior for a general query. Customer, recipe, part, and template endpoints are search endpoints; exact matching currently occurs, where needed, after the response. Coil supports equality only when the caller already knows which structured field to populate, while the current generic entity discovery fetches its catalog without the mention.

Case-insensitive/NFKC comparisons and official alias mappings may be useful policies, but fuzzy or `contains` results cannot become a unique authoritative identity merely because one row was returned. The future contract must distinguish `EXACT`, approved `ALIAS`, and non-authoritative search candidates.

## 8. Ambiguity Safety

The six current APIs can return multiple rows and do not themselves select the first row. That preserves raw multiplicity when called without truncating limits. It does not prove a safe bounded resolver: optional limits and the order endpoint's fixed cap lack a completeness/truncation signal, so a one-row response under a bound cannot uniformly prove global uniqueness.

The dedicated API must return 0, 1, or N candidates and an explicit completeness flag. Hitting a candidate cap must never be interpreted as a unique result. Internal errors must remain errors, not `OK_ZERO`.

## 9. Canonical Identity

All six authoritative types return a stable database primary ID plus a canonical business identity field. These are sufficient for V5 internal deduplication when paired with `entityType`. Existing list DTOs, however, contain much more than resolution requires: customer contact data, part price/inventory, recipe BOM/cost/configuration, coil cost/inventory/technical data, and template configuration/cost fields.

The future candidate DTO should contain only `entityType`, `canonicalId`, `matchKind`, and the minimum canonical identity needed for exact/alias validation. Canonical IDs may cross the internal API boundary but must never enter traces, logs, evaluation datasets, or user-visible output.

## 10. Read-Only Proof

The audited routes are HTTP GET queries and invoke query/list services only. No `allowWrite`, confirmation, command transaction, business audit-row mutation, or backup call appears in their request path. The `/api` middleware accepts an authenticated user or the existing internal secret; a future V5 caller must use that mechanism without manufacturing user rights or reusing an admin write token.

Read-only authority does not mean anonymous authority. The dedicated route must be registered as a read capability, remain behind the same authentication boundary, and have no command receipt or write escalation path.

## 11. Existing API Reuse Option

`REUSE_EXISTING_READ_APIS` is rejected as the target architecture.

A complete cross-type attempt would require exactly six typed internal reads. The payload topology is mixed: order has a bounded minimal lookup, four types use contains-search DTOs, and coil can require its full catalog. Several routes have no default cap, and none exposes the common match/completeness semantics required by a cross-type authority boundary. The local HTTP topology keeps the network path internal, but six requests plus business DTO overfetch is classified `HIGH` serialization cost and `UNBOUNDED` overall.

The route services are formal authority, but their public response shapes are not a safe type-independent resolver contract.

## 12. Dedicated Entity Lookup API Option

Recommended logical contract:

```text
POST /api/entity-lookup
request:  { mention, entityTypes[], matchPolicy }
response: { status, complete, candidates[] }
candidate:{ entityType, canonicalId, matchKind, canonicalIdentity? }
```

Server limits proposed for the implementation phase:

- `MAX_ENTITY_TYPES_PER_REQUEST=6`;
- `MAX_CANDIDATES_PER_TYPE=10`;
- `MAX_TOTAL_CANDIDATES=30`.

`entityTypes` is validated against a server allowlist; it is never a table selector. `matchPolicy` initially permits `EXACT` and an already authoritative `ALIAS` path only. The API must reject `table`, `column`, SQL, where/order expressions, and raw filter objects.

Statuses are `OK_ZERO`, `OK_CANDIDATES`, `UNSUPPORTED_TYPE`, `INVALID_REQUEST`, and `INTERNAL_ERROR`. A cap hit sets `complete=false`; V5 must fail closed rather than infer uniqueness.

## 13. Batch vs Per-Type

`BATCH` is recommended. It keeps candidate acquisition inside one formal Business API transaction boundary, reduces six internal HTTP round trips to one, validates the six-type allowlist centrally, applies shared limits, and emits one coherent completeness/error contract. The service may internally dispatch to type-specific read providers; that does not create a second registry of business identity.

Per-type endpoints would mirror today's inconsistent semantics and leave cross-type completeness, timeout, and error aggregation in V5. There is no authority benefit that offsets that extra coupling.

## 14. Structural / Unsupported Types

`cost_context`, `factory`, and `global` are `NON_LOOKUP_STRUCTURAL`; they should not enter the lookup API.

The ten unsupported types are classified as follows:

- `NEEDS_FUTURE_BUSINESS_API`: quotation;
- `DERIVED_ENTITY`: purchase, business_record;
- `FILE_KNOWLEDGE_LAYER`: file, knowledge, drawing, technical_file;
- `WORKFLOW_LAYER`: workflow;
- `VARIANT_LAYER`: stator_variant, pump_variant.

They should not be fabricated into the six-type MVP. A future phase may add a type only after its canonical mention semantics, authoritative provider, ambiguity behavior, and minimal candidate DTO are independently approved.

## 15. Frozen Corpus Coverage

The frozen 15 paths use three expected entity types: `coil`, `recipe`, and `part`. All are inside the proposed six-type allowlist. Therefore the recommended boundary covers `15/15` frozen paths and `5/5` frozen source groups without expanding to unsupported ontology types.

This is contract coverage, not a live resolution result. No Business API was called in this audit.

## 16. Coil

Coil has an authoritative source and stable primary ID/scheme code. Existing `GET /api/coils` supports exact structured filters but lacks a general exact mention field for scheme name and can return the complete business-rich catalog. The dedicated provider must compare only approved identity fields and return minimal candidates.

The coil frozen group is covered by the six-type MVP.

## 17. 800平刀

The frozen expected entity type is `part`. `GET /api/parts` is a formal authoritative source with stable primary ID/model, but its keyword query is broad contains matching and returns price/inventory fields not needed for resolution. The dedicated part provider can reuse the formal business data authority while enforcing exact/alias candidate semantics and DTO minimization.

The three frozen part paths are covered. No literal business mention is stored in the audit dataset.

## 18. Exact Entity

The frozen Exact Entity group expects `recipe`, which is inside the MVP. Existing recipe search is authoritative but unbounded and returns the full recipe DTO. A dedicated recipe provider can perform exact/approved-alias candidate acquisition and expose only canonical identity metadata.

The group is covered at the read-contract level; no replay or resolution was performed.

## 19. Security / Privacy

`ENTITY_RESOLVER_VIA_AI_TOOL=REJECTED`: entity resolution precedes routing and cannot depend on Tool selection/execution. `V5_DIRECT_DB_ENTITY_RESOLUTION=REJECTED`: V5 must not bypass Business API authorization or create a second data-access layer.

Request mentions and candidate identities are necessary transient Business API data but must not be logged. Telemetry is limited to attempted-type count, per-type/total candidate count, completion/status, and duration. It must omit raw mention, canonical IDs, candidate values, customer data, business payloads, PII, and secrets.

## 20. Fanout / Boundedness

Existing-API reuse has minimum and maximum fanout of six reads for a complete six-type uniqueness decision. Parallelism does not fix payload/completeness problems. The dedicated batch API reduces network fanout to one while retaining deterministic internal type attempts and explicit bounds.

The proposed 6/10/30 limits bound type and candidate work. Any provider error or incomplete result prevents `RESOLVED`; it cannot be converted to not-found.

## 21. Recommended Read Architecture

Decision: `ADD_DEDICATED_READ_ONLY_ENTITY_LOOKUP_API` with `BATCH` shape and a six-type MVP.

This is preferred over hybrid reuse because the same cross-type request needs a single completeness and privacy contract. Although the order endpoint is closer to the desired semantics, splitting one type onto a legacy path would add special orchestration without reducing the dedicated API's required authority work.

No database schema migration, new dependency, new table, AI Tool, write API, or V4 behavior change is needed.

## 22. P15R-E-B1-B Change Budget

Maximum approved recommendation for a future implementation:

1. one Business API route/controller and a read-only entity lookup service using existing business data access inside the API layer;
2. one `internalApiClient` read wrapper;
3. V5 six-type resolution registry and type-independent resolver;
4. contract, ambiguity, limit, privacy, read-only, frozen-corpus, concurrency, and database-safety tests;
5. the existing API contract/reference/SOP documentation plus V5 governance documents and report.

Excluded: schema migration, new table, dependency, write API, Tool change, V4 behavior change, unsupported-type fabrication, and direct V5 database access.

## 23. Preconditions

`P15R_E_B1_B_READY=YES`.

The architecture, authority, authentication, candidate identity, ambiguity rule, bound, six-type MVP, frozen coverage, and change budget are explicit. The implementation phase must still prove zero writes, `15/15` frozen resolver accuracy, `5/5` source-group coverage, candidate completeness, privacy, and unchanged database state. This audit made zero model, Business API, Tool, and write calls.
