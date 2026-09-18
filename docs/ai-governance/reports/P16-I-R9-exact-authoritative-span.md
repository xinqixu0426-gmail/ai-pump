# P16-I-R9 — Deterministic Exact Authoritative Span Fast Path

## Decision and scope

PASS. R8 bounded span supply is retained, with a coil-only exact-authoritative source selection branch. Owner-default routing stays OFF. No Stage1 prompt/model/contract/settings, Stage2, resolver, lookup semantics, entity finalization, Tool, evidence, answer, authentication or scheduling changes.

Start: master `4d71c688e8abc74e7bf8b6b6ba8b59600cf26cfb`. R8 and R9 are one coherent stage change; unrelated dirty V4 code/tests/package and documentation hunks are excluded from staging. This is not a persistent production deployment or P16-I resume.

## Authority and decision table

Risk preflight precedes supply and selection. Only complete validated R8 Business API coil candidates qualify: approved schemeName/schemeCode kind, bounded count/scan, valid UTF-16 offsets and exact source text. Structural catalog membership is not sufficient authority.

| Unique source occurrences | Decision |
|---|---|
| 0 | Existing Stage1 model and Top2/refinement unchanged |
| 1 | Deterministic exact source selection; Stage1 calls 0; one mandatory governed lookup |
| >1 | `AUTHORITATIVE_SPAN_AMBIGUOUS`; no Stage1, lookup, Tool or Answer |

Only identical offsets/text with compatible complete-identity kinds dedupe. Distinct source occurrences never collapse, even if a later lookup might find the same entity. Duplicate business records are not resolved by this dedupe. Source supply never returns canonical IDs; the existing resolver, local Task Class and finalizer retain entity authority. NOT_FOUND is final for the exact branch; no nested search is started. Resolver error/incompleteness fails closed; same-type and cross-type candidate ambiguity remains intact.

R8 limits remain 8 returned candidates and 512 identity field records (513th is an overflow sentinel); the full registry is never exposed. There is no partial/fuzzy/n-gram matching, business keyword rule, first-result entity selection or model retry.

## Local deterministic evidence

- R8 supply tests: 9/9; exact strings/punctuation, partial/nonexistent negatives, duplicate business records, candidate/scan overflows, merge bounds, HTTP contract and read-only privacy.
- R9 focused tests: 7/7; exactly-one/zero/multiple, compatible dedupe, invalid/non-coil authority, unchanged zero-candidate Stage1 input, mandatory lookup, notfound/error, same-type ambiguity, Candidate risk ordering and no business answer exposure on rejection.
- Frozen local 15-path fixture reconstruction: price.current 3/3, inventory.quantity 6/6, coil.inventory 3/3, recipe.cost.preview 3/3. Exact Entity and 800 group each 3/3; false blocks 0. This is deterministic fixture regression, not a new real-model frozen evaluation.
- Combined V5: 404/404, including R02 three-case exclusion and evidence/answer safeguards.
- Owner identity / P16-H / Candidate risk and interpreter focused suite: 51/51 before the additional Candidate-level R9 guard test. Shared admin is not owner; default routing remains disabled.
- API contract: 26/26. Build PASS.
- Full regression: 2237/2238 at the recorded run; sole failure is existing missing `.guardian/config.yaml`. The subsequently added Candidate-level guard also passes separately.
- Deep API reproduces the already-attributed `search_coils.copperBase` versus formal API race. No old code or test was repaired, retried to hide the failure, or attributed to R9.

## One-shot production Candidate acceptance

Disposable code runtime: `/Users/dan/pump-v5-p16ir9.LAHtfC`, loopback port 3114, native read-only production snapshot access. Only committed baseline plus explicit R8/R9 production files were overlaid; user-owned dirty code was not deployed. No production configuration changed. The original request digest and the previously frozen three-path ordering are checked before model calls. No request body, identity value or answer body is persisted.

| Check | Original schemeName | Frozen coil set |
|---|---|---|
| Complete authoritative exact candidate | 1 | 3/3, one each |
| Deterministic source selection | PASS | 3/3 |
| Stage1 model calls | 0 | 0 |
| Governed lookup / Stage2 | PASS / PASS | 3/3 / 3/3 |
| Task Class / final entity / coil.inventory | PASS | 3/3 |
| Tool / comparator / evidence | PASS / MATCH / PASS | 3/3 |
| Numeric / identity / validated answer | PASS | 3/3 |
| Retry | 0 | 0 |

The set is the original name request and two frozen code-request repetitions, not three different entities. Three Stage1 calls were avoided. Risk model, Stage2 and answer still run normally: three calls each across this set, with no additional model phase.

## Performance

Original end-to-end request completion: 4040.961083 ms. Three-path median: 3102.936000 ms; nearest-rank p95: 4040.961083 ms. Deterministic selection median: 0.125208 ms; p95/max: 0.267583 ms. Synthetic 1000 measured selections after 100 warmups: median 0.003200 ms, p95 0.006600 ms.

These are descriptive one-shot samples, not a paired latency certification or a claim that the original previously-failing request became faster. R9 removes Stage1 work; it does not tune scheduler or model performance.

## Privacy, safety and runtime closure

Formal pre/post implementation hashes MATCH. Production database hash/mtime/size, `.env` and backup count unchanged. V5 writes, allowWrite enabling, business mutations and Candidate mutation successes are zero. Models receive no canonical identity from span supply. Answer/body/runtime facts remain transient and absent from logs/report/dataset; private request/body and credential log checks report zero leaks. Output contains metadata only.

Temporary Candidate closed normally; port 3114 closed. Legacy PID 59155 and persistent Candidate PID 75736 remain unchanged and healthy; gateway PID 75637 remains healthy. No Legacy restart, default routing, normal traffic change or Candidate supervisor change. Existing explicit-owner service remains operational, supported by unchanged live health and owner/P16-H regression; R9 did not perform an extra credentialed owner request beyond the authorized isolated three-path run.

## Supervisor handoff

Safe dataset: `docs/ai-governance/data/p16i-r9-exact-authoritative-span-certification.json`.
Reproducible fixtures: `scripts/check-v5-r9-frozen-regression.cjs`.
One-shot real harness: `scripts/certify-v5-exact-authoritative-span.cjs` (do not rerun automatically).

P16_I_RESUME_READY=YES, subject to the separate Supervisor decision to resume. No unique R9 blocker remains. Known Guardian and Deep API failures are reported above, not hidden. Stop after selective R8+R9 commit; do not enable owner-default or resume P16-I.
