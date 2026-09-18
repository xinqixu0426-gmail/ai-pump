# V5-C Business Ontology + Entity Identity Boundary

## 1. Executive Result

V5-C adds an isolated 19-type Business Ontology V1, immutable identity contract, structural damage detector, read-only adapter over the existing V3 formal-result resolver, and P06 identity shadow evaluator. All 16 V5-B entity references resolve to ontology entries. Twenty-one focused tests pass. No V4 code, resolver behavior, database, Tool, capability grouping, or production import changed.

For the three P06 Exact Identity paths, the V5 contract preserves the frozen original mention in 3/3. The Legacy and V4 Investigation structural evidence exposes identity loss before resolver entry; V5 would reject those two mismatched boundaries (`PREVENTED=2`). V4+R3 already preserved identity and failed later for C02, so P10 correctly records `NOT_ADDRESSED=1` instead of claiming a fix.

## 2. Frozen Baseline

```text
P09_COMMIT=4d3995a2b0943906138f62213618a04fe100ea17
BRANCH=master
WORKTREE_CLEAN_AT_START=NO
CURRENT_REGRESSION_BASELINE=1820/1821
KNOWN_FAILURE=missing .guardian/config.yaml
```

All pre-existing user-owned V4/AI source, tests, documentation, package metadata, scripts, and output changes were preserved and excluded.

## 3. Scope / Non-Scope

Implemented only the code-level ontology, identity/provenance contract, input ownership guard, current resolver result adapter, structural loss detector, frozen P06/800 flat-blade shadow checks, tests, and documentation. No normalization, resolver, punctuation, alias, prompt, runtime, routing, Tool, executor, Business API, verifier, database, Oracle, Shadow, Guardian, Evidence, Policy, or production behavior was modified.

## 4. Existing Entity Inventory

The current formal V3 entity descriptors support six types: `customer`, `order`, `recipe`, `part`, `coil`, and `template`. Their lookup candidates carry DB IDs and selected business fields. Current V4 obtains the resolver mention from configured Tool argument fields.

The schema and formal services additionally ground quotation, purchase aggregate, factory/global scope, workflow, file, business change record, knowledge entry, rotor drawing, cost context, stator variant, pump variant, and recipe technical file concepts. Ontology V1 includes only these concrete current concepts; it does not fabricate product, supplier, generic BOM, rotor, or inventory-item records that lack an independent formal identity in current code.

## 5. Business Ontology V1

`V5_BUSINESS_ONTOLOGY_VERSION=1`. There are 19 immutable entity definitions and eight direct schema-backed relation declarations. Unknown version, duplicate type, missing source, invalid adapter, and invalid relation references are rejected deterministically.

## 6. Canonical Identity Sources

Persisted entities use database primary keys as canonical IDs. Stable business keys are recorded separately where current schema/code provides them. `purchase` is explicitly parent-scoped to an order; `factory` is a singleton scope. `global` and `cost_context` have no canonical ID and are explicitly `NOT_AVAILABLE`. Display names, normalized mentions, model labels, and conversation state are never canonical IDs.

## 7. Entity Identity Contract

The contract separately owns `rawMention`, `normalizedMention`, `canonicalEntityId`, `canonicalBusinessKey`, resolution status, match type, source, and resolver path. It preserves punctuation/case and rejects numeric coercion. Canonical identity requires trusted provenance; ambiguous/not-found/unresolved/invalid objects reject canonical fields. V5Task accepts and preserves the base identity reference without mutating it.

## 8. Resolver Input Ownership

Current V4 policy is `tool_argument`; it cannot prove that the argument is the original user mention. V5-C policy is explicitly `rawMention` for each of the six supported types. A concrete mismatch is rejected as `V5_IDENTITY_INPUT_MISMATCH` before resolver entry. No normalizer or alias stage may replace raw ownership.

## 9. Existing Resolver Adapter

The adapter calls the existing `resolveFormalEntityResultV3` only with a caller-supplied formal result fixture and the immutable raw mention. It performs no discovery call, network, DB access, Tool execution, or write. It maps current exact, unique-candidate, ambiguous, and not-found outcomes into new immutable V5 identities. Input identity and formal result mutation count is zero.

## 10. Identity Damage Detection

Detection emits only length, punctuation, digit, case, whitespace, and changed metadata. It never emits the compared strings. Normalization with both raw and normalized values is `TRANSFORMED_TRACKED`; an expected/observed structural mismatch before raw ownership is established is `TRANSFORMED_UNTRACKED`; insufficient shapes are `UNKNOWN`. Detection never repairs punctuation.

## 11. Capability / Ontology Consistency

The frozen V5-B registry references 16 distinct entity types; unknown/stale references=0. Six are supported by the current resolver adapter. Ten are explicit ontology types without that resolver. Three additional schema-grounded types are not currently referenced by capabilities. V5-B capability grouping was not changed.

## 12. P06 Exact Identity Shadow Analysis

| Path | Original shape at first boundary | Tracking | Resolver received | Resolver valid for received input | V5 result |
| --- | --- | --- | --- | --- | --- |
| Legacy | no; observed 10/1 vs expected 11/2 | fuzzy normalization tracked, upstream loss untracked | altered Tool argument | yes, exact for received identity | `PREVENTED` by raw boundary mismatch |
| V4 Investigation | no; observed 10/1 vs expected 11/2 | fuzzy normalization tracked, upstream loss untracked | altered Tool argument | yes, exact for received identity | `PREVENTED` by raw boundary mismatch |
| V4+R3 | structurally yes; observed 11/2 | normalization tracked; no upstream loss | preserved Tool argument | yes, exact | `NOT_ADDRESSED`; remaining C02 is outside P10 |

The raw value is supplied by the frozen test fixture/report, not recovered from privacy-redacted trace content. P10 does not claim production V4 is fixed.

## 13. 800平刀 Identity Analysis

All three P06 paths bypassed a formal entity resolver for their keyword search and contain no sufficient identity metadata. A separate identity-contract fixture for the frozen mention preserves raw text and keeps canonical ID null in 3/3 path projections. Routing and state failures are not evaluated or changed.

## 14. Deterministic Tests

Focused result: 21/21 PASS. Coverage includes ontology validation, duplicate/missing/invalid references, all V5-B entity references, exact raw preservation across 11 punctuation/numeric-like cases, case separation, no coercion, no canonical fabrication, V5Task core compatibility, structural damage metadata, tracked/untracked distinction, exact input guard, explicit adapter policies, current resolver reuse, mutation safety, Exact Identity shadow results, 800 flat-blade identity-only checks, and corpus denominators. No network, Phoenix, real AI, Business API, database, executor, or write is used.

## 15. Business DB Safety

Start and final snapshot: SHA-256 `09B77D8D93A7FE8A30DD4A9AC6F9E743745C384396E783983FC82617F4BEF38E`, size 35,323,904 bytes, mtime `2026-09-03T08:42:16.3158766Z`, recursive backup-file count 209. Hash, mtime, size, and backup inventory are unchanged; no startup backup was created.

## 16. Regression Comparison

With `AI_OBSERVABILITY_ENABLED=false`, the full deterministic suite produced 1,841 PASS / 1,842 total. Relative to 1,820/1,821, all 21 new V5-C tests pass. The sole failure remains `businessTerminologyContract.test.cjs` reading the absent `.guardian/config.yaml`; no new regression was introduced.

## 17. Production Isolation

No production file was modified. Static scans of `api.cjs` and `api/**` outside the isolated V5 directory found zero imports of the V5 ontology/identity/shadow modules and zero imports of the V5 resolver adapter. Production requests routed to V5=0, V5 entity resolver production executions=0, V5 Tool executions=0, and V5 writes=0.

## 18. Known Limitations

- P06 safe metadata contains sufficient identity structure only for the three Exact Identity paths; the other 12 are not counted as identity passes.
- Raw trace content is intentionally unavailable. Exact-case raw preservation uses the frozen Oracle fixture, while damage detection uses only structural trace evidence.
- Only six current resolver types have a V5 adapter. Other ontology types remain explicitly unsupported.
- V5Task V1 retains its frozen base EntityReference fields; extended V5-C resolution metadata remains on the separate identity object pending a separately approved contract revision.
- P10 does not validate free-text extraction, normalization correctness, business arguments, evidence, policy, or final answers.

## 19. V5-D Preconditions

`V5_D_READY=YES`: ontology, canonical-source declarations, identity invariants, resolver input ownership, read-only adapter, damage detection, capability reference consistency, P06/800 identity shadow checks, database safety, regression comparison, and production isolation pass. This readiness result authorizes no V5-D implementation; P10 stops for Supervisor review.
