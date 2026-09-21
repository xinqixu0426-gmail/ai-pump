# P16-L-PROD-R1 — Detail projection repair and production closure

## Executive result

REWORK. The projection-order defect is fixed and committed as `01cc001b37ad8b758b6569419561757b3690e53d`, from `1d5bd931e58e7eb9214d9e58beeaabeb2ffc50b1`, master. Production closure is not certified. P16_L_PRODUCTION_COMPLETE=NO; P16_M_READY=NO; P17 remains paused.

The required production order-detail attempt safely fell back with `RISK_UNAVAILABLE` before Tool/evidence/answer execution. It was attempted exactly once. Separately, pre-answer applicability inspection found that the sole production customer name produces two EXACT governed candidates, one customer and one order. The frozen direct-detail resolver therefore cannot admit it uniquely. Neither risk nor identity semantics was changed. No answer retries or prompt changes were made.

## Approved repair

`collectionReadService.cjs` previously applied an8192-character CASE guard to raw order items_json before parsing/projection. Small logical orders containing large configuration/cost snapshots could never reach their approved bounded projection.

The Business service now invokes `collectionDetailProjection.cjs` for all five resources before response serialization/transfer. The existing `<resource>.detail.v1` contract explicitly enumerates scalar fields and approved nested fields. Order lines contain only recipeName/qty/unitPrice, with maximum50 lines. Unknown source fields, configurationSnapshot/costSnapshot and full source JSON never become API fields. No accounting semantics, canonical targeting or answer contract changed. Canonical identity and provenance remain in the existing response envelope.

Projection is deterministic and service-owned. Its UTF-8 serialized display must be at most8192 bytes; the global response remains below262144 bytes. Ordinary scalar160-character and remark512-character bounds remain. The numeric8192 limit is not raised: it now protects the approved display rather than unrelated source snapshots. Oversized approved projections and nested overflow fail closed; no truncation, coercion, conditional field dropping or nested pagination was added.

Only the projector, service, focused tests and the existing collection/API authority documentation were committed. Semantic routing, continuation, filters, owner authentication, narrow reads and P16 write locks are unchanged. All12 pre-existing tracked dirty files and user-owned untracked files remain outside the commit. This operational report is a separate Stage-owned working-tree artifact.

## Local certification

- Focused collection/projector/R2/R3/R4/runtime suite:19/19 PASS.
- Fixture raw source32115 bytes, approved display159 bytes, collection envelope706 bytes. A real Executor/internal client/HTTP Business API result proceeds through Evidence and deterministic Answer; raw snapshot markers and forbidden source keys are absent.
- An approved50-line projection whose serialized display exceeds8192 is rejected;51 nested lines, malformed JSON, null rows and invalid numeric types are rejected. Safe errors contain no source values. No answer follows failed projection.
- Five resource projectors reject automatic propagation of unknown source fields. Existing canonical detail, ordinal, filter replay, keyset pagination, count, task/conversation isolation and write-risk tests remain PASS.
- API contract26/26 PASS; focused lint/syntax PASS; build PASS.
- Full deterministic suite2271/2272: only the known missing `.guardian/config.yaml` failure. Deep API single run exited1 and retained the existing copperBase failure signal. Neither unrelated failure was patched or rerun to chase green. These are not represented as an entirely green release gate.

## Deployment and production observations

Only isolated Candidate and additive gateway were switched. Frontend was not changed. Candidate hosts its own governed `/api/collections/read`; no Legacy modification or restart is required. A clean Git archive, never user worktree contents, was deployed. Archive SHA and449 committed Candidate/script text files were validated before activation. A failed transfer was retried before activation; no model request was retried.

Certified source directory: `/Users/dan/pump-p16l-prodr1/source`. Candidate/gateway initial deployment PIDs78959/78962, user dan, loopback127.0.0.1 ports3102/3103. Native SQLite readonly and compiled-statement mutation guards remain enabled. Startup migration/checkpoint/background mutation paths remain disabled. Existing non-root supervisor definitions were reused, with an unload wait before bootstrap.

Legacy stayed at `12fee179b6074215cf359bcc1a789ce1a345b9ba`, PID59155, healthy. Live source diff was empty and frontend build identity unchanged.

| Certification | Result |
|---|---|
| Shared admin normal collection request | owner=false; Candidate attempts0; Legacy HTTP200, one completion |
| Anonymous normal collection request | HTTP401; Candidate attempts0 |
| Five-domain formal list applicability | Bounded API reads succeeded; orders/customers/recipes/coils have no second page, parts hasMore=true |
| Customer exact target preflight | Two cross-domain EXACT candidates; direct-target applicability fails closed |
| Original production order detail API | PASS; approved display256 bytes, collection result802 bytes, raw snapshot keys absent |
| Same original order detail, ordinary owner route | FAIL; RISK_UNAVAILABLE; Legacy HTTP200; Tool0, Answer0; one completion, no SSE error |
| Subsequent owner list/count/ordinal/other detail/narrow matrix/write-risk UAT | NOT_RUN after mandatory case failure |

Target selection was frozen from bounded formal list/lookup data before any business answer. Customer ambiguity was recorded without replacing the question or relaxing uniqueness. After the initial preflight stopped, the harness continued only the still-unexecuted mandatory order-detail case, guarded against duplicate case IDs; it then stopped at the failed risk gate. The customer failure was not removed from the denominator or converted to PASS. No full UAT was rerun.

The service-level projection repair is thus production-data applicable, but this does not substitute for a validated V5 owner-facing detail answer. The later per-domain acceptance gates remain unverified.

## Pagination and performance applicability

Production orders have hasMore=false. A second page is NOT_APPLICABLE_CURRENT_DATA, not a pagination defect. The isolated multi-page and filtered continuation tests passed again locally. No production rows were added. Production filtered-query and cross-conversation execution checks were not reached in this attempt and are not claimed from local tests.

The only owner detail request took8023.477ms and returned Legacy fallback; it is not a successful V5 detail latency. Successful production collection/detail median and p95 were not measured in this stopped run. The measured order-detail result was802 bytes (display256); no maximum across unrecorded production list payloads is claimed. Global cap is unchanged.

## Rollback and final state

Actual rollback restored `/Users/dan/pump-p16lr1-transport/source` and its gateway directory. Final Candidate/gateway PIDs79138/79141, healthy, non-root and loopback-only. Legacy PID59155 remained unchanged. No DB restore was performed. One independently required rollback probe, ordinary owner inventory read without diagnostic headers, returned HTTP200, finalSource=v5-candidate, validated=true, inventory fact matched, no error body exposed. This proves restored narrow-route health, not the unexecuted four-fact regression.

Because Stage status is REWORK, the collection-capable artifact was not reapplied. Owner-default stays ON with the prior stable narrow-read artifact and Legacy fallback. No P16-M work, P17 work, non-owner rollout or write enablement occurred.

Production DB hash, mtime, size and backup count were identical before deployment, after UAT and after rollback; no unexpected backup. V5 Writes0; allowWrite enabling calls0; Business Mutation Calls From V50; Candidate DB Mutation Successes0. Fixture setup writes were confined to isolated in-memory tests, not V5 or production.

## Privacy and evidence

Metadata-only operational files are retained under `output/p16l-prodr1/` and `/Users/dan/pump-p16l-prodr1/`. They contain statuses, file hashes, counts, type/size facts and timing, not raw questions, answers, rows, source snapshots, credentials or continuation secrets. UAT and rollback credential/content exact-match leakage scans returned0. Candidate/gateway orphan and cross-request counters were0 before and after. No new telemetry content was added; full DTOs, runtime rows and answer bodies were not logged/traced by this Stage.

The nearest failed owner-path boundary is RISK_UNAVAILABLE. A second separately proven blocker is customer/order cross-domain exact identity ambiguity. Both are outside the approved projection repair. Supervisor direction is required before any further diagnosis/change or another formal production attempt.

STOP — WAIT FOR SUPERVISOR REVIEW. Do not deploy again, begin P16-M, resume P17 or enable writes.
