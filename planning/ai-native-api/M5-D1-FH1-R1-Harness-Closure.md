# D1 Final Harness FH1-R1 closure

This change repairs acceptance measurement only. It made no product-runtime, Business/Policy, ontology, fixture-semantic, schema, executor, API, Cost Engine, Fact Ledger, or Answer Validator change. No fresh model run and no real-business-database read occurred.

The evaluator now reads `recipe_cost_difference.qualifiers.participants.left/right` and checks the formal direction. Scenario previews which formally return `REQUESTED_CHANGE_NOT_APPLIED` or `NON_COMPARABLE` are counted as safely rejected outcomes—not as unsupported execution. Money-basis telemetry is claim-scoped, so a valid answer can cite current/base, candidate, and delta facts together.

The new repetition runner plans seven independent cases three times each (21 total) behind explicit model opt-in. Every final-run record persists safe traces, formal outcome receipts, finalization attempts, validation, context, duration, and memo hashes. The real-catalog runner initializes environment before runtime imports and rejects test/temporary database configuration before any formal oracle call.

`d1FinalAcceptanceManifest.cjs` separates the frozen product baseline from the harness commit and fingerprints the candidate, prompts, policy sources, ontology, index, canonical schemas, fixture, evaluator, and every runner. The Final V2 artifact names are fixed in the evidence serializer; no synthetic acceptance result was generated.

Deterministic evaluator/harness tests pass. Full repository gates pass: `npm test` 2295/2295, API contract 29/29, deep API 486/486, lint, build, AI architecture 9/9, and release verification. The next phase may run Final Acceptance V2 only after producing a new frozen source manifest from the committed harness.
