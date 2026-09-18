# V5-E4R-E-B1-B Governed Entity Resolution

## 1. Executive Result

Status: **PARTIAL**. The approved governed Business API boundary, internal client wrapper, six-type registry, and type-independent resolver are implemented and verified read-only. The resolver preserved ambiguity correctly, but the frozen 15-path gate did not pass: 12 paths resolved to the authoritative type and three 800平刀 paths were cross-type ambiguous between `part` and `template`. `P15R_E_B2_READY=NO`.

## 2. Approved Architecture Boundary

The implemented path is exact source mention → `internalApiClient` → read-only Business API → minimal authoritative candidate set → V5 type-independent decision. V5 opens no SQLite connection and does not depend on AI Tool execution. V4 does not import or invoke the new resolver.

## 3. Entity Lookup API V1

`POST /api/entity-lookup` uses contract version 1. It is a POST query with a strict bounded body, mounted behind the existing `/api` authentication boundary. It requires neither `allowWrite` nor confirmation and does not create a command receipt, business audit row, transaction write, or backup.

## 4. Six-Type Authority Registry

The server allowlist and V5 registry contain exactly: `coil`, `customer`, `order`, `part`, `recipe`, and `template`. Registry entries are validated against Business Ontology IDs and identify the governed batch provider as read-only business authority.

## 5. Exact / Approved Alias Semantics

Exact lookup is equality-only over established business identity field classes and existing case collation. It does not strip punctuation or spaces and has no contains, prefix, fuzzy, edit-distance, semantic, top-score, or first-result fallback. No formal alias source currently exists for the six types, so approved-alias lookup contributes no candidates.

## 6. Minimal Candidate Contract

Candidates contain only `entityType`, `canonicalId`, and `matchKind`. The endpoint does not return business DTOs, display identities, prices, stock, contact data, order values, recipe contents, or related payloads. Multiple field matches deduplicate by `entityType + canonicalId`.

## 7. Completeness / Bounds

Limits are mention 160 code points, six entity types, ten candidates per type, and thirty candidates total. The endpoint declares `complete`; overflow produces `INCOMPLETE`. The resolver cannot declare `RESOLVED` from incomplete or malformed authority.

## 8. internalApiClient Read Boundary

`lookupEntities` performs one authenticated internal HTTP POST and returns only the lookup contract. Its trace projection stores status, completeness, and counts, never the mention or candidate identities. It is not exposed as an AI Tool.

## 9. Type-Independent Resolver

`resolveEntityTypeIndependent(rawMention)` requires no entity-type hint and sends all six registered types in one batch API call. It validates the complete response, candidate types and fields, deduplication, bounds, and consistency before applying the decision table.

## 10. Ambiguity / Error Handling

A single complete candidate resolves; zero complete candidates returns `NOT_FOUND`; multiple same-type or cross-type candidates return `AMBIGUOUS`. Incomplete results, API failures, invalid contracts, and timeout return `ERROR`. Technical failure is never converted to not-found.

## 11. Identity Preservation

The raw mention remains source-owned and character-for-character unchanged in runtime memory. Numeric-looking and punctuation-sensitive inputs pass through without coercion or correction. Canonical ID is a separate runtime-only field and exists only for a unique resolution.

## 12. Read-Only Safety

Evaluation counters recorded zero `allowWrite` calls, zero mutation service calls, zero writes, zero Tools, and zero interpreter model calls. The original business DB hash, mtime, size, and backup count remained unchanged. The temporary evaluation copy also had unchanged hash, mtime, size, and SQLite `total_changes`.

## 13. Deterministic Tests

Focused API and resolver tests passed 17/17. Coverage includes strict request validation, subset/six-type batches, exact-only near-match rejection, completeness, minimal candidates, route envelopes, one-call resolution, same/cross-type ambiguity, not-found, malformed/API/timeout failure, identity preservation, mutation-lifecycle exclusion, privacy-safe tracing, and ten-request isolation.

## 14. Frozen 15-Path Evaluation

All 15 applicable frozen paths were executed through the real in-process internal client and read-only Business API. Results: 12 correct unique resolutions, zero wrong type, three ambiguous, zero not-found, zero incomplete, zero resolver error, and zero false unique resolution. Accuracy was 12/15 (80%); four of five source groups resolved completely.

## 15. Coil

All three coil paths resolved as `coil`. The entity-filtered catalog contained two local Task Classes and retained the frozen expected class. Both read and cost remain legitimate local intents; this stage did not select between them.

## 16. 800平刀

All three paths returned complete cross-type ambiguity. The formal exact identity exists in both `part` and `template`, so selecting `part` by ordering, keywords, fuzzy score, or expected-answer knowledge would be an unsafe false unique resolution. No local Task Class set was asserted.

## 17. Exact Entity

All three exact-identity paths resolved as `recipe`; raw punctuation was unchanged, the lookup was complete, four recipe-compatible local classes remained, and the frozen expected class survived.

## 18. Local Task-Class Reduction

For the 12 uniquely resolved paths, every expected class survived deterministic entity-type filtering. Across all frozen paths, survival was 12/15 because the three ambiguous paths correctly did not create a local catalog. The resolved-path median local class count was 1 and the maximum was 4.

## 19. API / Resolver Performance

The full run made 25 logical resolutions: 15 frozen plus 10 concurrent synthetic requests. It made exactly 25 Business API calls, one per logical resolver, and 150 server typed attempts (six per call). Median/P95 API completion was 1.964/15.949 ms; resolver completion was 2.026/17.325 ms. Timeout count was zero. These measurements describe the local evaluation environment, not a production latency guarantee.

## 20. Concurrency

Ten concurrent synthetic batch resolutions produced independent results with zero cross-request contamination. No candidate, identity, or request correlation crossed calls.

## 21. Privacy

The safe dataset contains case IDs, source groups, types, statuses, counts, safe reason codes, and trace IDs only. Internal trace summaries omit mention and candidate IDs. Sentinel inspection found zero raw-mention, canonical-ID, canonical-identity, business-value, PII, or secret leakage.

## 22. Database Safety

The final evaluated business database hash, mtime, and size matched the baseline. Backup count was unchanged and no startup backup appeared. The harness created only a verified temporary DB copy outside the business DB and removed its isolated temporary directory after proving the lookup made no changes.

## 23. Regression

Focused deterministic tests passed 17/17, API contract verification passed 26/26, the combined V5 suite passed 217/217, and the production Web build passed. The full Shadow-OFF regression recorded 2003/2004 with only the frozen missing `.guardian/config.yaml` failure. Deep API verification did not pass: its pre-existing coil profile comparison reported `copperBase` drift between MCP and the formal API while the protected user V4/AI worktree was present. This phase did not modify the coil path or V4 AI business files, and did not absorb that unrelated work. No V4 AI business file was changed by this phase.

## 24. P15R-E-B2 Preconditions

The API and resolver infrastructure preconditions pass, including boundedness, read-only authority, ambiguity preservation, privacy, and one-call fanout. The frozen accuracy gate does not: three authoritative cross-type collisions prevent 15/15 unique entity resolution and 100% local-class survival. P15R-E-B2 must remain blocked until the Supervisor approves a general authoritative disambiguation mechanism; database repair, automatic aliases, fuzzy lookup, first-result selection, and identity-specific rules remain prohibited.
