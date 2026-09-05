# V5-E4R-E-B2-B JSON-Compatible Two-Stage Evaluation

## 1. Approved Scope

Start 62ac87717db2fcd004371367b6509af6f5fd2a41, master, dirty worktree preserved. Architecture3 / Contract1 unchanged. Stage1 and Stage2 prompt versions1.1 add only the identical JSON-format prefix. Tests strip that prefix and compare SHA-256 against the original B2 semantic prompt hashes. No semantic rule, example, class, candidate, authority, model or setting change is permitted.

## 2. Error / Fatal Handling

Allowlisted local code, error class, HTTP status, provider category, timeout/retryability and up to three cause-class categories survive stage wrappers and safe architecture metadata. Provider text/stack/raw cause is never retained. Protocol-invalid is separate from provider invocation failure. Evaluator persists evidence, closes resources and then enforces fatal rejection/nonzero exit.

## 3. Pre-Evaluation Tests and Freeze

Combined V5 tests: 255/255. New compatibility tests:15/15; existing B2 tests23/23 also pass. A lexical import test initially mistook AiProvider error-class labels for a new import; its explicit wrapper check now proves no new provider/client/DB import. No authority boundary was widened. Six subprocess exit scenarios pass, including Stage1/Stage2/lookup/hash fatal cases.

Preflight persisted the full freeze manifest before either canary in v5-e4r-two-stage-json-preflight.json. Both one-call non-business canaries returned VALID, no retry; hashes and database snapshot match. The formal evaluator checked this manifest before running. Prior infrastructure-aborted runs=1; that original dataset remains unchanged. A new exclusive output path preserves the first valid semantic run separately.

## 4. Formal Evaluation

Formal runs=1, attempted/recorded15/15, exit0, no infrastructure failure. No implementation/test/prompt edits after formal start. Frozen15 paths/five groups/four source fingerprints and expected values remain unchanged. V4 comparisons use frozen P06 trajectories rather than new V4 model calls, as in original B2.

| Metric | Correct/applicable |
|---|---|
| Stage1 protocol valid | 15/15 |
| Stage1 expected source span | 9/15 |
| Lookup complete | 15/15 |
| Expected class survives local catalog | 9/15 |
| Stage2 protocol / local intent | 3/3 |
| Final class / unique correct entity | 9/15 |
| Domain / operation / entity type | 9/15 each |
| Capability / expected Tool exposure | 9/15 each |
| Source-group semantic accuracy | 3/5 |
| Input-fingerprint semantic accuracy | 2/4 |

Stage1 invalid/noncompliance=0; Stage2 invalid/noncompliance=0. Valid reference selection does not imply the reference denotes the expected complete entity. Six wrong-span paths return NOT_FOUND rather than reaching local intent. Initial unique9, ambiguous0, not-found6, resolver errors0, false unique0. Candidate completeness alone does not assert existence. Local catalog median1/max2 (all paths, including zero on not-found). Singleton deterministic paths6; Stage2-applicable paths3; no Stage2 calls on singleton paths.

Stage1 same-input consistency4/4 fingerprints; Stage2 consistency1/1 repeated fingerprint; final consistency4/4. Each observed fingerprint has repeated runtime variants, unlike the previous one-path vacuous metric. Consistency includes stable wrong selections and is not an accuracy claim.

### Coil

All3 paths select expected span, resolve coil, retain two local classes and select expected read class. Stage2/local intent, final entity, capability and exposure3/3; false blocks0. This group now has actual local-intent evidence, not an expected-class simulation.

### 800平刀

All3 paths select a valid but wrong source reference (sp_001), spanMatch=false. Lookup returns complete NOT_FOUND, candidate types=[], local count0. Expected part+template ambiguity was therefore not exercised in this run; it was neither suppressed nor modified. Stage2 NOT_RUN. Final entity/type/capability/exposure0/3. No patch, alias, fallback or additional query was used to force the expected ambiguity or result.

### Exact Entity

All3 paths likewise select sp_001 instead of the expected entity span. Complete NOT_FOUND, no Stage2/finalization. Expected exact identity success0/3; source-backed substring ownership remains unchanged, but preservation of the wrong selected substring is not successful expected identity extraction. The source catalog/anchor was not changed and no downstream anchor implementation bug is established by this result.

### R02 and comparisons

Frozen R02 wrong Tool exclusion3/3 according to unchanged comparator, but these paths have empty exposure after NOT_FOUND: exclusion must not be mistaken for correct expected Tool routing. V5_FALSE_BLOCK0, V5_BLOCKS_V4_FAILURE2, V5_INSUFFICIENT_DATA6, AGREE7. Existing comparator semantics were retained without tuning.

### Invocation/read counts and latency

Formal Stage1 calls15; Stage2 calls3; total18, average1.2/path, maximum2. Two preflight model calls are separate: total real provider invocations this stage20. Retry0; logical resolver calls15; existing batch Business API reads15. V5 Tools/real Tool executions/writes/production routing0. API and resolver semantics remain unchanged.

V3 completion median422.2038ms/P95 1138.1230ms. Stage1 median387.1864ms/P95 1134.0573ms; lookup median2.7249ms/P95 23.8217ms; Stage2 median331.4374ms/P95 373.1708ms. These are shadow completion latencies, not user-visible V4 overhead.

## 5. Infrastructure and Safety

Ten concurrent synthetic requests passed with zero contamination. Fixed-10ms scheduler benchmark: OFF median15.9305ms/P95 19.9884ms; ON median15.4047ms/P95 21.4136ms; overhead -3.3006% / +7.1301%; PASS. This is deterministic infrastructure evidence, not production user-latency measurement.

## 6. Outcome / Preconditions

PARTIAL; P16_READY=NO. JSON compatibility, error diagnostics and fatal exit are repaired and verified, but authoritative span/entity/class/capability/exposure gates fail at9/15. Stage2 succeeds only on its observed3 applicable coil paths; it has no new Exact/800 evidence. Do not generalize the small conditional success denominator to the full corpus. No second semantic run or post-evaluation changes were performed.

## 7. Privacy / Trace Integrity

Read-only Phoenix inspection found all15 formal traces,96 spans,0 orphan parents,0 cross-trace parent links,0 wrong shadowTask correlation and0 events. Exported fields are safe root/stage IDs/status/counts. No prompt, response, source substring, canonical identity, business values, PII or secrets were observed. Fake provider errors containing sentinels proved safe error projection excludes messages, arbitrary codes and cyclic causes. No real provider error occurred in this formal run; error telemetry behavior is supported by deterministic tests rather than an additional live failure.

## 8. Database / Regression / Freeze

Before preflight, after canaries, after formal evaluation and final snapshot agree: SHA-256 09b77d8d93a7fe8a30dd4a9ac6f9e743745c384396e783983fc82617f4bef38e, mtimeMs1788424936315.8767, size35,323,904 bytes, backups209. No unexpected backup, no business mutation.

Final full deterministic regression2041/2042: only missing .guardian/config.yaml. Combined V5 255/255. No new deterministic regression observed. Deep API pre-existing snapshot race attribution is retained from B2/B2-A; the broad mutation-fixture Deep API suite was not rerun in this narrowly governed invocation task and is not claimed to have newly passed.

All preflight/formal pre/post freeze entries match; later read-only recomputation also matches. Protected Candidate Set, local catalog, finalization, lookup, resolver, source mechanisms, classes, semantics, contracts/router/exposure remain byte-identical to the prior B2 manifest. Approved differences are format-prefixed stage prompts, safe diagnostic propagation/observability and evaluator control flow. The new freeze manifest additionally includes the evaluator control/preflight scripts. Only dataset/report annotations were added after formal evaluation.

## 9. Delivery Limitations

No changes to V4 model/business behavior, dependencies, production routing or user-owned dirty files. V4 isolation/response invariants are deterministic tests and synthetic scheduler evidence; real V4 behavior was not resampled. Full semantic gates remain failed. Supervisor review is required before any further investigation or change; no prompt, class, source-span or model tuning is proposed or performed here.
