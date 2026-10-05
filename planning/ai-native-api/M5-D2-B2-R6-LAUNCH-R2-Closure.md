# R6-LAUNCH-R2 Final Fresh C2

Final Fresh C2 executed all 34 frozen cases through the durable parent-supervised one-case-per-process path. Every case wrote an immutable checkpoint and a zero-mutation database receipt; no provider errors, signals, outer timeouts, or started-only cases were observed.

Canonical assembly was not permitted. The frozen assembler hard-codes the superseded Product freeze commit `cdebfb5ef6f83a4c8b39e93f3f0dcc39077e2251`, while every new R2 artifact is correctly bound to the Supervisor-approved Product freeze `65f5cf5380bc460a032b904bb032c4bf18a1ca76`. `publishR6()` therefore fails closed with `R6_ACCEPTANCE_FREEZE_MISMATCH`.

This is a deterministic Harness freeze-drift defect. No Product, Harness, scorer, fixture, prompt, or historical evidence was modified during acceptance; no repair was made in this ticket.

Raw suite results are retained under `M5-D2-B2-runs/`:

- Domain: 10/12 semantic pass.
- RAG: 0/4 semantic pass under the frozen scorer; raw answers retained the current formal procurement state, while the scorer treats undisclosed auxiliary divergence as override.
- Targeted: 10/14 semantic pass.
- D1 protection: 3/4 semantic pass.

Both PRE_MODEL and POST_MODEL repository gates passed 7/7. Final Fresh C2 cannot be classified canonically until the assembler freeze drift is repaired in a separately authorized ticket.
