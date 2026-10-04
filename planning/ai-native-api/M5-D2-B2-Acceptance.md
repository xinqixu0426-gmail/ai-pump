# M5 D2-B2 Operational Agent Acceptance — stopped run

Status: **REWORK**. This is not a passing Wave 1 acceptance result.

The isolated fixture, formal Oracle construction, controlled ten-case plan, and 15-run repetition plan passed no-model preflight. `npm test` also passed (2320/2320). The acceptance-only harness was frozen at `bdbd2e7` before explicit provider opt-in.

The first displayed runner invocation completed asynchronously after the tool wrapper returned and produced the authoritative controlled artifact. It contains 10 serialized fresh runs, with **2/10 semantic PASS** (`W1-03`, `W1-04`) and zero temporary-business-DB mutations. The second invocation did not create an additional evidence artifact and is not used for scoring.

The eight failures are not missing tool discovery or failed formal execution. Each got formal operational evidence, but Finalization attempted multi-quantity assertions that the operational numeric validator rejected with `OPERATIONAL_QUANTITY_BINDING_MISMATCH`; after two rejected attempts, the generic fallback incorrectly stated that the formal business capability could not complete the request. This is a real product reliability failure, not an evaluator relaxation candidate.

The same preflight also exposed an incomplete harness: its manifest has `realRunnerHash: null`; no D2-B2 real-catalog runner exists. The required REAL-W1-01 through REAL-W1-05 suite cannot be performed with this frozen harness.

No product implementation was modified. No local business database was opened by the D2-B2 runner; the only database opened was the temporary isolated fixture. No deployment was attempted.

Required next action: diagnose and repair the generic operational quantity finalization/validator interaction in a new implementation phase, then complete a real-catalog runner and restart the entire D2-B2 acceptance matrix from zero. Do not reuse this failed controlled matrix as a passing sample.
