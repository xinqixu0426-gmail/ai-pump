# P16-L-PROD — Deployment and production applicability certification

## Result

**REWORK. P16_L_PRODUCTION_COMPLETE=NO; P16_M_READY=NO.** Implementation remains frozen at `1d5bd931e58e7eb9214d9e58beeaabeb2ffc50b1`, master. No Stage commit or implementation patch. P17 remains paused. Production has been restored to the prior R1 Candidate/gateway artifacts; owner-default stays ON and the restored narrow inventory route returns a validated V5 answer.

## Deployment audit and execution

Only the isolated Candidate and additive gateway require P16-L changes. Frontend conversation transport is unchanged from deployed R1, so no frontend update. The new formal `POST /api/collections/read` is mounted by Candidate's own read-only runtime and uses the governed Business service; Legacy does not need to host the new endpoint. No direct V5 SQLite path or full DTO fallback was added.

A clean Git archive of the certified commit was prepared, never the dirty worktree. An interrupted upload was rejected before activation. After retransmission, the archive SHA-256 matched. Windows Git archive applied CRLF to source text; a second pre-switch check detected this byte difference. Every changed runtime file plus protected database/authentication/context dependencies was compared against committed content with CRLF/LF normalization. No business code was edited. The exact archive, original and normalized hashes, and certified revision marker are retained in the isolated artifact directory.

Deployment directory: `/Users/dan/pump-p16l-prod-1d5bd93/source`. Existing non-root LaunchAgents retained their definitions. Runtime configuration switched only Candidate/gateway directories. Initial bootstrap hit supervisor unload timing; the same non-root bootstrap subsequently brought both services ready. No model request was retried and no Legacy service was signalled. Candidate/gateway test PIDs were78611/78613; both listened only on127.0.0.1. The original config was retained for rollback.

Legacy revision before/after: `12fee179b6074215cf359bcc1a789ce1a345b9ba`; PID59155 throughout; health PASS. Live Legacy source diff remained empty. Frontend BUILD_ID was unchanged. Candidate uses the unchanged native SQLite readonly adapter, migration compatibility checks only, lifecycle suppression and mutation guard. No migrations, startup checkpoint, background mutation jobs or V5 writes were enabled.

## Smoke and fixed owner UAT

Governed collection API smoke succeeded for all5 resource families. Orders and customers each had only one applicable record; recipes/coils had fewer than one full page, parts had more than one page. No production records were created or altered. Maximum API response envelope observed was2586 bytes, below262144; this includes the envelope and is a conservative bound on the collection result. No cap was increased.

Public ordinary route: `https://xuxinqi.xin/api/ai/chat`, dedicated owner authentication, valid conversation IDs, no explicit V5 marker/fact/limit/cursor. Shared admin smoke: owner=false, Candidate attempts0, Legacy HTTP200 with one completion. Unauthenticated smoke: HTTP401, Candidate attempts0. Credentials, JWTs, source questions, rows and answer bodies remained transient.

Completed owner requests:

| Case | Actual result |
|---|---|
| Exact orders list | Validated V5, bounded one-row page, authoritative count/hasMore, exact approved response match |
| Customers list in another conversation | Validated V5, exact approved response match |
| Orders continuation | No second page; COLLECTION_END_REACHED, Tool0, Answer0, safe Legacy final |
| Customers continuation | No second page; COLLECTION_END_REACHED, Tool0, Answer0, safe Legacy final |
| Orders count | Validated V5, authoritative server aggregate |
| Active orders filter | Validated V5, formal active filter preserved |
| Filtered continuation | No second page; COLLECTION_END_REACHED, Tool0, Answer0, safe Legacy final |

There were7 owner UAT requests plus2 identity smoke requests before stopping. Four owner answers were validated V5 finals; three terminal continuation requests safely fell back. Every authenticated request completed once, without SSE errors or Candidate validation bodies. Independent formal API results were read transiently before answer comparison. Exact response comparison uses the approved deterministic renderer; row identity and total presence are also checked. No result text is saved.

Production orders/customer continuation cannot prove second-page advancement because no second page exists. Filtered continuation is explicitly data-limited; isolated R4 multi-page/filter tests remain evidence, not a fabricated production PASS. The intended parts multi-page and ordinal checks were not reached before the detail blocker. No production cross-query continuation success is claimed from two identical terminal outcomes.

## Exact blocker: bounded order detail source contract

Before the direct-detail owner answer call, the formal Oracle detail read returned HTTP400 `COLLECTION_DETAIL_OVERSIZED`. A read-only diagnostic established:

- only2 order lines exist, below the50-line bound;
- approved fields recipeName/qty/unitPrice have the expected string/number/number types;
- remark is present and within its bound;
- the original `items_json` exceeds8192 characters because lines also contain full configuration/cost snapshots and other existing business fields.

`collectionReadService.cjs` rejects the full source JSON length before extracting the small approved line projection. Thus a small legitimate detail projection is blocked by unrelated stored snapshot volume. This is a reusable production contract/data-shape gap, not a missing target, semantic instability or reason to increase the global cap. No source value, amount, identity or snapshot content is persisted in the diagnostic; only field names/types/presence are retained.

No ad-hoc API, projection, source limit, prompt or model change was made. No answer retry occurred. Direct detail did not reach the owner Answer stage; later parts/recipes/coils owner lists, ordinal, multi-page isolation, full narrow-read matrix and write-risk production request were **NOT_RUN**. API smoke alone is not their owner UAT certificate.

## Rollback and final safety

Rollback dry-run checked retained artifacts/config and valid existing LaunchAgent definitions. Actual rollback then restored `/Users/dan/pump-p16lr1-transport/source` for Candidate and its `api/services` directory for gateway. Final PIDs78720/78724, healthy and loopback-only. The separate Legacy PID59155 remained unchanged. No DB restore, business-data rollback, Legacy restart or frontend action was required.

One post-rollback ordinary owner inventory probe returned HTTP200, finalSource=v5-candidate, validated=true, inventory fact match=true, no private error exposed. This confirms restored owner-route health, not the unexecuted4-fact P16-L production regression.

Before deployment, during UAT and after rollback, production DB hash/mtime/size/backup count matched. Legacy source, revision and frontend build remained unchanged. V5 Writes0; allowWrite enabling0; Business Mutation Calls From V50; Candidate DB Mutation Successes0. Production business data modifiedNO.

Completed UAT metadata: orphans0, cross-request0, credential/token/private-content exact matches0. No rows, answers or continuation tokens were persisted in normal telemetry or Stage artifacts. Production collection-list latency median2856.478ms, p953002.735ms over3 successful list/filter samples. No successful continuation/detail latency was measured; terminal Legacy fallback latency is not substituted. Telemetry does not yet persist all collection-specific fields in the old supervisor adapter, so a full collection observability certification is not claimed.

Operational safe artifacts are retained under `/Users/dan/pump-p16l-prod-1d5bd93` and local `output/p16l-prod-20260907`. No user-owned dirty source was copied, overwritten, staged or committed. Only this Stage report and isolated operational artifacts were added locally.

STOP — WAIT FOR SUPERVISOR REVIEW. Do not deploy a repair, begin P16-M, resume P17 or enable writes.
