# D2-B2 R6H4-C1 — Frozen Fresh Acceptance Failure

The C1 manifest and frozen source hashes verified before the run. All seven PRE_MODEL repository gates passed and their receipt was staged under `r6c1-pre-20261005-01`.

The first Domain Corpus fresh execution was then started with the explicit isolated DeepSeek authorization. During per-case Harness safety normalization, the runner threw `R6_UNKNOWN_EXECUTED_TOOL_ACCESS`. The error occurred in `normalizedSafety()` before the suite-level runner could write an artifact, so the raw candidate and its trace were not serialized. No other Domain case, RAG case, Targeted case, or D1 protection case was started; no retry or substitute sample was used.

This is an `ACCEPTANCE_HARNESS_ANOMALY`: the frozen runner's write-access measurement cannot map one actually executed business trace to the frozen API Index. The failure evidence is preserved without attempting an in-place repair. Product and Harness source remain unchanged after the C1 freeze; post-failure freeze verification still passed.
