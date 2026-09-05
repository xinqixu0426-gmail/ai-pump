# V5 Top-K Source Span Selection V1

Architecture remains 3; external interpretation contract remains 1. Stage1 selection protocol and prompt are version 2; K is exactly 2, not configurable. This replaces single-span selection in the experimental candidate-set shadow runtime only. Business API, typed resolver, catalog/source boundaries, Stage2 instructions and capability controls remain unchanged.

## Contract and ownership

Stage1 returns only `{version:2, spanRefs:[ref1,ref2], needsClarification:false}`. Both references must exist in the current request catalog and be distinct. Order is retained for Top1 and Recall@2 evaluation. Clarification requires an empty array and does not perform lookups. Missing/extra fields, invalid version/JSON, one or three references and invented references fail closed. Model never supplies source text, canonical identity, entity type, task class or business answer in Stage1.

Rank grants no business priority. Source substrings come unchanged from catalog offsets. Two sequential, bounded existing resolver calls collect authoritative candidates. Each invokes the unchanged one-mention/six-type query API once. No third lookup or retry; error/incomplete/timeout stops and invalidates the entire union. NOT_FOUND is complete zero evidence: one zero plus one hit can proceed, two zero results cannot enter Stage2.

## Union and finalization

Deduplicate by entityType plus canonicalId, retaining matchedSpanRefs in request-local memory. Both source sets must be complete. Aggregate candidate ceiling is twice the existing per-response MAX_TOTAL_CANDIDATES; no truncation to make a unique result. Cross-span candidates remain regardless of rank. The unchanged local catalog uses the union's entity types. Singleton class selection is deterministic; otherwise Stage2 runs once with unchanged instruction/protocol and a safe reference array in the existing spanRef input slot.

The unchanged finalizer filters the whole union by selected class types: zero is mismatch, one is resolved, multiple are ambiguous. Only after final identity is fixed does projection choose a deterministic source witness among its matched refs (start, then end), independent of rank. Exact anchoring and external Contract V1 validation still run. Top-2 refs remain available separately for recall evaluation.

## Budgets, privacy and isolation

Stage1 <=1 model call; Stage2 <=1; each stage uses unchanged DeepSeek settings, timeout and no retries. Authority lookups <=2, each using the existing 5-second candidate-acquisition timeout. The existing bounded async shadow scheduler remains responsible for capacity, fail-open behavior and user-response independence.

Stage2 receives original request, safe refs, entity-type labels and local class semantics only; no candidate names/IDs or separate span texts. Identity values remain transient. Trace metadata contains counts, statuses and correlations only; evaluation may retain expected span rank, never span text. Exact-query API privacy and authentication are unchanged. No V5 Tool execution, write, production routing or answer composition is introduced.

## Evaluation discipline

The original 15 paths/5 groups/4 request fingerprints and expected values remain frozen. One synthetic non-business Stage1 canary precedes one full evaluation. Freeze hashes include new union, protocol, selectors, runtime, authority boundaries, existing controls and evaluator. Post-evaluation implementation changes or semantic re-runs are prohibited. R02 exclusion counts as effective only after correct final class and capability, not an empty exposure due to failure.

Top1 is descriptive; Recall@2, full candidate completeness, correct final identity/class/capability, no false unique entity, no false block, privacy, latency and concurrency remain required gates. Increased recall does not guarantee semantic success or promote the runtime.
