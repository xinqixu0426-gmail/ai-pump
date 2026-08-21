---
name: adf-workflow
description: Orchestrate non-trivial software changes in an ADF project from task alignment through independent review, deterministic Guardian gates, and authorized delivery. Use for features, bug fixes, refactors, releases, or ambiguous development requests; skip for answer-only and read-only analysis.
---

# ADF Workflow

Keep Codex responsible for intelligent work, Guardian responsible for deterministic
evidence, and the project responsible for business truth. Main Codex is the only
default business-code writer; delegate read-only exploration and review according
to risk.

## Route the task

Classify the task as `feature`, `bugfix`, `refactor`, `docs`, `config`, `release`,
or `maintenance`, then assign `L0`–`L3` from behavior and reversibility rather
than file count.

- L0: clear, behavior-preserving trivial change; Main Codex and focused checks.
- L1: small, bounded, low-risk change; add targeted review when useful.
- L2: behavior, API, data logic, bugfix, or multi-module change; use the full
  contract, Explorer, review, verification, and delivery flow.
- L3: migration, auth/security, destructive work, production, secrets, or other
  irreversible effects; use L2 plus explicit human approval for the risky act.

For L2/L3 or meaningful ambiguity, read [task-contract.md](references/task-contract.md)
and align the contract before implementation. For a bugfix, also read
[systemic-diagnosis.md](references/systemic-diagnosis.md) before editing.
Before delegating any subagent, read [model-routing.md](references/model-routing.md)
and use the lowest-cost role that satisfies the task's risk and judgment needs.

## Execute

1. Inspect `AGENTS.md`, Git state, relevant code/config/tests/authorities, and
   Guardian doctor/session. Do not replace an active session silently.
2. Establish Definition of Ready. For L2/L3 bugfixes, run the read-only Code
   Explorer (or equivalent repository discovery) now, inventory the defect
   family, and record explicit scope decisions before freezing the contract.
   Ask only about unresolved choices that would materially change scope,
   behavior, cost, or risk.
3. Start Guardian only after Ready unless an external runner already created the
   session. Freeze the effective `requiredGate`: L0 defaults to focused, other
   risks to commit, a current request for push/PR/staging upgrades it to push,
   and applicable automatic commit/feature push policy may upgrade it further.
4. For L2/L3 non-bugfix work, delegate read-only exploration now if it was not
   needed for Ready. Let Main Codex implement only after required discovery.
   Prefer a narrow context fork containing the Task Contract, exact paths,
   acceptance criteria, and evidence question instead of the full conversation.
5. Run risk-matched deterministic checks after substantial changes and repair
   failures before continuing.
6. Read [review-policy.md](references/review-policy.md), run required independent
   reviews, remediate actionable findings, and repeat affected reviews.
7. Consolidate current-truth documentation at its authoritative location.
8. Run Guardian commit and push gates in order. Read
   [delivery-policy.md](references/delivery-policy.md) before any external write.
9. Do not declare completion while contract drift, stale evidence, failures,
   missing reviews, or an incomplete workflow remains.

Guardian never calls AI, approves scope, edits the project, or executes delivery.
The Stop Hook is only a completion interlock; it does not perform the workflow.
