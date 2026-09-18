# P16-I-FINAL — Owner Default Read-to-V5 Production Activation

## Executive result

PASS. Production owner-default read preference is ON after one controlled certification and a successful OFF rollback test. Source default remains OFF. This is owner-only, not global cutover. Legacy remains revision `12fee179b6074215cf359bcc1a789ce1a345b9ba`, PID 59155, healthy and unchanged. No P16-J work is included.

Start commit: `594b20637827ec8664ee741226479f8eac6f3bdc`, master. User-owned dirty V4 code/tests/package and separate documentation hunks remain excluded.

## Persistent revision and routing boundary

The separate Candidate is now `/Users/dan/pump-v5-candidate-594b206-final`, running the exact Git archive of 594b206. Archive SHA-256: `1fe9334ec2628976b91e02d79ce1a8182be0f92de869c5ae406a7e5a0d69e2a7`. No user-owned dirty files were copied into it. Existing dependency directories are reused; no dependency installation. Candidate listens only on `127.0.0.1:3102`, final PID 76974, supervised by the existing LaunchAgent.

The existing separate gateway now also accepts ordinary POST `/api/ai/chat`. Only that ingress path is added; auth routes, explicit canary and all other ingress remain unchanged. Legacy files/process are not replaced. The ordinary path forwards original caller authentication to Legacy, never injecting the gateway service credential. Candidate is called with the existing private internal authentication only after the exact owner check.

Identity is `verifyAuthentication → isAuthenticatedOwner`, requiring signed JWT with the established stable subject and owner-credential authentication marker. A shared admin role, client marker, IP or internal service credential cannot activate owner-default routing. Authentication code remains unchanged.

Gate storage: `/Users/dan/pump-v5-owner-ops-p16h/owner-default.json`, mode 0600, read on each request. Only literal true enables `AI_V5_OWNER_READ_DEFAULT_ENABLED`; missing/invalid config fails to Legacy. Reversible commands use `manage-v5-owner-default.cjs gate-off` / `gate-on`. No Legacy restart or DB restore is needed. Secrets and production `.env` are not changed.

The initial Candidate bootstrap hit a LaunchAgent unload/reload timing failure before public/default activation. It was recovered through a bounded infrastructure start, not a model retry. Candidate/gateway health was verified before ingress and certification; Legacy stayed available. The deliberate later unavailable test also restored Candidate normally.

## Authority preserved

Interpreter V3, R4 price/inventory split, R8 limits 8/512, coil-only R9 exact span fast path, governed lookup, Stage2, Tool/binder/evidence/answer contracts are unchanged. The Candidate archive itself has no stage edits. Only the external supervision adapter adds fixed metadata counters/fact classification, not business values.

Normal owner requests need neither `x-pump-v5-use` nor `x-pump-v5-fact`. Server fact derivation remains authoritative. Existing Candidate input restrictions remain: one user message and no extra context fields. Multi-turn/context/unsupported requests fall back intact to Legacy; the gateway does not discard history or infer eligibility from keywords.

## Production applicability

Before requests, current authoritative APIs showed that the historical literal flat-blade identity and historical exact recipe identity are absent. As established in P16-E-R4P-R1, current production equivalents were selected deterministically before observing any answer: stable canonical-ID ordering, first complete exact lookup with one candidate of the intended type, bounded to the first 20 records. No model selected replacements; no DB identity or value was changed.

The production recipe uses its complete current exact identity and retains recipe.cost.preview. The price/inventory projection uses a current formal part identity. Historical `800平刀` remains covered by the local frozen regression, **not** a claimed literal production hit. Current production cannot certify a literal absent object or recreate its historical collision. This applicability distinction is not hidden by the PASS verdict.

## One-shot routing matrix

13 HTTP requests; no diagnostic headers on ordinary requests; no automatic request/model retry.

| Scenario | Candidate attempted | Final result |
|---|---:|---|
| Owner, flag OFF | 0 | Legacy, one final |
| Owner price, ON | 1 | Validated V5; price.current |
| Owner inventory, ON | 1 | Validated V5; inventory.quantity |
| Owner coil schemeName, ON | 1 | Validated V5; coil.inventory |
| Owner coil schemeCode, ON | 1 | Validated V5; coil.inventory |
| Owner exact current recipe, ON | 1 | Validated V5; recipe.cost.preview |
| Shared admin, ON | 0 | Legacy, owner=false |
| Unauthenticated, ON | 0 | Existing 401 behavior |
| Owner write-risk, ON | 1 risk-only | RISK_NOT_ELIGIBLE; Legacy final |
| Candidate stopped, owner read | 1 connection attempt | Safe Legacy final |
| Candidate restored, owner read | 1 | Validated V5 |
| Explicit P16-H canary | 1 | Validated V5 |
| Owner, rollback OFF | 0 | Legacy final |

Five primary reads all passed mapping, numeric, entity, evidence and answer validation. Six ordinary owner reads produced V5 finals, plus one explicit canary. Total Candidate attempts 9 (including refused connection); Candidate read-eligible 7; Legacy business-answer finals 5; one unauthenticated 401 is not counted as an answer. Safe fallbacks 2: write-risk and unavailable Candidate. Candidate-caused failures, unsafe admissions and double answers are zero.

Write-risk was rejected before Interpreter: attempted=false, fact derivation 0, Tool 0, answer 0. No allowWrite enabling or mutation requests were added. V5 writes and Candidate DB mutation successes remain zero. Failure handling unit tests cover risk/validation/error/timeout/partial/duplicate Candidate streams: all Candidate content is discarded before one Legacy fallback. No raw or failed-validation Candidate body is exposed.

## Latency

Gateway request-arrival to response completion, without mixing in shadow completion:

- Owner V5, n=6: median 3748.243 ms, nearest-rank p95 5053.472 ms.
- Safe fallback, n=2: median 3309.407 ms (write rejection plus unavailable transport).
- Legacy controls, n=3: median 4749.474 ms (OFF, shared admin, rollback).

Public client observations including transport and bounded metadata reconciliation: owner median 4567.081 ms, p95 9272.375 ms. These are small descriptive samples, not a paired speedup claim. No model, scheduler or concurrency tuning was performed.

## Safety and tests

Production certification pre/post DB hash, mtime, size and backup count are unchanged. Legacy PID stays 59155; final health PASS. Credentials/JWTs, raw questions, answer bodies and runtime values remain transient; persistent runtime suppresses generic library logs and records fixed metadata only. Private-value metadata check is zero. Recorded trace orphans and cross-request contamination are zero; earlier pre-restart trace counters were also checked at zero.

Gateway/owner/P16-H/risk focused tests 35/35; API contract 26/26; build PASS. Full deterministic regression 2239/2240: only known missing `.guardian/config.yaml`. Deep API reproduces the previously-attributed copperBase/formal API race; neither old issue was modified or hidden. Frozen local 15-path deterministic regression remains PASS, including price 3, inventory 6, coil 3, recipe/Exact 3 and the historical flat-blade group. No formal frozen model evaluation was rerun.

Deployed gateway, supervision adapter and unchanged owner-auth module hashes match the tested local files. User dirty work remains isolated. Ordinary owner-default is ON at handoff; shared/non-owner routing, writes, percentages and Legacy retirement are not enabled. Stop for Supervisor Review.
