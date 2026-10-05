# R6-LAUNCH-R1 RAG Infrastructure Closure

The historical `r6c2-rag-20261005-01` evidence remains immutable. Its two `RAG-01` attempts contain only `STARTED` receipts. Because the historical worker had neither a catch-to-terminal receipt nor a supervising parent, the narrow defensible classification is `EXTERNAL_TERMINATION_UNKNOWN (UNOBSERVABLE_UNSUPERVISED_WORKER)`; a provider failure cannot be inferred from that evidence.

The acceptance harness now records per-phase receipts, persists `FAILED_INFRA` for observable JavaScript, provider, and abort failures, and uses a local parent supervisor for child exit, signal, outer-timeout, bounded-output, and last-phase evidence. Semantic failures remain immutable checkpoints and the two-attempt infrastructure limit is unchanged.

The first non-acceptance diagnostic made a previously silent path observable and identified the historical 64K acceptance-only context allowance as insufficient for the current R6 Domain/RAG investigation. The harness allowance was raised to 128K and included in the freeze hash set; no production provider configuration or Product behavior changed.

The final non-acceptance diagnostic `r6-rag-infra-diagnostic-20261005-02` completed the real controlled RAG path through provider response, scoring, database receipt, fixture cleanup, and checkpoint write. It exited `0`, received no signal or outer timeout, and produced zero database mutations. Its semantic result is preserved but is not acceptance evidence and was not rerun.

All focused tests and repository gates passed. Final Fresh C2 was not started.
