# M4-2B — Semantic Frame V2

**Status:** Design validation complete — REWORK; not a Runtime contract.
**Scope:** No-code semantic-frame design and DeepSeek validation only.

## 1. V1 root cause

Semantic Frame V1 put several independent meanings into one `action` field. A sentence such as “V750 纸箱换成木箱差多少钱？” contains a configuration change, a cost-difference outcome, a hypothetical scenario and no explicit persistence request. Forcing that sentence to choose between `COMPARE` and `PREVIEW` loses information and creates a false conflict.

## 2. V2 schema

```json
{
  "businessObjects": [],
  "mentions": [],
  "operation": "EXPLAIN|READ|ANALYZE|CHANGE|UNKNOWN",
  "requestedChanges": [
    { "dimension": "...", "from": null, "to": null, "delta": null, "rawText": "..." }
  ],
  "requestedOutcomes": [],
  "scenarioMode": "CURRENT_STATE|HYPOTHETICAL|MUTATION_REQUEST|NONE|UNSPECIFIED",
  "persistenceIntent": "NONE|PREVIEW_ONLY|PERSIST_REQUESTED|UNSPECIFIED",
  "references": [{ "type": "EXPLICIT_MENTION|CONVERSATION_REFERENCE|PAGE_REFERENCE", "text": "..." }],
  "semanticAmbiguity": false,
  "ambiguityReason": null
}
```

`businessObjects` are only business concept types; `mentions` preserve user language. Neither field may contain an ID, tool, API, table or capability. `requestedChanges` retains configuration dimensions without deciding whether a formal write is possible. `requestedOutcomes` retains what the Owner wants to know. `scenarioMode` classifies current state, hypothetical analysis, or a mutation request; `persistenceIntent` separately records whether persistence is absent, preview-only, explicitly requested, or unspecified.

## 3. Boundaries

### Ontology grounding

V2 must not bind a mention to a canonical identity. A common designation that may have several formal candidates, and a conversation reference without a canonical identity, are **not** semantic ambiguity. They are later Ontology-grounding concerns.

### Planning and tools

V2 neither selects formal capabilities nor proposes API calls, calculations, execution paths or writes. Planning consumes only the completed semantic information after Ontology grounding.

## 4. Golden examples

- `V750 纸箱换成木箱差多少钱？` → `ANALYZE`; `PACKING_CONTAINER` from 纸箱 to 木箱; `COST_DIFFERENCE`; `HYPOTHETICAL`; `UNSPECIFIED` persistence.
- `把 V750 正式配方包装改成木箱并保存。` → `CHANGE`; `PACKING_CONTAINER`; `MUTATION_REQUEST`; `PERSIST_REQUESTED`.
- `V750 包装改木箱。` → preserve the packing change; persistence remains `UNSPECIFIED`.
- `刚才那个线圈多少钱？` → `READ`, `CURRENT_COST`, and a `CONVERSATION_REFERENCE`; no identity binding.

## 5. Validation result

The 16 first-run Golden Cases yielded **6 PASS, 4 PARTIAL, 6 FAIL**. V2 preserved the C-04 packing change, cost-difference outcome, hypothetical mode and unspecified persistence, so the V1 `COMPARE` versus `PREVIEW` conflict is structurally resolved.

However, V2 is not ready to implement. The model repeatedly treated missing canonical identity or possible multiple formal candidates as `semanticAmbiguity`; it sometimes marked a configuration change plus cost request as `persistenceIntent: NONE`; it omitted a requested difference; and it did not consistently obey the declared JSON enum and scalar contracts.

The re-mapped M4-1G and M4-1F regression set yielded **21 PASS, 1 PARTIAL, 4 FAIL**. The failures were output-contract or semantic-boundary failures, not a need to change formal business logic. Eight two-run stability checks yielded **1 STABLE** (`V2-11`) and **7 VARIANT** (`V2-02`, `V2-04`, `V2-06`, `V2-08`, `V2-09`, `V2-10`, `V2-16`).

No run emitted a database ID, tool, API, capability, current formal business fact, or write instruction. No database, Ontology lookup or tool was used.

## 6. Supervisor decision required

The V2 information model remains the preferred direction, but its schema/prompt contract needs a later design decision before Runtime work. Possible follow-up concerns are the boundary between semantic and identity ambiguity, canonical treatment of a described change with no persistence request, and strict structured-output validation. This document deliberately does not propose product implementation.
