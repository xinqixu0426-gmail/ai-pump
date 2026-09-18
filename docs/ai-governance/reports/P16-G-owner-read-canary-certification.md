# P16-G Owner-Only Explicit Read Canary

## Executive result

PASS for the explicit internal/operator canary only. P16-F is accepted as PASS per Supervisor: legitimate read risk rejection is availability fallback, not unsafe admission. No P16-H work, automatic routing or persistent activation is performed.

Development baseline: 15091c9ec4c462b1a1906952d3fdd788502d2ece. Candidate uses that frozen artifact. Legacy remains 12fee179b6074215cf359bcc1a789ce1a345b9ba, PID 59155 before/after, healthy. User-owned changes are excluded from the stage commit.

## Authentication and ingress

Dedicated loopback Node gateway, POST /api/ai/owner-read-canary, port 3103. Candidate stays 127.0.0.1:3102; Legacy stays 3002. Existing production internal authentication is reused with constant-time comparison. The shared admin JWT is not treated as proof of sole ownership; this stage admits internal/operator identity only. No credential is created, copied to an artifact, changed or exposed to a browser.

Global AI_V5_OWNER_CANARY_ENABLED defaults OFF. A valid internal identity, per-request x-pump-v5-use:true, an approved fact key and the single-user-message contract are all necessary. Headers alone without valid credentials are insufficient. No cookie/cohort/sticky selection.

The existing remotely managed Cloudflare Tunnel accepted an additive exact path rule for the existing hostname. All original ingress and origin settings were retained. The rule was removed after each certification window and the original configuration compared equal. No DNS, launch daemon, production application file, legacy environment or PID was changed. The independently started gateway was stopped. The authenticated canary path was public-facing during certification; the Candidate listener itself was never publicly exposed.

## Response selection and safety

The frozen Candidate exclusively owns risk, Interpreter, verified evidence and answer validation. The gateway has no Tool/DB/business access. It buffers a bounded Candidate stream and accepts only one complete content/done response from the authenticated fixed loopback Candidate. Any error/extra/partial/non-SSE response is discarded. The gateway invokes the real existing Legacy /api/ai/chat once, without V5 headers or write-enabling options. It does not synthesize fallback text or use a second Candidate generation. Original legacy SSE/confirmation policy is preserved.

Write-risk live request: classifier command, eligible=false, Interpreter not attempted, legacy final successful. Candidate mutation guard and native read-only schema safety passed. No write execution, approval submission or business mutation is performed by this stage.

## Actual production-facing evidence

15 production-applicable reads, five source groups, all return validated V5 final answers. Read execution SUCCESS, result equivalence MATCH, evidence verification PASS and answer validation pass for all 15. R4P-R1 applicability reconstruction is frozen before model calls: 12 direct identities plus three recipe paths projected by the same deterministic production-authority rule. Historical missing identities are not recreated.

| Group | Requests | Validated V5 finals |
| --- | ---: | ---: |
| Coil inventory | 3 | 3 |
| Exact recipe cost preview | 3 | 3 |
| Part/template identity disambiguation | 3 | 3 |
| Inventory primary | 3 | 3 |
| Price | 3 | 3 |

Two invalid-identity requests return 401 and make zero backend calls. Two controls (no-marker gateway and original public legacy chat) produce legacy answers with no Candidate attempt.

Four server-side transport injections (RISK_NOT_ELIGIBLE, RISK_UNAVAILABLE, connection unavailable, partial content followed by validation error) produce real legacy answers, no injected body leakage, exactly one content and one done. These are explicitly injected frozen-Candidate outcome substitutes, not natural provider failures. One additional real write-risk rejection produces legacy fallback. One long-stall timeout probe also produces legacy fallback.

Total explicit owner tests: 21; routing attempts 21, of which real Candidate risk invocations 16 and transport injections 5. Eligible real Candidate requests 15; V5 finals 15; SAFE_LEGACY_FALLBACK 6. Legacy finals 8 including two ordinary controls. All authorized requests complete; Candidate-caused failures 0, duplicate final answers 0. RISK_NOT_ELIGIBLE fallback count 2 includes one legitimate injected read rejection and one real write-risk rejection; RISK_UNAVAILABLE injected fallback count 1.

Real positive read availability is 15/15. Across the deliberately mixed positive/negative/failure-injection population, Candidate final count is 15/21; that is not an unbiased production availability estimate.

## Latency and timeout correction

Nearest-rank descriptive statistics: successful V5 median 3945.04 ms, p95 4920.00 ms. SAFE_LEGACY_FALLBACK median 5818.59 ms across six fallbacks; too few samples for a robust p95 claim. Legacy control median 8048.17 ms across two controls. These are actual public HTTPS completion measurements, not shadow completion time.

Post-run transport review identified that the initial gateway 180-second silent Candidate wait could outlast the public proxy. The durable gateway now caps Candidate transport waiting at 60 seconds and aborts once before entering real Legacy; Candidate model settings and its 180-second internal lifetime were not modified. The 15 real successes completed below both budgets; no Candidate/model was retried to improve their results. A separate actual public-path probe with Candidate transport deliberately stalled certified the final default timeout: headers 61799.84 ms, final completion 66320.35 ms, HTTP 200, one legacy answer, no error event. Only the real Legacy model ran for that probe; Candidate remained stopped.

This long-stall fallback imposes about a minute of extra wait and is a material availability/UX limitation for any broader rollout, not an observed unsafe admission. No scheduler/model tuning was performed. Cloudflare documents a default 125-second proxy read timeout: [Error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/).

## Privacy, traces and isolation

Metadata-only fixed gateway outcome schema, no request/response bodies, raw facts or credentials. Frozen Candidate real Phoenix/OpenTelemetry captured 149 spans and 16 roots in memory: zero orphan spans, cross-request contamination, source-text matches or forbidden business-value fields. V5 outcome internal leakage count is zero. Candidate/model/fallback bodies are transient only; datasets contain status/count/type/latency metadata, not text or values. Legacy remains its unchanged implementation, not a new observability pipeline.

Ten concurrent synthetic gateway requests preserve distinct bodies and request IDs with zero crossing. No Candidate partial output appears on fallback. Runtime logs are not used as a body store.

Main certification production DB hash/mtime/size and backup count matched; production .env hash matched. Native Candidate guard rejects mutation before execution. The timeout probe starts no Candidate/DB path and forwards only a legacy read request. No production files or DB content were edited, repaired or restored.

## Verification

- Gateway tests: 18/18, including auth, default OFF, nonsticky marker, single final, error/incomplete/timeout fallback, fixed loopback targets and concurrent isolation.
- API governance: 26/26; separate Node gateway is explicitly included in inventory without pretending it is an Express route.
- Full deterministic regression: 2205/2206; only known missing .guardian/config.yaml on final run.
- An earlier run's substring privacy assertion against '123' failed once, isolated rerun passed; no frozen evidence or runtime test was modified.
- Deep API: existing search_coils copperBase snapshot comparison failure remains. No relation to gateway imports/execution and no fix in this stage.
- Build and focused ESLint: PASS.
- Production/public ready checks pass after closure; original legacy PID unchanged; both added ports closed.

An initial operator harness preflight had an incorrectly escaped PEM regex. It failed before ingress/model calls; its read-only child was explicitly stopped. Corrected preflight read the unchanged configuration version 8 successfully before certification. This is recorded as harness setup failure, not an omitted business result.

## End state and next-stage boundary

Temporary owner route activation removed, gateway stopped, Candidate stopped and port closed. Original ingress restored exactly; normal production remains legacy-only. No source push/deploy into legacy, no percentage rollout, no write enablement and no retirement.

P16_H_READY=YES for Supervisor review only. The canary does not authorize general users, persistent routing or a wider rollout. Any later activation must use the reviewed durable gateway and repeat environment/auth/closure checks.
