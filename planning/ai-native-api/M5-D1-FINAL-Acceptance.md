# M5-D1 Final Acceptance — Pre-run Blocker

## Result

**BLOCKED before authoritative acceptance.** The frozen source commit is exactly `82b0dce603c7ee2c715a55799ce1b04db0344bc7`; no product source, fixture, evaluator, prompt, schema, or API behavior was changed.

The Final Acceptance instructions require safety numbers to be computed from real execution evidence and require the real-catalog suite to distinguish business outcome, safety outcome, and delivery outcome. The frozen real-catalog runner cannot provide that evidence.

## Freeze and workspace check

- Branch: `ai-native/m3-optimization-v1`
- Expected source commit: `82b0dce603c7ee2c715a55799ce1b04db0344bc7`
- Actual source commit: `82b0dce603c7ee2c715a55799ce1b04db0344bc7`
- Pre-existing Owner changes preserved: `docs/README.md`, `docs/ai-assistant.md`
- Product-code diff from the frozen source before this report: none under `api/`, `scripts/`, or `tests/`.

## Blocking evaluator defect

The controlled Fixture runner is not the blocker: it contains a per-case business-outcome oracle and derives key safety values from candidate traces and formal outcome receipts.

The required real-local-catalog runner, [run-d1-smoke.cjs](../../scripts/ai-experiments/api-native-agent/run-d1-smoke.cjs), is an older evaluator and cannot be used for an authoritative Final Acceptance:

1. Its `safety()` function returns fixed zero values for all accepted safety categories (`writeExecutions`, invented identities, money-binding failures, unsupported overrides, and others). Its aggregate merely sums those fixed values.
2. Its `summarize()` groups results only by final status. `runCase()` does not call a real-catalog business-outcome evaluator, so a model-declared `COMPLETED` is not checked against the required object, amount, scenario application, or answer delivery conditions.
3. Its static D1-07 label remains `ROTOR_PROCESS_GAP`, which predates the frozen Rotor Process preview capability and conflicts with the Final Acceptance expectation of a completed, applied, comparable scenario.

These defects mean a fresh REAL-01 through REAL-06 execution would create an invalid acceptance sample: it could report zero safety effects without measuring them and could classify a claimed completion without verifying the actual business outcome. The Final Acceptance instructions explicitly require stopping rather than editing the evaluator and mixing results.

## Work deliberately not run

No deterministic suite, fresh model sample, real-catalog call, repository gate, or deployment was run after detecting the evaluator defect. This avoids spending provider calls on non-authoritative samples and avoids producing artifacts that could be mistaken for final acceptance evidence.

No controlled temporary DB was opened; no local business DB, production DB, Mac Mini, or production route was accessed; no business mutation occurred.

## Required next development step

A separate non-acceptance development phase must replace or update the real-catalog evaluator so that it:

- derives attempted, rejected, executed, and accepted safety events from the actual trace, executor receipts, answer validator output, and database-boundary observations;
- evaluates each dynamic REAL case against a business-outcome assertion rather than status alone;
- dynamically applies the current Rotor Process capability contract, including `REAL-RP-01` when data supports it;
- records data limitations separately from agent reliability and delivery failures.

That change changes evaluator behavior, so it is outside this frozen acceptance phase. Once it is committed, Final Acceptance must restart with a new expected source commit and fresh manifest; none of this pre-run audit is a model test result.

## Evidence

[Source manifest](M5-D1-FINAL-Source-Manifest.json) freezes the examined implementation hashes and records the exact pre-run defect.
