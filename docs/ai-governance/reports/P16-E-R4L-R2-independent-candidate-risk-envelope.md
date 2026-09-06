# P16-E-R4L-R2 Independent Candidate Risk Envelope

Historical R2 verdict below is superseded by [Local Candidate Safety Closure](P16-E-R4L-local-read-only-candidate-runtime.md). The recorded unavailable read is SAFE_AVAILABILITY_FALLBACK, not unsafe admission. Historical counts and failure evidence remain unchanged.

Status: REWORK. P16_E_R4P_READY=NO. No commit and no production access.

Start/End: `6f0c78282050bbe2b1a04bf04f697f85e02d9521`, master, dirty at start. Existing R4L/R1 implementation and historical evidence retained. Original user-owned changes are verified separately from the removable Stage documentation additions.

## Implementation

`candidateRiskEnvelope.cjs` reuses `aiGoalPlannerV3.cjs` domainPlannerPrompt, domainPlannerTool output schema and normalizeDomainPlan. The original V4 implementation is unchanged. A transport-only instruction requests JSON matching the existing schema because Candidate exposes no callable tools. Provider/model selection and unspecified temperature follow the existing V4 provider defaults; no classifier examples or risk rules were tuned. One model request, bounded to 30 seconds with cancellation; no retries or fallback.

Only query/analysis with business-data intent, current-turn context, no ambiguity/clarification and non-low confidence are admitted deterministically. Unknown/missing/invalid output and provider failure reject. No legacy investigation, capability planning, entity execution, answer generation or actual/fake toolSteps are supplied. The normalizer's existing empty domain-phase planning structure is internal, not executed history, and is absent from the Candidate envelope. The caller receives classification metadata only.

Candidate applies this gate before the frozen V5 Interpreter. The lower read-only database guard, route whitelist, lifecycle isolation and all V5 validators remain intact. P16-D's completed-legacy-envelope predicate is unchanged. Rejection returns the existing body-free Candidate unavailable status. Request and result bodies remain transient and are not included in evidence files.

## Measured evidence

- `../data/p16e-r4l-r2-candidate-certification.json`: actual local independent HTTP runtime, real risk/Interpreter/Answer models, existing frozen 15 paths. Risk classification, eligibility, read execution, equivalence, evidence and all six answer validators: 15/15; validated final answers: 15/15; false blocks in this formal run: 0/15. Fact coverage: price 3/3, inventory 6/6, coil 3/3, recipe 3/3; frozen flat-blade and exact-entity groups: 3/3 each.
- Full Candidate median 2332.21 ms, p95 2754.86 ms; risk-only segment median 682.83 ms, p95 974.26 ms. Full latency includes the pre-existing test comparator preparation. No model tuning.
- `../data/p16e-r4l-r2-write-boundary.json`: seven real HTTP negatives (delete, create, update, inventory, price, order, mixed read/write), including the exact prior delete case. All classified command and rejected before V5: Interpreter/entity resolution/read tools/Answer calls/business answers = 0. Three repeats each of delete, inventory mutation and an inventory read: 9/9 stable.
- Mutation guard and isolated schema tests remain PASS. Startup migrations/checkpoints/business mutations/background mutation jobs = 0; shutdown checkpoint/business mutations = 0. No write enabling calls, mutation Business APIs or successful Candidate database mutations. Fixture logical state MATCH, physical database unchanged. Candidate children exit 0; independent port closure tested.
- Formal trace capture: 147 spans for reads and 14 for negatives; orphan spans, cross-request contamination, source-content leakage and forbidden business fields = 0. Test trace capture exercises existing OTel/OpenInference wrappers with an in-memory Phoenix-compatible tracer, not a production Phoenix deployment.

## Remaining stability failure

`../data/p16e-r4l-r2-risk-stability.json` retains the initial EXACT_RECIPE_COST risk probe's unavailable/invalid envelope and three subsequent successful read classifications. The formal HTTP run also admitted that group 3/3. The initial probe had contractValid=false and rejected admission. Its provider/JSON/schema/normalizer failure was collapsed into RISK_UNAVAILABLE; raw output was not retained, so the precise underlying failure cannot be attributed retrospectively.

Although the formal frozen run and the planned 9 repeat samples pass, the aggregate observed read admission is not stable: this frozen read was rejected once and admitted later. Overall Risk Classification Repeat Stability = FAIL. No retry-until-pass evidence selection, prompt tuning, relaxed validation or V5 fallback was used to hide it. Safety remained fail-closed; no unsafe admission was observed. Supervisor review is required before a reliability repair outside the unchanged classifier contract.

## Verification and closure

Focused Candidate/risk tests: 8/8. P16-D response mux regression: 6/6. Frozen V5: 393/393. API contracts: 26/26. Full suite: 2163/2164, only the known missing `.guardian/config.yaml` failure; runner preflight also passes 2/2. Regression uses the isolated HEAD checkout plus Stage files, excluding unrelated user modifications and retaining frozen source bytes.

Final verification: all 24 original user-owned file hashes match after removing only the recorded Stage documentation additions. Index is empty and HEAD unchanged. No Candidate worker processes remain; the formal Candidate port is closed. `git diff --check` passes. No failure artifact contains raw requests, business values, answers or logical fingerprints.

Production access/deployment/configuration changes: NO. No Mac mini request. No V5 production canary. Stage changes remain uncommitted because repeat-stability acceptance failed. Do not begin R4P.
