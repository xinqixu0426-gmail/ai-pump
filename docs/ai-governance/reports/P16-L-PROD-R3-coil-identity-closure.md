# P16-L-PROD-R3 — Coil identity bridge and production closure

## Executive result
REWORK. Start: 312b0ae8b905593205dec19acb5e37a6c46a1e8d; focused commit: 806a24465948750cda8f28808e499a5572bd19a7 (master).
The coil bridge passed original production schemeName and schemeCode requests on their first attempts. All five direct-detail domains passed. Certification stopped at the customer ordinal request used for cross-conversation validation: normalized risk UNAVAILABLE_OR_UNKNOWN, failure RISK_NOT_ELIGIBLE, no Candidate admission, Tool=0, Answer Model=0, one successful Legacy final. No retry or risk change.
P16_L_PRODUCTION_COMPLETE=NO; P16_M_READY=NO; P17 remains paused.

## Exact root-cause audit
The unchanged R2 production coil request was reconstructed using the same deterministic authoritative first-applicable identity before answer execution. Business data hash was unchanged.
The generic source catalog contained 18 spans but omitted the complete schemeName. Direct governed lookup of that full identity returned one coil. Existing authoritative span supply returned exactly one candidate, scanning 28 identities; existing exact-span selection selected the complete schemeName.
Collection detail previously consumed only the generic intent identity and never invoked the certified authoritative span chain. R2 metadata did not retain the selected model fragment; this report does not claim to know that historical fragment. The missing integration and full-identity applicability were demonstrated independently.

## Frozen bridge
Only coil direct detail now invokes existing supplyCoilSpanCandidates, selectExactAuthoritativeSpan and acquireExactAuthoritativeCandidateSet, then the unchanged resource-scoped finalizer. Source authority selects text, never canonical identity. Governed lookup remains mandatory.
No new resolver, matching semantics, risk/model change, retry or additional model stage. One additional bounded identity Business API read. Candidate limit 8 and scan budget 512 unchanged. Zero or multiple authoritative spans fail closed. Other resources and ordinal execution unchanged.
Projection-before-guard, 8192-byte detail cap, global 262144-byte cap and nested bound 50 unchanged.

## Local certification
Focused identity/finalization/projection/API-boundary tests: 35/35.
Continuation/control/runtime regressions: 11/11, including normal and frozen filtered continuation and isolated conversation behavior.
API contract: 26/26. Deep API: PASS. Build: PASS. Full deterministic suite: only the pre-existing missing .guardian/config.yaml business-terminology test fails.
The explicit internal-client caller inventory was updated for the approved bridge.
The synthetic unique-target fixture originally contained distinct authoritative identities whose text overlapped. Only that isolated fixture was adjusted to remove the collision; the original target/question stayed unchanged. Separate multi-span tests retain fail-closed rejection. No production identity was changed.

## Production one-shot results
12 ordinary-route requests: two auth/isolation smokes, nine validated V5 finals, one safely rejected customer ordinal request.
Owner used no V5 marker/fact header. Shared admin owner=false and Candidate attempts=0. Anonymous HTTP401 and attempts=0.
- Original coil schemeName detail: PASS, READ_SAFE, retry=0, exact authoritative Oracle answer, verified evidence/numeric/entity checks.
- Same-coil schemeCode detail: PASS; governed canonical equality confirmed before execution.
- Orders/customers/parts/recipes direct details: all PASS. Customer cross-domain lookup retained two candidates, uniquely narrowed to customer.
- Production direct-detail matrix: 5/5 (six requests counting both coil identity kinds).
- Orders and customers lists: PASS.
- Orders ordinal 1: PASS.
- Customer ordinal 1 in separate customer conversation: safe Legacy fallback at risk; production namespace certification incomplete. No cross-binding observed.
- Remaining parts/recipes/coils owner list, natural orders count, filtered request, narrow four-fact production matrix and write-risk production request: NOT_RUN after stop. Bounded applicability preflight is not counted as owner UAT.
Orders authoritative list hasMore=false: second page NOT_APPLICABLE_CURRENT_DATA. No production fixtures added. Actual filtered production applicability was not measured this run; isolated filtered continuation PASS retained.
Order projected detail: 256 bytes; coil: 156 bytes; maximum certified detail envelope: 802 bytes. Approved display field keys only; no raw items_json.
Seven validated detail requests median 2438 ms; maximum 3296 ms. No latency tuning.

## Deployment, rollback and safety
Certified archive content hash matched all 449 Candidate/script files. Test Candidate PID79632; gateway79635. Both non-root dan, loopback-only. Frontend not updated.
On failure, restored exact prior runtime configuration and adapter. Final stable Candidate PID79778; gateway79781; source /Users/dan/pump-p16lr1-transport/source. R3 artifact is retained inactive, not running. Prior artifact has no certified-revision marker; no inferred revision asserted.
Rollback ordinary owner inventory probe: validated V5 PASS. Owner-default stays ON; collection rollout remains inactive.
Legacy revision 12fee179b6074215cf359bcc1a789ce1a345b9ba, PID59155 before/after, healthy, no source diff, no restart.
DB hash/mtime/size and backup count unchanged. Candidate uses native readonly database plus compiled statement guard; no startup migration/checkpoint/background write jobs. V5 writes=0; allowWrite enabling=0; business mutations from V5=0; Candidate mutation successes=0.
Metadata-only certification: no raw request/body/row/credential/continuation value persisted. Safe structural evidence private-value scan=0; orphan spans=0; cross-request=0. Runtime and gateway streams retain metadata only.
User-owned tracked/untracked work preserved; only seven R3 source/test/document paths selectively committed. Shared api-reference user hunk excluded. This closure report and isolated operational evidence remain uncommitted; no second Stage commit or push.

## Evidence and Supervisor boundary
Local output/p16l-prodr3 contains safe manifest, one-shot UAT and closure metadata; operational scripts kept separate from implementation commit. Earlier Stage artifacts were not overwritten.
Current unique closure blocker: customer ordinal READ-risk availability during the cross-conversation certification (UNAVAILABLE_OR_UNKNOWN / RISK_NOT_ELIGIBLE). No evidence of identity bridge failure or actual namespace contamination. Requires Supervisor decision; this Stage does not tune risk or add an ordinal bypass.
STOP. No P16-M, P17, write enablement or Legacy retirement.
