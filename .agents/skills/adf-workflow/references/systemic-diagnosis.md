# Systemic Diagnosis

Before freezing an L2/L3 bugfix Task Contract or editing any bugfix:

1. Trace the real end-to-end call chain and reproduce the behavior where possible.
2. Search the repository for similar APIs, checks, caches, errors, permissions,
   state handling, and previous workarounds.
3. Build a defect-family inventory that classifies the reported case, analogous
   cases, and lookalikes. Record evidence and an include, preserve, or exclude
   decision for each category; a narrow user example is not a scope boundary.
4. Identify the root-cause layer: call site, shared helper, service,
   infrastructure, contract, data model, or architecture.
5. Fix the lowest correct shared layer. Do not scatter case-specific workarounds.
6. Build a regression matrix covering the reported case, analogous callers,
   failure paths, boundaries, and preserved historical behavior.
7. Remove obsolete patches, duplicate logic, and dead workarounds replaced by
   the authoritative mechanism.

Pass the resulting trace, cause, fix layer, cleanup, regression evidence, and
missed-detection lesson to Guardian as root-cause evidence. A final assertion
without this work is not evidence. `--root-cause-review` records the completed
diagnosis; it does not replace the Ready-time inventory or prove semantic truth.
