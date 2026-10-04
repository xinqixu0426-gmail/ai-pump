# D2-B2 R6H4-C1.3 — Durable Fresh Acceptance Runner

The Product remains frozen. The Harness now persists an immutable batch identity and an atomic checkpoint for every completed case. Interrupted attempts retain a STARTED receipt and can be retried once only when no semantic checkpoint exists. A semantic failure remains immutable.

Finalization is model-free: it reads every checkpoint in frozen order, aggregates actual per-case database receipts, and writes the existing suite-level artifact contract required by the R6 assembler. Deterministic tests cover the 12/4/14/4 suite shapes, identity/hash checks, interruption handling, mutation aggregation, and checkpoint immutability. No DeepSeek call was made in this phase.
