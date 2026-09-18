# P16-H Persistent Owner-Only V5 Read Rollout

## 1. Executive result

PASS. Owner explicit read capability remains enabled through a separate non-root Candidate and gateway. Ordinary production remains Legacy. No P16-I implementation, automatic routing, non-owner rollout, write authority, or Legacy retirement.

Start master: `85e4b91461832102b8815ad24c4a0027057ed3dc`. User-owned dirty files and existing mixed documentation hunks preserved. Stage adds only supervision/metadata operations, focused tests and current-state documentation; frozen Candidate/gateway business implementations are not changed.

## 2. Production isolation and supervision

Legacy before/after: `12fee179b6074215cf359bcc1a789ce1a345b9ba`, PID 59155, health ready. No Legacy restart, file replacement, or env change.

Candidate: `15091c9ec4c462b1a1906952d3fdd788502d2ece`, separate directory `/Users/dan/pump-v5-candidate-15091c9-r4p`. All 308 frozen source manifest files matched before and after operational requests. New ops directory: `/Users/dan/pump-v5-owner-ops-p16h`.

User LaunchAgents `org.pump.v5-owner-candidate` and `org.pump.v5-owner-gateway` run in gui/501 as dan; KeepAlive/RunAtLoad enabled. No root/sudo/system service replacement. Listener inspection confirms 127.0.0.1:3102 and :3103 only. Public ingress contains only the exact owner path targeting gateway, never Candidate port.

Initial Candidate PID 75466; SIGTERM/automatic restoration yielded PID 75492, ready. After failure/rollback and metadata validation operations final Candidate PID 75736; gateway PID 75637. Startup/restart/shutdown use frozen native-readonly Candidate lifecycle, without DB initialization writes, WAL checkpoint, migration or mutation jobs. Main DB hash/mtime/size and backup count remained identical; Legacy env hash remained identical.

Initial installer preflight encountered a shell PATH issue after writing only non-secret runtime.json; no service/plist was started. Correct explicit PATH and conflict-checked idempotent config handling resolved this operations-only issue.

## 3. Owner authentication and routing

Existing internal/operator authentication is retained. Per-request `x-pump-v5-use:true`, approved fact header and existing input shape are mandatory. An ordinary/shared JWT is not owner proof. No new credential, account role, browser storage or UI is introduced.

Two controlled unauthenticated/invalid-secret requests returned 401 with zero Candidate calls. Two ordinary controls (owner route without marker, normal production chat) returned Legacy with zero Candidate attempts. Additional route readiness checks are health/auth probes, not owner business requests.

## 4. Practical production reads

One request per existing five production-applicable source groups, rather than another 15-path benchmark:

| Coverage | Result |
| --- | --- |
| Coil inventory | Validated V5 final |
| Recipe cost preview / punctuation-sensitive exact identity | Validated V5 final |
| Flat blade price / 800平刀 category | Validated V5 final |
| Primary part inventory | Validated V5 final |
| Repeat inventory control | Validated V5 final |

The P16-R4P-R1 projection rule was reused before model calls. The original local recipe identity remains unavailable in active production; the established same-scope unique production recipe projection was retained. No frozen expected values or production data were patched. Evidence/composer validation comes from the frozen runtime, not an evaluation-only comparator injected into the persistent service.

Across practical reads and subsequent recovery/metadata probes: **10 explicit owner requests; 10 Candidate transport attempts; 8 eligible/validated V5 finals; 2 actual Legacy fallbacks**. Eight successful V5 reads used the existing read-only Tool chain.

## 5. Failure recovery and rollback

A real write-risk request was rejected before V5 investigation and returned one Legacy answer: RISK_NOT_ELIGIBLE=1, V5 write admissions=0. No confirm/write endpoint was called.

Candidate was booted out through its independent supervisor; an explicit owner request received actual Legacy final, no Candidate error body. Restart through launchd restored ready and a subsequent request returned V5.

Full rollback removed only the exact owner ingress, booted out/disabled both user jobs, and left Legacy PID/health intact. No DB restore or Legacy restart. Both jobs were restored and owner ingress re-enabled; a subsequent validated V5 final confirmed intended persistent final state.

RISK_UNAVAILABLE: no new natural production occurrence was induced in P16-H. The unchanged gateway's deterministic test passed, and P16-G's previously certified public fallback seam remains authoritative operational evidence. This is not counted as an additional P16-H real fallback. All 18 frozen gateway tests passed, including timeout, incomplete/invalid bodies, no retry, failed validation suppression and 10 concurrent request isolation.

## 6. Metadata/trace correction

Initial adapter cross-request counters were invalid: root task ownership was read during SDK onStart. A real Phoenix/OpenInference project-wrapper probe demonstrated root attributes count 0 at onStart and 7 at onEnd; ownership absent then present. This was not evidence of Candidate task crossing.

Only the new P16-H metadata adapter was corrected to compare child task ownership against the completed root. Frozen observability/business files were unchanged. Four focused tests cover delayed attributes, actual wrong ownership, orphan detection, disabled startup and ten interleaved trace roots.

One subsequent real owner request returned exactly one content and done. Completed trace: **9 spans, 1 root, orphan 0, cross-request 0**. Source-text leakage check passed. Initial invalid counters were not silently recast as successful measurements; old operational artifact retained in the private ops directory and excluded from final trace validity count.

Persistent files retain fixed metadata and at most 100 outcomes per process. No bodies, runtime facts, reasoning, canonical IDs or credentials are stored. Generic library console output is suppressed, launchd standard streams go to /dev/null. The real SDK uses the local metadata processor; no external collector was provisioned.

## 7. Health, memory and latency

Focused operational checks span startup, restart, the small real corpus, Candidate outage, restoration, full rollback and final adapter probe. Every recorded running-state health was ready and Legacy stayed ready. After restoration, no unrequested Candidate business invocation was observed.

Candidate RSS across the five coverage checkpoints: 144539648–149422080 bytes; final probe RSS 162807808 bytes. This is not a long-duration memory-leak certification. Per-process counters reset at restart and health snapshots are distinguished from current liveness.

Nearest-rank latency, including all eight V5 successes and recovery samples:

- V5 median 4345.17 ms; p95 14606.16 ms.
- Legacy control median 5700.33 ms (2 samples).
- Actual fallback median 3921.49 ms (2 samples).

The 14606.16 ms recovery sample is materially above P16-G p95 and is retained. Its gateway measured 3865.68 ms and Candidate 3702.05 ms; the excess is outside the measured gateway/Candidate work, not evidence for changing the model or scheduler. Small-sample transport timing cannot identify a precise network cause. No tuning or selective sample exclusion occurred. The normal five-group owner samples ranged 2696.73–5270.37 ms.

## 8. Safety and regression

V5 writes=0; allowWrite enabling=0; business mutations=0; Candidate DB mutation successes=0; background mutation jobs=0. Frozen native readonly/route guards remain unchanged. No business value/answer/raw prompt was added to repository artifacts.

Runtime tests 4/4; gateway 18/18; API contract 26/26; full deterministic regression 2209/2210. Sole failure remains missing .guardian/config.yaml. No fix to Guardian or known Deep API snapshot race; no new runtime/API/Tool business semantics. Scoped ESLint PASS.

## 9. Final state and limitations

Owner route enabled; Candidate and gateway supervised, loopback-only, non-root; Legacy running/default; explicit opt-in remains mandatory. Rollback is documented in [runbook](../v5-persistent-owner-read-v1.md).

User LaunchAgents depend on the owner's gui/501 domain and start at login; reboot-before-login availability was not tested or promised. Owner access continues to use the established internal/operator credential mechanism, not a newly designed owner UI. Full trace contents are not retained. No global/percentage/automatic routing, non-owner rollout or write execution.

P16_I_READY=YES for Supervisor review only. Stop; no P16-I work.
