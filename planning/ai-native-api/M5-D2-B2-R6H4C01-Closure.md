# D2-B2 R6H4-C0.1 freeze integrity

The authoritative RAG fresh path now uses a frozen acceptance-only adapter. It intercepts only `search_factory_knowledge` and delegates every other call unchanged to the real controlled-fixture executor. No caller-defined wrapper can replace it.

Fresh runners and pre/post gate receipts load the C01 manifest, recompute the current source hashes and API Index fingerprint, and derive their receipts only after verification. A mismatched or locally modified frozen source fails closed with `R6_ACCEPTANCE_FREEZE_INTEGRITY_FAILED`; documentation-only changes remain allowed.

All four runner preflights completed with zero model calls, business executions, and database mutations. `npm test` passed: 2345/2345.
