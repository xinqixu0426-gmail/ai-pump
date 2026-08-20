# Systemic Diagnosis

Before editing a bugfix:

1. Trace the real end-to-end call chain and reproduce the behavior where possible.
2. Search the repository for similar APIs, checks, caches, errors, permissions,
   state handling, and previous workarounds.
3. Identify the root-cause layer: call site, shared helper, service,
   infrastructure, contract, data model, or architecture.
4. Fix the lowest correct shared layer. Do not scatter case-specific workarounds.
5. Build a regression matrix covering the reported case, analogous callers,
   failure paths, boundaries, and preserved historical behavior.
6. Remove obsolete patches, duplicate logic, and dead workarounds replaced by
   the authoritative mechanism.

Pass the resulting trace, cause, fix layer, cleanup, regression evidence, and
missed-detection lesson to Guardian as root-cause evidence. A final assertion
without this work is not evidence.
