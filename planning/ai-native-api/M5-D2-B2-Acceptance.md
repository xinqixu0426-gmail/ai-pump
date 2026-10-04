# M5 D2-B2 Operational Agent Acceptance — stopped run

Status: **REWORK**. This is not a passing Wave 1 acceptance result.

The isolated fixture, formal Oracle construction, controlled ten-case plan, and 15-run repetition plan passed no-model preflight. `npm test` also passed (2320/2320). The acceptance-only harness was frozen at `bdbd2e7` before explicit provider opt-in.

The first displayed runner invocation completed asynchronously after the tool wrapper returned. Before its late completion was observed, a second invocation was mistakenly started with the same output path. Both were provider-enabled semantic matrices, and the later completion overwrote the earlier artifact because this first harness version has no exclusive run directory or output lock. The remaining file contains one complete 10-case matrix with **1/10 semantic PASS** (`W1-04`) and zero temporary-business-DB mutations, but it cannot be authoritative because the other requested semantic samples were not retained. No score is accepted for this run.

The retained matrix's failures are not missing tool discovery or failed formal execution. They got formal operational evidence, but Finalization attempted multi-quantity assertions that the operational numeric validator rejected with `OPERATIONAL_QUANTITY_BINDING_MISMATCH`; after two rejected attempts, the generic fallback incorrectly stated that the formal business capability could not complete the request. This is a real product reliability failure, not an evaluator relaxation candidate.

The same preflight also exposed an incomplete harness: its manifest has `realRunnerHash: null`; no D2-B2 real-catalog runner exists. The required REAL-W1-01 through REAL-W1-05 suite cannot be performed with this frozen harness.

No product implementation was modified. No local business database was opened by the D2-B2 runner; the only database opened was the temporary isolated fixture. No deployment was attempted.

Required next action: diagnose and repair the generic operational quantity finalization/validator interaction, add a real-catalog runner, and make runner output run-unique/exclusive in a new harness/product phase. Then restart the entire D2-B2 acceptance matrix from zero. Do not reuse this failed controlled matrix as a passing sample.
