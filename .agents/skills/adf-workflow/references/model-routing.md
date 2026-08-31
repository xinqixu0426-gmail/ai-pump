# Model Routing

Use the lowest-cost model that can reliably perform the delegated judgment. Model
routing reduces cost and latency; it never lowers acceptance criteria, independent
review requirements, Guardian gates, or project-owned deterministic verification.

## Defaults

The executable profile assignments are declared once in `model-routing.json` and
validated against `.codex/agents/*.toml`; this document owns the judgment rules.

| Role | Default | Use for |
| --- | --- | --- |
| Main Codex | selected session model; normally Sol medium | implementation, synthesis, delivery decisions |
| Code Explorer | Spark medium | bounded file discovery, call-chain tracing, inventories, evidence collection |
| Docs Reviewer | Luna medium | authority locations, stale facts, duplicate text, links and examples |
| Test Reviewer | Luna medium | acceptance-to-evidence mapping when behavior and expected outcomes are explicit |
| Architecture Reviewer | Terra medium | root-cause placement, dependency boundaries, duplicate mechanisms and maintainability |

Use `gpt-5.3-codex-spark` as the active Code Explorer default while quota is
available. Keep `gpt-5.6-luna` as its reliable fallback and as the default for
Docs/Test Reviewers. If Terra is unavailable, use the selected Main Codex model
rather than silently dropping review.

Static agent profiles cannot inspect a weekly Spark quota. On hosts that support
custom profiles, invoke `code_explorer`; otherwise invoke a read-only Explorer with
an explicit `gpt-5.3-codex-spark` model override and the smallest context fork. On
a quota or availability error, immediately retry that bounded question once with
Luna and suppress repeated Spark attempts until the next expected reset. This
fallback never changes Terra or Main Codex responsibilities and never skips the
required evidence question.

## Escalate by judgment risk

Luna may collect the inventory and deterministic evidence, but it must not decide
cross-module authority, systemic bugfix scope, concurrency, data consistency,
database/API ownership, or ambiguous preserved behavior. Hand those questions and
the bounded evidence to the Terra Architecture Reviewer. Main Codex uses Sol medium
or high for L3 security/authentication, credentials or permissions, destructive
migration, production risk, irreversible effects, conflicting reviewer conclusions,
or a material decision that remains unresolved after Terra review.

Do not use a lightweight model as the final judge of an architecture boundary, a high-risk
approval, or whether production/destructive work is safe. Main Codex owns the
final synthesis and must inspect evidence before acting.

## Context budget

- L0 uses no subagent. L1 uses at most one targeted reviewer when useful.
- A release-only continuation for an unchanged, previously reviewed commit uses
  no new subagent; changing the commit or artifact ends that fast path.
- Prefer `fork_turns: "none"` (or the smallest supported recent-turn window) and
  pass the Task Contract path, exact repository paths, acceptance criteria,
  relevant diff or report, and one bounded evidence question.
- Do not send the full conversation merely for convenience. Add context only when
  the subagent identifies a concrete missing dependency.
- Request concise findings with file/symbol evidence; omit praise, repeated task
  summaries, implementation narration, and unchanged-state updates.
- Use a compact capsule: goal, risk/scope decision, exact paths, acceptance
  evidence, and one question. Do not attach raw terminal history or full reports
  when a path plus the relevant finding is sufficient.
- Rerun only the reviewer whose conclusion or evidence fingerprint changed.

Calibrate routing on real tasks. When the host exposes it, record role, model,
effort, duration, outcome, fallback, accepted findings, false negatives and review
disagreement in ignored local execution metadata. Record exact token counts only
when the host provides them; never estimate or invent token usage. Upgrade a role
when quality drops; do not promote every role to the strongest model because one
task was difficult.
