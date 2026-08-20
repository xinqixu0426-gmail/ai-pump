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

Definition of Ready requires a verified current behavior, explicit target and
scope, testable acceptance criteria, an Out of Scope boundary, known impact, and
approval for material L3 decisions. Empty Open Questions may say `None`.

Give Guardian the contract path and approval state at `start`; Guardian reads the
file and computes the baseline hash.
Any hash change is drift in v0.3; no rebaseline command exists. Changes to behavior,
acceptance, scope, constraints, or Out of Scope return the task to
`READY_FOR_APPROVAL`. Never silently broaden the task.
