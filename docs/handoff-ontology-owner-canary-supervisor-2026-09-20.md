# Ontology Owner/Internal Production Canary — Supervisor Return

Date: 2026-09-20  
Status: **PASS — OWNER/INTERNAL CANARY ONLY**  
Global Ontology Enforcement: **NOT ENABLED**

## 1. Executive conclusion

The Ontology read-routing architecture is deployed on the Mac Mini and is authoritative only for a
server-verified Owner or trusted internal request while the independent production canary flag is ON.
The production code, Gitee `master`, and the audited local `master` all contain the accepted runtime
closure. The final real DeepSeek gates passed with no wrong root, wrong direction, Legacy fallback,
unbounded relation read, additional semantic provider round, unauthorized write, business-table change,
audit entry, or operation entry.

This is not approval for unrestricted global Ontology authority. Shared-admin users remain on the
Legacy path, and relation families outside the two promoted profiles remain outside production routing
authority.

## 2. Current Ontology maturity

Ontology Contract V1 contains:

- 7 entity types: `customer`, `order`, `recipe`, `part`, `coil`, `template`, `quotation`.
- 6 source families represented as 12 directed relations.
- `CANONICAL_DIRECT` authority for direct persisted references.
- `DETERMINISTIC_DERIVED` authority for relations derived from formal persisted structures.
- canonical-root, provenance, completeness, bounded-read, ambiguity and fail-closed contracts.

The frozen contract still keeps every relation's general `runtimeEnabled` field false. Production
authority is introduced only through the reviewed private migration adapter and its independent canary
boundary; the contract was not silently changed into global authority.

Current promoted Owner/Internal routing profiles:

1. `recipe.uses_coil` / `coil.used_by_recipe`
2. `recipe.contains_part` / `part.contained_in_recipe`

The remaining registered relation families continue to be available to deterministic resolver/shadow
infrastructure where already implemented, but are not promoted by this production canary.

## 3. Security and authority boundary

Canary routing requires both:

1. `AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=true`; and
2. a server-verified formal Owner JWT or the existing exact internal secret.

The following do not grant authority:

- shared-admin login;
- `req.user` fields supplied or mutated by a caller;
- `x-owner` or similar owner self-claims;
- query/body owner flags;
- invalid or incomplete Owner configuration;
- approximate/fuzzy identity or the first catalogue result.

The runtime independently checks the environment flag after the HTTP boundary has established identity.
Production revalidation confirmed `formalOwnerEligible=true` and `sharedAdminEligible=false`, including a
shared-admin request carrying forged owner signals. Credentials and tokens are not recorded in this
report.

## 4. Code audit result

Audit range: `8289970..18662ed`  
Primary audited production closure commits:

- `c1de08c` — restrict Ontology canary admission to trusted Owner/Internal requests.
- `abefb57` — close direct model conflicts in recipe-to-coil answers.
- `18662ed` — reject mixed canonical/foreign relation targets and close the acceptance blind spot.

### Blocking issue found during audit

The earlier `abefb57` production report counted one F1 answer as correct because it contained the expected
`12-120`, even though a legacy same-specification postprocessor appended unrelated `12-220` variants.
Two defects combined:

1. a verified `recipe.uses_coil` answer could still pass through the legacy catalogue-variant completer;
2. the acceptance runner only searched for foreign coil identities when the expected target was absent.

Therefore the earlier statistical `wrongRoot=0` was not sufficient evidence, despite the underlying
formal relation reads being correct.

### Closure

- Once canonical recipe detail and canonical coil catalogue agree on one coil ID, the legacy variant
  completer cannot append unrelated catalogue alternatives to that bound relation answer.
- The production runner now marks `expected target + any foreign coil target` as incorrect, records the
  foreign target, and increments `wrongRoot`.
- Regression tests cover both model-originated foreign targets and postprocessor-originated pollution.

Post-fix audit result: **0 open blocking findings**.

## 5. Local and release gates

| Gate | Result |
| --- | --- |
| Focused Ontology/runtime/identity tests | 134/134 PASS |
| Full test suite | 2701/2701 PASS |
| API contract | 27/27 PASS |
| Deep API, local | 490/490 PASS |
| Lint | PASS |
| Web production build | PASS |
| Root production dependency audit | 0 vulnerabilities |
| Web production dependency audit | 0 vulnerabilities |
| Mac Mini release Deep API | 493/493 PASS |
| Production environment gate | PASS |
| Local/public ready and Web/AI pages | PASS |

No API route/schema change, DB schema change, cost formula, write capability, MCP capability, Ontology
relation, or production test record was added.

## 6. Deployment evidence

| Item | Value |
| --- | --- |
| Previous production commit | `abefb57ed2e139c5f84d34afc1dd83bf85f750e9` |
| Audited runtime commit | `18662ed95e80445e1d5a31d9f619e142ea4b8622` |
| Branch | `master` |
| Remote | Gitee `origin/master` |
| Deployment mode | verified release script, `git pull --ff-only` |
| Release backup | `/Users/dan/pump-cost-accounting-system/backups/release/pump-release-2026-09-20T15-02-18-470Z.db` |
| Release backup SHA-256 | `f01d1f283075bb0b21ae297bc1e27f95fc48e96bf17365f9e1fdc148734cebae` |
| Startup backup | `/Users/dan/pump-cost-accounting-system/backups/startup/pump-startup-2026-09-20T15-03-08-120Z.db` |
| Startup backup SHA-256 | `26c2a5124b4a278046c2853df918264bf0e6fc5014c7dd4ceddbca7c837a43e4` |
| DB schema | 87 |
| Ready | true |

Production configuration at acceptance time:

```text
AI_BUSINESS_SEMANTIC_SHADOW_ENABLED=true
AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED=false
AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=true
```

## 7. Real DeepSeek production acceptance

### 7.1 Recipe ↔ coil strict gate

Saved report:
`/Users/dan/pump-cost-accounting-system/logs/ontology-owner-canary-production-audit-final.json`

| Metric | Result |
| --- | --- |
| Status | PASS |
| Provider / model | DeepSeek / `deepseek-chat` |
| Rounds | 2 |
| Reverse `coil → recipe` | 4/4 |
| Forward `recipe → coil` | 8/8 |
| Verified empty relations | 4/4 COMPLETE |
| Routed correct | 12/12 |
| Wrong root / wrong direction | 0 / 0 |
| Legacy fallback / cloud fallback | 0 / 0 |
| Aggregate relation reads | 0 |
| Maximum bounded result | 61 bytes |
| Additional provider rounds | 0 |
| Payload-limit failures | 0 |
| Unauthorized writes | 0 |
| Business tables changed | none |
| Audit / operation delta | 0 / 0 |

The stricter runner inspected the complete answers. All eight forward executions contain only their
expected canonical coil identity; no `12-220` foreign target remains in the V550/`12-120` answer.

The separately reported `unboundedQueryBudgetRefusals=3` came from the intentionally unrelated negative
case, not from a relation route. It failed safely without inventing data and does not mask a relation
payload regression.

### 7.2 Recipe ↔ part production check

Two forward recipes, one shared canonical part and one single-recipe canonical part were run twice through
the real production DeepSeek path:

- `recipe.contains_part`: 4/4 complete formal receipts; each answer retained all 21 returned canonical
  part identities.
- `part.contained_in_recipe`: 4/4 complete formal receipts; both the two-recipe and one-recipe result sets
  were retained exactly.
- Total: **8/8 PASS**.
- Provider: DeepSeek.
- Business tables changed: none.
- Audit / operation delta: 0 / 0.

Historical role text such as `花板轴承` is not silently promoted to a formal part alias. The authoritative
current catalogue name `轴承-202` resolves correctly. This is intentional fail-closed identity behaviour,
not an alias capability claim.

### 7.3 Protected writes

The production relation gate ran the protected inventory adjustment twice. Both executions produced a
confirmation card only. No write executor ran, no business row changed, and `Unauthorized Writes = 0`.

## 8. Preserved boundaries

- No fuzzy or LLM canonical identity authority.
- No first-result selection.
- No new business arithmetic or cost formula.
- No schema migration or production test-data injection.
- No global Ontology enablement.
- No removal of Legacy, Money Guard, Cross Catalog, Coil Variant safety, Rulebook enforcement, semantic
  shadow, or existing write confirmation.
- Business Semantic Enforcement is currently OFF and is not implied by the Ontology canary result.

## 9. Remaining limitations

1. Production authority is limited to trusted Owner/Internal requests.
2. Only the promoted recipe–coil and recipe–part profiles have production canary authority.
3. Historical role labels are not generic aliases; unsupported names must be clarified or mapped through
   a separately approved formal alias capability.
4. This acceptance does not authorize global users, write relations, additional relation families,
   multi-hop production authority, or Legacy cleanup.

## 10. Recommended next step

Keep the Owner/Internal canary enabled and collect a bounded corpus of real owner questions for the two
promoted families. Any expansion should be one reviewed relation family at a time, with a production-shape
corpus, strict mixed-target detection, canonical identity evidence, bounded reads, zero additional model
rounds, protected-write negatives, and explicit rollback. Do not globally promote Ontology enforcement
without a new Supervisor authorization.

## 11. Supervisor return

```text
ONTOLOGY OWNER/INTERNAL PRODUCTION CANARY SUPERVISOR RETURN

Status: PASS — OWNER/INTERNAL CANARY ONLY
Audited Runtime Commit: 18662ed95e80445e1d5a31d9f619e142ea4b8622
Branch: master
Production Deployed: YES
Production Ready: YES
DB Schema: 87

Blocking Audit Findings: 1 found, 1 closed, 0 open
Mixed Correct/Foreign Target Rejected: YES
Shared Admin Eligible: NO
Formal Owner Eligible: YES

Recipe ↔ Coil:
Reverse: 4/4 PASS
Forward: 8/8 PASS
Verified Empty: 4/4 COMPLETE
Wrong Root: 0
Wrong Direction: 0

Recipe ↔ Part:
Executions: 8/8 PASS
Formal Completeness: 8/8

Legacy Fallback: 0
Aggregate Relation Reads: 0
Additional Provider Rounds: 0
Unauthorized Writes: 0
Business Tables Changed: NO
Audit Delta: 0
Operation Delta: 0

New Ontology Relations: NO
New Cost Logic: NO
DB Schema Changed: NO
Production Test Data Added: NO
Global Ontology Enforcement Enabled: NO

Recommended Next Step:
Observe the Owner/Internal canary, then request separate authorization for one additional relation family
or a global-promotion gate.

One-Sentence Conclusion:
The audited Ontology canary is safely deployed and formally correct for the two promoted read-only relation
families under trusted Owner/Internal identity, but it is not yet authorized as unrestricted global authority.
```
