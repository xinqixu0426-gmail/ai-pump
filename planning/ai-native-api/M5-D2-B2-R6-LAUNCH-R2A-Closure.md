# R6-LAUNCH-R2A closure

The versioned launch assembler consumed the six immutable Final Fresh C2 suite/gate artifacts and preserved the frozen canonical scoring result as **FAIL**. It did not rerun any semantic case and did not modify Product, scorer, oracle, or source evidence.

## Provenance

- Product freeze: `65f5cf5380bc460a032b904bb032c4bf18a1ca76`
- Semantic execution harness freeze: `39d0f3a2cc862ac632f901c5c2b24982d2610dc7`
- Post-processing assembly: `R6_LAUNCH_R2_POST_PROCESSING_V2`
- Assembly commit: `aa6279a653a27b4a5d614e481eaf253a5c81abb0`
- Assembly source SHA-256: `8b10af2c2c5518f7fd59f26bd897af8e7d8123800e9df6b49052416a017c61f7`

## Frozen canonical result

- Domain required-fact coverage: 10/12 (exact-domain diagnostic: 2/12)
- RAG authority scorer: 1/4
- Targeted: 10/14
- D1 protection: 3/4
- Failed gates: `DOMAIN_REQUIRED_FACT_COVERAGE`, `RAG_AUTHORITY`, `TARGETED_SEMANTIC`, `DOMAIN_COVERAGE`, `ANSWER_RELEVANCE`, `D1_PROTECTION`, `SAFETY`

## Delivered-answer adjudication evidence

- Candidate hard blockers identified by this packet: 0
- Safe degraded behavior: D04, D11, SHORTAGE_ONLY-03, D1-08
- Likely scorer/oracle limitations: RAG-01..04, PENDING_PURCHASE-03
- Supervisor adjudication needed: PENDING_PURCHASE-01, PENDING_PURCHASE-02
- Delivered wrong money: 0; all eight delivered money claims passed Answer Validator and retained accepted fact bindings and producer traces.
- Actual delivered RAG override/history-as-current: 0/0, distinct from frozen scorer flags 2/1.
- Writes and DB mutations: 0/0.

The pending-purchase cluster is systemically unavailable in the frozen sample (0/3 semantic pass) despite execution of the formal overview capability. The packet does not make the final Owner Controlled Use decision.

## Verification

- Focused assembly/immutability tests: 4/4 PASS
- Full tests: 2369/2369 PASS
- API contract: 29/29 PASS
- Deep API: 486/486 PASS
- Lint: PASS
- Build: PASS
- Architecture gate: 9/9 PASS
- Release gate: PASS
- Secret scan: PASS
- Model/provider calls: 0/0
