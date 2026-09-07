# P16-L-PROD-R2 — Detail admission characterization and resource-scoped finalization

## Executive result

REWORK. Start `01cc001b37ad8b758b6569419561757b3690e53d`; focused commit `312b0ae8b905593205dec19acb5e37a6c46a1e8d`, master. P16_L_PRODUCTION_COMPLETE=NO; P16_M_READY=NO; P17 remains paused.

The fixed original order-detail diagnostic completed exactly5 independent requests: READ_SAFE5/5, admissions5, correctly validated V5 details5, unavailable/unknown0, mutation classification0, Legacy fallback0. No wording change, early stop, runtime retry or risk tuning. The earlier R1 unavailable outcome is not a persistent blocker under the specified5-run rule; this small sample is not a long-term availability guarantee.

The exact customer detail shape also passed against production cross-domain ambiguity. Part and recipe direct details passed. The coil direct-detail request was READ_SAFE but failed closed at COLLECTION_TARGET_NOT_FOUND before Tool/evidence/answer. It was not retried. Subsequent collection/ordinal/narrow-read production closure checks were stopped. Production was rolled back to the prior stable artifact.

## Frozen contract repair

`collectionDetailTarget.cjs` now reuses existing `acquireCandidateSet`, including governed lookup validation, completeness checks and preservation of all cross-domain candidates. The generic lookup and general resolver are unchanged.

`finalizeCollectionDetailTarget(resourceType, governed)` consumes the resourceType already selected and validated by Collection Semantic Intent. It does not accept a client header, Tool or answer-selected resource. The existing five-resource map is unchanged. It filters the complete governed set by that type:

- zero matches: COLLECTION_TARGET_NOT_FOUND;
- multiple same-type matches: COLLECTION_TARGET_AMBIGUOUS;
- exactly one: existing canonical target/projection/provenance contract;
- incomplete, invalid or unavailable lookup: fail closed.

Candidate order has no authority. Cross-domain candidates are not deleted from the original governed set. No fuzzy ranking, first-result selection or new lookup API was added. Ordinal detail remains page-bound and converges to the same target contract. Projection-before-guard, nested50-line limit, payload caps, pagination, evidence, answers, risk rules and narrow reads were not modified.

One white-listed riskClass metadata field was added to the existing persistent-runtime outcome adapter so diagnostic READ_SAFE/WRITE_OR_MUTATION/UNAVAILABLE_OR_UNKNOWN can be counted without another model call or content telemetry. No prompt, raw envelope or business data is stored.

## Local validation

Focused risk/collection/R1-projection/R2-R4/owner/persistent-runtime tests passed33/33, followed by4/4 finalizer tests including the additional real Business source fixture. The tests cover:

- customer+order exact ambiguity, both semantic resources selecting their own canonical target;
- input candidate-order reversal and original-set preservation;
- two same-type candidates remaining ambiguous;
- wrong-type-only and empty candidate sets returning NOT_FOUND;
- all five resources and template cross-domain exclusion;
- incomplete, duplicate, malformed and fuzzy lookup responses rejected;
- real governed lookup preserving customer/order ambiguity, approved detail/evidence/answer for both targets;
- projection-before-guard, oversized approved-projection rejection, nested bounds, filter replay, ordinal, namespace and write-safety regressions.

API contract26/26 PASS; focused lint and build PASS. Full deterministic regression retained only the known missing `.guardian/config.yaml` failure. Deep API single run retained the known copperBase failure signal. Neither unrelated issue was repaired or retried. The entire release gate is not represented as green.

Five Stage-owned files/document hunks were committed. All12 user-owned tracked dirty files and pre-existing untracked work remain outside the commit. No push was requested/performed. This report and safe operational evidence are Stage-owned working-tree artifacts.

## Deployment isolation

Only the isolated Candidate, additive gateway and metadata adapter were deployed. Clean committed archive content was verified against449 runtime/script file hashes before activation. The prior runtime-adapter hash was verified before backup; rollback restores that original adapter. Frontend and Legacy files were not changed.

Test artifact: `/Users/dan/pump-p16l-prodr2/source`, certified revision312b0ae. Test Candidate/gateway PIDs79294/79297, non-root dan, loopback127.0.0.1 ports3102/3103. Existing non-root supervisor definitions were reused. Native readonly DB and mutation guards remain; no startup migration/checkpoint/business jobs enabled.

Legacy revision remained `12fee179b6074215cf359bcc1a789ce1a345b9ba`, PID59155, healthy, empty live source diff. Frontend build identity remained unchanged.

## Fixed production characterization and detail UAT

All identities were selected deterministically from bounded formal lists and complete governed candidate sets before any business answer. Expected same-type uniqueness was frozen before execution. No fixture identities or production records were changed.

| Check | Result |
|---|---|
| Shared admin | owner=false, Candidate attempts0, Legacy HTTP200, one completion |
| Anonymous | HTTP401, Candidate attempts0 |
| Original order detail diagnostics |5/5 READ_SAFE,5/5 admitted and validated V5; exact approved-answer match |
| Customer detail | Governed candidates2 across customer/order, expected customer1; validated V5 exact answer |
| Part detail | Validated V5 exact answer |
| Recipe detail | Validated V5 exact answer |
| Coil detail | READ_SAFE, then COLLECTION_TARGET_NOT_FOUND; Tool0, Answer0; safe Legacy HTTP200, one completion |

All8 successful details had valid evidence, numeric/entity validation and exact comparison against the same approved formal detail contract. Order projected display remained256 bytes, collection result802 bytes, with raw source snapshot keys absent. The coil preflight had one authoritative coil candidate, and its canonical detail API returned a valid156-byte display. This does not establish what source span/resource intent the failed model-selected detail path actually used. Those transient values were deliberately not persisted, so the report does not guess whether the remaining failure is span selection or semantic resource selection. The observed failing boundary is target finalization yielding no expected-type match.

There were11 ordinary production-route requests before stopping:2 identity smokes,5 fixed order diagnostics and4 other direct details. Eight business answers were validated V5; the failed coil path safely returned Legacy. No technical/invalid body exposure, duplicate completion or Candidate-caused HTTP/SSE failure was observed. Runtime retry count0. The mandated five diagnostics are independent characterization requests, not retry logic.

## Unfinished closure gates and applicability

Because detail certification failed, ordinal owner UAT, five-domain owner list UAT, owner count, production filtered continuation, cross-conversation execution, four-fact narrow-read matrix and production write-risk negative request were NOT_RUN. They are not credited from API preflight or historical evidence.

Bounded list applicability reads succeeded for all five domains. Production orders/customers/recipes/coils had hasMore=false; parts hadMore=true. Orders second-page movement is NOT_APPLICABLE_CURRENT_DATA. No fake rows were added. Filtered multi-page behavior remains covered by passing isolated tests, but production filter execution was not reached. Local namespace isolation remains PASS; no production cross-conversation PASS is claimed in this attempt.

## Rollback, safety and final state

Actual rollback restored `/Users/dan/pump-p16lr1-transport/source`, its gateway and the original runtime adapter. Final Candidate/gateway PIDs79439/79442, healthy and loopback-only. Legacy PID59155 never changed. No Legacy restart, DB restore or business-data rollback was needed.

The required rollback narrow inventory probe returned HTTP200, validated V5, inventory fact matched and no Candidate error body. This confirms restored owner-default health, not the unexecuted full narrow matrix. Owner-default remains ON with the prior stable narrow-read artifact. The new collection artifact was not reapplied because Stage status is REWORK.

DB hash/mtime/size/backup count matched before activation, after UAT and after rollback. Production business data modifiedNO; V5 Writes0; allowWrite enabling0; Business Mutation Calls From V50; Candidate DB Mutation Successes0. Fixture setup writes were in isolated memory only.

UAT and rollback exact-match private-content scans returned0. Orphan/cross-request counters0. Metadata files contain only bounded classifications, counts, validation flags, projected sizes, timing and deployment fingerprints, not questions, answers, rows, IDs, credentials or continuation secrets. Files are retained under local `output/p16l-prodr2/` and remote `/Users/dan/pump-p16l-prodr2/`.

Current blocker: admitted production coil direct detail returns COLLECTION_TARGET_NOT_FOUND despite successful authoritative identity/detail preflight. No runtime retry, semantic tuning or scope expansion was performed.

STOP — WAIT FOR SUPERVISOR REVIEW. Do not begin P16-M, resume P17, redeploy or enable writes.
