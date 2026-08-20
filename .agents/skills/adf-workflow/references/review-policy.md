# Review Policy

Use reviewers according to risk, not mechanically:

- L0: Main Codex only.
- L1: a targeted reviewer when behavior or documentation warrants it.
- L2: Code Explorer before implementation; Architecture and Test Reviewers after
  implementation; Docs Reviewer when project facts or authoritative docs changed.
- L3: all L2 reviews plus high-risk verification and human approval.

Reviewers remain read-only and return concrete findings with file/symbol evidence,
impact, and an actionable correction. Architecture review checks root-cause layer,
parallel mechanisms, dependency direction, unnecessary abstractions, and debt.
Test review maps acceptance criteria to behavior-level evidence and examines
failure paths and regression gaps. Docs review locates authoritative current truth,
removes stale facts, and rejects append-only development logs.

Main Codex remediates findings. If remediation changes the reviewed behavior or
evidence fingerprint, rerun the affected review. Stop after a bounded retry and
report a real blocker instead of accepting stale review evidence.
