# S2 Owner Accepted Production Baseline — 2026-09-28

## Frozen baseline

- **Product baseline commit:** `d56de80e184d88e864f1606db280af9247dd30e4`
- **Branch:** `ai-native/prod-canary-s2`
- **Production commit:** `d56de80e184d88e864f1606db280af9247dd30e4`
- **Migration head:** `89`
- **Native runtime:** `mode=owner`, `authority=owner-scoped-native`
- **Owner acceptance:** PASS; `AI-NATIVE-S2-OWNER-ACCEPTANCE-R1` and `R2` are CLOSED.

Future AI-Native work starts from this product baseline and its ancestry unless a
later Supervisor-approved baseline explicitly supersedes it. This document-only
freeze commit is not the product baseline. Historical Legacy orchestration is
not restored as a fallback.

## Accepted capability set

- Formal Recipe catalogue; Coil catalogue, inventory, and cost reads.
- Recipe current full cost, cost comparison, configuration preview,
  profitability preview, and virtual readiness/shortage preview.
- Management overview and customer-history routing.
- Canonical Recipe technical-profile reads: canonical bearing identities,
  Rotor/impeller/Functional facts, `recipes.coil_sheets` authority, canonical
  bearing-span derivation, Recipe → Template → PumpShell, Recipe → Coil, and
  fail-closed incomplete-profile handling.
- Bounded same-conversation continuation: `V550 → 那V750呢 → 这两个差多少`,
  Coil identity → cost, same-spec Coil alternatives, and formal-candidate
  ambiguity clarification.

## Frozen safety properties

- Final Owner acceptance produced zero unexpected formal business writes.
- No arbitrary first-result identity choice or fabricated formal fact.
- No Legacy AI fallback and no legacy technical fallback for canonical answers.
- Continuation carries only bounded canonical identity/intent metadata; it does
  not reuse prior mutable facts or receipts, and every continued business read
  is freshly formally verified.
- O4 canonical technical authority and database schema are unchanged; migration
  head remains 89.

## Accepted non-blocking debt

| ID | Area | Classification | Current safe behavior | Deferred UX improvement |
| --- | --- | --- | --- | --- |
| `OWNER-UX-DEBT-01` | Customer History answer presentation | `UX_ISSUE` / `LOW` / `NON_BLOCKING` / `DEFERRED` | `列一下不存在客户XYZ以前的报价。` routes to `CUSTOMER_HISTORY`, executes `search_customers`, returns formal `CUSTOMER_NOT_FOUND`, and fabricates neither identity nor history. | Render that known bounded `CUSTOMER_NOT_FOUND` result instead of the generic “该目标当前未能形成可验证的正式结果。” response. |

Safety impact: none. Data impact: none. This debt does not block the frozen
baseline and is not fixed by this recording task.
