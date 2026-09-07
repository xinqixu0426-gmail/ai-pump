# P16-L-PROD-R4 — Deterministic ordinal control and production closure

## Executive result
PASS. Start commit 806a24465948750cda8f28808e499a5572bd19a7; focused Stage commit c30dab87fbaebd25f94ac71f540d1855c6743b21; branch master.
P16_L_PRODUCTION_COMPLETE=YES. P16_M_READY=YES. P17 remains PAUSED; no next Stage started.
The certified R4 artifact remains running after one rollback-and-restore certification.

## Frozen ordinal control contract
The existing current-page ordinal parser and canonical detail executor are reused. The new ordinalDetailControl pre-router requires a private VERIFIED current list page in the authenticated conversation namespace, unexpired state, and an existing ordinal row.
Closed whole-request grammar: optional 请, optional 看/看看/查看, 第N个 or 第N条, optional 的详情/的详细信息/详情, optional single terminal punctuation. N is decimal 1..50 without leading zero and must exist on the current page. No clamping, fuzzy matching, text lookup, model-selected row, new filter or resource.
Entry remains behind the existing authenticated Candidate gate and per-conversation lease. Valid controls supply READ_SAFE from VERIFIED_READ_PAGE and skip both risk and collection semantic model calls. Target comes from current server page rowIds; normal approved detail execution/evidence/answer remains mandatory.
Invalid grammar, absent/unverified/expired state, wrong principal/conversation or missing ordinal has no bypass. Mutation clauses follow the unchanged normal risk pipeline and fail closed.
Continuation logic, risk model/prompt, semantic model, finalizer, coil identity, projections, evidence, count and read business contracts unchanged. Only three safe supervision fields added: ordinalControl, riskInvoked, collectionSemanticCalls.

## Local verification
Focused ordinal/detail/continuation/owner tests:27/27 PASS.
API contract:26/26 PASS. Lint PASS. Build PASS.
Full deterministic tests have only the pre-existing businessTerminologyContract failure due to missing .guardian/config.yaml. Deep API remains subject to the known copperBase fixture failure (explicit captured exit1); neither unrelated issue was modified or claimed fixed.
Ordinal negative matrix includes absent/expired/unverified page, wrong principal, wrong conversation, invalid conversation, zero/leading-zero/negative/large/out-of-range values, and mutation-bearing clauses. Auth gate rejects unauthorized access before risk/Tool. Cross-principal bindings=0.
The actual Candidate test confirms separate orders/customer targets, risk calls0, collection model calls0, same bounded detail execution. Existing continuation regression preserves normal and filtered replay with zero original-filter reclassification.
Projection-before-guard, 8192-byte detail cap, 262144-byte global cap, nested bound50 and oversized projected-detail rejection retained.
The known historical release-gate failures remain explicit limitations; certification is the scoped P16 production acceptance, not a claim that all repository regression gates are green.

## Fixed production certification
One run, no runtime retry or question tuning.24 ordinary-route requests:20 positive V5 results and4 expected identity/write-negative outcomes. No explicit V5 marker or client fact header.
Primary two-conversation test:
- A: orders list, then ordinal1; correct authoritative order detail.
- B: customers list, then ordinal1; correct authoritative customer detail.
- Both controls: ordinalControl=true, riskInvoked=false, collectionSemanticCalls=0; exact Oracle answer match. No cross-binding observed.
Five-resource direct detail matrix5/5 PASS, plus the same coil's schemeCode variant with canonical equality. Order/customer cross-domain finalizer and coil bridge unchanged.
Orders/customers/parts/recipes/coils lists PASS; natural orders count PASS; formal active-orders filter PASS. Actual parts second-page continuation PASS.
Orders second page: NOT_APPLICABLE_CURRENT_DATA. Filtered orders second page:NOT_APPLICABLE_CURRENT_DATA. This is current-data applicability, not a failure; isolated multi-page filtered certification retained.
Narrow price.current, inventory.quantity, coil.inventory, recipe.cost.preview:4/4 PASS.
Shared admin owner=false, Candidate attempts0, Legacy final. Anonymous401, attempts0.
Ordinary write-risk and mutation-bearing ordinal: WRITE_OR_MUTATION, admissions0, Tool0, Answer Model0, no ordinal bypass, safe Legacy final. No confirmation execution submitted; no Legacy mutation requested via API.
All positive outputs compared against formal read/verified authority. No raw/invalid answer exposure, double visible answers or technical parameter leakage observed.
Collection/list median 2316ms; detail median 2277ms; maximum certified result envelope 2562bytes. No latency tuning.

## Deployment and rollback
Only clean committed Candidate/additive artifacts deployed;449 Candidate/script hashes matched before activation and again after final restore. No frontend deployment.
Initial stable Candidate PID79778; test R4 PID79923; rollback stable PID80069; final R4 PID80116. Final gateway PID80119. Non-root dan, loopback127.0.0.1 ports3102/3103; no public Candidate listener.
Rollback restored prior runtime configuration/adapter and passed normal owner inventory probe. Reapplication of R4 passed the final normal owner inventory probe. No Legacy restart, DB restore or business rollback.
Legacy revision12fee179b6074215cf359bcc1a789ce1a345b9ba and PID59155 unchanged, healthy, source diff empty, frontend build unchanged.
DB hash/mtime/size and backup count unchanged before/after UAT and rollback. Native readonly Candidate database/compiled statement guard retained. Startup migrations/checkpoints/background mutations=0; Candidate mutation successes=0.
Owner-default remainsON, only authenticated owner. Shared admin/non-owner routing not expanded.

## Privacy and safety
V5 Writes=0; allowWrite enabling calls=0; Business Mutation Calls From V5=0; Production Business Data Modified=NO.
Metadata-only storage, no raw business question/row/answer, credentials, JWT or page/continuation secret persisted. Exact private-value scan0; orphan spans0; cross-request contamination0.
Source/user work ownership retained. Seven Stage files selectively committed; unrelated user hunks including api-reference remain uncommitted. No force operations, no push, no Legacy retirement.
Operational scripts and safe manifest/UAT/closure evidence are under output/p16l-prodr4. This closure report remains uncommitted to preserve one focused source commit; previous reports/evidence untouched.

STOP — WAIT FOR SUPERVISOR REVIEW.
