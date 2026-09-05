# V5 Bounded Nested-Span Refinement V1

Interpreter architecture remains 3; external interpretation contract remains 1. Stage1 prompt/protocol and Top K=2 are unchanged. NESTED_SPAN_REFINEMENT_VERSION=1; strategy IDENTIFIER_PRIORITY; K=1 per parent; MAX_ENTITY_LOOKUPS_PER_PATH=4.

## Trigger and boundaries

Both original lookups must have completed, individually complete=true/status=NOT_FOUND, with zero original authoritative union candidates. Any hit, including AMBIGUOUS, prevents refinement for the whole request. Errors, timeout or incomplete authority cannot trigger recovery. Successful original paths keep their existing local catalog/Stage2 inputs.

## Audited Strategy B

Use only proper nested existing source catalog spans, exclude both already queried original refs, retain the existing 160-code-point bound. Rank identifier, quoted, combined, word; descending code-point length; ascending start then end offsets. Lexical category ownership and regular expressions match the F-A audit: identifier overrides quote; pure word segments are word, remaining combinations combined. No business term, expected ref/type, lookup outcome or name participates in ranking.

Choose one ref per parent before reads, dedupe refs, and never refill after dedupe or failed lookup. No new substrings, source modification, adaptive ranking, recursive search or model retry. A whole-request parent can encompass most catalog metadata, but authority reads still have a fixed cap.

## Authority and failures

Reuse the existing candidate-set acquisition through the existing one-mention governed Business API/resolver. Two original plus at most two nested reads. Call reservations reject a fifth invocation with LOOKUP_BUDGET_EXCEEDED. Per-read timeout remains bounded by the existing resolver convention. No new API, SQLite connection, alias or fuzzy policy.

Execute the fixed nested plan, including complete negative results. Any nested error/incomplete/timeout fails the path closed and exposes safe existing error reason codes. Never accept one hit while ignoring another planned lookup's infrastructure failure. All-zero final union remains NOT_FOUND; no further search.

## Union and finalization

Deduplicate authoritative candidates by entityType + canonicalId with matchedSpanRefs provenance. Original union must be empty at entry. Candidate count is bounded by four times the existing per-read maximum (120); no truncation-to-unique. Local catalog and Stage2 remain unchanged: singleton deterministic, otherwise at most one Stage2 call. Stage1 <=1, Stage2 <=1, retry=0.

Rank has no canonical entity authority. The unchanged finalizer applies selected class type constraints; same-type multiplicity stays ambiguous. After finalization, choose an exact source witness from original or nested matching refs and run the existing exact anchor. Canonical identity and source values remain transient.

## Metadata and evaluation

Safe outcome metadata records original/nested counts, statuses, trigger and safe refs; no raw mention, source text, candidate identity, response, prompt or canonical ID is copied into reports/traces. Provider/model/settings, V4, Stage2 semantics, capability routing and exposure are frozen.

Evaluation is a single new full frozen 15-path run after deterministic tests and freeze. Stage1 Top1/recall@2 remain separately measured; refined recall checks original OR nested references. Real outcomes must not be replaced by the F-A simulation. All safety and accuracy gates remain mandatory for P16; this feature does not implement P16 or execute a Tool.
