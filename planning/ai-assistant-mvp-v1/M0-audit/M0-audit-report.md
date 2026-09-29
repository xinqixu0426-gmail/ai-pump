# AI Assistant MVP M0 Audit Report

**Audit date:** 2026-09-29 (Asia/Shanghai)
**Scope:** read-only source and configuration audit; this M0 created planning Markdown only. No runtime, Business API, schema, migration, environment, deployment, or production write was changed.

## Start-state verification

| Check | Observed result |
| --- | --- |
| Source branch | `ai-native/prod-canary-s2` |
| Local source HEAD | `bc9f7ed579c915de013d7497e3bf06b8fa583667` — `feat(ai-native): broaden grounded owner reads` |
| Local worktree at audit start | clean |
| `origin/ai-native/prod-canary-s2` read-only `git ls-remote` | `bc9f7ed579c915de013d7497e3bf06b8fa583667`; matched audited local HEAD |
| Production runtime/health/DB/migration/AI mode/write state | **NOT_ACCESSIBLE**. Read-only SSH to `dan@192.168.31.216` was attempted with batch mode and a 10-second connect limit. Network connection reached SSH, but authentication returned `Permission denied (publickey,password,keyboard-interactive)`. No command ran remotely, so no production state is inferred from repository documents. |

Repository documents contain historical and sometimes contradictory deployment statements. They were not used as evidence of the live Mac Mini state.

## Current request graph

```text
POST /api/ai/chat
  -> Owner/auth + rollout snapshot (`aiNativeRolloutPolicy`)
  -> persisted conversation/recent-write loaders (`aiConversations`)
  -> `runAiDispatcherV3`
     -> deterministic write-route detector (`aiProtectedCommandRoute`)
        -> W1 proposal bridge when write is enabled
     -> `runAiTaskControllerV2` for every non-command read
        -> `aiTaskSemanticsV2` (deterministic rules + provider proposal)
        -> Task/Goal validation and admission
        -> canonical entity binding + `aiTaskCapabilityAdapterV2`
        -> `executeToolCall` -> executor -> `internalApiClient` -> Business API
        -> verified receipt -> fact -> requirement
        -> `aiTaskAnswerV2` deterministic rendering
```

The mounted `/api/ai/tasks/*` route separately exposes Task V2 durable create/read/resume/cancel/events, worker/recovery, and W1 write preview/execute/reconcile. It is reachable in the source application through `api/routes/ai.cjs`. Thus the old Task V2 framework is not merely dead source: it is the normal current read runtime whenever the deployed environment enables the source’s Owner Native mode.

## Current protected write pipeline

The currently narrow chat write path supports only `adjust_part_stock` when `AI_NATIVE_MODE=owner` and `AI_NATIVE_WRITE_ENABLED=true`; the source defaults fail closed. The deterministic route identifies explicit stock delta language, `aiNativeWriteChatBridgeV2` binds it to a durable user message, and `aiTaskWriteBridgeV2` invokes the formal `/api/parts/batch-stock-preview` preflight through the executor. The proposal freezes part identity/current stock/delta/next stock, args/version/hash and an idempotency key.

The formal write follows only after a canonical Owner approves the token. `executeConfirmedAiTool` consumes a subject-bound, short-lived frozen token; it calls the formal API through the independent internal write-secret boundary, requires matching command/audit receipts, supports idempotent replay, and the bridge performs a formal target readback. The Task V2 storage/lifecycle makes this safety path more coupled than it should be; the retirement plan marks its reusable pieces for extraction, not deletion.

| Protection | Audit result |
| --- | --- |
| Proposal/preflight | YES |
| Owner confirmation | YES — canonical Owner required on Native write endpoints |
| Frozen confirmation token / subject / args | YES |
| Internal write credential boundary | YES — separate `INTERNAL_WRITE_SECRET`, fail closed |
| Idempotency | YES — formal operation/idempotency key and replay behavior |
| Version/concurrency check | YES — frozen proposal/version/hash/preflight context |
| Audit receipt | YES — required formal operation/capability/audit evidence |
| Readback | YES — target stock compared to frozen `nextStock` |

## Money authority

Audited formal amount paths: current recipe costs, scenario comparison, profitability, virtual readiness quantities, coil cost, copper snapshot, recipe comparison, full/dynamic/pump-shell estimates, and persisted quotation/order/purchase figures. The formal sources are `costEngine`, deterministic Business API preview/query services, or persisted formal fields. The executor records API traces and rejects unverified business execution evidence.

`MODEL_CALCULATED_FORMAL_AMOUNT_FOUND: NO`. The current Task V2 answer renderer can format verified results, but no audited executor delegates a formal numeric calculation to the model. See [MVP-tool-inventory.md](MVP-tool-inventory.md) for the complete authority table.

## Ontology audit

Ontology V2.1 business-authority assets are retained: canonical entity IDs/definitions, resolver contracts, entity lookup, relation/collection reads, canonical relation queries, catalog physical identity, and canonical technical-profile authority. The Task V2 use of ontology as canary/admission/routing machinery is not retained. A safe read may call its formal API directly; ontology is useful for identity and relations but must not gate every read.

## Direction drift

`DIRECTION_DRIFT: NO` for the proposed MVP design. Source audit found the expected old Task V2 architecture that the ticket intends to replace, and the formal Tool/API/write safety layers are separable in a planned extraction. Production state remains unverified because of the explicit SSH authentication limitation above; that is an audit limitation, not a silently assumed production conclusion.

## Deliverables

- [MVP-architecture-v1.md](MVP-architecture-v1.md): approved target chain, Judge/Main contracts, answer policy, Ontology position.
- [domain-policy-v1.md](domain-policy-v1.md): eight canonical company semantic rules and policy boundary.
- [MVP-tool-inventory.md](MVP-tool-inventory.md): 84-tool inventory, safe MVP surface, money authority and write/external exclusions.
- [old-ai-retirement-plan.md](old-ai-retirement-plan.md): concrete keep/simplify/extract/delete/migration classification and no-fallback deletion proof.
- [MVP-acceptance-v1.md](MVP-acceptance-v1.md): 16 core manual acceptance scenarios plus surprise/safety set.

## Classification closure

The retirement plan classifies all relevant modules affecting the current main path. `UNKNOWN: 0`. The current path’s Task V2/Semantics/Controller/Answer/Goal/receipt framework is explicitly `DELETE_AFTER_MVP_CUTOVER`; production-facing business safety remains `KEEP_CORE` or `EXTRACT_SHARED_THEN_DELETE_OLD` only where coupled to Task V2.
