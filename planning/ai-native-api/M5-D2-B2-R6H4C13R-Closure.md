# R6H4-C1.3R durable real-case execution wiring

The acceptance-only CLI now performs one frozen case per process and routes it through the frozen real-case executor. The executor creates a fresh controlled fixture for every case, obtains Business and Policy memos, uses the real Candidate and executor path, applies existing frozen oracles/scorers, and writes the existing immutable durable checkpoint with a measured DB receipt.

The command surface does not accept caller-provided prompts, domains, oracles, executors, or RAG wrappers. Real case execution requires `D2_B2_ALLOW_MODEL_RUN=1`; CREATE, INSPECT, and FINALIZE never call a model.

No Product source changed. The phase used deterministic injected dependencies only and made zero DeepSeek calls.
