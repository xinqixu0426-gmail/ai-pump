# Task Contract

Use `.adf/tasks/current.md` as ignored execution state, not as authoritative
product documentation. Verify current behavior from the project before filling it.

```markdown
# Task Contract

## Classification
Type:
Risk:

## Goal

## Current Behavior

## Target Behavior

## Acceptance Criteria

## Out of Scope

## Constraints

## Expected Impact

## Open Questions
```

For an L2/L3 bugfix, insert these populated sections before `Out of Scope`:

```markdown
## Defect Family

## Systemic Scope Decision
```

Definition of Ready requires a verified current behavior, explicit target and
scope, testable acceptance criteria, an Out of Scope boundary, known impact, and
approval for material L3 decisions. Empty Open Questions may say `None`.

For an L2/L3 bugfix, `Defect Family` and `Systemic Scope Decision` are also required and
must be populated from read-only repository discovery before `guardian start`.
The inventory should distinguish the reported case, analogous cases, and cases
that only look similar. Every included, preserved, or excluded category needs an
evidence-backed disposition. If a scope choice could materially change behavior,
cost, or risk, resolve it with the user before Ready; do not hide it in Out of
Scope. Guardian validates structure and drift, while Explorer and Reviewers judge
whether the inventory and decisions are complete and reasonable.

Give Guardian the contract path and approval state at `start`; Guardian reads the
file and computes the baseline hash.
Any hash change is drift in v0.3; no rebaseline command exists. Changes to behavior,
acceptance, scope, constraints, or Out of Scope return the task to
`READY_FOR_APPROVAL`. Never silently broaden the task.
