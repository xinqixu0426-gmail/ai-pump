# D2-B2 R6H4-C0 fresh runner and scoring integration

This deterministic-only phase introduced acceptance-only R6 fresh runners for domain corpus, RAG authority, targeted operational cases, and D1 protection. Each runner writes an exclusive staged artifact carrying product and harness freeze receipts; the product is not imported by any production path.

Raw Candidate output is scored before serialization for domain selection, domain coverage, RAG authority, answer relevance, and normalized safety. The R6 assembler now derives a real `PASS` or `FAIL` from the 12/4/14/4 matrices, coverage and RAG search gates, D1 protection, safety, and explicit pre/post repository-gate receipts. Missing or malformed evidence fails closed.

All four runner preflights returned `modelCalls: 0`. No DeepSeek request, database mutation, business execution, deployment, or fresh acceptance occurred. `npm test` passed: 2344/2344.
