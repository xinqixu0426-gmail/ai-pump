# P16-I-R4 Price vs Inventory Semantic Split

## 1. Executive result

Status: **REWORK**. The approved price/quantity split and server-derived scope pass all local frozen paths. Narrow production Candidate validation passes price, quantity and recipe, but the representative coil request returns `INTERPRETER_UNAVAILABLE` before fact derivation. P16_I_RESUME_READY=NO. No owner-default flag, Legacy restart, existing Candidate replacement, or retry was performed.

Start commit: `442119cba601a9a026b23d543a0439606a5e458e`, branch `master`. User-owned dirty work is excluded from the stage commit. Production validation used an isolated archive of that commit plus only the authorized implementation overlay, not the user-owned dirty files.

## 2. Semantic and execution authority

`tc_002 / part.inventory.read / semanticOperation=read_inventory` maps only to `inventory.quantity`. Appended `tc_028 / part.price.read / semanticOperation=read_price` maps only to `price.current`. Both preserve the existing `catalog/read_inventory/part` execution projection, `inventory.read` capability and `search_parts` binder. Coil tc_004 and recipe tc_024 keep their prior definitions and fact mappings.

There is no new model stage, classifier, retry, keyword channel or fact-selection model. The existing Stage2 selects between the local classes. Previously singleton part requests now use that already-approved Stage2 slot; this is not a claim that realized call counts are identical to the old singleton optimization. Frozen evaluation uses two Interpreter calls per path, within the unchanged maximum of two.

Source-span selection, nested refinement, resolver, finalization, router, exposure, binder, execution/evidence/verification/composer and owner authentication are unchanged. Their pre/post hashes match. The first 27 routing identities remain intact; only the part semantic definitions and their local contrast gain the new distinction. Historical artifacts are not rewritten.

## 3. Server-derived scope and compatibility

The new closed `requiredFactScope.cjs` map requires selected class, valid interpretation, matching domain/operation and authoritative entity type. It does not read user wording or Tool output. Candidate risk admission stays first. Write-risk fixture requests reach neither Interpreter nor derivation, Tool or Answer.

Candidate uses the derived fact when the header is absent. Matching assertions proceed; mismatched assertions return `FACT_ASSERTION_MISMATCH` before execution/composition. The explicit gateway may omit the header, never fabricates one, and retains authenticated opt-in and the existing single safe Legacy fallback. Historical in-process preview routes are unchanged.

## 4. Local frozen certification

One 15-path real run, no fact header, isolated native-readonly Candidate and DB snapshot. No run was repeated. Required facts and source requests remain the frozen Oracle; only the three price expectations are revised to tc_028 as authorized.

| Metric | Result |
| --- | --- |
| Final class / unique exact entity / entity type | 15/15 |
| Capability / unchanged unique read exposure | 15/15 |
| Server fact derivation | 15/15 |
| Read execution / result equivalence / evidence verification | 15/15 |
| Answer contract / grounding / numeric / identity | 15/15 |
| Price / quantity / coil / recipe | 3/3, 6/6, 3/3, 3/3 |
| Price selecting inventory / inventory selecting price | 0/3, 0/6 |
| Exact Entity / blade price / R02 exclusion | 3/3, 3/3, 3/3 |
| False blocks / writes | 0, 0 |

### Measurement correction, not an evaluation retry

The initial aggregate incorrectly read `expected_task_class` instead of the frozen artifact's `expected_class`, falsely marking twelve recorded semantic matches false. `p16i-r4-semantic-certification.json` retains that original output and `pass=false`. Its selected class, identity, execution and answer observations are unchanged. The separately hashed static `p16i-r4-semantic-adjudication.json` recomputes class equality from the correct frozen field and yields 15/15 PASS. Static adjudication makes zero model/API calls. The harness field name is corrected for maintenance, but was not rerun. No production semantic implementation changed after evaluation.

## 5. Production Candidate validation

Only after local focused/frozen PASS, created a disposable code directory `/Users/dan/pump-v5-p16ir4.HLqulD`, loopback port 3114, with existing production dependencies through NODE_PATH. An initial missing dependency search path stopped before Candidate/model startup; no SDK was installed. The actual narrow validation then ran once.

Applicability was established from existing formal read APIs and exact six-type lookup, before model execution. One authoritative uniquely addressable current object per type was selected deterministically from a bounded preflight set. The same part was used for both questions. No entity values are retained in this report or dataset.

| Request | Derived scope | Result |
| --- | --- | --- |
| Part current price | price.current / tc_028 | PASS: exact entity, read/reference MATCH, verification and answer PASS |
| Part current quantity | inventory.quantity / tc_002 | PASS: exact entity, read/reference MATCH, verification and answer PASS |
| Coil quantity | Not derived | FAIL CLOSED: INTERPRETER_UNAVAILABLE; one Interpreter call, zero Tool/Answer |
| Recipe cost preview | recipe.cost.preview / tc_024 | PASS: exact entity, read/reference MATCH, verification and answer PASS |

The coil failure is upstream of the new scope mapping. The harness retained no fine-grained Stage1/lookup reason; it is not evidence of a specific span, provider or lookup root cause. No new model attempt was made to diagnose it. Resolving/attributing that failure needs Supervisor review rather than an unrelated Stage1 change in this stage.

Temporary Candidate was healthy before shutdown and port 3114 closed afterward. Existing Candidate PID 75736, owner gateway PID 75637 and Legacy PID 59155 remain unchanged and healthy. No ingress, credentials, owner subject, default-routing configuration or persistent runtime was replaced. The directory contains code-only certification artifacts and has no running service or copied secrets.

## 6. Safety, privacy and latency

Local certification: 153 metadata-only spans, orphan=0, cross-request=0, source text detections=0, forbidden content-field detections=0. Production certification suppresses normal logs and retains only fixed structural outcomes; observed raw text/credential detections=0. Answers, facts, canonical identities and credentials are not persisted. Production observability was disabled on the temporary validation process; this is not a new live Phoenix certification.

Local main DB and isolated fixture hash/mtime/size unchanged; backup count unchanged. Production business DB hash/mtime/size, `.env`, and backup count unchanged. Native Candidate readonly lifecycle is unmodified; lifecycle and mutation-family tests pass, including blocked checkpoint/backup/write attempts, startup/shutdown and concurrent task isolation. No write-authority enabling or business mutation path was added or called.

Local end-to-end Candidate median **2923.3542 ms**, p95 **3522.3844 ms**. Fact derivation median **0.0080 ms**, p95 **0.0835 ms**. These include real model completion, not V4 overhead. Narrow production durations were 3482.4730 / 4002.3313 / 1902.6631 (rejected coil) / 3360.1370 ms; they are four observations, not a percentile certification. No performance tuning was done.

## 7. Regression and delivery

- V5 plus Candidate/risk/owner/gateway suites: 436/436 PASS.
- API contract governance: 26/26 PASS.
- Full deterministic regression: 2222/2223; sole failure remains missing `.guardian/config.yaml`.
- Build: PASS.
- Deep API: stopped at `get_copper_price` external fetch failure (`mcp_execution_evidence_missing`). This run did not reach full PASS, and is not relabeled as the earlier copperBase race. No affected copper transport, Tool or service was modified.
- Header absent/equal/mismatch, write-risk pre-Interpreter rejection, exact identity, local concurrency, owner/shared-admin identity, gateway auth and safe fallback fixtures PASS.

Only R4 changes are staged. The two shared authority documents are staged from HEAD with only R4 paragraphs, preserving user-owned V4 edits unstaged. No push or default-routing deployment is part of this stage.

## 8. Supervisor gate

P16_I_RESUME_READY=NO. Current rollout blocker: representative production coil request fails closed before semantic/fact derivation. Local frozen coil remains 3/3; production price/inventory split works. Do not infer production coil correctness from local results, and do not resume P16-I automatically.
