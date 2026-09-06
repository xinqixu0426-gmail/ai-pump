# P16-E-R4L Local Read-Only Candidate Runtime — Safety Closure

Status: PASS under P16-E-R4L-CLOSE's revised safety contract. P16_E_R4P_READY=YES permits Supervisor to authorize a later parallel environment validation; it is NOT deployment, traffic cutover, write or legacy-retirement authorization.

## Scope and ownership

Start HEAD: `6f0c78282050bbe2b1a04bf04f697f85e02d9521`, master, dirty at start. Continue R4L/R1/R2, not a rebuild. Only Candidate code/tests/safe artifacts and Candidate documentation paragraphs enter one coherent commit. Unrelated dirty V4 code/tests/documentation stay outside it. No stash/reset/clean or production access.

## Safety versus availability

Existing `aiGoalPlannerV3.cjs` domain prompt/schema/normalizer remains the risk authority, reused through `candidateRiskEnvelope.cjs`. Tools NONE; no legacy investigation, resolver, Business API, DB or answer work in risk classification. Explicit query/analysis, current-turn business intent, no ambiguity and non-low confidence are deterministic admission conditions. No actual/fake legacy toolSteps.

Closure adds only metadata at the existing pre-Interpreter return: unavailable/invalid classification is SAFE_AVAILABILITY_FALLBACK, valid disallowed risk is RISK_NOT_ELIGIBLE. Neither enters V5. No classifier prompt/model/temperature/timeout/retry/few-shot/special-case/heuristic change. P16-D continues its original completed legacy envelope.

A future production integration must route SAFE_AVAILABILITY_FALLBACK to the existing legacy/current response path rather than returning V5. This standalone local runtime keeps its body-free unavailable error; production fallback is NOT implemented.

## Unsafe admission stability

- Seven established negative HTTP paths, three repetitions each: 21/21 rejected before V5, all classified command. Previously failing delete: 3/3 rejected. Interpreter/entity resolution/read Tool/answer model/business answer on rejected paths: zero.
- Independent risk-only repeats of two write negatives: 6/6 rejected.
- Seven injected classifier failures (unavailable, exception, timeout, invalid contract, unknown mode, unexpected field, malformed response), three repetitions each: 21/21 SAFE_AVAILABILITY_FALLBACK. All instrumented downstream entry counts zero.
- Unsafe Admission Stability PASS. Finite testing does not prove a model classifier infallible on arbitrary future input; lower write exclusion and read-only DB protection remain essential.

## Read availability

Historical R2 exact-group cohort: one initial unavailable classification followed by three successes. Its raw output was not retained, so the provider/JSON/schema sub-cause remains unknown. R2's three other read repeats and CLOSE's three read repeats succeeded. Combined repeat/probe availability: 10 attempts, 9 success, 1 safe fallback. No automatic retry. Historical failure is preserved, not overwritten by the new formal result.

R2's previous repeat-stability FAIL is an availability acceptance verdict superseded by the explicit CLOSE safety contract; it was never an unsafe admission.

## One formal CLOSE frozen read run

`../data/p16e-r4l-close-candidate-certification.json`: one new 15-path run, separate from historical evaluations. A pre-call reservation and safe per-path checkpoints prevent silent reruns after interruption.

Risk successes 15/15; safe fallbacks 0/15; eligible 15/15. Validated answers, real reads, result equivalence, evidence verification: 15/15 each. Answer contract, evidence refs, grounding, required facts, numeric and entity checks: 15/15 each.

price.current 3/3; inventory.quantity 6/6; coil.inventory 3/3; recipe.cost.preview 3/3. Frozen flat-blade and Exact Entity answers: 3/3 each. Unsupported claims/internal metadata leaks: zero.

Risk median/p95 670.4605/1056.5666 ms. Candidate HTTP median/p95 2421.0101/2896.0278 ms, including existing comparator preparation. These are local completion timings, not production load certification. No optimization or model rerun.

A legitimate fail-closed classifier fallback would be reported separately, not as a successful V5 answer. None occurred in this formal run.

## Runtime and database safety

PUMP_V5_CANDIDATE_RUNTIME defaults false. Independent executable/PID, authenticated loopback-only independent port excluding 3000/3001/3002. Ordinary entry rejects Candidate mode before normal initialization; OFF preserves its original lifecycle.

Native SQLITE_OPEN_READONLY plus per-handle statement/exec/pragma/backup/extension guards. Read-only migration name/version/checksum and user-version compatibility; incompatible schema fails closed. No V5 SQLite imports: existing governed Business APIs retain authority.

Candidate startup/import exclusions prevent migrations, WAL checkpoints, seeds/copper/quote/knowledge/backup/audit mutations and background mutation jobs. Shutdown closes server/read handle/observability only, no checkpoint or mutation. Tests cover DML/DDL/PRAGMA/VACUUM/backup and scheduled callbacks. Successful Candidate DB mutations, V5 writes, allowWrite enabling and mutation API calls: zero.

Formal fixture logical state MATCH, physical bytes unchanged. Main business DB hash/mtime/size/backup count unchanged. Both real certification children exit 0; their ports close. Independent lifecycle test confirms another server survives. No production environment access or modification.

## Trace and privacy

Read trace: 147 spans; negative trace: 42. Orphans, cross-request contamination, source leakage and forbidden business attributes: zero. Existing observability wrappers captured through in-memory Phoenix-compatible tracer, not a remote Phoenix deployment. Bodies/facts remain transient; safe structural metrics only are retained.

## Regression and frozen implementation

Candidate/risk tests 8/8, separate failure certificate 21/21; P16-D mux regression 6/6. Frozen V5 393/393; combined with Candidate 401/401. API contracts 26/26. Isolated full suite 2163/2164, only known missing .guardian/config.yaml; runner preflight 2/2.

Initial isolated setup lacked ignored backups directory and Web TypeScript dependency link. Supplied an empty local directory and linked existing dependencies, then reran deterministic tests only. No implementation change or formal model rerun. Known Deep API race remains out of scope, not repaired or certified anew.

Certified Candidate implementation bytes match the isolated formal-run copy. Existing frozen V5 and classifier source are unchanged. User-owned dirty bytes and mixed-document user hunks remain preserved.

## Evidence and historical provenance

Current CLOSE candidate, write-boundary, failure-injection and safety-summary JSON in ../data/. [R1](P16-E-R4L-R1-eligibility-audit.md) and [R2](P16-E-R4L-R2-independent-candidate-risk-envelope.md) retain superseded historical verdicts. Original R4L negative evidence truthfully records the missing admission guard at that time; R2/CLOSE demonstrate rejection before V5. Historical artifacts are not counted as CLOSE formal runs.

Stage commit is the commit containing this report. No push, SSH, deployment or production request. STOP for Supervisor Review; do not begin R4P.
