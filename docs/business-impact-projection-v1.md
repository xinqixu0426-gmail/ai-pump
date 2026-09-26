# Business Impact Projection V1

> **已退役（NATIVE-HC2）**：本文描述的 Legacy AI 编排组件已从仓库物理删除，生产 AI 为 Native-only。本文仅作历史记录保留；请勿据此启用旧运行时或旧开关。


## Status

`BusinessImpactProjectionV1` is a deterministic, read-only, shadow-only projection over existing formal business sources. It is disabled unless `AI_BUSINESS_IMPACT_SHADOW_ENABLED=true`. Enabling the observer does not alter the final answer, model-visible evidence, tool routing, tool arguments, provider calls, Semantic/Completeness Enforcement, writes, or cost calculation.

L5-P1 promotes the audited `ImpactResultV1` candidate into the stable implementation contract in `api/business-impact/`. It does not rewrite the frozen L5-P0 contract, authority matrix, benchmark, fixture, or oracle.

## Trigger and result boundary

`ImpactTriggerV1` requires one of `PROPOSED_CHANGE`, `VERIFIED_RECORDED_CHANGE`, or `VERIFIED_FACT_CHANGE`, a canonical identity when the change family needs one, and formal evidence provenance. Assistant text and memory are never actual-change authority.

`ImpactResultV1` distinguishes `CHANGED`, `AFFECTED`, `RECALCULATION_REQUIRED`, `READINESS_RECOMPUTE_REQUIRED`, `REVIEW_REQUIRED`, and `DIFFERENCE_VERIFIED`. Proposed changes cannot yield `CHANGED`. A current recipe change cannot mark a saved order as changed. Only `COMPLETE_SAVED_CONFIGURATION` can yield `DIFFERENCE_VERIFIED`.

Completeness is one of `COMPLETE`, `PARTIAL`, `UNSUPPORTED`, `NEEDS_TRIGGER_EVIDENCE`, or `NEEDS_CANONICAL_IDENTITY`. Negative impact conclusions require complete target scope.

## Authorized slices

| Slice | Formal projection | Authority boundary |
| --- | --- | --- |
| IP-01 | canonical recipe configuration change → current recipe affected and current cost recalculation required | Cost arithmetic remains in the existing cost authority; a verified preview may only be attached as evidence. |
| IP-02 | current recipe change → saved-order review or verified current-vs-saved difference | Saved orders remain historical; partial legacy snapshots cannot become verified differences. |
| IP-03 | canonical part inventory change → active-order readiness recomputation | Reuses the existing readiness authority; the impact layer does not implement shortage arithmetic. |
| IP-04 | canonical template change → complete current recipe set | Reuses the existing canonical template reference read; no performance implication. |
| IP-05 | canonical part price change → current recipes requiring cost recalculation | Discovers the affected set separately from optional cost recomputation and never persists a new cost. |

Quotation freshness, report validity, temperature/current/power/loss/curve/head/flow predictions, supplier-wide chains, product-platform causality, and non-formal purchase impact remain unsupported or unresolved. The projection does not create pseudo-edges for them.

## Bounds and safety

- `MAX_IMPACT_TARGETS = 50`
- `MAX_IMPACT_READ_CALLS = 8`
- `MAX_IMPACT_RESULT_BYTES = 24 KiB`

The values sit below the existing 512-row relation scan cap and 32 KiB relation-result ceiling, while leaving headroom relative to the 14,893-byte L5-P0 production-shaped tool maximum. Hitting a target/read bound produces `PARTIAL`; it never produces a false complete set. The scale sentinel uses one template with more than 50 current recipes and verifies the capped, explicit partial result.

The validator rejects wrong completeness elevation, saved-order mutation claims, verified differences from partial snapshots, authoritative quotation staleness, authoritative report validity, engineering numbers, and proposed changes represented as persisted facts.

## Shadow integration

After the authoritative assistant answer is complete, `aiAssistantRuntime` may schedule `business-impact/shadowObserver.cjs`. The observer accepts a formally constructed trigger, produces a bounded record, reports duration and payload bytes, and remains fail-open. It makes zero provider calls and zero business writes. L5-P1 does not make the projection model-visible; that decision belongs to a separately authorized L5-P2.

## Frozen L5-P0 evidence

- Impact contract: `5c92c5da580932546ecc27484e0c6f790cdf8798d3971f52e6c99b6093f11f16`
- Impact matrix: `ce37a7917640c0f260da542c36df161efeed1a48a0bf34fd2c8f7b998bbb23a9`
- Case: `4d6f250b556a915c2348521b1f3c4a15b80df1ad65b99d70c537aa6bb64ae832`
- Fixture: `07987804cc91edc13a27b17af8086e8890a6cb21e829f2a4e831ab5c2509e243`
- Oracle: `27b4f3d26a6dd87e19221d6473557d1413721b68d3c2877832b8c8844c285e36`

## Deferred prerequisites

Recipe/configuration revision fingerprints, report configuration fingerprints, quotation source revision/cost-basis timestamps, a legacy-order snapshot compatibility contract, canonical supplier identity, and product-platform/variant identities remain documentation-only gaps. No schema or entity was added in L5-P1.

## L5-P1 acceptance evidence

The deterministic suite passes all 12 frozen BusinessImpactBenchmarkV1 cases, including correct unsupported and identity-clarification boundaries. Eight authority-elevation mutations are rejected, and the scale sentinel caps 62 template-linked recipes at 50 targets with explicit `PARTIAL` completeness.

Real local Shadow acceptance ran 12 cases twice, strictly serial, using `/var/opt/models/Ornith-1.5-35B-A3B-APEX-i-compact.gguf`. Projection was produced for 24/24 executions with zero exceptions, 12/12 cross-run stability, zero additional provider calls, zero fallback, zero writes, and a maximum projection size of 2,364 bytes. The unchanged authoritative model answers were 12 PASS / 12 PARTIAL / 0 FAIL / 0 BLOCKED; L5-P1 intentionally does not improve answer text.

Focused frozen regression is 56/56. Full regression is 2,739/2,739; API contract 27/27; Deep API 490/490 with clean temporary-database integrity and zero foreign-key violations; lint and Web build pass. The acceptance artifact is `docs/business-impact-projection-baseline-v1.json`; raw model answers remain only under gitignored `logs/`.
