# D1 Final Acceptance V2-R1 — infrastructure failure before fresh model runs

The corrected pre-run baseline passed. The checked-out evidence head was `6868d18a4ae7c49d89560a1f4c3fab8458cc0732`; product drift passed; API Index count and fingerprint matched; and the Final Manifest's canonical `scenarioToolSchemaFingerprint` was the expected `3a3f5a4e16aaf5da96526b73863bd9da178fcd5f18a44af825276f72204db542`. The historical R5A `scenarioFlowSchemaFingerprint` (`05d052…`) was correctly treated as a different metric.

The pre-run deterministic gate also passed: `tests/d1FinalAcceptanceEvaluator.test.cjs` 15/15 and `npm test` 2296/2296.

Controlled Full then stopped before any Business, Policy, or Main Agent model call. The frozen runner threw `TypeError: environment is not a function` at `run-d1-final-controlled.cjs:33`, because it imports `environment` from `run-d1-r1-controlled.cjs`, which does not export that function. The runner did not persist an authoritative result file; no semantic sample can be inferred from this failure.

This is an acceptance-harness infrastructure defect, not a product behavior result. Per the no-fix-in-place rule, no harness or product code was changed, and repetition/real catalog runs were not started. A repair phase must export or locally define the environment initializer, then restart Final Acceptance with a newly frozen harness commit and fresh runs.
