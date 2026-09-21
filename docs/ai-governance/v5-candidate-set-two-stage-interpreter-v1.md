# V5 Candidate-Set Two-Stage Interpreter V1

Internal architecture version: 3. External interpretation contract: 1. Span-selector prompt: 1.1. Local-intent prompt: 1.1. Both prompt revisions add only `Return the result as a valid JSON object. ` before the unchanged semantic instruction. Reason: JSON-mode provider compatibility only. Historical Protocol V2 and its prompts remain frozen as explicit historical test baselines.

## Authority and scope

This is the independent Shadow entry point. V4 remains authoritative and never awaits its completion. The existing disabled-by-default sampled, capacity-bounded scheduler runs V3 after the V4 path. No Tool is executed, no answer is composed, and no write is permitted. The only business dependency is the existing governed read-only batch entity lookup.

Scope is one primary source span and one primary task. Multiple independent entities and compound tasks require clarification and future task-node orchestration; this version does not claim multi-entity support.

## Stage 1

`sourceSpanSelector.cjs` gives the model the raw request and the unchanged deterministic source-span catalog in transient memory. Strict output is `{version:1, spanRef, needsClarification}`. A clarification can use `spanRef:null`. Extra fields and invented references fail closed. The model receives no Task Classes, canonical IDs, V4 results, or Tools.

The selected span's source offsets generate the mention. The model cannot rewrite it. Existing exact source anchoring validates the final Contract V1 projection without changing anchor rules.

## Authoritative candidate set

`candidateSet.cjs` calls the unchanged type-independent resolver once. Its existing lookup dependency hook captures a copied, validated candidate response from that same batch call; no second query is performed. Completeness and the resolver status must permit continuation. `RESOLVED` and `AMBIGUOUS` may continue when the response is complete and non-empty. Errors, timeouts, incomplete results and not-found outcomes fail closed.

Candidates and their canonical IDs remain private runtime data. Capturing a complete ambiguous response does not change the resolver's ambiguity decision. The software, not the model, owns candidate authority.

## Local catalog and selection

`localTaskClassCatalog.cjs` intersects candidate types with the frozen class entity-type sets. It preserves class identity, ordering, primary meanings and Semantics 1.1. Model-facing local contrasts are restricted to references in this local set, preventing unrelated classes from leaking through alternatives.

Zero classes fail closed. One class is selected deterministically without a second model call. More than one class invokes `localIntentSelector.cjs`; strict output is `{version:1,localTaskClassRef}`. The reference must be local to the current request. Wrong-but-valid choices remain wrong and are evaluated as such. There is no global fallback or silent correction.

## Finalization and routing

`entityFinalization.cjs` filters the authoritative candidates by the selected class's entity types. One candidate resolves; zero gives `CLASS_ENTITY_MISMATCH`; more than one gives `FINAL_ENTITY_AMBIGUOUS`. The model never chooses a canonical identity. Same-type ambiguity therefore remains unresolved.

Only successful finalization projects the selected class and source-owned mention into unchanged Contract V1. The finalized canonical ID is attached to the transient routing task's existing entity reference. Existing deterministic capability routing and bounded exposure run afterward. Neither receives model-generated domain, operation or entity type.

## Model, deadlines and isolation

Both stages use DeepSeek `deepseek-v4-flash`, temperature 0, omitted top_p, JSON-object response format, 512 output tokens, and zero retries. Configuration is passed in a request-local environment copy; process-global V4 provider/model settings are never altered. Stage 1 uses at most one model call, Stage 2 at most one, total at most two.

Each stage defaults to 20 seconds and has an aborting timeout. The governed lookup defaults to 5 seconds. The scheduler budget includes both stages plus lookup. The existing concurrency gate applies before scheduling. Model and API failures cannot change V4 output.

Stage failures preserve allowlisted category, local provider error code, HTTP status, provider category, timeout/retryability and bounded cause-class categories. Raw error messages, stacks, bodies and arbitrary causes are excluded. Protocol errors remain INVALID and have a distinct MODEL_PROTOCOL_ERROR category; provider invocation errors remain fatal to formal evaluation.

## Tracing and privacy

An AGENT evaluation span owns metadata-only stage spans for span selection, governed lookup, local catalog construction, optional local intent, finalization, routing and comparison. Exported fields are status, counts, stage names, safe correlation IDs and architecture version. Raw requests, spans, mentions, canonical IDs, candidate identities, model output, Tool values and business values are never added to trace attributes or safe outcomes.

The interpreter's raw interpretation and finalized identity are transient internal objects. `independentShadow.cjs` projects only safe metadata before publication. Evaluation compares canonical IDs only in memory and persists boolean correctness, not identity values.

## Evaluation integrity

The evaluator recovers the same five source groups by their four frozen request fingerprints and uses the same 15 path IDs and authoritative expected values. It runs real V5 stages and the unchanged Business API over a read-only connection to the existing source database in an isolated local server. No API startup module is imported, avoiding migrations, backups and startup business jobs. V4 comparison uses frozen P06 trajectories, not a newly sampled V4 model run.

Pre-evaluation hashes include prompts, stage contracts, candidate/local/finalization logic, unchanged authority components, model settings, corpus and expectations. The output file is an exclusive one-shot marker and checkpoint. Infrastructure failure stops the run; a second run requires Supervisor review. After real evaluation starts, implementation remains frozen and only result dataset/report may change.

P15R-E-B2-B has explicit authorization to evaluate the full corpus after the prior infrastructure-aborted attempt, which produced no valid semantic result. Its new dataset does not overwrite that attempt. Both single-call non-business canaries must parse successfully before the formal run. Fatal failures persist safe evidence and then reject the CLI main for a nonzero exit; completed semantic misses remain evaluation results, not infrastructure failures.
