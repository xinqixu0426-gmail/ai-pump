# AI Assistant MVP Architecture V1

## Decision

MVP replaces the current ordinary-read Task V2 path with the following bounded Agent path. This is an architecture record, not runtime implementation.

```text
User
  -> DeepSeek Judge (isolated prompt/context)
  -> DeepSeek Main Agent
  -> Safe Tools
  -> Internal API Client
  -> Business API / Ontology
  -> Domain Service / SQLite
  -> Tool Result
  -> DeepSeek Main Agent
  -> concise Chinese answer
```

The mutation path remains separate:

```text
Main Agent -> prepare/proposal -> Owner approval
  -> protected Write Executor -> Business API -> audit + readback
```

There is **no old-AI fallback**. A new-path failure must return a bounded failure or clarification; it must not enter the retired semantic/task/controller runtime. Laya is deferred and is not an MVP provider. The new main path has neither a deterministic semantic-rule engine nor an ordinary-read Task/Goal framework.

## Current implementation being replaced

`POST /api/ai/chat` authenticates an Owner, snapshots `AI_NATIVE_MODE` and `AI_NATIVE_WRITE_ENABLED`, loads persisted continuation, then calls `runAiDispatcherV3`. A non-command read enters `runAiTaskControllerV2`, which combines deterministic extraction and a provider proposal, GoalKind admission, canonical binding, capability planning/execution, Receipt -> Fact -> Requirement validation, task/session state, and deterministic `aiTaskAnswerV2` rendering. `/api/ai/tasks/*` separately exposes durable Task V2 lifecycle, resume/recovery and the Native W1 write bridge. Therefore Task V2 is currently production-reachable when the deployed runtime has `AI_NATIVE_MODE=owner`; it is the ordinary-read runtime in this source tree.

The source comments calling this path “Native” do not make it the approved MVP Agent architecture. “Legacy” in some current comments refers to an earlier runtime already hard-cut from `aiDispatcherV3`, not to Task V2.

## Judge contract (planning only)

- Provider: DeepSeek only.
- Input: isolated system prompt, original user message, bounded recent normal conversation only when needed, and Domain Policy V1.
- Excluded: business tools, Main Agent tool prompt, database access, and write credentials.
- Output is concise structured data, not GoalKind:

```json
{
  "mode": "READ | ANALYZE | PERSIST_MUTATION | GENERAL | UNCLEAR",
  "goal": "plain-language goal summary",
  "questions": ["plain-language user objectives"],
  "constraints": ["important user constraints"],
  "persistentMutation": false,
  "needsClarification": false,
  "clarificationReason": null,
  "appliedPolicyIds": []
}
```

## Main Agent contract (planning only)

Input is the original message, bounded normal conversation, Judge output, relevant Domain Policy rules, and Safe Tool definitions. The Agent may select multiple READ/PREVIEW tools, examine their results, perform a further bounded read, and stop when the evidence is sufficient. Start with at most **six tool calls per user turn**; this is a simple safety/resource limit, not a planner framework.

The Agent must not calculate authoritative monetary results itself, invent database identities, bypass schemas, access SQLite, or persist business state. It must route a persistent-mutation request into the existing protected proposal/confirmation path. Formal amounts and current business facts come only from formal Tool/API results.

## Answer policy

The Main Agent answers the Owner’s real question first, covers each material sub-question, and uses concise natural Chinese. It uses formal Tool results for business facts, distinguishes current/scenario/historical bases when material, does not expose internal contracts by default, and states that formal data is unavailable rather than manufacturing certainty. It is deliberately not a family of deterministic answer templates.

## Ontology position

Ontology is kept as business authority for entity definitions, canonical identities, relations, canonical fact authority, and useful compact context/tool resolution. Current authority-bearing assets include `api/ontology/**`, `api/ontology/resolverContract.cjs`, `api/services/entityLookupService.cjs`, `api/services/catalogPhysicalIdentity.cjs`, `api/services/canonicalRelationQueries.cjs`, `api/services/relationReadService.cjs`, and formal relation/collection APIs registered in `api/capabilities/registry.cjs`.

It is not the natural-language router, a mandatory prerequisite for a safe direct API read, or the orchestration engine. Old ontology canary/routing/shadow admission components (`ontologyRelationCanaryEligibility`, `aiNativeOwnerTrialCoverage`, and their Task V2 consumers) retire with the old read runtime after MVP cutover; identity and relation authority do not.

## Cutover invariant

At cutover, `/api/ai/chat` delegates only to Judge/Main Agent. It must have no condition, feature flag, catch block, shadow path, or “emergency” branch that calls `aiTaskSemanticsV2`, `aiTaskControllerV2`, Task V2 worker/recovery, or `aiTaskAnswerV2` to answer a user. Existing protected writes may retain only the extracted neutral safety pieces named in the retirement plan.
